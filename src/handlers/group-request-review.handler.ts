import { h, Session, Next } from 'koishi'
import { BaseHandler } from './base.handler'
import type { PendingRequest, RejectFlow, AdminCache, GroupRequestReviewConfig } from '../types'

/**
 * 入群申请审批处理器
 *
 * @remarks
 * 该处理器实现了通过表情回应审批入群申请的功能：
 * - 监听指定群的入群申请
 * - 生成播报消息到管理群
 * - 自动添加表情选项
 * - 处理管理员的表情回应
 * - 执行批准/拒绝操作
 * - 支持自动绑定和交互式绑定
 */
export class GroupRequestReviewHandler extends BaseHandler {
  /** 待审批的申请记录 Map<broadcastMessageId, PendingRequest> */
  private pendingRequests = new Map<string, PendingRequest>()

  /** 拒绝流程状态 Map<askMessageId, RejectFlow> */
  private rejectFlows = new Map<string, RejectFlow>()

  /** 管理员权限缓存 Map<groupId, AdminCache> */
  private adminCache = new Map<string, AdminCache>()

  /** 用户进群等待列表 Map<userId, resolve> */
  private userJoinWaiters = new Map<string, (value: boolean) => void>()

  /** 配置 */
  private reviewConfig: GroupRequestReviewConfig

  /**
   * 注册事件监听和中间件
   */
  register(): void {
    // 检查功能是否启用
    if (!this.config.groupRequestReview?.enabled) {
      this.logger.info('入群审批', '功能未启用')
      return
    }

    this.reviewConfig = this.config.groupRequestReview
    this.logger.info('入群审批', '功能已启用')
    this.logger.info(
      '入群审批',
      `目标群: ${this.reviewConfig.targetGroupId}, 管理群: ${this.reviewConfig.reviewGroupId}`
    )

    // 监听入群申请
    this.ctx.on('guild-member-request', this.handleRequest.bind(this))

    // 监听用户成功进群
    this.ctx.on('guild-member-added', this.handleUserJoined.bind(this))

    // 监听表情回应（NapCat扩展事件）
    // 使用通用 'message' 事件监听，在 handleNotice 中过滤
    this.ctx.on('message' as any, this.handleNotice.bind(this))

    // 中间件：处理拒绝理由
    this.ctx.middleware(this.handleRejectReason.bind(this))

    // 定时清理过期记录
    this.ctx.setInterval(() => {
      this.cleanupExpiredRecords()
    }, 60 * 60 * 1000) // 每小时清理一次

    this.logger.info('入群审批', '已注册所有事件监听器', true)
  }

  /**
   * 处理入群申请事件
   */
  private async handleRequest(session: Session): Promise<void> {
    try {
      // 只处理目标群的申请
      if (session.guildId !== this.reviewConfig.targetGroupId) {
        return
      }

      const normalizedUserId = this.deps.normalizeQQId(session.userId)
      this.logger.info('入群审批', `收到申请 - QQ: ${normalizedUserId}, 群: ${session.guildId}`)

      // 获取申请人信息
      const applicantInfo = await this.getApplicantInfo(session)

      // 生成播报消息并发送到管理群
      const broadcastMsgId = await this.sendBroadcastMessage(applicantInfo, session)

      if (!broadcastMsgId) {
        this.logger.error('入群审批', '播报消息发送失败')
        return
      }

      // 保存待审批记录
      const pendingReq: PendingRequest = {
        broadcastMessageId: broadcastMsgId,
        requestFlag: session.messageId, // OneBot的请求标识
        applicantQQ: normalizedUserId,
        applicantNickname: applicantInfo.nickname,
        applicantAvatar: applicantInfo.avatar,
        targetGroupId: session.guildId,
        answer: session.content || '',
        timestamp: Date.now(),
        status: 'pending'
      }

      this.pendingRequests.set(broadcastMsgId, pendingReq)
      this.logger.info(
        '入群审批',
        `已保存待审批记录 - 申请人: ${normalizedUserId}, 播报消息ID: ${broadcastMsgId}`,
        true
      )

      // 自动添加表情回应选项
      await this.addReactionOptions(broadcastMsgId, session.bot)
    } catch (error) {
      this.logger.error('入群审批', `处理入群申请失败: ${error.message}`, error)
    }
  }

