// 通用类型定义 - 从原 index.ts 提取

// 交互型绑定会话状态接口
export interface BindingSession {
  userId: string
  channelId: string
  state: 'waiting_mc_username' | 'waiting_buid'
  startTime: number
  timeout: NodeJS.Timeout
  mcUsername?: string
  mcUuid?: string
  invalidInputCount?: number // 记录无效输入次数
}

// 消息发送选项
export interface MessageOptions {
  isProactiveMessage?: boolean
}

// 操作锁类型
export interface OperationLock {
  [key: string]: boolean
}

// 权限类型
export type PermissionLevel = 'user' | 'admin' | 'master'

// 命令执行结果
export interface CommandResult {
  success: boolean
  message?: string
  error?: string
}

// 批量操作统计结果
export interface BatchOperationStats {
  totalCount: number
  successCount: number
  failCount: number
  skipCount: number
  results?: string[]
} 