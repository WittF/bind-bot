/**
 * 简单的请求限流器
 * 用于控制特定时间窗口内的请求频率
 */
export class RateLimiter {
  private requestTimes: Record<string, number[]> = {}
  private limit: number
  private timeWindow: number

  /**
   * 创建限流器实例
   * @param limit 时间窗口内允许的最大请求数
   * @param timeWindowMs 时间窗口大小（毫秒）
   */
  constructor(limit: number = 10, timeWindowMs: number = 3000) {
    this.limit = limit
    this.timeWindow = timeWindowMs
  }

  /**
   * 检查是否允许新请求
   * @param key 请求的唯一标识（如用户ID）
   * @returns 是否允许请求
   */
  canMakeRequest(key: string): boolean {
    const now = Date.now()
    if (!this.requestTimes[key]) {
      this.requestTimes[key] = []
    }

    // 清理过期请求时间
    this.requestTimes[key] = this.requestTimes[key].filter(time => now - time < this.timeWindow)

    // 检查是否超过限制
    return this.requestTimes[key].length < this.limit
  }

  /**
   * 记录新请求
   * @param key 请求的唯一标识（如用户ID）
   */
  recordRequest(key: string): void {
    if (!this.requestTimes[key]) {
      this.requestTimes[key] = []
    }
    this.requestTimes[key].push(Date.now())
  }
}
