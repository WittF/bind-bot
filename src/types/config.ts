/**
 * 配置相关类型定义
 * 包含插件配置接口和服务器配置接口
 */

/**
 * 插件配置接口
 */
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
  lotteryTargetGroupId: string  // 天选播报目标群ID
  lotteryTargetPrivateId: string  // 天选播报私聊目标ID
  // 自动群昵称设置目标群
  autoNicknameGroupId: string
  // 强制绑定相关配置
  forceBindSessdata: string
  forceBindTargetUpUid: number
  forceBindTargetRoomId: number
  forceBindTargetMedalName: string
}

/**
 * 服务器配置接口
 */
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

/**
 * 强制绑定配置接口
 * 从 force-bind-utils.ts 迁移
 */
export interface ForceBindConfig {
  SESSDATA: string  // 支持完整cookie或单独SESSDATA
  zminfoApiUrl: string
  targetUpUid: number  // 目标UP主UID
  targetRoomId: number // 目标房间号
  targetMedalName: string // 目标粉丝牌名称
  debugMode: boolean
}
