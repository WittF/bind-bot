// RCON管理服务 - 从原 index.ts 提取完整的RCON管理逻辑

import { Logger } from 'koishi'
import * as RconClient from 'rcon-client'
import { ServerConfig, Config } from '../types'
import { 
  RCON_HEARTBEAT_INTERVAL, 
  RCON_MAX_IDLE_TIME, 
  RCON_MAX_CONNECTIONS,
  RCON_HEARTBEAT_CMD,
  RATE_LIMIT_REQUESTS,
  RATE_LIMIT_WINDOW
} from '../utils/constants'

// RCON连接信息接口
interface RconConnectionInfo {
  rcon: RconClient.Rcon
  lastUsed: number
  heartbeatInterval: NodeJS.Timeout | null
  reconnecting: boolean
}

// RateLimiter类，用于限制RCON请求频率 - 从原代码提取
class RateLimiter {
  private requestTimes: Record<string, number[]> = {}
  private limit: number
  private timeWindow: number

  constructor(limit: number = RATE_LIMIT_REQUESTS, timeWindowMs: number = RATE_LIMIT_WINDOW) {
    this.limit = limit
    this.timeWindow = timeWindowMs
  }

  // 检查是否允许新请求
  canMakeRequest(key: string): boolean {
    const now = Date.now()
    if (!this.requestTimes[key]) {
      this.requestTimes[key] = []
    }

    // 清理过期请求时间
    this.requestTimes[key] = this.requestTimes[key].filter(
      time => now - time < this.timeWindow
    )

    // 检查是否超过限制
    return this.requestTimes[key].length < this.limit
  }

  // 记录新请求
  recordRequest(key: string): void {
    if (!this.requestTimes[key]) {
      this.requestTimes[key] = []
    }
    this.requestTimes[key].push(Date.now())
  }
}

// RconManager类，用于管理RCON连接 - 从原代码提取
class RconManager {
  private connections: Map<string, RconConnectionInfo> = new Map()
  private logger: Logger
  private debugMode: boolean
  private heartbeatCmd = RCON_HEARTBEAT_CMD // 心跳命令，使用无害的list命令
  private heartbeatInterval = RCON_HEARTBEAT_INTERVAL // 5分钟发送一次心跳
  private maxIdleTime = RCON_MAX_IDLE_TIME // 连接空闲30分钟后关闭
  private maxConnections = RCON_MAX_CONNECTIONS // 最大同时连接数，防止资源耗尽
  private serverConfigs: ServerConfig[] = []
  
  constructor(logger: Logger, serverConfigs: ServerConfig[], debugMode: boolean = false) {
    this.logger = logger
    this.serverConfigs = serverConfigs
    this.debugMode = debugMode
    
    // 每5分钟检查一次空闲连接
    setInterval(() => this.cleanIdleConnections(), 5 * 60 * 1000)
  }
  
  // 日志辅助方法
  private logDebug(message: string): void {
    if (this.debugMode) {
      this.logger.debug(message)
    }
  }
  
  private logInfo(message: string): void {
    this.logger.info(message)
  }
  
  private logWarn(message: string): void {
    this.logger.warn(message)
  }
  
  private logError(message: string): void {
    this.logger.error(message)
  }
  
  // 获取RCON连接
  async getConnection(server: ServerConfig): Promise<RconClient.Rcon> {
    const serverId = server.id
    const connectionInfo = this.connections.get(serverId)
    
    // 如果已有连接且仍然活跃，检查连接状态
    if (connectionInfo && connectionInfo.rcon && !connectionInfo.reconnecting) {
      try {
        // 测试连接是否仍然有效
        await connectionInfo.rcon.send('ping')
        
        // 更新最后使用时间
        connectionInfo.lastUsed = Date.now()
        return connectionInfo.rcon
      } catch (error) {
        // 连接可能已关闭，需要重新建立
        this.logError(`服务器 ${server.name} 的连接已失效，将重新连接: ${error.message}`)
        await this.resetConnection(server)
      }
    }
    
    // 创建新连接
    return this.createConnection(server)
  }
  
