import { Session } from 'koishi'
import { LoggerService } from '../utils/logger'
import { extractBuidUsernameFromNickname } from '../utils/helpers'
import type { ZminfoUser } from '../types'

/**
 * B站用户名查询结果
 */
interface BuidUsernameResult {
  username: string
  source: 'official' | 'zminfo' | 'database'
  zminfoData?: ZminfoUser
}

/**
 * 群昵称管理服务
 * 负责自动设置和验证群昵称
 */
export class NicknameService {
  constructor(
    private logger: LoggerService,
    private config: { autoNicknameGroupId: string },
    private normalizeQQId: (userId: string) => string,
    private validateBUID: (buid: string) => Promise<ZminfoUser | null>,
    private getBilibiliOfficialUserInfo: (
      uid: string
    ) => Promise<{ name: string; mid: number } | null>,
    private updateBuidInfoOnly: (userId: string, buidUser: ZminfoUser) => Promise<boolean>
  ) {}

  /**
   * 检查群昵称格式是否正确
   */
  checkNicknameFormat(nickname: string, buidUsername: string, mcUsername: string | null): boolean {
    if (!nickname || !buidUsername) return false

    // 期望格式：B站名称（ID:MC用户名）或 B站名称（ID:未绑定）
    const mcInfo = mcUsername && !mcUsername.startsWith('_temp_') ? mcUsername : '未绑定'
    const expectedFormat = `${buidUsername}（ID:${mcInfo}）`

    return nickname === expectedFormat
  }

  /**
   * 使用四层判断逻辑获取最准确的B站用户名
   * 优先级：官方API > ZMINFO > 数据库
   */
  private async getLatestBuidUsername(
    buidUid: string,
    currentDbUsername: string
  ): Promise<BuidUsernameResult> {
    // 1. 尝试获取B站官方API的用户信息（最权威）
    let officialUsername: string | null = null
    try {
      this.logger.debug('群昵称设置', '正在查询B站官方API...')
      const officialInfo = await this.getBilibiliOfficialUserInfo(buidUid)
      if (officialInfo && officialInfo.name) {
        officialUsername = officialInfo.name
        this.logger.info('群昵称设置', `[层1-官方API] ✅ "${officialUsername}"`, true)
      } else {
        this.logger.warn('群昵称设置', '[层1-官方API] ❌ 查询失败')
      }
    } catch (officialError) {
      this.logger.warn('群昵称设置', `[层1-官方API] ❌ 查询出错: ${officialError.message}`)
    }

    // 2. 尝试获取ZMINFO API的用户信息（可能有缓存）
    let zminfoUserData: ZminfoUser | null = null
    try {
      this.logger.debug('群昵称设置', '正在查询ZMINFO API...')
      zminfoUserData = await this.validateBUID(buidUid)
      if (zminfoUserData && zminfoUserData.username) {
        this.logger.debug('群昵称设置', `[层2-ZMINFO] "${zminfoUserData.username}"`)
      } else {
        this.logger.warn('群昵称设置', '[层2-ZMINFO] 查询失败')
      }
    } catch (zminfoError) {
      this.logger.warn('群昵称设置', `[层2-ZMINFO] 查询出错: ${zminfoError.message}`)
    }

    // 3. 根据优先级返回结果
    if (officialUsername) {
      this.logger.info('群昵称设置', `🎯 采用官方API结果: "${officialUsername}"`, true)
      return {
        username: officialUsername,
        source: 'official',
        zminfoData: zminfoUserData || undefined
      }
    } else if (zminfoUserData && zminfoUserData.username) {
      this.logger.info(
        '群昵称设置',
        `⚠️ 官方API不可用，降级使用ZMINFO: "${zminfoUserData.username}"`,
        true
      )
      return {
        username: zminfoUserData.username,
        source: 'zminfo',
        zminfoData: zminfoUserData
      }
    } else {
      this.logger.warn(
        '群昵称设置',
        `⚠️ 官方API和ZMINFO都不可用，使用数据库名称: "${currentDbUsername}"`
      )
      return {
        username: currentDbUsername,
        source: 'database'
      }
    }
  }

  /**
   * 同步数据库中的B站用户信息
   */
  private async syncDatabaseIfNeeded(
    normalizedUserId: string,
    latestUsername: string,
    currentDbUsername: string,
    zminfoData?: ZminfoUser
  ): Promise<void> {
    if (latestUsername === currentDbUsername) {
      return // 无需更新
    }

    if (!zminfoData) {
      this.logger.debug('群昵称设置', '无ZMINFO数据，跳过数据库同步')
      return
    }

    try {
      const updatedData = { ...zminfoData, username: latestUsername }
      await this.updateBuidInfoOnly(normalizedUserId, updatedData)
      this.logger.info(
        '群昵称设置',
        `已同步数据库: "${currentDbUsername}" → "${latestUsername}"`,
        true
      )
    } catch (updateError) {
      this.logger.warn('群昵称设置', `数据库同步失败: ${updateError.message}`)
    }
  }

