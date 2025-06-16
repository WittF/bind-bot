import { Context, Schema, h, Session, Logger } from 'koishi'
import {} from '@koishijs/plugin-server'
import axios from 'axios'
import * as RconClient from 'rcon-client'

export const name = 'mcid-bot'

// 声明插件依赖
export const inject = ['database', 'server']

// 定义插件配置
export interface Config {
  cooldownDays: number
  masterId: string
  servers: ServerConfig[]
  allowTextPrefix: boolean
  botNickname: string
  autoRecallTime: number
  recallUserMessage: boolean
  debugMode: boolean
  showAvatar: boolean
  showMcSkin: boolean
  // BUID相关配置
  zminfoApiUrl: string
  // 天选播报配置
  enableLotteryBroadcast: boolean
  // 自动群昵称设置目标群
  autoNicknameGroupId: string
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
    .description('消息自动撤回时间(秒)，同时控制机器人和用户消息，设置为0表示不自动撤回')
    .default(0),
  recallUserMessage: Schema.boolean()
    .description('是否撤回用户发送的指令消息')
    .default(false),
  debugMode: Schema.boolean()
    .description('调试模式，启用详细日志输出')
    .default(false),
  showAvatar: Schema.boolean()
    .description('是否显示头像图片（MC用头图，B站用头像）')
    .default(false),
  showMcSkin: Schema.boolean()
    .description('是否使用MC皮肤渲染图（需要先开启showAvatar）')
    .default(false),
  zminfoApiUrl: Schema.string()
    .description('ZMINFO API地址')
    .default('https://zminfo-api.wittf.com'),
  enableLotteryBroadcast: Schema.boolean()
    .description('是否启用天选开奖播报功能')
    .default(false),
  autoNicknameGroupId: Schema.string()
    .description('自动群昵称设置目标群ID')
    .default('931805503'),
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
  tags: string[]        // 用户标签列表
  // BUID相关字段
  buidUid: string       // B站UID
  buidUsername: string  // B站用户名
  guardLevel: number    // 当前舰长等级
  guardLevelText: string // 当前舰长等级文本
  maxGuardLevel: number    // 历史最高舰长等级
  maxGuardLevelText: string // 历史最高舰长等级文本
  medalName: string     // 粉丝牌名称
  medalLevel: number    // 粉丝牌等级
  wealthMedalLevel: number // 荣耀等级
  lastActiveTime: Date  // 最后活跃时间
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

// ZMINFO API响应接口
interface ZminfoUser {
  uid: string
  username: string
  avatar_url: string
  guard_level: number
  guard_level_text: string
  max_guard_level: number        // 历史最高舰长等级
  max_guard_level_text: string   // 历史最高舰长等级文本
  medal: {
    name: string
    level: number
    uid: string
    room: number
  } | null
  wealthMedalLevel: number
  last_active_time: string
}

interface ZminfoApiResponse {
  success: boolean
  message: string
  data?: {
    user?: ZminfoUser
  }
}

// RconManager类，用于管理RCON连接
class RconManager {
  private connections: Map<string, { 
    rcon: RconClient.Rcon, 
    lastUsed: number,
    heartbeatInterval: NodeJS.Timeout | null,
    reconnecting: boolean
  }> = new Map();
  private logger: Logger;
  private debugMode: boolean;
  private heartbeatCmd = 'list'; // 心跳命令，使用无害的list命令
  private heartbeatInterval = 5 * 60 * 1000; // 5分钟发送一次心跳
  private maxIdleTime = 30 * 60 * 1000; // 连接空闲30分钟后关闭
  private maxConnections = 20; // 最大同时连接数，防止资源耗尽
  private serverConfigs: ServerConfig[] = [];
  
  constructor(logger: Logger, serverConfigs: ServerConfig[], debugMode: boolean = false) {
    this.logger = logger;
    this.serverConfigs = serverConfigs;
    this.debugMode = debugMode;
    
    // 每5分钟检查一次空闲连接
    setInterval(() => this.cleanIdleConnections(), 5 * 60 * 1000);
  }
  
  // 日志辅助方法
  private logDebug(message: string): void {
    if (this.debugMode) {
      this.logger.debug(`[RCON管理器] ${message}`);
    }
  }
  
  private logInfo(message: string): void {
    this.logger.info(`[RCON管理器] ${message}`);
  }
  
  private logWarn(message: string): void {
    this.logger.warn(`[RCON管理器] ${message}`);
  }
  
  private logError(message: string): void {
    this.logger.error(`[RCON管理器] ${message}`);
  }
  
  // 获取RCON连接
  async getConnection(server: ServerConfig): Promise<RconClient.Rcon> {
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
        this.logError(`[RCON管理器] 服务器 ${server.name} 的连接已失效，将重新连接: ${error.message}`);
        await this.resetConnection(server);
      }
    }
    
