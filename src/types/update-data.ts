/**
 * 数据库更新数据类型定义
 */

/**
 * MC绑定更新数据接口
 */
export interface UpdateMcBindData {
  mcUsername?: string
  mcUuid?: string
  lastModified?: Date
  isAdmin?: boolean
  usernameLastChecked?: Date
  usernameCheckFailCount?: number
}

/**
 * BUID绑定更新数据接口（完整更新）
 */
export interface UpdateBuidBindData {
  buidUid?: string  // 数据库中存储为字符串
  buidUsername?: string
  guardLevel?: number
  guardLevelText?: string
  maxGuardLevel?: number
  maxGuardLevelText?: string
  medalName?: string
  medalLevel?: number
  wealthMedalLevel?: number
  lastActiveTime?: Date
  lastModified?: Date
}

/**
 * BUID信息更新数据接口（仅更新信息，不更新lastModified）
 */
export interface UpdateBuidInfoData {
  buidUsername?: string
  guardLevel?: number
  guardLevelText?: string
  maxGuardLevel?: number
  maxGuardLevelText?: string
  medalName?: string
  medalLevel?: number
  wealthMedalLevel?: number
  lastActiveTime?: Date
}

/**
 * 创建新绑定时的完整数据接口
 */
export interface CreateBindData {
  qqId: string
  mcUsername: string
  mcUuid: string
  isAdmin: boolean
  whitelist: string[]
  tags: string[]
  [key: string]: any  // 允许额外的BUID字段
}

/**
 * 标签更新数据接口
 */
export interface UpdateTagsData {
  tags?: string[]
}

/**
 * 白名单更新数据接口
 */
export interface UpdateWhitelistData {
  whitelist?: string[]
}
