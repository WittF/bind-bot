import { Context, Session } from 'koishi'
import { LoggerService } from '../utils/logger'
import { MCIDBINDRepository } from '../repositories/mcidbind.repository'
import { ScheduleMuteRepository } from '../repositories/schedule-mute.repository'
import { RconManager } from '../managers/rcon-manager'
import { MessageUtils } from '../utils/message-utils'
import { ForceBinder } from '../force-bind-utils'
import { GroupExporter } from '../export-utils'
import type { MCIDBIND } from '../types'

/**
 * Repositories 接口 - 聚合所有数据仓储
 */
export interface Repositories {
  mcidbind: MCIDBINDRepository
  scheduleMute: ScheduleMuteRepository
}

/**
 * Handler 依赖项接口
 * 包含所有 Handler 需要的共享函数和服务
 */
export interface HandlerDependencies {
  // 工具函数
  normalizeQQId: (userId: string) => string
  formatCommand: (cmd: string) => string
  formatUuid: (uuid: string) => string
  checkCooldown: (lastModified: Date | null, multiplier?: number) => boolean
  getCrafatarUrl: (uuid: string) => string
  getStarlightSkinUrl: (uuid: string) => string

  // 数据库操作函数（for McidCommandHandler）
  getMcBindByQQId: (qqId: string) => Promise<MCIDBIND | null>
  getMcBindByUsername: (username: string) => Promise<MCIDBIND | null>
  createOrUpdateMcBind: (userId: string, username: string, uuid: string, isAdmin?: boolean) => Promise<boolean>
  deleteMcBind: (userId: string) => Promise<boolean>
  checkUsernameExists: (username: string, currentUserId?: string, uuid?: string) => Promise<boolean>
  checkAndUpdateUsername: (bind: MCIDBIND) => Promise<MCIDBIND>
  checkAndUpdateUsernameWithCache: (bind: MCIDBIND) => Promise<MCIDBIND>

  // API操作函数
  validateUsername: (username: string) => Promise<any>
  validateBUID: (uid: string) => Promise<any>
  updateBuidInfoOnly: (qqId: string, buidUser: any) => Promise<boolean>

  // 权限检查函数
  isAdmin: (userId: string) => Promise<boolean>
  isMaster: (userId: string) => boolean

  // 业务函数
  sendMessage: (session: Session, content: any[], options?: any) => Promise<void>
  autoSetGroupNickname: (
    session: Session,
    mcUsername: string | null,
    buidUsername: string,
    targetUserId?: string,
    specifiedGroupId?: string
  ) => Promise<void>
  checkNicknameFormat: (nickname: string, buidUsername: string, mcUsername: string | null) => boolean
  getBindInfo: (qqId: string) => Promise<MCIDBIND | null>

  // 配置操作函数
  getServerConfigById: (serverId: string) => any

  // 错误处理函数
  getFriendlyErrorMessage: (error: any) => string

  // 服务实例
  rconManager: RconManager
  messageUtils: MessageUtils
  forceBinder: ForceBinder
  groupExporter: GroupExporter

  // 会话管理 (for BindingHandler)
  getBindingSession: (userId: string, channelId: string) => any
  createBindingSession: (userId: string, channelId: string, initialState?: string) => void
  updateBindingSession: (userId: string, channelId: string, updates: any) => void
  removeBindingSession: (userId: string, channelId: string) => void

  // 其他共享状态
  avatarCache?: Map<string, { url: string; timestamp: number }>
  bindingSessions: Map<string, any>
}

/**
 * 命令处理器基类
 * 提供通用的上下文、配置、日志、数据仓储和共享依赖访问
 */
export abstract class BaseHandler {
  constructor(
    protected ctx: Context,
    protected config: any,
    protected logger: LoggerService,
    protected repos: Repositories,
    protected deps: HandlerDependencies
  ) {}

  /**
   * 注册命令
   * 每个子类实现自己的命令注册逻辑
   */
  abstract register(): void
}
