import { h } from 'koishi'
import { BaseHandler } from './base.handler'
import axios from 'axios'
import type { ZminfoUser } from '../types'
import { BindStatus } from '../utils/bind-status'

/**
 * BUID 命令处理器
 * 处理 B站账号相关命令
 */
export class BuidHandler extends BaseHandler {
  /**
   * 注册 BUID 相关命令
   */
  register(): void {
    const buidCmd = this.ctx.command('buid', 'B站UID绑定管理')

    // 查询BUID绑定
    buidCmd
      .subcommand('.query [target:string]', '查询用户绑定的BUID')
      .action(async ({ session }, target) => {
        return this.handleQuery(session, target)
      })

    // 绑定BUID（支持强制模式）
    buidCmd
      .subcommand('.bind <uid:string> [target:string]', '绑定B站UID')
      .option('force', '-f', { fallback: false })
      .action(async ({ session, options }, uid, target) => {
        return this.handleBind(session, uid, target, !!options.force)
      })

    // 通过BUID查找用户
    buidCmd
      .subcommand('.finduser <uid:string>', '[管理员]通过BUID查询绑定的QQ账号')
      .action(async ({ session }, uid) => {
        return this.handleFindUser(session, uid)
      })

    // mcid 命令组中的 BUID 相关子命令
    const mcidCmd = this.ctx.command('mcid')

    // 绑定B站账号（mcid.bindbuid）
    mcidCmd
      .subcommand('.bindbuid <buid:string>', '绑定B站账号')
      .action(async ({ session }, buid) => {
        return this.handleBindBuid(session, buid)
      })

    // 解绑B站账号（mcid.unbindbuid）
    mcidCmd.subcommand('.unbindbuid', '解绑B站账号').action(async ({ session }) => {
      return this.handleUnbindBuid(session)
    })
  }

  /**
   * 处理 BUID 查询命令
   */
  private async handleQuery(session: any, target?: string): Promise<void> {
    try {
      const normalizedUserId = this.deps.normalizeQQId(session.userId)
      let bind: any | null

      if (target) {
        const normalizedTargetId = this.deps.normalizeQQId(target)
        bind = await this.repos.mcidbind.findByQQId(normalizedTargetId)
      } else {
        bind = await this.repos.mcidbind.findByQQId(normalizedUserId)
      }

      if (!bind || !bind.buidUid) {
        return this.deps.sendMessage(session, [
          h.text(
            target
              ? '该用户尚未绑定B站账号'
              : `您尚未绑定B站账号，请使用 ${this.deps.formatCommand('buid bind <UID>')} 进行绑定`
          )
        ])
      }

      // 每次查询都刷新B站数据
      const buidUser = await this.validateBUID(bind.buidUid)
      if (buidUser) {
        await this.updateBuidInfoOnly(bind.qqId, buidUser)
        bind = await this.repos.mcidbind.findByQQId(bind.qqId)
      }

      const userInfo = `${target ? `用户 ${bind.qqId} 的` : '您的'}B站账号信息：\nB站UID: ${bind.buidUid}\n用户名: ${bind.buidUsername}`
      let detailInfo = ''

      if (bind.guardLevel > 0) {
        detailInfo += `\n舰长等级: ${bind.guardLevelText} (${bind.guardLevel})`
        if (bind.maxGuardLevel > 0 && bind.maxGuardLevel < bind.guardLevel) {
          detailInfo += `\n历史最高: ${bind.maxGuardLevelText} (${bind.maxGuardLevel})`
        }
      } else if (bind.maxGuardLevel > 0) {
        detailInfo += `\n历史舰长: ${bind.maxGuardLevelText} (${bind.maxGuardLevel})`
      }

      detailInfo += `\n粉丝牌: ${bind.medalName || '无'} Lv.${bind.medalLevel || 0}`
      detailInfo += `\n荣耀等级: ${bind.wealthMedalLevel || 0}`
      detailInfo += `\n最后活跃: ${bind.lastActiveTime ? new Date(bind.lastActiveTime).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '未知'}`

      const messageContent = [h.text(userInfo + detailInfo)]
      if (this.config?.showAvatar && bind.buidUid) {
        messageContent.push(
          h.image(`https://workers.vrp.moe/bilibili/avatar/${bind.buidUid}?size=160`)
        )
      }

      return this.deps.sendMessage(session, messageContent)
    } catch (error) {
      return this.deps.sendMessage(session, [h.text(`查询失败: ${error.message}`)])
    }
  }

