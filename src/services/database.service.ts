import { Context } from 'koishi'
import { LoggerService } from '../utils/logger'
import { MCIDBINDRepository } from '../repositories/mcidbind.repository'
import { normalizeUsername as normalizeUsernameHelper } from '../utils/helpers'
import { BindStatus } from '../utils/bind-status'
import type {
  MCIDBIND,
  ZminfoUser,
  UpdateMcBindData,
  UpdateBuidBindData,
  UpdateBuidInfoData,
  CreateBindData
} from '../types'

/**
 * 数据库服务层
 * 统一管理数据库操作，包括 MC 绑定和 BUID 绑定的 CRUD
 */
export class DatabaseService {
  constructor(
    private ctx: Context,
    private logger: LoggerService,
    private mcidbindRepo: MCIDBINDRepository,
    private normalizeQQId: (userId: string) => string,
    private getUsernameByUuid: (uuid: string) => Promise<string | null>
  ) {}

  // =========== MC 绑定相关 ===========

  /**
   * 根据 QQ 号查询 MC 绑定信息
   */
  async getMcBindByQQId(qqId: string): Promise<MCIDBIND | null> {
    try {
      // 处理空值
      if (!qqId) {
        this.logger.warn('MCIDBIND', '尝试查询空QQ号')
        return null
      }

      const normalizedQQId = this.normalizeQQId(qqId)
      // 查询MCIDBIND表中对应QQ号的绑定记录
      return await this.mcidbindRepo.findByQQId(normalizedQQId)
    } catch (error) {
      this.logger.error('MCIDBIND', `根据QQ号查询绑定信息失败: ${error.message}`)
      return null
    }
  }

  /**
   * 根据 MC 用户名查询绑定信息
   */
  async getMcBindByUsername(mcUsername: string): Promise<MCIDBIND | null> {
    // 处理空值
    if (!mcUsername) {
      this.logger.warn('MCIDBIND', '尝试查询空MC用户名')
      return null
    }

    // 使用 Repository 查询
    return await this.mcidbindRepo.findByMCUsername(mcUsername)
  }

  /**
   * 创建或更新 MC 绑定
   */
  async createOrUpdateMcBind(
    userId: string,
    mcUsername: string,
    mcUuid: string,
    isAdmin?: boolean
  ): Promise<boolean> {
    try {
      // 验证输入参数
      if (!userId) {
        this.logger.error('MCIDBIND', '创建/更新绑定失败: 无效的用户ID')
        return false
      }

      if (!mcUsername) {
        this.logger.error('MCIDBIND', '创建/更新绑定失败: 无效的MC用户名')
        return false
      }

      const normalizedQQId = this.normalizeQQId(userId)
      if (!normalizedQQId) {
        this.logger.error('MCIDBIND', '创建/更新绑定失败: 无法提取有效的QQ号')
        return false
      }

      // 查询是否已存在绑定记录
      let bind = await this.getMcBindByQQId(normalizedQQId)

      if (bind) {
        // 更新现有记录，但保留管理员状态
        const updateData: UpdateMcBindData = {
          mcUsername,
          mcUuid,
          lastModified: new Date(),
          hasMcBind: true
        }

        // 仅当指定了isAdmin参数时更新管理员状态
        if (typeof isAdmin !== 'undefined') {
          updateData.isAdmin = isAdmin
        }

        await this.mcidbindRepo.update(normalizedQQId, updateData)
        this.logger.info(
          'MCIDBIND',
          `更新绑定: QQ=${normalizedQQId}, MC用户名=${mcUsername}, UUID=${mcUuid}`,
          true
        )
        return true
      } else {
        // 创建新记录
        try {
          await this.mcidbindRepo.create({
            qqId: normalizedQQId,
            mcUsername,
            mcUuid,
            lastModified: new Date(),
            isAdmin: isAdmin || false,
            hasMcBind: true,
            hasBuidBind: false
          })
          this.logger.info(
            'MCIDBIND',
            `创建绑定: QQ=${normalizedQQId}, MC用户名=${mcUsername}, UUID=${mcUuid}`,
            true
          )
          return true
        } catch (createError) {
          this.logger.error(
            'MCIDBIND',
            `创建绑定失败: MC用户名=${mcUsername}, 错误=${createError.message}`
          )
          return false
        }
      }
    } catch (error) {
      this.logger.error(
        'MCIDBIND',
        `创建/更新绑定失败: MC用户名=${mcUsername}, 错误=${error.message}`
      )
      return false
    }
  }