  // 创建新RCON连接
  private async createConnection(server: ServerConfig): Promise<RconClient.Rcon> {
    // 解析RCON地址和端口
    const addressParts = server.rconAddress.split(':')
    if (addressParts.length !== 2) {
      throw new Error(`RCON地址格式错误: ${server.rconAddress}, 正确格式应为 IP:端口`)
    }
    
    const host = addressParts[0]
    const portStr = addressParts[1]
    
    // 验证端口是有效数字
    const port = parseInt(portStr)
    if (isNaN(port) || port <= 0 || port > 65535) {
      throw new Error(`服务器${server.name}的RCON端口无效: ${portStr}, 端口应为1-65535之间的数字`)
    }
    
    const serverId = server.id
    
    // 检查连接池大小，如果超过最大限制，尝试关闭最久未使用的连接
    if (this.connections.size >= this.maxConnections) {
      this.logWarn(`连接数量达到上限(${this.maxConnections})，尝试关闭最久未使用的连接`)
      this.pruneOldestConnection()
    }

    // 标记为正在重连
    if (this.connections.has(serverId)) {
      const connectionInfo = this.connections.get(serverId)
      if (connectionInfo) {
        connectionInfo.reconnecting = true
        
        // 清除旧的心跳定时器
        if (connectionInfo.heartbeatInterval) {
          clearInterval(connectionInfo.heartbeatInterval)
          connectionInfo.heartbeatInterval = null
        }
      }
    }
    
    try {
      // 创建新连接
      this.logInfo(`正在连接到服务器 ${server.name} (${server.rconAddress})`)
      const rcon = new RconClient.Rcon({
        host,
        port,
        password: server.rconPassword,
        timeout: 3000 // 3秒连接超时
      })
      
      // 连接到服务器
      await rcon.connect()
        
      // 设置心跳定时器，保持连接活跃
      const heartbeatInterval = setInterval(async () => {
        try {
          this.logDebug(`向服务器 ${server.name} 发送心跳命令`)
          await rcon.send(this.heartbeatCmd)
        } catch (error) {
          this.logError(`服务器 ${server.name} 心跳失败: ${error.message}`)
          
          // 心跳失败，重置连接
          this.resetConnection(server)
        }
      }, this.heartbeatInterval)
      
      // 存储连接信息
      this.connections.set(serverId, { 
        rcon, 
        lastUsed: Date.now(),
        heartbeatInterval,
        reconnecting: false
      })
      
      this.logInfo(`成功连接到服务器 ${server.name}`)
      return rcon
    } catch (error) {
      this.logError(`连接服务器 ${server.name} 失败: ${error.message}`)
      
      // 重置连接状态
      if (this.connections.has(serverId)) {
        const connectionInfo = this.connections.get(serverId)
        if (connectionInfo) {
          connectionInfo.reconnecting = false
        }
      }
      
      throw error
    }
  }
  
  // 关闭最久未使用的连接
  private pruneOldestConnection(): boolean {
    let oldestId: string | null = null
    let oldestTime = Infinity
    
    // 找出最久未使用的连接
    for (const [serverId, connectionInfo] of this.connections.entries()) {
      // 跳过正在重连的连接
      if (connectionInfo.reconnecting) continue
      
      if (connectionInfo.lastUsed < oldestTime) {
        oldestTime = connectionInfo.lastUsed
        oldestId = serverId
      }
    }
    
    // 如果找到了可以关闭的连接
    if (oldestId) {
      const connectionInfo = this.connections.get(oldestId)
      if (connectionInfo) {
        // 清除心跳定时器
        if (connectionInfo.heartbeatInterval) {
          clearInterval(connectionInfo.heartbeatInterval)
        }
        
        // 尝试关闭连接
        try {
          connectionInfo.rcon.end()
          this.logInfo(`由于连接池满，关闭了最久未使用的连接: ${oldestId}`)
        } catch (error) {
          this.logDebug(`关闭最久未使用的连接出错: ${error.message}`)
        }
        
        // 从连接池中移除
        this.connections.delete(oldestId)
        return true
      }
    }
    
    return false
  }
  
