import { Context, Session, h } from 'koishi'
import { BaseHandler, Repositories, HandlerDependencies } from './base.handler'
import { LoggerService } from '../utils/logger'
import type { BindingSession, MCIDBIND } from '../types'
import { BindStatus } from '../utils/bind-status'

/**
 * 交互式绑定命令处理器
 * 处理 "绑定" 命令，引导用户完成 MC 和 B站双重绑定
 */
export class BindingHandler extends BaseHandler {
  private readonly BINDING_SESSION_TIMEOUT: number

  constructor(
    ctx: Context,
    config: any,
    logger: LoggerService,
    repos: Repositories,
    deps: HandlerDependencies
  ) {
    super(ctx, config, logger, repos, deps)
    // 从配置中获取会话超时时间，默认3分钟
    this.BINDING_SESSION_TIMEOUT = 3 * 60 * 1000
  }

  /**
   * 注册交互式绑定命令
   */
  register(): void {
    this.ctx
      .command('绑定 [target:string]', '交互式绑定流程')
      .alias('bind')
      .alias('interact')
      .action(async ({ session }, target) => {
        try {
          const normalizedUserId = this.deps.normalizeQQId(session.userId)
          const channelId = session.channelId

          // 如果指定了目标用户（管理员功能）
          if (target) {
            // 检查权限
            if (!(await this.isAdmin(session.userId))) {
              this.logger.warn(
                '交互绑定',
                `权限不足: QQ(${normalizedUserId})不是管理员，无法为他人启动绑定`
              )
              return this.deps.sendMessage(session, [
                h.text('只有管理员才能为其他用户启动绑定流程')
              ])
            }

            const normalizedTargetId = this.deps.normalizeQQId(target)

            // 检查目标用户ID是否有效
            if (!normalizedTargetId) {
              this.logger.warn('交互绑定', `QQ(${normalizedUserId})提供的目标用户ID"${target}"无效`)
              if (target.startsWith('@')) {
                return this.deps.sendMessage(session, [
                  h.text(
                    '❌ 请使用真正的@功能，而不是手动输入@符号\n正确做法：点击或长按用户头像选择@功能'
                  )
                ])
              }
              return this.deps.sendMessage(session, [
                h.text('❌ 目标用户ID无效\n请提供有效的QQ号或使用@功能选择用户')
              ])
            }
            this.logger.info(
              '交互绑定',
              `管理员QQ(${normalizedUserId})为QQ(${normalizedTargetId})启动交互式绑定流程`,
              true
            )

            // 检查目标用户是否已有进行中的会话
            const existingTargetSession = this.deps.getBindingSession(target, channelId)
            if (existingTargetSession) {
              this.logger.warn('交互绑定', `QQ(${normalizedTargetId})已有进行中的绑定会话`)
              return this.deps.sendMessage(session, [
                h.text(`用户 ${normalizedTargetId} 已有进行中的绑定会话`)
              ])
            }

            // 检查目标用户当前绑定状态
            const targetBind = await this.deps.databaseService.getMcBindByQQId(normalizedTargetId)

            // 如果两个账号都已绑定，不需要进入绑定流程
            if (BindStatus.hasCompletedAllBinds(targetBind)) {
              this.logger.info('交互绑定', `QQ(${normalizedTargetId})已完成全部绑定`, true)

              // 显示当前绑定信息
              const displayUsername = BindStatus.getDisplayMcUsername(targetBind, '未绑定')
              let bindInfo = `用户 ${normalizedTargetId} 已完成全部账号绑定：\n✅ MC账号: ${displayUsername}\n✅ B站账号: ${targetBind.buidUsername} (UID: ${targetBind.buidUid})`

              if (targetBind.guardLevel > 0) {
                bindInfo += `\n舰长等级: ${targetBind.guardLevelText}`
              }
              if (targetBind.medalName) {
                bindInfo += `\n粉丝牌: ${targetBind.medalName} Lv.${targetBind.medalLevel}`
              }

              return this.deps.sendMessage(session, [h.text(bindInfo)])
            }

            // 为目标用户创建绑定会话
            this.deps.createBindingSession(target, channelId, 'waiting_buid')

            // 如果已绑定MC但未绑定B站，直接进入B站绑定流程
            if (BindStatus.hasValidMcBind(targetBind) && !BindStatus.hasValidBuidBind(targetBind)) {
              this.logger.info(
                '交互绑定',
                `QQ(${normalizedTargetId})已绑定MC，进入B站绑定流程`,
                true
              )

              // 更新会话状态
              this.deps.updateBindingSession(target, channelId, {
                state: 'waiting_buid',
                mcUsername: BindStatus.hasValidMcBind(targetBind)
                  ? targetBind.mcUsername
                  : null,
                mcUuid: targetBind.mcUuid
              })

              // 向目标用户发送提示（@他们）
              const displayUsername = BindStatus.getDisplayMcUsername(targetBind, '未绑定')
              await this.deps.sendMessage(session, [
                h.at(normalizedTargetId),
                h.text(
                  ` 管理员为您启动了B站绑定流程\n🎮 已绑定MC: ${displayUsername}\n🔗 请发送您的B站UID`
                )
              ])

              return
            }

            // 向目标用户发送提示（@他们）
            await this.deps.sendMessage(session, [
              h.at(normalizedTargetId),
              h.text(
                ' 管理员为您启动了账号绑定流程\n📋 请选择绑定方式：\n1. 发送您的B站UID进行B站绑定\n2. 发送"跳过"仅绑定MC账号'
              )
            ])

            return
          }

          // 为自己启动绑定流程
          this.logger.info('交互绑定', `QQ(${normalizedUserId})开始交互式绑定流程`, true)

          // 检查是否已有进行中的会话
          const existingSession = this.deps.getBindingSession(session.userId, channelId)
          if (existingSession) {
            this.logger.warn('交互绑定', `QQ(${normalizedUserId})已有进行中的绑定会话`)
            return this.deps.sendMessage(session, [
              h.text('您已有进行中的绑定会话，请先完成当前绑定或等待会话超时')
            ])
          }

          // 检查用户当前绑定状态
          const existingBind = await this.deps.databaseService.getMcBindByQQId(normalizedUserId)

          // 如果两个账号都已绑定（且MC不是temp用户名），不需要进入绑定流程
          if (existingBind && BindStatus.hasValidMcBind(existingBind) && existingBind.buidUid) {
            this.logger.info('交互绑定', `QQ(${normalizedUserId})已完成全部绑定`, true)

            // 显示当前绑定信息
            const displayUsername = existingBind.mcUsername
            let bindInfo = `您已完成全部账号绑定：\n✅ MC账号: ${displayUsername}\n✅ B站账号: ${existingBind.buidUsername} (UID: ${existingBind.buidUid})`

            if (existingBind.guardLevel > 0) {
              bindInfo += `\n舰长等级: ${existingBind.guardLevelText}`
            }
            if (existingBind.medalName) {
              bindInfo += `\n粉丝牌: ${existingBind.medalName} Lv.${existingBind.medalLevel}`
            }

            bindInfo += `\n\n如需修改绑定信息，请使用：\n- ${this.deps.formatCommand('mcid change <新用户名>')} 修改MC账号\n- ${this.deps.formatCommand('buid bind <新UID>')} 修改B站账号`

            return this.deps.sendMessage(session, [h.text(bindInfo)])
          }

          // 如果已绑定MC（且不是temp用户名）但未绑定B站，直接进入B站绑定流程
          if (existingBind && BindStatus.hasValidMcBind(existingBind) && !existingBind.buidUid) {
            this.logger.info('交互绑定', `QQ(${normalizedUserId})已绑定MC，进入B站绑定流程`, true)

            // 创建绑定会话，状态直接设为等待B站UID
            const timeout = setTimeout(() => {
              this.deps.bindingSessions.delete(`${normalizedUserId}_${channelId}`)
              this.ctx.bots.forEach(bot => {
                bot
                  .sendMessage(channelId, [
                    h.at(normalizedUserId),
                    h.text(
                      ' 绑定会话已超时，请重新开始绑定流程\n\n⚠️ 温馨提醒：若在管理员多次提醒后仍不配合绑定账号信息，将按群规进行相应处理。'
                    )
                  ])
                  .catch(() => {})
              })
              this.logger.info('交互绑定', `QQ(${normalizedUserId})的绑定会话因超时被清理`, true)
            }, this.BINDING_SESSION_TIMEOUT)

            const sessionData: BindingSession = {
              userId: session.userId,
              channelId: channelId,
              state: 'waiting_buid',
              startTime: Date.now(),
              timeout: timeout,
              mcUsername: existingBind.mcUsername,
              mcUuid: existingBind.mcUuid
            }

            this.deps.bindingSessions.set(`${normalizedUserId}_${channelId}`, sessionData)

            return this.deps.sendMessage(session, [
              h.text(`🎮 已绑定MC: ${existingBind.mcUsername}\n🔗 请发送您的B站UID`)
            ])
          }

          // 如果只绑定了B站（MC是temp用户名），提醒绑定MC账号
          if (
            existingBind &&
            existingBind.buidUid &&
            existingBind.buidUsername &&
            !BindStatus.hasValidMcBind(existingBind)
          ) {
            this.logger.info('交互绑定', `QQ(${normalizedUserId})只绑定了B站，进入MC绑定流程`, true)

            // 创建绑定会话，状态设为等待MC用户名
            this.deps.createBindingSession(session.userId, channelId, 'waiting_mc_username')
            const bindingSession = this.deps.getBindingSession(session.userId, channelId)
            bindingSession.state = 'waiting_mc_username'

            return this.deps.sendMessage(session, [
              h.text(
                `✅ 已绑定B站: ${existingBind.buidUsername}\n🎮 请发送您的MC用户名，或发送"跳过"保持当前状态`
              )
            ])
          }

          // 如果未绑定账号，让用户选择绑定方式，优先B站绑定
          this.deps.createBindingSession(session.userId, channelId, 'waiting_buid')

          // 发送绑定选项提示
          return this.deps.sendMessage(session, [
            h.text('📋 请选择绑定方式：\n1. 发送您的B站UID进行B站绑定\n2. 发送"跳过"仅绑定MC账号')
          ])
        } catch (error) {
          const normalizedUserId = this.deps.normalizeQQId(session.userId)
          this.logger.error(
            '交互绑定',
            `QQ(${normalizedUserId})开始交互式绑定失败: ${error.message}`,
            error
          )
          return this.deps.sendMessage(session, [h.text(this.getFriendlyErrorMessage(error))])
        }
      })
  }