  /**
   * 处理 BUID 绑定命令
   */
  private async handleBind(
    session: any,
    uid: string,
    target?: string,
    isForceMode: boolean = false
  ): Promise<void> {
    try {
      const normalizedUserId = this.deps.normalizeQQId(session.userId)

      // 解析UID格式
      const actualUid = this.parseUidInput(uid, normalizedUserId)

      // 检查UID格式
      if (!actualUid || !/^\d+$/.test(actualUid)) {
        this.logger.warn('BUID绑定', `QQ(${normalizedUserId})提供的UID"${uid}"格式无效`)
        return this.deps.sendMessage(session, [
          h.text(
            '请提供有效的B站UID（支持以下格式）：\n• 纯数字：123456789\n• UID格式：UID:123456789\n• 空间链接：https://space.bilibili.com/123456789'
          )
        ])
      }

      // 强制绑定模式
      if (isForceMode) {
        return this.handleForceBindMode(session, actualUid, target, normalizedUserId)
      }

      // 管理员为他人绑定
      if (target) {
        return this.handleAdminBindForOthers(session, actualUid, target, normalizedUserId)
      }

      // 为自己绑定
      return this.handleSelfBind(session, actualUid, normalizedUserId)
    } catch (error) {
      this.logger.error('绑定', session.userId, error)
      return this.deps.sendMessage(session, [
        h.text(`绑定失败：${this.getFriendlyErrorMessage(error)}`)
      ])
    }
  }

  /**
   * 处理查找用户命令（通过BUID反查QQ）
   */
  private async handleFindUser(session: any, uid: string): Promise<void> {
    try {
      const normalizedUserId = this.deps.normalizeQQId(session.userId)

      // 检查管理员权限
      const isAdmin = await this.checkIsAdmin(session.userId)
      if (!isAdmin) {
        this.logger.warn('B站账号反向查询', `权限不足: QQ(${normalizedUserId})不是管理员`)
        return this.deps.sendMessage(session, [h.text('只有管理员才能使用此命令')])
      }

      // 解析UID
      const actualUid = this.parseUidInput(uid, normalizedUserId)

      if (!actualUid || !/^\d+$/.test(actualUid)) {
        this.logger.warn('B站账号反向查询', `QQ(${normalizedUserId})提供的UID"${uid}"格式无效`)
        return this.deps.sendMessage(session, [
          h.text(
            '请提供有效的B站UID（支持以下格式）：\n• 纯数字：123456789\n• UID格式：UID:123456789\n• 空间链接：https://space.bilibili.com/123456789'
          )
        ])
      }

      this.logger.info(
        'B站账号反向查询',
        `QQ(${normalizedUserId})尝试通过B站UID"${actualUid}"查询绑定的QQ账号`
      )

      const bind = await this.repos.mcidbind.findByBuidUid(actualUid)

      if (!bind || !bind.qqId) {
        this.logger.info('B站账号反向查询', `B站UID"${actualUid}"未被任何QQ账号绑定`)
        return this.deps.sendMessage(session, [h.text(`未找到绑定B站UID"${actualUid}"的QQ账号`)])
      }

      // 构建详细信息
      let adminInfo = `B站UID"${bind.buidUid}"绑定信息:\nQQ号: ${bind.qqId}\n用户名: ${bind.buidUsername}`

      if (bind.guardLevel > 0) {
        adminInfo += `\n舰长等级: ${bind.guardLevelText} (${bind.guardLevel})`
        if (bind.maxGuardLevel > 0 && bind.maxGuardLevel < bind.guardLevel) {
          adminInfo += `\n历史最高: ${bind.maxGuardLevelText} (${bind.maxGuardLevel})`
        }
      } else if (bind.maxGuardLevel > 0) {
        adminInfo += `\n历史舰长: ${bind.maxGuardLevelText} (${bind.maxGuardLevel})`
      }

      if (bind.medalName) {
        adminInfo += `\n粉丝牌: ${bind.medalName} Lv.${bind.medalLevel}`
      }
      if (bind.wealthMedalLevel > 0) {
        adminInfo += `\n荣耀等级: ${bind.wealthMedalLevel}`
      }
      if (bind.lastActiveTime) {
        adminInfo += `\n最后活跃: ${new Date(bind.lastActiveTime).toLocaleString()}`
      }
      adminInfo += `\n绑定时间: ${bind.lastModified ? new Date(bind.lastModified).toLocaleString() : '未知'}`
      adminInfo += `\n管理员权限: ${bind.isAdmin ? '是' : '否'}`

      this.logger.info('B站账号反向查询', `成功: B站UID"${actualUid}"被QQ(${bind.qqId})绑定`)
      return this.deps.sendMessage(session, [h.text(adminInfo)])
    } catch (error) {
      const normalizedUserId = this.deps.normalizeQQId(session.userId)
      this.logger.error('B站账号反向查询', normalizedUserId, `通过B站UID查询失败: ${error.message}`)
      return this.deps.sendMessage(session, [h.text(this.getFriendlyErrorMessage(error))])
    }
  }

