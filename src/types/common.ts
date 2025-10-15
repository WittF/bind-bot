/**
 * 通用类型定义
 * 包含缓存、会话、天选开奖等公共接口
 */

/**
 * 头像缓存接口
 */
export interface AvatarCache {
  url: string
  timestamp: number
}

/**
 * 交互式绑定会话接口
 * 从 utils/session-manager.ts 重新导出
 */
export type { BindingSession } from '../utils/session-manager'

/**
 * 天选开奖 - 中奖用户接口
 */
export interface LotteryWinner {
  uid: number
  username: string
  medal_level: number
}

/**
 * 天选开奖 - 开奖结果接口
 */
export interface LotteryResult {
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
