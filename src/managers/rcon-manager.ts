import * as RconClient from 'rcon-client'
import { LoggerService } from '../utils/logger'
import type { ServerConfig } from '../types'

/**
 * RCON 连接管理器
 * 负责管理 Minecraft 服务器的 RCON 连接池
 */
export class RconManager {
  private connections: Map<
    string,
    {
      rcon: RconClient.Rcon
      lastUsed: number
      heartbeatInterval: NodeJS.Timeout | null
      reconnecting: boolean
    }
  > = new Map()
  private logger: LoggerService
  private heartbeatCmd = 'list' // 心跳命令，使用无害的list命令
  private heartbeatInterval = 5 * 60 * 1000 // 5分钟发送一次心跳
  private maxIdleTime = 30 * 60 * 1000 // 连接空闲30分钟后关闭
  private maxConnections = 20 // 最大同时连接数，防止资源耗尽
  private serverConfigs: ServerConfig[] = []

  constructor(logger: LoggerService, serverConfigs: ServerConfig[]) {
    this.logger = logger
    this.serverConfigs = serverConfigs

    // 每5分钟检查一次空闲连接
    setInterval(() => this.cleanIdleConnections(), 5 * 60 * 1000)
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
        this.logger.error('RCON管理器', `服务器 ${server.name} 的连接已失效，将重新连接`, error)
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
      this.logger.warn(
        'RCON管理器',
        `连接数量达到上限(${this.maxConnections})，尝试关闭最久未使用的连接`
      )
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
      this.logger.info('RCON管理器', `正在连接到服务器 ${server.name} (${server.rconAddress})`)
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
          this.logger.debug('RCON管理器', `向服务器 ${server.name} 发送心跳命令`)
          await rcon.send(this.heartbeatCmd)
        } catch (error) {
          this.logger.error('RCON管理器', `服务器 ${server.name} 心跳失败`, error)

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

      this.logger.info('RCON管理器', `成功连接到服务器 ${server.name}`)
      return rcon
    } catch (error) {
      this.logger.error('RCON管理器', `连接服务器 ${server.name} 失败`, error)

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
          this.logger.info('RCON管理器', `由于连接池满，关闭了最久未使用的连接: ${oldestId}`)
        } catch (error) {
          this.logger.debug('RCON管理器', `关闭最久未使用的连接出错: ${error.message}`)
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
      this.logger.info('RCON管理器', `重置服务器 ${server.name} 的连接`)

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
        this.logger.debug('RCON管理器', `已关闭服务器 ${server.name} 的旧连接`)
      } catch (error) {
        // 忽略关闭连接时的错误
        this.logger.debug('RCON管理器', `关闭服务器 ${server.name} 的连接时出错: ${error.message}`)
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
      this.logger.info('RCON管理器', `服务器 ${server.name} 执行命令: ${safeCommand}`)

      const response = await rcon.send(command)

      // 记录完整响应内容
      this.logger.info(
        'RCON管理器',
        `服务器 ${server.name} 收到响应: ${response.length > 0 ? response : '(空响应)'} (${response.length}字节)`
      )

      // 返回结果
      return response
    } catch (error) {
      // 根据错误类型进行不同处理
      if (
        error.message.includes('ECONNREFUSED') ||
        error.message.includes('ETIMEDOUT') ||
        error.message.includes('ECONNRESET') ||
        error.message.includes('socket')
      ) {
        // 网络连接类错误
        this.logger.error('RCON管理器', `服务器 ${server.name} 网络连接错误`, error)
        throw new Error(`无法连接到服务器 ${server.name}: ${error.message}`)
      } else if (error.message.includes('authentication')) {
        // 认证错误
        this.logger.error('RCON管理器', `服务器 ${server.name} 认证失败，请检查密码`, error)
        throw new Error(`连接服务器 ${server.name} 失败: 认证错误，请联系管理员检查RCON密码`)
      } else {
        // 其他错误
        this.logger.error('RCON管理器', `服务器 ${server.name} 执行命令失败`, error)
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
        this.logger.info('RCON管理器', `关闭服务器 ${serverName} 的空闲连接`)

        // 清除心跳定时器
        if (connectionInfo.heartbeatInterval) {
          clearInterval(connectionInfo.heartbeatInterval)
        }

        // 关闭连接
        try {
          await connectionInfo.rcon.end()
        } catch (error) {
          this.logger.debug(
            'RCON管理器',
            `关闭服务器 ${serverName} 的空闲连接时出错: ${error.message}`
          )
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
        this.logger.info('RCON管理器', `已关闭服务器 ${serverName} 的连接`)
      } catch (error) {
        this.logger.debug('RCON管理器', `关闭服务器 ${serverName} 的连接时出错: ${error.message}`)
      }
    }

    // 清空连接池
    this.connections.clear()
  }
}