  /**
   * 解绑 MC 账号（只清空 MC 字段，保留 B 站绑定）
   */
  async deleteMcBind(userId: string): Promise<boolean> {
    try {
      // 验证输入参数
      if (!userId) {
        this.logger.error('MCIDBIND', '解绑MC失败: 无效的用户ID')
        return false
      }

      const normalizedQQId = this.normalizeQQId(userId)
      if (!normalizedQQId) {
        this.logger.error('MCIDBIND', '解绑MC失败: 无法提取有效的QQ号')
        return false
      }

      // 查询是否存在绑定记录
      const bind = await this.getMcBindByQQId(normalizedQQId)

      if (!bind) {
        this.logger.warn('MCIDBIND', `解绑MC失败: QQ=${normalizedQQId}不存在绑定记录`)
        return false
      }

      // 如果没有MC绑定，返回失败
      if (!BindStatus.hasValidMcBind(bind)) {
        this.logger.warn('MCIDBIND', `解绑MC失败: QQ=${normalizedQQId}未绑定MC账号`)
        return false
      }

      const oldUsername = bind.mcUsername

      // 检查是否有B站绑定
      if (BindStatus.hasValidBuidBind(bind)) {
        // 如果有B站绑定，只清空MC字段，保留记录
        await this.mcidbindRepo.update(normalizedQQId, {
          mcUsername: null,
          mcUuid: null,
          hasMcBind: false,
          whitelist: [],
          lastModified: new Date()
        })
        this.logger.info(
          'MCIDBIND',
          `解绑MC: QQ=${normalizedQQId}, MC用户名=${oldUsername}, 保留B站绑定`,
          true
        )
      } else {
        // 如果没有B站绑定，删除整条记录
        const removedCount = await this.mcidbindRepo.delete(normalizedQQId)
        if (removedCount > 0) {
          this.logger.info(
            'MCIDBIND',
            `解绑MC并删除记录: QQ=${normalizedQQId}, MC用户名=${oldUsername}`,
            true
          )
        } else {
          this.logger.warn('MCIDBIND', `解绑MC异常: QQ=${normalizedQQId}, 可能未实际删除`)
          return false
        }
      }

      return true
    } catch (error) {
      this.logger.error('MCIDBIND', `解绑MC失败: 错误=${error.message}`)
      return false
    }
  }

  /**
   * 检查 MC 用户名是否已被其他 QQ 号绑定（支持不区分大小写和 UUID 检查）
   */
  async checkUsernameExists(
    username: string,
    currentUserId?: string,
    uuid?: string
  ): Promise<boolean> {
    try {
      // 验证输入参数
      if (!username) {
        this.logger.warn('绑定检查', '尝试检查空MC用户名')
        return false
      }

      // 使用不区分大小写的查询
      const bind = await this.mcidbindRepo.findByUsernameIgnoreCase(username)

      // 如果没有绑定，返回false
      if (!bind) return false

      // 如果绑定的用户名是临时用户名，视为未绑定
      if (!BindStatus.hasValidMcBind(bind)) {
        return false
      }

      // 如果提供了 UUID，检查是否为同一个 MC 账号（用户改名场景）
      if (uuid && bind.mcUuid) {
        const cleanUuid = uuid.replace(/-/g, '')
        const bindCleanUuid = bind.mcUuid.replace(/-/g, '')

        if (cleanUuid === bindCleanUuid) {
          // 同一个 UUID，说明是用户改名，允许绑定
          this.logger.info(
            '绑定检查',
            `检测到MC账号改名: UUID=${uuid}, 旧用户名=${bind.mcUsername}, 新用户名=${username}`,
            true
          )
          return false
        }
      }

      // 如果提供了当前用户ID，需要排除当前用户
      if (currentUserId) {
        const normalizedCurrentId = this.normalizeQQId(currentUserId)
        // 如果绑定的用户就是当前用户，返回false，表示没有被其他用户绑定
        return normalizedCurrentId ? bind.qqId !== normalizedCurrentId : true
      }

      return true
    } catch (error) {
      this.logger.error('绑定检查', `检查用户名"${username}"是否已被绑定失败: ${error.message}`)
      return false
    }
  }

  // =========== BUID 绑定相关 ===========

  /**
   * 根据 B 站 UID 查询绑定信息
   */
  async getBuidBindByBuid(buid: string): Promise<MCIDBIND | null> {
    try {
      if (!buid) {
        this.logger.warn('B站账号绑定', '尝试查询空B站UID')
        return null
      }

      const bind = await this.mcidbindRepo.findByBuidUid(buid)
      return bind
    } catch (error) {
      this.logger.error('B站账号绑定', `根据B站UID(${buid})查询绑定信息失败: ${error.message}`)
      return null
    }
  }

