import type { MCIDBIND } from '../types'

/**
 * 绑定状态辅助工具类
 *
 * @remarks
 * 该类提供统一的绑定状态判断方法，用于替代散落在各处的 `_temp_` 判断逻辑。
 * 支持新旧机制的向后兼容，优先使用新的 hasMcBind/hasBuidBind 字段。
 *
 * @example
 * ```typescript
 * // 检查是否有有效的 MC 绑定
 * if (BindStatus.hasValidMcBind(bind)) {
 *   console.log('用户已绑定 MC 账号')
 * }
 *
 * // 获取显示用的 MC 用户名
 * const mcName = BindStatus.getDisplayMcUsername(bind)
 * console.log(`MC 用户名: ${mcName}`)
 * ```
 */
export class BindStatus {
  /**
   * 检查是否有有效的 MC 绑定
   *
   * @param bind - 绑定记录（可为 null 或 undefined）
   * @returns true 表示已绑定有效的 MC 账号，false 表示未绑定或为临时状态
   *
   * @remarks
   * 判断逻辑：
   * 1. 优先使用新字段 `hasMcBind`（如果存在）
   * 2. 降级到旧逻辑：检查 `mcUsername` 非空且不以 `_temp_` 开头
   */
  static hasValidMcBind(bind: MCIDBIND | null | undefined): boolean {
    if (!bind) return false

    // 优先使用新字段
    if (bind.hasMcBind !== undefined) {
      return bind.hasMcBind
    }

    // 降级到旧逻辑（向后兼容）
    return !!(bind.mcUsername && !bind.mcUsername.startsWith('_temp_'))
  }

  /**
   * 检查是否有有效的 B站 绑定
   *
   * @param bind - 绑定记录（可为 null 或 undefined）
   * @returns true 表示已绑定有效的 B站 账号，false 表示未绑定
   *
   * @remarks
   * 判断逻辑：
   * 1. 优先使用新字段 `hasBuidBind`（如果存在）
   * 2. 降级到旧逻辑：检查 `buidUid` 非空
   */
  static hasValidBuidBind(bind: MCIDBIND | null | undefined): boolean {
    if (!bind) return false

    // 优先使用新字段
    if (bind.hasBuidBind !== undefined) {
      return bind.hasBuidBind
    }

    // 降级到旧逻辑
    return !!(bind.buidUid && bind.buidUid.length > 0)
  }

  /**
   * 获取显示用的 MC 用户名
   *
   * @param bind - 绑定记录（可为 null 或 undefined）
   * @param fallback - 当无有效绑定时的默认值（默认为 '未绑定'）
   * @returns MC 用户名或 fallback 值
   *
   * @example
   * ```typescript
   * const mcName = BindStatus.getDisplayMcUsername(bind, '未设置')
   * // 结果：'Notch' 或 '未设置'
   * ```
   */
  static getDisplayMcUsername(
    bind: MCIDBIND | null | undefined,
    fallback: string = '未绑定'
  ): string {
    if (!bind || !this.hasValidMcBind(bind)) {
      return fallback
    }
    return bind.mcUsername || fallback
  }

  /**
   * 获取显示用的 B站 用户名
   *
   * @param bind - 绑定记录（可为 null 或 undefined）
   * @param fallback - 当无有效绑定时的默认值（默认为 '未绑定'）
   * @returns B站 用户名或 fallback 值
   */
  static getDisplayBuidUsername(
    bind: MCIDBIND | null | undefined,
    fallback: string = '未绑定'
  ): string {
    if (!bind || !this.hasValidBuidBind(bind)) {
      return fallback
    }
    return bind.buidUsername || fallback
  }

  /**
   * 检查是否完成全部绑定（MC + B站）
   *
   * @param bind - 绑定记录（可为 null 或 undefined）
   * @returns true 表示已完成 MC 和 B站 两项绑定
   *
   * @example
   * ```typescript
   * if (BindStatus.hasCompletedAllBinds(bind)) {
   *   console.log('用户已完成所有绑定！')
   * }
   * ```
   */
  static hasCompletedAllBinds(bind: MCIDBIND | null | undefined): boolean {
    return this.hasValidMcBind(bind) && this.hasValidBuidBind(bind)
  }

  /**
   * 获取绑定状态摘要信息
   *
   * @param bind - 绑定记录（可为 null 或 undefined）
   * @returns 包含绑定状态详细信息的对象
   *
   * @example
   * ```typescript
   * const status = BindStatus.getBindingSummary(bind)
   * console.log(`MC: ${status.mcStatus}, B站: ${status.buidStatus}`)
   * // 输出: MC: 已绑定(Notch), B站: 已绑定(UID123456)
   * ```
   */
  static getBindingSummary(bind: MCIDBIND | null | undefined): {
    hasMcBind: boolean
    hasBuidBind: boolean
    hasCompletedAll: boolean
    mcStatus: string
    buidStatus: string
  } {
    const hasMcBind = this.hasValidMcBind(bind)
    const hasBuidBind = this.hasValidBuidBind(bind)

    return {
      hasMcBind,
      hasBuidBind,
      hasCompletedAll: hasMcBind && hasBuidBind,
      mcStatus: hasMcBind
        ? `已绑定(${bind?.mcUsername})`
        : '未绑定',
      buidStatus: hasBuidBind
        ? `已绑定(UID${bind?.buidUid})`
        : '未绑定'
    }
  }

  /**
   * 检查是否为临时绑定状态（仅用于过渡期诊断）
   *
   * @param bind - 绑定记录（可为 null 或 undefined）
   * @returns true 表示使用了临时用户名机制
   *
   * @deprecated 该方法仅用于重构过渡期，最终会被移除
   */
  static isTempBinding(bind: MCIDBIND | null | undefined): boolean {
    if (!bind || !bind.mcUsername) return false
    return bind.mcUsername.startsWith('_temp_')
  }
}
