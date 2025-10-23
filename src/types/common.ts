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

/**
 * 待审批的入群申请信息
 */
export interface PendingRequest {
  /** 播报消息的ID（用于监听表情回应） */
  broadcastMessageId: string

  /** OneBot的请求标识（用于批准/拒绝） */
  requestFlag: string

  /** 申请人QQ号 */
  applicantQQ: string

  /** 申请人昵称 */
  applicantNickname: string

  /** 申请人头像URL */
  applicantAvatar: string

  /** 目标群号 */
  targetGroupId: string

  /** 申请人回答的内容（UID） */
  answer: string

  /** 申请时间戳 */
  timestamp: number

  /** 审批状态 */
  status: 'pending' | 'approved' | 'rejected' | 'processing'
}

/**
 * 拒绝流程状态
 */
export interface RejectFlow {
  /** 对应的待审批申请 */
  pendingRequest: PendingRequest

  /** 发起拒绝的管理员QQ号 */
  operatorId: string

  /** 询问消息ID */
  askMessageId: string

  /** 超时时间戳 */
  timeout: number
}

/**
 * 管理员权限缓存
 */
export interface AdminCache {
  /** 管理员QQ号列表 */
  admins: string[]

  /** 最后更新时间戳 */
  lastUpdate: number
}