  /**
   * 检查用户是否为管理员
   * @param userId 用户ID
   * @returns 是否为管理员
   */
  private async isAdmin(userId: string): Promise<boolean> {
    try {
      // 主人始终是管理员
      const normalizedMasterId = this.deps.normalizeQQId(this.config.masterId)
      const normalizedQQId = this.deps.normalizeQQId(userId)

      if (normalizedQQId === normalizedMasterId) return true

      // 查询MCIDBIND表中是否是管理员
      const bind = await this.deps.databaseService.getMcBindByQQId(normalizedQQId)
      return bind && bind.isAdmin === true
    } catch (error) {
      const normalizedQQId = this.deps.normalizeQQId(userId)
      this.logger.error(
        '权限检查',
        `QQ(${normalizedQQId})的管理员状态查询失败: ${error.message}`,
        error
      )
      return false
    }
  }

  /**
   * 获取用户友好的错误信息
   * @param error 错误对象
   * @returns 用户友好的错误消息
   */
  private getFriendlyErrorMessage(error: Error | string): string {
    const errorMsg = error instanceof Error ? error.message : error

    // 拆分错误信息
    const userError = this.getUserFacingErrorMessage(errorMsg)

    // 将警告级别错误标记出来
    if (this.isWarningError(userError)) {
      return `⚠️ ${userError}`
    }

    // 将严重错误标记出来
    if (this.isCriticalError(userError)) {
      return `❌ ${userError}`
    }

    return userError
  }

