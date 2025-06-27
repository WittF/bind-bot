// 配置类型定义 - 从原 index.ts 提取
export interface Config {
  cooldownDays: number
  masterId: string
  servers: ServerConfig[]
  allowTextPrefix: boolean
  botNickname: string
  autoRecallTime: number
  recallUserMessage: boolean
  debugMode: boolean
  showAvatar: boolean
  showMcSkin: boolean
  // BUID相关配置
  zminfoApiUrl: string
  // 天选播报配置
  enableLotteryBroadcast: boolean
  // 自动群昵称设置目标群
  autoNicknameGroupId: string
}

// 服务器配置接口 - 从原 index.ts 提取
export interface ServerConfig {
  id: string
  name: string
  rconAddress: string
  rconPassword: string
  addCommand: string
  removeCommand: string
  idType: 'username' | 'uuid'
  allowSelfApply: boolean
  acceptEmptyResponse?: boolean // 每个服务器单独配置
  displayAddress?: string // 服务器展示地址
  description?: string // 服务器说明信息
  enabled?: boolean // 服务器启用状态
} 