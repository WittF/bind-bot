import { Context } from 'koishi'
import { LoggerService } from '../utils/logger'
import { MCIDBINDRepository } from '../repositories/mcidbind.repository'
import { ApiService } from './api.service'
import { DatabaseService } from './database.service'
import { NicknameService } from './nickname.service'
import { Config } from '../types/config'

/**
 * 服务容器类
 * 统一管理所有服务的实例化，解决服务初始化分散的问题
 */
export class ServiceContainer {
  public readonly api: ApiService
  public readonly database: DatabaseService
  public readonly nickname: NicknameService

  constructor(
    ctx: Context,
    config: Config,
    logger: LoggerService,
    mcidbindRepo: MCIDBINDRepository,
    normalizeQQId: (userId: string) => string
  ) {
    // 1. 实例化 API 服务（无依赖）
    this.api = new ApiService(logger.createChild('API服务'), {
      zminfoApiUrl: config.zminfoApiUrl,
      SESSDATA: config.forceBindSessdata
    })

    // 2. 实例化数据库服务（依赖 API 服务）
    this.database = new DatabaseService(
      ctx,
      logger.createChild('数据库服务'),
      mcidbindRepo,
      normalizeQQId,
      (uuid: string) => this.api.getUsernameByUuid(uuid)
    )

    // 3. 实例化群昵称服务（依赖 API 和数据库服务）
    this.nickname = new NicknameService(
      logger.createChild('群昵称服务'),
      { autoNicknameGroupId: config.autoNicknameGroupId },
      normalizeQQId,
      (buid: string) => this.api.validateBUID(buid),
      (uid: string) => this.api.getBilibiliOfficialUserInfo(uid),
      (userId: string, buidUser) => this.database.updateBuidInfoOnly(userId, buidUser)
    )
  }
}
