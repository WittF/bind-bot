// API响应类型定义 - 从原 index.ts 提取

// 头像缓存接口
export interface AvatarCache {
  url: string
  timestamp: number
}

// Mojang API响应接口
export interface MojangProfile {
  id: string    // UUID (不带连字符)
  name: string  // 玩家名称
}

// ZMINFO API响应接口
export interface ZminfoUser {
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

export interface ZminfoApiResponse {
  success: boolean
  message: string
  data?: {
    user?: ZminfoUser
  }
}

// 天选开奖信息接口
export interface LotteryWinner {
  uid: number
  username: string
  medal_level: number
}

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