/**
 * 数据库更新数据类型定义
 */

/**
 * MC绑定更新数据接口
 *
 * @remarks
 * 用于更新 MCIDBIND 表中的 MC 相关字段
 * 所有字段都是可选的，只更新提供的字段
 *
 * @example
 * ```typescript
 * // 仅更新用户名
 * {
 *   mcUsername: 'NewUsername'
 * }
 *
 * // 更新用户名和UUID
 * {
 *   mcUsername: 'NewUsername',
 *   mcUuid: '069a79f4-44e9-4726-a5be-fca90e38aaf5',
 *   lastModified: new Date()
 * }
 * ```
 */
export interface UpdateMcBindData {
  /** MC用户名 (NULL表示未绑定) */
  mcUsername?: string | null

  /** MC UUID (NULL表示未绑定) */
  mcUuid?: string | null

  /** 上次修改时间 */
  lastModified?: Date

  /** 是否为管理员 */
  isAdmin?: boolean

  /** 用户名上次检查时间 */
  usernameLastChecked?: Date

  /** 用户名检查失败次数 */
  usernameCheckFailCount?: number

  /** 是否已绑定MC账号 */
  hasMcBind?: boolean
}

/**
 * BUID绑定更新数据接口（完整更新）
 *
 * @remarks
 * 用于更新 MCIDBIND 表中的 B站相关字段
 * 该接口会同时更新 lastModified 字段，表示绑定操作时间
 *
 * @see {@link UpdateBuidInfoData} 仅刷新信息不更新 lastModified
 *
 * @example
 * ```typescript
 * {
 *   buidUid: '87654321',
 *   buidUsername: 'B站用户名',
 *   guardLevel: 3,
 *   guardLevelText: '舰长',
 *   maxGuardLevel: 3,
 *   maxGuardLevelText: '舰长',
 *   medalName: '粉丝牌',
 *   medalLevel: 20,
 *   wealthMedalLevel: 15,
 *   lastActiveTime: new Date(),
 *   lastModified: new Date()
 * }
 * ```
 */
export interface UpdateBuidBindData {
  /** B站UID (数据库中存储为字符串) */
  buidUid?: string

  /** B站用户名 */
  buidUsername?: string

  /** 当前舰长等级 */
  guardLevel?: number

  /** 当前舰长等级文本 */
  guardLevelText?: string

  /** 历史最高舰长等级 */
  maxGuardLevel?: number

  /** 历史最高舰长等级文本 */
  maxGuardLevelText?: string

  /** 粉丝牌名称 */
  medalName?: string

  /** 粉丝牌等级 */
  medalLevel?: number

  /** 荣耀等级 */
  wealthMedalLevel?: number

  /** 最后活跃时间 */
  lastActiveTime?: Date

  /** 上次修改时间 (绑定操作时间) */
  lastModified?: Date

  /** 是否已绑定B站账号 */
  hasBuidBind?: boolean
}

/**
 * BUID信息更新数据接口（仅更新信息，不更新lastModified）
 *
 * @remarks
 * 用于查询时刷新 B站信息，不影响绑定时间
 * 与 {@link UpdateBuidBindData} 的区别是不包含 lastModified 字段
 *
 * @example
 * ```typescript
 * // 查询时刷新B站信息
 * {
 *   buidUsername: '新用户名',
 *   guardLevel: 3,
 *   guardLevelText: '舰长',
 *   medalLevel: 21
 * }
 * ```
 */
export interface UpdateBuidInfoData {
  /** B站用户名 */
  buidUsername?: string

  /** 当前舰长等级 */
  guardLevel?: number

  /** 当前舰长等级文本 */
  guardLevelText?: string

  /** 历史最高舰长等级 */
  maxGuardLevel?: number

  /** 历史最高舰长等级文本 */
  maxGuardLevelText?: string

  /** 粉丝牌名称 */
  medalName?: string

  /** 粉丝牌等级 */
  medalLevel?: number

  /** 荣耀等级 */
  wealthMedalLevel?: number

  /** 最后活跃时间 */
  lastActiveTime?: Date
}

/**
 * 创建新绑定时的完整数据接口
 */
export interface CreateBindData {
  qqId: string
  mcUsername: string | null
  mcUuid: string | null
  isAdmin: boolean
  whitelist: string[]
  tags: string[]
  [key: string]: any // 允许额外的BUID字段
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
