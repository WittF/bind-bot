import { Context, h } from 'koishi'
import { normalizeQQId } from './helpers'
import { LoggerService } from './logger'

/**
 * 交互式绑定会话状态接口
 */
export interface BindingSession {
  userId: string
  channelId: string
  state: 'waiting_mc_username' | 'waiting_buid'
  startTime: number
  timeout: NodeJS.Timeout
  mcUsername?: string
  mcUuid?: string
  invalidInputCount?: number // 记录无效输入次数
}

/**
 * 绑定会话管理器
 * 管理交互式绑定流程的会话状态
 */
export class SessionManager {
  private sessions: Map<string, BindingSession> = new Map()
  private sessionTimeout: number
  private ctx: Context
  private logger: LoggerService

  /**
   * 创建会话管理器实例
   * @param ctx Koishi Context
   * @param logger 日志服务
   * @param sessionTimeout 会话超时时间（毫秒）
   */
  constructor(ctx: Context, logger: LoggerService, sessionTimeout: number = 3 * 60 * 1000) {
    this.ctx = ctx
    this.logger = logger
    this.sessionTimeout = sessionTimeout
  }

  /**
   * 生成会话键
   */
  private getSessionKey(userId: string, channelId: string): string {
    return `${normalizeQQId(userId)}_${channelId}`
  }

  /**
   * 创建新的绑定会话
   * @param userId 用户ID
   * @param channelId 频道ID
   */
  createSession(userId: string, channelId: string): void {
    const sessionKey = this.getSessionKey(userId, channelId)

    // 如果已有会话，先清理
    const existingSession = this.sessions.get(sessionKey)
    if (existingSession) {
      clearTimeout(existingSession.timeout)
      this.sessions.delete(sessionKey)
    }

    // 创建超时定时器
    const timeout = setTimeout(() => {
      this.sessions.delete(sessionKey)
      // 发送超时消息，@用户
      const normalizedUser = normalizeQQId(userId)
      this.ctx.bots.forEach(bot => {
        bot
          .sendMessage(channelId, [
            h.at(normalizedUser),
            h.text(
              ' 绑定会话已超时，请重新开始绑定流程\n\n⚠️ 温馨提醒：若在管理员多次提醒后仍不配合绑定账号信息，将按群规进行相应处理。'
            )
          ])
          .catch(() => {})
      })
      this.logger.info('交互绑定', `QQ(${normalizedUser})的绑定会话因超时被清理`, true)
    }, this.sessionTimeout)

    // 创建新会话
    const session: BindingSession = {
      userId: normalizeQQId(userId),
      channelId,
      state: 'waiting_buid',
      startTime: Date.now(),
      timeout
    }

    this.sessions.set(sessionKey, session)
    this.logger.info('交互绑定', `为QQ(${normalizeQQId(userId)})创建了新的绑定会话`, true)
  }

  /**
   * 获取绑定会话
   * @param userId 用户ID
   * @param channelId 频道ID
   * @returns 绑定会话或null
   */
  getSession(userId: string, channelId: string): BindingSession | null {
    const sessionKey = this.getSessionKey(userId, channelId)
    return this.sessions.get(sessionKey) || null
  }

  /**
   * 更新绑定会话
   * @param userId 用户ID
   * @param channelId 频道ID
   * @param updates 更新的字段
   */
  updateSession(userId: string, channelId: string, updates: Partial<BindingSession>): void {
    const sessionKey = this.getSessionKey(userId, channelId)
    const session = this.sessions.get(sessionKey)
    if (session) {
      Object.assign(session, updates)
    }
  }

  /**
   * 移除绑定会话
   * @param userId 用户ID
   * @param channelId 频道ID
   */
  removeSession(userId: string, channelId: string): void {
    const sessionKey = this.getSessionKey(userId, channelId)
    const session = this.sessions.get(sessionKey)
    if (session) {
      clearTimeout(session.timeout)
      this.sessions.delete(sessionKey)
      this.logger.info('交互绑定', `移除了QQ(${normalizeQQId(userId)})的绑定会话`, true)
    }
  }

  /**
   * 获取当前活跃会话数量
   */
  getActiveSessionCount(): number {
    return this.sessions.size
  }

  /**
   * 清除所有会话（通常在插件卸载时调用）
   */
  clearAllSessions(): void {
    for (const [, session] of this.sessions.entries()) {
      clearTimeout(session.timeout)
    }
    this.sessions.clear()
    this.logger.info('交互绑定', '已清除所有绑定会话', true)
  }
}
