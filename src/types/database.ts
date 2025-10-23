/**
 * 数据库表结构类型定义
 * 包含 MCIDBIND 表和 SCHEDULE_MUTE_TASKS 表
 */

/**
 * MCIDBIND表结构 - MC和B站账号绑定主表
 *
 * @remarks
 * 该表存储用户的 Minecraft 账号和 B站账号绑定信息
 * - 使用 qqId 作为主键
 * - mcUsername 具有唯一性约束
 * - 支持单独绑定 MC 或 B站账号
 *
 * @example
 * ```typescript
 * {
 *   qqId: '12345678',
 *   mcUsername: 'Notch',
 *   mcUuid: '069a79f4-44e9-4726-a5be-fca90e38aaf5',
 *   lastModified: new Date(),
 *   isAdmin: false,
 *   whitelist: ['survival', 'creative'],
 *   tags: ['VIP', '建筑师'],
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
 *   reminderCount: 0
 * }
 * ```
 */
export interface MCIDBIND {
  // ========== 主键字段 ==========
  /** 纯QQ号 (作为主键, 不包含 'qq:' 前缀) */
  qqId: string

  // ========== MC 绑定字段 ==========
  /** MC用户名 (具有唯一性约束) */
  mcUsername: string

  /** MC UUID (格式: 带连字符的标准UUID) */
  mcUuid: string

  /** MC用户名上次检查时间 (用于改名检测缓存) */
  usernameLastChecked?: Date

  /** 用户名检查失败次数 (连续失败计数, 失败≥3次延长冷却期至72小时) */
  usernameCheckFailCount?: number

  /** 上次修改时间 (绑定/解绑操作的时间戳) */
  lastModified: Date

  /** 是否为MC绑定管理员 (拥有管理员权限) */
  isAdmin: boolean

  /** 已添加白名单的服务器ID列表 */
  whitelist: string[]

  /** 用户标签列表 (用于分类管理) */
  tags: string[]

  // ========== BUID 绑定字段 ==========
  /** B站UID */
  buidUid: string

  /** B站用户名 */
  buidUsername: string

  /** 当前舰长等级 (0=无, 1=总督, 2=提督, 3=舰长) */
  guardLevel: number

  /** 当前舰长等级文本 (例: '舰长', '提督', '总督') */
  guardLevelText: string

  /** 历史最高舰长等级 */
  maxGuardLevel: number

  /** 历史最高舰长等级文本 */
  maxGuardLevelText: string

  /** 粉丝牌名称 */
  medalName: string

  /** 粉丝牌等级 */
  medalLevel: number

  /** 荣耀等级 (财富勋章等级) */
  wealthMedalLevel: number

  /** 最后活跃时间 (B站活跃时间) */
  lastActiveTime: Date

  /** 随机提醒次数 (用于天选时刻等功能) */
  reminderCount: number

  // ========== 绑定状态标志字段 ==========
  /** 是否已绑定 Minecraft 账号 (true=已绑定有效MC账号, false=未绑定或临时状态) */
  hasMcBind: boolean

  /** 是否已绑定 B站账号 (true=已绑定有效B站账号, false=未绑定) */
  hasBuidBind: boolean
}

/**
 * SCHEDULE_MUTE_TASKS表结构 - 定时禁言任务配置
 */
export interface SCHEDULE_MUTE_TASKS {
  id: number // 任务ID (自增主键)
  groupId: string // 群组ID
  startTime: string // 开始时间 (格式: HH:MM)
  endTime: string // 结束时间 (格式: HH:MM)
  enabled: boolean // 是否启用
  setterId: string // 设置者ID
}

/**
 * Koishi模块扩展 - 声明数据库表
 */
declare module 'koishi' {
  interface Tables {
    mcidbind: MCIDBIND
    schedule_mute_tasks: SCHEDULE_MUTE_TASKS
  }
}