  /**
   * 处理通知事件（包括表情回应）
   */
  private async handleNotice(session: Session): Promise<void> {
    try {
      // 只处理群表情回应事件
      if (session.subtype !== 'group-msg-emoji-like') {
        return
      }

      // 只处理管理群的表情
      if (session.guildId !== this.reviewConfig.reviewGroupId) {
        return
      }

      // 获取原始事件数据（使用类型断言访问 onebot 扩展属性）
      const sessionAny = session as any
      if (!sessionAny.onebot || !sessionAny.onebot.likes) {
        return
      }

      const emojiData = sessionAny.onebot.likes
      const msgId = session.messageId
      const operatorId = this.deps.normalizeQQId(session.userId)

      this.logger.debug(
        '入群审批',
        `收到表情回应 - 消息: ${msgId}, 操作者: ${operatorId}, 表情数: ${emojiData.length}`
      )

      // 检查是否是待审批的消息
      const pendingReq = this.pendingRequests.get(msgId)
      if (!pendingReq) {
        return
      }

      // 检查是否已处理
      if (pendingReq.status !== 'pending') {
        this.logger.info('入群审批', `申请已处理，状态: ${pendingReq.status}`)
        return
      }

      // 检查操作者是否有管理权限
      const hasPermission = await this.checkAdminPermission(operatorId, session.guildId, session.bot)
      if (!hasPermission) {
        this.logger.warn('入群审批', `权限不足 - 操作者: ${operatorId} 不是管理员`)
        await this.deps.sendMessage(session, [h.text('⚠️ 只有管理员才能审批入群申请')])
        return
      }

      // 标记为处理中，防止重复操作
      pendingReq.status = 'processing'

      // 处理表情回应
      await this.handleEmojiReaction(emojiData, pendingReq, operatorId, session)
    } catch (error) {
      this.logger.error('入群审批', `处理表情回应失败: ${error.message}`, error)
    }
  }

  /**
   * 获取申请人信息
   */
  private async getApplicantInfo(session: Session): Promise<{
    qq: string
    nickname: string
    avatar: string
    answer: string
  }> {
    const qq = this.deps.normalizeQQId(session.userId)
    const answer = session.content || '（未填写）'

    // 尝试获取用户信息
    let nickname = qq
    let avatar = `http://q.qlogo.cn/headimg_dl?dst_uin=${qq}&spec=640`

    try {
      // 使用 bot.getUser 获取用户信息（如果可用）
      if (session.bot.getUser) {
        const userInfo = await session.bot.getUser(qq)
        if (userInfo.username) {
          nickname = userInfo.username
        }
        if (userInfo.avatar) {
          avatar = userInfo.avatar
        }
      }
    } catch (error) {
      this.logger.warn('入群审批', `获取用户信息失败，使用默认值: ${error.message}`)
    }

    return { qq, nickname, avatar, answer }
  }

  /**
   * 发送播报消息到管理群
   */
  private async sendBroadcastMessage(
    applicantInfo: { qq: string; nickname: string; avatar: string; answer: string },
    session: Session
  ): Promise<string | null> {
    const { qq, nickname, avatar, answer } = applicantInfo

    const elements = [
      h.text('📢 收到新的入群申请\n\n'),
      h.image(avatar),
      h.text(`\n👤 昵称：${nickname}\n`),
      h.text(`🆔 QQ号：${qq}\n`),
      h.text(`💬 回答：${answer}\n\n`),
      h.text('━━━━━━━━━━━━━━━\n'),
      h.text('请管理员点击表情回应：\n'),
      h.text('👍 /太赞了 - 通过并自动绑定\n'),
      h.text('😊 /偷感 - 通过并交互式绑定\n'),
      h.text('❌ /NO - 拒绝申请')
    ]

    try {
      const result = await session.bot.sendMessage(this.reviewConfig.reviewGroupId, elements)

      // result 通常是数组，第一个元素是消息ID
      if (Array.isArray(result) && result.length > 0) {
        return result[0]
      }

      return null
    } catch (error) {
      this.logger.error('入群审批', `发送播报消息失败: ${error.message}`, error)
      return null
    }
  }