  /**
   * 处理 mcid.bindbuid 命令
   */
  private async handleBindBuid(session: any, buid: string): Promise<void> {
    try {
      const normalizedUserId = this.deps.normalizeQQId(session.userId)
      this.logger.info('绑定', `QQ(${normalizedUserId})尝试绑定B站UID(${buid})`)

      // 验证格式
      if (!buid || !/^\d+$/.test(buid)) {
        this.logger.warn('绑定', `QQ(${normalizedUserId})尝试绑定无效的B站UID格式: ${buid}`)
        return this.deps.sendMessage(session, [h.text('无效的B站UID格式，请输入正确的B站UID')])
      }

      // 检查是否已被他人绑定
      const existingBind = await this.repos.mcidbind.findByBuidUid(buid)
      if (existingBind) {
        const existingQQId = existingBind.qqId
        this.logger.warn(
          '绑定',
          `QQ(${normalizedUserId})尝试绑定已被QQ(${existingQQId})绑定的B站UID(${buid})`
        )
        return this.deps.sendMessage(session, [h.text('该B站UID已被其他用户绑定')])
      }

      // 验证B站UID
      const buidUser = await this.validateBUID(buid)
      if (!buidUser) {
        this.logger.warn('绑定', `QQ(${normalizedUserId})尝试绑定不存在的B站UID(${buid})`)
        return this.deps.sendMessage(session, [h.text('无法验证B站UID，请确认输入正确')])
      }

      // 创建或更新绑定
      const success = await this.createOrUpdateBuidBind(normalizedUserId, buidUser)
      if (success) {
        this.logger.info('绑定', `QQ(${normalizedUserId})成功绑定B站UID(${buid})`)
        return this.deps.sendMessage(
          session,
          [
            h.text('成功绑定B站账号！\n'),
            h.text(`B站UID: ${buidUser.uid}\n`),
            h.text(`用户名: ${buidUser.username}\n`),
            buidUser.guard_level > 0
              ? h.text(`舰长等级: ${buidUser.guard_level_text} (${buidUser.guard_level})\n`)
              : null,
            buidUser.medal
              ? h.text(`粉丝牌: ${buidUser.medal.name} Lv.${buidUser.medal.level}\n`)
              : null,
            buidUser.wealthMedalLevel > 0
              ? h.text(`荣耀等级: ${buidUser.wealthMedalLevel}\n`)
              : null,
            ...(this.config?.showAvatar
              ? [h.image(`https://workers.vrp.moe/bilibili/avatar/${buidUser.uid}?size=160`)]
              : [])
          ].filter(Boolean)
        )
      } else {
        this.logger.error(
          '绑定',
          normalizedUserId,
          `QQ(${normalizedUserId})绑定B站UID(${buid})失败`
        )
        return this.deps.sendMessage(session, [h.text('绑定失败，请稍后重试')])
      }
    } catch (error) {
      this.logger.error('绑定', session.userId, error)
      return this.deps.sendMessage(session, [
        h.text(`绑定失败：${this.getFriendlyErrorMessage(error)}`)
      ])
    }
  }

  /**
   * 处理 mcid.unbindbuid 命令
   */
  private async handleUnbindBuid(session: any): Promise<void> {
    try {
      const normalizedUserId = this.deps.normalizeQQId(session.userId)
      this.logger.info('解绑', `QQ(${normalizedUserId})尝试解绑B站账号`)

      // 使用 DatabaseService 的解绑方法
      const success = await this.deps.databaseService.deleteBuidBind(normalizedUserId)

      if (success) {
        this.logger.info('解绑', `QQ(${normalizedUserId})成功解绑B站账号`)
        return this.deps.sendMessage(session, [h.text('已成功解绑B站账号')])
      } else {
        this.logger.warn('解绑', `QQ(${normalizedUserId})解绑B站账号失败`)
        return this.deps.sendMessage(session, [h.text('您尚未绑定B站账号')])
      }
    } catch (error) {
      this.logger.error('解绑', session.userId, error)
      return this.deps.sendMessage(session, [
        h.text(`解绑失败：${this.getFriendlyErrorMessage(error)}`)
      ])
    }
  }

