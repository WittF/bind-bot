import { Context, Schema, h, Session, Logger } from 'koishi'
import axios from 'axios'
import { Rcon } from 'rcon-client'

export const name = 'bind-mcid'

// 声明插件依赖
export const inject = ['database']

// 定义插件配置
export interface Config {
  cooldownDays: number
  masterId: string
  servers: ServerConfig[]
  allowTextPrefix: boolean
  botNickname: string
  autoRecallTime: number
}

// 服务器配置接口
export interface ServerConfig {
  id: string
  name: string
  rconAddress: string
  rconPassword: string
  addCommand: string
  removeCommand: string
  idType: 'username' | 'uuid'
  allowSelfApply: boolean
  acceptEmptyResponse?: boolean // 新增：每个服务器单独配置
  displayAddress?: string // 新增：服务器展示地址
  description?: string // 新增：服务器说明信息
  enabled?: boolean // 新增：服务器启用状态
}

// 创建配置Schema
export const Config: Schema<Config> = Schema.object({
  cooldownDays: Schema.number()
    .description('操作冷却时间(天)')
    .default(15),
  masterId: Schema.string()
    .description('主人QQ号，拥有管理员管理权限')
    .default(''),
  allowTextPrefix: Schema.boolean()
    .description('是否允许通过文本前缀触发指令(如"@机器人 mcid bind xxx")')
    .default(false),
  botNickname: Schema.string()
    .description('机器人昵称，用于文本前缀匹配，如"@WittF-NBot"')
    .default(''),
  autoRecallTime: Schema.number()
    .description('机器人消息自动撤回时间(秒)，设置为0表示不自动撤回')
    .default(0),
  servers: Schema.array(Schema.object({
    id: Schema.string()
      .description('服务器唯一ID（不允许重复）')
      .required(),
    name: Schema.string()
      .description('服务器名称（用于指令显示）')
      .required(),
    enabled: Schema.boolean()
      .description('服务器是否启用')
      .default(true),
    displayAddress: Schema.string()
      .description('服务器展示地址（显示给用户的连接地址）')
      .default(''),
    description: Schema.string()
      .description('服务器说明信息（显示在列表中服务器地址下方）')
      .default(''),
    rconAddress: Schema.string()
      .description('RCON地址，格式为 IP:端口，例如 127.0.0.1:25575')
      .required(),
    rconPassword: Schema.string()
      .description('RCON密码')
      .default(''),
    addCommand: Schema.string()
      .description('添加白名单命令模板，使用${MCID}作为替换符')
      .default('whitelist add ${MCID}'),
    removeCommand: Schema.string()
      .description('移除白名单命令模板，使用${MCID}作为替换符')
      .default('whitelist remove ${MCID}'),
    idType: Schema.union([
      Schema.const('username').description('使用用户名'),
      Schema.const('uuid').description('使用UUID')
    ]).default('username').description('白名单添加时使用的ID类型'),
    allowSelfApply: Schema.boolean()
      .description('是否允许用户自行申请白名单')
      .default(false),
    acceptEmptyResponse: Schema.boolean()
      .description('是否将命令的空响应视为成功（某些服务器成功执行命令后不返回内容，仅对本服务器生效）')
      .default(false),
  })).description('Minecraft服务器配置列表').default([]),
})

// 定义MCIDBIND表结构
export interface MCIDBIND {
  qqId: string          // 纯QQ号 (作为主键)
  mcUsername: string    // MC用户名
  mcUuid: string        // MC UUID
  lastModified: Date    // 上次修改时间
  isAdmin: boolean      // 是否为MC绑定管理员
  whitelist: string[]   // 已添加白名单的服务器ID列表
}

// 为koishi扩展表定义
declare module 'koishi' {
  // 添加MCIDBIND表
  interface Tables {
    mcidbind: MCIDBIND
  }
}

// 头像缓存接口
interface AvatarCache {
  url: string
  timestamp: number
}

// Mojang API响应接口
interface MojangProfile {
  id: string    // UUID (不带连字符)
  name: string  // 玩家名称
}

// RconManager类，用于管理RCON连接
class RconManager {
  private connections: Map<string, { 
    rcon: Rcon, 
    lastUsed: number,
    heartbeatInterval: NodeJS.Timeout | null,
    reconnecting: boolean
  }> = new Map();
  private logger: Logger;
  private heartbeatCmd = 'list'; // 心跳命令，使用无害的list命令
  private heartbeatInterval = 5 * 60 * 1000; // 5分钟发送一次心跳
  private maxIdleTime = 30 * 60 * 1000; // 连接空闲30分钟后关闭
  private maxConnections = 20; // 最大同时连接数，防止资源耗尽
  private serverConfigs: ServerConfig[] = [];
  
  constructor(logger: Logger, serverConfigs: ServerConfig[]) {
    this.logger = logger;
    this.serverConfigs = serverConfigs;
    
    // 每5分钟检查一次空闲连接
    setInterval(() => this.cleanIdleConnections(), 5 * 60 * 1000);
  }
  
  // 获取RCON连接
  async getConnection(server: ServerConfig): Promise<Rcon> {
    const serverId = server.id;
    const connectionInfo = this.connections.get(serverId);
    
    // 如果已有连接且仍然活跃，检查连接状态
    if (connectionInfo && connectionInfo.rcon && !connectionInfo.reconnecting) {
      try {
        // 测试连接是否仍然有效
        await connectionInfo.rcon.send('ping');
        
        // 更新最后使用时间
        connectionInfo.lastUsed = Date.now();
        return connectionInfo.rcon;
      } catch (error) {
        // 连接可能已关闭，需要重新建立
        this.logger.warn(`[RCON管理器] 服务器 ${server.name} 的连接已失效，将重新连接: ${error.message}`);
        await this.resetConnection(server);
      }
    }
    
    // 创建新连接
    return this.createConnection(server);
  }
  
  // 创建新RCON连接
  private async createConnection(server: ServerConfig): Promise<Rcon> {
    // 解析RCON地址和端口
    const addressParts = server.rconAddress.split(':');
    if (addressParts.length !== 2) {
      throw new Error(`RCON地址格式错误: ${server.rconAddress}, 正确格式应为 IP:端口`);
    }
    
    const host = addressParts[0];
    const portStr = addressParts[1];
    
    // 验证端口是有效数字
    const port = parseInt(portStr);
    if (isNaN(port) || port <= 0 || port > 65535) {
      throw new Error(`服务器${server.name}的RCON端口无效: ${portStr}, 端口应为1-65535之间的数字`);
    }
    
    const serverId = server.id;
    
    // 检查连接池大小，如果超过最大限制，尝试关闭最久未使用的连接
    if (this.connections.size >= this.maxConnections) {
      this.logger.warn(`[RCON管理器] 连接数量达到上限(${this.maxConnections})，尝试关闭最久未使用的连接`);
      this.pruneOldestConnection();
    }

    // 标记为正在重连
    if (this.connections.has(serverId)) {
      const connectionInfo = this.connections.get(serverId);
      if (connectionInfo) {
        connectionInfo.reconnecting = true;
        
        // 清除旧的心跳定时器
        if (connectionInfo.heartbeatInterval) {
          clearInterval(connectionInfo.heartbeatInterval);
          connectionInfo.heartbeatInterval = null;
        }
      }
    }
    
    try {
      // 创建新连接
      this.logger.info(`[RCON管理器] 正在连接到服务器 ${server.name} (${server.rconAddress})`);
      const rcon = await Rcon.connect({
        host,
        port,
        password: server.rconPassword,
        timeout: 3000 // 3秒连接超时
      });
      
      // 设置心跳定时器，保持连接活跃
      const heartbeatInterval = setInterval(async () => {
        try {
          this.logger.debug(`[RCON管理器] 向服务器 ${server.name} 发送心跳命令`);
          await rcon.send(this.heartbeatCmd);
        } catch (error) {
          this.logger.error(`[RCON管理器] 服务器 ${server.name} 心跳失败: ${error.message}`);
          
          // 心跳失败，重置连接
          this.resetConnection(server);
        }
      }, this.heartbeatInterval);
      
      // 存储连接信息
      this.connections.set(serverId, {
        rcon,
        lastUsed: Date.now(),
        heartbeatInterval,
        reconnecting: false
      });
      
      this.logger.info(`[RCON管理器] 成功连接到服务器 ${server.name}`);
      return rcon;
    } catch (error) {
      this.logger.error(`[RCON管理器] 连接服务器 ${server.name} 失败: ${error.message}`);
      
      // 重置连接状态
      if (this.connections.has(serverId)) {
        const connectionInfo = this.connections.get(serverId);
        if (connectionInfo) {
          connectionInfo.reconnecting = false;
        }
      }
      
      throw error;
    }
  }
  
  // 关闭最久未使用的连接
  private pruneOldestConnection(): boolean {
    let oldestId: string | null = null;
    let oldestTime = Infinity;
    
    // 找出最久未使用的连接
    for (const [serverId, connectionInfo] of this.connections.entries()) {
      // 跳过正在重连的连接
      if (connectionInfo.reconnecting) continue;
      
      if (connectionInfo.lastUsed < oldestTime) {
        oldestTime = connectionInfo.lastUsed;
        oldestId = serverId;
      }
    }
    
    // 如果找到了可以关闭的连接
    if (oldestId) {
      const connectionInfo = this.connections.get(oldestId);
      if (connectionInfo) {
        // 清除心跳定时器
        if (connectionInfo.heartbeatInterval) {
          clearInterval(connectionInfo.heartbeatInterval);
        }
        
        // 尝试关闭连接
        try {
          connectionInfo.rcon.end();
          this.logger.info(`[RCON管理器] 由于连接池满，关闭了最久未使用的连接: ${oldestId}`);
        } catch (error) {
          this.logger.debug(`[RCON管理器] 关闭最久未使用的连接出错: ${error.message}`);
        }
        
        // 从连接池中移除
        this.connections.delete(oldestId);
        return true;
      }
    }
    
    return false;
  }
  
  // 重置连接
  private async resetConnection(server: ServerConfig): Promise<void> {
    const serverId = server.id;
    const connectionInfo = this.connections.get(serverId);
    
    if (connectionInfo) {
      this.logger.info(`[RCON管理器] 重置服务器 ${server.name} 的连接`);
      
      // 标记为正在重连
      connectionInfo.reconnecting = true;
      
      // 清除心跳
      if (connectionInfo.heartbeatInterval) {
        clearInterval(connectionInfo.heartbeatInterval);
        connectionInfo.heartbeatInterval = null;
      }
      
      try {
        // 关闭旧连接
        await connectionInfo.rcon.end();
        this.logger.debug(`[RCON管理器] 已关闭服务器 ${server.name} 的旧连接`);
      } catch (error) {
        // 忽略关闭连接时的错误
        this.logger.debug(`[RCON管理器] 关闭服务器 ${server.name} 的连接时出错: ${error.message}`);
      }
      
      // 从映射中移除
      this.connections.delete(serverId);
    }
  }
  
  // 执行RCON命令
  async executeCommand(server: ServerConfig, command: string): Promise<string> {
    // 移除重试机制，改为单次尝试
    try {
      // 获取或创建连接
      const rcon = await this.getConnection(server);
      
      // 记录完整的命令，但隐藏可能的敏感信息
      let safeCommand = command;
      // 如果命令包含"op"或"password"等敏感词，则隐藏部分内容
      if (safeCommand.includes('password') || safeCommand.startsWith('op ')) {
        safeCommand = safeCommand.split(' ')[0] + ' [内容已隐藏]';
      }
      this.logger.info(`[RCON管理器] 服务器 ${server.name} 执行命令: ${safeCommand}`);
      
      const response = await rcon.send(command);
      
      // 记录完整响应内容
      this.logger.info(`[RCON管理器] 服务器 ${server.name} 收到响应: ${response.length > 0 ? response : '(空响应)'} (${response.length}字节)`);
      
      // 返回结果
      return response;
    } catch (error) {
      // 根据错误类型进行不同处理
      if (error.message.includes('ECONNREFUSED') || 
          error.message.includes('ETIMEDOUT') || 
          error.message.includes('ECONNRESET') || 
          error.message.includes('socket')) {
        // 网络连接类错误
        this.logger.error(`[RCON管理器] 服务器 ${server.name} 网络连接错误: ${error.message}`);
        throw new Error(`无法连接到服务器 ${server.name}: ${error.message}`);
      } else if (error.message.includes('authentication')) {
        // 认证错误
        this.logger.error(`[RCON管理器] 服务器 ${server.name} 认证失败，请检查密码: ${error.message}`);
        throw new Error(`连接服务器 ${server.name} 失败: 认证错误，请联系管理员检查RCON密码`);
      } else {
        // 其他错误
        this.logger.error(`[RCON管理器] 服务器 ${server.name} 执行命令失败: ${error.message}`);
        throw new Error(`执行命令失败: ${error.message}`);
      }
    }
  }
  
  // 清理空闲连接
  private async cleanIdleConnections(): Promise<void> {
    const now = Date.now();
    
    for (const [serverId, connectionInfo] of this.connections.entries()) {
      // 获取服务器名称（用于日志）
      const serverConfig = this.serverConfigs.find(server => server.id === serverId);
      const serverName = serverConfig ? serverConfig.name : serverId;
      
      // 如果连接空闲时间超过maxIdleTime，关闭它
      if (now - connectionInfo.lastUsed > this.maxIdleTime) {
        this.logger.info(`[RCON管理器] 关闭服务器 ${serverName} 的空闲连接`);
        
        // 清除心跳定时器
        if (connectionInfo.heartbeatInterval) {
          clearInterval(connectionInfo.heartbeatInterval);
        }
        
        // 关闭连接
        try {
          await connectionInfo.rcon.end();
        } catch (error) {
          this.logger.debug(`[RCON管理器] 关闭服务器 ${serverName} 的空闲连接时出错: ${error.message}`);
        }
        
        // 从连接池中删除
        this.connections.delete(serverId);
      }
    }
  }
  
  // 关闭所有连接
  async closeAll(): Promise<void> {
    for (const [serverId, connectionInfo] of this.connections.entries()) {
      // 获取服务器名称（用于日志）
      const serverConfig = this.serverConfigs.find(server => server.id === serverId);
      const serverName = serverConfig ? serverConfig.name : serverId;
      
      // 清除心跳定时器
      if (connectionInfo.heartbeatInterval) {
        clearInterval(connectionInfo.heartbeatInterval);
      }
      
      // 关闭连接
      try {
        await connectionInfo.rcon.end();
        this.logger.info(`[RCON管理器] 已关闭服务器 ${serverName} 的连接`);
      } catch (error) {
        this.logger.debug(`[RCON管理器] 关闭服务器 ${serverName} 的连接时出错: ${error.message}`);
      }
    }
    
    // 清空连接池
    this.connections.clear();
  }
}

// RateLimiter类，用于限制RCON请求频率
class RateLimiter {
  private requestTimes: Record<string, number[]> = {};
  private limit: number;
  private timeWindow: number;

  constructor(limit: number = 10, timeWindowMs: number = 3000) {
    this.limit = limit;
    this.timeWindow = timeWindowMs;
  }

  // 检查是否允许新请求
  canMakeRequest(key: string): boolean {
    const now = Date.now();
    if (!this.requestTimes[key]) {
      this.requestTimes[key] = [];
    }

    // 清理过期请求时间
    this.requestTimes[key] = this.requestTimes[key].filter(
      time => now - time < this.timeWindow
    );

    // 检查是否超过限制
    return this.requestTimes[key].length < this.limit;
  }

  // 记录新请求
  recordRequest(key: string): void {
    if (!this.requestTimes[key]) {
      this.requestTimes[key] = [];
    }
    this.requestTimes[key].push(Date.now());
  }
}