  /**
   * 自动添加表情回应选项
   */
  private async addReactionOptions(messageId: string, bot: any): Promise<void> {
    const emojis = [
      this.reviewConfig.approveAutoBindEmoji,
      this.reviewConfig.approveInteractiveBindEmoji,
      this.reviewConfig.rejectEmoji
    ]

    for (const emojiId of emojis) {
      try {
        await bot.internal.setMsgEmojiLike(messageId, emojiId)
        this.logger.debug('入群审批', `已添加表情: ${emojiId}`)
        // 避免频繁调用
        await new Promise(resolve => setTimeout(resolve, 200))
      } catch (error) {
        this.logger.error('入群审批', `添加表情失败 - ID: ${emojiId}, 错误: ${error.message}`)
      }
    }
  }

  /**
   * 处理表情回应动作
   */
  private async handleEmojiReaction(
    emojiData: Array<{ emoji_id: string; count: number }>,
    pendingReq: PendingRequest,
    operatorId: string,
    session: Session
  ): Promise<void> {
    for (const emoji of emojiData) {
      const emojiId = emoji.emoji_id

      if (emojiId === this.reviewConfig.approveAutoBindEmoji) {
        // /太赞了 - 自动绑定
        this.logger.info('入群审批', `执行自动绑定 - 申请人: ${pendingReq.applicantQQ}`)
        await this.approveAndAutoBind(pendingReq, operatorId, session)
        break
      } else if (emojiId === this.reviewConfig.approveInteractiveBindEmoji) {
        // /偷感 - 交互式绑定
        this.logger.info('入群审批', `执行交互式绑定 - 申请人: ${pendingReq.applicantQQ}`)
        await this.approveAndInteractiveBind(pendingReq, operatorId, session)
        break
      } else if (emojiId === this.reviewConfig.rejectEmoji) {
        // /NO - 拒绝
        this.logger.info('入群审批', `发起拒绝流程 - 申请人: ${pendingReq.applicantQQ}`)
        await this.initRejectFlow(pendingReq, operatorId, session)
        break
      }
    }
  }

  /**
   * 批准并自动绑定
   */
  private async approveAndAutoBind(
    pendingReq: PendingRequest,
    operatorId: string,
    session: Session
  ): Promise<void> {
    try {
      // 1. 批准入群
      await session.bot.handleGuildMemberRequest(pendingReq.requestFlag, true, '欢迎加入！')
      this.logger.info('入群审批', `已批准入群 - QQ: ${pendingReq.applicantQQ}`, true)

      // 2. 等待用户进群
      const joined = await this.waitForUserJoin(pendingReq.applicantQQ, pendingReq.targetGroupId, 10000)

      if (!joined) {
        await this.notifyAdmin(
          operatorId,
          session,
          `⚠️ 已批准 ${pendingReq.applicantQQ} 入群，但用户未在10秒内进群`
        )
        pendingReq.status = 'approved'
        return
      }

      // 3. 解析UID
      const uid = this.parseUID(pendingReq.answer)
      if (!uid) {
        await this.notifyAdmin(
          operatorId,
          session,
          `⚠️ 无法解析UID"${pendingReq.answer}"，请手动处理\n申请人: ${pendingReq.applicantQQ}`
        )
        pendingReq.status = 'approved'
        return
      }

      this.logger.info('入群审批', `开始自动绑定 - QQ: ${pendingReq.applicantQQ}, UID: ${uid}`)

      // 4. 调用 BuidHandler 的绑定逻辑（需要从 handlers 获取）
      // 注意：这里需要访问其他 handler，可能需要调整架构
      // 暂时先记录日志，稍后实现具体绑定逻辑
      await this.performAutoBind(pendingReq.applicantQQ, uid, session.bot)

      // 5. 通知管理员
      await this.notifyAdmin(
        operatorId,
        session,
        `✅ 已批准 ${pendingReq.applicantQQ} 入群并完成自动绑定\nUID: ${uid}`
      )

      pendingReq.status = 'approved'
    } catch (error) {
      this.logger.error('入群审批', `自动绑定失败: ${error.message}`, error)
      await this.notifyAdmin(operatorId, session, `❌ 操作失败：${error.message}`)
      pendingReq.status = 'pending' // 恢复状态
    }
  }

