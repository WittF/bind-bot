import { Logger } from 'koishi'

/**
 * 统一的日志服务类
 * 提供一致的日志接口，支持上下文标签和调试模式
 */
export class LoggerService {
  private logger: Logger
  private debugMode: boolean
  private defaultContext: string

  /**
   * 创建日志服务实例
   * @param logger Koishi Logger 实例
   * @param debugMode 是否启用调试模式
   * @param defaultContext 默认上下文标签（可选）
   */
  constructor(logger: Logger, debugMode: boolean = false, defaultContext: string = '') {
    this.logger = logger
    this.debugMode = debugMode
    this.defaultContext = defaultContext
  }

  /**
   * 设置调试模式
   */
  setDebugMode(enabled: boolean): void {
    this.debugMode = enabled
  }

  /**
   * 获取当前调试模式状态
   */
  getDebugMode(): boolean {
    return this.debugMode
  }

  /**
   * 输出调试日志（仅在 debugMode 为 true 时输出）
   * @param context 上下文标签
   * @param message 日志消息
   */
  debug(context: string, message: string): void {
    if (this.debugMode) {
      const ctx = context || this.defaultContext
      this.logger.debug(ctx ? `[${ctx}] ${message}` : message)
    }
  }

  /**
   * 输出信息日志
   * @param context 上下文标签
   * @param message 日志消息
   * @param forceOutput 强制输出（忽略 debugMode 限制）
   */
  info(context: string, message: string, forceOutput: boolean = false): void {
    // 只有在debugMode开启或forceOutput=true时才输出普通信息
    if (this.debugMode || forceOutput) {
      const ctx = context || this.defaultContext
      this.logger.info(ctx ? `[${ctx}] ${message}` : message)
    }
  }

  /**
   * 输出警告日志（总是输出）
   * @param context 上下文标签
   * @param message 日志消息
   */
  warn(context: string, message: string): void {
    const ctx = context || this.defaultContext
    this.logger.warn(ctx ? `[${ctx}] ${message}` : message)
  }

  /**
   * 输出错误日志（总是输出）
   * @param context 上下文标签
   * @param message 错误消息
   * @param error 错误对象或错误字符串（可选）
   */
  error(context: string, message: string, error?: Error | string): void {
    const ctx = context || this.defaultContext
    let fullMessage = ctx ? `[${ctx}] ${message}` : message

    if (error) {
      const errorMessage = error instanceof Error ? error.message : error
      fullMessage += `: ${errorMessage}`
    }

    this.logger.error(fullMessage)
  }

  /**
   * 记录用户操作日志（带用户ID和操作结果）
   * @param operation 操作名称（如 "MC账号绑定"）
   * @param userId 用户ID（QQ号）
   * @param success 操作是否成功
   * @param details 额外详情（可选）
   */
  logOperation(operation: string, userId: string, success: boolean, details: string = ''): void {
    const normalizedQQId = this.normalizeQQId(userId)
    const status = success ? '成功' : '失败'
    const message = `QQ(${normalizedQQId}) ${operation} ${status}${details ? ': ' + details : ''}`

    if (success) {
      // 成功的操作，只在debug模式下输出详情
      // 特殊处理：绑定相关操作强制输出
      const forceOutput = !this.debugMode && operation.includes('绑定')
      this.info('操作', message, forceOutput)
    } else {
      // 失败的操作总是输出为警告
      this.warn('操作', message)
    }
  }

  /**
   * 规范化QQ号格式（移除platform前缀）
   * @param userId 用户ID（可能包含 platform: 前缀）
   * @returns 纯QQ号字符串
   */
  private normalizeQQId(userId: string): string {
    if (!userId) return ''

    // 移除可能的 platform: 前缀（如 "onebot:123456" -> "123456"）
    if (userId.includes(':')) {
      return userId.split(':').pop() || userId
    }

    return userId
  }

  /**
   * 创建子日志服务（带固定上下文）
   * @param context 固定的上下文标签
   * @returns 新的 LoggerService 实例
   */
  createChild(context: string): LoggerService {
    return new LoggerService(this.logger, this.debugMode, context)
  }

  /**
   * 获取原始的 Koishi Logger 实例（用于特殊情况）
   */
  getRawLogger(): Logger {
    return this.logger
  }
}