  /**
   * 检查 B 站 UID 是否已被绑定
   */
  async checkBuidExists(buid: string, currentUserId?: string): Promise<boolean> {
    try {
      const bind = await this.getBuidBindByBuid(buid)
      if (!bind) return false

      // 如果指定了当前用户ID，则排除当前用户的绑定
      if (currentUserId) {
        const normalizedCurrentId = this.normalizeQQId(currentUserId)
        return bind.qqId !== normalizedCurrentId
      }

      return true
    } catch (error) {
      this.logger.error('B站账号绑定', `检查B站UID(${buid})是否存在时出错: ${error.message}`)
      return false
    }
  }

  /**
   * 创建或更新 B 站账号绑定
   */
  async createOrUpdateBuidBind(userId: string, buidUser: ZminfoUser): Promise<boolean> {
    try {
      const normalizedQQId = this.normalizeQQId(userId)
      if (!normalizedQQId) {
        this.logger.error('B站账号绑定', '创建/更新绑定失败: 无法提取有效的QQ号')
        return false
      }

      // 检查该UID是否已被其他用户绑定（安全检查）
      const existingBuidBind = await this.getBuidBindByBuid(buidUser.uid)
      if (existingBuidBind && existingBuidBind.qqId !== normalizedQQId) {
        this.logger.error(
          'B站账号绑定',
          `安全检查失败: B站UID ${buidUser.uid} 已被QQ(${existingBuidBind.qqId})绑定，无法为QQ(${normalizedQQId})绑定`
        )
        return false
      }

      // 查询是否已存在绑定记录
      let bind = await this.getMcBindByQQId(normalizedQQId)
      const updateData: UpdateBuidBindData = {
        buidUid: buidUser.uid.toString(), // 转换为字符串存储
        buidUsername: buidUser.username,
        guardLevel: buidUser.guard_level || 0,
        guardLevelText: buidUser.guard_level_text || '',
        maxGuardLevel: buidUser.max_guard_level || 0,
        maxGuardLevelText: buidUser.max_guard_level_text || '',
        medalName: buidUser.medal?.name || '',
        medalLevel: buidUser.medal?.level || 0,
        wealthMedalLevel: buidUser.wealthMedalLevel || 0,
        lastActiveTime: buidUser.last_active_time
          ? new Date(buidUser.last_active_time)
          : new Date(),
        lastModified: new Date()
      }
      if (bind) {
        // 添加 hasBuidBind 标志
        updateData.hasBuidBind = true
        await this.mcidbindRepo.update(normalizedQQId, updateData)
        this.logger.info(
          'B站账号绑定',
          `更新绑定: QQ=${normalizedQQId}, B站UID=${buidUser.uid}, 用户名=${buidUser.username}`,
          true
        )
      } else {
        // 创建新绑定记录（不使用临时用户名）
        const newBind: CreateBindData = {
          qqId: normalizedQQId,
          mcUsername: null,
          mcUuid: null,
          isAdmin: false,
          whitelist: [],
          tags: [],
          hasMcBind: false,
          hasBuidBind: true,
          ...updateData
        }
        await this.mcidbindRepo.create(newBind)
        this.logger.info(
          'B站账号绑定',
          `创建绑定(跳过MC): QQ=${normalizedQQId}, B站UID=${buidUser.uid}, 用户名=${buidUser.username}`,
          true
        )
      }
      return true
    } catch (error) {
      this.logger.error('B站账号绑定', `创建/更新B站账号绑定失败: ${error.message}`)
      return false
    }
  }