  /**
   * 批准并启动交互式绑定
   */
  private async approveAndInteractiveBind(
    pendingReq: PendingRequest,
    operatorId: string,
    session: Session
  ): Promise<void> {
    try {
      // 1. 批准入群
      await session.bot.handleGuildMemberRequest(pendingReq.requestFlag, true, '欢迎加入！')
      this.logger.info('入群审批', `已批准入群 - QQ: ${pendingReq.applicantQQ}`, true)

      // 2. 等待用户进群
      const joined = await this.waitForUserJoin(pendingReq.applicantQQ, pendingReq.targetGroupId, 10000)

      if (joined) {
        // 3. 用户进群后会自动触发 guild-member-added 事件
        // 现有的入群欢迎流程会自动启动交互式绑定
        await this.notifyAdmin(
          operatorId,
          session,
          `✅ 已批准 ${pendingReq.applicantQQ} 入群，交互式绑定已启动`
        )
      } else {
        await this.notifyAdmin(
          operatorId,
          session,
          `⚠️ 已批准但用户 ${pendingReq.applicantQQ} 未在10秒内进群`
        )
      }

      pendingReq.status = 'approved'
    } catch (error) {
      this.logger.error('入群审批', `交互式绑定失败: ${error.message}`, error)
      await this.notifyAdmin(operatorId, session, `❌ 操作失败：${error.message}`)
      pendingReq.status = 'pending'
    }
  }

  /**
   * 发起拒绝流程
   */
  private async initRejectFlow(
    pendingReq: PendingRequest,
    operatorId: string,
    session: Session
  ): Promise<void> {
    try {
      // 发送询问消息
      const askElements = [
        h.text(`❓ 请回复拒绝理由（引用此消息回复）\n`),
        h.text(`申请人：${pendingReq.applicantNickname}（${pendingReq.applicantQQ}）`)
      ]

      const askResult = await session.bot.sendMessage(session.channelId, askElements)
      const askMsgId = Array.isArray(askResult) ? askResult[0] : null

      if (!askMsgId) {
        throw new Error('发送询问消息失败')
      }

      // 保存拒绝流程状态
      const rejectFlow: RejectFlow = {
        pendingRequest: pendingReq,
        operatorId,
        askMessageId: askMsgId,
        timeout: Date.now() + 5 * 60 * 1000 // 5分钟超时
      }

      this.rejectFlows.set(askMsgId, rejectFlow)
      this.logger.info('入群审批', `已发起拒绝流程 - 询问消息ID: ${askMsgId}`)
    } catch (error) {
      this.logger.error('入群审批', `发起拒绝流程失败: ${error.message}`, error)
      await this.notifyAdmin(operatorId, session, `❌ 发起拒绝流程失败：${error.message}`)
      pendingReq.status = 'pending'
    }
  }

  /**
   * 处理拒绝理由（中间件）
   */
  private async handleRejectReason(session: Session, next: Next): Promise<any> {
    // 检查是否是引用消息
    if (!session.quote) {
      return next()
    }

    const rejectFlow = this.rejectFlows.get(session.quote.id)
    if (!rejectFlow) {
      return next()
    }

    // 检查是否是同一个管理员
    const operatorId = this.deps.normalizeQQId(session.userId)
    if (operatorId !== rejectFlow.operatorId) {
      return '⚠️ 只有发起拒绝的管理员可以提供理由'
    }

    // 检查是否超时
    if (Date.now() > rejectFlow.timeout) {
      this.rejectFlows.delete(session.quote.id)
      rejectFlow.pendingRequest.status = 'pending'
      return '❌ 拒绝流程已超时，请重新操作'
    }

    // 执行拒绝
    const reason = session.content
    const { pendingRequest } = rejectFlow

    try {
      await session.bot.handleGuildMemberRequest(pendingRequest.requestFlag, false, reason)

      this.logger.info('入群审批', `已拒绝入群 - QQ: ${pendingRequest.applicantQQ}, 理由: ${reason}`, true)

      pendingRequest.status = 'rejected'
      this.rejectFlows.delete(session.quote.id)

      return `✅ 已拒绝 ${pendingRequest.applicantQQ} 的入群申请\n拒绝理由：${reason}`
    } catch (error) {
      this.logger.error('入群审批', `拒绝入群失败: ${error.message}`, error)
      pendingRequest.status = 'pending'
      return `❌ 拒绝失败：${error.message}`
    }
  }