  // 重置连接
  private async resetConnection(server: ServerConfig): Promise<void> {
    const serverId = server.id
    const connectionInfo = this.connections.get(serverId)
    
    if (connectionInfo) {
      this.logInfo(`重置服务器 ${server.name} 的连接`)
      
      // 标记为正在重连
      connectionInfo.reconnecting = true
      
      // 清除心跳
      if (connectionInfo.heartbeatInterval) {
        clearInterval(connectionInfo.heartbeatInterval)
        connectionInfo.heartbeatInterval = null
      }
      
      try {
        // 关闭旧连接
        await connectionInfo.rcon.end()
        this.logDebug(`已关闭服务器 ${server.name} 的旧连接`)
      } catch (error) {
        // 忽略关闭连接时的错误
        this.logDebug(`关闭服务器 ${server.name} 的连接时出错: ${error.message}`)
      }
      
      // 从映射中移除
      this.connections.delete(serverId)
    }
  }
  
  // 执行RCON命令
  async executeCommand(server: ServerConfig, command: string): Promise<string> {
    // 移除重试机制，改为单次尝试
    try {
      // 获取或创建连接
      const rcon = await this.getConnection(server)
      
      // 记录完整的命令，但隐藏可能的敏感信息
      let safeCommand = command
      // 如果命令包含"op"或"password"等敏感词，则隐藏部分内容
      if (safeCommand.includes('password') || safeCommand.startsWith('op ')) {
        safeCommand = safeCommand.split(' ')[0] + ' [内容已隐藏]'
      }
      this.logInfo(`服务器 ${server.name} 执行命令: ${safeCommand}`)
      
      const response = await rcon.send(command)
      
      // 记录完整响应内容
      this.logInfo(`服务器 ${server.name} 收到响应: ${response.length > 0 ? response : '(空响应)'} (${response.length}字节)`)
      
      // 返回结果
      return response
    } catch (error) {
      // 根据错误类型进行不同处理
      if (error.message.includes('ECONNREFUSED') || 
          error.message.includes('ETIMEDOUT') || 
          error.message.includes('ECONNRESET') || 
          error.message.includes('socket')) {
        // 网络连接类错误
        this.logError(`服务器 ${server.name} 网络连接错误: ${error.message}`)
        throw new Error(`无法连接到服务器 ${server.name}: ${error.message}`)
      } else if (error.message.includes('authentication')) {
        // 认证错误
        this.logError(`服务器 ${server.name} 认证失败，请检查密码: ${error.message}`)
        throw new Error(`连接服务器 ${server.name} 失败: 认证错误，请联系管理员检查RCON密码`)
      } else {
        // 其他错误
        this.logError(`服务器 ${server.name} 执行命令失败: ${error.message}`)
        throw new Error(`执行命令失败: ${error.message}`)
      }
    }
  }
  
  // 清理空闲连接
  private async cleanIdleConnections(): Promise<void> {
    const now = Date.now()
    
    for (const [serverId, connectionInfo] of this.connections.entries()) {
      // 获取服务器名称（用于日志）
      const serverConfig = this.serverConfigs.find(server => server.id === serverId)
      const serverName = serverConfig ? serverConfig.name : serverId
      
      // 如果连接空闲时间超过maxIdleTime，关闭它
      if (now - connectionInfo.lastUsed > this.maxIdleTime) {
        this.logInfo(`关闭服务器 ${serverName} 的空闲连接`)
        
        // 清除心跳定时器
        if (connectionInfo.heartbeatInterval) {
          clearInterval(connectionInfo.heartbeatInterval)
        }
        
        // 关闭连接
        try {
          await connectionInfo.rcon.end()
        } catch (error) {
          this.logDebug(`关闭服务器 ${serverName} 的空闲连接时出错: ${error.message}`)
        }
        
        // 从连接池中删除
        this.connections.delete(serverId)
      }
    }
  }
  
