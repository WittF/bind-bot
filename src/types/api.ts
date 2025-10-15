/**
 * 外部API响应接口类型定义
 * 包含 Mojang API、ZMINFO API 和 Bilibili API
 */

/**
 * Mojang API 响应接口
 * 用于获取MC用户UUID和用户名
 */
export interface MojangProfile {
  id: string    // UUID (不带连字符)
  name: string  // 玩家名称
}

/**
 * ZMINFO API - 用户信息接口
 */
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

/**
 * ZMINFO API 响应接口
 */
export interface ZminfoApiResponse {
  success: boolean
  message: string
  data?: {
    user?: ZminfoUser
  }
}

/**
 * Bilibili Live API - 粉丝勋章信息接口
 */
export interface MedalInfo {
  target_id: number
  level: number
  medal_name: string
  medal_color_start: number
  medal_color_end: number
  medal_color_border: number
  guard_level: number
  wearing_status: number
  medal_id: number
  intimacy: number
  next_intimacy: number
  today_feed: number
  day_limit: number
  guard_icon: string
  honor_icon: string
}

/**
 * Bilibili Live API - 用户勋章信息接口
 */
export interface UinfoMedal {
  name: string
  level: number
  color_start: number
  color_end: number
  color_border: number
  color: number
  id: number
  typ: number
  is_light: number
  ruid: number
  guard_level: number
  score: number
  guard_icon: string
  honor_icon: string
  v2_medal_color_start: string
  v2_medal_color_end: string
  v2_medal_color_border: string
  v2_medal_color_text: string
  v2_medal_color_level: string
  user_receive_count: number
}

/**
 * Bilibili Live API - 勋章列表项接口
 */
export interface MedalListItem {
  medal_info: MedalInfo
  target_name: string
  target_icon: string
  link: string
  live_status: number
  official: number
  uinfo_medal: UinfoMedal
  data?: {
    icon?: string
    uid?: number
    name?: string
  }
}

/**
 * Bilibili Live API - 响应接口
 */
export interface BilibiliMedalAPIResponse {
  code: number
  message: string
  ttl: number
  data?: {
    list: MedalListItem[]
    count: number
    close_space_medal: number
    only_show_wearing: number
    name: string
    icon: string
    uid: number
    level: number
  }
}

/**
 * 扩展的ZMINFO用户信息接口
 * 包含目标粉丝牌数据（用于强制绑定）
 */
export interface EnhancedZminfoUser extends ZminfoUser {
  // 目标粉丝牌信息
  targetMedal?: {
    found: boolean
    name?: string
    level?: number
    guard_level?: number
    wearing_status?: number
  }
}