    // 创建新连接
    return this.createConnection(server);
  }
  
  // 创建新RCON连接
  private async createConnection(server: ServerConfig): Promise<RconClient.Rcon> {
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
      this.logWarn(`[RCON管理器] 连接数量达到上限(${this.maxConnections})，尝试关闭最久未使用的连接`);
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
      this.logInfo(`[RCON管理器] 正在连接到服务器 ${server.name} (${server.rconAddress})`);
      const rcon = new RconClient.Rcon({
        host,
        port,
        password: server.rconPassword,
        timeout: 3000 // 3秒连接超时
      });
      
      // 连接到服务器
      await rcon.connect();
        
      // 设置心跳定时器，保持连接活跃
      const heartbeatInterval = setInterval(async () => {
        try {
          this.logDebug(`[RCON管理器] 向服务器 ${server.name} 发送心跳命令`);
          await rcon.send(this.heartbeatCmd);
        } catch (error) {
          this.logError(`[RCON管理器] 服务器 ${server.name} 心跳失败: ${error.message}`);
          
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
      
      this.logInfo(`[RCON管理器] 成功连接到服务器 ${server.name}`);
      return rcon;
    } catch (error) {
      this.logError(`[RCON管理器] 连接服务器 ${server.name} 失败: ${error.message}`);
      
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
          this.logInfo(`[RCON管理器] 由于连接池满，关闭了最久未使用的连接: ${oldestId}`);
        } catch (error) {
          this.logDebug(`[RCON管理器] 关闭最久未使用的连接出错: ${error.message}`);
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
      this.logInfo(`[RCON管理器] 重置服务器 ${server.name} 的连接`);
      
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
        this.logDebug(`[RCON管理器] 已关闭服务器 ${server.name} 的旧连接`);
      } catch (error) {
        // 忽略关闭连接时的错误
        this.logDebug(`[RCON管理器] 关闭服务器 ${server.name} 的连接时出错: ${error.message}`);
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
      this.logInfo(`[RCON管理器] 服务器 ${server.name} 执行命令: ${safeCommand}`);
      
      const response = await rcon.send(command);
      
      // 记录完整响应内容
      this.logInfo(`[RCON管理器] 服务器 ${server.name} 收到响应: ${response.length > 0 ? response : '(空响应)'} (${response.length}字节)`);
      
      // 返回结果
      return response;
    } catch (error) {
      // 根据错误类型进行不同处理
      if (error.message.includes('ECONNREFUSED') || 
          error.message.includes('ETIMEDOUT') || 
          error.message.includes('ECONNRESET') || 
          error.message.includes('socket')) {
        // 网络连接类错误
        this.logError(`[RCON管理器] 服务器 ${server.name} 网络连接错误: ${error.message}`);
        throw new Error(`无法连接到服务器 ${server.name}: ${error.message}`);
      } else if (error.message.includes('authentication')) {
        // 认证错误
        this.logError(`[RCON管理器] 服务器 ${server.name} 认证失败，请检查密码: ${error.message}`);
        throw new Error(`连接服务器 ${server.name} 失败: 认证错误，请联系管理员检查RCON密码`);
      } else {
        // 其他错误
        this.logError(`[RCON管理器] 服务器 ${server.name} 执行命令失败: ${error.message}`);
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
        this.logInfo(`[RCON管理器] 关闭服务器 ${serverName} 的空闲连接`);
        
        // 清除心跳定时器
        if (connectionInfo.heartbeatInterval) {
          clearInterval(connectionInfo.heartbeatInterval);
        }
        
        // 关闭连接
        try {
          await connectionInfo.rcon.end();
        } catch (error) {
          this.logDebug(`[RCON管理器] 关闭服务器 ${serverName} 的空闲连接时出错: ${error.message}`);
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
        this.logInfo(`[RCON管理器] 已关闭服务器 ${serverName} 的连接`);
      } catch (error) {
        this.logDebug(`[RCON管理器] 关闭服务器 ${serverName} 的连接时出错: ${error.message}`);
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

// 交互型绑定会话状态接口
interface BindingSession {
  userId: string
  channelId: string
  state: 'waiting_mc_username' | 'waiting_buid'
  startTime: number
  timeout: NodeJS.Timeout
  mcUsername?: string
  mcUuid?: string
  invalidInputCount?: number // 记录无效输入次数
}

// 天选开奖信息接口
interface LotteryWinner {
  uid: number
  username: string
  medal_level: number
}

interface LotteryResult {
  type: string
  lottery_id: string
  room_id: number
  reward_name: string
  reward_num: number
  message: string
  winners_count: number
  winners: LotteryWinner[]
  timestamp: number
  host_uid: number
  host_username: string
}

export function apply(ctx: Context, config: Config) {
  // 创建日志记录器
  const logger = new Logger('mcid-bot')
  
  // 交互型绑定会话管理
  const bindingSessions = new Map<string, BindingSession>()
  const BINDING_SESSION_TIMEOUT = 3 * 60 * 1000 // 3分钟超时
  
  // 日志辅助函数，根据debugMode控制输出
  const logDebug = (context: string, message: string): void => {
    if (config.debugMode) {
      logger.debug(`[${context}] ${message}`)
    }
  }
  
  const logInfo = (context: string, message: string, forceOutput: boolean = false): void => {
    // 只有在debugMode开启或forceOutput=true时才输出普通信息
    if (config.debugMode || forceOutput) {
      logger.info(`[${context}] ${message}`)
    }
  }
  
  const logWarn = (context: string, message: string): void => {
    // 警告总是输出
    logger.warn(`[${context}] ${message}`)
  }
  
  const logError = (context: string, userId: string, error: Error | string): void => {
    // 错误总是输出
    const errorMessage = error instanceof Error ? error.message : error
    const normalizedQQId = normalizeQQId(userId)
    logger.error(`[${context}] QQ(${normalizedQQId})操作失败: ${errorMessage}`)
  }
  
  // 操作记录函数 - 用于记录主要操作状态，减少日志量
  const logOperation = (operation: string, userId: string, success: boolean, details: string = ''): void => {
    const normalizedQQId = normalizeQQId(userId)
    const status = success ? '成功' : '失败'
    const message = `QQ(${normalizedQQId}) ${operation} ${status}${details ? ': ' + details : ''}`
    
    if (success) {
      // 成功的操作，只在debug模式下输出详情
      logInfo('操作', message, !config.debugMode && operation.includes('绑定'))
    } else {
      // 失败的操作总是输出
      logWarn('操作', message)
    }
  }
  
  // 创建头像缓存对象
  const avatarCache: Record<string, AvatarCache> = {}
  
  // 缓存有效期（12小时，单位毫秒）
  const CACHE_DURATION = 12 * 60 * 60 * 1000

  // 创建RCON连接管理器
  const rconManager = new RconManager(logger, config.servers || [], config.debugMode);
  
  // 创建RCON限流器实例
  const rconRateLimiter = new RateLimiter(10, 3000); // 3秒内最多10个请求
  
  // 会话管理辅助函数
  const createBindingSession = (userId: string, channelId: string): void => {
    const sessionKey = `${userId}_${channelId}`
    
    // 如果已有会话，先清理
    const existingSession = bindingSessions.get(sessionKey)
    if (existingSession) {
      clearTimeout(existingSession.timeout)
      bindingSessions.delete(sessionKey)
    }
    
    // 创建超时定时器
    const timeout = setTimeout(() => {
      bindingSessions.delete(sessionKey)
      // 发送超时消息
      ctx.bots.forEach(bot => {
        bot.sendMessage(channelId, [h.text('绑定会话已超时，请重新开始绑定流程')]).catch(() => {})
      })
      logger.info(`[交互绑定] QQ(${normalizeQQId(userId)})的绑定会话因超时被清理`)
    }, BINDING_SESSION_TIMEOUT)
    
    // 创建新会话
    const session: BindingSession = {
      userId: normalizeQQId(userId),
      channelId,
      state: 'waiting_mc_username',
      startTime: Date.now(),
      timeout
    }
    
    bindingSessions.set(sessionKey, session)
    logger.info(`[交互绑定] 为QQ(${normalizeQQId(userId)})创建了新的绑定会话`)
  }
  
  const getBindingSession = (userId: string, channelId: string): BindingSession | null => {
    const sessionKey = `${normalizeQQId(userId)}_${channelId}`
    return bindingSessions.get(sessionKey) || null
  }
  
  const updateBindingSession = (userId: string, channelId: string, updates: Partial<BindingSession>): void => {
    const sessionKey = `${normalizeQQId(userId)}_${channelId}`
    const session = bindingSessions.get(sessionKey)
    if (session) {
      Object.assign(session, updates)
    }
  }
  
  const removeBindingSession = (userId: string, channelId: string): void => {
    const sessionKey = `${normalizeQQId(userId)}_${channelId}`
    const session = bindingSessions.get(sessionKey)
    if (session) {
      clearTimeout(session.timeout)
      bindingSessions.delete(sessionKey)
      logger.info(`[交互绑定] 移除了QQ(${normalizeQQId(userId)})的绑定会话`)
    }
  }

  // 自动群昵称设置功能
  const autoSetGroupNickname = async (session: Session, mcUsername: string, buidUsername: string): Promise<void> => {
    try {
      const normalizedUserId = normalizeQQId(session.userId)
      const newNickname = `${buidUsername}（ID:${mcUsername}）`
      const targetGroupId = config.autoNicknameGroupId
      
      if (session.bot.internal && targetGroupId) {
        await session.bot.internal.setGroupCard(targetGroupId, session.userId, newNickname)
        logger.info(`[群昵称设置] 成功在群${targetGroupId}中将QQ(${normalizedUserId})群昵称设置为: ${newNickname}`)
      } else if (!session.bot.internal) {
        logger.debug(`[群昵称设置] QQ(${normalizedUserId})bot不支持OneBot内部API，跳过自动群昵称设置`)
      } else if (!targetGroupId) {
        logger.debug(`[群昵称设置] QQ(${normalizedUserId})未配置自动群昵称设置目标群，跳过群昵称设置`)
      }
    } catch (error) {
      const normalizedUserId = normalizeQQId(session.userId)
      logger.warn(`[群昵称设置] QQ(${normalizedUserId})自动群昵称设置失败: ${error.message}`)
    }
  }

  // 检查是否为无关输入
  const checkIrrelevantInput = (bindingSession: BindingSession, content: string): boolean => {
    if (!content) return false
    
    // 常见的聊天用语或明显无关的内容
    const chatKeywords = ['你好', 'hello', 'hi', '在吗', '在不在', '怎么样', '什么', '为什么', '好的', '谢谢', '哈哈', '呵呵']
    const lowercaseContent = content.toLowerCase()
    
    // 检查是否包含明显的聊天用语
    if (chatKeywords.some(keyword => lowercaseContent.includes(keyword))) {
      return true
    }
    
    if (bindingSession.state === 'waiting_mc_username') {
      // MC用户名检查
      // 长度明显不符合MC用户名规范（3-16位）
      if (content.length < 2 || content.length > 20) {
        return true
      }
      // 包含中文或其他明显不是MC用户名的字符
      if (/[\u4e00-\u9fa5]/.test(content) || content.includes(' ') || content.includes('@')) {
        return true
      }
      // 如果是明显的指令格式
      if (content.startsWith('.') || content.startsWith('/') || content.startsWith('mcid') || content.startsWith('buid')) {
        return true
      }
    } else if (bindingSession.state === 'waiting_buid') {
      // B站UID检查
      // 移除UID:前缀后检查
      let actualContent = content
      if (content.toLowerCase().startsWith('uid:')) {
        actualContent = content.substring(4)
      }
      // 如果不是纯数字且不是跳过命令
      if (!/^\d+$/.test(actualContent) && content !== '跳过' && content !== 'skip') {
        // 检查是否明显是聊天内容（包含字母、中文、空格等）
        if (/[a-zA-Z\u4e00-\u9fa5\s]/.test(content) && !content.toLowerCase().startsWith('uid:')) {
          return true
        }
        // 如果是明显的指令格式
        if (content.startsWith('.') || content.startsWith('/') || content.startsWith('mcid') || content.startsWith('buid')) {
          return true
        }
      }
    }
    
    return false
  }
  
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

  // 注册天选开奖 Webhook
  ctx.server.post('/lottery', async (content) => {
    try {
      logger.info(`[天选开奖] 收到天选开奖webhook请求`)
      
      // 检查天选播报开关
      if (!config?.enableLotteryBroadcast) {
        logger.info(`[天选开奖] 天选播报功能已禁用，忽略webhook请求`)
        content.status = 200
        content.body = 'Lottery broadcast disabled'
        return
      }
      
      // 检查请求头
      const userAgent = content.header['user-agent'] || content.header['User-Agent']
      if (userAgent && !userAgent.includes('ZMINFO-EventBridge')) {
        logger.warn(`[天选开奖] 无效的User-Agent: ${userAgent}`)
        content.status = 400
        content.body = 'Invalid User-Agent'
        return
      }
      
      // 解析请求数据
      let lotteryData: LotteryResult
      try {
        // 如果是字符串，尝试解析为JSON
        if (typeof content.request.body === 'string') {
          lotteryData = JSON.parse(content.request.body)
        } else {
          lotteryData = content.request.body as LotteryResult
        }
      } catch (parseError) {
        logger.error(`[天选开奖] 解析请求数据失败: ${parseError.message}`)
        content.status = 400
        content.body = 'Invalid JSON format'
        return
      }
      
      // 验证数据格式
      if (!lotteryData.type || lotteryData.type !== 'lottery-result') {
        logger.warn(`[天选开奖] 无效的事件类型: ${lotteryData.type}`)
        content.status = 400
        content.body = 'Invalid event type'
        return
      }
      
      if (!lotteryData.lottery_id || !lotteryData.winners || !Array.isArray(lotteryData.winners)) {
        logger.warn(`[天选开奖] 数据格式不完整`)
        content.status = 400
        content.body = 'Incomplete data format'
        return
      }
      
      // 记录接收的数据
      if (config.debugMode) {
        logger.debug(`[天选开奖] 接收到的数据: ${JSON.stringify(lotteryData, null, 2)}`)
      } else {
        logger.info(`[天选开奖] 接收到天选事件: ${lotteryData.lottery_id}，奖品: ${lotteryData.reward_name}，中奖人数: ${lotteryData.winners.length}`)
      }
      
      // 异步处理天选开奖数据（不阻塞响应）
      handleLotteryResult(lotteryData).catch(error => {
        logger.error(`[天选开奖] 异步处理天选开奖数据失败: ${error.message}`)
      })
      
      // 立即返回成功响应
      content.status = 200
      content.body = 'OK'
      
    } catch (error) {
      logger.error(`[天选开奖] 处理webhook请求失败: ${error.message}`)
      content.status = 500
      content.body = 'Internal Server Error'
    }
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
    tags: {
      type: 'json',
      initial: [],
    },
    // BUID相关字段
    buidUid: {
      type: 'string',
      initial: '',
    },
    buidUsername: {
      type: 'string',
      initial: '',
    },
    guardLevel: {
      type: 'integer',
      initial: 0,
    },
    guardLevelText: {
      type: 'string',
      initial: '',
    },
    maxGuardLevel: {
      type: 'integer',
      initial: 0,
    },
    maxGuardLevelText: {
      type: 'string',
      initial: '',
    },
    medalName: {
      type: 'string',
      initial: '',
    },
    medalLevel: {
      type: 'integer',
      initial: 0,
    },
    wealthMedalLevel: {
      type: 'integer',
      initial: 0,
    },
    lastActiveTime: {
      type: 'timestamp',
      initial: null,
    },
  }, {
    // 设置主键为qqId
    primary: 'qqId',
    // 添加索引
    unique: [['mcUsername'], ['buidUid']],
    // 添加isAdmin索引，提高查询效率
    indexes: [['isAdmin'], ['buidUid']],
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
      
      // 更新每个缺少字段的记录
      for (const record of records) {
        let needUpdate = false
        const updateData: any = {}
        
        // 检查并添加whitelist字段
        if (!record.whitelist) {
          updateData.whitelist = []
          needUpdate = true
        }
        
        // 检查并添加tags字段
        if (!record.tags) {
          updateData.tags = []
          needUpdate = true
        }
        
        // 检查并添加maxGuardLevel字段
        if (!('maxGuardLevel' in record)) {
          updateData.maxGuardLevel = 0
          needUpdate = true
        }
        
        // 检查并添加maxGuardLevelText字段
        if (!('maxGuardLevelText' in record)) {
          updateData.maxGuardLevelText = ''
          needUpdate = true
        }
        
        // 如果需要更新，执行更新操作
        if (needUpdate) {
          await ctx.database.set('mcidbind', { qqId: record.qqId }, updateData)
          updatedCount++
        }
      }
      
      if (updatedCount > 0) {
        logger.info(`[初始化] 成功为${updatedCount}条记录添加缺失字段`)
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
            whitelist: record.whitelist || [],
            tags: record.tags || []
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
    
    // 处理 <at id="..."/> 格式的@用户字符串
    const atMatch = userId.match(/<at id="(\d+)"\s*\/>/)
    if (atMatch) {
      return atMatch[1]
    }
    
    // 如果包含冒号，说明有平台前缀(如 onebot:123456)
    const colonIndex = userId.indexOf(':')
    if (colonIndex !== -1) {
      // 返回冒号后面的部分，即纯QQ号
      return userId.substring(colonIndex + 1)
    }
    return userId
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
        logError('消息', 'system', '无效的会话对象')
        return
      }
      
      // 检查是否为群聊消息
      const isGroupMessage = session.channelId && !session.channelId.startsWith('private:');
      const normalizedQQId = normalizeQQId(session.userId)
      
      // 处理私聊和群聊的消息格式
      const promptMessage = session.channelId?.startsWith('private:')
        ? [h.quote(session.messageId), ...content]
        : [h.quote(session.messageId), h.at(session.userId), '\n', ...content]

      // 发送消息并获取返回的消息ID
      const messageResult = await session.send(promptMessage)
      
      if (config.debugMode) {
        logDebug('消息', `成功向QQ(${normalizedQQId})发送消息，频道: ${session.channelId}`)
      }
      
      // 只在自动撤回时间大于0和存在bot对象时处理撤回
      if (config.autoRecallTime > 0 && session.bot) {
        // 处理撤回用户消息 - 只在群聊中且开启了用户消息撤回时
        if (config.recallUserMessage && isGroupMessage && session.messageId) {
          setTimeout(async () => {
            try {
              await session.bot.deleteMessage(session.channelId, session.messageId)
              if (config.debugMode) {
                logDebug('消息', `成功撤回用户QQ(${normalizedQQId})的指令消息 ${session.messageId}`)
              }
            } catch (userRecallError) {
              logError('消息', normalizedQQId, `撤回用户指令消息 ${session.messageId} 失败: ${userRecallError.message}`)
            }
          }, config.autoRecallTime * 1000)
          
          if (config.debugMode) {
            logDebug('消息', `已设置 ${config.autoRecallTime} 秒后自动撤回用户QQ(${normalizedQQId})的群聊指令消息 ${session.messageId}`)
          }
        }
        
        // 处理撤回机器人消息 - 只在群聊中撤回机器人自己的消息
        if (isGroupMessage && messageResult) {
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
                if (config.debugMode) {
                  logDebug('消息', `成功撤回机器人消息 ${messageId}`)
                }
              } catch (recallError) {
                logError('消息', normalizedQQId, `撤回机器人消息 ${messageId} 失败: ${recallError.message}`)
              }
            }, config.autoRecallTime * 1000)
            
            if (config.debugMode) {
              logDebug('消息', `已设置 ${config.autoRecallTime} 秒后自动撤回机器人消息 ${messageId}`)
            }
          } else if (config.debugMode) {
            logWarn('消息', `无法获取消息ID，自动撤回功能无法生效`)
          }
        } else if (config.debugMode) {
          logDebug('消息', `检测到私聊消息，不撤回机器人回复`)
        }
      }
    } catch (error) {
      const normalizedUserId = normalizeQQId(session.userId)
      logError('消息', normalizedUserId, `向QQ(${normalizedUserId})发送消息失败: ${error.message}`)
    }
  }

  // 检查冷却时间
  const checkCooldown = (lastModified: Date | null, multiplier: number = 1): boolean => {
    if (!lastModified) return true
    const now = new Date()
    const diffTime = now.getTime() - lastModified.getTime()
    // 使用Math.floor确保冷却时间精确
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24))
    return diffDays >= config.cooldownDays * multiplier
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
  
  // 删除MCIDBIND表中的绑定信息 (同时解绑MC和B站账号)
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
        // 删除整个绑定记录，包括MC和B站账号
        const result = await ctx.database.remove('mcidbind', { qqId: normalizedQQId })
        
        // 检查是否真正删除成功
        if (result) {
          let logMessage = `[MCIDBIND] 删除绑定: QQ=${normalizedQQId}`
          if (bind.mcUsername) logMessage += `, MC用户名=${bind.mcUsername}`
          if (bind.buidUid) logMessage += `, B站UID=${bind.buidUid}(${bind.buidUsername})`
          logger.info(logMessage)
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
            error.response?.status === 429 || // 添加429 (Too Many Requests)
            error.response?.status === 403)) { // 添加403 (Forbidden)
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

  // 获取MC头图URL
  const getCrafatarUrl = (uuid: string): string | null => {
    if (!uuid) return null
    
    // 检查UUID格式 (不带连字符应为32位，带连字符应为36位)
    const uuidRegex = /^[0-9a-f]{32}$|^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(uuid)) {
      logger.warn(`[MC头图] UUID "${uuid}" 格式无效，无法生成头图URL`)
      return null
    }
    
    // 移除任何连字符，Crafatar接受不带连字符的UUID
    const cleanUuid = uuid.replace(/-/g, '')
    
    // 直接生成URL
    const url = `https://crafatar.com/avatars/${cleanUuid}`
    
    logger.debug(`[MC头图] 为UUID "${cleanUuid}" 生成头图URL`)
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

  // =========== BUID相关功能 ===========
  
  // 验证BUID是否存在
  const validateBUID = async (buid: string): Promise<ZminfoUser | null> => {
    try {
      if (!buid || !/^\d+$/.test(buid)) {
        logWarn('B站账号验证', `无效的B站UID格式: ${buid}`)
        return null
      }

      logDebug('B站账号验证', `验证B站UID: ${buid}`)
      
      const response = await axios.get(`${config.zminfoApiUrl}/api/user/${buid}`, {
        timeout: 10000,
        headers: {
          'User-Agent': 'Koishi-MCID-Bot/1.0'
        }
      })

      if (response.data.success && response.data.data && response.data.data.user) {
        const user = response.data.data.user
        logDebug('B站账号验证', `B站UID ${buid} 验证成功: ${user.username}`)
        return user
      } else {
        logWarn('B站账号验证', `B站UID ${buid} 不存在或API返回失败: ${response.data.message}`)
        return null
      }
    } catch (error) {
      if (error.response?.status === 404) {
        logWarn('B站账号验证', `B站UID ${buid} 不存在`)
        return null
      }
      
      logError('B站账号验证', 'system', `验证B站UID ${buid} 时出错: ${error.message}`)
      throw new Error(`无法验证B站UID: ${error.message}`)
    }
  }

  // 根据B站UID查询绑定信息
  const getBuidBindByBuid = async (buid: string): Promise<MCIDBIND | null> => {
    try {
      if (!buid) {
        logger.warn(`[B站账号绑定] 尝试查询空B站UID`)
        return null
      }
      
      const binds = await ctx.database.get('mcidbind', { buidUid: buid })
      return binds.length > 0 ? binds[0] : null
    } catch (error) {
      logError('B站账号绑定', 'system', `根据B站UID(${buid})查询绑定信息失败: ${error.message}`)
      return null
    }
  }

  // 检查B站UID是否已被绑定
  const checkBuidExists = async (buid: string, currentUserId?: string): Promise<boolean> => {
    try {
      const bind = await getBuidBindByBuid(buid)
      if (!bind) return false
      
      // 如果指定了当前用户ID，则排除当前用户的绑定
      if (currentUserId) {
        const normalizedCurrentId = normalizeQQId(currentUserId)
        return bind.qqId !== normalizedCurrentId
      }
      
      return true
    } catch (error) {
      logError('B站账号绑定', 'system', `检查B站UID(${buid})是否存在时出错: ${error.message}`)
      return false
    }
  }

  // 创建或更新B站账号绑定
  const createOrUpdateBuidBind = async (userId: string, buidUser: ZminfoUser): Promise<boolean> => {
    try {
      const normalizedQQId = normalizeQQId(userId)
      if (!normalizedQQId) {
        logger.error(`[B站账号绑定] 创建/更新绑定失败: 无法提取有效的QQ号`)
        return false
      }
      // 查询是否已存在绑定记录
      let bind = await getMcBindByQQId(normalizedQQId)
      const updateData: any = {
        buidUid: buidUser.uid,
        buidUsername: buidUser.username,
        guardLevel: buidUser.guard_level || 0,
        guardLevelText: buidUser.guard_level_text || '',
        maxGuardLevel: buidUser.max_guard_level || 0,
        maxGuardLevelText: buidUser.max_guard_level_text || '',
        medalName: buidUser.medal?.name || '',
        medalLevel: buidUser.medal?.level || 0,
        wealthMedalLevel: buidUser.wealthMedalLevel || 0,
        lastActiveTime: buidUser.last_active_time ? new Date(buidUser.last_active_time) : new Date(),
        lastModified: new Date()
      }
      if (bind) {
        await ctx.database.set('mcidbind', { qqId: normalizedQQId }, updateData)
        logger.info(`[B站账号绑定] 更新绑定: QQ=${normalizedQQId}, B站UID=${buidUser.uid}, 用户名=${buidUser.username}`)
      } else {
        // 允许mcUsername为空字符串
        const newBind: any = {
          qqId: normalizedQQId,
          mcUsername: '',
          mcUuid: '',
          isAdmin: false,
          whitelist: [],
          tags: [],
          ...updateData
        }
        await ctx.database.create('mcidbind', newBind)
        logger.info(`[B站账号绑定] 创建绑定: QQ=${normalizedQQId}, B站UID=${buidUser.uid}, 用户名=${buidUser.username}`)
      }
      return true
    } catch (error) {
      logError('B站账号绑定', userId, `创建/更新B站账号绑定失败: ${error.message}`)
      return false
    }
  }

  // 仅更新B站信息，不更新绑定时间（用于查询时刷新数据）
  const updateBuidInfoOnly = async (userId: string, buidUser: ZminfoUser): Promise<boolean> => {
    try {
      const normalizedQQId = normalizeQQId(userId)
      if (!normalizedQQId) {
        logger.error(`[B站账号信息更新] 更新失败: 无法提取有效的QQ号`)
        return false
      }
      
      // 查询是否已存在绑定记录
      const bind = await getMcBindByQQId(normalizedQQId)
      if (!bind) {
        logger.warn(`[B站账号信息更新] QQ(${normalizedQQId})没有绑定记录，无法更新B站信息`)
        return false
      }
      
      // 仅更新B站相关字段，不更新lastModified
      const updateData: any = {
        buidUsername: buidUser.username,
        guardLevel: buidUser.guard_level || 0,
        guardLevelText: buidUser.guard_level_text || '',
        maxGuardLevel: buidUser.max_guard_level || 0,
        maxGuardLevelText: buidUser.max_guard_level_text || '',
        medalName: buidUser.medal?.name || '',
        medalLevel: buidUser.medal?.level || 0,
        wealthMedalLevel: buidUser.wealthMedalLevel || 0,
        lastActiveTime: buidUser.last_active_time ? new Date(buidUser.last_active_time) : new Date()
      }
      
      await ctx.database.set('mcidbind', { qqId: normalizedQQId }, updateData)
      logger.info(`[B站账号信息更新] 刷新信息: QQ=${normalizedQQId}, B站UID=${bind.buidUid}, 用户名=${buidUser.username}`)
      return true
    } catch (error) {
      logError('B站账号信息更新', userId, `更新B站账号信息失败: ${error.message}`)
      return false
    }
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
      
      // 尝试识别以机器人昵称开头的mcid或buid命令
      let matchedCommand = null
      
      // 1. 尝试匹配原始的botNickname格式（支持mcid和buid命令）
      const regularPrefixRegex = new RegExp(`^${escapeRegExp(botNickname)}\\s+((mcid|buid)\\s+.*)$`, 'i')
      const regularMatch = content.match(regularPrefixRegex)
      
      // 2. 如果botNickname不包含@，也尝试匹配带@的版本
      const atPrefixRegex = !botNickname.startsWith('@') ? 
        new RegExp(`^@${escapeRegExp(botNickname)}\\s+((mcid|buid)\\s+.*)$`, 'i') : 
        null
      
      if (regularMatch && regularMatch[1]) {
        matchedCommand = regularMatch[1].trim()
      } else if (atPrefixRegex) {
        const atMatch = content.match(atPrefixRegex)
        if (atMatch && atMatch[1]) {
          matchedCommand = atMatch[1].trim()
        }
      }
      
      // 如果找到匹配的命令，执行它
      if (matchedCommand) {
        const commandType = matchedCommand.startsWith('mcid') ? 'mcid' : 'buid'
        logger.info(`[前缀匹配] 成功识别${commandType}命令，原始消息: "${content}"，执行命令: "${matchedCommand}"`)
        
        // 使用session.execute方法主动触发命令执行
        session.execute(matchedCommand).catch(error => {
          logger.error(`[前缀匹配] 执行命令"${matchedCommand}"失败: ${error.message}`)
        })
        
        // 返回终止后续中间件处理，避免重复处理
        return 
      }
      
      return next()
    })
  }

  // 交互型绑定会话处理中间件
  ctx.middleware(async (session, next) => {
    try {
      // 检查是否有进行中的绑定会话
      const bindingSession = getBindingSession(session.userId, session.channelId)
      if (!bindingSession) {
        return next()
      }
      
      const normalizedUserId = normalizeQQId(session.userId)
      const content = session.content?.trim()
      
      // 处理取消命令
      if (content === '取消' || content === 'cancel') {
        removeBindingSession(session.userId, session.channelId)
        logger.info(`[交互绑定] QQ(${normalizedUserId})手动取消了绑定会话`)
        await sendMessage(session, [h.text('❌ 绑定会话已取消')])
        return
      }
      
      // 检查是否在绑定过程中使用了其他绑定相关命令
      if (content && (
        content.includes('绑定') || 
        content.includes('bind') || 
        content.includes('mcid') || 
        content.includes('buid') ||
        content.startsWith('.') ||
        content.startsWith('/')
      )) {
        const currentState = bindingSession.state === 'waiting_mc_username' ? 'MC用户名' : 'B站UID'
        await sendMessage(session, [h.text(`🔄 您正在进行交互式绑定，请继续输入${currentState}\n\n如需取消当前绑定，请发送"取消"`)])
        return
      }
      
      // 检查是否为明显无关的输入
      const isIrrelevantInput = checkIrrelevantInput(bindingSession, content)
      if (isIrrelevantInput) {
        const currentCount = bindingSession.invalidInputCount || 0
        const newCount = currentCount + 1
        
        updateBindingSession(session.userId, session.channelId, {
          invalidInputCount: newCount
        })
        
        if (newCount === 1) {
          // 第1次无关输入，提醒检查
          const expectedInput = bindingSession.state === 'waiting_mc_username' ? 'MC用户名' : 'B站UID'
          await sendMessage(session, [h.text(`🤔 您当前正在进行绑定流程，需要输入${expectedInput}\n\n如果您想取消绑定，请发送"取消"`)])
          return
        } else if (newCount >= 2) {
          // 第2次无关输入，建议取消
          removeBindingSession(session.userId, session.channelId)
          logger.info(`[交互绑定] QQ(${normalizedUserId})因多次无关输入自动取消绑定会话`)
          await sendMessage(session, [h.text('🔄 检测到您可能不想继续绑定流程，已自动取消绑定会话\n\n如需重新绑定，请使用 ' + formatCommand('mcid 绑定') + ' 命令')])
          return
        }
      }
      
      // 根据当前状态处理用户输入
      if (bindingSession.state === 'waiting_mc_username') {
        // 处理MC用户名输入
        await handleMcUsernameInput(session, bindingSession, content)
        return
      } else if (bindingSession.state === 'waiting_buid') {
        // 处理B站UID输入
        await handleBuidInput(session, bindingSession, content)
        return
      }
      
      return next()
    } catch (error) {
      const normalizedUserId = normalizeQQId(session.userId)
      logger.error(`[交互绑定] QQ(${normalizedUserId})的会话处理出错: ${error.message}`)
      removeBindingSession(session.userId, session.channelId)
      await sendMessage(session, [h.text('绑定过程中出现错误，会话已重置')])
      return
    }
  })

  // 处理MC用户名输入
  const handleMcUsernameInput = async (session: Session, bindingSession: BindingSession, content: string): Promise<void> => {
    const normalizedUserId = normalizeQQId(session.userId)
    
    // 验证用户名格式
    if (!content || !/^[a-zA-Z0-9_]{3,16}$/.test(content)) {
      logger.warn(`[交互绑定] QQ(${normalizedUserId})输入的MC用户名"${content}"格式无效`)
      await sendMessage(session, [h.text('❌ 用户名格式无效，请重新输入')])
      return
    }
    
    // 验证用户名是否存在
    const profile = await validateUsername(content)
    if (!profile) {
      logger.warn(`[交互绑定] QQ(${normalizedUserId})输入的MC用户名"${content}"不存在`)
      await sendMessage(session, [h.text(`❌ 用户名 ${content} 不存在`)])
      return
    }
    
    const username = profile.name
    const uuid = profile.id
    
    // 检查用户是否已绑定MC账号
    const existingBind = await getMcBindByQQId(normalizedUserId)
    if (existingBind && existingBind.mcUsername && !existingBind.mcUsername.startsWith('_temp_')) {
      // 检查冷却时间
      if (!await isAdmin(session.userId) && !checkCooldown(existingBind.lastModified, 3)) {
        const days = config.cooldownDays * 3
        const now = new Date()
        const diffTime = now.getTime() - existingBind.lastModified.getTime()
        const passedDays = Math.floor(diffTime / (1000 * 60 * 60 * 24))
        const remainingDays = days - passedDays
        
        removeBindingSession(session.userId, session.channelId)
        await sendMessage(session, [h.text(`❌ 您已绑定MC账号: ${existingBind.mcUsername}\n\n如需修改，请在冷却期结束后(还需${remainingDays}天)使用 ${formatCommand('mcid change')} 命令或联系管理员`)])
        return
      }
    }
    
    // 检查用户名是否已被其他人绑定
    if (await checkUsernameExists(username, session.userId)) {
      logger.warn(`[交互绑定] MC用户名"${username}"已被其他用户绑定`)
      await sendMessage(session, [h.text(`❌ 用户名 ${username} 已被其他用户绑定\n\n请输入其他MC用户名`)])
      return
    }
    
    // 绑定MC账号
    const bindResult = await createOrUpdateMcBind(session.userId, username, uuid)
    if (!bindResult) {
      logger.error(`[交互绑定] QQ(${normalizedUserId})绑定MC账号失败`)
      removeBindingSession(session.userId, session.channelId)
      await sendMessage(session, [h.text('❌ 绑定失败，数据库操作出错\n\n请联系管理员或稍后重试')])
      return
    }
    
    logger.info(`[交互绑定] QQ(${normalizedUserId})成功绑定MC账号: ${username}`)
    
    // 更新会话状态
    updateBindingSession(session.userId, session.channelId, {
      state: 'waiting_buid',
      mcUsername: username,
      mcUuid: uuid
    })
    
    // 根据配置决定显示哪种图像
    let mcAvatarUrl = null
    if (config?.showAvatar) {
      if (config?.showMcSkin) {
        mcAvatarUrl = getStarlightSkinUrl(username)
      } else {
        mcAvatarUrl = getCrafatarUrl(uuid)
      }
    }
    
    const formattedUuid = formatUuid(uuid)
    
    // 发送简化的MC绑定成功消息
    await sendMessage(session, [
      h.text(`✅ MC账号: ${username}\n请发送您的B站UID`),
      ...(mcAvatarUrl ? [h.image(mcAvatarUrl)] : [])
    ])
  }



  // 处理B站UID输入
  const handleBuidInput = async (session: Session, bindingSession: BindingSession, content: string): Promise<void> => {
    const normalizedUserId = normalizeQQId(session.userId)
    
    // 处理跳过B站绑定
    if (content === '跳过' || content === 'skip') {
      removeBindingSession(session.userId, session.channelId)
      logger.info(`[交互绑定] QQ(${normalizedUserId})跳过了B站账号绑定`)
      await sendMessage(session, [h.text('✅ 交互式绑定完成！\n\n您已成功绑定MC账号，B站账号绑定已跳过\n可以随时使用 ' + formatCommand('buid bind <UID>') + ' 命令单独绑定B站账号')])
      return
    }
    
    // 解析UID格式
    let actualUid = content
    if (content && content.toLowerCase().startsWith('uid:')) {
      actualUid = content.substring(4)
    }
    
    // 验证UID格式
    if (!actualUid || !/^\d+$/.test(actualUid)) {
      logger.warn(`[交互绑定] QQ(${normalizedUserId})输入的B站UID"${content}"格式无效`)
      await sendMessage(session, [h.text('❌ UID格式无效，请重新输入')])
      return
    }
    
    // 检查UID是否已被绑定
    if (await checkBuidExists(actualUid, session.userId)) {
      logger.warn(`[交互绑定] B站UID"${actualUid}"已被其他用户绑定`)
      await sendMessage(session, [h.text(`❌ UID ${actualUid} 已被其他用户绑定\n\n请输入其他B站UID或发送"跳过"跳过B站绑定`)])
      return
    }
    
    // 验证UID是否存在
    const buidUser = await validateBUID(actualUid)
    if (!buidUser) {
      logger.warn(`[交互绑定] QQ(${normalizedUserId})输入的B站UID"${actualUid}"不存在`)
      await sendMessage(session, [h.text(`❌ 无法验证UID: ${actualUid}\n\n该用户可能不存在或未被发现\n建议去直播间逛一圈，发个弹幕后再绑定\n或发送"跳过"跳过B站绑定`)])
      return
    }
    
    // 绑定B站账号
    const bindResult = await createOrUpdateBuidBind(session.userId, buidUser)
    if (!bindResult) {
      logger.error(`[交互绑定] QQ(${normalizedUserId})绑定B站账号失败`)
      removeBindingSession(session.userId, session.channelId)
      await sendMessage(session, [h.text('❌ B站账号绑定失败，数据库操作出错\n\n但您的MC账号已成功绑定\n可稍后使用 ' + formatCommand('buid bind <UID>') + ' 命令单独绑定B站账号')])
      return
    }
    
    logger.info(`[交互绑定] QQ(${normalizedUserId})成功绑定B站UID: ${actualUid}`)
    
    // 清理会话
    removeBindingSession(session.userId, session.channelId)
    
    // 自动群昵称设置功能 - 使用OneBot API
    try {
      const newNickname = `${buidUser.username}（ID:${bindingSession.mcUsername}）`
      const targetGroupId = config.autoNicknameGroupId // 使用配置的群ID
      
      if (session.bot.internal && targetGroupId) {
        let groupsToUpdate = []
        
        // 只在指定群设置昵称
        groupsToUpdate.push(targetGroupId)
        logger.info(`[交互绑定] QQ(${normalizedUserId})绑定完成，将在群${targetGroupId}中设置昵称`)
        
        // 为每个群设置昵称
        for (const groupId of groupsToUpdate) {
          try {
            await session.bot.internal.setGroupCard(groupId, session.userId, newNickname)
            logger.info(`[交互绑定] 成功在群${groupId}中将QQ(${normalizedUserId})群昵称设置为: ${newNickname}`)
          } catch (groupError) {
            logger.warn(`[交互绑定] 在群${groupId}中设置QQ(${normalizedUserId})群昵称失败: ${groupError.message}`)
          }
        }
      } else if (!session.bot.internal) {
        logger.debug(`[交互绑定] QQ(${normalizedUserId})bot不支持OneBot内部API，跳过自动群昵称设置`)
      } else if (!targetGroupId) {
        logger.debug(`[交互绑定] QQ(${normalizedUserId})未配置自动群昵称设置目标群，跳过群昵称设置`)
      }
    } catch (renameError) {
      logger.warn(`[交互绑定] QQ(${normalizedUserId})自动群昵称设置失败: ${renameError.message}`)
      // 群昵称设置失败不影响主流程，只记录日志
    }
    
    // 发送完整的绑定成功消息
    const buidInfo = `B站UID: ${buidUser.uid}\n用户名: ${buidUser.username}`
    let extraInfo = ''
    if (buidUser.guard_level > 0) {
      extraInfo += `\n舰长等级: ${buidUser.guard_level_text} (${buidUser.guard_level})`
    }
    if (buidUser.medal) {
      extraInfo += `\n粉丝牌: ${buidUser.medal.name} Lv.${buidUser.medal.level}`
    }
    if (buidUser.wealthMedalLevel > 0) {
      extraInfo += `\n荣耀等级: ${buidUser.wealthMedalLevel}`
    }
    
    await sendMessage(session, [
      h.text(`🎉 绑定完成！\nMC: ${bindingSession.mcUsername}\nB站: ${buidUser.username}${extraInfo}`),
      ...(config?.showAvatar ? [h.image(`https://workers.vrp.moe/bilibili/avatar/${buidUser.uid}?size=160`)] : [])
    ])
  }

  // 帮助函数：转义正则表达式中的特殊字符
  const escapeRegExp = (string: string): string => {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  // 查询MC账号命令
  cmd.subcommand('.query [target:string]', '查询用户绑定的MC账号')
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
          
          // 根据配置决定显示哪种图像
          let mcAvatarUrl = null
          if (config?.showAvatar) {
            if (config?.showMcSkin) {
              // 显示皮肤渲染图
              mcAvatarUrl = getStarlightSkinUrl(updatedBind.mcUsername)
            } else {
              // 显示头图
              mcAvatarUrl = getCrafatarUrl(updatedBind.mcUuid)
            }
          }
          
          // 添加获取白名单服务器信息
          let whitelistInfo = '';
          if (updatedBind.whitelist && updatedBind.whitelist.length > 0) {
            // 圈数字映射（1-10），用于美化显示
            const circledNumbers = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];
            
            const serverList = updatedBind.whitelist.map((serverId, index) => {
              const server = getServerConfigById(serverId);
              
              // 检查服务器是否存在且启用
              if (!server) {
                // 尝试获取服务器配置（不考虑启用状态）
                const disabledServer = config.servers?.find(s => s.id === serverId);
                if (disabledServer && disabledServer.enabled === false) {
                  return `${index < circledNumbers.length ? circledNumbers[index] : (index+1)} ${disabledServer.name} [已停用]`;
                }
                return `${index < circledNumbers.length ? circledNumbers[index] : (index+1)} 未知服务器(ID: ${serverId})`;
              }
              
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
          
          // 添加BUID信息
          let buidInfo = ''
          let buidAvatar = null
          if (updatedBind.buidUid) {
            buidInfo = `B站账号信息：\nB站UID: ${updatedBind.buidUid}\n用户名: ${updatedBind.buidUsername}`
            if (updatedBind.guardLevel > 0) {
              buidInfo += `\n舰长等级: ${updatedBind.guardLevelText} (${updatedBind.guardLevel})`
            }
            if (updatedBind.medalName) {
              buidInfo += `\n粉丝牌: ${updatedBind.medalName} Lv.${updatedBind.medalLevel}`
            }
            // 不再显示最后活跃时间
            if (config?.showAvatar) {
              buidAvatar = h.image(`https://workers.vrp.moe/bilibili/avatar/${updatedBind.buidUid}?size=160`)
            }
          } else {
            buidInfo = `该用户尚未绑定B站账号`
          }
          
          logger.info(`[查询] QQ(${normalizedTargetId})的MC账号信息：用户名=${updatedBind.mcUsername}, UUID=${updatedBind.mcUuid}`)
          
          // 如果MC和B站都已绑定，进行自动群昵称设置
          if (updatedBind.mcUsername && updatedBind.buidUid && updatedBind.buidUsername) {
            await autoSetGroupNickname(session, updatedBind.mcUsername, updatedBind.buidUsername)
          } else if (!updatedBind.buidUid) {
            // 如果未绑定B站账号，提示绑定
            logger.info(`[查询] QQ(${normalizedTargetId})未绑定B站账号，跳过群昵称设置`)
          }
          
          // 按照用户期望的顺序发送消息：MC账号信息 -> MC头图 -> B站账号信息 -> B站头像
          const messageElements = [
            h.text(`用户 ${normalizedTargetId} 的MC账号信息：\n用户名: ${updatedBind.mcUsername}\nUUID: ${formattedUuid}${whitelistInfo}`),
            ...(mcAvatarUrl ? [h.image(mcAvatarUrl)] : []),
            h.text(buidInfo),
            ...(buidAvatar ? [buidAvatar] : [])
          ]
          
          return sendMessage(session, messageElements)
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
        
        // 根据配置决定显示哪种图像
        let mcAvatarUrl = null
        if (config?.showAvatar) {
          if (config?.showMcSkin) {
            // 显示皮肤渲染图
            mcAvatarUrl = getStarlightSkinUrl(updatedBind.mcUsername)
          } else {
            // 显示头图
            mcAvatarUrl = getCrafatarUrl(updatedBind.mcUuid)
          }
        }
        
        // 添加获取白名单服务器信息
        let whitelistInfo = '';
        if (updatedBind.whitelist && updatedBind.whitelist.length > 0) {
          // 圈数字映射（1-10），用于美化显示
          const circledNumbers = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];
          
          const serverList = updatedBind.whitelist.map((serverId, index) => {
            const server = getServerConfigById(serverId);
            
            // 检查服务器是否存在且启用
            if (!server) {
              // 尝试获取服务器配置（不考虑启用状态）
              const disabledServer = config.servers?.find(s => s.id === serverId);
              if (disabledServer && disabledServer.enabled === false) {
                return `${index < circledNumbers.length ? circledNumbers[index] : (index+1)} ${disabledServer.name} [已停用]`;
              }
              return `${index < circledNumbers.length ? circledNumbers[index] : (index+1)} 未知服务器(ID: ${serverId})`;
            }
            
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
        
                          // 准备B站账号信息
        let buidInfo = ''
        let buidAvatar = null
        if (updatedBind.buidUid) {
          buidInfo = `B站账号信息：\nB站UID: ${updatedBind.buidUid}\n用户名: ${updatedBind.buidUsername}`
          if (updatedBind.guardLevel > 0) {
            buidInfo += `\n舰长等级: ${updatedBind.guardLevelText} (${updatedBind.guardLevel})`
            // 只有当历史最高等级比当前等级更高时才显示（数值越小等级越高）
            if (updatedBind.maxGuardLevel > 0 && updatedBind.maxGuardLevel < updatedBind.guardLevel) {
              buidInfo += `\n历史最高: ${updatedBind.maxGuardLevelText} (${updatedBind.maxGuardLevel})`
            }
          } else if (updatedBind.maxGuardLevel > 0) {
            // 当前无舰长但有历史记录，显示历史最高
            buidInfo += `\n历史舰长: ${updatedBind.maxGuardLevelText} (${updatedBind.maxGuardLevel})`
          }
          if (updatedBind.medalName) {
            buidInfo += `\n粉丝牌: ${updatedBind.medalName} Lv.${updatedBind.medalLevel}`
          }
                      if (config?.showAvatar) {
              buidAvatar = h.image(`https://workers.vrp.moe/bilibili/avatar/${updatedBind.buidUid}?size=160`)
            }
        } else {
          buidInfo = `您尚未绑定B站账号，使用 ${formatCommand('buid bind <B站UID>')} 进行绑定`
        }
        
        logger.info(`[查询] QQ(${normalizedUserId})的MC账号信息：用户名=${updatedBind.mcUsername}, UUID=${updatedBind.mcUuid}`)
        
        // 如果MC和B站都已绑定，进行自动群昵称设置
        if (updatedBind.mcUsername && updatedBind.buidUid && updatedBind.buidUsername) {
          await autoSetGroupNickname(session, updatedBind.mcUsername, updatedBind.buidUsername)
        } else if (!updatedBind.buidUid) {
          // 如果未绑定B站账号，在消息中提示
          logger.info(`[查询] QQ(${normalizedUserId})未绑定B站账号，跳过群昵称设置`)
        }
        
        // 按照用户期望的顺序发送消息：MC账号信息 -> MC头图 -> B站账号信息 -> B站头像
        const messageElements = [
          h.text(`您的MC账号信息：\n用户名: ${updatedBind.mcUsername}\nUUID: ${formattedUuid}${whitelistInfo}`),
          ...(mcAvatarUrl ? [h.image(mcAvatarUrl)] : []),
          h.text(buidInfo),
          ...(buidAvatar ? [buidAvatar] : [])
        ]
        
        return sendMessage(session, messageElements)
      } catch (error) {
        const normalizedUserId = normalizeQQId(session.userId)
        logger.error(`[查询] QQ(${normalizedUserId})查询MC账号失败: ${error.message}`)
        return sendMessage(session, [h.text(`查询失败: ${error.message}`)])
      }
    })

  // 通过MC用户名查询绑定QQ账号命令
  cmd.subcommand('.finduser <username:string>', '[管理员]通过MC用户名查询绑定的QQ账号')
    .action(async ({ session }, username) => {
      try {
        const normalizedUserId = normalizeQQId(session.userId)
        
        // 检查权限，只允许管理员使用
        if (!await isAdmin(session.userId)) {
          logger.warn(`[反向查询] 权限不足: QQ(${normalizedUserId})不是管理员，无法使用反向查询`)
          return sendMessage(session, [h.text('只有管理员才能使用此命令')])
        }
        
        if (!username) {
          logger.warn(`[反向查询] QQ(${normalizedUserId})未提供MC用户名`)
          return sendMessage(session, [h.text('请提供要查询的MC用户名')])
        }
        
        logger.info(`[反向查询] QQ(${normalizedUserId})尝试通过MC用户名"${username}"查询绑定的QQ账号`)
        
        // 查询用户名绑定信息
        const bind = await getMcBindByUsername(username)
        
        if (!bind || !bind.qqId) {
          logger.info(`[反向查询] MC用户名"${username}"未被任何QQ账号绑定`)
          return sendMessage(session, [h.text(`未找到绑定MC用户名"${username}"的QQ账号`)])
        }
        
        // 根据配置决定显示哪种图像
        let mcAvatarUrl = null
        if (config?.showAvatar) {
          if (config?.showMcSkin) {
            // 显示皮肤渲染图
            mcAvatarUrl = getStarlightSkinUrl(bind.mcUsername)
          } else {
            // 显示头图
            mcAvatarUrl = getCrafatarUrl(bind.mcUuid)
          }
        }
        // 格式化UUID
        const formattedUuid = formatUuid(bind.mcUuid)
        
        // 为Admin添加更多信息
        let adminInfo = ''
        if (await isAdmin(session.userId)) {
          // 添加获取白名单服务器信息
          if (bind.whitelist && bind.whitelist.length > 0) {
            const serverList = bind.whitelist.map(serverId => {
              const server = getServerConfigById(serverId)
              return server ? server.name : `未知服务器(${serverId})`
            }).join('\n- ')
            
            adminInfo = `\n\n白名单服务器:\n- ${serverList}`
          } else {
            adminInfo = '\n\n未加入任何服务器白名单'
          }
          
          adminInfo += `\n绑定时间: ${bind.lastModified ? new Date(bind.lastModified).toLocaleString() : '未知'}`
          adminInfo += `\n管理员权限: ${bind.isAdmin ? '是' : '否'}`
        }
        
        logger.info(`[反向查询] 成功: MC用户名"${username}"被QQ(${bind.qqId})绑定`)
        return sendMessage(session, [
          h.text(`MC用户名"${bind.mcUsername}"绑定信息:\nQQ号: ${bind.qqId}\nUUID: ${formattedUuid}${adminInfo}`),
          ...(mcAvatarUrl ? [h.image(mcAvatarUrl)] : [])
        ])
      } catch (error) {
        const normalizedUserId = normalizeQQId(session.userId)
        logger.error(`[反向查询] QQ(${normalizedUserId})通过MC用户名"${username}"查询失败: ${error.message}`)
        return sendMessage(session, [h.text(getFriendlyErrorMessage(error))])
      }
    })

  // 绑定MC账号命令
  cmd.subcommand('.bind <username:string> [target:string]', '绑定MC账号')
    .action(async ({ session }, username, target) => {
      try {
        const normalizedUserId = normalizeQQId(session.userId)
        
        // 检查用户名格式
        if (!username || !/^[a-zA-Z0-9_]{3,16}$/.test(username)) {
          logWarn('绑定', `QQ(${normalizedUserId})提供的用户名"${username}"格式无效`)
          return sendMessage(session, [h.text('请提供有效的Minecraft用户名（3-16位字母、数字、下划线）')])
        }

        // 验证用户名是否存在
        const profile = await validateUsername(username)
        if (!profile) {
          logWarn('绑定', `QQ(${normalizedUserId})提供的用户名"${username}"不存在`)
          return sendMessage(session, [h.text(`无法验证用户名: ${username}，该用户可能不存在`)])
        }

        // 使用Mojang返回的正确大小写
        username = profile.name
        const uuid = profile.id

        // 如果指定了目标用户（管理员功能）
        if (target) {
          const normalizedTargetId = normalizeQQId(target)
          logDebug('绑定', `QQ(${normalizedUserId})尝试为QQ(${normalizedTargetId})绑定MC账号: ${username}(${uuid})`)
          
          // 检查权限
          if (!await isAdmin(session.userId)) {
            logWarn('绑定', `权限不足: QQ(${normalizedUserId})不是管理员，无法为QQ(${normalizedTargetId})绑定MC账号`)
            return sendMessage(session, [h.text('只有管理员才能为其他用户绑定MC账号')])
          }

          // 检查用户名是否已被除目标用户以外的其他用户绑定
          if (await checkUsernameExists(username, target)) {
            logWarn('绑定', `MC用户名"${username}"已被其他QQ号绑定`)
            return sendMessage(session, [h.text(`用户名 ${username} 已被其他用户绑定`)])
          }

          // 获取目标用户MCIDBIND信息
          const targetBind = await getMcBindByQQId(normalizedTargetId)
          
          if (targetBind && targetBind.mcUsername) {
            logDebug('绑定', `QQ(${normalizedTargetId})已绑定MC账号"${targetBind.mcUsername}"，将被覆盖为"${username}"`)
          }
          
          // 创建或更新绑定记录
          const bindResult = await createOrUpdateMcBind(target, username, uuid)
          
          // 检查绑定结果
          if (!bindResult) {
            logError('绑定', normalizedUserId, `管理员QQ(${normalizedUserId})为QQ(${normalizedTargetId})绑定MC账号"${username}"失败: 数据库操作失败`)
            return sendMessage(session, [h.text(`为用户 ${normalizedTargetId} 绑定MC账号失败: 数据库操作出错，请联系管理员`)])
          }
          
          logOperation('为他人绑定MC账号', normalizedUserId, true, `为QQ(${normalizedTargetId})绑定MC账号: ${username}(${uuid})`)
          
          // 根据配置决定显示哪种图像
          let mcAvatarUrl = null
          if (config?.showAvatar) {
            if (config?.showMcSkin) {
              // 显示皮肤渲染图
              mcAvatarUrl = getStarlightSkinUrl(username)
            } else {
              // 显示头图
              mcAvatarUrl = getCrafatarUrl(uuid)
            }
          }
          const formattedUuid = formatUuid(uuid)
          
          return sendMessage(session, [
            h.text(`已成功为用户 ${normalizedTargetId} 绑定MC账号\n用户名: ${username}\nUUID: ${formattedUuid}`),
            ...(mcAvatarUrl ? [h.image(mcAvatarUrl)] : [])
          ])
        }
        
        // 为自己绑定MC账号
        logDebug('绑定', `QQ(${normalizedUserId})尝试绑定MC账号: ${username}(${uuid})`)
        
        // 检查用户是否已绑定
        const selfBind = await getMcBindByQQId(normalizedUserId)
        if (selfBind && selfBind.mcUsername) {
          // 如果当前绑定的是临时用户名（以_temp_开头），则允许直接使用bind命令
          const isTempUsername = selfBind.mcUsername.startsWith('_temp_');
          
          if (!isTempUsername) {
            // 检查是否是管理员或是否在冷却时间内
            if (!await isAdmin(session.userId) && !checkCooldown(selfBind.lastModified, 3)) {
              const days = config.cooldownDays * 3
              const now = new Date()
              const diffTime = now.getTime() - selfBind.lastModified.getTime()
              const passedDays = Math.floor(diffTime / (1000 * 60 * 60 * 24))
              const remainingDays = days - passedDays
              
              logWarn('绑定', `QQ(${normalizedUserId})已绑定MC账号"${selfBind.mcUsername}"，且在冷却期内，还需${remainingDays}天`)
              return sendMessage(session, [h.text(`您已绑定MC账号: ${selfBind.mcUsername}，如需修改，请在冷却期结束后(还需${remainingDays}天)使用 ` + formatCommand('mcid change') + ` 命令或联系管理员。`)])
            }
            logDebug('绑定', `QQ(${normalizedUserId})已绑定MC账号"${selfBind.mcUsername}"，建议使用change命令`)
            return sendMessage(session, [h.text(`您已绑定MC账号: ${selfBind.mcUsername}，如需修改请使用 ` + formatCommand('mcid change') + ` 命令。`)])
          } else {
            // 临时用户名，允许直接绑定，记录日志
            logDebug('绑定', `QQ(${normalizedUserId})之前绑定的是临时用户名"${selfBind.mcUsername}"，允许直接使用bind命令`)
          }
        }

        // 检查用户名是否已被绑定
        if (await checkUsernameExists(username)) {
          logWarn('绑定', `MC用户名"${username}"已被其他QQ号绑定`)
          return sendMessage(session, [h.text(`用户名 ${username} 已被其他用户绑定`)])
        }

        // 创建新绑定
        const bindResult = await createOrUpdateMcBind(session.userId, username, uuid)
        
        // 检查绑定结果
        if (!bindResult) {
          logError('绑定', normalizedUserId, `QQ(${normalizedUserId})绑定MC账号"${username}"失败: 数据库操作失败`)
          return sendMessage(session, [h.text('绑定失败，数据库操作出错，请联系管理员')])
        }
        
        logOperation('绑定MC账号', normalizedUserId, true, `绑定MC账号: ${username}(${uuid})`)
        
        // 根据配置决定显示哪种图像
        let mcAvatarUrl = null
        if (config?.showAvatar) {
          if (config?.showMcSkin) {
            // 显示皮肤渲染图
            mcAvatarUrl = getStarlightSkinUrl(username)
          } else {
            // 显示头图
            mcAvatarUrl = getCrafatarUrl(uuid)
          }
        }
        const formattedUuid = formatUuid(uuid)
        
        return sendMessage(session, [
          h.text(`已成功绑定MC账号\n用户名: ${username}\nUUID: ${formattedUuid}`),
          ...(mcAvatarUrl ? [h.image(mcAvatarUrl)] : [])
        ])
      } catch (error) {
        const normalizedUserId = normalizeQQId(session.userId)
        logError('绑定', normalizedUserId, `QQ(${normalizedUserId})绑定MC账号"${username}"失败: ${error.message}`)
        return sendMessage(session, [h.text(getFriendlyErrorMessage(error))])
      }
    })

  // 修改MC账号命令
  cmd.subcommand('.change <username:string> [target:string]', '修改绑定的MC账号')
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
          
          // 根据配置决定显示哪种图像
          let mcAvatarUrl = null
          if (config?.showAvatar) {
            if (config?.showMcSkin) {
              // 显示皮肤渲染图
              mcAvatarUrl = getStarlightSkinUrl(username)
            } else {
              // 显示头图
              mcAvatarUrl = getCrafatarUrl(uuid)
            }
          }
          const formattedUuid = formatUuid(uuid)
          
          return sendMessage(session, [
            h.text(`已成功将用户 ${normalizedTargetId} 的MC账号从 ${oldUsername} 修改为 ${username}\nUUID: ${formattedUuid}`),
            ...(mcAvatarUrl ? [h.image(mcAvatarUrl)] : [])
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
        if (!await isAdmin(session.userId) && !checkCooldown(selfBind.lastModified, 3)) {
          const days = config.cooldownDays * 3
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
        
        // 根据配置决定显示哪种图像
        let mcAvatarUrl = null
        if (config?.showAvatar) {
          if (config?.showMcSkin) {
            // 显示皮肤渲染图
            mcAvatarUrl = getStarlightSkinUrl(username)
          } else {
            // 显示头图
            mcAvatarUrl = getCrafatarUrl(uuid)
          }
        }
        const formattedUuid = formatUuid(uuid)
        
        return sendMessage(session, [
          h.text(`已成功将MC账号从 ${oldUsername} 修改为 ${username}\nUUID: ${formattedUuid}`),
          ...(mcAvatarUrl ? [h.image(mcAvatarUrl)] : [])
        ])
      } catch (error) {
        const normalizedUserId = normalizeQQId(session.userId)
        logger.error(`[修改] QQ(${normalizedUserId})修改MC账号为"${username}"失败: ${error.message}`)
        return sendMessage(session, [h.text(getFriendlyErrorMessage(error))])
      }
    })

  // 解绑MC账号命令
  cmd.subcommand('.unbind [target:string]', '[管理员]解绑MC账号')
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
          const oldBuidInfo = targetBind.buidUid ? ` 和 B站账号: ${targetBind.buidUsername}(${targetBind.buidUid})` : ''
          
          // 删除绑定记录
          await deleteMcBind(target)
          
          logger.info(`[解绑] 成功: 管理员QQ(${normalizedUserId})为QQ(${normalizedTargetId})解绑MC账号: ${oldUsername}${oldBuidInfo}`)
          return sendMessage(session, [h.text(`已成功为用户 ${normalizedTargetId} 解绑MC账号: ${oldUsername}${oldBuidInfo}`)])
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
        const oldBuidInfo = selfBind.buidUid ? ` 和 B站账号: ${selfBind.buidUsername}(${selfBind.buidUid})` : ''
        
        // 删除绑定记录
        await deleteMcBind(normalizedUserId)
        
        logger.info(`[解绑] 成功: QQ(${normalizedUserId})解绑MC账号: ${oldUsername}${oldBuidInfo}`)
        return sendMessage(session, [h.text(`已成功解绑MC账号: ${oldUsername}${oldBuidInfo}`)])
      } catch (error) {
        const normalizedUserId = normalizeQQId(session.userId)
        const targetInfo = target ? `为QQ(${normalizeQQId(target)})` : ''
        logger.error(`[解绑] QQ(${normalizedUserId})${targetInfo}解绑MC账号失败: ${error.message}`)
        return sendMessage(session, [h.text(getFriendlyErrorMessage(error))])
      }
    })

  // 交互型绑定命令
  ctx.command('绑定', '交互式绑定流程')
    .alias('bind')
    .alias('interact')
    .action(async ({ session }) => {
      try {
        const normalizedUserId = normalizeQQId(session.userId)
        const channelId = session.channelId
        
        logger.info(`[交互绑定] QQ(${normalizedUserId})开始交互式绑定流程`)
        
        // 检查是否已有进行中的会话
        const existingSession = getBindingSession(session.userId, channelId)
        if (existingSession) {
          logger.warn(`[交互绑定] QQ(${normalizedUserId})已有进行中的绑定会话`)
          return sendMessage(session, [h.text('您已有进行中的绑定会话，请先完成当前绑定或等待会话超时')])
        }
        
        // 检查用户当前绑定状态
        const existingBind = await getMcBindByQQId(normalizedUserId)
        
        // 如果两个账号都已绑定，不需要进入绑定流程
        if (existingBind && existingBind.mcUsername && existingBind.buidUid) {
          logger.info(`[交互绑定] QQ(${normalizedUserId})已完成全部绑定`)
          
          // 显示当前绑定信息
          let bindInfo = `您已完成全部账号绑定：\n✅ MC账号: ${existingBind.mcUsername}\n✅ B站账号: ${existingBind.buidUsername} (UID: ${existingBind.buidUid})`
          
          if (existingBind.guardLevel > 0) {
            bindInfo += `\n舰长等级: ${existingBind.guardLevelText}`
          }
          if (existingBind.medalName) {
            bindInfo += `\n粉丝牌: ${existingBind.medalName} Lv.${existingBind.medalLevel}`
          }
          
          bindInfo += `\n\n如需修改绑定信息，请使用：\n- ${formatCommand('mcid change <新用户名>')} 修改MC账号\n- ${formatCommand('buid bind <新UID>')} 修改B站账号`
          
          return sendMessage(session, [h.text(bindInfo)])
        }
        
        // 如果已绑定MC但未绑定B站，直接进入B站绑定流程
        if (existingBind && existingBind.mcUsername && !existingBind.buidUid) {
          logger.info(`[交互绑定] QQ(${normalizedUserId})已绑定MC，进入B站绑定流程`)
          
          // 创建绑定会话，状态直接设为等待B站UID
          const timeout = setTimeout(() => {
            bindingSessions.delete(`${normalizedUserId}_${channelId}`)
            ctx.bots.forEach(bot => {
              bot.sendMessage(channelId, [h.text('绑定会话已超时，请重新开始绑定流程')]).catch(() => {})
            })
            logger.info(`[交互绑定] QQ(${normalizedUserId})的绑定会话因超时被清理`)
          }, BINDING_SESSION_TIMEOUT)
          
          const sessionData: BindingSession = {
            userId: session.userId,
            channelId: channelId,
            state: 'waiting_buid',
            startTime: Date.now(),
            timeout: timeout,
            mcUsername: existingBind.mcUsername,
            mcUuid: existingBind.mcUuid
          }
          
          bindingSessions.set(`${normalizedUserId}_${channelId}`, sessionData)
          
          return sendMessage(session, [h.text(`🎮 已绑定MC: ${existingBind.mcUsername}\n请发送您的B站UID`)])
        }
        
        // 如果未绑定MC账号，从MC绑定开始
        createBindingSession(session.userId, channelId)
        
        // 发送简化的MC用户名输入提示
        return sendMessage(session, [h.text(`🎮 请发送您的MC用户名`)])
      } catch (error) {
        const normalizedUserId = normalizeQQId(session.userId)
        logger.error(`[交互绑定] QQ(${normalizedUserId})开始交互式绑定失败: ${error.message}`)
        return sendMessage(session, [h.text(getFriendlyErrorMessage(error))])
      }
    })
    
  // 管理员管理命令
  cmd.subcommand('.admin <target:string>', '[主人]将用户设为管理员')
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
  cmd.subcommand('.unadmin <target:string>', '[主人]撤销用户的管理员权限')
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

  // 统计数据命令
  cmd.subcommand('.stats', '[管理员]查看数据库统计信息')
    .action(async ({ session }) => {
      try {
        const normalizedUserId = normalizeQQId(session.userId)
        logger.info(`[统计] QQ(${normalizedUserId})尝试查看数据库统计`)
        
        // 检查权限，只允许管理员使用
        if (!await isAdmin(session.userId)) {
          logger.warn(`[统计] 权限不足: QQ(${normalizedUserId})不是管理员，无法查看统计信息`)
          return sendMessage(session, [h.text('只有管理员才能查看统计信息')])
        }
        
        // 查询所有绑定记录
        const allBinds = await ctx.database.get('mcidbind', {})
        
        // 统计绑定情况
        let mcidBoundUsers = 0
        let buidBoundUsers = 0
        
        // 遍历所有绑定记录进行统计
        for (const bind of allBinds) {
          // MCID绑定统计
          const hasMcid = bind.mcUsername && !bind.mcUsername.startsWith('_temp_')
          if (hasMcid) {
            mcidBoundUsers++
          }
          
          // BUID绑定统计
          const hasBuid = bind.buidUid && bind.buidUid.trim() !== ''
          if (hasBuid) {
            buidBoundUsers++
          }
        }
        
        // 构建简化的统计信息
        let statsInfo = `📊 绑定统计\n`
        statsInfo += `\n已绑定MCID: ${mcidBoundUsers}人\n`
        statsInfo += `已绑定BUID: ${buidBoundUsers}人`
        
        logger.info(`[统计] 成功: 管理员QQ(${normalizedUserId})查看了数据库统计`)
        return sendMessage(session, [h.text(statsInfo)])
      } catch (error) {
        const normalizedUserId = normalizeQQId(session.userId)
        logger.error(`[统计] QQ(${normalizedUserId})查看统计失败: ${error.message}`)
        return sendMessage(session, [h.text(getFriendlyErrorMessage(error))])
      }
    })

  // =========== BUID命令组 ===========
  const buidCmd = ctx.command('buid', 'B站UID绑定管理')

  // 查询BUID绑定命令
  buidCmd.subcommand('.query [target:string]', '查询用户绑定的BUID')
    .action(async ({ session }, target) => {
      try {
        const normalizedUserId = normalizeQQId(session.userId)
        let bind: MCIDBIND | null
        if (target) {
          const normalizedTargetId = normalizeQQId(target)
          bind = await getMcBindByQQId(normalizedTargetId)
        } else {
          bind = await getMcBindByQQId(normalizedUserId)
        }
        if (!bind || !bind.buidUid) {
          return sendMessage(session, [h.text(target ? `该用户尚未绑定B站账号` : `您尚未绑定B站账号，请使用 ` + formatCommand('buid bind <UID>') + ` 进行绑定`)])
        }
        // 每次查询都刷新B站数据（仅更新信息，不更新绑定时间）
        const buidUser = await validateBUID(bind.buidUid)
        if (buidUser) {
          await updateBuidInfoOnly(bind.qqId, buidUser)
          // 重新获取最新绑定
          bind = await getMcBindByQQId(bind.qqId)
        }
        const userInfo = `${target ? `用户 ${bind.qqId}` : '您的'}B站账号信息：\nB站UID: ${bind.buidUid}\n用户名: ${bind.buidUsername}`
        let detailInfo = ''
                  if (bind.guardLevel > 0) {
            detailInfo += `\n舰长等级: ${bind.guardLevelText} (${bind.guardLevel})`
            // 只有当历史最高等级比当前等级更高时才显示（数值越小等级越高）
            if (bind.maxGuardLevel > 0 && bind.maxGuardLevel < bind.guardLevel) {
              detailInfo += `\n历史最高: ${bind.maxGuardLevelText} (${bind.maxGuardLevel})`
            }
          } else if (bind.maxGuardLevel > 0) {
            // 当前无舰长但有历史记录，显示历史最高
            detailInfo += `\n历史舰长: ${bind.maxGuardLevelText} (${bind.maxGuardLevel})`
          }
        detailInfo += `\n粉丝牌: ${bind.medalName || '无'} Lv.${bind.medalLevel || 0}`
        detailInfo += `\n荣耀等级: ${bind.wealthMedalLevel || 0}`
        detailInfo += `\n最后活跃: ${bind.lastActiveTime ? new Date(bind.lastActiveTime).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '未知'}`
        
        const messageContent = [h.text(userInfo + detailInfo)]
        if (config?.showAvatar && bind.buidUid) {
          messageContent.push(h.image(`https://workers.vrp.moe/bilibili/avatar/${bind.buidUid}?size=160`))
        }
        return sendMessage(session, messageContent)
      } catch (error) {
        return sendMessage(session, [h.text(`查询失败: ${error.message}`)])
      }
    })

  // 绑定BUID命令
  buidCmd.subcommand('.bind <uid:string> [target:string]', '绑定B站UID')
    .action(async ({ session }, uid, target) => {
      try {
        const normalizedUserId = normalizeQQId(session.userId)
        
        // 解析UID格式，支持 "UID:12345" 和 "12345" 两种格式
        let actualUid = uid
        if (uid && uid.toLowerCase().startsWith('uid:')) {
          actualUid = uid.substring(4) // 移除 "UID:" 前缀
        }
        
        // 检查UID格式
        if (!actualUid || !/^\d+$/.test(actualUid)) {
          logWarn('BUID绑定', `QQ(${normalizedUserId})提供的UID"${uid}"格式无效`)
          return sendMessage(session, [h.text('请提供有效的B站UID（纯数字或UID:数字格式）')])
        }

        // 如果指定了目标用户（管理员功能）
        if (target) {
          const normalizedTargetId = normalizeQQId(target)
          logDebug('BUID绑定', `QQ(${normalizedUserId})尝试为QQ(${normalizedTargetId})绑定BUID: ${actualUid}`)
          
          // 检查权限
          if (!await isAdmin(session.userId)) {
            logWarn('BUID绑定', `权限不足: QQ(${normalizedUserId})不是管理员，无法为QQ(${normalizedTargetId})绑定BUID`)
            return sendMessage(session, [h.text('只有管理员才能为其他用户绑定BUID')])
          }

          // 检查目标用户是否已绑定MC账号
          const targetBind = await getMcBindByQQId(normalizedTargetId)
          if (!targetBind || !targetBind.mcUsername || targetBind.mcUsername.startsWith('_temp_')) {
            logWarn('BUID绑定', `QQ(${normalizedTargetId})尚未绑定MC账号，无法绑定BUID`)
            return sendMessage(session, [h.text(`用户 ${normalizedTargetId} 尚未绑定MC账号，请先绑定MC账号后再绑定B站UID`)])
          }

          // 检查UID是否已被除目标用户以外的其他用户绑定
          if (await checkBuidExists(actualUid, target)) {
            logWarn('BUID绑定', `BUID"${actualUid}"已被其他QQ号绑定`)
            return sendMessage(session, [h.text(`UID ${actualUid} 已被其他用户绑定`)])
          }

          // 验证UID是否存在
          const buidUser = await validateBUID(actualUid)
          if (!buidUser) {
            logWarn('BUID绑定', `QQ(${normalizedUserId})提供的UID"${actualUid}"不存在`)
            return sendMessage(session, [h.text(`无法验证UID: ${actualUid}，该用户可能不存在或未被发现，你可以去直播间逛一圈，发个弹幕回来再绑定`)])
          }

          // 创建或更新绑定记录
          const bindResult = await createOrUpdateBuidBind(target, buidUser)
          
          if (!bindResult) {
            logError('BUID绑定', normalizedUserId, `管理员QQ(${normalizedUserId})为QQ(${normalizedTargetId})绑定BUID"${actualUid}"失败: 数据库操作失败`)
            return sendMessage(session, [h.text(`为用户 ${normalizedTargetId} 绑定BUID失败: 数据库操作出错，请联系管理员`)])
          }
          
          logOperation('为他人绑定BUID', normalizedUserId, true, `为QQ(${normalizedTargetId})绑定BUID: ${actualUid}(${buidUser.username})`)
          
          return sendMessage(session, [h.text(`已成功为用户 ${normalizedTargetId} 绑定B站账号\n用户名: ${buidUser.username}\nUID: ${actualUid}\n${buidUser.guard_level > 0 ? `舰长等级: ${buidUser.guard_level_text}\n` : ''}${buidUser.medal ? `粉丝牌: ${buidUser.medal.name} Lv.${buidUser.medal.level}` : ''}`)])
        }
        
        // 为自己绑定BUID
        logDebug('BUID绑定', `QQ(${normalizedUserId})尝试绑定BUID: ${actualUid}`)
        
        // 检查用户是否已绑定MC账号
        const selfBind = await getMcBindByQQId(normalizedUserId)
        if (!selfBind || !selfBind.mcUsername || selfBind.mcUsername.startsWith('_temp_')) {
          logWarn('BUID绑定', `QQ(${normalizedUserId})尚未绑定MC账号，无法绑定BUID`)
          return sendMessage(session, [h.text(`您尚未绑定MC账号，请先使用 ` + formatCommand('mcid bind <用户名>') + ` 绑定MC账号后再绑定B站UID`)])
        }
        
        // 检查用户是否已绑定BUID
        if (selfBind && selfBind.buidUid) {
          // 检查是否是管理员或是否在冷却时间内
          if (!await isAdmin(session.userId) && !checkCooldown(selfBind.lastModified, 3)) {
            const days = config.cooldownDays * 3
            const now = new Date()
            const diffTime = now.getTime() - selfBind.lastModified.getTime()
            const passedDays = Math.floor(diffTime / (1000 * 60 * 60 * 24))
            const remainingDays = days - passedDays
            
            logWarn('BUID绑定', `QQ(${normalizedUserId})已绑定BUID"${selfBind.buidUid}"，且在冷却期内，还需${remainingDays}天`)
            return sendMessage(session, [h.text(`您已绑定B站UID: ${selfBind.buidUid}，如需修改，请在冷却期结束后(还需${remainingDays}天)或联系管理员。`)])
          }
          logDebug('BUID绑定', `QQ(${normalizedUserId})已绑定BUID"${selfBind.buidUid}"，将进行更新`)
        }

        // 检查UID是否已被绑定
        if (await checkBuidExists(actualUid, session.userId)) {
          logWarn('BUID绑定', `BUID"${actualUid}"已被其他QQ号绑定`)
          return sendMessage(session, [h.text(`UID ${actualUid} 已被其他用户绑定`)])
        }

        // 验证UID是否存在
        const buidUser = await validateBUID(actualUid)
        if (!buidUser) {
          logWarn('BUID绑定', `QQ(${normalizedUserId})提供的UID"${actualUid}"不存在`)
          return sendMessage(session, [h.text(`无法验证UID: ${actualUid}，该用户可能不存在或未被发现，你可以去直播间逛一圈，发个弹幕回来再绑定`)])
        }

        // 创建或更新绑定
        const bindResult = await createOrUpdateBuidBind(session.userId, buidUser)
        
        if (!bindResult) {
          logError('BUID绑定', normalizedUserId, `QQ(${normalizedUserId})绑定BUID"${actualUid}"失败: 数据库操作失败`)
          return sendMessage(session, [h.text('绑定失败，数据库操作出错，请联系管理员')])
        }
        
        logOperation('绑定BUID', normalizedUserId, true, `绑定BUID: ${actualUid}(${buidUser.username})`)
        
        logger.info(`[绑定] QQ(${normalizedUserId})成功绑定B站UID(${actualUid})`)
        return sendMessage(session, [
          h.text(`成功绑定B站账号！\n`),
          h.text(`B站UID: ${buidUser.uid}\n`),
          h.text(`用户名: ${buidUser.username}\n`),
          buidUser.guard_level > 0 ? h.text(`舰长等级: ${buidUser.guard_level_text} (${buidUser.guard_level})\n`) : null,
          buidUser.medal ? h.text(`粉丝牌: ${buidUser.medal.name} Lv.${buidUser.medal.level}\n`) : null,
          buidUser.wealthMedalLevel > 0 ? h.text(`荣耀等级: ${buidUser.wealthMedalLevel}\n`) : null,
          ...(config?.showAvatar ? [h.image(`https://workers.vrp.moe/bilibili/avatar/${buidUser.uid}?size=160`)] : [])
        ].filter(Boolean))
      } catch (error) {
        logError('绑定', session.userId, error)
        return sendMessage(session, [h.text(`绑定失败：${getFriendlyErrorMessage(error)}`)])
      }
    })

  // 通过BUID查询绑定QQ账号命令
  buidCmd.subcommand('.finduser <uid:string>', '[管理员]通过BUID查询绑定的QQ账号')
    .action(async ({ session }, uid) => {
      try {
        const normalizedUserId = normalizeQQId(session.userId)
        
        // 检查权限，只允许管理员使用
        if (!await isAdmin(session.userId)) {
          logger.warn(`[B站账号反向查询] 权限不足: QQ(${normalizedUserId})不是管理员，无法使用反向查询`)
          return sendMessage(session, [h.text('只有管理员才能使用此命令')])
        }
        
        // 解析UID格式，支持 "UID:12345" 和 "12345" 两种格式
        let actualUid = uid
        if (uid && uid.toLowerCase().startsWith('uid:')) {
          actualUid = uid.substring(4) // 移除 "UID:" 前缀
        }
        
        // 检查UID格式
        if (!actualUid || !/^\d+$/.test(actualUid)) {
          logger.warn(`[B站账号反向查询] QQ(${normalizedUserId})提供的UID"${uid}"格式无效`)
          return sendMessage(session, [h.text('请提供有效的B站UID（纯数字或UID:数字格式）')])
        }
        
        logger.info(`[B站账号反向查询] QQ(${normalizedUserId})尝试通过B站UID"${actualUid}"查询绑定的QQ账号`)
        
        // 查询UID绑定信息
        const bind = await getBuidBindByBuid(actualUid)
        
        if (!bind || !bind.qqId) {
          logger.info(`[B站账号反向查询] B站UID"${actualUid}"未被任何QQ账号绑定`)
          return sendMessage(session, [h.text(`未找到绑定B站UID"${actualUid}"的QQ账号`)])
        }
        
        // 为Admin添加更多信息
        let adminInfo = `B站UID"${bind.buidUid}"绑定信息:\nQQ号: ${bind.qqId}\n用户名: ${bind.buidUsername}`
        
        if (bind.guardLevel > 0) {
          adminInfo += `\n舰长等级: ${bind.guardLevelText} (${bind.guardLevel})`
          // 只有当历史最高等级比当前等级更高时才显示（数值越小等级越高）
          if (bind.maxGuardLevel > 0 && bind.maxGuardLevel < bind.guardLevel) {
            adminInfo += `\n历史最高: ${bind.maxGuardLevelText} (${bind.maxGuardLevel})`
          }
        } else if (bind.maxGuardLevel > 0) {
          // 当前无舰长但有历史记录，显示历史最高
          adminInfo += `\n历史舰长: ${bind.maxGuardLevelText} (${bind.maxGuardLevel})`
        }
        if (bind.medalName) {
          adminInfo += `\n粉丝牌: ${bind.medalName} Lv.${bind.medalLevel}`
        }
        if (bind.wealthMedalLevel > 0) {
          adminInfo += `\n荣耀等级: ${bind.wealthMedalLevel}`
        }
        if (bind.lastActiveTime) {
          adminInfo += `\n最后活跃: ${new Date(bind.lastActiveTime).toLocaleString()}`
        }
        adminInfo += `\n绑定时间: ${bind.lastModified ? new Date(bind.lastModified).toLocaleString() : '未知'}`
        adminInfo += `\n管理员权限: ${bind.isAdmin ? '是' : '否'}`
        
        logger.info(`[B站账号反向查询] 成功: B站UID"${actualUid}"被QQ(${bind.qqId})绑定`)
        return sendMessage(session, [h.text(adminInfo)])
      } catch (error) {
        const normalizedUserId = normalizeQQId(session.userId)
        logger.error(`[B站账号反向查询] QQ(${normalizedUserId})通过B站UID查询失败: ${error.message}`)
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
          
          // 添加服务器ID信息
          serverInfo += `\n   ID: ${server.id}`; 
          
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
        }).join('\n\n');  // 使用双换行分隔不同服务器，增强可读性
        
        logger.info(`[白名单] 成功: QQ(${normalizedUserId})获取了服务器列表，共${enabledServers.length}个服务器`)
        return sendMessage(session, [
          h.text(`${userBind.mcUsername} 的可用服务器列表:\n\n${serverList}\n\n使用 ${formatCommand('mcid whitelist add <服务器名称或ID>')} 申请白名单`)
        ])
      } catch (error) {
        const normalizedUserId = normalizeQQId(session.userId)
        logger.error(`[白名单] QQ(${normalizedUserId})查询服务器列表失败: ${error.message}`)
        return sendMessage(session, [h.text(getFriendlyErrorMessage(error))])
      }
    })
  
  // 添加白名单
  whitelistCmd.subcommand('.add <serverIdOrName:string> [...targets:string]', '申请/添加服务器白名单')
    .action(async ({ session }, serverIdOrName, ...targets) => {
      try {
        const normalizedUserId = normalizeQQId(session.userId)
        
        // 检查服务器名称或ID
        if (!serverIdOrName) {
          logger.warn(`[白名单] QQ(${normalizedUserId})未提供服务器名称或ID`)
          return sendMessage(session, [h.text('请提供服务器名称或ID\n使用 mcid whitelist servers 查看可用服务器列表')])
        }
        
        // 获取服务器配置
        const server = getServerConfigByIdOrName(serverIdOrName)
        if (!server) {
          logger.warn(`[白名单] QQ(${normalizedUserId})提供的服务器名称或ID"${serverIdOrName}"无效`)
          return sendMessage(session, [h.text(`未找到名称或ID为"${serverIdOrName}"的服务器\n使用 mcid whitelist servers 查看可用服务器列表`)])
        }
        
        // 如果有指定目标用户（批量操作或单个用户管理）
        if (targets && targets.length > 0) {
          // 检查权限
          if (!await isAdmin(session.userId)) {
            logger.warn(`[白名单] 权限不足: QQ(${normalizedUserId})不是管理员，无法为其他用户添加白名单`)
            return sendMessage(session, [h.text('只有管理员才能为其他用户添加白名单')])
          }
          
          // 检查是否为标签（优先检查标签名，没有匹配标签再按QQ号处理）
          if (targets.length === 1) {
            const targetValue = targets[0]
            
            // 首先检查是否存在该标签名
            const allBinds = await ctx.database.get('mcidbind', {})
            const usersWithTag = allBinds.filter(bind => 
              bind.tags && bind.tags.includes(targetValue) && bind.mcUsername && !bind.mcUsername.startsWith('_temp_')
            )
            
            if (usersWithTag.length > 0) {
              // 作为标签处理
              const tagName = targetValue
              logger.info(`[白名单] 管理员QQ(${normalizedUserId})尝试为标签"${tagName}"的所有用户添加服务器"${server.name}"白名单`)
              
              // 转换为用户ID数组
              targets = usersWithTag.map(bind => bind.qqId)
              logger.info(`[白名单] 找到${targets.length}个有标签"${tagName}"的已绑定用户`)
              
              await sendMessage(session, [h.text(`找到${targets.length}个有标签"${tagName}"的已绑定用户，开始添加白名单...`)])
            }
            // 如果没有找到标签，将继续按单个用户处理
          }
          
          // 单个用户的简洁处理逻辑
          if (targets.length === 1) {
            const target = targets[0]
            const normalizedTargetId = normalizeQQId(target)
            logger.info(`[白名单] QQ(${normalizedUserId})尝试为QQ(${normalizedTargetId})添加服务器"${server.name}"白名单`)
            
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
          
          // 批量用户的详细处理逻辑
          logger.info(`[白名单] QQ(${normalizedUserId})尝试批量为${targets.length}个用户添加服务器"${server.name}"白名单`)
          
          // 发送开始处理的通知
          await sendMessage(session, [h.text(`开始为${targets.length}个用户添加服务器"${server.name}"的白名单，请稍候...`)])
          
          // 统计信息
          let successCount = 0
          let failCount = 0
          let skipCount = 0
          const results: string[] = []
          
          // 处理每个目标用户
          for (let i = 0; i < targets.length; i++) {
            const target = targets[i]
            const normalizedTargetId = normalizeQQId(target)
            
            try {
              // 获取目标用户的绑定信息
              const targetBind = await getMcBindByQQId(normalizedTargetId)
              if (!targetBind || !targetBind.mcUsername) {
                failCount++
                results.push(`❌ ${normalizedTargetId}: 未绑定MC账号`)
                logger.warn(`[白名单] QQ(${normalizedTargetId})未绑定MC账号`)
                continue
              }
              
              // 检查是否已在白名单中
              if (isInServerWhitelist(targetBind, server.id)) {
                skipCount++
                results.push(`⏭️ ${normalizedTargetId}: 已在白名单中`)
                logger.warn(`[白名单] QQ(${normalizedTargetId})已在服务器"${server.name}"的白名单中`)
                continue
              }
              
              // 执行添加白名单操作
              const result = await addServerWhitelist(targetBind, server)
              
              if (result) {
                successCount++
                results.push(`✅ ${normalizedTargetId}: 添加成功`)
                logger.info(`[白名单] 成功: 管理员QQ(${normalizedUserId})为QQ(${normalizedTargetId})添加了服务器"${server.name}"的白名单`)
              } else {
                failCount++
                results.push(`❌ ${normalizedTargetId}: 添加失败`)
                logger.error(`[白名单] 管理员QQ(${normalizedUserId})为QQ(${normalizedTargetId})添加服务器"${server.name}"白名单失败`)
              }
              
              // 批量操作时添加适当延迟，避免过载
              if (i < targets.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 500))
              }
              
              // 每处理5个用户发送一次进度更新（仅在批量操作时）
              if (targets.length > 5 && (i + 1) % 5 === 0) {
                const progress = Math.round(((i + 1) / targets.length) * 100)
                await sendMessage(session, [h.text(`批量添加白名单进度: ${progress}% (${i + 1}/${targets.length})\n成功: ${successCount} | 失败: ${failCount} | 跳过: ${skipCount}`)])
              }
            } catch (error) {
              failCount++
              results.push(`❌ ${normalizedTargetId}: 处理出错`)
              logger.error(`[白名单] 处理用户QQ(${normalizedTargetId})时出错: ${error.message}`)
            }
          }
          
          // 生成结果报告
          let resultMessage = `批量添加服务器"${server.name}"白名单完成\n共处理${targets.length}个用户\n✅ 成功: ${successCount} 个\n❌ 失败: ${failCount} 个\n⏭️ 跳过: ${skipCount} 个`
          
          // 如果有详细结果且用户数量不太多，显示详细信息
          if (targets.length <= 10) {
            resultMessage += '\n\n详细结果:\n' + results.join('\n')
          }
          
          logger.info(`[白名单] 批量操作完成: 管理员QQ(${normalizedUserId})为${targets.length}个用户添加服务器"${server.name}"白名单，成功: ${successCount}，失败: ${failCount}，跳过: ${skipCount}`)
          return sendMessage(session, [h.text(resultMessage)])
        }
        
        // 为自己添加白名单（原有逻辑保持不变）
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
  whitelistCmd.subcommand('.remove <serverIdOrName:string> [...targets:string]', '[管理员]移除服务器白名单')
    .action(async ({ session }, serverIdOrName, ...targets) => {
      try {
        const normalizedUserId = normalizeQQId(session.userId)
        
        // 检查权限，只有管理员可以移除白名单
        if (!await isAdmin(session.userId)) {
          logger.warn(`[白名单] 权限不足: QQ(${normalizedUserId})不是管理员，无法移除白名单`)
          return sendMessage(session, [h.text('只有管理员才能移除白名单')])
        }
        
        // 检查服务器名称或ID
        if (!serverIdOrName) {
          logger.warn(`[白名单] QQ(${normalizedUserId})未提供服务器名称或ID`)
          return sendMessage(session, [h.text('请提供服务器名称或ID\n使用 mcid whitelist servers 查看可用服务器列表')])
        }
        
        // 获取服务器配置
        const server = getServerConfigByIdOrName(serverIdOrName)
        if (!server) {
          logger.warn(`[白名单] QQ(${normalizedUserId})提供的服务器名称或ID"${serverIdOrName}"无效`)
          return sendMessage(session, [h.text(`未找到名称或ID为"${serverIdOrName}"的服务器\n使用 mcid whitelist servers 查看可用服务器列表`)])
        }
        
        // 如果有指定目标用户（批量操作或单个用户管理）
        if (targets && targets.length > 0) {
          // 检查是否为标签（优先检查标签名，没有匹配标签再按QQ号处理）
          if (targets.length === 1) {
            const targetValue = targets[0]
            
            // 首先检查是否存在该标签名
            const allBinds = await ctx.database.get('mcidbind', {})
            const usersWithTag = allBinds.filter(bind => 
              bind.tags && bind.tags.includes(targetValue) && bind.mcUsername && !bind.mcUsername.startsWith('_temp_')
            )
            
            if (usersWithTag.length > 0) {
              // 作为标签处理
              const tagName = targetValue
              logger.info(`[白名单] 管理员QQ(${normalizedUserId})尝试为标签"${tagName}"的所有用户移除服务器"${server.name}"白名单`)
              
              // 转换为用户ID数组
              targets = usersWithTag.map(bind => bind.qqId)
              logger.info(`[白名单] 找到${targets.length}个有标签"${tagName}"的已绑定用户`)
              
              await sendMessage(session, [h.text(`找到${targets.length}个有标签"${tagName}"的已绑定用户，开始移除白名单...`)])
            }
            // 如果没有找到标签，将继续按单个用户处理
          }
          
          // 单个用户的简洁处理逻辑
          if (targets.length === 1) {
            const target = targets[0]
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
          
          // 批量用户的详细处理逻辑
          logger.info(`[白名单] 管理员QQ(${normalizedUserId})尝试批量为${targets.length}个用户移除服务器"${server.name}"白名单`)
          
          // 发送开始处理的通知
          await sendMessage(session, [h.text(`开始为${targets.length}个用户移除服务器"${server.name}"的白名单，请稍候...`)])
          
          // 统计信息
          let successCount = 0
          let failCount = 0
          let skipCount = 0
          const results: string[] = []
          
          // 处理每个目标用户
          for (let i = 0; i < targets.length; i++) {
            const target = targets[i]
            const normalizedTargetId = normalizeQQId(target)
            
            try {
              // 获取目标用户的绑定信息
              const targetBind = await getMcBindByQQId(normalizedTargetId)
              if (!targetBind || !targetBind.mcUsername) {
                failCount++
                results.push(`❌ ${normalizedTargetId}: 未绑定MC账号`)
                logger.warn(`[白名单] QQ(${normalizedTargetId})未绑定MC账号`)
                continue
              }
              
              // 检查是否在白名单中
              if (!isInServerWhitelist(targetBind, server.id)) {
                skipCount++
                results.push(`⏭️ ${normalizedTargetId}: 不在白名单中`)
                logger.warn(`[白名单] QQ(${normalizedTargetId})不在服务器"${server.name}"的白名单中`)
                continue
              }
              
              // 执行移除白名单操作
              const result = await removeServerWhitelist(targetBind, server)
              
              if (result) {
                successCount++
                results.push(`✅ ${normalizedTargetId}: 移除成功`)
                logger.info(`[白名单] 成功: 管理员QQ(${normalizedUserId})为QQ(${normalizedTargetId})移除了服务器"${server.name}"的白名单`)
              } else {
                failCount++
                results.push(`❌ ${normalizedTargetId}: 移除失败`)
                logger.error(`[白名单] 管理员QQ(${normalizedUserId})为QQ(${normalizedTargetId})移除服务器"${server.name}"白名单失败`)
              }
              
              // 批量操作时添加适当延迟，避免过载
              if (i < targets.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 500))
              }
              
              // 每处理5个用户发送一次进度更新（仅在批量操作时）
              if (targets.length > 5 && (i + 1) % 5 === 0) {
                const progress = Math.round(((i + 1) / targets.length) * 100)
                await sendMessage(session, [h.text(`批量移除白名单进度: ${progress}% (${i + 1}/${targets.length})\n成功: ${successCount} | 失败: ${failCount} | 跳过: ${skipCount}`)])
              }
            } catch (error) {
              failCount++
              results.push(`❌ ${normalizedTargetId}: 处理出错`)
              logger.error(`[白名单] 处理用户QQ(${normalizedTargetId})时出错: ${error.message}`)
            }
          }
          
          // 生成结果报告
          let resultMessage = `批量移除服务器"${server.name}"白名单完成\n共处理${targets.length}个用户\n✅ 成功: ${successCount} 个\n❌ 失败: ${failCount} 个\n⏭️ 跳过: ${skipCount} 个`
          
          // 如果有详细结果且用户数量不太多，显示详细信息
          if (targets.length <= 10) {
            resultMessage += '\n\n详细结果:\n' + results.join('\n')
          }
          
          logger.info(`[白名单] 批量操作完成: 管理员QQ(${normalizedUserId})为${targets.length}个用户移除服务器"${server.name}"白名单，成功: ${successCount}，失败: ${failCount}，跳过: ${skipCount}`)
          return sendMessage(session, [h.text(resultMessage)])
        }
        
        // 为自己移除白名单（原有逻辑保持不变）
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
  whitelistCmd.subcommand('.reset <serverIdOrName:string>', '[主人]重置服务器所有白名单记录')
    .action(async ({ session }, serverIdOrName) => {
      try {
        const normalizedUserId = normalizeQQId(session.userId)
        
        // 检查是否为主人
        if (!isMaster(session.userId)) {
          logger.warn(`[重置白名单] 权限不足: QQ(${normalizedUserId})不是主人，无法重置白名单数据库`)
          return sendMessage(session, [h.text('只有主人才能重置服务器白名单数据库')])
        }
        
        // 检查服务器ID或名称
        if (!serverIdOrName) {
          logger.warn(`[重置白名单] QQ(${normalizedUserId})未提供服务器ID或名称`)
          return sendMessage(session, [h.text('请提供服务器ID或名称\n使用 mcid whitelist servers 查看可用服务器列表')])
        }
        
        // 直接使用提供的ID进行删除，不验证服务器是否存在于配置中
        const serverId = serverIdOrName
        logger.info(`[重置白名单] 主人QQ(${normalizedUserId})正在重置服务器ID"${serverId}"的白名单数据库记录`)
        
        // 查询所有用户绑定记录
        const allBinds = await ctx.database.get('mcidbind', {})
        logger.info(`[重置白名单] 共有${allBinds.length}条记录需要检查`)
        
        // 统计信息
        let processedCount = 0
        let updatedCount = 0
        
        // 处理每条记录
        for (const bind of allBinds) {
          processedCount++
          
          // 检查该用户是否有此服务器的白名单
          if (bind.whitelist && bind.whitelist.includes(serverId)) {
            // 更新记录，移除该服务器的白名单
            const newWhitelist = bind.whitelist.filter(id => id !== serverId)
            await ctx.database.set('mcidbind', { qqId: bind.qqId }, {
              whitelist: newWhitelist
            })
            updatedCount++
            logger.info(`[重置白名单] 已从QQ(${bind.qqId})的白名单记录中移除服务器ID"${serverId}"`)
          }
        }
        
        logger.info(`[重置白名单] 成功: 主人QQ(${normalizedUserId})重置了服务器ID"${serverId}"的白名单数据库，共处理${processedCount}条记录，更新${updatedCount}条记录`)
        return sendMessage(session, [h.text(`已成功重置服务器ID"${serverId}"的白名单数据库记录\n共处理${processedCount}条记录，更新${updatedCount}条记录\n\n注意：此操作仅清除数据库记录，如需同时清除服务器上的白名单，请使用RCON命令手动操作`)])
      } catch (error) {
        const normalizedUserId = normalizeQQId(session.userId)
        logger.error(`[重置白名单] QQ(${normalizedUserId})重置白名单数据库失败: ${error.message}`)
        return sendMessage(session, [h.text(getFriendlyErrorMessage(error))])
      }
    })
    
  // 重置所有未在服务器配置中的白名单ID
  whitelistCmd.subcommand('.resetall', '[主人]清理所有未在服务器配置列表中的白名单ID')
    .action(async ({ session }) => {
      try {
        const normalizedUserId = normalizeQQId(session.userId)
        
        // 检查是否为主人
        if (!isMaster(session.userId)) {
          logger.warn(`[清理白名单] 权限不足: QQ(${normalizedUserId})不是主人，无法执行清理操作`)
          return sendMessage(session, [h.text('只有主人才能执行白名单清理操作')])
        }
        
        // 获取当前配置中所有有效的服务器ID
        const validServerIds = new Set(config.servers?.map(server => server.id) || [])
        logger.info(`[清理白名单] 主人QQ(${normalizedUserId})开始清理白名单，有效服务器ID: ${Array.from(validServerIds).join(', ')}`)
        
        // 查询所有用户绑定记录
        const allBinds = await ctx.database.get('mcidbind', {})
        
        // 统计信息
        let processedCount = 0
        let updatedCount = 0
        let removedIdsTotal = 0
        const invalidIdsFound = new Set<string>()
        
        // 处理每条记录
        for (const bind of allBinds) {
          processedCount++
          
          if (bind.whitelist && bind.whitelist.length > 0) {
            // 分离有效和无效的服务器ID
            const validIds = bind.whitelist.filter(id => validServerIds.has(id))
            const invalidIds = bind.whitelist.filter(id => !validServerIds.has(id))
            
            // 记录发现的无效ID
            invalidIds.forEach(id => invalidIdsFound.add(id))
            
            // 如果有无效ID需要移除
            if (invalidIds.length > 0) {
              await ctx.database.set('mcidbind', { qqId: bind.qqId }, {
                whitelist: validIds
              })
              updatedCount++
              removedIdsTotal += invalidIds.length
              logger.info(`[清理白名单] QQ(${bind.qqId})移除了${invalidIds.length}个无效的服务器ID: ${invalidIds.join(', ')}`)
            }
          }
        }
        
        // 生成清理报告
        const invalidIdsArray = Array.from(invalidIdsFound)
        let resultMessage = `白名单清理完成\n共处理${processedCount}条记录，更新${updatedCount}条记录\n移除了${removedIdsTotal}个无效的白名单条目`
        
        if (invalidIdsArray.length > 0) {
          resultMessage += `\n\n发现的无效服务器ID:\n${invalidIdsArray.map(id => `• ${id}`).join('\n')}`
        }
        
        logger.info(`[清理白名单] 成功: 主人QQ(${normalizedUserId})清理完成，处理${processedCount}条记录，更新${updatedCount}条记录，移除${removedIdsTotal}个无效条目`)
        return sendMessage(session, [h.text(resultMessage)])
      } catch (error) {
        const normalizedUserId = normalizeQQId(session.userId)
        logger.error(`[清理白名单] QQ(${normalizedUserId})清理白名单失败: ${error.message}`)
        return sendMessage(session, [h.text(getFriendlyErrorMessage(error))])
      }
    })
    
  // 批量将所有用户添加到服务器白名单
  whitelistCmd.subcommand('.addall <serverIdOrName:string>', '[管理员]将所有用户添加到指定服务器白名单')
    .action(async ({ session }, serverIdOrName) => {
      try {
        const normalizedUserId = normalizeQQId(session.userId)
        
        // 检查是否为管理员
        if (!await isAdmin(session.userId)) {
          logger.warn(`[批量白名单] 权限不足: QQ(${normalizedUserId})不是管理员，无法执行批量添加白名单操作`)
          return sendMessage(session, [h.text('只有管理员才能执行批量添加白名单操作')])
        }
        
        // 检查服务器名称或ID
        if (!serverIdOrName) {
          logger.warn(`[批量白名单] QQ(${normalizedUserId})未提供服务器名称或ID`)
          return sendMessage(session, [h.text('请提供服务器名称或ID\n使用 mcid whitelist servers 查看可用服务器列表')])
        }
        
        // 获取服务器配置
        const server = getServerConfigByIdOrName(serverIdOrName)
        if (!server) {
          logger.warn(`[批量白名单] QQ(${normalizedUserId})提供的服务器名称或ID"${serverIdOrName}"无效`)
          return sendMessage(session, [h.text(`未找到名称或ID为"${serverIdOrName}"的服务器\n使用 mcid whitelist servers 查看可用服务器列表`)])
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
        
        // 按绑定时间排序，早绑定的用户优先处理
        validBinds.sort((a, b) => {
          const timeA = a.lastModified ? new Date(a.lastModified).getTime() : 0;
          const timeB = b.lastModified ? new Date(b.lastModified).getTime() : 0;
          return timeA - timeB; // 升序排序，早绑定的在前
        });
        
        logger.info(`[批量白名单] 管理员QQ(${normalizedUserId})正在批量添加服务器"${server.name}"的白名单，共有${validBinds.length}条有效记录需要处理，已按绑定时间排序（早绑定优先）`)
        
        // 统计信息
        let successCount = 0
        let failCount = 0
        let skipCount = 0
        
        // 记录最后一次通知的进度百分比
        let lastNotifiedProgress = 0
        
        // 使用队列处理，每个请求等待上一个完成后再继续
        // 移除并发处理，改为顺序处理确保RCON命令按顺序执行
        for (let i = 0; i < validBinds.length; i++) {
          const bind = validBinds[i];
          
          try {
            // 跳过已经在白名单中的用户
            if (isInServerWhitelist(bind, server.id)) {
              skipCount++
              logger.debug(`[批量白名单] 跳过已在白名单中的用户QQ(${bind.qqId})的MC账号(${bind.mcUsername})`)
            } else {
              // 添加错误阈值检查
              const currentFailRate = failCount / (successCount + failCount + 1);
              if (currentFailRate > 0.5 && (successCount + failCount) >= 5) {
                logger.error(`[批量白名单] 失败率过高(${Math.round(currentFailRate * 100)}%)，中止操作`);
                await sendMessage(session, [h.text(`⚠️ 批量添加白名单操作已中止: 失败率过高(${Math.round(currentFailRate * 100)}%)，请检查服务器连接`)]);
                break;
              }
              
              // 执行添加白名单操作，顺序执行确保每个命令等待上一个完成
              const result = await addServerWhitelist(bind, server)
              
              if (result) {
                successCount++
                logger.debug(`[批量白名单] 成功添加用户QQ(${bind.qqId})的MC账号(${bind.mcUsername})到服务器"${server.name}"的白名单`)
              } else {
                failCount++
                logger.error(`[批量白名单] 添加用户QQ(${bind.qqId})的MC账号(${bind.mcUsername})到服务器"${server.name}"的白名单失败`)
              }
            }
          } catch (error) {
            failCount++
            logger.error(`[批量白名单] 处理用户QQ(${bind.qqId})时出错: ${error.message}`)
            
            // 如果错误指示操作已中止，退出循环
            if (error.message.includes('失败率过高')) {
              await sendMessage(session, [h.text(`⚠️ 批量添加白名单操作已中止: ${error.message}`)]);
              break;
            }
          }
          
          // 计算进度
          const processedCount = i + 1;
          const progress = Math.floor((processedCount / validBinds.length) * 100);
          
          // 只有当进度增加了20%或以上，或者是首次或最后一次才发送通知
          if (i === 0 || progress - lastNotifiedProgress >= 20 || i === validBinds.length - 1) {
            await sendMessage(session, [h.text(`批量添加白名单进度: ${progress}%，已处理${processedCount}/${validBinds.length}个用户\n成功: ${successCount} | 失败: ${failCount} | 跳过: ${skipCount}`)]);
            lastNotifiedProgress = progress;
          }
          
          // 添加延迟确保RCON命令有足够的处理时间，避免过载
          await new Promise(resolve => setTimeout(resolve, 1000)); // 每个请求间隔1秒
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
        error.response?.status === 429 || // 添加429 (Too Many Requests)
        error.response?.status === 403)) { // 添加403 (Forbidden)
        
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

  // 根据服务器ID或名称获取服务器配置
  const getServerConfigByIdOrName = (serverIdOrName: string): ServerConfig | null => {
    if (!config.servers || !Array.isArray(config.servers)) return null
    
    // 先尝试通过ID精确匹配
    const serverById = getServerConfigById(serverIdOrName)
    if (serverById) return serverById
    
    // 如果ID未匹配到，尝试通过名称匹配
    return getServerConfigByName(serverIdOrName)
  }

  // =========== 标签管理功能 ===========
  const tagCmd = cmd.subcommand('.tag', '[管理员]用户标签管理')
  
  // 添加标签
  tagCmd.subcommand('.add <tagName:string> [...targets:string]', '为用户添加标签')
    .action(async ({ session }, tagName, ...targets) => {
      try {
        const normalizedUserId = normalizeQQId(session.userId)
        
        // 检查权限
        if (!await isAdmin(session.userId)) {
          logger.warn(`[标签] 权限不足: QQ(${normalizedUserId})不是管理员，无法管理标签`)
          return sendMessage(session, [h.text('只有管理员才能管理用户标签')])
        }
        
        // 检查标签名称
        if (!tagName) {
          logger.warn(`[标签] QQ(${normalizedUserId})未提供标签名称`)
          return sendMessage(session, [h.text('请提供标签名称')])
        }
        
        // 验证标签名称格式（只允许字母、数字、中文、下划线和连字符）
        if (!/^[\u4e00-\u9fa5a-zA-Z0-9_-]+$/.test(tagName)) {
          logger.warn(`[标签] QQ(${normalizedUserId})提供的标签名称"${tagName}"格式无效`)
          return sendMessage(session, [h.text('标签名称只能包含中文、字母、数字、下划线和连字符')])
        }
        
        // 如果没有指定目标用户，报错
        if (!targets || targets.length === 0) {
          logger.warn(`[标签] QQ(${normalizedUserId})未指定目标用户`)
          return sendMessage(session, [h.text('请使用@指定要添加标签的用户')])
        }
        
        // 单个用户的简洁处理逻辑
        if (targets.length === 1) {
          const target = targets[0]
          const normalizedTargetId = normalizeQQId(target)
          logger.info(`[标签] 管理员QQ(${normalizedUserId})尝试为QQ(${normalizedTargetId})添加标签"${tagName}"`)
          
          // 获取目标用户的绑定信息
          let targetBind = await getMcBindByQQId(normalizedTargetId)
          
          // 如果用户没有记录，创建一个临时记录
          if (!targetBind) {
            const tempUsername = `_temp_${normalizedTargetId}`
            await ctx.database.create('mcidbind', {
              qqId: normalizedTargetId,
              mcUsername: tempUsername,
              mcUuid: '',
              lastModified: new Date(),
              isAdmin: false,
              whitelist: [],
              tags: []
            })
            targetBind = await getMcBindByQQId(normalizedTargetId)
          }
          
          // 检查是否已有该标签
          if (targetBind.tags && targetBind.tags.includes(tagName)) {
            logger.warn(`[标签] QQ(${normalizedTargetId})已有标签"${tagName}"`)
            return sendMessage(session, [h.text(`用户 ${normalizedTargetId} 已有标签"${tagName}"`)])
          }
          
          // 添加标签
          const newTags = [...(targetBind.tags || []), tagName]
          await ctx.database.set('mcidbind', { qqId: normalizedTargetId }, { tags: newTags })
          
          logger.info(`[标签] 成功: 管理员QQ(${normalizedUserId})为QQ(${normalizedTargetId})添加了标签"${tagName}"`)
          return sendMessage(session, [h.text(`已成功为用户 ${normalizedTargetId} 添加标签"${tagName}"`)])
        }
        
        // 批量用户的详细处理逻辑
        logger.info(`[标签] 管理员QQ(${normalizedUserId})尝试批量为${targets.length}个用户添加标签"${tagName}"`)
        
        await sendMessage(session, [h.text(`开始为${targets.length}个用户添加标签"${tagName}"，请稍候...`)])
        
        let successCount = 0
        let failCount = 0
        let skipCount = 0
        const results: string[] = []
        
        for (let i = 0; i < targets.length; i++) {
          const target = targets[i]
          const normalizedTargetId = normalizeQQId(target)
          
          try {
            // 获取目标用户的绑定信息
            let targetBind = await getMcBindByQQId(normalizedTargetId)
            
            // 如果用户没有记录，创建一个临时记录
            if (!targetBind) {
              const tempUsername = `_temp_${normalizedTargetId}`
              await ctx.database.create('mcidbind', {
                qqId: normalizedTargetId,
                mcUsername: tempUsername,
                mcUuid: '',
                lastModified: new Date(),
                isAdmin: false,
                whitelist: [],
                tags: []
              })
              targetBind = await getMcBindByQQId(normalizedTargetId)
            }
            
            // 检查是否已有该标签
            if (targetBind.tags && targetBind.tags.includes(tagName)) {
              skipCount++
              results.push(`⏭️ ${normalizedTargetId}: 已有该标签`)
              logger.warn(`[标签] QQ(${normalizedTargetId})已有标签"${tagName}"`)
              continue
            }
            
            // 添加标签
            const newTags = [...(targetBind.tags || []), tagName]
            await ctx.database.set('mcidbind', { qqId: normalizedTargetId }, { tags: newTags })
            
            successCount++
            results.push(`✅ ${normalizedTargetId}: 添加成功`)
            logger.info(`[标签] 成功: 管理员QQ(${normalizedUserId})为QQ(${normalizedTargetId})添加了标签"${tagName}"`)
            
            // 批量操作时添加适当延迟
            if (i < targets.length - 1) {
              await new Promise(resolve => setTimeout(resolve, 100))
            }
          } catch (error) {
            failCount++
            results.push(`❌ ${normalizedTargetId}: 处理出错`)
            logger.error(`[标签] 处理用户QQ(${normalizedTargetId})时出错: ${error.message}`)
          }
        }
        
        // 生成结果报告
        let resultMessage = `批量添加标签"${tagName}"完成\n共处理${targets.length}个用户\n✅ 成功: ${successCount} 个\n❌ 失败: ${failCount} 个\n⏭️ 跳过: ${skipCount} 个`
        
        if (targets.length <= 10) {
          resultMessage += '\n\n详细结果:\n' + results.join('\n')
        }
        
        logger.info(`[标签] 批量操作完成: 管理员QQ(${normalizedUserId})为${targets.length}个用户添加标签"${tagName}"，成功: ${successCount}，失败: ${failCount}，跳过: ${skipCount}`)
        return sendMessage(session, [h.text(resultMessage)])
      } catch (error) {
        const normalizedUserId = normalizeQQId(session.userId)
        logger.error(`[标签] QQ(${normalizedUserId})添加标签失败: ${error.message}`)
        return sendMessage(session, [h.text(getFriendlyErrorMessage(error))])
      }
    })
  
  // 移除标签
  tagCmd.subcommand('.remove <tagName:string> [...targets:string]', '移除用户标签')
    .action(async ({ session }, tagName, ...targets) => {
      try {
        const normalizedUserId = normalizeQQId(session.userId)
        
        // 检查权限
        if (!await isAdmin(session.userId)) {
          logger.warn(`[标签] 权限不足: QQ(${normalizedUserId})不是管理员，无法管理标签`)
          return sendMessage(session, [h.text('只有管理员才能管理用户标签')])
        }
        
        // 检查标签名称
        if (!tagName) {
          logger.warn(`[标签] QQ(${normalizedUserId})未提供标签名称`)
          return sendMessage(session, [h.text('请提供标签名称')])
        }
        
        // 如果没有指定目标用户，报错
        if (!targets || targets.length === 0) {
          logger.warn(`[标签] QQ(${normalizedUserId})未指定目标用户`)
          return sendMessage(session, [h.text('请使用@指定要移除标签的用户')])
        }
        
        // 单个用户的简洁处理逻辑
        if (targets.length === 1) {
          const target = targets[0]
          const normalizedTargetId = normalizeQQId(target)
          logger.info(`[标签] 管理员QQ(${normalizedUserId})尝试为QQ(${normalizedTargetId})移除标签"${tagName}"`)
          
          // 获取目标用户的绑定信息
          const targetBind = await getMcBindByQQId(normalizedTargetId)
          
          if (!targetBind) {
            logger.warn(`[标签] QQ(${normalizedTargetId})无记录`)
            return sendMessage(session, [h.text(`用户 ${normalizedTargetId} 无记录`)])
          }
          
          // 检查是否有该标签
          if (!targetBind.tags || !targetBind.tags.includes(tagName)) {
            logger.warn(`[标签] QQ(${normalizedTargetId})没有标签"${tagName}"`)
            return sendMessage(session, [h.text(`用户 ${normalizedTargetId} 没有标签"${tagName}"`)])
          }
          
          // 移除标签
          const newTags = targetBind.tags.filter(tag => tag !== tagName)
          await ctx.database.set('mcidbind', { qqId: normalizedTargetId }, { tags: newTags })
          
          logger.info(`[标签] 成功: 管理员QQ(${normalizedUserId})为QQ(${normalizedTargetId})移除了标签"${tagName}"`)
          return sendMessage(session, [h.text(`已成功为用户 ${normalizedTargetId} 移除标签"${tagName}"`)])
        }
        
        // 批量用户的详细处理逻辑
        logger.info(`[标签] 管理员QQ(${normalizedUserId})尝试批量为${targets.length}个用户移除标签"${tagName}"`)
        
        await sendMessage(session, [h.text(`开始为${targets.length}个用户移除标签"${tagName}"，请稍候...`)])
        
        let successCount = 0
        let failCount = 0
        let skipCount = 0
        const results: string[] = []
        
        for (let i = 0; i < targets.length; i++) {
          const target = targets[i]
          const normalizedTargetId = normalizeQQId(target)
          
          try {
            // 获取目标用户的绑定信息
            const targetBind = await getMcBindByQQId(normalizedTargetId)
            
            if (!targetBind) {
              failCount++
              results.push(`❌ ${normalizedTargetId}: 无记录`)
              logger.warn(`[标签] QQ(${normalizedTargetId})无记录`)
              continue
            }
            
            // 检查是否有该标签
            if (!targetBind.tags || !targetBind.tags.includes(tagName)) {
              skipCount++
              results.push(`⏭️ ${normalizedTargetId}: 没有该标签`)
              logger.warn(`[标签] QQ(${normalizedTargetId})没有标签"${tagName}"`)
              continue
            }
            
            // 移除标签
            const newTags = targetBind.tags.filter(tag => tag !== tagName)
            await ctx.database.set('mcidbind', { qqId: normalizedTargetId }, { tags: newTags })
            
            successCount++
            results.push(`✅ ${normalizedTargetId}: 移除成功`)
            logger.info(`[标签] 成功: 管理员QQ(${normalizedUserId})为QQ(${normalizedTargetId})移除了标签"${tagName}"`)
            
            // 批量操作时添加适当延迟
            if (i < targets.length - 1) {
              await new Promise(resolve => setTimeout(resolve, 100))
            }
          } catch (error) {
            failCount++
            results.push(`❌ ${normalizedTargetId}: 处理出错`)
            logger.error(`[标签] 处理用户QQ(${normalizedTargetId})时出错: ${error.message}`)
          }
        }
        
        // 生成结果报告
        let resultMessage = `批量移除标签"${tagName}"完成\n共处理${targets.length}个用户\n✅ 成功: ${successCount} 个\n❌ 失败: ${failCount} 个\n⏭️ 跳过: ${skipCount} 个`
        
        if (targets.length <= 10) {
          resultMessage += '\n\n详细结果:\n' + results.join('\n')
        }
        
        logger.info(`[标签] 批量操作完成: 管理员QQ(${normalizedUserId})为${targets.length}个用户移除标签"${tagName}"，成功: ${successCount}，失败: ${failCount}，跳过: ${skipCount}`)
        return sendMessage(session, [h.text(resultMessage)])
      } catch (error) {
        const normalizedUserId = normalizeQQId(session.userId)
        logger.error(`[标签] QQ(${normalizedUserId})移除标签失败: ${error.message}`)
        return sendMessage(session, [h.text(getFriendlyErrorMessage(error))])
      }
    })
  
  // 列出用户标签
  tagCmd.subcommand('.list [target:string]', '查看用户的所有标签')
    .action(async ({ session }, target) => {
      try {
        const normalizedUserId = normalizeQQId(session.userId)
        
        // 检查权限
        if (!await isAdmin(session.userId)) {
          logger.warn(`[标签] 权限不足: QQ(${normalizedUserId})不是管理员，无法查看标签`)
          return sendMessage(session, [h.text('只有管理员才能查看用户标签')])
        }
        
        // 如果指定了目标用户
        if (target) {
          const normalizedTargetId = normalizeQQId(target)
          logger.info(`[标签] 管理员QQ(${normalizedUserId})查看QQ(${normalizedTargetId})的标签`)
          
          const targetBind = await getMcBindByQQId(normalizedTargetId)
          if (!targetBind) {
            logger.info(`[标签] QQ(${normalizedTargetId})无记录`)
            return sendMessage(session, [h.text(`用户 ${normalizedTargetId} 无记录`)])
          }
          
          if (!targetBind.tags || targetBind.tags.length === 0) {
            logger.info(`[标签] QQ(${normalizedTargetId})没有任何标签`)
            return sendMessage(session, [h.text(`用户 ${normalizedTargetId} 没有任何标签`)])
          }
          
          const tagList = targetBind.tags.map(tag => `• ${tag}`).join('\n')
          return sendMessage(session, [h.text(`用户 ${normalizedTargetId} 的标签:\n${tagList}`)])
        }
        
        // 查看所有标签统计
        logger.info(`[标签] 管理员QQ(${normalizedUserId})查看所有标签统计`)
        
        const allBinds = await ctx.database.get('mcidbind', {})
        const tagStats: Record<string, number> = {}
        
        // 统计每个标签的使用次数
        for (const bind of allBinds) {
          if (bind.tags && bind.tags.length > 0) {
            for (const tag of bind.tags) {
              tagStats[tag] = (tagStats[tag] || 0) + 1
            }
          }
        }
        
        if (Object.keys(tagStats).length === 0) {
          return sendMessage(session, [h.text('当前没有任何用户标签')])
        }
        
        // 按使用次数排序
        const sortedTags = Object.entries(tagStats)
          .sort((a, b) => b[1] - a[1])
          .map(([tag, count]) => `• ${tag} (${count}人)`)
          .join('\n')
        
        return sendMessage(session, [h.text(`所有标签统计:\n${sortedTags}`)])
      } catch (error) {
        const normalizedUserId = normalizeQQId(session.userId)
        logger.error(`[标签] QQ(${normalizedUserId})查看标签失败: ${error.message}`)
        return sendMessage(session, [h.text(getFriendlyErrorMessage(error))])
      }
    })
  
  // 查找有特定标签的用户
  tagCmd.subcommand('.find <tagName:string>', '查找有特定标签的所有用户')
    .action(async ({ session }, tagName) => {
      try {
        const normalizedUserId = normalizeQQId(session.userId)
        
        // 检查权限
        if (!await isAdmin(session.userId)) {
          logger.warn(`[标签] 权限不足: QQ(${normalizedUserId})不是管理员，无法查找标签`)
          return sendMessage(session, [h.text('只有管理员才能查找标签')])
        }
        
        if (!tagName) {
          logger.warn(`[标签] QQ(${normalizedUserId})未提供标签名称`)
          return sendMessage(session, [h.text('请提供要查找的标签名称')])
        }
        
        logger.info(`[标签] 管理员QQ(${normalizedUserId})查找标签"${tagName}"的用户`)
        
        // 查找所有有该标签的用户
        const allBinds = await ctx.database.get('mcidbind', {})
        const usersWithTag = allBinds.filter(bind => 
          bind.tags && bind.tags.includes(tagName)
        )
        
        if (usersWithTag.length === 0) {
          logger.info(`[标签] 没有用户有标签"${tagName}"`)
          return sendMessage(session, [h.text(`没有用户有标签"${tagName}"`)])
        }
        
        // 格式化用户列表
        const userList = usersWithTag.map(bind => {
          const mcInfo = bind.mcUsername && !bind.mcUsername.startsWith('_temp_') ? ` (MC: ${bind.mcUsername})` : ''
          return `• ${bind.qqId}${mcInfo}`
        }).join('\n')
        
        logger.info(`[标签] 找到${usersWithTag.length}个用户有标签"${tagName}"`)
        return sendMessage(session, [h.text(`有标签"${tagName}"的用户 (共${usersWithTag.length}人):\n${userList}`)])
      } catch (error) {
        const normalizedUserId = normalizeQQId(session.userId)
        logger.error(`[标签] QQ(${normalizedUserId})查找标签失败: ${error.message}`)
        return sendMessage(session, [h.text(getFriendlyErrorMessage(error))])
      }
    })

  // 重命名标签
  tagCmd.subcommand('.rename <oldTagName:string> <newTagName:string>', '[管理员]重命名标签')
    .action(async ({ session }, oldTagName, newTagName) => {
      try {
        const normalizedUserId = normalizeQQId(session.userId)
        
        // 检查权限
        if (!await isAdmin(session.userId)) {
          logger.warn(`[标签] 权限不足: QQ(${normalizedUserId})不是管理员，无法重命名标签`)
          return sendMessage(session, [h.text('只有管理员才能重命名标签')])
        }
        
        // 检查参数
        if (!oldTagName || !newTagName) {
          logger.warn(`[标签] QQ(${normalizedUserId})参数不完整`)
          return sendMessage(session, [h.text('请提供旧标签名和新标签名')])
        }
        
        // 验证新标签名称格式（只允许字母、数字、中文、下划线和连字符）
        if (!/^[\u4e00-\u9fa5a-zA-Z0-9_-]+$/.test(newTagName)) {
          logger.warn(`[标签] QQ(${normalizedUserId})提供的新标签名称"${newTagName}"格式无效`)
          return sendMessage(session, [h.text('新标签名称只能包含中文、字母、数字、下划线和连字符')])
        }
        
        // 检查旧标签是否存在
        const allBinds = await ctx.database.get('mcidbind', {})
        const usersWithOldTag = allBinds.filter(bind => 
          bind.tags && bind.tags.includes(oldTagName)
        )
        
        if (usersWithOldTag.length === 0) {
          logger.info(`[标签] 标签"${oldTagName}"不存在，无需重命名`)
          return sendMessage(session, [h.text(`标签"${oldTagName}"不存在`)])
        }
        
        // 检查新标签是否已存在
        const usersWithNewTag = allBinds.filter(bind => 
          bind.tags && bind.tags.includes(newTagName)
        )
        
        if (usersWithNewTag.length > 0) {
          logger.warn(`[标签] 新标签"${newTagName}"已存在，无法重命名`)
          return sendMessage(session, [h.text(`新标签"${newTagName}"已存在，请选择其他名称`)])
        }
        
        logger.info(`[标签] 管理员QQ(${normalizedUserId})开始将标签"${oldTagName}"重命名为"${newTagName}"`)
        await sendMessage(session, [h.text(`找到${usersWithOldTag.length}个用户有标签"${oldTagName}"，开始重命名为"${newTagName}"...`)])
        
        // 统计信息
        let successCount = 0
        let failCount = 0
        
        // 批量重命名标签
        for (const bind of usersWithOldTag) {
          try {
            // 将旧标签替换为新标签
            const newTags = bind.tags.map(tag => tag === oldTagName ? newTagName : tag)
            await ctx.database.set('mcidbind', { qqId: bind.qqId }, { tags: newTags })
            
            successCount++
            logger.debug(`[标签] 成功为用户QQ(${bind.qqId})将标签"${oldTagName}"重命名为"${newTagName}"`)
          } catch (error) {
            failCount++
            logger.error(`[标签] 为用户QQ(${bind.qqId})重命名标签失败: ${error.message}`)
          }
        }
        
        // 生成结果报告
        const resultMessage = `标签重命名完成\n"${oldTagName}" → "${newTagName}"\n共处理${usersWithOldTag.length}个用户\n✅ 成功: ${successCount} 个\n❌ 失败: ${failCount} 个`
        
        logger.info(`[标签] 重命名完成: 管理员QQ(${normalizedUserId})将标签"${oldTagName}"重命名为"${newTagName}"，处理${usersWithOldTag.length}个用户，成功: ${successCount}，失败: ${failCount}`)
        return sendMessage(session, [h.text(resultMessage)])
      } catch (error) {
        const normalizedUserId = normalizeQQId(session.userId)
        logger.error(`[标签] QQ(${normalizedUserId})重命名标签失败: ${error.message}`)
        return sendMessage(session, [h.text(getFriendlyErrorMessage(error))])
      }
    })

  // 删除所有用户的某个标签
  tagCmd.subcommand('.deleteall <tagName:string>', '[主人]删除所有用户的某个标签')
    .action(async ({ session }, tagName) => {
      try {
        const normalizedUserId = normalizeQQId(session.userId)
        
        // 检查是否为主人
        if (!isMaster(session.userId)) {
          logger.warn(`[标签] 权限不足: QQ(${normalizedUserId})不是主人，无法执行删除所有人标签操作`)
          return sendMessage(session, [h.text('只有主人才能删除所有用户的标签')])
        }
        
        if (!tagName) {
          logger.warn(`[标签] QQ(${normalizedUserId})未提供标签名称`)
          return sendMessage(session, [h.text('请提供要删除的标签名称')])
        }
        
        logger.info(`[标签] 主人QQ(${normalizedUserId})开始删除所有用户的标签"${tagName}"`)
        
        // 查找所有有该标签的用户
        const allBinds = await ctx.database.get('mcidbind', {})
        const usersWithTag = allBinds.filter(bind => 
          bind.tags && bind.tags.includes(tagName)
        )
        
        if (usersWithTag.length === 0) {
          logger.info(`[标签] 没有用户有标签"${tagName}"，无需删除`)
          return sendMessage(session, [h.text(`没有用户有标签"${tagName}"，无需删除`)])
        }
        
        logger.info(`[标签] 找到${usersWithTag.length}个用户有标签"${tagName}"，开始批量删除`)
        await sendMessage(session, [h.text(`找到${usersWithTag.length}个用户有标签"${tagName}"，开始批量删除...`)])
        
        // 统计信息
        let successCount = 0
        let failCount = 0
        
        // 批量删除标签
        for (const bind of usersWithTag) {
          try {
            // 移除该标签
            const newTags = bind.tags.filter(tag => tag !== tagName)
            await ctx.database.set('mcidbind', { qqId: bind.qqId }, { tags: newTags })
            
            successCount++
            logger.debug(`[标签] 成功从用户QQ(${bind.qqId})移除标签"${tagName}"`)
          } catch (error) {
            failCount++
            logger.error(`[标签] 从用户QQ(${bind.qqId})移除标签"${tagName}"失败: ${error.message}`)
          }
        }
        
        // 生成结果报告
        const resultMessage = `批量删除标签"${tagName}"完成\n共处理${usersWithTag.length}个用户\n✅ 成功: ${successCount} 个\n❌ 失败: ${failCount} 个`
        
        logger.info(`[标签] 批量删除完成: 主人QQ(${normalizedUserId})删除了${usersWithTag.length}个用户的标签"${tagName}"，成功: ${successCount}，失败: ${failCount}`)
        return sendMessage(session, [h.text(resultMessage)])
      } catch (error) {
        const normalizedUserId = normalizeQQId(session.userId)
        logger.error(`[标签] QQ(${normalizedUserId})批量删除标签失败: ${error.message}`)
        return sendMessage(session, [h.text(getFriendlyErrorMessage(error))])
      }
    })

  // =========== 天选开奖 Webhook 处理 ===========
  
  // 处理天选开奖结果
  const handleLotteryResult = async (lotteryData: LotteryResult): Promise<void> => {
    try {
      // 检查天选播报开关
      if (!config?.enableLotteryBroadcast) {
        logger.debug(`[天选开奖] 天选播报功能已禁用，跳过处理天选事件: ${lotteryData.lottery_id}`)
        return
      }
      
      logger.info(`[天选开奖] 开始处理天选事件: ${lotteryData.lottery_id}，奖品: ${lotteryData.reward_name}，中奖人数: ${lotteryData.winners.length}`)
      
      // 生成标签名称
      const tagName = `天选-${lotteryData.lottery_id}`
      
      // 统计信息
      let matchedCount = 0
      let notBoundCount = 0
      let tagAddedCount = 0
      let tagExistedCount = 0
      const matchedUsers: Array<{qqId: string, mcUsername: string, buidUsername: string, uid: number, username: string}> = []
      
      // 处理每个中奖用户
      for (const winner of lotteryData.winners) {
        try {
          // 根据B站UID查找绑定的QQ用户
          const bind = await getBuidBindByBuid(winner.uid.toString())
          
          if (bind && bind.qqId) {
            matchedCount++
            matchedUsers.push({
              qqId: bind.qqId,
              mcUsername: bind.mcUsername || '未绑定MC',
              buidUsername: bind.buidUsername,
              uid: winner.uid,
              username: winner.username
            })
            
            // 检查是否已有该标签
            if (bind.tags && bind.tags.includes(tagName)) {
              tagExistedCount++
              logger.debug(`[天选开奖] QQ(${bind.qqId})已有标签"${tagName}"`)
            } else {
              // 添加标签
              const newTags = [...(bind.tags || []), tagName]
              await ctx.database.set('mcidbind', { qqId: bind.qqId }, { tags: newTags })
              tagAddedCount++
              logger.debug(`[天选开奖] 为QQ(${bind.qqId})添加标签"${tagName}"`)
            }
          } else {
            notBoundCount++
            logger.debug(`[天选开奖] B站UID(${winner.uid})未绑定QQ账号`)
          }
        } catch (error) {
          logger.error(`[天选开奖] 处理中奖用户UID(${winner.uid})时出错: ${error.message}`)
        }
      }
      
      logger.info(`[天选开奖] 处理完成: 总计${lotteryData.winners.length}人中奖，匹配${matchedCount}人，未绑定${notBoundCount}人，新增标签${tagAddedCount}人，已有标签${tagExistedCount}人`)
      
      // 生成并发送结果消息
      await sendLotteryResultToGroup(lotteryData, {
        totalWinners: lotteryData.winners.length,
        matchedCount,
        notBoundCount,
        tagAddedCount,
        tagExistedCount,
        matchedUsers,
        tagName
      })
      
    } catch (error) {
      logger.error(`[天选开奖] 处理天选事件"${lotteryData.lottery_id}"失败: ${error.message}`)
    }
  }
  
  // 发送天选开奖结果到群
  const sendLotteryResultToGroup = async (
    lotteryData: LotteryResult, 
    stats: {
      totalWinners: number
      matchedCount: number
      notBoundCount: number
      tagAddedCount: number
      tagExistedCount: number
      matchedUsers: Array<{qqId: string, mcUsername: string, buidUsername: string, uid: number, username: string}>
      tagName: string
    }
  ): Promise<void> => {
    try {
      const targetChannelId = '931805503' // 目标群号
      const privateTargetId = 'private:3431185320' // 私聊目标
      
      // 格式化时间
      const lotteryTime = new Date(lotteryData.timestamp).toLocaleString('zh-CN', { 
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      })
      
      // 构建简化版群消息（去掉主播信息、统计信息和标签提示）
      let groupMessage = `🎉 天选开奖结果通知\n\n`
      groupMessage += `📅 开奖时间: ${lotteryTime}\n`
      groupMessage += `🎁 奖品名称: ${lotteryData.reward_name}\n`
      groupMessage += `📊 奖品数量: ${lotteryData.reward_num}个\n`
      groupMessage += `🎲 总中奖人数: ${stats.totalWinners}人`
      
      // 添加未绑定用户说明
      if (stats.notBoundCount > 0) {
        groupMessage += `（其中${stats.notBoundCount}人未绑定跳过）`
      }
      groupMessage += `\n\n`
      
      // 如果有匹配的用户，显示详细信息
      if (stats.matchedUsers.length > 0) {
        groupMessage += `🎯 已绑定的中奖用户:\n`
        
        // 限制显示前10个用户，避免消息过长
        const displayUsers = stats.matchedUsers.slice(0, 10)
        for (let i = 0; i < displayUsers.length; i++) {
          const user = displayUsers[i]
          const index = i + 1
          groupMessage += `${index}. ${user.buidUsername} (UID: ${user.uid})\n`
          groupMessage += `   QQ: ${user.qqId} | MC: ${user.mcUsername}\n`
        }
        
        // 如果用户太多，显示省略信息
        if (stats.matchedUsers.length > 10) {
          groupMessage += `... 还有${stats.matchedUsers.length - 10}位中奖用户\n`
        }
      } else {
        groupMessage += `😔 暂无已绑定用户中奖\n`
      }
      
      // 构建完整版私聊消息（包含所有信息和未绑定用户）
      let privateMessage = `🎉 天选开奖结果通知\n\n`
      privateMessage += `📅 开奖时间: ${lotteryTime}\n`
      privateMessage += `🎁 奖品名称: ${lotteryData.reward_name}\n`
      privateMessage += `📊 奖品数量: ${lotteryData.reward_num}个\n`
      privateMessage += `🏷️ 事件ID: ${lotteryData.lottery_id}\n`
      privateMessage += `👤 主播: ${lotteryData.host_username} (UID: ${lotteryData.host_uid})\n`
      privateMessage += `🏠 房间号: ${lotteryData.room_id}\n\n`
      
      // 统计信息
      privateMessage += `📈 处理统计:\n`
      privateMessage += `• 总中奖人数: ${stats.totalWinners}人\n`
      privateMessage += `• 已绑定用户: ${stats.matchedCount}人 ✅\n`
      privateMessage += `• 未绑定用户: ${stats.notBoundCount}人 ⚠️\n`
      privateMessage += `• 新增标签: ${stats.tagAddedCount}人\n`
      privateMessage += `• 已有标签: ${stats.tagExistedCount}人\n\n`
      
      // 显示所有中奖用户（包括未绑定的）
      if (lotteryData.winners.length > 0) {
        privateMessage += `🎯 所有中奖用户:\n`
        
        for (let i = 0; i < lotteryData.winners.length; i++) {
          const winner = lotteryData.winners[i]
          const index = i + 1
          
          // 查找对应的绑定用户
          const matchedUser = stats.matchedUsers.find(user => user.uid === winner.uid)
          
          if (matchedUser) {
            privateMessage += `${index}. ${winner.username} (UID: ${winner.uid})\n`
            privateMessage += `   QQ: ${matchedUser.qqId} | MC: ${matchedUser.mcUsername}\n`
          } else {
            privateMessage += `${index}. ${winner.username} (UID: ${winner.uid})\n`
            privateMessage += `   无绑定信息，自动跳过\n`
          }
        }
        
        privateMessage += `\n🏷️ 标签"${stats.tagName}"已自动添加到已绑定用户\n`
      }
      
      // 准备消息元素
      const groupMessageElements = [h.text(groupMessage)]
      const privateMessageElements = [h.text(privateMessage)]
      
      // 发送消息到指定群（简化版）
      for (const bot of ctx.bots) {
        try {
          await bot.sendMessage(targetChannelId, groupMessageElements)
          logger.info(`[天选开奖] 成功发送简化开奖结果到群${targetChannelId}`)
          break // 成功发送后退出循环
        } catch (error) {
          logger.error(`[天选开奖] 发送消息到群${targetChannelId}失败: ${error.message}`)
        }
      }
      
      // 发送消息到私聊（完整版）
      for (const bot of ctx.bots) {
        try {
          await bot.sendMessage(privateTargetId, privateMessageElements)
          logger.info(`[天选开奖] 成功发送完整开奖结果到私聊${privateTargetId}`)
          break // 成功发送后退出循环
        } catch (error) {
          logger.error(`[天选开奖] 发送消息到私聊${privateTargetId}失败: ${error.message}`)
        }
      }
      
    } catch (error) {
      logger.error(`[天选开奖] 发送开奖结果失败: ${error.message}`)
    }
  }

  // 绑定B站账号命令
  cmd.subcommand('.bindbuid <buid:string>', '绑定B站账号')
    .action(async ({ session }, buid) => {
      try {
        const normalizedUserId = normalizeQQId(session.userId)
        logger.info(`[绑定] QQ(${normalizedUserId})尝试绑定B站UID(${buid})`)
        
        // 验证B站UID格式
        if (!buid || !/^\d+$/.test(buid)) {
          logger.warn(`[绑定] QQ(${normalizedUserId})尝试绑定无效的B站UID格式: ${buid}`)
          return sendMessage(session, [h.text(`无效的B站UID格式，请输入正确的B站UID`)])
        }
        
        // 检查是否已绑定
        const existingBind = await getBuidBindByBuid(buid)
        if (existingBind) {
          const existingQQId = existingBind.qqId
          logger.warn(`[绑定] QQ(${normalizedUserId})尝试绑定已被QQ(${existingQQId})绑定的B站UID(${buid})`)
          return sendMessage(session, [h.text(`该B站UID已被其他用户绑定`)])
        }
        
        // 验证B站UID
        const buidUser = await validateBUID(buid)
        if (!buidUser) {
          logger.warn(`[绑定] QQ(${normalizedUserId})尝试绑定不存在的B站UID(${buid})`)
          return sendMessage(session, [h.text(`无法验证B站UID，请确认输入正确`)])
        }
        
        // 创建或更新绑定
        const success = await createOrUpdateBuidBind(normalizedUserId, buidUser)
        if (success) {
          logger.info(`[绑定] QQ(${normalizedUserId})成功绑定B站UID(${buid})`)
          return sendMessage(session, [
            h.text(`成功绑定B站账号！\n`),
            h.text(`B站UID: ${buidUser.uid}\n`),
            h.text(`用户名: ${buidUser.username}\n`),
            buidUser.guard_level > 0 ? h.text(`舰长等级: ${buidUser.guard_level_text} (${buidUser.guard_level})\n`) : null,
            buidUser.medal ? h.text(`粉丝牌: ${buidUser.medal.name} Lv.${buidUser.medal.level}\n`) : null,
            buidUser.wealthMedalLevel > 0 ? h.text(`荣耀等级: ${buidUser.wealthMedalLevel}\n`) : null,
            ...(config?.showAvatar ? [h.image(`https://workers.vrp.moe/bilibili/avatar/${buidUser.uid}?size=160`)] : [])
          ].filter(Boolean))
        } else {
          logger.error(`[绑定] QQ(${normalizedUserId})绑定B站UID(${buid})失败`)
          return sendMessage(session, [h.text(`绑定失败，请稍后重试`)])
        }
      } catch (error) {
        logError('绑定', session.userId, error)
        return sendMessage(session, [h.text(`绑定失败：${getFriendlyErrorMessage(error)}`)])
      }
    })

  // 解绑B站账号命令
  cmd.subcommand('.unbindbuid', '解绑B站账号')
    .action(async ({ session }) => {
      try {
        const normalizedUserId = normalizeQQId(session.userId)
        logger.info(`[解绑] QQ(${normalizedUserId})尝试解绑B站账号`)
        
        // 查询当前绑定
        const bind = await getMcBindByQQId(normalizedUserId)
        if (!bind || !bind.buidUid) {
          logger.warn(`[解绑] QQ(${normalizedUserId})尝试解绑未绑定的B站账号`)
          return sendMessage(session, [h.text(`您尚未绑定B站账号`)])
        }
        
        // 更新绑定信息
        const updateData = {
          buidUid: '',
          buidUsername: '',
          guardLevel: 0,
          guardLevelText: '',
          medalName: '',
          medalLevel: 0,
          wealthMedalLevel: 0,
          lastActiveTime: null,
          lastModified: new Date()
        }
        
        await ctx.database.set('mcidbind', { qqId: normalizedUserId }, updateData)
        logger.info(`[解绑] QQ(${normalizedUserId})成功解绑B站账号`)
        return sendMessage(session, [h.text(`已成功解绑B站账号`)])
      } catch (error) {
        logError('解绑', session.userId, error)
        return sendMessage(session, [h.text(`解绑失败：${getFriendlyErrorMessage(error)}`)])
      }
    })
}
