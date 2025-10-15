/**
 * 数据库表结构类型定义
 * 包含 MCIDBIND 表和 SCHEDULE_MUTE_TASKS 表
 */

/**
 * MCIDBIND表结构 - MC和B站账号绑定主表
 */
export interface MCIDBIND {
  qqId: string          // 纯QQ号 (作为主键)
  mcUsername: string    // MC用户名
  mcUuid: string        // MC UUID
  usernameLastChecked?: Date    // MC用户名上次检查时间（用于改名检测缓存）
  usernameCheckFailCount?: number  // 用户名检查失败次数（连续失败计数）
  lastModified: Date    // 上次修改时间
  isAdmin: boolean      // 是否为MC绑定管理员
  whitelist: string[]   // 已添加白名单的服务器ID列表
  tags: string[]        // 用户标签列表
  // BUID相关字段
  buidUid: string       // B站UID
  buidUsername: string  // B站用户名
  guardLevel: number    // 当前舰长等级
  guardLevelText: string // 当前舰长等级文本
  maxGuardLevel: number    // 历史最高舰长等级
  maxGuardLevelText: string // 历史最高舰长等级文本
  medalName: string     // 粉丝牌名称
  medalLevel: number    // 粉丝牌等级
  wealthMedalLevel: number // 荣耀等级
  lastActiveTime: Date  // 最后活跃时间
  reminderCount: number // 随机提醒次数
}

/**
 * SCHEDULE_MUTE_TASKS表结构 - 定时禁言任务配置
 */
export interface SCHEDULE_MUTE_TASKS {
  id: number            // 任务ID (自增主键)
  groupId: string       // 群组ID
  startTime: string     // 开始时间 (格式: HH:MM)
  endTime: string       // 结束时间 (格式: HH:MM)
  enabled: boolean      // 是否启用
  setterId: string      // 设置者ID
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
