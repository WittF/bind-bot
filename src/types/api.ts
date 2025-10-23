/**
 * 外部API响应接口类型定义
 * 包含 Mojang API、ZMINFO API 和 Bilibili API
 */

/**
 * Mojang API 响应接口
 * 用于获取MC用户UUID和用户名
 *
 * @see https://api.mojang.com/users/profiles/minecraft/{username}
 * @see https://api.mojang.com/user/profile/{uuid}
 *
 * @example
 * ```json
 * {
 *   "id": "069a79f444e94726a5befca90e38aaf5",
 *   "name": "Notch"
 * }
 * ```
 */
export interface MojangProfile {
  /** UUID (不带连字符，32位十六进制字符串) */
  id: string
  /** 玩家名称 (Mojang返回的标准大小写) */
  name: string
}

/**
 * ZMINFO API - 用户信息接口
 *
 * @see {zminfoApiUrl}/api/user/{uid}
 *
 * @example
 * ```json
 * {
 *   "uid": "12345678",
 *   "username": "用户名",
 *   "avatar_url": "https://...",
 *   "guard_level": 3,
 *   "guard_level_text": "总督",
 *   "max_guard_level": 3,
 *   "max_guard_level_text": "总督",
 *   "medal": {
 *     "name": "粉丝牌",
 *     "level": 20,
 *     "uid": "87654321",
 *     "room": 123456
 *   },
 *   "wealthMedalLevel": 15,
 *   "last_active_time": "2025-10-23T12:00:00Z"
 * }
 * ```
 */
export interface ZminfoUser {
  /** B站用户UID */
  uid: string
  /** B站用户名 */
  username: string
  /** 用户头像URL */
  avatar_url: string
  /** 当前舰长等级 (0=无, 1=总督, 2=提督, 3=舰长) */
  guard_level: number
  /** 当前舰长等级文本描述 */
  guard_level_text: string
  /** 历史最高舰长等级 */
  max_guard_level: number
  /** 历史最高舰长等级文本描述 */
  max_guard_level_text: string
  /** 粉丝牌信息 (如果用户拥有) */
  medal: {
    /** 粉丝牌名称 */
    name: string
    /** 粉丝牌等级 */
    level: number
    /** UP主UID */
    uid: string
    /** 直播间房间号 */
    room: number
  } | null
  /** 荣耀等级 (财富勋章等级) */
  wealthMedalLevel: number
  /** 最后活跃时间 (ISO 8601格式) */
  last_active_time: string
}

/**
 * ZMINFO API 响应接口
 *
 * @example 成功响应
 * ```json
 * {
 *   "success": true,
 *   "message": "success",
 *   "data": {
 *     "user": { ... }
 *   }
 * }
 * ```
 *
 * @example 失败响应
 * ```json
 * {
 *   "success": false,
 *   "message": "User not found"
 * }
 * ```
 */
export interface ZminfoApiResponse {
  /** 请求是否成功 */
  success: boolean
  /** 响应消息 */
  message: string
  /** 响应数据 (仅成功时存在) */
  data?: {
    /** 用户信息 */
    user?: ZminfoUser
  }
}

/**
 * Bilibili Live API - 粉丝勋章信息接口
 *
 * @see https://api.live.bilibili.com/xlive/app-ucenter/v1/user/GetMyMedals
 */
export interface MedalInfo {
  /** UP主UID */
  target_id: number
  /** 粉丝牌等级 */
  level: number
  /** 粉丝牌名称 */
  medal_name: string
  /** 粉丝牌渐变色起始颜色 */
  medal_color_start: number
  /** 粉丝牌渐变色结束颜色 */
  medal_color_end: number
  /** 粉丝牌边框颜色 */
  medal_color_border: number
  /** 舰长等级 (0=无, 1=总督, 2=提督, 3=舰长) */
  guard_level: number
  /** 佩戴状态 (0=未佩戴, 1=已佩戴) */
  wearing_status: number
  /** 粉丝牌ID */
  medal_id: number
  /** 当前亲密度 */
  intimacy: number
  /** 下一级所需亲密度 */
  next_intimacy: number
  /** 今日亲密度 */
  today_feed: number
  /** 每日亲密度上限 */
  day_limit: number
  /** 舰长图标URL */
  guard_icon: string
  /** 荣耀图标URL */
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