  /**
   * 仅更新 B 站信息，不更新绑定时间（用于查询时刷新数据）
   */
  async updateBuidInfoOnly(userId: string, buidUser: ZminfoUser): Promise<boolean> {
    try {
      const normalizedQQId = this.normalizeQQId(userId)
      if (!normalizedQQId) {
        this.logger.error('B站账号信息更新', '更新失败: 无法提取有效的QQ号')
        return false
      }

      // 查询是否已存在绑定记录
      const bind = await this.getMcBindByQQId(normalizedQQId)
      if (!bind) {
        this.logger.warn('B站账号信息更新', `QQ(${normalizedQQId})没有绑定记录，无法更新B站信息`)
        return false
      }

      // 仅更新B站相关字段，不更新lastModified
      const updateData: UpdateBuidInfoData = {
        buidUsername: buidUser.username,
        guardLevel: buidUser.guard_level || 0,
        guardLevelText: buidUser.guard_level_text || '',
        maxGuardLevel: buidUser.max_guard_level || 0,
        maxGuardLevelText: buidUser.max_guard_level_text || '',
        medalName: buidUser.medal?.name || '',
        medalLevel: buidUser.medal?.level || 0,
        wealthMedalLevel: buidUser.wealthMedalLevel || 0,
        lastActiveTime: buidUser.last_active_time ? new Date(buidUser.last_active_time) : new Date()
      }

      await this.mcidbindRepo.update(normalizedQQId, updateData)
      this.logger.info(
        'B站账号信息更新',
        `刷新信息: QQ=${normalizedQQId}, B站UID=${bind.buidUid}, 用户名=${buidUser.username}`,
        true
      )
      return true
    } catch (error) {
      this.logger.error('B站账号信息更新', `更新B站账号信息失败: ${error.message}`)
      return false
    }
  }

  /**
   * 解绑 B 站账号（只清空 B 站字段，保留 MC 绑定）
   */
  async deleteBuidBind(userId: string): Promise<boolean> {
    try {
      // 验证输入参数
      if (!userId) {
        this.logger.error('B站账号解绑', '解绑失败: 无效的用户ID')
        return false
      }

      const normalizedQQId = this.normalizeQQId(userId)
      if (!normalizedQQId) {
        this.logger.error('B站账号解绑', '解绑失败: 无法提取有效的QQ号')
        return false
      }

      // 查询是否存在绑定记录
      const bind = await this.getMcBindByQQId(normalizedQQId)

      if (!bind) {
        this.logger.warn('B站账号解绑', `解绑失败: QQ=${normalizedQQId}不存在绑定记录`)
        return false
      }

      // 如果没有B站绑定，返回失败
      if (!BindStatus.hasValidBuidBind(bind)) {
        this.logger.warn('B站账号解绑', `解绑失败: QQ=${normalizedQQId}未绑定B站账号`)
        return false
      }

      const oldBuidUid = bind.buidUid
      const oldBuidUsername = bind.buidUsername

      // 检查是否有MC绑定
      if (BindStatus.hasValidMcBind(bind)) {
        // 如果有MC绑定，只清空B站字段，保留记录
        await this.mcidbindRepo.update(normalizedQQId, {
          buidUid: '',
          buidUsername: '',
          guardLevel: 0,
          guardLevelText: '',
          maxGuardLevel: 0,
          maxGuardLevelText: '',
          medalName: '',
          medalLevel: 0,
          wealthMedalLevel: 0,
          lastActiveTime: null,
          hasBuidBind: false,
          lastModified: new Date()
        })
        this.logger.info(
          'B站账号解绑',
          `解绑B站: QQ=${normalizedQQId}, B站UID=${oldBuidUid}, 用户名=${oldBuidUsername}, 保留MC绑定`,
          true
        )
      } else {
        // 如果没有MC绑定，删除整条记录
        const removedCount = await this.mcidbindRepo.delete(normalizedQQId)
        if (removedCount > 0) {
          this.logger.info(
            'B站账号解绑',
            `解绑B站并删除记录: QQ=${normalizedQQId}, B站UID=${oldBuidUid}, 用户名=${oldBuidUsername}`,
            true
          )
        } else {
          this.logger.warn('B站账号解绑', `解绑B站异常: QQ=${normalizedQQId}, 可能未实际删除`)
          return false
        }
      }

      return true
    } catch (error) {
      this.logger.error('B站账号解绑', `解绑B站失败: 错误=${error.message}`)
      return false
    }
  }

  // =========== 用户名更新检查 ===========