  /**
   * 处理用户成功进群事件
   */
  private handleUserJoined(session: Session): void {
    const userId = this.deps.normalizeQQId(session.userId)
    const waiter = this.userJoinWaiters.get(userId)

    if (waiter) {
      this.logger.debug('入群审批', `用户已进群 - QQ: ${userId}`)
      waiter(true)
      this.userJoinWaiters.delete(userId)
    }
  }

  /**
   * 等待用户进群
   */
  private waitForUserJoin(userId: string, groupId: string, timeout: number): Promise<boolean> {
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        this.userJoinWaiters.delete(userId)
        resolve(false)
      }, timeout)

      this.userJoinWaiters.set(userId, (joined: boolean) => {
        clearTimeout(timer)
        resolve(joined)
      })
    })
  }

  /**
   * 检查管理员权限
   */
  private async checkAdminPermission(
    userId: string,
    groupId: string,
    bot: any
  ): Promise<boolean> {
    // 检查是否是 masterId
    if (userId === this.config.masterId) {
      return true
    }

    // 先检查缓存
    const cache = this.adminCache.get(groupId)
    if (cache && Date.now() - cache.lastUpdate < 5 * 60 * 1000) {
      return cache.admins.includes(userId)
    }

    // 调用 NapCat 扩展 API 获取群信息
    try {
      const groupInfo = await bot.internal.getGroupInfoEx(groupId)
      const admins = (groupInfo.admins || []).map(String)

      // 更新缓存
      this.adminCache.set(groupId, {
        admins,
        lastUpdate: Date.now()
      })

      return admins.includes(userId)
    } catch (error) {
      this.logger.error('入群审批', `获取管理员列表失败: ${error.message}`)
      // 降级方案：只允许 masterId
      return userId === this.config.masterId
    }
  }

  /**
   * 解析UID（支持多种格式）
   */
  private parseUID(input: string): string | null {
    if (!input) return null

    input = input.trim()

    // 格式1: 纯数字
    if (/^\d+$/.test(input)) {
      return input
    }

    // 格式2: UID:123456789
    const uidMatch = input.match(/^UID:(\d+)$/i)
    if (uidMatch) {
      return uidMatch[1]
    }

    // 格式3: https://space.bilibili.com/123456789
    const urlMatch = input.match(/space\.bilibili\.com\/(\d+)/)
    if (urlMatch) {
      return urlMatch[1]
    }

    return null
  }

  /**
   * 通知管理员
   */
  private async notifyAdmin(operatorId: string, session: Session, message: string): Promise<void> {
    try {
      const elements = [h.at(operatorId), h.text(' '), h.text(message)]
      await session.bot.sendMessage(session.channelId, elements)
    } catch (error) {
      this.logger.error('入群审批', `通知管理员失败: ${error.message}`)
    }
  }

  /**
   * 执行自动绑定
   */
  private async performAutoBind(qq: string, uid: string, bot: any): Promise<void> {
    const axios = require('axios')

    try {
      // 1. 验证 UID
      this.logger.debug('入群审批', `验证 B站 UID: ${uid}`)

      const response = await axios.get(`${this.config.zminfoApiUrl}/api/user/${uid}`, {
        timeout: 10000,
        headers: {
          'User-Agent': 'Koishi-MCID-Bot/1.0'
        }
      })

      if (response.status !== 200 || !response.data || !response.data.uid) {
        throw new Error(`无法验证B站UID: ${uid}`)
      }

      const buidUser = response.data

      // 2. 检查是否已被其他人绑定
      const existingBind = await this.repos.mcidbind.findByBuidUid(uid)
      if (existingBind && existingBind.qqId !== qq) {
        throw new Error(`UID ${uid} 已被其他用户绑定`)
      }

      // 3. 获取或创建绑定记录
      let bind = await this.repos.mcidbind.findByQQId(qq)

      if (!bind) {
        // 创建新绑定（使用临时MC用户名）
        const tempMcUsername = `_temp_${Date.now()}`

        bind = await this.repos.mcidbind.create({
          qqId: qq,
          mcUsername: tempMcUsername,
          mcUuid: '',
          buidUid: buidUser.uid,
          buidUsername: buidUser.username,
          guardLevel: buidUser.guard_level || 0,
          guardLevelText: buidUser.guard_level_text || '',
          maxGuardLevel: buidUser.guard_level || 0,
          maxGuardLevelText: buidUser.guard_level_text || '',
          medalName: buidUser.medal?.name || '',
          medalLevel: buidUser.medal?.level || 0,
          wealthMedalLevel: buidUser.wealth_medal_level || 0,
          lastActiveTime: new Date(),
          lastModified: new Date()
        })

        this.logger.info('入群审批', `已创建新绑定 - QQ: ${qq}, UID: ${uid}`, true)
      } else {
        // 更新现有绑定
        await this.repos.mcidbind.update(qq, {
          buidUid: buidUser.uid,
          buidUsername: buidUser.username,
          guardLevel: buidUser.guard_level || 0,
          guardLevelText: buidUser.guard_level_text || '',
          maxGuardLevel: Math.max(bind.maxGuardLevel || 0, buidUser.guard_level || 0),
          maxGuardLevelText:
            buidUser.guard_level > (bind.maxGuardLevel || 0)
              ? buidUser.guard_level_text
              : bind.maxGuardLevelText,
          medalName: buidUser.medal?.name || '',
          medalLevel: buidUser.medal?.level || 0,
          wealthMedalLevel: buidUser.wealth_medal_level || 0,
          lastActiveTime: new Date(),
          lastModified: new Date()
        })

        this.logger.info('入群审批', `已更新绑定 - QQ: ${qq}, UID: ${uid}`, true)
      }

      // 4. 更新群昵称
      try {
        const groupId = this.reviewConfig.targetGroupId
        const nickname = `${buidUser.username}_${bind.mcUsername || 'MCID'}`

        await bot.internal.setGroupCard(groupId, qq, nickname)
        this.logger.info('入群审批', `已更新群昵称 - QQ: ${qq}, 昵称: ${nickname}`)
      } catch (error) {
        this.logger.warn('入群审批', `更新群昵称失败: ${error.message}`)
        // 昵称更新失败不影响绑定
      }

      this.logger.info('入群审批', `自动绑定完成 - QQ: ${qq}, UID: ${uid}, 用户名: ${buidUser.username}`, true)
    } catch (error) {
      this.logger.error('入群审批', `自动绑定失败: ${error.message}`, error)
      throw error
    }
  }

  /**
   * 定时清理过期记录
   */
  private cleanupExpiredRecords(): void {
    const now = Date.now()
    const cleanupThreshold = this.reviewConfig.autoCleanupHours * 60 * 60 * 1000

    // 清理过期的待审批记录
    let cleanedPending = 0
    for (const [msgId, req] of this.pendingRequests.entries()) {
      if (now - req.timestamp > cleanupThreshold) {
        this.pendingRequests.delete(msgId)
        cleanedPending++
      }
    }

    // 清理过期的拒绝流程
    let cleanedReject = 0
    for (const [askMsgId, flow] of this.rejectFlows.entries()) {
      if (now > flow.timeout) {
        this.rejectFlows.delete(askMsgId)
        cleanedReject++
      }
    }

    if (cleanedPending > 0 || cleanedReject > 0) {
      this.logger.info(
        '入群审批',
        `清理过期记录 - 待审批: ${cleanedPending}, 拒绝流程: ${cleanedReject}`
      )
    }
  }
}
