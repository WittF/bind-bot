import { Context, Session } from 'koishi'
import { LoggerService } from '../utils/logger'
import { MCIDBINDRepository } from '../repositories/mcidbind.repository'
import { ScheduleMuteRepository } from '../repositories/schedule-mute.repository'
import { RconManager } from '../managers/rcon-manager'
import { MessageUtils } from '../utils/message-utils'
import { ForceBinder } from '../force-bind-utils'
import { GroupExporter } from '../export-utils'
import { ApiService } from '../services/api.service'
import { DatabaseService } from '../services/database.service'
import { NicknameService } from '../services/nickname.service'
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
 *
 * 重构说明：
 * - 直接传入服务实例（apiService, databaseService, nicknameService）
 * - 消除了 18 个包装函数，减少代码冗余
 * - 服务方法通过实例直接调用，更清晰易维护
 */
export interface HandlerDependencies {
  // ========== 核心服务实例 ==========
  apiService: ApiService
  databaseService: DatabaseService
  nicknameService: NicknameService

  // ========== 工具函数 ==========
  normalizeQQId: (userId: string) => string
  formatCommand: (cmd: string) => string
  checkCooldown: (lastModified: Date | null, multiplier?: number) => boolean

  // ========== 权限检查函数 ==========
  isAdmin: (userId: string) => Promise<boolean>
  isMaster: (userId: string) => boolean

  // ========== 业务函数 ==========
  sendMessage: (session: Session, content: any[], options?: any) => Promise<void>
  getFriendlyErrorMessage: (error: any) => string
  getServerConfigById: (serverId: string) => any

  // ========== 服务实例 ==========
  rconManager: RconManager
  messageUtils: MessageUtils
  forceBinder: ForceBinder
  groupExporter: GroupExporter

  // ========== 会话管理 (for BindingHandler) ==========
  getBindingSession: (userId: string, channelId: string) => any
  createBindingSession: (userId: string, channelId: string, initialState?: string) => void
  updateBindingSession: (userId: string, channelId: string, updates: any) => void
  removeBindingSession: (userId: string, channelId: string) => void

  // ========== 其他共享状态 ==========
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
