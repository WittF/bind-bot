// 数据库类型定义 - 从原 index.ts 提取

// 定义MCIDBIND表结构
export interface MCIDBIND {
  qqId: string          // 纯QQ号 (作为主键)
  mcUsername: string    // MC用户名
  mcUuid: string        // MC UUID
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

// 为koishi扩展表定义
declare module 'koishi' {
  // 添加MCIDBIND表
  interface Tables {
    mcidbind: MCIDBIND
  }
} 