  // 关闭所有连接
  async closeAll(): Promise<void> {
    for (const [serverId, connectionInfo] of this.connections.entries()) {
      // 获取服务器名称（用于日志）
      const serverConfig = this.serverConfigs.find(server => server.id === serverId)
      const serverName = serverConfig ? serverConfig.name : serverId
      
      // 清除心跳定时器
      if (connectionInfo.heartbeatInterval) {
        clearInterval(connectionInfo.heartbeatInterval)
      }
      
      // 关闭连接
      try {
        await connectionInfo.rcon.end()
        this.logInfo(`已关闭服务器 ${serverName} 的连接`)
      } catch (error) {
        this.logDebug(`关闭服务器 ${serverName} 的连接时出错: ${error.message}`)
      }
    }
    
    // 清空连接池
    this.connections.clear()
  }
}

// RCON服务主类
export class RconService {
  private logger: Logger
  private rconManager: RconManager
  private rateLimiter: RateLimiter
  private operationLocks: Record<string, boolean> = {}

  constructor(
    private config: Config,
    logger: Logger
  ) {
    this.logger = logger.extend('RconService')
    
    // 创建RCON连接管理器
    this.rconManager = new RconManager(this.logger, this.config.servers || [], this.config.debugMode)
    
    // 创建RCON限流器实例
    this.rateLimiter = new RateLimiter(RATE_LIMIT_REQUESTS, RATE_LIMIT_WINDOW)
  }

  // 获取锁
  private acquireLock(key: string): boolean {
    if (this.operationLocks[key]) {
      return false
    }
    this.operationLocks[key] = true
    return true
  }

  // 释放锁
  private releaseLock(key: string): void {
    this.operationLocks[key] = false
  }