  /**
   * 检查并更新用户名（如果与当前数据库中的不同）
   */
  async checkAndUpdateUsername(bind: MCIDBIND): Promise<MCIDBIND> {
    try {
      if (!bind || !bind.mcUuid) {
        this.logger.warn('用户名更新', '无法检查用户名更新: 空绑定或空UUID')
        return bind
      }

      // 通过UUID查询最新用户名
      const latestUsername = await this.getUsernameByUuid(bind.mcUuid)

      if (!latestUsername) {
        this.logger.warn('用户名更新', `无法获取UUID "${bind.mcUuid}" 的最新用户名`)
        return bind
      }

      // 如果用户名与数据库中的不同，更新数据库（使用规范化比较，不区分大小写）
      const normalizedLatest = normalizeUsernameHelper(latestUsername)
      const normalizedCurrent = normalizeUsernameHelper(bind.mcUsername)

      if (normalizedLatest !== normalizedCurrent) {
        this.logger.info(
          '用户名更新',
          `用户 QQ(${bind.qqId}) 的Minecraft用户名已变更: ${bind.mcUsername} -> ${latestUsername}`,
          true
        )

        // 更新数据库中的用户名
        await this.mcidbindRepo.update(bind.qqId, {
          mcUsername: latestUsername
        })

        // 更新返回的绑定对象
        bind.mcUsername = latestUsername
      }

      return bind
    } catch (error) {
      this.logger.error('用户名更新', `检查和更新用户名失败: ${error.message}`)
      return bind
    }
  }

  /**
   * 智能缓存版本的改名检测函数
   * 特性：
   * - 24小时冷却期（失败>=3次时延长到72小时）
   * - 失败计数追踪
   * - 成功时重置失败计数
   */
  async checkAndUpdateUsernameWithCache(bind: MCIDBIND): Promise<MCIDBIND> {
    try {
      if (!bind || !bind.mcUuid) {
        this.logger.warn('改名检测缓存', '无法检查用户名更新: 空绑定或空UUID')
        return bind
      }

      const now = new Date()
      const failCount = bind.usernameCheckFailCount || 0

      // 根据失败次数决定冷却期：普通24小时，失败>=3次则72小时
      const cooldownHours = failCount >= 3 ? 72 : 24

      // 检查是否在冷却期内
      if (bind.usernameLastChecked) {
        const lastCheck = new Date(bind.usernameLastChecked)
        const hoursSinceCheck = (now.getTime() - lastCheck.getTime()) / (1000 * 60 * 60)

        if (hoursSinceCheck < cooldownHours) {
          this.logger.debug(
            '改名检测缓存',
            `QQ(${bind.qqId}) 在冷却期内(${hoursSinceCheck.toFixed(1)}h/${cooldownHours}h)，跳过检查`
          )
          return bind
        }
      }

      this.logger.debug(
        '改名检测缓存',
        `QQ(${bind.qqId}) 开始检查用户名变更（失败计数: ${failCount}）`
      )

      // 执行实际的改名检测
      const oldUsername = bind.mcUsername
      const updatedBind = await this.checkAndUpdateUsername(bind)

      // 判断检测是否成功
      const detectionSuccess =
        updatedBind.mcUsername !== null && updatedBind.mcUsername !== undefined

      if (detectionSuccess) {
        // 检测成功
        const usernameChanged =
          normalizeUsernameHelper(updatedBind.mcUsername) !== normalizeUsernameHelper(oldUsername)

        // 更新检查时间和重置失败计数
        await this.mcidbindRepo.update(bind.qqId, {
          usernameLastChecked: now,
          usernameCheckFailCount: 0
        })

        if (usernameChanged) {
          this.logger.info(
            '改名检测缓存',
            `QQ(${bind.qqId}) 用户名已变更: ${oldUsername} -> ${updatedBind.mcUsername}`,
            true
          )
        } else {
          this.logger.debug(
            '改名检测缓存',
            `QQ(${bind.qqId}) 用户名无变更: ${updatedBind.mcUsername}`
          )
        }

        // 更新返回对象的缓存字段
        updatedBind.usernameLastChecked = now
        updatedBind.usernameCheckFailCount = 0
      } else {
        // 检测失败（API失败或返回null）
        const newFailCount = failCount + 1

        await this.mcidbindRepo.update(bind.qqId, {
          usernameLastChecked: now,
          usernameCheckFailCount: newFailCount
        })

        this.logger.warn('改名检测缓存', `QQ(${bind.qqId}) 检测失败，失败计数: ${newFailCount}`)

        // 更新返回对象的缓存字段
        updatedBind.usernameLastChecked = now
        updatedBind.usernameCheckFailCount = newFailCount
      }

      return updatedBind
    } catch (error) {
      this.logger.error('改名检测缓存', `检查和更新用户名失败: ${error.message}`)

      // 失败时也更新检查时间和递增失败计数
      try {
        const failCount = bind.usernameCheckFailCount || 0
        await this.mcidbindRepo.update(bind.qqId, {
          usernameLastChecked: new Date(),
          usernameCheckFailCount: failCount + 1
        })
      } catch (updateError) {
        this.logger.error('改名检测缓存', `更新失败计数时出错: ${updateError.message}`)
      }

      return bind
    }
  }
}