  /**
   * 提取用户友好的错误信息
   * @param errorMsg 原始错误消息
   * @returns 用户友好的错误消息
   */
  private getUserFacingErrorMessage(errorMsg: string): string {
    // Mojang API相关错误
    if (errorMsg.includes('ECONNABORTED') || errorMsg.includes('timeout')) {
      return '无法连接到Mojang服务器，请稍后再试'
    }

    if (errorMsg.includes('404')) {
      return '该Minecraft用户名不存在'
    }

    if (errorMsg.includes('network') || errorMsg.includes('connect')) {
      return '网络连接异常，请稍后再试'
    }

    // 数据库相关错误
    if (errorMsg.includes('unique') || errorMsg.includes('duplicate')) {
      return '该Minecraft用户名已被其他用户绑定'
    }

    // RCON相关错误
    if (errorMsg.includes('RCON') || errorMsg.includes('服务器')) {
      if (
        errorMsg.includes('authentication') ||
        errorMsg.includes('auth') ||
        errorMsg.includes('认证')
      ) {
        return 'RCON认证失败，服务器拒绝访问，请联系管理员检查密码'
      }
      if (
        errorMsg.includes('ECONNREFUSED') ||
        errorMsg.includes('ETIMEDOUT') ||
        errorMsg.includes('无法连接')
      ) {
        return '无法连接到游戏服务器，请确认服务器是否在线或联系管理员'
      }
      if (errorMsg.includes('command') || errorMsg.includes('执行命令')) {
        return '服务器命令执行失败，请稍后再试'
      }
      return '与游戏服务器通信失败，请稍后再试'
    }

    // 用户名相关错误
    if (errorMsg.includes('用户名') || errorMsg.includes('username')) {
      if (errorMsg.includes('不存在')) {
        return '该Minecraft用户名不存在，请检查拼写'
      }
      if (errorMsg.includes('已被')) {
        return '该Minecraft用户名已被其他用户绑定，请使用其他用户名'
      }
      if (errorMsg.includes('格式')) {
        return 'Minecraft用户名格式不正确，应为3-16位字母、数字和下划线'
      }
      return '用户名验证失败，请检查用户名并重试'
    }

    // 默认错误信息
    return '操作失败，请稍后再试'
  }

  /**
   * 判断是否为警告级别错误（用户可能输入有误）
   * @param errorMsg 错误消息
   * @returns 是否为警告级别错误
   */
  private isWarningError(errorMsg: string): boolean {
    const warningPatterns = [
      '用户名不存在',
      '格式不正确',
      '已被其他用户绑定',
      '已在白名单中',
      '不在白名单中',
      '未绑定MC账号',
      '冷却期内'
    ]

    return warningPatterns.some(pattern => errorMsg.includes(pattern))
  }

  /**
   * 判断是否为严重错误（系统问题）
   * @param errorMsg 错误消息
   * @returns 是否为严重错误
   */
  private isCriticalError(errorMsg: string): boolean {
    const criticalPatterns = ['无法连接', 'RCON认证失败', '服务器通信失败', '数据库操作出错']

    return criticalPatterns.some(pattern => errorMsg.includes(pattern))
  }
}