  // 使用锁执行异步操作
  private async withLock<T>(key: string, operation: () => Promise<T>, timeoutMs = 10000): Promise<T> {
    // 操作ID，用于日志
    const operationId = Math.random().toString(36).substr(2, 9)
    
    // 尝试获取锁
    let acquired = false
    let attempts = 0
    const maxAttempts = 5
    
    while (!acquired && attempts < maxAttempts) {
      acquired = this.acquireLock(key)
      if (!acquired) {
        this.logger.debug(`操作${operationId}等待锁 ${key} 释放 (尝试 ${attempts + 1}/${maxAttempts})`)
        // 等待一段时间后重试
        await new Promise(resolve => setTimeout(resolve, 200))
        attempts++
      }
    }
    
    if (!acquired) {
      this.logger.warn(`操作${operationId}无法获取锁 ${key}，强制获取`)
      // 强制获取锁
      this.acquireLock(key)
    }
    
    try {
      // 设置超时
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`操作超时 (${timeoutMs}ms)`)), timeoutMs)
      })
      
      // 执行操作
      const operationPromise = operation()
      const result = await Promise.race([operationPromise, timeoutPromise])
      return result
    } finally {
      // 无论成功失败，都释放锁
      this.releaseLock(key)
      this.logger.debug(`操作${operationId}释放锁 ${key}`)
    }
  }

  // 执行RCON命令
  async executeRconCommand(server: ServerConfig, command: string): Promise<string> {
    const serverId = server.id
    
    // 检查是否是添加白名单命令
    const isAddCommand = command.includes(server.addCommand.replace(/\${MCID}/g, ''))
    
    // 对添加白名单命令进行限流
    if (isAddCommand) {
      if (!this.rateLimiter.canMakeRequest(serverId)) {
        this.logger.warn(`服务器 ${server.name} 请求过于频繁，请稍后再试`)
        throw new Error('请求过于频繁，请稍后再试')
      }
      
      // 记录本次请求
      this.rateLimiter.recordRequest(serverId)
    }
    
    // 在锁内执行RCON命令，确保同一服务器的操作串行化
    return this.withLock(`rcon_${serverId}`, async () => {
      try {
        // 使用RCON管理器执行命令
        return await this.rconManager.executeCommand(server, command)
      } catch (error) {
        this.logger.error(`执行命令失败: ${error.message}`)
        throw error
      }
    }, 10000) // 10秒超时
  }

  // 安全地替换命令模板 - 从原代码提取
  safeCommandReplace(template: string, mcid: string): string {
    // 过滤可能导致命令注入的字符
    const sanitizedMcid = mcid.replace(/[;&|"`'$\\]/g, '')
    
    // 如果经过过滤后的mcid与原始mcid不同，记录警告
    if (sanitizedMcid !== mcid) {
      this.logger.warn(`检测到潜在危险字符，已自动过滤: '${mcid}' -> '${sanitizedMcid}'`)
    }
    
    return template.replace(/\${MCID}/g, sanitizedMcid)
  }

  // 检查所有服务器的RCON连接
  async checkRconConnections(): Promise<{ [id: string]: boolean }> {
    if (!this.config.servers || this.config.servers.length === 0) {
      this.logger.info('未配置任何服务器，跳过RCON检查')
      return {}
    }
    
    const results: { [id: string]: boolean } = {}
    
    for (const server of this.config.servers) {
      try {
        this.logger.info(`正在检查服务器 ${server.name} (${server.rconAddress}) 的连接状态`)
        
        // 尝试执行/list命令来测试连接 (使用RCON管理器)
        await this.rconManager.executeCommand(server, 'list')
        
        // 如果没有抛出异常，表示连接成功
        this.logger.info(`服务器 ${server.name} 连接成功`)
        results[server.id] = true
      } catch (error) {
        this.logger.error(`服务器 ${server.name} 连接失败: ${error.message}`)
        results[server.id] = false
      }
    }
    
    // 生成检查结果摘要
    const totalServers = this.config.servers.length
    const successCount = Object.values(results).filter(Boolean).length
    const failCount = totalServers - successCount
    
    this.logger.info(`检查完成: ${successCount}/${totalServers} 个服务器连接成功，${failCount} 个连接失败`)
    
    if (failCount > 0) {
      const failedServers = this.config.servers
        .filter(server => !results[server.id])
        .map(server => server.name)
        .join(', ')
      
      this.logger.warn(`以下服务器连接失败，白名单功能可能无法正常工作: ${failedServers}`)
    }
    
    return results
  }

  // 获取服务器连接状态
  getConnectionStatus(): Map<string, boolean> {
    const status = new Map<string, boolean>()
    
    for (const server of this.config.servers || []) {
      const connectionInfo = this.rconManager['connections'].get(server.id)
      status.set(server.id, !!connectionInfo && !connectionInfo.reconnecting)
    }
    
    return status
  }

  // 重置特定服务器的连接
  async resetServerConnection(serverId: string): Promise<boolean> {
    const server = this.config.servers?.find(s => s.id === serverId)
    if (!server) {
      this.logger.warn(`未找到服务器ID: ${serverId}`)
      return false
    }
    
    try {
      await this.rconManager['resetConnection'](server)
      this.logger.info(`已重置服务器 ${server.name} 的连接`)
      return true
    } catch (error) {
      this.logger.error(`重置服务器 ${server.name} 连接失败: ${error.message}`)
      return false
    }
  }

  // 获取连接池统计信息
  getConnectionPoolStats(): {
    totalConnections: number
    activeConnections: number
    maxConnections: number
  } {
    const connections = this.rconManager['connections']
    const activeConnections = Array.from(connections.values()).filter(
      conn => !conn.reconnecting
    ).length
    
    return {
      totalConnections: connections.size,
      activeConnections,
      maxConnections: RCON_MAX_CONNECTIONS
    }
  }

  // 销毁服务
  async dispose(): Promise<void> {
    this.logger.info('RconService 正在销毁，关闭所有连接')
    await this.rconManager.closeAll()
  }
} 