  /**
   * 设置群昵称并验证
   */
  private async setAndVerifyNickname(
    session: Session,
    targetGroupId: string,
    normalizedUserId: string,
    nickname: string,
    currentNickname?: string
  ): Promise<void> {
    try {
      await session.bot.internal.setGroupCard(targetGroupId, normalizedUserId, nickname)

      if (currentNickname) {
        this.logger.info(
          '群昵称设置',
          `成功在群${targetGroupId}中将QQ(${normalizedUserId})群昵称从"${currentNickname}"修改为"${nickname}"`,
          true
        )
      } else {
        this.logger.info(
          '群昵称设置',
          `成功在群${targetGroupId}中将QQ(${normalizedUserId})群昵称设置为: ${nickname}`,
          true
        )
      }

      // 验证设置是否生效
      try {
        await new Promise(resolve => setTimeout(resolve, 1000)) // 等待1秒
        const verifyGroupInfo = await session.bot.internal.getGroupMemberInfo(
          targetGroupId,
          normalizedUserId
        )
        const verifyNickname = verifyGroupInfo.card || verifyGroupInfo.nickname || ''

        if (verifyNickname === nickname) {
          this.logger.info('群昵称设置', `✅ 验证成功，群昵称已生效: "${verifyNickname}"`, true)
        } else {
          this.logger.warn(
            '群昵称设置',
            `⚠️ 验证失败，期望"${nickname}"，实际"${verifyNickname}"，可能是权限不足或API延迟`
          )
          if (!currentNickname) {
            this.logger.warn(
              '群昵称设置',
              '建议检查: 1.机器人是否为群管理员 2.群设置是否允许管理员修改昵称 3.OneBot实现是否支持该功能'
            )
          }
        }
      } catch (verifyError) {
        this.logger.warn('群昵称设置', `无法验证群昵称设置结果: ${verifyError.message}`)
      }
    } catch (setCardError) {
      this.logger.error('群昵称设置', `设置群昵称失败: ${setCardError.message}`)
      this.logger.error('群昵称设置', `错误详情: ${JSON.stringify(setCardError)}`)
      throw setCardError
    }
  }

  /**
   * 自动群昵称设置功能（重构版）
   */
  async autoSetGroupNickname(
    session: Session,
    mcUsername: string | null,
    buidUsername: string,
    buidUid?: string,
    targetUserId?: string,
    specifiedGroupId?: string
  ): Promise<void> {
    try {
      // 准备基本参数
      const actualUserId = targetUserId || session.userId
      const normalizedUserId = this.normalizeQQId(actualUserId)
      const targetGroupId = specifiedGroupId || this.config.autoNicknameGroupId
      const mcInfo = mcUsername && !mcUsername.startsWith('_temp_') ? mcUsername : '未绑定'

      this.logger.debug(
        '群昵称设置',
        `开始处理QQ(${normalizedUserId})的群昵称设置，目标群: ${targetGroupId}`
      )

      // 检查前置条件
      if (!session.bot.internal) {
        this.logger.debug(
          '群昵称设置',
          `QQ(${normalizedUserId})bot不支持OneBot内部API，跳过自动群昵称设置`
        )
        return
      }
      if (!targetGroupId) {
        this.logger.debug(
          '群昵称设置',
          `QQ(${normalizedUserId})未配置自动群昵称设置目标群，跳过群昵称设置`
        )
        return
      }

      // 获取最新的B站用户名
      let latestBuidUsername = buidUsername
      if (buidUid) {
        this.logger.debug('群昵称设置', '开始四层判断获取最新B站用户名...')
        this.logger.debug('群昵称设置', `[层3-数据库] "${buidUsername}"`)

        const result = await this.getLatestBuidUsername(buidUid, buidUsername)
        latestBuidUsername = result.username

        // 尝试同步数据库
        await this.syncDatabaseIfNeeded(
          normalizedUserId,
          latestBuidUsername,
          buidUsername,
          result.zminfoData
        )
      }

      // 生成目标昵称
      const targetNickname = `${latestBuidUsername}（ID:${mcInfo}）`
      this.logger.debug('群昵称设置', `目标昵称: "${targetNickname}"`)

      // 尝试获取当前昵称并比对
      try {
        this.logger.debug(
          '群昵称设置',
          `正在获取QQ(${normalizedUserId})在群${targetGroupId}的当前昵称...`
        )
        const currentGroupInfo = await session.bot.internal.getGroupMemberInfo(
          targetGroupId,
          normalizedUserId
        )
        const currentNickname = currentGroupInfo.card || currentGroupInfo.nickname || ''
        this.logger.debug('群昵称设置', `当前昵称: "${currentNickname}"`)

        // 【调试信息】提取当前昵称中的BUID用户名（仅用于日志）
        if (buidUid && currentNickname) {
          const currentNicknameUsername = extractBuidUsernameFromNickname(currentNickname)
          this.logger.debug(
            '群昵称设置',
            `[层4-群昵称] "${currentNicknameUsername || '(无法提取)'}"`
          )
        }

        // 如果昵称完全一致，跳过修改
        if (currentNickname === targetNickname) {
          this.logger.info(
            '群昵称设置',
            `QQ(${normalizedUserId})群昵称已经是"${targetNickname}"，跳过修改`,
            true
          )
          return
        }

        // 昵称需要更新
        this.logger.debug('群昵称设置', `昵称不一致，正在修改群昵称为: "${targetNickname}"`)
        await this.setAndVerifyNickname(
          session,
          targetGroupId,
          normalizedUserId,
          targetNickname,
          currentNickname
        )
      } catch (getInfoError) {
        // 无法获取当前昵称，直接设置新昵称
        this.logger.warn(
          '群昵称设置',
          `获取QQ(${normalizedUserId})当前群昵称失败: ${getInfoError.message}`
        )
        this.logger.debug('群昵称设置', '将直接尝试设置新昵称...')

        await this.setAndVerifyNickname(session, targetGroupId, normalizedUserId, targetNickname)
      }
    } catch (error) {
      const actualUserId = targetUserId || session.userId
      const normalizedUserId = this.normalizeQQId(actualUserId)
      this.logger.error('群昵称设置', `QQ(${normalizedUserId})自动群昵称设置失败: ${error.message}`)
      this.logger.error('群昵称设置', `完整错误信息: ${JSON.stringify(error)}`)
    }
  }
}
