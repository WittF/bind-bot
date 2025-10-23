/**
 * 配置相关类型定义
 * 包含插件配置接口和服务器配置接口
 */

/**
 * 插件配置接口
 *
 * @remarks
 * 该接口定义了 BIND-BOT 插件的所有配置选项，包括：
 * - 基础配置 (冷却时间、管理员等)
 * - 服务器配置
 * - 显示选项
 * - B站相关配置
 * - 天选播报配置
 * - 强制绑定配置
 */
export interface Config {
  /** 绑定冷却天数 (防止频繁更改绑定) */
  cooldownDays: number

  /** 主管理员QQ号 (拥有最高权限) */
  masterId: string

  /** Minecraft服务器配置列表 */
  servers: ServerConfig[]

  /** 是否允许文本前缀 (支持不使用命令前缀) */
  allowTextPrefix: boolean

  /** 机器人昵称 (用于消息中的称呼) */
  botNickname: string

  /** 自动撤回时间 (秒, 0表示不撤回) */
  autoRecallTime: number

  /** 是否撤回用户消息 */
  recallUserMessage: boolean

  /** 调试模式 (输出详细日志) */
  debugMode: boolean

  /** 是否显示B站头像 */
  showAvatar: boolean

  /** 是否显示MC皮肤渲染 */
  showMcSkin: boolean

  // BUID相关配置
  /** ZMINFO API 地址 (用于获取B站用户信息) */
  zminfoApiUrl: string

  // 天选播报配置
  /** 是否启用天选播报功能 */
  enableLotteryBroadcast: boolean

  /** 天选播报目标群ID (为空则不播报到群) */
  lotteryTargetGroupId: string

  /** 天选播报私聊目标ID (为空则不私聊播报) */
  lotteryTargetPrivateId: string

  // 自动群昵称设置目标群
  /** 自动群昵称设置目标群ID (仅在该群自动设置昵称) */
  autoNicknameGroupId: string

  // 强制绑定相关配置
  /** 强制绑定使用的SESSDATA (B站Cookie) */
  forceBindSessdata: string

  /** 强制绑定目标UP主UID */
  forceBindTargetUpUid: number

  /** 强制绑定目标直播间房间号 */
  forceBindTargetRoomId: number

  /** 强制绑定目标粉丝牌名称 */
  forceBindTargetMedalName: string

  // 入群申请审批配置
  /** 入群申请审批功能配置 */
  groupRequestReview?: GroupRequestReviewConfig
}

/**
 * 服务器配置接口
 *
 * @remarks
 * 定义单个 Minecraft 服务器的配置信息，包括 RCON 连接、白名单命令模板等
 *
 * @example
 * ```typescript
 * {
 *   id: 'survival',
 *   name: '生存服',
 *   rconAddress: '127.0.0.1:25575',
 *   rconPassword: 'password123',
 *   addCommand: 'whitelist add {username}',
 *   removeCommand: 'whitelist remove {username}',
 *   idType: 'username',
 *   allowSelfApply: true,
 *   acceptEmptyResponse: false,
 *   displayAddress: 'mc.example.com',
 *   description: '主生存服务器',
 *   enabled: true
 * }
 * ```
 */
export interface ServerConfig {
  /** 服务器唯一标识符 */
  id: string

  /** 服务器显示名称 */
  name: string

  /** RCON 地址 (格式: host:port) */
  rconAddress: string

  /** RCON 密码 */
  rconPassword: string

  /** 添加白名单命令模板 (支持变量: {username}, {uuid}) */
  addCommand: string

  /** 移除白名单命令模板 (支持变量: {username}, {uuid}) */
  removeCommand: string

  /** ID 类型 (username: 使用用户名, uuid: 使用UUID) */
  idType: 'username' | 'uuid'

  /** 是否允许用户自助申请白名单 */
  allowSelfApply: boolean

  /** 是否接受 RCON 空响应 (某些服务器返回空字符串表示成功) */
  acceptEmptyResponse?: boolean

  /** 服务器展示地址 (用于显示给用户) */
  displayAddress?: string

  /** 服务器说明信息 */
  description?: string

  /** 服务器是否启用 */
  enabled?: boolean
}

/**
 * 强制绑定配置接口
 * 从 force-bind-utils.ts 迁移
 */
export interface ForceBindConfig {
  SESSDATA: string // 支持完整cookie或单独SESSDATA
  zminfoApiUrl: string
  targetUpUid: number // 目标UP主UID
  targetRoomId: number // 目标房间号
  targetMedalName: string // 目标粉丝牌名称
  debugMode: boolean
}

/**
 * 入群申请审批功能配置接口
 *
 * @remarks
 * 该功能允许通过表情回应来审批入群申请
 * - 支持自动绑定 B站 UID
 * - 支持交互式绑定流程
 * - 支持拒绝申请并回传理由
 */
export interface GroupRequestReviewConfig {
  /** 是否启用入群申请审批功能 */
  enabled: boolean

  /** 需要审批的目标群ID */
  targetGroupId: string

  /** 管理员审批操作所在的群ID（播报群） */
  reviewGroupId: string

  /** 批准并自动绑定的表情ID（默认：389 /太赞了） */
  approveAutoBindEmoji: string

  /** 批准并交互式绑定的表情ID（默认：427 /偷感） */
  approveInteractiveBindEmoji: string

  /** 拒绝申请的表情ID（默认：123 /NO） */
  rejectEmoji: string

  /** 待审批记录自动清理时间（小时） */
  autoCleanupHours: number
}