  // ========== 私有辅助方法 ==========

  /**
   * 解析UID输入（支持多种格式）
   */
  private parseUidInput(uid: string, operatorQQId: string): string {
    let actualUid = uid

    if (uid && uid.toLowerCase().startsWith('uid:')) {
      actualUid = uid.substring(4)
    } else if (uid && uid.includes('space.bilibili.com/')) {
      try {
        let urlPart = uid.replace(/^https?:\/\/space\.bilibili\.com\//, '')
        if (urlPart.includes('?')) {
          urlPart = urlPart.split('?')[0]
        }
        if (urlPart.includes('/')) {
          urlPart = urlPart.split('/')[0]
        }
        actualUid = urlPart
        this.logger.debug('BUID解析', `QQ(${operatorQQId})从URL提取UID: ${uid} -> ${actualUid}`)
      } catch (error) {
        this.logger.warn('BUID解析', `QQ(${operatorQQId})URL解析失败: ${error.message}`)
        actualUid = ''
      }
    }

    return actualUid
  }

  /**
   * 验证B站UID
   */
  private async validateBUID(buid: string): Promise<ZminfoUser | null> {
    try {
      if (!buid || !/^\d+$/.test(buid)) {
        this.logger.warn('B站账号验证', `无效的B站UID格式: ${buid}`)
        return null
      }

      this.logger.debug('B站账号验证', `验证B站UID: ${buid}`)

      const response = await axios.get(`${this.config.zminfoApiUrl}/api/user/${buid}`, {
        timeout: 10000,
        headers: {
          'User-Agent': 'Koishi-MCID-Bot/1.0'
        }
      })

      if (response.data.success && response.data.data && response.data.data.user) {
        const user = response.data.data.user
        this.logger.debug('B站账号验证', `B站UID ${buid} 验证成功: ${user.username}`)
        return user
      } else {
        this.logger.warn(
          'B站账号验证',
          `B站UID ${buid} 不存在或API返回失败: ${response.data.message}`
        )
        return null
      }
    } catch (error) {
      if (error.response?.status === 404) {
        this.logger.warn('B站账号验证', `B站UID ${buid} 不存在`)
        return null
      }

      this.logger.error('B站账号验证', 'system', `验证B站UID ${buid} 时出错: ${error.message}`)
      throw new Error(`无法验证B站UID: ${error.message}`)
    }
  }

  /**
   * 检查B站UID是否已被其他用户绑定
   */
  private async checkBuidExists(buid: string, currentUserId?: string): Promise<boolean> {
    try {
      const bind = await this.repos.mcidbind.findByBuidUid(buid)
      if (!bind) return false

      if (currentUserId) {
        const normalizedCurrentId = this.deps.normalizeQQId(currentUserId)
        return bind.qqId !== normalizedCurrentId
      }

      return true
    } catch (error) {
      this.logger.error(
        'B站账号绑定',
        'system',
        `检查B站UID(${buid})是否存在时出错: ${error.message}`
      )
      return false
    }
  }

  /**
   * 创建或更新B站账号绑定
   */
  private async createOrUpdateBuidBind(userId: string, buidUser: ZminfoUser): Promise<boolean> {
    try {
      const normalizedQQId = this.deps.normalizeQQId(userId)
      if (!normalizedQQId) {
        this.logger.error('B站账号绑定', 'system', '创建/更新绑定失败: 无法提取有效的QQ号')
        return false
      }

      // 安全检查
      const existingBuidBind = await this.repos.mcidbind.findByBuidUid(buidUser.uid)
      if (existingBuidBind && existingBuidBind.qqId !== normalizedQQId) {
        this.logger.error(
          'B站账号绑定',
          'system',
          `安全检查失败: B站UID ${buidUser.uid} 已被QQ(${existingBuidBind.qqId})绑定`
        )
        return false
      }

      const bind = await this.repos.mcidbind.findByQQId(normalizedQQId)
      const updateData: any = {
        buidUid: buidUser.uid,
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
        await this.repos.mcidbind.update(normalizedQQId, updateData)
        this.logger.info(
          'B站账号绑定',
          `更新绑定: QQ=${normalizedQQId}, B站UID=${buidUser.uid}, 用户名=${buidUser.username}`
        )
      } else {
        const newBind: any = {
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
        await this.repos.mcidbind.create(newBind)
        this.logger.info(
          'B站账号绑定',
          `创建绑定(跳过MC): QQ=${normalizedQQId}, B站UID=${buidUser.uid}, 用户名=${buidUser.username}`
        )
      }

      return true
    } catch (error) {
      this.logger.error('B站账号绑定', userId, `创建/更新B站账号绑定失败: ${error.message}`)
      return false
    }
  }

  /**
   * 仅更新B站信息，不更新绑定时间
   */
  private async updateBuidInfoOnly(userId: string, buidUser: ZminfoUser): Promise<boolean> {
    try {
      const normalizedQQId = this.deps.normalizeQQId(userId)
      if (!normalizedQQId) {
        this.logger.error('B站账号信息更新', 'system', '更新失败: 无法提取有效的QQ号')
        return false
      }

      const bind = await this.repos.mcidbind.findByQQId(normalizedQQId)
      if (!bind) {
        this.logger.warn('B站账号信息更新', `QQ(${normalizedQQId})没有绑定记录，无法更新B站信息`)
        return false
      }

      const updateData: any = {
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

      await this.repos.mcidbind.update(normalizedQQId, updateData)
      this.logger.info(
        'B站账号信息更新',
        `刷新信息: QQ=${normalizedQQId}, B站UID=${bind.buidUid}, 用户名=${buidUser.username}`
      )
      return true
    } catch (error) {
      this.logger.error('B站账号信息更新', userId, `更新B站账号信息失败: ${error.message}`)
      return false
    }
  }

  /**
   * 检查是否为管理员
   */
  private async checkIsAdmin(userId: string): Promise<boolean> {
    try {
      const normalizedUserId = this.deps.normalizeQQId(userId)

      // 检查是否是masterId
      if (this.config.masterId && normalizedUserId === this.config.masterId) {
        return true
      }

      // 检查数据库中的管理员标记
      const bind = await this.repos.mcidbind.findByQQId(normalizedUserId)
      return bind?.isAdmin === true
    } catch (error) {
      this.logger.error('权限检查', userId, `检查管理员权限失败: ${error.message}`)
      return false
    }
  }

  /**
   * 强制绑定模式处理
   */
  private async handleForceBindMode(
    session: any,
    actualUid: string,
    target: string | undefined,
    operatorQQId: string
  ): Promise<void> {
    this.logger.info('强制BUID绑定', `QQ(${operatorQQId})使用强制模式绑定UID: ${actualUid}`, true)

    // 检查配置
    if (!this.config.forceBindSessdata) {
      this.logger.warn('强制BUID绑定', `QQ(${operatorQQId})尝试强制绑定但未配置Cookie`)
      return this.deps.sendMessage(session, [
        h.text('❌ 强制绑定功能未配置，请联系管理员设置B站Cookie信息')
      ])
    }

    try {
      await this.deps.sendMessage(session, [
        h.text('🔄 正在使用强制模式获取用户信息和粉丝牌数据，请稍候...')
      ])

      // 执行强制绑定
      const enhancedUser = await this.deps.forceBinder.forceBindUser(actualUid)
      const standardUser = this.deps.forceBinder.convertToZminfoUser(enhancedUser)

      // 处理管理员为他人强制绑定
      if (target) {
        const normalizedTargetId = this.deps.normalizeQQId(target)

        if (!normalizedTargetId) {
          this.logger.warn('强制BUID绑定', `QQ(${operatorQQId})提供的目标用户ID"${target}"无效`)
          return this.deps.sendMessage(session, [h.text('❌ 目标用户ID无效')])
        }

        // 检查权限
        const isAdmin = await this.checkIsAdmin(session.userId)
        if (!isAdmin) {
          this.logger.warn('强制BUID绑定', `权限不足: QQ(${operatorQQId})不是管理员`)
          return this.deps.sendMessage(session, [h.text('只有管理员才能为其他用户强制绑定')])
        }

        // 检查UID是否已被占用
        if (await this.checkBuidExists(actualUid, target)) {
          this.logger.warn('强制BUID绑定', `BUID"${actualUid}"已被其他QQ号绑定`)
          return this.deps.sendMessage(session, [
            h.text(`❌ UID ${actualUid} 已被其他用户绑定，即使使用强制模式也无法绑定已被占用的UID`)
          ])
        }

        const bindResult = await this.createOrUpdateBuidBind(normalizedTargetId, standardUser)

        if (bindResult) {
          // 尝试设置群昵称
          try {
            const latestTargetBind = await this.repos.mcidbind.findByQQId(normalizedTargetId)
            if (latestTargetBind) {
              const mcName = BindStatus.hasValidMcBind(latestTargetBind)
                ? latestTargetBind.mcUsername
                : null
              await this.deps.nicknameService.autoSetGroupNickname(
                session,
                mcName,
                enhancedUser.username,
                String(enhancedUser.uid),
                normalizedTargetId
              )
            }
          } catch (renameError) {
            this.logger.warn('强制绑定', `群昵称设置失败: ${renameError.message}`)
          }

          this.logger.info(
            '强制为他人绑定BUID',
            `管理员QQ(${operatorQQId})为QQ(${normalizedTargetId})强制绑定BUID: ${actualUid}(${enhancedUser.username})`,
            true
          )

          // 清理目标用户的绑定会话
          this.deps.removeBindingSession(target, session.channelId)
          this.logger.info(
            '强制绑定',
            `管理员为QQ(${normalizedTargetId})强制绑定B站账号后，已清理该用户的交互式绑定会话`
          )

          const medalDetails = this.deps.forceBinder.getTargetMedalDetails(enhancedUser)
          return this.deps.sendMessage(session, [
            h.text(
              `✅ 已成功为用户 ${normalizedTargetId} 强制绑定B站账号\n用户名: ${enhancedUser.username}\nUID: ${actualUid}\n\n${medalDetails}`
            )
          ])
        } else {
          this.logger.error('强制BUID绑定', operatorQQId, `为QQ(${normalizedTargetId})强制绑定失败`)
          return this.deps.sendMessage(session, [h.text('❌ 强制绑定失败，数据库操作出错')])
        }
      } else {
        // 为自己强制绑定
        if (await this.checkBuidExists(actualUid, session.userId)) {
          this.logger.warn('强制BUID绑定', `BUID"${actualUid}"已被其他QQ号绑定`)
          return this.deps.sendMessage(session, [
            h.text(`❌ UID ${actualUid} 已被其他用户绑定，即使使用强制模式也无法绑定已被占用的UID`)
          ])
        }

        const bindResult = await this.createOrUpdateBuidBind(session.userId, standardUser)

        if (bindResult) {
          // 尝试设置群昵称
          try {
            const latestBind = await this.repos.mcidbind.findByQQId(operatorQQId)
            if (latestBind) {
              const mcName = BindStatus.hasValidMcBind(latestBind)
                ? latestBind.mcUsername
                : null
              await this.deps.nicknameService.autoSetGroupNickname(
                session,
                mcName,
                enhancedUser.username,
                String(enhancedUser.uid)
              )
            }
          } catch (renameError) {
            this.logger.warn('强制绑定', `群昵称设置失败: ${renameError.message}`)
          }

          this.logger.info(
            '强制绑定BUID',
            `QQ(${operatorQQId})强制绑定BUID: ${actualUid}(${enhancedUser.username})`,
            true
          )

          const medalDetails = this.deps.forceBinder.getTargetMedalDetails(enhancedUser)
          return this.deps.sendMessage(session, [
            h.text(
              `✅ 强制绑定成功！\nB站UID: ${enhancedUser.uid}\n用户名: ${enhancedUser.username}\n\n${medalDetails}`
            ),
            ...(this.config?.showAvatar
              ? [h.image(`https://workers.vrp.moe/bilibili/avatar/${enhancedUser.uid}?size=160`)]
              : [])
          ])
        } else {
          this.logger.error('强制BUID绑定', operatorQQId, '强制绑定失败')
          return this.deps.sendMessage(session, [h.text('❌ 强制绑定失败，数据库操作出错')])
        }
      }
    } catch (forceBindError) {
      this.logger.error('强制BUID绑定', operatorQQId, `强制绑定过程出错: ${forceBindError.message}`)
      return this.deps.sendMessage(session, [h.text(`❌ 强制绑定失败: ${forceBindError.message}`)])
    }
  }

  /**
   * 管理员为他人绑定处理
   */
  private async handleAdminBindForOthers(
    session: any,
    actualUid: string,
    target: string,
    operatorQQId: string
  ): Promise<void> {
    const normalizedTargetId = this.deps.normalizeQQId(target)

    if (!normalizedTargetId) {
      this.logger.warn('BUID绑定', `QQ(${operatorQQId})提供的目标用户ID"${target}"无效`)
      if (target.startsWith('@')) {
        return this.deps.sendMessage(session, [
          h.text('❌ 请使用真正的@功能，而不是手动输入@符号\n正确做法：点击或长按用户头像选择@功能')
        ])
      }
      return this.deps.sendMessage(session, [
        h.text('❌ 目标用户ID无效\n请提供有效的QQ号或使用@功能选择用户')
      ])
    }

    this.logger.debug(
      'BUID绑定',
      `QQ(${operatorQQId})尝试为QQ(${normalizedTargetId})绑定BUID: ${actualUid}`
    )

    // 检查权限
    const isAdmin = await this.checkIsAdmin(session.userId)
    if (!isAdmin) {
      this.logger.warn('BUID绑定', `权限不足: QQ(${operatorQQId})不是管理员`)
      return this.deps.sendMessage(session, [h.text('只有管理员才能为其他用户绑定BUID')])
    }

    // 检查UID是否已被占用
    if (await this.checkBuidExists(actualUid, target)) {
      this.logger.warn('BUID绑定', `BUID"${actualUid}"已被其他QQ号绑定`)
      return this.deps.sendMessage(session, [h.text(`UID ${actualUid} 已被其他用户绑定`)])
    }

    // 验证UID
    const buidUser = await this.validateBUID(actualUid)
    if (!buidUser) {
      this.logger.warn('BUID绑定', `QQ(${operatorQQId})提供的UID"${actualUid}"不存在`)
      return this.deps.sendMessage(session, [
        h.text(
          `无法验证UID: ${actualUid}，该用户可能不存在或未被发现，你可以去直播间发个弹幕回来再绑定`
        )
      ])
    }

    // 创建或更新绑定
    const bindResult = await this.createOrUpdateBuidBind(normalizedTargetId, buidUser)

    if (!bindResult) {
      this.logger.error(
        'BUID绑定',
        operatorQQId,
        `管理员QQ(${operatorQQId})为QQ(${normalizedTargetId})绑定BUID"${actualUid}"失败`
      )
      return this.deps.sendMessage(session, [
        h.text(`为用户 ${normalizedTargetId} 绑定BUID失败: 数据库操作出错，请联系管理员`)
      ])
    }

    this.logger.info(
      '为他人绑定BUID',
      `管理员QQ(${operatorQQId})为QQ(${normalizedTargetId})绑定BUID: ${actualUid}(${buidUser.username})`,
      true
    )

    // 清理目标用户的绑定会话
    this.deps.removeBindingSession(target, session.channelId)
    this.logger.info(
      '绑定',
      `管理员为QQ(${normalizedTargetId})绑定B站账号后，已清理该用户的交互式绑定会话`
    )

    // 尝试设置群昵称
    try {
      const latestTargetBind = await this.repos.mcidbind.findByQQId(normalizedTargetId)
      if (latestTargetBind) {
        const mcName = BindStatus.hasValidMcBind(latestTargetBind)
          ? latestTargetBind.mcUsername
          : null
        await this.deps.nicknameService.autoSetGroupNickname(
          session,
          mcName,
          buidUser.username,
          actualUid,
          normalizedTargetId
        )
        this.logger.info(
          '绑定',
          `管理员QQ(${operatorQQId})为QQ(${normalizedTargetId})B站绑定完成，已尝试设置群昵称`
        )
      }
    } catch (renameError) {
      this.logger.warn(
        '绑定',
        `管理员QQ(${operatorQQId})为QQ(${normalizedTargetId})B站绑定后群昵称设置失败: ${renameError.message}`
      )
    }

    return this.deps.sendMessage(session, [
      h.text(
        `已成功为用户 ${normalizedTargetId} 绑定B站账号\n用户名: ${buidUser.username}\nUID: ${actualUid}\n${buidUser.guard_level > 0 ? `舰长等级: ${buidUser.guard_level_text}\n` : ''}${buidUser.medal ? `粉丝牌: ${buidUser.medal.name} Lv.${buidUser.medal.level}` : ''}`
      )
    ])
  }

  /**
   * 为自己绑定处理
   */
  private async handleSelfBind(
    session: any,
    actualUid: string,
    operatorQQId: string
  ): Promise<void> {
    this.logger.debug('BUID绑定', `QQ(${operatorQQId})尝试绑定BUID: ${actualUid}`)

    const selfBind = await this.repos.mcidbind.findByQQId(operatorQQId)

    // 检查冷却时间
    if (selfBind && selfBind.buidUid) {
      const isAdmin = await this.checkIsAdmin(session.userId)
      if (!isAdmin && !this.deps.checkCooldown(selfBind.lastModified)) {
        const days = this.config.cooldownDays
        const now = new Date()
        const diffTime = now.getTime() - selfBind.lastModified.getTime()
        const passedDays = Math.floor(diffTime / (1000 * 60 * 60 * 24))
        const remainingDays = days - passedDays

        this.logger.warn(
          'BUID绑定',
          `QQ(${operatorQQId})已绑定BUID"${selfBind.buidUid}"，且在冷却期内，还需${remainingDays}天`
        )
        return this.deps.sendMessage(session, [
          h.text(
            `您已绑定B站UID: ${selfBind.buidUid}，如需修改，请在冷却期结束后(还需${remainingDays}天)或联系管理员。`
          )
        ])
      }
      this.logger.debug(
        'BUID绑定',
        `QQ(${operatorQQId})已绑定BUID"${selfBind.buidUid}"，将进行更新`
      )
    }

    // 检查UID是否已被占用
    if (await this.checkBuidExists(actualUid, session.userId)) {
      this.logger.warn('BUID绑定', `BUID"${actualUid}"已被其他QQ号绑定`)
      return this.deps.sendMessage(session, [h.text(`UID ${actualUid} 已被其他用户绑定`)])
    }

    // 验证UID
    const buidUser = await this.validateBUID(actualUid)
    if (!buidUser) {
      this.logger.warn('BUID绑定', `QQ(${operatorQQId})提供的UID"${actualUid}"不存在`)
      return this.deps.sendMessage(session, [
        h.text(
          `无法验证UID: ${actualUid}，该用户可能不存在或未被发现，你可以去直播间逛一圈，发个弹幕回来再绑定`
        )
      ])
    }

    // 创建或更新绑定
    const bindResult = await this.createOrUpdateBuidBind(session.userId, buidUser)

    if (!bindResult) {
      this.logger.error('BUID绑定', operatorQQId, `QQ(${operatorQQId})绑定BUID"${actualUid}"失败`)
      return this.deps.sendMessage(session, [h.text('绑定失败，数据库操作出错，请联系管理员')])
    }

    this.logger.info(
      '绑定BUID',
      `QQ(${operatorQQId})绑定BUID: ${actualUid}(${buidUser.username})`,
      true
    )

    // 尝试设置群昵称
    try {
      const latestBind = await this.repos.mcidbind.findByQQId(operatorQQId)
      if (latestBind) {
        const mcName = BindStatus.hasValidMcBind(latestBind)
          ? latestBind.mcUsername
          : null
        await this.deps.nicknameService.autoSetGroupNickname(
          session,
          mcName,
          buidUser.username,
          actualUid
        )
        this.logger.info('绑定', `QQ(${operatorQQId})B站绑定完成，已尝试设置群昵称`)
      }
    } catch (renameError) {
      this.logger.warn('绑定', `QQ(${operatorQQId})B站绑定后群昵称设置失败: ${renameError.message}`)
    }

    this.logger.info('绑定', `QQ(${operatorQQId})成功绑定B站UID(${actualUid})`)
    return this.deps.sendMessage(
      session,
      [
        h.text('成功绑定B站账号！\n'),
        h.text(`B站UID: ${buidUser.uid}\n`),
        h.text(`用户名: ${buidUser.username}\n`),
        buidUser.guard_level > 0
          ? h.text(`舰长等级: ${buidUser.guard_level_text} (${buidUser.guard_level})\n`)
          : null,
        buidUser.medal
          ? h.text(`粉丝牌: ${buidUser.medal.name} Lv.${buidUser.medal.level}\n`)
          : null,
        buidUser.wealthMedalLevel > 0 ? h.text(`荣耀等级: ${buidUser.wealthMedalLevel}\n`) : null,
        ...(this.config?.showAvatar
          ? [h.image(`https://workers.vrp.moe/bilibili/avatar/${buidUser.uid}?size=160`)]
          : [])
      ].filter(Boolean)
    )
  }

  /**
   * 获取友好的错误消息
   */
  private getFriendlyErrorMessage(error: Error | string): string {
    const message = typeof error === 'string' ? error : error.message

    if (message.includes('timeout') || message.includes('ETIMEDOUT')) {
      return '操作超时，请稍后重试'
    }
    if (message.includes('ECONNREFUSED')) {
      return '无法连接到服务，请稍后重试'
    }
    if (message.includes('Network')) {
      return '网络错误，请检查网络连接'
    }
    if (message.includes('404')) {
      return '用户不存在'
    }

    return message
  }
}