export function apply(ctx: Context, config: Config) {
  // 创建日志记录器
  const logger = new Logger('bind-mcid')
  
  // 创建头像缓存对象
  const avatarCache: Record<string, AvatarCache> = {}
  
  // 缓存有效期（12小时，单位毫秒）
  const CACHE_DURATION = 12 * 60 * 60 * 1000

  // 创建RCON连接管理器
  const rconManager = new RconManager(logger, config.servers || []);
  
  // 创建RCON限流器实例
  const rconRateLimiter = new RateLimiter(10, 3000); // 3秒内最多10个请求
  
  // 根据配置获取命令前缀
  const getCommandPrefix = (): string => {
    if (config.allowTextPrefix && config.botNickname) {
      // 检查botNickname是否已经包含@符号，避免重复添加
      const nickname = config.botNickname.startsWith('@') ? 
        config.botNickname :
        `@${config.botNickname}`;
      return `${nickname} `;
    }
    return '';
  };
  
  // 格式化命令提示
  const formatCommand = (cmd: string): string => {
    return `${getCommandPrefix()}${cmd}`;
  };
  
  // 简单的锁机制，用于防止并发操作
  const operationLocks: Record<string, boolean> = {};
  
  // 获取锁
  const acquireLock = (key: string): boolean => {
    if (operationLocks[key]) {
      return false;
    }
    operationLocks[key] = true;
    return true;
  };
  
  // 释放锁
  const releaseLock = (key: string): void => {
    operationLocks[key] = false;
  };
  
  // 使用锁执行异步操作
  const withLock = async <T>(key: string, operation: () => Promise<T>, timeoutMs = 10000): Promise<T> => {
    // 操作ID，用于日志
    const operationId = Math.random().toString(36).substr(2, 9);
    
    // 尝试获取锁
    let acquired = false;
    let attempts = 0;
    const maxAttempts = 5;
    
    while (!acquired && attempts < maxAttempts) {
      acquired = acquireLock(key);
      if (!acquired) {
        logger.debug(`[锁] 操作${operationId}等待锁 ${key} 释放 (尝试 ${attempts + 1}/${maxAttempts})`);
        // 等待一段时间后重试
        await new Promise(resolve => setTimeout(resolve, 200));
        attempts++;
      }
    }
    
    if (!acquired) {
      logger.warn(`[锁] 操作${operationId}无法获取锁 ${key}，强制获取`);
      // 强制获取锁
      acquireLock(key);
    }
    
    try {
      // 设置超时
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`操作超时 (${timeoutMs}ms)`)), timeoutMs);
      });
      
      // 执行操作
      const operationPromise = operation();
      const result = await Promise.race([operationPromise, timeoutPromise]);
      return result;
    } finally {
      // 无论成功失败，都释放锁
      releaseLock(key);
      logger.debug(`[锁] 操作${operationId}释放锁 ${key}`);
    }
  };

  // 插件销毁时关闭所有RCON连接
  ctx.on('dispose', async () => {
    logger.info('[RCON管理器] 插件卸载，关闭所有RCON连接');
    await rconManager.closeAll();
  });

  // 在数据库中创建MCIDBIND表
  ctx.model.extend('mcidbind', {
    qqId: {
      type: 'string',
    },
    mcUsername: {
      type: 'string',
      initial: '',
    },
    mcUuid: {
      type: 'string',
      initial: '',
    },
    lastModified: {
      type: 'timestamp',
      initial: null,
    },
    isAdmin: {
      type: 'boolean',
      initial: false,
    },
    whitelist: {
      type: 'json',
      initial: [],
    },
  }, {
    // 设置主键为qqId
    primary: 'qqId',
    // 添加索引
    unique: [['mcUsername']],
    // 添加isAdmin索引，提高查询效率
    indexes: [['isAdmin']],
  })

  // 检查表结构是否包含旧字段
  const checkTableStructure = async (): Promise<boolean> => {
    try {
      // 尝试获取一条记录来检查字段
      const records = await ctx.database.get('mcidbind', {}, { limit: 1 })
      
      // 如果没有记录，不需要迁移
      if (!records || records.length === 0) return false
      
      // 检查记录中是否包含id或userId字段，或缺少whitelist字段
      const record = records[0]
      return 'id' in record || 'userId' in record || !('whitelist' in record)
    } catch (error) {
      logger.error(`[初始化] 检查表结构失败: ${error.message}`)
      return false
    }
  }
  
  // 添加缺失字段
  const addMissingFields = async (): Promise<boolean> => {
    try {
      // 获取所有记录
      const records = await ctx.database.get('mcidbind', {})
      
      let updatedCount = 0
      
      // 更新每个缺少whitelist字段的记录
      for (const record of records) {
        if (!record.whitelist) {
          await ctx.database.set('mcidbind', { qqId: record.qqId }, {
            whitelist: []
          })
          updatedCount++
        }
      }
      
      if (updatedCount > 0) {
        logger.info(`[初始化] 成功为${updatedCount}条记录添加whitelist字段`)
      } else {
        logger.info(`[初始化] 所有记录都包含必要字段，无需更新`)
      }
      return true
    } catch (error) {
      logger.error(`[初始化] 添加缺失字段失败: ${error.message}`)
      return false
    }
  }
  
  // 重建MCIDBIND表
  const rebuildMcidBindTable = async () => {
    try {
      // 备份现有数据
      const oldRecords = await ctx.database.get('mcidbind', {})
      logger.info(`[初始化] 成功备份${oldRecords.length}条记录`)
      
      // 创建数据备份（用于恢复）
      const backupData = JSON.parse(JSON.stringify(oldRecords))
      
      try {
        // 提取有效数据
        const validRecords = oldRecords.map(record => {
          // 确保qqId存在
          if (!record.qqId) {
            // 如果没有qqId但有userId，尝试从userId提取
            if ('userId' in record && record.userId) {
              record.qqId = normalizeQQId(String(record.userId))
            } else {
              // 既没有qqId也没有userId，跳过此记录
              return null
            }
          }
          
          return {
            qqId: record.qqId,
            mcUsername: record.mcUsername || '',
            mcUuid: record.mcUuid || '',
            lastModified: record.lastModified || new Date(),
            isAdmin: record.isAdmin || false,
            whitelist: record.whitelist || []
          }
        }).filter(record => record !== null)
        
        // 删除现有表
        await ctx.database.remove('mcidbind', {})
        logger.info('[初始化] 成功删除旧表数据')
        
        // 重新创建记录
        let successCount = 0
        let errorCount = 0
        
        for (const record of validRecords) {
          try {
            await ctx.database.create('mcidbind', record)
            successCount++
          } catch (e) {
            errorCount++
            logger.warn(`[初始化] 重建记录失败 (QQ=${record.qqId}): ${e.message}`)
          }
        }
        
        logger.info(`[初始化] 成功重建了${successCount}条记录，失败${errorCount}条`)
        return true
      } catch (migrationError) {
        // 迁移过程出错，尝试恢复
        logger.error(`[初始化] 表重建过程失败，尝试恢复数据: ${migrationError.message}`)
        
        try {
          // 清空表以避免重复数据
          await ctx.database.remove('mcidbind', {})
          
          // 恢复原始数据
          for (const record of backupData) {
            await ctx.database.create('mcidbind', record)
          }
          
          logger.info(`[初始化] 成功恢复${backupData.length}条原始记录`)
        } catch (recoveryError) {
          logger.error(`[初始化] 数据恢复失败，可能导致数据丢失: ${recoveryError.message}`)
          throw new Error('数据迁移失败且无法恢复')
        }
        
        throw migrationError
      }
    } catch (error) {
      logger.error(`[初始化] 重建表失败: ${error.message}`)
      throw error
    }
  }

  // 处理用户ID，去除平台前缀，只保留QQ号
  const normalizeQQId = (userId: string): string => {
    // 处理空值情况
    if (!userId) {
      logger.warn(`[用户ID] 收到空用户ID`)
      return ''
    }
    
    // 如果包含冒号，说明有平台前缀(如 onebot:123456)
    const colonIndex = userId.indexOf(':')
    if (colonIndex !== -1) {
      // 返回冒号后面的部分，即纯QQ号
      return userId.substring(colonIndex + 1)
    }
    return userId
  }

  // 封装错误日志记录
  const logError = (context: string, userId: string, error: Error | string): void => {
    const errorMessage = error instanceof Error ? error.message : error
    const normalizedQQId = normalizeQQId(userId)
    logger.error(`[${context}] QQ(${normalizedQQId})操作失败: ${errorMessage}`)
  }

  // 获取用户友好的错误信息
  const getFriendlyErrorMessage = (error: Error | string): string => {
    const errorMsg = error instanceof Error ? error.message : error
    
    // 拆分错误信息
    const userError = getUserFacingErrorMessage(errorMsg);
    
    // 将警告级别错误标记出来
    if (isWarningError(userError)) {
      return `⚠️ ${userError}`;
    }
    
    // 将严重错误标记出来
    if (isCriticalError(userError)) {
      return `❌ ${userError}`;
    }
    
    return userError;
  }

  // 提取用户友好的错误信息
  const getUserFacingErrorMessage = (errorMsg: string): string => {
    // Mojang API相关错误
    if (errorMsg.includes('ECONNABORTED') || errorMsg.includes('timeout')) {
      return '无法连接到Mojang服务器，请稍后再试'
    }
    
    if (errorMsg.includes('404')) {
      return '该Minecraft用户名不存在'
    }
    
    if (errorMsg.includes('network') || errorMsg.includes('connect')) {
      return '网络连接异常，请稍后再试'
    }
    
    // 数据库相关错误
    if (errorMsg.includes('unique') || errorMsg.includes('duplicate')) {
      return '该Minecraft用户名已被其他用户绑定'
    }
    
    // RCON相关错误
    if (errorMsg.includes('RCON') || errorMsg.includes('服务器')) {
      if (errorMsg.includes('authentication') || errorMsg.includes('auth') || errorMsg.includes('认证')) {
        return 'RCON认证失败，服务器拒绝访问，请联系管理员检查密码'
      }
      if (errorMsg.includes('ECONNREFUSED') || errorMsg.includes('ETIMEDOUT') || errorMsg.includes('无法连接')) {
        return '无法连接到游戏服务器，请确认服务器是否在线或联系管理员'
      }
      if (errorMsg.includes('command') || errorMsg.includes('执行命令')) {
        return '服务器命令执行失败，请稍后再试'
      }
      return '与游戏服务器通信失败，请稍后再试'
    }
    
    // 用户名相关错误
    if (errorMsg.includes('用户名') || errorMsg.includes('username')) {
      if (errorMsg.includes('不存在')) {
        return '该Minecraft用户名不存在，请检查拼写'
      }
      if (errorMsg.includes('已被')) {
        return '该Minecraft用户名已被其他用户绑定，请使用其他用户名'
      }
      if (errorMsg.includes('格式')) {
        return 'Minecraft用户名格式不正确，应为3-16位字母、数字和下划线'
      }
      return '用户名验证失败，请检查用户名并重试'
    }
    
    // 默认错误信息
    return '操作失败，请稍后再试'
  }

  // 判断是否为警告级别错误（用户可能输入有误）
  const isWarningError = (errorMsg: string): boolean => {
    const warningPatterns = [
      '用户名不存在',
      '格式不正确',
      '已被其他用户绑定',
      '已在白名单中',
      '不在白名单中',
      '未绑定MC账号',
      '冷却期内'
    ];
    
    return warningPatterns.some(pattern => errorMsg.includes(pattern));
  }

  // 判断是否为严重错误（系统问题）
  const isCriticalError = (errorMsg: string): boolean => {
    const criticalPatterns = [
      '无法连接',
      'RCON认证失败',
      '服务器通信失败',
      '数据库操作出错'
    ];
    
    return criticalPatterns.some(pattern => errorMsg.includes(pattern));
  }

  // 封装发送消息的函数，处理私聊和群聊的不同格式
  const sendMessage = async (session: Session, content: any[]): Promise<void> => {
    try {
      if (!session) {
        logger.error(`[消息] 无效的会话对象`)
        return
      }
      
      // 处理私聊和群聊的消息格式
      const promptMessage = session.channelId?.startsWith('private:')
        ? [h.quote(session.messageId), ...content]
        : [h.quote(session.messageId), h.at(session.userId), '\n', ...content]

      // 发送消息并获取返回的消息ID
      const messageResult = await session.send(promptMessage)
      const normalizedQQId = normalizeQQId(session.userId)
      logger.debug(`[消息] 成功向QQ(${normalizedQQId})发送消息，频道: ${session.channelId}`)
      
      // 处理自动撤回
      if (config.autoRecallTime > 0 && messageResult && session.bot) {
        // 获取消息ID
        let messageId: string | undefined
        
        if (typeof messageResult === 'string') {
          messageId = messageResult
        } else if (Array.isArray(messageResult) && messageResult.length > 0) {
          messageId = messageResult[0]
        } else if (messageResult && typeof messageResult === 'object') {
          // 尝试提取各种可能的消息ID格式
          messageId = (messageResult as any).messageId || 
                   (messageResult as any).id || 
                   (messageResult as any).message_id
        }
        
        if (messageId) {
          // 设置定时器延迟撤回
          setTimeout(async () => {
            try {
              await session.bot.deleteMessage(session.channelId, messageId)
              logger.debug(`[消息] 成功撤回消息 ${messageId}`)
            } catch (recallError) {
              logger.error(`[消息] 撤回消息 ${messageId} 失败: ${recallError.message}`)
            }
          }, config.autoRecallTime * 1000)
          
          logger.debug(`[消息] 已设置 ${config.autoRecallTime} 秒后自动撤回消息 ${messageId}`)
        } else {
          logger.warn(`[消息] 无法获取消息ID，自动撤回功能无法生效`)
        }
      }
    } catch (error) {
      const normalizedUserId = normalizeQQId(session.userId)
      logger.error(`[消息] 向QQ(${normalizedUserId})发送消息失败: ${error.message}`)
    }
  }

  // 检查冷却时间
  const checkCooldown = (lastModified: Date | null): boolean => {
    if (!lastModified) return true
    const now = new Date()
    const diffTime = now.getTime() - lastModified.getTime()
    // 使用Math.floor确保冷却时间精确
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24))
    return diffDays >= config.cooldownDays
  }
  
  // 根据QQ号查询MCIDBIND表中的绑定信息
  const getMcBindByQQId = async (qqId: string): Promise<MCIDBIND | null> => {
    try {
      // 处理空值
      if (!qqId) {
        logger.warn(`[MCIDBIND] 尝试查询空QQ号`)
        return null
      }
      
      const normalizedQQId = normalizeQQId(qqId)
      // 查询MCIDBIND表中对应QQ号的绑定记录
      const binds = await ctx.database.get('mcidbind', { qqId: normalizedQQId })
      return binds.length > 0 ? binds[0] : null
    } catch (error) {
      logError('MCIDBIND', qqId, `根据QQ号查询绑定信息失败: ${error.message}`)
      return null
    }
  }
  
  // 根据MC用户名查询MCIDBIND表中的绑定信息
  const getMcBindByUsername = async (mcUsername: string): Promise<MCIDBIND | null> => {
    try {
      // 处理空值
      if (!mcUsername) {
        logger.warn(`[MCIDBIND] 尝试查询空MC用户名`)
        return null
      }
      
      // 查询MCIDBIND表中对应MC用户名的绑定记录
      const binds = await ctx.database.get('mcidbind', { mcUsername })
      return binds.length > 0 ? binds[0] : null
    } catch (error) {
      logError('MCIDBIND', 'system', `根据MC用户名(${mcUsername})查询绑定信息失败: ${error.message}`)
      return null
    }
  }
  
  // 根据QQ号确保获取完整的用户ID (处理纯QQ号的情况)
  const ensureFullUserId = (userId: string): string => {
    // 如果已经包含冒号，说明已经是完整的用户ID
    if (userId.includes(':')) return userId
    
    // 否则，检查是否为数字（纯QQ号）
    if (/^\d+$/.test(userId)) {
      // 默认使用onebot平台前缀
      return `onebot:${userId}`
    }
    
    // 如果不是数字也没有冒号，保持原样返回
    logger.warn(`[用户ID] 无法确定用户ID格式: ${userId}`)
    return userId
  }

  // 创建或更新MCIDBIND表中的绑定信息
  const createOrUpdateMcBind = async (userId: string, mcUsername: string, mcUuid: string, isAdmin?: boolean): Promise<boolean> => {
    try {
      // 验证输入参数
      if (!userId) {
        logger.error(`[MCIDBIND] 创建/更新绑定失败: 无效的用户ID`)
        return false
      }
      
      if (!mcUsername) {
        logger.error(`[MCIDBIND] 创建/更新绑定失败: 无效的MC用户名`)
        return false
      }
      
      const normalizedQQId = normalizeQQId(userId)
      if (!normalizedQQId) {
        logger.error(`[MCIDBIND] 创建/更新绑定失败: 无法提取有效的QQ号`)
        return false
      }
      
      // 查询是否已存在绑定记录
      let bind = await getMcBindByQQId(normalizedQQId)
      
      if (bind) {
        // 更新现有记录，但保留管理员状态
        const updateData: any = {
          mcUsername,
          mcUuid,
          lastModified: new Date()
        }
        
        // 仅当指定了isAdmin参数时更新管理员状态
        if (typeof isAdmin !== 'undefined') {
          updateData.isAdmin = isAdmin
        }
        
        await ctx.database.set('mcidbind', { qqId: normalizedQQId }, updateData)
        logger.info(`[MCIDBIND] 更新绑定: QQ=${normalizedQQId}, MC用户名=${mcUsername}, UUID=${mcUuid}`)
        return true
      } else {
        // 创建新记录
        try {
          await ctx.database.create('mcidbind', {
            qqId: normalizedQQId,
            mcUsername,
            mcUuid,
            lastModified: new Date(),
            isAdmin: isAdmin || false
          })
          logger.info(`[MCIDBIND] 创建绑定: QQ=${normalizedQQId}, MC用户名=${mcUsername}, UUID=${mcUuid}`)
          return true
        } catch (createError) {
          logError('MCIDBIND', userId, `创建绑定失败: MC用户名=${mcUsername}, 错误=${createError.message}`)
          return false
        }
      }
    } catch (error) {
      logError('MCIDBIND', userId, `创建/更新绑定失败: MC用户名=${mcUsername}, 错误=${error.message}`)
      return false
    }
  }
  
  // 删除MCIDBIND表中的绑定信息
  const deleteMcBind = async (userId: string): Promise<boolean> => {
    try {
      // 验证输入参数
      if (!userId) {
        logger.error(`[MCIDBIND] 删除绑定失败: 无效的用户ID`)
        return false
      }
      
      const normalizedQQId = normalizeQQId(userId)
      if (!normalizedQQId) {
        logger.error(`[MCIDBIND] 删除绑定失败: 无法提取有效的QQ号`)
        return false
      }
      
      // 查询是否存在绑定记录
      const bind = await getMcBindByQQId(normalizedQQId)
      
      if (bind) {
        // 删除绑定记录
        const result = await ctx.database.remove('mcidbind', { qqId: normalizedQQId })
        
        // 检查是否真正删除成功
        if (result) {
          logger.info(`[MCIDBIND] 删除绑定: QQ=${normalizedQQId}, MC用户名=${bind.mcUsername}`)
          return true
        } else {
          logger.warn(`[MCIDBIND] 删除绑定异常: QQ=${normalizedQQId}, 可能未实际删除`)
          return false
        }
      }
      
      logger.warn(`[MCIDBIND] 删除绑定失败: QQ=${normalizedQQId}不存在绑定记录`)
      return false
    } catch (error) {
      logError('MCIDBIND', userId, `删除绑定失败: 错误=${error.message}`)
      return false
    }
  }

  // 检查MC用户名是否已被其他QQ号绑定
  const checkUsernameExists = async (username: string, currentUserId?: string): Promise<boolean> => {
    try {
      // 验证输入参数
      if (!username) {
        logger.warn(`[绑定检查] 尝试检查空MC用户名`)
        return false
      }
      
      // 查询新表中是否已有此用户名的绑定
      const bind = await getMcBindByUsername(username)
      
      // 如果没有绑定，返回false
      if (!bind) return false
      
      // 如果提供了当前用户ID，需要排除当前用户
      if (currentUserId) {
        const normalizedCurrentId = normalizeQQId(currentUserId)
        // 如果绑定的用户就是当前用户，返回false，表示没有被其他用户绑定
        return normalizedCurrentId ? bind.qqId !== normalizedCurrentId : true
      }
      
      return true
    } catch (error) {
      logError('绑定检查', currentUserId || 'system', `检查用户名"${username}"是否已被绑定失败: ${error.message}`)
      return false
    }
  }

  // 使用Mojang API验证用户名并获取UUID
  const validateUsername = async (username: string): Promise<MojangProfile | null> => {
    try {
      logger.debug(`[Mojang API] 开始验证用户名: ${username}`)
      const response = await axios.get(`https://api.mojang.com/users/profiles/minecraft/${username}`, {
        timeout: 10000, // 添加10秒超时
        headers: {
          'User-Agent': 'KoishiMCVerifier/1.0', // 添加User-Agent头
        }
      })
      
      if (response.status === 200 && response.data) {
        logger.debug(`[Mojang API] 用户名"${username}"验证成功，UUID: ${response.data.id}，标准名称: ${response.data.name}`)
        return {
          id: response.data.id,
          name: response.data.name // 使用Mojang返回的正确大小写
        }
      }
     
      return null
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        logger.warn(`[Mojang API] 用户名"${username}"不存在`)
      } else if (axios.isAxiosError(error) && error.code === 'ECONNABORTED') {
        logger.error(`[Mojang API] 验证用户名"${username}"时请求超时: ${error.message}`)
      } else {
        // 记录更详细的错误信息
        const errorMessage = axios.isAxiosError(error) 
          ? `${error.message}，响应状态: ${error.response?.status || '未知'}\n响应数据: ${JSON.stringify(error.response?.data || '无数据')}`
          : error.message || '未知错误';
        logger.error(`[Mojang API] 验证用户名"${username}"时发生错误: ${errorMessage}`)
        
        // 如果是网络相关错误，尝试使用备用API检查
        if (axios.isAxiosError(error) && (
            error.code === 'ENOTFOUND' || 
            error.code === 'ETIMEDOUT' || 
            error.code === 'ECONNRESET' || 
            error.code === 'ECONNREFUSED' || 
            error.code === 'ECONNABORTED' || 
            error.response?.status === 429)) { // 添加429 (Too Many Requests)
          // 尝试使用playerdb.co作为备用API
          logger.info(`[Mojang API] 遇到错误(${error.code || error.response?.status})，将尝试使用备用API`)
          return tryBackupAPI(username);
        }
      }
      return null;
    }
  }

  // 使用备用API验证用户名
  const tryBackupAPI = async (username: string): Promise<MojangProfile | null> => {
    logger.info(`[备用API] 尝试使用备用API验证用户名"${username}"`)
    try {
      // 使用playerdb.co作为备用API
      const backupResponse = await axios.get(`https://playerdb.co/api/player/minecraft/${username}`, { 
        timeout: 10000,
        headers: {
          'User-Agent': 'KoishiMCVerifier/1.0'
        }
      })
      
      if (backupResponse.status === 200 && backupResponse.data?.code === "player.found") {
        const playerData = backupResponse.data.data.player;
        const rawId = playerData.raw_id || playerData.id.replace(/-/g, ''); // 确保使用不带连字符的UUID
        logger.info(`[备用API] 用户名"${username}"验证成功，UUID: ${rawId}，标准名称: ${playerData.username}`)
        return {
          id: rawId, // 确保使用不带连字符的UUID
          name: playerData.username
        }
      }
      logger.warn(`[备用API] 用户名"${username}"验证失败: ${JSON.stringify(backupResponse.data)}`)
      return null;
    } catch (backupError) {
      const errorMsg = axios.isAxiosError(backupError) 
        ? `${backupError.message}, 状态码: ${backupError.response?.status || '未知'}`
        : backupError.message || '未知错误';
      logger.error(`[备用API] 验证用户名"${username}"失败: ${errorMsg}`)
      return null;
    }
  }

  // 检查Crafatar头像URL是否有效（预防UUID无效的情况）
  const getCrafatarUrl = (uuid: string): string | null => {
    if (!uuid) return null
    
    // 检查UUID格式 (不带连字符应为32位，带连字符应为36位)
    const uuidRegex = /^[0-9a-f]{32}$|^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(uuid)) {
      logger.warn(`[头像] UUID "${uuid}" 格式无效，无法生成头像URL`)
      return null
    }
    
    // 移除任何连字符，Crafatar接受不带连字符的UUID
    const cleanUuid = uuid.replace(/-/g, '')
    
    // 检查缓存
    const currentTime = Date.now()
    if (avatarCache[cleanUuid] && (currentTime - avatarCache[cleanUuid].timestamp) < CACHE_DURATION) {
      logger.debug(`[头像] 从缓存获取UUID "${cleanUuid}" 的头像URL`)
      return avatarCache[cleanUuid].url
    }
    
    // 生成URL
    const url = `https://crafatar.com/avatars/${cleanUuid}?size=100&overlay`
    
    // 更新缓存
    avatarCache[cleanUuid] = {
      url,
      timestamp: currentTime
    }
    
    logger.debug(`[头像] 为UUID "${cleanUuid}" 生成新的头像URL并缓存`)
    return url
  }

  // 使用Starlight SkinAPI获取皮肤渲染
  const getStarlightSkinUrl = (username: string): string | null => {
    if (!username) return null
    
    // 可用的动作列表 (共16种)
    const poses = [
      'default',    // 默认站立
      'marching',   // 行军
      'walking',    // 行走
      'crouching',  // 下蹲
      'crossed',    // 交叉手臂
      'crisscross', // 交叉腿
      'cheering',   // 欢呼
      'relaxing',   // 放松
      'trudging',   // 艰难行走
      'cowering',   // 退缩
      'pointing',   // 指向
      'lunging',    // 前冲
      'dungeons',   // 地下城风格
      'facepalm',   // 捂脸
      'mojavatar',  // Mojave姿态
      'head',   // 头部特写
    ]
    
    // 随机选择一个动作
    const randomPose = poses[Math.floor(Math.random() * poses.length)]
    
    // 视图类型（full为全身图）
    const viewType = 'full'
    
    // 生成URL
    const url = `https://starlightskins.lunareclipse.studio/render/${randomPose}/${username}/${viewType}`
    
    logger.debug(`[Starlight皮肤] 为用户名"${username}"生成动作"${randomPose}"的渲染URL`)
    return url
  }

  // 格式化UUID (添加连字符，使其符合标准格式)
  const formatUuid = (uuid: string): string => {
    if (!uuid) return '未知'
    if (uuid.includes('-')) return uuid // 已经是带连字符的格式
    
    // 确保UUID长度正确
    if (uuid.length !== 32) {
      logger.warn(`[UUID] UUID "${uuid}" 长度异常，无法格式化`)
      return uuid
    }
    
    return `${uuid.substring(0, 8)}-${uuid.substring(8, 12)}-${uuid.substring(12, 16)}-${uuid.substring(16, 20)}-${uuid.substring(20)}`
  }

  // 检查是否为管理员 (QQ号作为主键检查)
  const isAdmin = async (userId: string): Promise<boolean> => {
    // 主人始终是管理员
    const normalizedMasterId = normalizeQQId(config.masterId)
    const normalizedQQId = normalizeQQId(userId)
    
    if (normalizedQQId === normalizedMasterId) return true
    
    // 查询MCIDBIND表中是否是管理员
    try {
      const bind = await getMcBindByQQId(normalizedQQId)
      return bind && bind.isAdmin === true
    } catch (error) {
      logger.error(`[权限检查] QQ(${normalizedQQId})的管理员状态查询失败: ${error.message}`)
      return false
    }
  }

  // 检查是否为主人 (QQ号作为主键检查)
  const isMaster = (qqId: string): boolean => {
    const normalizedMasterId = normalizeQQId(config.masterId)
    const normalizedQQId = normalizeQQId(qqId)
    return normalizedQQId === normalizedMasterId
  }

  // =========== MC命令组 ===========
  const cmd = ctx.command('mcid', 'Minecraft 账号绑定管理')

  // 自定义文本前缀匹配
  if (config.allowTextPrefix && config.botNickname) {
    // 创建一个前缀匹配器
    ctx.middleware((session, next) => {
      // 不处理没有内容的消息
      if (!session.content) return next()
      
      // 检查是否是命令开头，如果已经是命令就不处理
      if (session.content.startsWith('.') || session.content.startsWith('/')) {
        return next()
      }
      
      // 获取消息内容并规范化空格
      const content = session.content.trim()
      
      // 使用机器人昵称，支持多种匹配方式
      const botNickname = config.botNickname
      
      // 尝试识别以机器人昵称开头的mcid命令
      let mcidCommand = null
      
      // 1. 尝试匹配原始的botNickname格式
      const regularPrefixRegex = new RegExp(`^${escapeRegExp(botNickname)}\\s+(mcid\\s+.*)$`, 'i')
      const regularMatch = content.match(regularPrefixRegex)
      
      // 2. 如果botNickname不包含@，也尝试匹配带@的版本
      const atPrefixRegex = !botNickname.startsWith('@') ? 
        new RegExp(`^@${escapeRegExp(botNickname)}\\s+(mcid\\s+.*)$`, 'i') : 
        null
      
      if (regularMatch && regularMatch[1]) {
        mcidCommand = regularMatch[1].trim()
      } else if (atPrefixRegex) {
        const atMatch = content.match(atPrefixRegex)
        if (atMatch && atMatch[1]) {
          mcidCommand = atMatch[1].trim()
        }
      }
      
      // 如果找到匹配的mcid命令，执行它
      if (mcidCommand) {
        logger.info(`[前缀匹配] 成功识别mcid命令，原始消息: "${content}"，执行命令: "${mcidCommand}"`)
        
        // 使用session.execute方法主动触发命令执行
        session.execute(mcidCommand).catch(error => {
          logger.error(`[前缀匹配] 执行命令"${mcidCommand}"失败: ${error.message}`)
        })
        
        // 返回终止后续中间件处理，避免重复处理
        return 
      }
      
      return next()
    })
  }

  // 帮助函数：转义正则表达式中的特殊字符
  const escapeRegExp = (string: string): string => {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  // 查询MC账号命令
  cmd.subcommand('.query [target:user]', '查询用户绑定的MC账号')
    .action(async ({ session }, target) => {
      try {
        const normalizedUserId = normalizeQQId(session.userId)
        
        // 如果指定了目标用户
        if (target) {
          const normalizedTargetId = normalizeQQId(target)
          logger.info(`[查询] QQ(${normalizedUserId})查询QQ(${normalizedTargetId})的MC账号信息`)
          
          // 查询目标用户的MC账号 - 使用MCIDBIND表
          const targetBind = await getMcBindByQQId(normalizedTargetId)
          if (!targetBind || !targetBind.mcUsername) {
            logger.info(`[查询] QQ(${normalizedTargetId})未绑定MC账号`)
            return sendMessage(session, [h.text(`该用户尚未绑定MC账号`)])
          }
          
          // 检查并更新用户名（如果变更）
          const updatedBind = await checkAndUpdateUsername(targetBind);
          
          const formattedUuid = formatUuid(updatedBind.mcUuid)
          // 获取皮肤渲染URL
          const skinUrl = getStarlightSkinUrl(updatedBind.mcUsername)
          
          // 添加获取白名单服务器信息
          let whitelistInfo = '';
          if (updatedBind.whitelist && updatedBind.whitelist.length > 0) {
            // 圈数字映射（1-10），用于美化显示
            const circledNumbers = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];
            
            const serverList = updatedBind.whitelist.map((serverId, index) => {
              const server = getServerConfigById(serverId);
              if (!server) return `${index < circledNumbers.length ? circledNumbers[index] : (index+1)} 未知服务器(ID: ${serverId})`;
              
              // 使用圈数字作为序号
              const circledNumber = index < circledNumbers.length ? circledNumbers[index] : `${index+1}`;
              let info = `${circledNumber} ${server.name}`;
              
              // 只有当设置了地址时才显示地址行
              if (server.displayAddress && server.displayAddress.trim()) {
                info += `\n   地址: ${server.displayAddress}`;
              }
              return info;
            }).join('\n');
            
            whitelistInfo = `\n已加入以下服务器的白名单:\n${serverList}`;
          } else {
            whitelistInfo = '\n未加入任何服务器的白名单';
          }
          
          logger.info(`[查询] QQ(${normalizedTargetId})的MC账号信息：用户名=${updatedBind.mcUsername}, UUID=${updatedBind.mcUuid}`)
          return sendMessage(session, [
            h.text(`用户 ${normalizedTargetId} 的MC账号信息：\n用户名: ${updatedBind.mcUsername}\nUUID: ${formattedUuid}${whitelistInfo}`),
            ...(skinUrl ? [h.image(skinUrl)] : [])
          ])
        }
        
        // 查询自己的MC账号
        logger.info(`[查询] QQ(${normalizedUserId})查询自己的MC账号信息`)
        const selfBind = await getMcBindByQQId(normalizedUserId)
        
        if (!selfBind || !selfBind.mcUsername) {
          logger.info(`[查询] QQ(${normalizedUserId})未绑定MC账号`)
          return sendMessage(session, [h.text(`您尚未绑定MC账号，请使用 ` + formatCommand('mcid bind <用户名>') + ` 进行绑定`)])
        }
        
        // 检查并更新用户名（如果变更）
        const updatedBind = await checkAndUpdateUsername(selfBind);
        
        const formattedUuid = formatUuid(updatedBind.mcUuid)
        // 获取皮肤渲染URL
        const skinUrl = getStarlightSkinUrl(updatedBind.mcUsername)
        
        // 添加获取白名单服务器信息
        let whitelistInfo = '';
        if (updatedBind.whitelist && updatedBind.whitelist.length > 0) {
          // 圈数字映射（1-10），用于美化显示
          const circledNumbers = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];
          
          const serverList = updatedBind.whitelist.map((serverId, index) => {
            const server = getServerConfigById(serverId);
            if (!server) return `${index < circledNumbers.length ? circledNumbers[index] : (index+1)} 未知服务器(ID: ${serverId})`;
            
            // 使用圈数字作为序号
            const circledNumber = index < circledNumbers.length ? circledNumbers[index] : `${index+1}`;
            let info = `${circledNumber} ${server.name}`;
            
            // 只有当设置了地址时才显示地址行
            if (server.displayAddress && server.displayAddress.trim()) {
              info += `\n   地址: ${server.displayAddress}`;
            }
            return info;
          }).join('\n');
          
          whitelistInfo = `\n已加入以下服务器的白名单:\n${serverList}`;
        } else {
          whitelistInfo = '\n未加入任何服务器的白名单';
        }
        
        logger.info(`[查询] QQ(${normalizedUserId})的MC账号信息：用户名=${updatedBind.mcUsername}, UUID=${updatedBind.mcUuid}`)
        return sendMessage(session, [
          h.text(`您的MC账号信息：\n用户名: ${updatedBind.mcUsername}\nUUID: ${formattedUuid}${whitelistInfo}`),
          ...(skinUrl ? [h.image(skinUrl)] : [])
        ])
      } catch (error) {
        const normalizedUserId = normalizeQQId(session.userId)
        logger.error(`[查询] QQ(${normalizedUserId})查询MC账号失败: ${error.message}`)
        return sendMessage(session, [h.text(`查询失败: ${error.message}`)])
      }
    })

  // 绑定MC账号命令
  cmd.subcommand('.bind <username:string> [target:user]', '绑定MC账号')
    .action(async ({ session }, username, target) => {
      try {
        const normalizedUserId = normalizeQQId(session.userId)
        
        // 检查用户名格式
        if (!username || !/^[a-zA-Z0-9_]{3,16}$/.test(username)) {
          logger.warn(`[绑定] QQ(${normalizedUserId})提供的用户名"${username}"格式无效`)
          return sendMessage(session, [h.text('请提供有效的Minecraft用户名（3-16位字母、数字、下划线）')])
        }

        // 验证用户名是否存在
        const profile = await validateUsername(username)
        if (!profile) {
          logger.warn(`[绑定] QQ(${normalizedUserId})提供的用户名"${username}"不存在`)
          return sendMessage(session, [h.text(`无法验证用户名: ${username}，该用户可能不存在`)])
        }

        // 使用Mojang返回的正确大小写
        username = profile.name
        const uuid = profile.id

        // 如果指定了目标用户（管理员功能）
        if (target) {
          const normalizedTargetId = normalizeQQId(target)
          logger.info(`[绑定] QQ(${normalizedUserId})尝试为QQ(${normalizedTargetId})绑定MC账号: ${username}(${uuid})`)
          
          // 检查权限
          if (!await isAdmin(session.userId)) {
            logger.warn(`[绑定] 权限不足: QQ(${normalizedUserId})不是管理员，无法为QQ(${normalizedTargetId})绑定MC账号`)
            return sendMessage(session, [h.text('只有管理员才能为其他用户绑定MC账号')])
          }

          // 检查用户名是否已被除目标用户以外的其他用户绑定
          if (await checkUsernameExists(username, target)) {
            logger.warn(`[绑定] MC用户名"${username}"已被其他QQ号绑定`)
            return sendMessage(session, [h.text(`用户名 ${username} 已被其他用户绑定`)])
          }

          // 获取目标用户MCIDBIND信息
          const targetBind = await getMcBindByQQId(normalizedTargetId)
          
          if (targetBind && targetBind.mcUsername) {
            logger.info(`[绑定] QQ(${normalizedTargetId})已绑定MC账号"${targetBind.mcUsername}"，将被覆盖为"${username}"`)
          }
          
          // 创建或更新绑定记录
          const bindResult = await createOrUpdateMcBind(target, username, uuid)
          
          // 检查绑定结果
          if (!bindResult) {
            logger.error(`[绑定] 管理员QQ(${normalizedUserId})为QQ(${normalizedTargetId})绑定MC账号"${username}"失败: 数据库操作失败`)
            return sendMessage(session, [h.text(`为用户 ${normalizedTargetId} 绑定MC账号失败: 数据库操作出错，请联系管理员`)])
          }
          
          logger.info(`[绑定] 成功: 管理员QQ(${normalizedUserId})为QQ(${normalizedTargetId})绑定MC账号: ${username}(${uuid})`)
          
          // 获取皮肤渲染URL
          const skinUrl = getStarlightSkinUrl(username)
          const formattedUuid = formatUuid(uuid)
          
          return sendMessage(session, [
            h.text(`已成功为用户 ${normalizedTargetId} 绑定MC账号\n用户名: ${username}\nUUID: ${formattedUuid}`),
            ...(skinUrl ? [h.image(skinUrl)] : [])
          ])
        }
        
        // 为自己绑定MC账号
        logger.info(`[绑定] QQ(${normalizedUserId})尝试绑定MC账号: ${username}(${uuid})`)
        
        // 检查用户是否已绑定
        const selfBind = await getMcBindByQQId(normalizedUserId)
        if (selfBind && selfBind.mcUsername) {
          // 如果当前绑定的是临时用户名（以_temp_开头），则允许直接使用bind命令
          const isTempUsername = selfBind.mcUsername.startsWith('_temp_');
          
          if (!isTempUsername) {
            // 检查是否是管理员或是否在冷却时间内
            if (!await isAdmin(session.userId) && !checkCooldown(selfBind.lastModified)) {
              const days = config.cooldownDays
              const now = new Date()
              const diffTime = now.getTime() - selfBind.lastModified.getTime()
              const passedDays = Math.floor(diffTime / (1000 * 60 * 60 * 24))
              const remainingDays = days - passedDays
              
              logger.warn(`[绑定] QQ(${normalizedUserId})已绑定MC账号"${selfBind.mcUsername}"，且在冷却期内，还需${remainingDays}天`)
              return sendMessage(session, [h.text(`您已绑定MC账号: ${selfBind.mcUsername}，如需修改，请在冷却期结束后(还需${remainingDays}天)使用 ` + formatCommand('mcid change') + ` 命令或联系管理员。`)])
            }
            logger.info(`[绑定] QQ(${normalizedUserId})已绑定MC账号"${selfBind.mcUsername}"，建议使用change命令`)
            return sendMessage(session, [h.text(`您已绑定MC账号: ${selfBind.mcUsername}，如需修改请使用 ` + formatCommand('mcid change') + ` 命令。`)])
          } else {
            // 临时用户名，允许直接绑定，记录日志
            logger.info(`[绑定] QQ(${normalizedUserId})之前绑定的是临时用户名"${selfBind.mcUsername}"，允许直接使用bind命令`)
          }
        }

        // 检查用户名是否已被绑定
        if (await checkUsernameExists(username)) {
          logger.warn(`[绑定] MC用户名"${username}"已被其他QQ号绑定`)
          return sendMessage(session, [h.text(`用户名 ${username} 已被其他用户绑定`)])
        }

        // 创建新绑定
        const bindResult = await createOrUpdateMcBind(session.userId, username, uuid)
        
        // 检查绑定结果
        if (!bindResult) {
          logger.error(`[绑定] QQ(${normalizedUserId})绑定MC账号"${username}"失败: 数据库操作失败`)
          return sendMessage(session, [h.text('绑定失败，数据库操作出错，请联系管理员')])
        }
        
        logger.info(`[绑定] 成功: QQ(${normalizedUserId})绑定MC账号: ${username}(${uuid})`)
        
        // 获取皮肤渲染URL
        const skinUrl = getStarlightSkinUrl(username)
        const formattedUuid = formatUuid(uuid)
        
        return sendMessage(session, [
          h.text(`已成功绑定MC账号\n用户名: ${username}\nUUID: ${formattedUuid}`),
          ...(skinUrl ? [h.image(skinUrl)] : [])
        ])
      } catch (error) {
        const normalizedUserId = normalizeQQId(session.userId)
        logger.error(`[绑定] QQ(${normalizedUserId})绑定MC账号"${username}"失败: ${error.message}`)
        return sendMessage(session, [h.text(getFriendlyErrorMessage(error))])
      }
    })

  // 修改MC账号命令
  cmd.subcommand('.change <username:string> [target:user]', '修改绑定的MC账号')
    .action(async ({ session }, username, target) => {
      try {
        const normalizedUserId = normalizeQQId(session.userId)
        
        // 检查用户名格式
        if (!username || !/^[a-zA-Z0-9_]{3,16}$/.test(username)) {
          logger.warn(`[修改] QQ(${normalizedUserId})提供的用户名"${username}"格式无效`)
          return sendMessage(session, [h.text('请提供有效的Minecraft用户名（3-16位字母、数字、下划线）')])
        }

        // 验证用户名是否存在
        const profile = await validateUsername(username)
        if (!profile) {
          logger.warn(`[修改] QQ(${normalizedUserId})提供的用户名"${username}"不存在`)
          return sendMessage(session, [h.text(`无法验证用户名: ${username}，该用户可能不存在`)])
        }

        // 使用Mojang返回的正确大小写
        username = profile.name
        const uuid = profile.id
        
        // 如果指定了目标用户（管理员功能）
        if (target) {
          const normalizedTargetId = normalizeQQId(target)
          logger.info(`[修改] QQ(${normalizedUserId})尝试修改QQ(${normalizedTargetId})的MC账号为: ${username}(${uuid})`)
          
          // 检查权限
          if (!await isAdmin(session.userId)) {
            logger.warn(`[修改] 权限不足: QQ(${normalizedUserId})不是管理员，无法修改QQ(${normalizedTargetId})的MC账号`)
            return sendMessage(session, [h.text('只有管理员才能修改其他用户的MC账号')])
          }
          
          // 获取目标用户MCIDBIND信息
          const targetBind = await getMcBindByQQId(normalizedTargetId)
          
          if (!targetBind || !targetBind.mcUsername) {
            logger.warn(`[修改] QQ(${normalizedTargetId})尚未绑定MC账号，无法修改`)
            return sendMessage(session, [h.text(`用户 ${normalizedTargetId} 尚未绑定MC账号，请先使用 ` + formatCommand('mcid bind') + ` 命令进行绑定`)])
          }
          
          // 检查是否与当前用户名相同
          if (targetBind.mcUsername === username) {
            logger.warn(`[修改] QQ(${normalizedTargetId})已绑定相同的MC账号"${username}"`)
            return sendMessage(session, [h.text(`用户 ${normalizedTargetId} 当前已绑定此用户名: ${username}`)])
          }
          
          // 检查用户名是否已被绑定
          if (await checkUsernameExists(username, target)) {
            logger.warn(`[修改] MC用户名"${username}"已被其他QQ号绑定`)
            return sendMessage(session, [h.text(`用户名 ${username} 已被其他用户绑定`)])
          }
          
          const oldUsername = targetBind.mcUsername
          
          // 更新绑定信息
          const bindResult = await createOrUpdateMcBind(target, username, uuid)
          
          // 检查绑定结果
          if (!bindResult) {
            logger.error(`[修改] 管理员QQ(${normalizedUserId})修改QQ(${normalizedTargetId})的MC账号失败: 数据库操作失败`)
            return sendMessage(session, [h.text(`修改用户 ${normalizedTargetId} 的MC账号失败: 数据库操作出错，请联系管理员`)])
          }
          
          logger.info(`[修改] 成功: 管理员QQ(${normalizedUserId})修改QQ(${normalizedTargetId})的MC账号: ${oldUsername} -> ${username}(${uuid})`)
          
          // 获取皮肤渲染URL
          const skinUrl = getStarlightSkinUrl(username)
          const formattedUuid = formatUuid(uuid)
          
          return sendMessage(session, [
            h.text(`已成功将用户 ${normalizedTargetId} 的MC账号从 ${oldUsername} 修改为 ${username}\nUUID: ${formattedUuid}`),
            ...(skinUrl ? [h.image(skinUrl)] : [])
          ])
        }

        // 从MCIDBIND表中查询用户绑定
        const selfBind = await getMcBindByQQId(normalizedUserId)
        
        // 检查是否已绑定
        if (!selfBind || !selfBind.mcUsername) {
          logger.warn(`[修改] QQ(${normalizedUserId})尚未绑定MC账号，无法修改`)
          return sendMessage(session, [h.text('您尚未绑定MC账号，请使用 ' + formatCommand('mcid bind') + ' 命令进行绑定')])
        }

        // 检查是否与当前用户名相同
        if (selfBind.mcUsername === username) {
          logger.warn(`[修改] QQ(${normalizedUserId})已绑定相同的MC账号"${username}"`)
          return sendMessage(session, [h.text(`您当前已绑定此用户名: ${username}`)])
        }

        // 检查冷却时间
        if (!await isAdmin(session.userId) && !checkCooldown(selfBind.lastModified)) {
          const days = config.cooldownDays
          const now = new Date()
          const diffTime = now.getTime() - selfBind.lastModified.getTime()
          const passedDays = Math.floor(diffTime / (1000 * 60 * 60 * 24))
          const remainingDays = days - passedDays
          
          logger.warn(`[修改] QQ(${normalizedUserId})在冷却期内，无法修改MC账号，还需${remainingDays}天`)
          return sendMessage(session, [h.text(`您的MC账号绑定在冷却期内，还需${remainingDays}天才能修改。如需立即修改，请联系管理员。`)])
        }

        // 检查用户名是否已被绑定
        if (await checkUsernameExists(username, session.userId)) {
          logger.warn(`[修改] MC用户名"${username}"已被其他QQ号绑定`)
          return sendMessage(session, [h.text(`用户名 ${username} 已被其他用户绑定`)])
        }

        const oldUsername = selfBind.mcUsername
        
        // 更新绑定信息
        const bindResult = await createOrUpdateMcBind(session.userId, username, uuid)
        
        // 检查绑定结果
        if (!bindResult) {
          logger.error(`[修改] QQ(${normalizedUserId})修改MC账号失败: 数据库操作失败`)
          return sendMessage(session, [h.text('修改失败，数据库操作出错，请联系管理员')])
        }
        
        logger.info(`[修改] 成功: QQ(${normalizedUserId})修改MC账号: ${oldUsername} -> ${username}(${uuid})`)
        
        // 获取皮肤渲染URL
        const skinUrl = getStarlightSkinUrl(username)
        const formattedUuid = formatUuid(uuid)
        
        return sendMessage(session, [
          h.text(`已成功将MC账号从 ${oldUsername} 修改为 ${username}\nUUID: ${formattedUuid}`),
          ...(skinUrl ? [h.image(skinUrl)] : [])
        ])
      } catch (error) {
        const normalizedUserId = normalizeQQId(session.userId)
        logger.error(`[修改] QQ(${normalizedUserId})修改MC账号为"${username}"失败: ${error.message}`)
        return sendMessage(session, [h.text(getFriendlyErrorMessage(error))])
      }
    })

  // 解绑MC账号命令
  cmd.subcommand('.unbind [target:user]', '[管理员]解绑MC账号')
    .action(async ({ session }, target) => {
      try {
        const normalizedUserId = normalizeQQId(session.userId)
        
        // 如果指定了目标用户（管理员功能）
        if (target) {
          const normalizedTargetId = normalizeQQId(target)
          logger.info(`[解绑] QQ(${normalizedUserId})尝试为QQ(${normalizedTargetId})解绑MC账号`)
          
          // 检查权限
          if (!await isAdmin(session.userId)) {
            logger.warn(`[解绑] 权限不足: QQ(${normalizedUserId})不是管理员，无法为QQ(${normalizedTargetId})解绑MC账号`)
            return sendMessage(session, [h.text('只有管理员才能为其他用户解绑MC账号')])
          }

          // 获取目标用户信息 - 从MCIDBIND表
          const targetBind = await getMcBindByQQId(normalizedTargetId)
          
          if (!targetBind || !targetBind.mcUsername) {
            logger.warn(`[解绑] QQ(${normalizedTargetId})尚未绑定MC账号`)
            return sendMessage(session, [h.text(`用户 ${normalizedTargetId} 尚未绑定MC账号`)])
          }

          const oldUsername = targetBind.mcUsername
          
          // 删除绑定记录
          await deleteMcBind(target)
          
          logger.info(`[解绑] 成功: 管理员QQ(${normalizedUserId})为QQ(${normalizedTargetId})解绑MC账号: ${oldUsername}`)
          return sendMessage(session, [h.text(`已成功为用户 ${normalizedTargetId} 解绑MC账号: ${oldUsername}`)])
        }
        
        // 为自己解绑MC账号
        logger.info(`[解绑] QQ(${normalizedUserId})尝试解绑自己的MC账号`)
        
        // 从MCIDBIND表获取绑定信息
        const selfBind = await getMcBindByQQId(normalizedUserId)
        
        if (!selfBind || !selfBind.mcUsername) {
          logger.warn(`[解绑] QQ(${normalizedUserId})尚未绑定MC账号`)
          return sendMessage(session, [h.text('您尚未绑定MC账号')])
        }

        // 移除冷却时间检查，解绑操作不受冷却时间限制
        const oldUsername = selfBind.mcUsername
        
        // 删除绑定记录
        await deleteMcBind(normalizedUserId)
        
        logger.info(`[解绑] 成功: QQ(${normalizedUserId})解绑MC账号: ${oldUsername}`)
        return sendMessage(session, [h.text(`已成功解绑MC账号: ${oldUsername}`)])
      } catch (error) {
        const normalizedUserId = normalizeQQId(session.userId)
        const targetInfo = target ? `为QQ(${normalizeQQId(target)})` : ''
        logger.error(`[解绑] QQ(${normalizedUserId})${targetInfo}解绑MC账号失败: ${error.message}`)
        return sendMessage(session, [h.text(getFriendlyErrorMessage(error))])
      }
    })
    
  // 管理员管理命令
  cmd.subcommand('.admin <target:user>', '[主人]将用户设为管理员')
    .action(async ({ session }, target) => {
      try {
        const normalizedUserId = normalizeQQId(session.userId)
        const normalizedTargetId = normalizeQQId(target)
        logger.info(`[管理员] QQ(${normalizedUserId})尝试将QQ(${normalizedTargetId})设为管理员`)
        
        // 检查是否为主人
        if (!isMaster(session.userId)) {
          logger.warn(`[管理员] 权限不足: QQ(${normalizedUserId})不是主人，无法设置管理员`)
          return sendMessage(session, [h.text('只有主人才能设置管理员')])
        }
        
        // 检查目标用户是否已经是管理员
        const targetBind = await getMcBindByQQId(normalizedTargetId)
        const isAlreadyAdmin = targetBind && targetBind.isAdmin === true
        
        if (isAlreadyAdmin) {
          logger.warn(`[管理员] QQ(${normalizedTargetId})已经是管理员`)
          return sendMessage(session, [h.text(`用户 ${normalizedTargetId} 已经是管理员`)])
        }
        
        // 如果用户存在绑定记录，更新为管理员
        if (targetBind) {
          await ctx.database.set('mcidbind', { qqId: normalizedTargetId }, {
            isAdmin: true,
          })
          
          logger.info(`[管理员] 成功: 主人QQ(${normalizedUserId})将QQ(${normalizedTargetId})设为管理员`)
          return sendMessage(session, [h.text(`已成功将用户 ${normalizedTargetId} 设为管理员`)])
        } else {
          // 用户不存在绑定记录，创建一个新记录并设为管理员
          // 为了避免空用户名的唯一性约束问题，使用QQ号作为临时用户名前缀
          const tempUsername = `_temp_${normalizedTargetId}`
          try {
            await ctx.database.create('mcidbind', {
              qqId: normalizedTargetId,
              mcUsername: tempUsername, // 使用临时用户名
              mcUuid: '',
              lastModified: new Date(),
              isAdmin: true
            })
            
            logger.info(`[管理员] 成功: 主人QQ(${normalizedUserId})将QQ(${normalizedTargetId})设为管理员 (创建新记录)`)
            return sendMessage(session, [h.text(`已成功将用户 ${normalizedTargetId} 设为管理员 (未绑定MC账号)`)])
          } catch (createError) {
            logger.error(`[管理员] 创建管理员记录失败: ${createError.message}`)
            return sendMessage(session, [h.text(getFriendlyErrorMessage(createError))])
          }
        }
      } catch (error) {
        const normalizedUserId = normalizeQQId(session.userId)
        const normalizedTargetId = normalizeQQId(target)
        logger.error(`[管理员] QQ(${normalizedUserId})将QQ(${normalizedTargetId})设为管理员失败: ${error.message}`)
        return sendMessage(session, [h.text(getFriendlyErrorMessage(error))])
      }
    })

  // 撤销管理员命令
  cmd.subcommand('.unadmin <target:user>', '[主人]撤销用户的管理员权限')
    .action(async ({ session }, target) => {
      try {
        const normalizedUserId = normalizeQQId(session.userId)
        const normalizedTargetId = normalizeQQId(target)
        logger.info(`[管理员] QQ(${normalizedUserId})尝试撤销QQ(${normalizedTargetId})的管理员权限`)
        
        // 检查是否为主人
        if (!isMaster(session.userId)) {
          logger.warn(`[管理员] 权限不足: QQ(${normalizedUserId})不是主人，无法撤销管理员权限`)
          return sendMessage(session, [h.text('只有主人才能撤销管理员权限')])
        }
        
        // 检查目标用户是否是管理员
        const targetBind = await getMcBindByQQId(normalizedTargetId)
        const isAdmin = targetBind && targetBind.isAdmin === true
        
        if (!isAdmin) {
          logger.warn(`[管理员] QQ(${normalizedTargetId})不是管理员`)
          return sendMessage(session, [h.text(`用户 ${normalizedTargetId} 不是管理员`)])
        }
        
        // 撤销管理员权限
        await ctx.database.set('mcidbind', { qqId: normalizedTargetId }, {
          isAdmin: false,
        })
        
        logger.info(`[管理员] 成功: 主人QQ(${normalizedUserId})撤销了QQ(${normalizedTargetId})的管理员权限`)
        return sendMessage(session, [h.text(`已成功撤销用户 ${normalizedTargetId} 的管理员权限`)])
      } catch (error) {
        const normalizedUserId = normalizeQQId(session.userId)
        const normalizedTargetId = normalizeQQId(target)
        logger.error(`[管理员] QQ(${normalizedUserId})撤销QQ(${normalizedTargetId})的管理员权限失败: ${error.message}`)
        return sendMessage(session, [h.text(getFriendlyErrorMessage(error))])
      }
    })

  // 列出所有管理员命令
  cmd.subcommand('.adminlist', '[主人]列出所有管理员')
    .action(async ({ session }) => {
      try {
        const normalizedUserId = normalizeQQId(session.userId)
        logger.info(`[管理员] QQ(${normalizedUserId})尝试查看管理员列表`)
        
        // 检查是否为主人
        if (!isMaster(session.userId)) {
          logger.warn(`[管理员] 权限不足: QQ(${normalizedUserId})不是主人，无法查看管理员列表`)
          return sendMessage(session, [h.text('只有主人才能查看管理员列表')])
        }
        
        // 查询所有管理员
        const admins = await ctx.database.get('mcidbind', { isAdmin: true })
        
        if (admins.length === 0) {
          logger.info(`[管理员] 管理员列表为空`)
          return sendMessage(session, [h.text('当前没有管理员')])
        }
        
        // 格式化管理员列表
        const adminList = admins.map(admin => {
          return `- ${admin.qqId}${admin.mcUsername ? ` (MC: ${admin.mcUsername})` : ''}`
        }).join('\n')
        
        logger.info(`[管理员] 成功: 主人QQ(${normalizedUserId})查看了管理员列表`)
        return sendMessage(session, [h.text(`管理员列表:\n${adminList}\n\n共 ${admins.length} 名管理员`)])
      } catch (error) {
        const normalizedUserId = normalizeQQId(session.userId)
        logger.error(`[管理员] QQ(${normalizedUserId})查看管理员列表失败: ${error.message}`)
        return sendMessage(session, [h.text(getFriendlyErrorMessage(error))])
      }
    })

  // =========== RCON白名单功能 ===========
  
  // 根据服务器ID获取服务器配置
  const getServerConfigById = (serverId: string): ServerConfig | null => {
    if (!config.servers || !Array.isArray(config.servers)) return null
    return config.servers.find(server => server.id === serverId && (server.enabled !== false)) || null
  }
  
  // 根据服务器名称获取服务器配置
  const getServerConfigByName = (serverName: string): ServerConfig | null => {
    if (!config.servers || !Array.isArray(config.servers)) return null
    
    // 过滤出启用的服务器
    const enabledServers = config.servers.filter(server => server.enabled !== false)
    
    // 尝试精确匹配
    let server = enabledServers.find(server => server.name === serverName)
    
    // 如果精确匹配失败，尝试模糊匹配
    if (!server) {
      const lowerServerName = serverName.toLowerCase().trim();
      
      // 最小相似度阈值，低于此值的匹配结果将被忽略
      const MIN_SIMILARITY = 0.6; // 60%的相似度
      
      // 首先尝试包含关系匹配（A包含于B，或B包含于A）
      const containsMatches = enabledServers.filter(server => 
        server.name.toLowerCase().includes(lowerServerName) || 
        lowerServerName.includes(server.name.toLowerCase())
      );
      
      if (containsMatches.length === 1) {
        // 如果只有一个匹配，验证相似度是否达到阈值
        const similarity = similarityScore(containsMatches[0].name.toLowerCase(), lowerServerName);
        if (similarity >= MIN_SIMILARITY) {
          // 相似度达到阈值，返回匹配结果
          server = containsMatches[0];
        }
      } else if (containsMatches.length > 1) {
        // 如果有多个匹配，计算相似度并选择最接近的一个
        let bestServer = null;
        let bestSimilarity = 0;
        
        for (const candidate of containsMatches) {
          const similarity = similarityScore(candidate.name.toLowerCase(), lowerServerName);
          // 记录最佳匹配（相似度最高且达到阈值）
          if (similarity > bestSimilarity && similarity >= MIN_SIMILARITY) {
            bestSimilarity = similarity;
            bestServer = candidate;
          }
        }
        
        server = bestServer;
      }
    }
    
    return server || null
  }
  
  // 计算两个字符串的相似度（改进版）
  const similarityScore = (a: string, b: string): number => {
    // 如果两个字符串相同，直接返回1
    if (a === b) return 1;
    
    // 如果长度为0，返回0
    if (a.length === 0 || b.length === 0) return 0;
    
    // 如果一个字符串完全包含另一个字符串，计算其占比
    if (a.includes(b)) {
      return b.length / a.length;
    }
    if (b.includes(a)) {
      return a.length / b.length;
    }
    
    // 否则计算Levenshtein距离的相似度
    const maxLength = Math.max(a.length, b.length);
    const editDistance = levenshteinDistance(a, b);
    
    return 1 - (editDistance / maxLength);
  }
  
  // 计算Levenshtein距离
  const levenshteinDistance = (a: string, b: string): number => {
    const matrix = [];
    
    // 初始化矩阵
    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }
    
    // 填充矩阵
    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1, // 替换
            matrix[i][j - 1] + 1,     // 插入
            matrix[i - 1][j] + 1      // 删除
          );
        }
      }
    }
    
    return matrix[b.length][a.length];
  }
  
  // 使用RCON执行Minecraft命令
  const executeRconCommand = async (server: ServerConfig, command: string): Promise<string> => {
    const serverId = server.id;
    
    // 检查是否是添加白名单命令
    const isAddCommand = command.includes(server.addCommand.replace(/\${MCID}/g, ''));
    
    // 对添加白名单命令进行限流
    if (isAddCommand) {
      if (!rconRateLimiter.canMakeRequest(serverId)) {
        logger.warn(`[RCON管理器] 服务器 ${server.name} 请求过于频繁，请稍后再试`);
        throw new Error('请求过于频繁，请稍后再试');
      }
      
      // 记录本次请求
      rconRateLimiter.recordRequest(serverId);
    }
    
    // 在锁内执行RCON命令，确保同一服务器的操作串行化
    return withLock(`rcon_${serverId}`, async () => {
    try {
      // 使用RCON管理器执行命令
      return await rconManager.executeCommand(server, command);
    } catch (error) {
      logger.error(`[RCON] 执行命令失败: ${error.message}`);
      throw error;
    }
    }, 10000); // 10秒超时
  };
  
  // 添加服务器白名单
  const addServerWhitelist = async (mcBind: MCIDBIND, server: ServerConfig): Promise<boolean> => {
    // 使用用户+服务器ID作为锁键，确保精细粒度控制
    const lockKey = `whitelist_${mcBind.qqId}_${server.id}`;
    
    return withLock(lockKey, async () => {
    try {
      if (!mcBind || !mcBind.mcUsername) {
        logger.warn(`[白名单] 尝试为未绑定MC账号的用户添加白名单`)
        return false
      }
        
        // 重新获取最新的用户绑定信息，确保操作基于最新状态
        const freshBind = await getMcBindByQQId(mcBind.qqId);
        if (!freshBind || !freshBind.mcUsername) {
          logger.warn(`[白名单] 用户QQ(${mcBind.qqId})可能在操作过程中解绑了MC账号`);
          return false;
        }
        
        // 检查最新状态是否已在白名单中
        if (freshBind.whitelist && freshBind.whitelist.includes(server.id)) {
          logger.info(`[白名单] 用户QQ(${mcBind.qqId})已在服务器${server.name}的白名单中`);
          return true;
        }
      
      // 判断使用用户名还是UUID
      let mcid: string
      if (server.idType === 'uuid') {
          if (!freshBind.mcUuid) {
          logger.warn(`[白名单] 用户缺少UUID信息，无法添加白名单`)
          return false
        }
        // 提取UUID并确保无论输入格式如何，都能正确处理
          const uuid = freshBind.mcUuid.trim();
        
        // 确保使用不带连字符的UUID (Minecraft RCON通常需要这种格式)
        mcid = uuid.replace(/-/g, '')
        
        // 验证UUID的有效性 (应该是32位十六进制字符)
        if (!/^[0-9a-f]{32}$/i.test(mcid)) {
          logger.warn(`[白名单] UUID格式无效: ${mcid}，应为32位十六进制字符`)
          return false
        }
      } else {
          mcid = freshBind.mcUsername
      }
      
        logger.info(`[白名单] 为用户QQ(${freshBind.qqId})添加白名单，使用${server.idType === 'uuid' ? 'UUID' : '用户名'}: ${mcid}`)
      
      // 使用安全替换函数，避免命令注入
      const command = safeCommandReplace(server.addCommand, mcid);
      
      let response = "";
      let success = false;
      let errorMessage = "";
      
      // 内部重试3次
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          // 执行RCON命令
          response = await executeRconCommand(server, command);
          
          // 记录完整命令和响应，用于调试
          logger.debug(`[白名单] 执行命令尝试#${attempt}: ${command}, 响应: "${response}", 长度: ${response.length}字节`);
          
          // 空响应处理
          if (response.trim() === '') {
            if (server.acceptEmptyResponse) {
              logger.info(`[白名单] 收到空响应，根据配置将其视为成功`);
                  success = true;
                  break;
                } else {
                  errorMessage = "服务器返回空响应";
                  if (attempt < 3) {
                    logger.warn(`[白名单] 尝试#${attempt}收到空响应，将在${1000 * attempt}ms后重试...`);
                    await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                    continue;
                  }
            }
          }
          
          // 检查是否添加成功
          // 定义匹配成功的关键词和匹配失败的关键词
          const successKeywords = ['已', '成功', 'success', 'added', 'okay', 'done', 'completed', 'added to', 'whitelist has', 'whitelisted'];
          const failureKeywords = ['失败', 'error', 'failed', 'not found', '不存在', 'cannot', 'unable', 'failure', 'exception', 'denied'];
      
          // 检查响应是否包含失败关键词
          const hasFailureKeyword = failureKeywords.some(keyword => 
            response.toLowerCase().includes(keyword.toLowerCase())
          );
      
          // 如果包含失败关键词，则表示失败
          if (hasFailureKeyword) {
            errorMessage = `命令执行失败: ${response}`;
            if (attempt < 3) {
              logger.warn(`[白名单] 尝试#${attempt}失败: ${errorMessage}，将在${1000 * attempt}ms后重试...`);
              await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
              continue;
            }
          } else {
            // 检查是否包含成功关键词
            const hasSuccessKeyword = successKeywords.some(keyword => 
              response.toLowerCase().includes(keyword.toLowerCase())
            );
            
            // 如果包含成功关键词或响应不包含失败关键词（且不为空），则表示成功
            if (hasSuccessKeyword || !hasFailureKeyword) {
              logger.info(`[白名单] 添加白名单成功，响应: ${response}`);
              success = true;
              break;
        } else {
              // 响应中既不包含成功关键词，也不包含失败关键词，视为需要人工判断
              if (attempt < 3) {
                logger.warn(`[白名单] 尝试#${attempt}状态不明确，响应: ${response}，将在${1000 * attempt}ms后重试...`);
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                continue;
              } else {
                // 最后一次尝试，没有明确失败标识，尝试视为成功
                logger.warn(`[白名单] 最终尝试#${attempt}状态不明确，响应: ${response}，将视为成功`);
                success = true;
                break;
              }
            }
          }
        } catch (error) {
          // 命令执行出错
          errorMessage = `执行命令出错: ${error.message}`;
          logger.error(`[白名单] 尝试#${attempt}执行命令出错: ${error.message}`);
          
          if (attempt < 3) {
            // 增加延迟，使用指数退避策略
            const delayMs = 1500 * Math.pow(2, attempt - 1);
            logger.warn(`[白名单] 将在${delayMs}ms后重试...`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
            continue;
          }
        }
      }
      
      // 操作结果处理
      if (success) {
        logger.debug(`[白名单] 成功执行服务器"${server.name}"的添加白名单命令`);
        
        // 更新用户的白名单列表
        const currentBind = await getMcBindByQQId(freshBind.qqId);
        if (currentBind) {
          // 避免重复添加
          const whitelistSet = new Set(currentBind.whitelist || []);
          whitelistSet.add(server.id);
          
          // 更新数据库
          await ctx.database.set('mcidbind', { qqId: freshBind.qqId }, {
            whitelist: Array.from(whitelistSet)
          });
          logger.info(`[白名单] 成功将QQ(${freshBind.qqId})添加到服务器${server.name}的白名单`);
        }
        
        return true;
      } else {
        logger.warn(`[白名单] 添加白名单失败，最终错误: ${errorMessage}`);
        return false;
      }
    } catch (error) {
      logger.error(`[白名单] 添加白名单失败: ${error.message}`);
      return false;
    }
    }, 15000); // 设置较长的超时时间，确保完整操作
  };
  
  // 移除服务器白名单
  const removeServerWhitelist = async (mcBind: MCIDBIND, server: ServerConfig): Promise<boolean> => {
    // 使用用户+服务器ID作为锁键，确保精细粒度控制
    const lockKey = `whitelist_${mcBind.qqId}_${server.id}`;
    
    return withLock(lockKey, async () => {
    try {
      if (!mcBind || !mcBind.mcUsername) {
        logger.warn(`[白名单] 尝试为未绑定MC账号的用户移除白名单`)
        return false
      }
        
        // 重新获取最新的用户绑定信息，确保操作基于最新状态
        const freshBind = await getMcBindByQQId(mcBind.qqId);
        if (!freshBind || !freshBind.mcUsername) {
          logger.warn(`[白名单] 用户QQ(${mcBind.qqId})可能在操作过程中解绑了MC账号`);
          return false;
        }
        
        // 检查最新状态是否在白名单中
        if (!freshBind.whitelist || !freshBind.whitelist.includes(server.id)) {
          logger.info(`[白名单] 用户QQ(${mcBind.qqId})不在服务器${server.name}的白名单中`);
          return true; // 不在白名单中，无需移除，视为成功
        }
      
      // 判断使用用户名还是UUID
      let mcid: string
      if (server.idType === 'uuid') {
          if (!freshBind.mcUuid) {
          logger.warn(`[白名单] 用户缺少UUID信息，无法移除白名单`)
          return false
        }
        // 提取UUID并确保无论输入格式如何，都能正确处理
          const uuid = freshBind.mcUuid.trim();
        
        // 确保使用不带连字符的UUID (Minecraft RCON通常需要这种格式)
        mcid = uuid.replace(/-/g, '')
        
        // 验证UUID的有效性 (应该是32位十六进制字符)
        if (!/^[0-9a-f]{32}$/i.test(mcid)) {
          logger.warn(`[白名单] UUID格式无效: ${mcid}，应为32位十六进制字符`)
          return false
        }
      } else {
        // 使用用户名，确保它已被Mojang API验证
          mcid = freshBind.mcUsername
      }
      
        logger.info(`[白名单] 为用户QQ(${freshBind.qqId})移除白名单，使用${server.idType === 'uuid' ? 'UUID' : '用户名'}: ${mcid}`)
      
      // 使用安全替换函数，避免命令注入
      const command = safeCommandReplace(server.removeCommand, mcid);
      
      // 执行RCON命令
      const response = await executeRconCommand(server, command)
        
        // 记录完整命令和响应，用于调试
        logger.debug(`[白名单] 执行命令: ${command}, 响应: "${response}", 长度: ${response.length}字节`);
        
        // 空响应处理
        if (response.trim() === '') {
          if (server.acceptEmptyResponse) {
            logger.info(`[白名单] 收到空响应，根据配置将其视为成功`);
            
            // 重新获取最新状态进行更新，避免并发更新问题
            const currentBind = await getMcBindByQQId(freshBind.qqId);
            if (!currentBind) {
              logger.warn(`[白名单] 无法获取用户QQ(${freshBind.qqId})的最新状态，数据库更新失败`);
              return true; // 命令执行成功但数据库操作失败，仍返回成功
            }
            
            // 确保whitelist数组存在
            if (currentBind.whitelist && currentBind.whitelist.includes(server.id)) {
              currentBind.whitelist = currentBind.whitelist.filter(id => id !== server.id);
              await ctx.database.set('mcidbind', { qqId: freshBind.qqId }, {
                whitelist: currentBind.whitelist
              });
              logger.info(`[白名单] 成功将QQ(${freshBind.qqId})从服务器${server.name}的白名单移除，更新数据库记录`);
            }
            
            return true;
          } else {
            logger.warn(`[白名单] 收到空响应，根据配置视为失败。可以在配置中设置acceptEmptyResponse=true接受空响应`);
          }
        }
      
      // 检查是否移除成功
      // 定义匹配成功的关键词和匹配失败的关键词
      const successKeywords = ['移除', '已完成', '成功', 'success', 'removed', 'okay', 'done', 'completed', 'removePlayer', 'took', 'off'];
      const failureKeywords = ['失败', '错误', 'error', 'failed', 'cannot', 'unable', 'failure', 'exception', 'denied'];
        
        // 对于不存在的情况单独处理，不应被视为失败
      const notFoundKeywords = ['not found', '不存在', 'no player was removed', 'is not whitelisted', 'not in'];
      
      // 检查响应是否包含成功关键词
      const isSuccess = successKeywords.some(keyword => response.toLowerCase().includes(keyword.toLowerCase()));
      
        // 检查响应是否包含失败关键词（排除不存在的情况）
      const isFailure = failureKeywords.some(keyword => response.toLowerCase().includes(keyword.toLowerCase()));
        
        // 检查是否是"不存在"的情况
        const isNotExist = notFoundKeywords.some(keyword => response.toLowerCase().includes(keyword.toLowerCase()));
        const notInLocal = !freshBind.whitelist || !freshBind.whitelist.includes(server.id);
        
        // 增加额外检查，看服务器是否通过颜色代码表示成功（很多服务器使用§a表示成功）
        // §a通常表示绿色，用于成功提示
        const hasSuccessColor = /§a/i.test(response) && !isFailure;
      
      // 判断结果
        if ((isSuccess && !isFailure) || (isNotExist && notInLocal) || hasSuccessColor) {
          // 明确检测到成功关键词且没有失败关键词，或远端本就不存在且本地也没有，或包含成功颜色代码
          let successMessage = '移除白名单成功';
          if (isNotExist && notInLocal) {
            successMessage = '移除白名单成功（或本就不存在）';
          }
          logger.info(`[白名单] ${successMessage}，服务器响应: ${response}`);
          
          // 重新获取最新状态进行更新，避免并发更新问题
          const currentBind = await getMcBindByQQId(freshBind.qqId);
          if (!currentBind) {
            logger.warn(`[白名单] 无法获取用户QQ(${freshBind.qqId})的最新状态，数据库更新失败`);
            return true; // 命令执行成功但数据库操作失败，仍返回成功
          }
          
          // 确保whitelist数组存在
          if (currentBind.whitelist && currentBind.whitelist.includes(server.id)) {
            currentBind.whitelist = currentBind.whitelist.filter(id => id !== server.id);
            await ctx.database.set('mcidbind', { qqId: freshBind.qqId }, {
              whitelist: currentBind.whitelist
            });
            logger.info(`[白名单] 成功将QQ(${freshBind.qqId})从服务器${server.name}的白名单移除，更新数据库记录`);
        }
        
          return true;
      } else {
          logger.warn(`[白名单] 移除白名单失败，服务器响应: ${response}`);
          return false;
      }
    } catch (error) {
        logger.error(`[白名单] 移除白名单失败: ${error.message}`);
        return false;
    }
    }, 15000); // 设置较长的超时时间，确保完整操作
  };
  
  // 检查用户是否在特定服务器的白名单中
  const isInServerWhitelist = (mcBind: MCIDBIND, serverId: string): boolean => {
    if (!mcBind || !mcBind.whitelist) return false
    return mcBind.whitelist.includes(serverId)
  }

  // 在插件启动时重建表结构（可选）
  ctx.on('ready', async () => {
    try {
      // 检查是否需要迁移表结构
      const hasOldStructure = await checkTableStructure()
      
      if (hasOldStructure) {
        logger.info('[初始化] 检测到旧表结构，开始重建MCIDBIND表...')
        await rebuildMcidBindTable()
        logger.info('[初始化] MCIDBIND表重建完成')
      } else {
        // 即使不需要完全重建，也检查并添加缺失的字段
        await addMissingFields()
        logger.info('[初始化] 表结构正常或已修复缺失字段')
      }
      
      // 检查API可用性
      logger.info('[初始化] 开始检查API连接状态...')
      await checkApiStatus()
      
      // 检查RCON连接
      if (config.servers && config.servers.length > 0) {
        logger.info('[初始化] 开始检查RCON连接...')
        await checkRconConnections()
      }
    } catch (error) {
      logger.error(`[初始化] 表结构检查或初始化失败: ${error.message}`)
    }
  })
  
  // 检查API连接状态
  const checkApiStatus = async (): Promise<void> => {
    const testUsername = 'Notch' // 使用一个确定存在的用户名进行测试
    
    logger.info('[API检查] 开始测试Mojang API和备用API连接状态')
    
    // 记录API测试的状态
    let mojangApiStatus = false
    let backupApiStatus = false
    
    // 测试Mojang API
    try {
      const startTime = Date.now()
      const response = await axios.get(`https://api.mojang.com/users/profiles/minecraft/${testUsername}`, {
        timeout: 10000,
        headers: {
          'User-Agent': 'KoishiMCVerifier/1.0',
        }
      })
      
      const mojangTime = Date.now() - startTime
      
      if (response.status === 200 && response.data) {
        logger.info(`[API检查] Mojang API连接正常 (${mojangTime}ms)，已验证用户: ${response.data.name}, UUID: ${response.data.id}`)
        mojangApiStatus = true
      } else {
        logger.warn(`[API检查] Mojang API返回异常状态码: ${response.status}, 响应: ${JSON.stringify(response.data || '无数据')}`)
      }
    } catch (error) {
      const errorMessage = axios.isAxiosError(error) 
        ? `${error.message}，错误代码: ${error.code || '未知'}，响应状态: ${error.response?.status || '未知'}`
        : error.message || '未知错误'
      logger.error(`[API检查] Mojang API连接失败: ${errorMessage}`)
    }
    
    // 测试备用API
    try {
      const startTime = Date.now()
      const response = await axios.get(`https://playerdb.co/api/player/minecraft/${testUsername}`, {
        timeout: 10000,
        headers: {
          'User-Agent': 'KoishiMCVerifier/1.0',
        }
      })
      
      const backupTime = Date.now() - startTime
      
      if (response.status === 200 && response.data?.code === "player.found") {
        const playerData = response.data.data.player;
        const rawId = playerData.raw_id || playerData.id.replace(/-/g, '');
        logger.info(`[API检查] 备用API连接正常 (${backupTime}ms)，已验证用户: ${playerData.username}, UUID: ${rawId}`)
        backupApiStatus = true
      } else {
        logger.warn(`[API检查] 备用API返回异常数据: 状态码: ${response.status}, 响应代码: ${response.data?.code || '未知'}`)
      }
    } catch (error) {
      const errorMessage = axios.isAxiosError(error) 
        ? `${error.message}，错误代码: ${error.code || '未知'}，响应状态: ${error.response?.status || '未知'}`
        : error.message || '未知错误'
      logger.error(`[API检查] 备用API连接失败: ${errorMessage}`)
    }
    
    // 总结API检查结果
    if (mojangApiStatus && backupApiStatus) {
      logger.info('[API检查] 所有API连接正常!')
    } else if (mojangApiStatus) {
      logger.warn('[API检查] Mojang API连接正常，但备用API连接失败')
    } else if (backupApiStatus) {
      logger.warn('[API检查] Mojang API连接失败，但备用API连接正常，将使用备用API')
    } else {
      logger.error('[API检查] 所有API连接均失败，验证功能可能无法正常工作!')
    }
  }
  
  // =========== 白名单命令组 ===========
  const whitelistCmd = cmd.subcommand('.whitelist', '白名单管理')

  // 列出服务器
  whitelistCmd.subcommand('.servers', '列出所有可用的服务器')
    .action(async ({ session }) => {
      try {
        const normalizedUserId = normalizeQQId(session.userId)
        logger.info(`[白名单] QQ(${normalizedUserId})查询可用服务器列表`)
        
        // 获取启用的服务器
        const enabledServers = config.servers?.filter(server => server.enabled !== false) || []
        
        if (!enabledServers || enabledServers.length === 0) {
          logger.info(`[白名单] 未配置或启用任何服务器`)
          return sendMessage(session, [h.text('当前未配置或启用任何服务器')])
        }
        
        // 检查用户是否绑定了MC账号
        const userBind = await getMcBindByQQId(normalizedUserId);
        if (!userBind || !userBind.mcUsername) {
          logger.warn(`[白名单] QQ(${normalizedUserId})未绑定MC账号，无法显示白名单状态`)
          return sendMessage(session, [h.text(`您尚未绑定MC账号，请先使用 ${formatCommand('mcid bind <用户名>')} 命令绑定账号，然后再查看服务器列表。`)])
        }
        
        // 圈数字映射（1-20）
        const circledNumbers = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', 
                                '⑪', '⑫', '⑬', '⑭', '⑮', '⑯', '⑰', '⑱', '⑲', '⑳'];
        
        // 格式化服务器列表
        const serverList = enabledServers.map((server, index) => {
          // 获取此用户是否已加入该服务器的白名单
          const hasWhitelist = userBind ? isInServerWhitelist(userBind, server.id) : false;
          
          // 使用圈数字作为序号
          const circledNumber = index < circledNumbers.length ? circledNumbers[index] : `${index + 1}.`;
          
          // 构建服务器信息显示文本
          let serverInfo = `${circledNumber} ${server.name}`;
          
          // 添加状态标记
          if (hasWhitelist) {
            serverInfo += ' [✓ 已加入]';
          } else {
            serverInfo += ' [未加入]';
          }
          
          // 添加服务器状态信息
          serverInfo += "\n   状态: " + (server.enabled === false ? '已停用' : '已启用');
          
          // 添加申请权限信息
          serverInfo += "\n   权限: " + (server.allowSelfApply ? '允许自助申请' : '仅管理员可操作');
          
          // 只有当设置了地址时才显示地址行
          if (server.displayAddress && server.displayAddress.trim()) {
            serverInfo += "\n   地址: " + server.displayAddress;
          }
          
          // 只有当设置了说明信息时才显示说明行
          if (server.description && server.description.trim()) {
            serverInfo += "\n   说明: " + server.description;
          }
          
          return serverInfo;
        }).join('\n');
        
        logger.info(`[白名单] 成功: QQ(${normalizedUserId})获取了服务器列表，共${enabledServers.length}个服务器`)
        return sendMessage(session, [
          h.text(`${userBind.mcUsername} 的可用服务器列表:\n\n${serverList}\n\n使用 ${formatCommand('mcid whitelist add <服务器名称>')} 申请白名单`)
        ])
      } catch (error) {
        const normalizedUserId = normalizeQQId(session.userId)
        logger.error(`[白名单] QQ(${normalizedUserId})查询服务器列表失败: ${error.message}`)
        return sendMessage(session, [h.text(getFriendlyErrorMessage(error))])
      }
    })
  
  // 添加白名单
  whitelistCmd.subcommand('.add <serverName:string> [target:user]', '申请/添加服务器白名单')
    .action(async ({ session }, serverName, target) => {
      try {
        const normalizedUserId = normalizeQQId(session.userId)
        
        // 检查服务器名称
        if (!serverName) {
          logger.warn(`[白名单] QQ(${normalizedUserId})未提供服务器名称`)
          return sendMessage(session, [h.text('请提供服务器名称\n使用 mcid whitelist servers 查看可用服务器列表')])
        }
        
        // 获取服务器配置
        const server = getServerConfigByName(serverName)
        if (!server) {
          logger.warn(`[白名单] QQ(${normalizedUserId})提供的服务器名称"${serverName}"无效`)
          return sendMessage(session, [h.text(`未找到名为"${serverName}"的服务器\n使用 mcid whitelist servers 查看可用服务器列表`)])
        }
        
        // 如果指定了目标用户（管理员功能）
        if (target) {
          const normalizedTargetId = normalizeQQId(target)
          logger.info(`[白名单] QQ(${normalizedUserId})尝试为QQ(${normalizedTargetId})添加服务器"${server.name}"白名单`)
          
          // 检查权限
          if (!await isAdmin(session.userId)) {
            logger.warn(`[白名单] 权限不足: QQ(${normalizedUserId})不是管理员，无法为QQ(${normalizedTargetId})添加白名单`)
            return sendMessage(session, [h.text('只有管理员才能为其他用户添加白名单')])
          }
          
          // 获取目标用户的绑定信息
          const targetBind = await getMcBindByQQId(normalizedTargetId)
          if (!targetBind || !targetBind.mcUsername) {
            logger.warn(`[白名单] QQ(${normalizedTargetId})未绑定MC账号`)
            return sendMessage(session, [h.text(`用户 ${normalizedTargetId} 尚未绑定MC账号，无法添加白名单`)])
          }
          
          // 检查是否已在白名单中
          if (isInServerWhitelist(targetBind, server.id)) {
            logger.warn(`[白名单] QQ(${normalizedTargetId})已在服务器"${server.name}"的白名单中`)
            return sendMessage(session, [h.text(`用户 ${normalizedTargetId} 已在服务器"${server.name}"的白名单中`)])
          }
          
          // 执行添加白名单操作
          const result = await addServerWhitelist(targetBind, server)
          
          if (result) {
            logger.info(`[白名单] 成功: 管理员QQ(${normalizedUserId})为QQ(${normalizedTargetId})添加了服务器"${server.name}"的白名单`)
            return sendMessage(session, [h.text(`已成功为用户 ${normalizedTargetId} 添加服务器"${server.name}"的白名单`)])
          } else {
            logger.error(`[白名单] 管理员QQ(${normalizedUserId})为QQ(${normalizedTargetId})添加服务器"${server.name}"白名单失败`)
            return sendMessage(session, [h.text(`为用户 ${normalizedTargetId} 添加服务器"${server.name}"白名单失败，请检查RCON连接和命令配置`)])
          }
        }
        
        // 为自己添加白名单
        logger.info(`[白名单] QQ(${normalizedUserId})尝试为自己添加服务器"${server.name}"白名单`)
        
        // 检查服务器是否允许自助申请
        if (!server.allowSelfApply && !await isAdmin(session.userId)) {
          logger.warn(`[白名单] 服务器"${server.name}"不允许自助申请，且QQ(${normalizedUserId})不是管理员`)
          return sendMessage(session, [h.text(`服务器"${server.name}"不允许自助申请白名单，请联系管理员`)])
        }
        
        // 获取自己的绑定信息
        const selfBind = await getMcBindByQQId(normalizedUserId)
        if (!selfBind || !selfBind.mcUsername) {
          logger.warn(`[白名单] QQ(${normalizedUserId})未绑定MC账号`)
          return sendMessage(session, [h.text('您尚未绑定MC账号，请先使用 ' + formatCommand('mcid bind <用户名>') + ' 进行绑定')])
        }
        
        // 检查是否已在白名单中
        if (isInServerWhitelist(selfBind, server.id)) {
          logger.warn(`[白名单] QQ(${normalizedUserId})已在服务器"${server.name}"的白名单中`)
          return sendMessage(session, [h.text(`您已在服务器"${server.name}"的白名单中`)])
        }
        
        // 执行添加白名单操作
        const result = await addServerWhitelist(selfBind, server)
        
        if (result) {
          logger.info(`[白名单] 成功: QQ(${normalizedUserId})添加了服务器"${server.name}"的白名单`)
          return sendMessage(session, [h.text(`已成功添加服务器"${server.name}"的白名单`)])
        } else {
          logger.error(`[白名单] QQ(${normalizedUserId})添加服务器"${server.name}"白名单失败`)
          return sendMessage(session, [h.text(`添加服务器"${server.name}"白名单失败，请联系管理员`)])
        }
      } catch (error) {
        const normalizedUserId = normalizeQQId(session.userId)
        logger.error(`[白名单] QQ(${normalizedUserId})添加白名单失败: ${error.message}`)
        return sendMessage(session, [h.text(getFriendlyErrorMessage(error))])
      }
    })
  
  // 移除白名单
  whitelistCmd.subcommand('.remove <serverName:string> [target:user]', '[管理员]移除服务器白名单')
    .action(async ({ session }, serverName, target) => {
      try {
        const normalizedUserId = normalizeQQId(session.userId)
        
        // 检查权限，只有管理员可以移除白名单
        if (!await isAdmin(session.userId)) {
          logger.warn(`[白名单] 权限不足: QQ(${normalizedUserId})不是管理员，无法移除白名单`)
          return sendMessage(session, [h.text('只有管理员才能移除白名单')])
        }
        
        // 检查服务器名称
        if (!serverName) {
          logger.warn(`[白名单] QQ(${normalizedUserId})未提供服务器名称`)
          return sendMessage(session, [h.text('请提供服务器名称\n使用 mcid whitelist servers 查看可用服务器列表')])
        }
        
        // 获取服务器配置
        const server = getServerConfigByName(serverName)
        if (!server) {
          logger.warn(`[白名单] QQ(${normalizedUserId})提供的服务器名称"${serverName}"无效`)
          return sendMessage(session, [h.text(`未找到名为"${serverName}"的服务器\n使用 mcid whitelist servers 查看可用服务器列表`)])
        }
        
        // 如果指定了目标用户
        if (target) {
          const normalizedTargetId = normalizeQQId(target)
          logger.info(`[白名单] 管理员QQ(${normalizedUserId})尝试为QQ(${normalizedTargetId})移除服务器"${server.name}"白名单`)
          
          // 获取目标用户的绑定信息
          const targetBind = await getMcBindByQQId(normalizedTargetId)
          if (!targetBind || !targetBind.mcUsername) {
            logger.warn(`[白名单] QQ(${normalizedTargetId})未绑定MC账号`)
            return sendMessage(session, [h.text(`用户 ${normalizedTargetId} 尚未绑定MC账号，无法移除白名单`)])
          }
          
          // 检查是否在白名单中
          if (!isInServerWhitelist(targetBind, server.id)) {
            logger.warn(`[白名单] QQ(${normalizedTargetId})不在服务器"${server.name}"的白名单中`)
            return sendMessage(session, [h.text(`用户 ${normalizedTargetId} 不在服务器"${server.name}"的白名单中`)])
          }
          
          // 执行移除白名单操作
          const result = await removeServerWhitelist(targetBind, server)
          
          if (result) {
            logger.info(`[白名单] 成功: 管理员QQ(${normalizedUserId})为QQ(${normalizedTargetId})移除了服务器"${server.name}"的白名单`)
            return sendMessage(session, [h.text(`已成功为用户 ${normalizedTargetId} 移除服务器"${server.name}"的白名单`)])
          } else {
            logger.error(`[白名单] 管理员QQ(${normalizedUserId})为QQ(${normalizedTargetId})移除服务器"${server.name}"白名单失败`)
            return sendMessage(session, [h.text(`为用户 ${normalizedTargetId} 移除服务器"${server.name}"白名单失败，请检查RCON连接和命令配置`)])
          }
        }
        
        // 为自己移除白名单 (管理员也需要使用此功能移除自己的白名单)
        logger.info(`[白名单] 管理员QQ(${normalizedUserId})尝试为自己移除服务器"${server.name}"白名单`)
        
        // 获取自己的绑定信息
        const selfBind = await getMcBindByQQId(normalizedUserId)
        if (!selfBind || !selfBind.mcUsername) {
          logger.warn(`[白名单] QQ(${normalizedUserId})未绑定MC账号`)
          return sendMessage(session, [h.text('您尚未绑定MC账号，请先使用 ' + formatCommand('mcid bind <用户名>') + ' 进行绑定')])
        }
        
        // 检查是否在白名单中
        if (!isInServerWhitelist(selfBind, server.id)) {
          logger.warn(`[白名单] QQ(${normalizedUserId})不在服务器"${server.name}"的白名单中`)
          return sendMessage(session, [h.text(`您不在服务器"${server.name}"的白名单中`)])
        }
        
        // 执行移除白名单操作
        const result = await removeServerWhitelist(selfBind, server)
        
        if (result) {
          logger.info(`[白名单] 成功: 管理员QQ(${normalizedUserId})移除了自己服务器"${server.name}"的白名单`)
          return sendMessage(session, [h.text(`已成功移除服务器"${server.name}"的白名单`)])
        } else {
          logger.error(`[白名单] 管理员QQ(${normalizedUserId})移除服务器"${server.name}"白名单失败`)
          return sendMessage(session, [h.text(`移除服务器"${server.name}"白名单失败，请检查RCON连接和命令配置`)])
        }
      } catch (error) {
        const normalizedUserId = normalizeQQId(session.userId)
        logger.error(`[白名单] QQ(${normalizedUserId})移除白名单失败: ${error.message}`)
        return sendMessage(session, [h.text(getFriendlyErrorMessage(error))])
      }
    })
    
  // 重置服务器所有白名单记录
  whitelistCmd.subcommand('.reset <serverName:string>', '[主人]重置服务器所有白名单记录')
    .action(async ({ session }, serverName) => {
      try {
        const normalizedUserId = normalizeQQId(session.userId)
        
        // 检查是否为主人
        if (!isMaster(session.userId)) {
          logger.warn(`[重置白名单] 权限不足: QQ(${normalizedUserId})不是主人，无法重置白名单数据库`)
          return sendMessage(session, [h.text('只有主人才能重置服务器白名单数据库')])
        }
        
        // 检查服务器名称
        if (!serverName) {
          logger.warn(`[重置白名单] QQ(${normalizedUserId})未提供服务器名称`)
          return sendMessage(session, [h.text('请提供服务器名称\n使用 mcid whitelist servers 查看可用服务器列表')])
        }
        
        // 获取服务器配置
        const server = getServerConfigByName(serverName)
        if (!server) {
          logger.warn(`[重置白名单] QQ(${normalizedUserId})提供的服务器名称"${serverName}"无效`)
          return sendMessage(session, [h.text(`未找到名为"${serverName}"的服务器\n使用 mcid whitelist servers 查看可用服务器列表`)])
        }
        
        // 查询所有用户绑定记录
        const allBinds = await ctx.database.get('mcidbind', {})
        logger.info(`[重置白名单] 主人QQ(${normalizedUserId})正在重置服务器"${server.name}"的白名单数据库，共有${allBinds.length}条记录需要检查`)
        
        // 统计信息
        let processedCount = 0
        let updatedCount = 0
        
        // 处理每条记录
        for (const bind of allBinds) {
          processedCount++
          
          // 检查该用户是否有此服务器的白名单
          if (bind.whitelist && bind.whitelist.includes(server.id)) {
            // 更新记录，移除该服务器的白名单
            const newWhitelist = bind.whitelist.filter(id => id !== server.id)
            await ctx.database.set('mcidbind', { qqId: bind.qqId }, {
              whitelist: newWhitelist
            })
            updatedCount++
            logger.info(`[重置白名单] 已从QQ(${bind.qqId})的白名单记录中移除服务器"${server.name}"`)
          }
        }
        
        logger.info(`[重置白名单] 成功: 主人QQ(${normalizedUserId})重置了服务器"${server.name}"的白名单数据库，共处理${processedCount}条记录，更新${updatedCount}条记录`)
        return sendMessage(session, [h.text(`已成功重置服务器"${server.name}"的白名单数据库记录\n共处理${processedCount}条记录，更新${updatedCount}条记录\n\n注意：此操作仅清除数据库记录，如需同时清除服务器上的白名单，请使用RCON命令手动操作`)])
      } catch (error) {
        const normalizedUserId = normalizeQQId(session.userId)
        logger.error(`[重置白名单] QQ(${normalizedUserId})重置白名单数据库失败: ${error.message}`)
        return sendMessage(session, [h.text(getFriendlyErrorMessage(error))])
      }
    })
    
  // 批量将所有用户添加到服务器白名单
  whitelistCmd.subcommand('.addall <serverName:string>', '[管理员]将所有用户添加到指定服务器白名单')
    .action(async ({ session }, serverName) => {
      try {
        const normalizedUserId = normalizeQQId(session.userId)
        
        // 检查是否为管理员
        if (!await isAdmin(session.userId)) {
          logger.warn(`[批量白名单] 权限不足: QQ(${normalizedUserId})不是管理员，无法执行批量添加白名单操作`)
          return sendMessage(session, [h.text('只有管理员才能执行批量添加白名单操作')])
        }
        
        // 检查服务器名称
        if (!serverName) {
          logger.warn(`[批量白名单] QQ(${normalizedUserId})未提供服务器名称`)
          return sendMessage(session, [h.text('请提供服务器名称\n使用 mcid whitelist servers 查看可用服务器列表')])
        }
        
        // 获取服务器配置
        const server = getServerConfigByName(serverName)
        if (!server) {
          logger.warn(`[批量白名单] QQ(${normalizedUserId})提供的服务器名称"${serverName}"无效`)
          return sendMessage(session, [h.text(`未找到名为"${serverName}"的服务器\n使用 mcid whitelist servers 查看可用服务器列表`)])
        }
        
        // 检查服务器是否启用
        if (server.enabled === false) {
          logger.warn(`[批量白名单] QQ(${normalizedUserId})尝试为已停用的服务器"${server.name}"批量添加白名单`)
          return sendMessage(session, [h.text(`服务器"${server.name}"已停用，无法添加白名单`)])
        }
        
        // 发送开始执行的通知
        await sendMessage(session, [h.text(`开始批量添加白名单到服务器"${server.name}"，请稍候...`)])
        
        // 查询所有已绑定MC账号的用户
        const allBinds = await ctx.database.get('mcidbind', {
          $or: [
            { mcUsername: { $ne: '' } },
            { mcUuid: { $ne: '' } }
          ]
        })
        
        // 过滤掉无效的绑定：没有用户名或UUID的记录
        const validBinds = allBinds.filter(bind => 
          (bind.mcUsername && bind.mcUsername.trim() !== '' && !bind.mcUsername.startsWith('_temp_')) || 
          (bind.mcUuid && bind.mcUuid.trim() !== '')
        );
        
        logger.info(`[批量白名单] 管理员QQ(${normalizedUserId})正在批量添加服务器"${server.name}"的白名单，共有${validBinds.length}条有效记录需要处理`)
        
        // 统计信息
        let successCount = 0
        let failCount = 0
        let skipCount = 0
        
        // 记录最后一次通知的进度百分比
        let lastNotifiedProgress = 0
        
        // 限制并发数量，避免RCON连接过载
        // 根据记录数量动态调整并发数
        const MAX_CONCURRENT = validBinds.length > 100 ? 2 : (validBinds.length > 50 ? 3 : 5);
        const chunks = []
        
        // 将用户分组，每组最多MAX_CONCURRENT个用户
        for (let i = 0; i < validBinds.length; i += MAX_CONCURRENT) {
          chunks.push(validBinds.slice(i, i + MAX_CONCURRENT))
        }
        
        // 逐组处理用户
        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i]
          
          // 并发处理当前组的用户
          await Promise.all(chunk.map(async (bind) => {
            try {
              // 跳过已经在白名单中的用户
              if (isInServerWhitelist(bind, server.id)) {
                skipCount++
                logger.debug(`[批量白名单] 跳过已在白名单中的用户QQ(${bind.qqId})的MC账号(${bind.mcUsername})`)
                return
              }
              
              // 添加错误阈值检查
              const currentFailRate = failCount / (successCount + failCount + 1);
              if (currentFailRate > 0.5 && (successCount + failCount) >= 5) {
                logger.error(`[批量白名单] 失败率过高(${Math.round(currentFailRate * 100)}%)，中止操作`);
                throw new Error(`失败率过高，操作已中止`);
              }
              
              // 执行添加白名单操作
              const result = await addServerWhitelist(bind, server)
              
              if (result) {
                successCount++
                logger.debug(`[批量白名单] 成功添加用户QQ(${bind.qqId})的MC账号(${bind.mcUsername})到服务器"${server.name}"的白名单`)
              } else {
                failCount++
                logger.error(`[批量白名单] 添加用户QQ(${bind.qqId})的MC账号(${bind.mcUsername})到服务器"${server.name}"的白名单失败`)
              }
            } catch (error) {
              failCount++
              logger.error(`[批量白名单] 处理用户QQ(${bind.qqId})时出错: ${error.message}`)
              
              // 如果错误指示操作已中止，向外传播错误
              if (error.message.includes('失败率过高')) {
                throw error;
              }
            }
          })).catch(error => {
            // 捕获并处理Promise.all中的错误
            if (error.message.includes('失败率过高')) {
              // 设置一个标志，指示下面的循环应该退出
              i = chunks.length; // 强制退出循环
              sendMessage(session, [h.text(`⚠️ 批量添加白名单操作已中止: 失败率过高(${Math.round((failCount / (successCount + failCount)) * 100)}%)，请检查服务器连接`)]);
            }
          });
          
          // 如果操作因高失败率而中止，跳出循环
          if (i >= chunks.length) break;
          
          // 计算实际已处理的用户数（考虑最后一组可能不满）
          const processedCount = (i + 1) * MAX_CONCURRENT > validBinds.length ? 
                               validBinds.length : (i + 1) * MAX_CONCURRENT;
          const progress = Math.floor((processedCount / validBinds.length) * 100);
          
          // 只有当进度增加了20%或以上，或者是首次或最后一次才发送通知
          if (i === 0 || progress - lastNotifiedProgress >= 20 || i === chunks.length - 1) {
            await sendMessage(session, [h.text(`批量添加白名单进度: ${progress}%，已处理${processedCount}/${validBinds.length}个用户\n成功: ${successCount} | 失败: ${failCount} | 跳过: ${skipCount}`)]);
            lastNotifiedProgress = progress;
          }
        }
        
        logger.info(`[批量白名单] 成功: 管理员QQ(${normalizedUserId})批量添加了服务器"${server.name}"的白名单，成功: ${successCount}，失败: ${failCount}，跳过: ${skipCount}`)
        return sendMessage(session, [h.text(`批量添加服务器"${server.name}"白名单完成\n共处理${validBinds.length}个有效用户\n✅ 成功: ${successCount} 个\n❌ 失败: ${failCount} 个\n⏭️ 跳过(已在白名单): ${skipCount} 个\n\n如需查看详细日志，请查看服务器日志文件`)])
      } catch (error) {
        const normalizedUserId = normalizeQQId(session.userId)
        logger.error(`[批量白名单] QQ(${normalizedUserId})批量添加白名单失败: ${error.message}`)
        return sendMessage(session, [h.text(getFriendlyErrorMessage(error))])
      }
    })

  // 检查所有服务器的RCON连接
  const checkRconConnections = async (): Promise<void> => {
    if (!config.servers || config.servers.length === 0) {
      logger.info('[RCON检查] 未配置任何服务器，跳过RCON检查')
      return
    }
    
    const results: { [id: string]: boolean } = {}
    
    for (const server of config.servers) {
      try {
        logger.info(`[RCON检查] 正在检查服务器 ${server.name} (${server.rconAddress}) 的连接状态`)
        
        // 尝试执行/list命令来测试连接 (使用RCON管理器)
        await rconManager.executeCommand(server, 'list')
        
        // 如果没有抛出异常，表示连接成功
        logger.info(`[RCON检查] 服务器 ${server.name} 连接成功`)
        results[server.id] = true
      } catch (error) {
        logger.error(`[RCON检查] 服务器 ${server.name} 连接失败: ${error.message}`)
        results[server.id] = false
      }
    }
    
    // 生成检查结果摘要
    const totalServers = config.servers.length
    const successCount = Object.values(results).filter(Boolean).length
    const failCount = totalServers - successCount
    
    logger.info(`[RCON检查] 检查完成: ${successCount}/${totalServers} 个服务器连接成功，${failCount} 个连接失败`)
    
    if (failCount > 0) {
      const failedServers = config.servers
        .filter(server => !results[server.id])
        .map(server => server.name)
        .join(', ')
      
      logger.warn(`[RCON检查] 以下服务器连接失败，白名单功能可能无法正常工作: ${failedServers}`)
    }
  }

  // 使用Mojang API通过UUID查询用户名
  const getUsernameByUuid = async (uuid: string): Promise<string | null> => {
    try {
      // 确保UUID格式正确（去除连字符）
      const cleanUuid = uuid.replace(/-/g, '');
      
      logger.debug(`[Mojang API] 通过UUID "${cleanUuid}" 查询用户名`);
      const response = await axios.get(`https://api.mojang.com/user/profile/${cleanUuid}`, {
        timeout: 10000,
        headers: {
          'User-Agent': 'KoishiMCVerifier/1.0',
        }
      });
      
      if (response.status === 200 && response.data) {
        // 从返回数据中提取用户名
        const username = response.data.name;
        logger.debug(`[Mojang API] UUID "${cleanUuid}" 当前用户名: ${username}`);
        return username;
      }
      
      logger.warn(`[Mojang API] UUID "${cleanUuid}" 查询不到用户名`);
      return null;
    } catch (error) {
      // 如果是网络相关错误，尝试使用备用API
      if (axios.isAxiosError(error) && (
        error.code === 'ENOTFOUND' || 
        error.code === 'ETIMEDOUT' || 
        error.code === 'ECONNRESET' || 
        error.code === 'ECONNREFUSED' || 
        error.code === 'ECONNABORTED' || 
        error.response?.status === 429)) {
        
        logger.info(`[Mojang API] 通过UUID查询用户名时遇到错误(${error.code || error.response?.status})，将尝试使用备用API`);
        return getUsernameByUuidBackupAPI(uuid);
      }
      
      const errorMessage = axios.isAxiosError(error) 
        ? `${error.message}，响应状态: ${error.response?.status || '未知'}\n响应数据: ${JSON.stringify(error.response?.data || '无数据')}`
        : error.message || '未知错误';
      logger.error(`[Mojang API] 通过UUID "${uuid}" 查询用户名失败: ${errorMessage}`);
      return null;
    }
  };

  // 使用备用API通过UUID查询用户名
  const getUsernameByUuidBackupAPI = async (uuid: string): Promise<string | null> => {
    try {
      // 确保UUID格式正确，备用API支持带连字符的UUID
      const formattedUuid = uuid.includes('-') ? uuid : formatUuid(uuid);
      
      logger.debug(`[备用API] 通过UUID "${formattedUuid}" 查询用户名`);
      const response = await axios.get(`https://playerdb.co/api/player/minecraft/${formattedUuid}`, {
        timeout: 10000,
        headers: {
          'User-Agent': 'KoishiMCVerifier/1.0',
        }
      });
      
      if (response.status === 200 && response.data?.code === "player.found") {
        const playerData = response.data.data.player;
        logger.debug(`[备用API] UUID "${formattedUuid}" 当前用户名: ${playerData.username}`);
        return playerData.username;
      }
      
      logger.warn(`[备用API] UUID "${formattedUuid}" 查询不到用户名: ${JSON.stringify(response.data)}`);
      return null;
    } catch (error) {
      const errorMessage = axios.isAxiosError(error) 
        ? `${error.message}，响应状态: ${error.response?.status || '未知'}\n响应数据: ${JSON.stringify(error.response?.data || '无数据')}`
        : error.message || '未知错误';
      logger.error(`[备用API] 通过UUID "${uuid}" 查询用户名失败: ${errorMessage}`);
      return null;
    }
  };

  // 检查并更新用户名（如果与当前数据库中的不同）
  const checkAndUpdateUsername = async (bind: MCIDBIND): Promise<MCIDBIND> => {
    try {
      if (!bind || !bind.mcUuid) {
        logger.warn(`[用户名更新] 无法检查用户名更新: 空绑定或空UUID`);
        return bind;
      }
      
      // 通过UUID查询最新用户名
      const latestUsername = await getUsernameByUuid(bind.mcUuid);
      
      if (!latestUsername) {
        logger.warn(`[用户名更新] 无法获取UUID "${bind.mcUuid}" 的最新用户名`);
        return bind;
      }
      
      // 如果用户名与数据库中的不同，更新数据库
      if (latestUsername !== bind.mcUsername) {
        logger.info(`[用户名更新] 用户 QQ(${bind.qqId}) 的Minecraft用户名已变更: ${bind.mcUsername} -> ${latestUsername}`);
        
        // 更新数据库中的用户名
        await ctx.database.set('mcidbind', { qqId: bind.qqId }, {
          mcUsername: latestUsername
        });
        
        // 更新返回的绑定对象
        bind.mcUsername = latestUsername;
      }
      
      return bind;
    } catch (error) {
      logger.error(`[用户名更新] 检查和更新用户名失败: ${error.message}`);
      return bind;
    }
  };

  // 安全地替换命令模板
  const safeCommandReplace = (template: string, mcid: string): string => {
    // 过滤可能导致命令注入的字符
    const sanitizedMcid = mcid.replace(/[;&|"`'$\\]/g, '');
    
    // 如果经过过滤后的mcid与原始mcid不同，记录警告
    if (sanitizedMcid !== mcid) {
      logger.warn(`[安全] 检测到潜在危险字符，已自动过滤: '${mcid}' -> '${sanitizedMcid}'`);
    }
    
    return template.replace(/\${MCID}/g, sanitizedMcid);
  };
}
