import { Context, Session, h } from 'koishi'
import { BaseHandler } from './base.handler'
import type { Config, MCIDBIND, MojangProfile } from '../types'
import { BindStatus } from '../utils/bind-status'

export class McidCommandHandler extends BaseHandler {
  /**
   * 注册所有MCID命令
   */
  register(): void {
    const cmd = this.ctx.command('mcid', 'MC账号绑定管理')

    // mcid.query - 查询MC账号
    cmd
      .subcommand('.query [target:string]', '查询用户绑定的MC账号')
      .action(async ({ session }, target) => this.handleQuery(session, target))

    // mcid.finduser - 通过MC用户名查询QQ号
    cmd
      .subcommand('.finduser <username:string>', '[管理员]通过MC用户名查询绑定的QQ账号')
      .action(async ({ session }, username) => this.handleFindUser(session, username))

    // mcid.bind - 绑定MC账号
    cmd
      .subcommand('.bind <username:string> [target:string]', '绑定MC账号')
      .action(async ({ session }, username, target) => this.handleBind(session, username, target))

    // mcid.change - 修改MC账号
    cmd
      .subcommand('.change <username:string> [target:string]', '修改绑定的MC账号')
      .action(async ({ session }, username, target) => this.handleChange(session, username, target))

    // mcid.unbind - 解绑MC账号
    cmd
      .subcommand('.unbind [target:string]', '[管理员]解绑MC账号')
      .action(async ({ session }, target) => this.handleUnbind(session, target))

    // mcid.admin - 设置管理员
    cmd
      .subcommand('.admin <target:string>', '[主人]将用户设为管理员')
      .action(async ({ session }, target) => this.handleAdmin(session, target))

    // mcid.unadmin - 撤销管理员
    cmd
      .subcommand('.unadmin <target:string>', '[主人]撤销用户的管理员权限')
      .action(async ({ session }, target) => this.handleUnadmin(session, target))

    // mcid.adminlist - 列出所有管理员
    cmd
      .subcommand('.adminlist', '[主人]列出所有管理员')
      .action(async ({ session }) => this.handleAdminlist(session))

    // mcid.stats - 查看统计
    cmd
      .subcommand('.stats', '[管理员]查看数据库统计信息')
      .action(async ({ session }) => this.handleStats(session))

    // mcid.fixnicknames - 修复群昵称
    cmd
      .subcommand(
        '.fixnicknames [groupId:string]',
        '[管理员]检查并修复指定群或当前群的用户群昵称格式'
      )
      .action(async ({ session }, groupId) => this.handleFixNicknames(session, groupId))

    // mcid.clearreminder - 清除提醒
    cmd
      .subcommand('.clearreminder [target:string]', '[管理员]清除用户的随机提醒冷却时间和提醒次数')
      .action(async ({ session }, target) => this.handleClearReminder(session, target))

    // mcid.export - 导出数据
    cmd
      .subcommand('.export <groupId:string>', '[管理员]导出指定群的成员和绑定信息为Excel文件')
      .action(async ({ session }, groupId) => this.handleExport(session, groupId))
  }

  /**
   * 查询MC账号
   */
  private async handleQuery(session: Session, target?: string): Promise<void> {
    try {
      const normalizedUserId = this.deps.normalizeQQId(session.userId)

      // 查询目标用户或自己
      if (target) {
        const normalizedTargetId = this.deps.normalizeQQId(target)

        if (!normalizedTargetId) {
          this.logger.warn('查询', `QQ(${normalizedUserId})提供的目标用户ID"${target}"无效`)
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

        this.logger.info('查询', `QQ(${normalizedUserId})查询QQ(${normalizedTargetId})的MC账号信息`)

        const targetBind = await this.deps.databaseService.getMcBindByQQId(normalizedTargetId)
        if (!targetBind || !BindStatus.hasValidMcBind(targetBind)) {
          this.logger.info('查询', `QQ(${normalizedTargetId})未绑定MC账号`)

          // 检查是否绑定了B站
          if (targetBind && targetBind.buidUid) {
            const buidUser = await this.deps.apiService.validateBUID(targetBind.buidUid)
            if (buidUser) {
              await this.deps.databaseService.updateBuidInfoOnly(targetBind.qqId, buidUser)
              const refreshedBind =
                await this.deps.databaseService.getMcBindByQQId(normalizedTargetId)
              if (refreshedBind) {
                let buidInfo = `该用户尚未绑定MC账号\n\nB站账号信息：\nB站UID: ${refreshedBind.buidUid}\n用户名: ${refreshedBind.buidUsername}`
                if (refreshedBind.guardLevel > 0) {
                  buidInfo += `\n舰长等级: ${refreshedBind.guardLevelText} (${refreshedBind.guardLevel})`
                  if (
                    refreshedBind.maxGuardLevel > 0 &&
                    refreshedBind.maxGuardLevel < refreshedBind.guardLevel
                  ) {
                    buidInfo += `\n历史最高: ${refreshedBind.maxGuardLevelText} (${refreshedBind.maxGuardLevel})`
                  }
                } else if (refreshedBind.maxGuardLevel > 0) {
                  buidInfo += `\n历史舰长: ${refreshedBind.maxGuardLevelText} (${refreshedBind.maxGuardLevel})`
                }
                if (refreshedBind.medalName) {
                  buidInfo += `\n粉丝牌: ${refreshedBind.medalName} Lv.${refreshedBind.medalLevel}`
                }

                const messageElements = [h.text(buidInfo)]
                if (this.config.showAvatar) {
                  messageElements.push(
                    h.image(
                      `https://workers.vrp.moe/bilibili/avatar/${refreshedBind.buidUid}?size=160`
                    )
                  )
                }
                return this.deps.sendMessage(session, messageElements)
              }
            }
          }

          return this.deps.sendMessage(session, [h.text('该用户尚未绑定MC账号')])
        }

        // 显示MC绑定信息（使用智能缓存检测，避免频繁API调用）
        const updatedBind =
          await this.deps.databaseService.checkAndUpdateUsernameWithCache(targetBind)
        return this.buildQueryResponse(session, updatedBind, normalizedTargetId)
      }

      // 查询自己
      this.logger.info('查询', `QQ(${normalizedUserId})查询自己的MC账号信息`)
      const selfBind = await this.deps.databaseService.getMcBindByQQId(normalizedUserId)

      if (!selfBind || !BindStatus.hasValidMcBind(selfBind)) {
        this.logger.info('查询', `QQ(${normalizedUserId})未绑定MC账号`)

        // 检查是否绑定了B站
        if (selfBind && selfBind.buidUid) {
          const buidUser = await this.deps.apiService.validateBUID(selfBind.buidUid)
          if (buidUser) {
            await this.deps.databaseService.updateBuidInfoOnly(selfBind.qqId, buidUser)
            const refreshedBind = await this.deps.databaseService.getMcBindByQQId(normalizedUserId)
            if (refreshedBind) {
              let buidInfo = `您尚未绑定MC账号\n\nB站账号信息：\nB站UID: ${refreshedBind.buidUid}\n用户名: ${refreshedBind.buidUsername}`
              if (refreshedBind.guardLevel > 0) {
                buidInfo += `\n舰长等级: ${refreshedBind.guardLevelText} (${refreshedBind.guardLevel})`
                if (
                  refreshedBind.maxGuardLevel > 0 &&
                  refreshedBind.maxGuardLevel < refreshedBind.guardLevel
                ) {
                  buidInfo += `\n历史最高: ${refreshedBind.maxGuardLevelText} (${refreshedBind.maxGuardLevel})`
                }
              } else if (refreshedBind.maxGuardLevel > 0) {
                buidInfo += `\n历史舰长: ${refreshedBind.maxGuardLevelText} (${refreshedBind.maxGuardLevel})`
              }
              if (refreshedBind.medalName) {
                buidInfo += `\n粉丝牌: ${refreshedBind.medalName} Lv.${refreshedBind.medalLevel}`
              }

              buidInfo += `\n\n💡 您可以使用 ${this.deps.formatCommand('mcid bind <用户名>')} 绑定MC账号`

              const messageElements = [h.text(buidInfo)]
              if (this.config.showAvatar) {
                messageElements.push(
                  h.image(
                    `https://workers.vrp.moe/bilibili/avatar/${refreshedBind.buidUid}?size=160`
                  )
                )
              }
              return this.deps.sendMessage(session, messageElements)
            }
          }
        }

        return this.deps.sendMessage(session, [
          h.text(
            '您尚未绑定MC账号，请使用 ' +
              this.deps.formatCommand('mcid bind <用户名>') +
              ' 进行绑定'
          )
        ])
      }

      // 使用智能缓存检测，避免频繁API调用
      const updatedBind = await this.deps.databaseService.checkAndUpdateUsernameWithCache(selfBind)
      return this.buildQueryResponse(session, updatedBind, null)
    } catch (error) {
      const normalizedUserId = this.deps.normalizeQQId(session.userId)
      this.logger.error('查询', `QQ(${normalizedUserId})查询MC账号失败: ${error.message}`)
      return this.deps.sendMessage(session, [h.text(`查询失败: ${error.message}`)])
    }
  }

  /**
   * 构建查询响应消息
   */
  private async buildQueryResponse(
    session: Session,
    bind: MCIDBIND,
    targetId: string | null
  ): Promise<void> {
    const formattedUuid = this.deps.apiService.formatUuid(bind.mcUuid)

    // MC头像
    let mcAvatarUrl = null
    if (this.config.showAvatar) {
      if (this.config.showMcSkin) {
        mcAvatarUrl = this.deps.apiService.getStarlightSkinUrl(bind.mcUsername)
      } else {
        mcAvatarUrl = this.deps.apiService.getCrafatarUrl(bind.mcUuid)
      }
    }

    // 白名单信息
    let whitelistInfo = ''
    if (bind.whitelist && bind.whitelist.length > 0) {
      const circledNumbers = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩']
      const serverList = bind.whitelist
        .map((serverId, index) => {
          const server = this.deps.getServerConfigById(serverId)
          if (!server) {
            const disabledServer = this.config.servers?.find(s => s.id === serverId)
            if (disabledServer && disabledServer.enabled === false) {
              return `${index < circledNumbers.length ? circledNumbers[index] : index + 1} ${disabledServer.name} [已停用]`
            }
            return `${index < circledNumbers.length ? circledNumbers[index] : index + 1} 未知服务器(ID: ${serverId})`
          }
          const circledNumber =
            index < circledNumbers.length ? circledNumbers[index] : `${index + 1}`
          let info = `${circledNumber} ${server.name}`
          if (server.displayAddress && server.displayAddress.trim()) {
            info += `\n   地址: ${server.displayAddress}`
          }
          return info
        })
        .join('\n')
      whitelistInfo = `\n已加入以下服务器的白名单:\n${serverList}`
    } else {
      whitelistInfo = '\n未加入任何服务器的白名单'
    }

    // B站账号信息
    let buidInfo = ''
    let buidAvatar = null
    if (bind.buidUid) {
      buidInfo = `B站账号信息：\nB站UID: ${bind.buidUid}\n用户名: ${bind.buidUsername}`
      if (bind.guardLevel > 0) {
        buidInfo += `\n舰长等级: ${bind.guardLevelText} (${bind.guardLevel})`
        if (bind.maxGuardLevel > 0 && bind.maxGuardLevel < bind.guardLevel) {
          buidInfo += `\n历史最高: ${bind.maxGuardLevelText} (${bind.maxGuardLevel})`
        }
      } else if (bind.maxGuardLevel > 0) {
        buidInfo += `\n历史舰长: ${bind.maxGuardLevelText} (${bind.maxGuardLevel})`
      }
      if (bind.medalName) {
        buidInfo += `\n粉丝牌: ${bind.medalName} Lv.${bind.medalLevel}`
      }
      if (this.config.showAvatar) {
        buidAvatar = h.image(`https://workers.vrp.moe/bilibili/avatar/${bind.buidUid}?size=160`)
      }
    } else {
      buidInfo = targetId
        ? '该用户尚未绑定B站账号'
        : `您尚未绑定B站账号，使用 ${this.deps.formatCommand('buid bind <B站UID>')} 进行绑定`
    }

    this.logger.info(
      '查询',
      `QQ(${bind.qqId})的MC账号信息：用户名=${bind.mcUsername}, UUID=${bind.mcUuid}`
    )

    const displayUsername = BindStatus.getDisplayMcUsername(bind, '未绑定')
    const prefix = targetId ? `用户 ${targetId} 的` : '您的'
    const messageElements = [
      h.text(
        `${prefix}MC账号信息：\n用户名: ${displayUsername}\nUUID: ${formattedUuid}${whitelistInfo}`
      ),
      ...(mcAvatarUrl ? [h.image(mcAvatarUrl)] : []),
      h.text(`\n${buidInfo}`),
      ...(buidAvatar ? [buidAvatar] : [])
    ]

    // 先发送响应，然后异步设置群昵称
    const sendPromise = this.deps.sendMessage(session, messageElements)

    // 异步设置群昵称
    if (bind.buidUid && bind.buidUsername) {
      const mcName = BindStatus.hasValidMcBind(bind) ? bind.mcUsername : null
      this.deps.nicknameService
        .autoSetGroupNickname(
          session,
          mcName,
          bind.buidUsername,
          bind.buidUid,
          targetId || undefined
        )
        .catch(err => this.logger.warn('查询', `群昵称设置失败: ${err.message}`))
    } else {
      this.logger.info('查询', `QQ(${bind.qqId})未绑定B站账号，跳过群昵称设置`)
    }

    return sendPromise
  }

  /**
   * 通过MC用户名查询QQ号
   */
  private async handleFindUser(session: Session, username: string): Promise<void> {
    try {
      const normalizedUserId = this.deps.normalizeQQId(session.userId)

      // 检查权限
      if (!(await this.deps.isAdmin(session.userId))) {
        this.logger.warn('反向查询', `权限不足: QQ(${normalizedUserId})不是管理员`)
        return this.deps.sendMessage(session, [h.text('只有管理员才能使用此命令')])
      }

      if (!username) {
        this.logger.warn('反向查询', `QQ(${normalizedUserId})未提供MC用户名`)
        return this.deps.sendMessage(session, [h.text('请提供要查询的MC用户名')])
      }

      this.logger.info(
        '反向查询',
        `QQ(${normalizedUserId})尝试通过MC用户名"${username}"查询绑定的QQ账号`
      )

      const bind = await this.deps.databaseService.getMcBindByUsername(username)

      if (!bind || !bind.qqId) {
        this.logger.info('反向查询', `MC用户名"${username}"未被任何QQ账号绑定`)
        return this.deps.sendMessage(session, [h.text(`未找到绑定MC用户名"${username}"的QQ账号`)])
      }

      // MC头像
      let mcAvatarUrl = null
      if (this.config.showAvatar) {
        if (this.config.showMcSkin) {
          mcAvatarUrl = this.deps.apiService.getStarlightSkinUrl(bind.mcUsername)
        } else {
          mcAvatarUrl = this.deps.apiService.getCrafatarUrl(bind.mcUuid)
        }
      }

      const formattedUuid = this.deps.apiService.formatUuid(bind.mcUuid)

      // 管理员信息
      let adminInfo = ''
      if (await this.deps.isAdmin(session.userId)) {
        if (bind.whitelist && bind.whitelist.length > 0) {
          const serverList = bind.whitelist
            .map(serverId => {
              const server = this.deps.getServerConfigById(serverId)
              return server ? server.name : `未知服务器(${serverId})`
            })
            .join('\n- ')
          adminInfo = `\n\n白名单服务器:\n- ${serverList}`
        } else {
          adminInfo = '\n\n未加入任何服务器白名单'
        }
        adminInfo += `\n绑定时间: ${bind.lastModified ? new Date(bind.lastModified).toLocaleString() : '未知'}`
        adminInfo += `\n管理员权限: ${bind.isAdmin ? '是' : '否'}`
      }

      this.logger.info('反向查询', `成功: MC用户名"${username}"被QQ(${bind.qqId})绑定`)
      const displayUsername = BindStatus.getDisplayMcUsername(bind, '未绑定')
      return this.deps.sendMessage(session, [
        h.text(
          `MC用户名"${displayUsername}"绑定信息:\nQQ号: ${bind.qqId}\nUUID: ${formattedUuid}${adminInfo}`
        ),
        ...(mcAvatarUrl ? [h.image(mcAvatarUrl)] : [])
      ])
    } catch (error) {
      const normalizedUserId = this.deps.normalizeQQId(session.userId)
      this.logger.error(
        '反向查询',
        `QQ(${normalizedUserId})通过MC用户名"${username}"查询失败: ${error.message}`
      )
      return this.deps.sendMessage(session, [h.text(this.deps.getFriendlyErrorMessage(error))])
    }
  }

  /**
   * 绑定MC账号
   */
  private async handleBind(session: Session, username: string, target?: string): Promise<void> {
    try {
      const normalizedUserId = this.deps.normalizeQQId(session.userId)

      // 检查用户名格式
      if (!username || !/^[a-zA-Z0-9_]{3,16}$/.test(username)) {
        this.logger.warn('绑定', `QQ(${normalizedUserId})提供的用户名"${username}"格式无效`)
        return this.deps.sendMessage(session, [
          h.text('请提供有效的Minecraft用户名（3-16位字母、数字、下划线）')
        ])
      }

      // 验证用户名是否存在
      const profile = await this.deps.apiService.validateUsername(username)
      if (!profile) {
        this.logger.warn('绑定', `QQ(${normalizedUserId})提供的用户名"${username}"不存在`)
        return this.deps.sendMessage(session, [
          h.text(`无法验证用户名: ${username}，该用户可能不存在`)
        ])
      }

      username = profile.name
      const uuid = profile.id

      // 管理员为他人绑定
      if (target) {
        return this.handleBindForOther(session, username, uuid, target, normalizedUserId)
      }

      // 为自己绑定
      return this.handleBindForSelf(session, username, uuid, normalizedUserId)
    } catch (error) {
      const normalizedUserId = this.deps.normalizeQQId(session.userId)
      this.logger.error(
        '绑定',
        `QQ(${normalizedUserId})绑定MC账号"${username}"失败: ${error.message}`
      )
      return this.deps.sendMessage(session, [h.text(this.deps.getFriendlyErrorMessage(error))])
    }
  }

  private async handleBindForOther(
    session: Session,
    username: string,
    uuid: string,
    target: string,
    operatorId: string
  ): Promise<void> {
    const normalizedTargetId = this.deps.normalizeQQId(target)

    if (!normalizedTargetId) {
      this.logger.warn('绑定', `QQ(${operatorId})提供的目标用户ID"${target}"无效`)
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
      '绑定',
      `QQ(${operatorId})尝试为QQ(${normalizedTargetId})绑定MC账号: ${username}(${uuid})`
    )

    // 检查权限
    if (!(await this.deps.isAdmin(session.userId))) {
      this.logger.warn('绑定', `权限不足: QQ(${operatorId})不是管理员`)
      return this.deps.sendMessage(session, [h.text('只有管理员才能为其他用户绑定MC账号')])
    }

    // 检查用户名是否已被占用（支持改名检测）
    if (await this.deps.databaseService.checkUsernameExists(username, target, uuid)) {
      this.logger.warn('绑定', `MC用户名"${username}"已被其他QQ号绑定`)
      return this.deps.sendMessage(session, [h.text(`用户名 ${username} 已被其他用户绑定`)])
    }

    // 绑定
    const bindResult = await this.deps.databaseService.createOrUpdateMcBind(target, username, uuid)
    if (!bindResult) {
      this.logger.error(
        '绑定',
        `管理员QQ(${operatorId})为QQ(${normalizedTargetId})绑定MC账号"${username}"失败`
      )
      return this.deps.sendMessage(session, [
        h.text(`为用户 ${normalizedTargetId} 绑定MC账号失败: 数据库操作出错，请联系管理员`)
      ])
    }

    this.logger.info(
      '绑定',
      `成功: 管理员QQ(${operatorId})为QQ(${normalizedTargetId})绑定MC账号: ${username}(${uuid})`
    )

    // 清理绑定会话
    this.deps.removeBindingSession(target, session.channelId)
    this.logger.info(
      '绑定',
      `管理员为QQ(${normalizedTargetId})绑定MC账号后，已清理该用户的交互式绑定会话`
    )

    // 尝试设置群昵称
    let targetBuidStatus = ''
    try {
      const latestTargetBind = await this.deps.databaseService.getMcBindByQQId(normalizedTargetId)
      if (latestTargetBind && latestTargetBind.buidUid && latestTargetBind.buidUsername) {
        await this.deps.nicknameService.autoSetGroupNickname(
          session,
          username,
          latestTargetBind.buidUsername,
          latestTargetBind.buidUid,
          normalizedTargetId
        )
        this.logger.info(
          '绑定',
          `管理员QQ(${operatorId})为QQ(${normalizedTargetId})MC绑定完成，已尝试设置群昵称`
        )
        targetBuidStatus = '\n✅ 该用户已绑定B站账号，群昵称已更新'
      } else {
        this.logger.info(
          '绑定',
          `管理员QQ(${operatorId})为QQ(${normalizedTargetId})MC绑定完成，但目标用户未绑定B站账号`
        )
        targetBuidStatus = '\n⚠️ 该用户尚未绑定B站账号，建议提醒其使用 buid bind 命令完成B站绑定'
      }
    } catch (renameError) {
      this.logger.warn(
        '绑定',
        `管理员QQ(${operatorId})为QQ(${normalizedTargetId})MC绑定后群昵称设置失败: ${renameError.message}`
      )
    }

    // MC头像
    let mcAvatarUrl = null
    if (this.config.showAvatar) {
      if (this.config.showMcSkin) {
        mcAvatarUrl = this.deps.apiService.getStarlightSkinUrl(username)
      } else {
        mcAvatarUrl = this.deps.apiService.getCrafatarUrl(uuid)
      }
    }

    const formattedUuid = this.deps.apiService.formatUuid(uuid)
    return this.deps.sendMessage(session, [
      h.text(
        `已成功为用户 ${normalizedTargetId} 绑定MC账号\n用户名: ${username}\nUUID: ${formattedUuid}${targetBuidStatus}`
      ),
      ...(mcAvatarUrl ? [h.image(mcAvatarUrl)] : [])
    ])
  }

  private async handleBindForSelf(
    session: Session,
    username: string,
    uuid: string,
    operatorId: string
  ): Promise<void> {
    this.logger.debug('绑定', `QQ(${operatorId})尝试绑定MC账号: ${username}(${uuid})`)

    // 检查是否已绑定
    const selfBind = await this.deps.databaseService.getMcBindByQQId(operatorId)
    if (selfBind && selfBind.mcUsername) {
      const isTempUsername = !BindStatus.hasValidMcBind(selfBind)

      if (!isTempUsername) {
        // 检查冷却时间
        if (
          !(await this.deps.isAdmin(session.userId)) &&
          !this.deps.checkCooldown(selfBind.lastModified)
        ) {
          const days = this.config.cooldownDays
          const now = new Date()
          const diffTime = now.getTime() - selfBind.lastModified.getTime()
          const passedDays = Math.floor(diffTime / (1000 * 60 * 60 * 24))
          const remainingDays = days - passedDays

          this.logger.warn(
            '绑定',
            `QQ(${operatorId})已绑定MC账号"${selfBind.mcUsername}"，且在冷却期内`
          )
          const displayUsername = BindStatus.getDisplayMcUsername(selfBind, '未绑定')
          return this.deps.sendMessage(session, [
            h.text(
              `您已绑定MC账号: ${displayUsername}，如需修改，请在冷却期结束后(还需${remainingDays}天)使用 ` +
                this.deps.formatCommand('mcid change') +
                ' 命令或联系管理员。'
            )
          ])
        }
        this.logger.debug(
          '绑定',
          `QQ(${operatorId})已绑定MC账号"${selfBind.mcUsername}"，建议使用change命令`
        )
        const displayUsername = BindStatus.getDisplayMcUsername(selfBind, '未绑定')
        return this.deps.sendMessage(session, [
          h.text(
            `您已绑定MC账号: ${displayUsername}，如需修改请使用 ` +
              this.deps.formatCommand('mcid change') +
              ' 命令。'
          )
        ])
      } else {
        this.logger.debug(
          '绑定',
          `QQ(${operatorId})之前绑定的是临时用户名"${selfBind.mcUsername}"，允许直接使用bind命令`
        )
      }
    }

    // 检查用户名是否已被占用（支持改名检测）
    if (await this.deps.databaseService.checkUsernameExists(username, session.userId, uuid)) {
      this.logger.warn('绑定', `MC用户名"${username}"已被其他QQ号绑定`)
      return this.deps.sendMessage(session, [h.text(`用户名 ${username} 已被其他用户绑定`)])
    }

    // 绑定
    const bindResult = await this.deps.databaseService.createOrUpdateMcBind(
      session.userId,
      username,
      uuid
    )
    if (!bindResult) {
      this.logger.error('绑定', `QQ(${operatorId})绑定MC账号"${username}"失败`)
      return this.deps.sendMessage(session, [h.text('绑定失败，数据库操作出错，请联系管理员')])
    }

    this.logger.info('绑定', `成功: QQ(${operatorId})绑定MC账号: ${username}(${uuid})`)

    // 尝试设置群昵称
    let buidReminder = ''
    try {
      const latestBind = await this.deps.databaseService.getMcBindByQQId(operatorId)
      if (latestBind && latestBind.buidUid && latestBind.buidUsername) {
        await this.deps.nicknameService.autoSetGroupNickname(
          session,
          username,
          latestBind.buidUsername,
          latestBind.buidUid
        )
        this.logger.info('绑定', `QQ(${operatorId})MC绑定完成，已尝试设置群昵称`)
      } else {
        buidReminder = `\n\n💡 提醒：您还未绑定B站账号，建议使用 ${this.deps.formatCommand('buid bind <B站UID>')} 完成B站绑定以享受完整功能`
        this.logger.info('绑定', `QQ(${operatorId})MC绑定完成，但未绑定B站账号`)
      }
    } catch (renameError) {
      this.logger.warn('绑定', `QQ(${operatorId})MC绑定后群昵称设置失败: ${renameError.message}`)
    }

    // MC头像
    let mcAvatarUrl = null
    if (this.config.showAvatar) {
      if (this.config.showMcSkin) {
        mcAvatarUrl = this.deps.apiService.getStarlightSkinUrl(username)
      } else {
        mcAvatarUrl = this.deps.apiService.getCrafatarUrl(uuid)
      }
    }

    const formattedUuid = this.deps.apiService.formatUuid(uuid)
    return this.deps.sendMessage(session, [
      h.text(`已成功绑定MC账号\n用户名: ${username}\nUUID: ${formattedUuid}${buidReminder}`),
      ...(mcAvatarUrl ? [h.image(mcAvatarUrl)] : [])
    ])
  }

  /**
   * 修改MC账号
   */
  private async handleChange(session: Session, username: string, target?: string): Promise<void> {
    try {
      const normalizedUserId = this.deps.normalizeQQId(session.userId)

      // 检查用户名格式
      if (!username || !/^[a-zA-Z0-9_]{3,16}$/.test(username)) {
        this.logger.warn('修改', `QQ(${normalizedUserId})提供的用户名"${username}"格式无效`)
        return this.deps.sendMessage(session, [
          h.text('请提供有效的Minecraft用户名（3-16位字母、数字、下划线）')
        ])
      }

      // 验证用户名是否存在
      const profile = await this.deps.apiService.validateUsername(username)
      if (!profile) {
        this.logger.warn('修改', `QQ(${normalizedUserId})提供的用户名"${username}"不存在`)
        return this.deps.sendMessage(session, [
          h.text(`无法验证用户名: ${username}，该用户可能不存在`)
        ])
      }

      username = profile.name
      const uuid = profile.id

      // 管理员为他人修改
      if (target) {
        return this.handleChangeForOther(session, username, uuid, target, normalizedUserId)
      }

      // 为自己修改
      return this.handleChangeForSelf(session, username, uuid, normalizedUserId)
    } catch (error) {
      const normalizedUserId = this.deps.normalizeQQId(session.userId)
      this.logger.error(
        '修改',
        `QQ(${normalizedUserId})修改MC账号为"${username}"失败: ${error.message}`
      )
      return this.deps.sendMessage(session, [h.text(this.deps.getFriendlyErrorMessage(error))])
    }
  }

  private async handleChangeForOther(
    session: Session,
    username: string,
    uuid: string,
    target: string,
    operatorId: string
  ): Promise<void> {
    const normalizedTargetId = this.deps.normalizeQQId(target)

    if (!normalizedTargetId) {
      this.logger.warn('修改', `QQ(${operatorId})提供的目标用户ID"${target}"无效`)
      if (target.startsWith('@')) {
        return this.deps.sendMessage(session, [
          h.text('❌ 请使用真正的@功能，而不是手动输入@符号\n正确做法：点击或长按用户头像选择@功能')
        ])
      }
      return this.deps.sendMessage(session, [
        h.text('❌ 目标用户ID无效\n请提供有效的QQ号或使用@功能选择用户')
      ])
    }

    this.logger.info(
      '修改',
      `QQ(${operatorId})尝试修改QQ(${normalizedTargetId})的MC账号为: ${username}(${uuid})`
    )

    // 检查权限
    if (!(await this.deps.isAdmin(session.userId))) {
      this.logger.warn('修改', `权限不足: QQ(${operatorId})不是管理员`)
      return this.deps.sendMessage(session, [h.text('只有管理员才能修改其他用户的MC账号')])
    }

    // 获取目标用户信息
    const targetBind = await this.deps.databaseService.getMcBindByQQId(normalizedTargetId)

    if (!targetBind || !targetBind.mcUsername) {
      this.logger.warn('修改', `QQ(${normalizedTargetId})尚未绑定MC账号`)
      return this.deps.sendMessage(session, [
        h.text(
          `用户 ${normalizedTargetId} 尚未绑定MC账号，请先使用 ` +
            this.deps.formatCommand('mcid bind') +
            ' 命令进行绑定'
        )
      ])
    }

    // 检查是否与当前用户名相同
    if (targetBind.mcUsername === username) {
      this.logger.warn('修改', `QQ(${normalizedTargetId})已绑定相同的MC账号"${username}"`)
      return this.deps.sendMessage(session, [
        h.text(`用户 ${normalizedTargetId} 当前已绑定此用户名: ${username}`)
      ])
    }

    // 检查用户名是否已被占用（支持改名检测）
    if (await this.deps.databaseService.checkUsernameExists(username, target, uuid)) {
      this.logger.warn('修改', `MC用户名"${username}"已被其他QQ号绑定`)
      return this.deps.sendMessage(session, [h.text(`用户名 ${username} 已被其他用户绑定`)])
    }

    const oldUsername = targetBind.mcUsername

    // 更新绑定信息
    const bindResult = await this.deps.databaseService.createOrUpdateMcBind(target, username, uuid)
    if (!bindResult) {
      this.logger.error('修改', `管理员QQ(${operatorId})修改QQ(${normalizedTargetId})的MC账号失败`)
      return this.deps.sendMessage(session, [
        h.text(`修改用户 ${normalizedTargetId} 的MC账号失败: 数据库操作出错，请联系管理员`)
      ])
    }

    this.logger.info(
      '修改',
      `成功: 管理员QQ(${operatorId})修改QQ(${normalizedTargetId})的MC账号: ${oldUsername} -> ${username}(${uuid})`
    )

    // MC头像
    let mcAvatarUrl = null
    if (this.config.showAvatar) {
      if (this.config.showMcSkin) {
        mcAvatarUrl = this.deps.apiService.getStarlightSkinUrl(username)
      } else {
        mcAvatarUrl = this.deps.apiService.getCrafatarUrl(uuid)
      }
    }

    const formattedUuid = this.deps.apiService.formatUuid(uuid)
    return this.deps.sendMessage(session, [
      h.text(
        `已成功将用户 ${normalizedTargetId} 的MC账号从 ${oldUsername} 修改为 ${username}\nUUID: ${formattedUuid}`
      ),
      ...(mcAvatarUrl ? [h.image(mcAvatarUrl)] : [])
    ])
  }

  private async handleChangeForSelf(
    session: Session,
    username: string,
    uuid: string,
    operatorId: string
  ): Promise<void> {
    const selfBind = await this.deps.databaseService.getMcBindByQQId(operatorId)

    // 检查是否已绑定
    if (!selfBind || !selfBind.mcUsername) {
      this.logger.warn('修改', `QQ(${operatorId})尚未绑定MC账号`)
      return this.deps.sendMessage(session, [
        h.text('您尚未绑定MC账号，请使用 ' + this.deps.formatCommand('mcid bind') + ' 命令进行绑定')
      ])
    }

    // 检查是否与当前用户名相同
    if (selfBind.mcUsername === username) {
      this.logger.warn('修改', `QQ(${operatorId})已绑定相同的MC账号"${username}"`)
      return this.deps.sendMessage(session, [h.text(`您当前已绑定此用户名: ${username}`)])
    }

    // 检查冷却时间
    if (
      !(await this.deps.isAdmin(session.userId)) &&
      !this.deps.checkCooldown(selfBind.lastModified)
    ) {
      const days = this.config.cooldownDays
      const now = new Date()
      const diffTime = now.getTime() - selfBind.lastModified.getTime()
      const passedDays = Math.floor(diffTime / (1000 * 60 * 60 * 24))
      const remainingDays = days - passedDays

      this.logger.warn('修改', `QQ(${operatorId})在冷却期内，无法修改MC账号`)
      return this.deps.sendMessage(session, [
        h.text(
          `您的MC账号绑定在冷却期内，还需${remainingDays}天才能修改。如需立即修改，请联系管理员。`
        )
      ])
    }

    // 检查用户名是否已被占用（支持改名检测）
    if (await this.deps.databaseService.checkUsernameExists(username, session.userId, uuid)) {
      this.logger.warn('修改', `MC用户名"${username}"已被其他QQ号绑定`)
      return this.deps.sendMessage(session, [h.text(`用户名 ${username} 已被其他用户绑定`)])
    }

    const oldUsername = selfBind.mcUsername

    // 更新绑定信息
    const bindResult = await this.deps.databaseService.createOrUpdateMcBind(
      session.userId,
      username,
      uuid
    )
    if (!bindResult) {
      this.logger.error('修改', `QQ(${operatorId})修改MC账号失败`)
      return this.deps.sendMessage(session, [h.text('修改失败，数据库操作出错，请联系管理员')])
    }

    this.logger.info(
      '修改',
      `成功: QQ(${operatorId})修改MC账号: ${oldUsername} -> ${username}(${uuid})`
    )

    // MC头像
    let mcAvatarUrl = null
    if (this.config.showAvatar) {
      if (this.config.showMcSkin) {
        mcAvatarUrl = this.deps.apiService.getStarlightSkinUrl(username)
      } else {
        mcAvatarUrl = this.deps.apiService.getCrafatarUrl(uuid)
      }
    }

    const formattedUuid = this.deps.apiService.formatUuid(uuid)
    return this.deps.sendMessage(session, [
      h.text(`已成功将MC账号从 ${oldUsername} 修改为 ${username}\nUUID: ${formattedUuid}`),
      ...(mcAvatarUrl ? [h.image(mcAvatarUrl)] : [])
    ])
  }

  /**
   * 解绑MC账号
   */
  private async handleUnbind(session: Session, target?: string): Promise<void> {
    try {
      const normalizedUserId = this.deps.normalizeQQId(session.userId)

      // 管理员为他人解绑
      if (target) {
        return this.handleUnbindForOther(session, target, normalizedUserId)
      }

      // 为自己解绑
      return this.handleUnbindForSelf(session, normalizedUserId)
    } catch (error) {
      const normalizedUserId = this.deps.normalizeQQId(session.userId)
      const targetInfo = target ? `为QQ(${this.deps.normalizeQQId(target)})` : ''
      this.logger.error(
        '解绑',
        `QQ(${normalizedUserId})${targetInfo}解绑MC账号失败: ${error.message}`
      )
      return this.deps.sendMessage(session, [h.text(this.deps.getFriendlyErrorMessage(error))])
    }
  }

  private async handleUnbindForOther(
    session: Session,
    target: string,
    operatorId: string
  ): Promise<void> {
    const normalizedTargetId = this.deps.normalizeQQId(target)

    if (!normalizedTargetId) {
      this.logger.warn('解绑', `QQ(${operatorId})提供的目标用户ID"${target}"无效`)
      if (target.startsWith('@')) {
        return this.deps.sendMessage(session, [
          h.text('❌ 请使用真正的@功能，而不是手动输入@符号\n正确做法：点击或长按用户头像选择@功能')
        ])
      }
      return this.deps.sendMessage(session, [
        h.text('❌ 目标用户ID无效\n请提供有效的QQ号或使用@功能选择用户')
      ])
    }

    this.logger.info('解绑', `QQ(${operatorId})尝试为QQ(${normalizedTargetId})解绑MC账号`)

    // 检查权限
    if (!(await this.deps.isAdmin(session.userId))) {
      this.logger.warn('解绑', `权限不足: QQ(${operatorId})不是管理员`)
      return this.deps.sendMessage(session, [h.text('只有管理员才能为其他用户解绑MC账号')])
    }

    // 获取目标用户信息
    const targetBind = await this.deps.databaseService.getMcBindByQQId(normalizedTargetId)

    if (!targetBind || !targetBind.mcUsername) {
      this.logger.warn('解绑', `QQ(${normalizedTargetId})尚未绑定MC账号`)
      return this.deps.sendMessage(session, [h.text(`用户 ${normalizedTargetId} 尚未绑定MC账号`)])
    }

    const oldUsername = BindStatus.getDisplayMcUsername(targetBind, '未绑定')
    const hasBuidBind = targetBind.buidUid && targetBind.buidUid.trim() !== ''
    const buidKeepInfo = hasBuidBind
      ? `\n✅ 该用户的B站绑定已保留: ${targetBind.buidUsername}(${targetBind.buidUid})`
      : ''

    // 解绑MC账号
    await this.deps.databaseService.deleteMcBind(target)

    this.logger.info(
      '解绑',
      `成功: 管理员QQ(${operatorId})为QQ(${normalizedTargetId})解绑MC账号: ${oldUsername}`
    )
    return this.deps.sendMessage(session, [
      h.text(`已成功为用户 ${normalizedTargetId} 解绑MC账号: ${oldUsername}${buidKeepInfo}`)
    ])
  }

  private async handleUnbindForSelf(session: Session, operatorId: string): Promise<void> {
    this.logger.info('解绑', `QQ(${operatorId})尝试解绑自己的MC账号`)

    const selfBind = await this.deps.databaseService.getMcBindByQQId(operatorId)

    if (!selfBind || !selfBind.mcUsername) {
      this.logger.warn('解绑', `QQ(${operatorId})尚未绑定MC账号`)
      return this.deps.sendMessage(session, [h.text('您尚未绑定MC账号')])
    }

    const oldUsername = BindStatus.getDisplayMcUsername(selfBind, '未绑定')
    const hasBuidBind = selfBind.buidUid && selfBind.buidUid.trim() !== ''
    const buidKeepInfo = hasBuidBind
      ? `\n✅ 您的B站绑定已保留: ${selfBind.buidUsername}(${selfBind.buidUid})`
      : ''

    // 解绑MC账号
    await this.deps.databaseService.deleteMcBind(operatorId)

    this.logger.info('解绑', `成功: QQ(${operatorId})解绑MC账号: ${oldUsername}`)
    return this.deps.sendMessage(session, [
      h.text(`已成功解绑MC账号: ${oldUsername}${buidKeepInfo}`)
    ])
  }

  /**
   * 设置管理员
   */
  private async handleAdmin(session: Session, target: string): Promise<void> {
    try {
      const normalizedUserId = this.deps.normalizeQQId(session.userId)
      const normalizedTargetId = this.deps.normalizeQQId(target)
      this.logger.info('管理员', `QQ(${normalizedUserId})尝试将QQ(${normalizedTargetId})设为管理员`)

      // 检查是否为主人
      if (!this.deps.isMaster(session.userId)) {
        this.logger.warn('管理员', `权限不足: QQ(${normalizedUserId})不是主人`)
        return this.deps.sendMessage(session, [h.text('只有主人才能设置管理员')])
      }

      // 检查目标用户是否已经是管理员
      const targetBind = await this.deps.databaseService.getMcBindByQQId(normalizedTargetId)
      const isAlreadyAdmin = targetBind && targetBind.isAdmin === true

      if (isAlreadyAdmin) {
        this.logger.warn('管理员', `QQ(${normalizedTargetId})已经是管理员`)
        return this.deps.sendMessage(session, [h.text(`用户 ${normalizedTargetId} 已经是管理员`)])
      }

      // 如果用户存在绑定记录，更新为管理员
      if (targetBind) {
        await this.repos.mcidbind.update(normalizedTargetId, {
          isAdmin: true
        })
        this.logger.info(
          '管理员',
          `成功: 主人QQ(${normalizedUserId})将QQ(${normalizedTargetId})设为管理员`
        )
        return this.deps.sendMessage(session, [
          h.text(`已成功将用户 ${normalizedTargetId} 设为管理员`)
        ])
      } else {
        // 用户不存在绑定记录，创建一个新记录并设为管理员
        try {
          await this.repos.mcidbind.create({
            qqId: normalizedTargetId,
            mcUsername: '',
            mcUuid: '',
            lastModified: new Date(),
            isAdmin: true,
            hasMcBind: false,
            hasBuidBind: false
          })
          this.logger.info(
            '管理员',
            `成功: 主人QQ(${normalizedUserId})将QQ(${normalizedTargetId})设为管理员 (创建新记录)`
          )
          return this.deps.sendMessage(session, [
            h.text(`已成功将用户 ${normalizedTargetId} 设为管理员 (未绑定MC账号)`)
          ])
        } catch (createError) {
          this.logger.error('管理员', `创建管理员记录失败: ${createError.message}`)
          return this.deps.sendMessage(session, [
            h.text(this.deps.getFriendlyErrorMessage(createError))
          ])
        }
      }
    } catch (error) {
      const normalizedUserId = this.deps.normalizeQQId(session.userId)
      const normalizedTargetId = this.deps.normalizeQQId(target)
      this.logger.error(
        '管理员',
        `QQ(${normalizedUserId})将QQ(${normalizedTargetId})设为管理员失败: ${error.message}`
      )
      return this.deps.sendMessage(session, [h.text(this.deps.getFriendlyErrorMessage(error))])
    }
  }

  /**
   * 撤销管理员
   */
  private async handleUnadmin(session: Session, target: string): Promise<void> {
    try {
      const normalizedUserId = this.deps.normalizeQQId(session.userId)
      const normalizedTargetId = this.deps.normalizeQQId(target)
      this.logger.info(
        '管理员',
        `QQ(${normalizedUserId})尝试撤销QQ(${normalizedTargetId})的管理员权限`
      )

      // 检查是否为主人
      if (!this.deps.isMaster(session.userId)) {
        this.logger.warn('管理员', `权限不足: QQ(${normalizedUserId})不是主人`)
        return this.deps.sendMessage(session, [h.text('只有主人才能撤销管理员权限')])
      }

      // 检查目标用户是否是管理员
      const targetBind = await this.deps.databaseService.getMcBindByQQId(normalizedTargetId)
      const isAdmin = targetBind && targetBind.isAdmin === true

      if (!isAdmin) {
        this.logger.warn('管理员', `QQ(${normalizedTargetId})不是管理员`)
        return this.deps.sendMessage(session, [h.text(`用户 ${normalizedTargetId} 不是管理员`)])
      }

      // 撤销管理员权限
      await this.repos.mcidbind.update(normalizedTargetId, {
        isAdmin: false
      })

      this.logger.info(
        '管理员',
        `成功: 主人QQ(${normalizedUserId})撤销了QQ(${normalizedTargetId})的管理员权限`
      )
      return this.deps.sendMessage(session, [
        h.text(`已成功撤销用户 ${normalizedTargetId} 的管理员权限`)
      ])
    } catch (error) {
      const normalizedUserId = this.deps.normalizeQQId(session.userId)
      const normalizedTargetId = this.deps.normalizeQQId(target)
      this.logger.error(
        '管理员',
        `QQ(${normalizedUserId})撤销QQ(${normalizedTargetId})的管理员权限失败: ${error.message}`
      )
      return this.deps.sendMessage(session, [h.text(this.deps.getFriendlyErrorMessage(error))])
    }
  }

  /**
   * 列出所有管理员
   */
  private async handleAdminlist(session: Session): Promise<void> {
    try {
      const normalizedUserId = this.deps.normalizeQQId(session.userId)
      this.logger.info('管理员', `QQ(${normalizedUserId})尝试查看管理员列表`)

      // 检查是否为主人
      if (!this.deps.isMaster(session.userId)) {
        this.logger.warn('管理员', `权限不足: QQ(${normalizedUserId})不是主人`)
        return this.deps.sendMessage(session, [h.text('只有主人才能查看管理员列表')])
      }

      // 查询所有管理员
      const admins = await this.repos.mcidbind.findAllAdmins()

      if (admins.length === 0) {
        this.logger.info('管理员', '管理员列表为空')
        return this.deps.sendMessage(session, [h.text('当前没有管理员')])
      }

      // 格式化管理员列表
      const adminList = admins
        .map(admin => {
          const displayUsername = BindStatus.hasValidMcBind(admin) ? admin.mcUsername : null
          return `- ${admin.qqId}${displayUsername ? ` (MC: ${displayUsername})` : ''}`
        })
        .join('\n')

      this.logger.info('管理员', `成功: 主人QQ(${normalizedUserId})查看了管理员列表`)
      return this.deps.sendMessage(session, [
        h.text(`管理员列表:\n${adminList}\n\n共 ${admins.length} 名管理员`)
      ])
    } catch (error) {
      const normalizedUserId = this.deps.normalizeQQId(session.userId)
      this.logger.error('管理员', `QQ(${normalizedUserId})查看管理员列表失败: ${error.message}`)
      return this.deps.sendMessage(session, [h.text(this.deps.getFriendlyErrorMessage(error))])
    }
  }

  /**
   * 查看统计
   */
  private async handleStats(session: Session): Promise<void> {
    try {
      const normalizedUserId = this.deps.normalizeQQId(session.userId)
      this.logger.info('统计', `QQ(${normalizedUserId})尝试查看数据库统计`)

      // 检查权限
      if (!(await this.deps.isAdmin(session.userId))) {
        this.logger.warn('统计', `权限不足: QQ(${normalizedUserId})不是管理员`)
        return this.deps.sendMessage(session, [h.text('只有管理员才能查看统计信息')])
      }

      // 查询所有绑定记录
      const allBinds = await this.repos.mcidbind.findAll()

      // 统计绑定情况
      let mcidBoundUsers = 0
      let buidBoundUsers = 0

      for (const bind of allBinds) {
        if (BindStatus.hasValidMcBind(bind)) {
          mcidBoundUsers++
        }

        const hasBuid = bind.buidUid && bind.buidUid.trim() !== ''
        if (hasBuid) {
          buidBoundUsers++
        }
      }

      let statsInfo = '📊 绑定统计\n'
      statsInfo += `\n已绑定MCID: ${mcidBoundUsers}人\n`
      statsInfo += `已绑定BUID: ${buidBoundUsers}人`

      this.logger.info('统计', `成功: 管理员QQ(${normalizedUserId})查看了数据库统计`)
      return this.deps.sendMessage(session, [h.text(statsInfo)])
    } catch (error) {
      const normalizedUserId = this.deps.normalizeQQId(session.userId)
      this.logger.error('统计', `QQ(${normalizedUserId})查看统计失败: ${error.message}`)
      return this.deps.sendMessage(session, [h.text(this.deps.getFriendlyErrorMessage(error))])
    }
  }

  /**
   * 修复群昵称
   */
  private async handleFixNicknames(session: Session, groupId?: string): Promise<void> {
    try {
      const normalizedUserId = this.deps.normalizeQQId(session.userId)

      // 检查权限
      if (!(await this.deps.isAdmin(session.userId))) {
        this.logger.warn('群昵称修复', `权限不足: QQ(${normalizedUserId})不是管理员`)
        return this.deps.sendMessage(session, [h.text('只有管理员才能执行群昵称修复操作')])
      }

      // 确定目标群ID
      const targetGroupId = groupId || session.channelId

      // 验证群ID格式
      if (groupId && !/^\d+$/.test(groupId)) {
        return this.deps.sendMessage(session, [h.text('❌ 群号格式无效，请提供正确的群号')])
      }

      // 检查bot是否在目标群中
      try {
        if (session.bot.internal) {
          await session.bot.internal.getGroupInfo(targetGroupId)
        }
      } catch (error) {
        this.logger.warn('群昵称修复', `Bot不在群${targetGroupId}中或无法获取群信息`)
        return this.deps.sendMessage(session, [
          h.text(`❌ Bot不在群 ${targetGroupId} 中或无权限操作该群`)
        ])
      }

      const groupDisplayText = groupId ? `群 ${targetGroupId}` : '当前群'
      this.logger.info(
        '群昵称修复',
        `管理员QQ(${normalizedUserId})开始批量修复${groupDisplayText}的群昵称`
      )
      await this.deps.sendMessage(session, [
        h.text(`🔧 开始检查并修复${groupDisplayText}的所有用户群昵称格式，请稍候...`)
      ])

      // 获取所有已绑定B站的用户
      const allBinds = await this.repos.mcidbind.findAll()
      const usersWithBuid = allBinds.filter(bind => bind.buidUid && bind.buidUsername)

      let checkedCount = 0
      let fixedCount = 0
      let errorCount = 0
      const results: string[] = []

      for (const bind of usersWithBuid) {
        try {
          checkedCount++

          // 获取用户当前群昵称
          let currentNickname = ''
          try {
            if (session.bot.internal) {
              const groupInfo = await session.bot.internal.getGroupMemberInfo(
                targetGroupId,
                bind.qqId
              )
              currentNickname = groupInfo.card || groupInfo.nickname || ''
            }
          } catch (error) {
            errorCount++
            results.push(`❌ ${bind.qqId}: 获取群信息失败`)
            continue
          }

          // 检查昵称格式
          const mcInfo = BindStatus.hasValidMcBind(bind) ? bind.mcUsername : null
          const isCorrect = this.deps.nicknameService.checkNicknameFormat(
            currentNickname,
            bind.buidUsername,
            mcInfo
          )

          if (!isCorrect) {
            // 修复群昵称
            await this.deps.nicknameService.autoSetGroupNickname(
              session,
              mcInfo,
              bind.buidUsername,
              bind.buidUid,
              bind.qqId,
              targetGroupId
            )
            fixedCount++

            const expectedFormat = `${bind.buidUsername}（ID:${mcInfo || '未绑定'}）`
            results.push(`✅ ${bind.qqId}: "${currentNickname}" → "${expectedFormat}"`)

            // 添加延迟避免频率限制
            await new Promise(resolve => setTimeout(resolve, 500))
          } else {
            results.push(`✓ ${bind.qqId}: 格式正确`)
          }

          // 每处理10个用户发送一次进度
          if (checkedCount % 10 === 0) {
            await this.deps.sendMessage(session, [
              h.text(
                `进度: ${checkedCount}/${usersWithBuid.length} | 修复: ${fixedCount} | 错误: ${errorCount}`
              )
            ])
          }
        } catch (error) {
          errorCount++
          results.push(`❌ ${bind.qqId}: 处理出错 - ${error.message}`)
          this.logger.error('群昵称修复', `处理用户QQ(${bind.qqId})时出错: ${error.message}`)
        }
      }

      // 生成最终报告
      let resultMessage = `🔧 ${groupDisplayText}群昵称修复完成\n共检查${checkedCount}个用户\n✅ 修复: ${fixedCount}个\n❌ 错误: ${errorCount}个`

      if (usersWithBuid.length <= 20) {
        resultMessage += '\n\n详细结果:\n' + results.join('\n')
      } else {
        const fixedResults = results.filter(r => r.includes('→'))
        if (fixedResults.length > 0) {
          resultMessage += '\n\n修复的用户:\n' + fixedResults.slice(0, 10).join('\n')
          if (fixedResults.length > 10) {
            resultMessage += `\n... 还有${fixedResults.length - 10}个用户被修复`
          }
        }
      }

      this.logger.info(
        '群昵称修复',
        `修复完成: 管理员QQ(${normalizedUserId})在${groupDisplayText}检查${checkedCount}个用户，修复${fixedCount}个，错误${errorCount}个`
      )
      return this.deps.sendMessage(session, [h.text(resultMessage)])
    } catch (error) {
      const normalizedUserId = this.deps.normalizeQQId(session.userId)
      this.logger.error('群昵称修复', `QQ(${normalizedUserId})执行群昵称修复失败: ${error.message}`)
      return this.deps.sendMessage(session, [h.text(this.deps.getFriendlyErrorMessage(error))])
    }
  }

  /**
   * 清除提醒冷却
   */
  private async handleClearReminder(session: Session, target?: string): Promise<void> {
    try {
      const normalizedUserId = this.deps.normalizeQQId(session.userId)

      // 检查权限
      if (!(await this.deps.isAdmin(session.userId))) {
        this.logger.warn('清除冷却', `权限不足: QQ(${normalizedUserId})不是管理员`)
        return this.deps.sendMessage(session, [h.text('只有管理员才能清除提醒冷却和次数')])
      }

      // 注意: reminderCooldown 需要从外部传入或在 deps 中提供
      // 这里简化处理，只更新数据库

      if (target) {
        const normalizedTargetId = this.deps.normalizeQQId(target)
        const bind = await this.deps.databaseService.getMcBindByQQId(normalizedTargetId)
        if (bind) {
          await this.repos.mcidbind.update(normalizedTargetId, { reminderCount: 0 })
        }
        this.logger.info(
          '清除冷却',
          `管理员QQ(${normalizedUserId})清除了QQ(${normalizedTargetId})的提醒次数`
        )
        return this.deps.sendMessage(session, [
          h.text(`已清除用户 ${normalizedTargetId} 的随机提醒次数`)
        ])
      } else {
        const allBinds = await this.repos.mcidbind.findAll()
        for (const bind of allBinds) {
          await this.repos.mcidbind.update(bind.qqId, { reminderCount: 0 })
        }
        this.logger.info('清除冷却', `管理员QQ(${normalizedUserId})清除了所有用户的提醒次数`)
        return this.deps.sendMessage(session, [h.text('已清除所有用户的随机提醒次数')])
      }
    } catch (error) {
      const normalizedUserId = this.deps.normalizeQQId(session.userId)
      this.logger.error('清除冷却', `QQ(${normalizedUserId})清除提醒冷却失败: ${error.message}`)
      return this.deps.sendMessage(session, [h.text(this.deps.getFriendlyErrorMessage(error))])
    }
  }

  /**
   * 导出群数据
   */
  private async handleExport(session: Session, groupId: string): Promise<void> {
    try {
      const normalizedUserId = this.deps.normalizeQQId(session.userId)

      // 检查权限
      if (!(await this.deps.isAdmin(session.userId))) {
        this.logger.warn('数据导出', `权限不足: QQ(${normalizedUserId})不是管理员`)
        return this.deps.sendMessage(session, [h.text('只有管理员才能导出群数据')])
      }

      // 检查是否为私聊
      if (!session.channelId?.startsWith('private:')) {
        this.logger.warn('数据导出', `QQ(${normalizedUserId})尝试在群聊中使用导出命令`)
        return this.deps.sendMessage(session, [h.text('为了数据安全，导出命令仅支持在私聊中使用')])
      }

      // 验证群ID格式
      if (!groupId || !/^\d+$/.test(groupId)) {
        return this.deps.sendMessage(session, [h.text('❌ 群号格式无效，请提供正确的群号')])
      }

      // 检查bot是否在目标群中
      try {
        if (session.bot.internal) {
          await session.bot.internal.getGroupInfo(groupId)
        }
      } catch (error) {
        this.logger.warn('数据导出', `Bot不在群${groupId}中或无法获取群信息`)
        return this.deps.sendMessage(session, [
          h.text(`❌ Bot不在群 ${groupId} 中或无权限操作该群`)
        ])
      }

      this.logger.info('数据导出', `管理员QQ(${normalizedUserId})开始导出群${groupId}的数据`)
      await this.deps.sendMessage(session, [h.text(`📊 开始导出群 ${groupId} 的数据，请稍候...`)])

      try {
        // 导出数据
        const excelBuffer = await this.deps.groupExporter.exportGroupData(session, groupId)
        const fileName = this.deps.groupExporter.getExportFileName(groupId)

        // 先发送成功消息
        await this.deps.sendMessage(session, [
          h.text(`✅ 群 ${groupId} 数据导出完成！正在发送文件...`)
        ])

        // 发送文件
        try {
          const base64Data = excelBuffer.toString('base64')

          if (session.bot.internal) {
            await session.bot.internal.uploadPrivateFile(
              parseInt(normalizedUserId),
              `base64://${base64Data}`,
              fileName
            )

            await this.deps.sendMessage(session, [h.text(`📁 文件已发送: ${fileName}`)])
            this.logger.info('数据导出', `成功发送文件到私聊: ${fileName}`)
          } else {
            throw new Error('Bot不支持内部API调用')
          }
        } catch (fileError) {
          this.logger.error('数据导出', `文件发送失败: ${fileError.message}`)

          // 降级方案：保存文件
          try {
            const filePath = await this.deps.groupExporter.saveExcelFile(excelBuffer, fileName)
            await this.deps.sendMessage(session, [
              h.text(
                `⚠️ 直接发送失败，文件已保存\n文件路径: ${filePath}\n文件名: ${fileName}\n请联系管理员获取文件`
              )
            ])

            // 清理过期文件
            this.deps.groupExporter
              .cleanupOldFiles()
              .catch(err => this.logger.warn('数据导出', `清理临时文件时出错: ${err.message}`))
          } catch (saveError) {
            await this.deps.sendMessage(session, [
              h.text(
                '❌ 文件发送和保存都失败了\n导出数据成功但无法发送文件\n请联系管理员检查Bot配置'
              )
            ])
          }
        }

        this.logger.info(
          '数据导出',
          `管理员QQ(${normalizedUserId})成功导出群${groupId}的数据，文件名: ${fileName}`
        )
      } catch (exportError) {
        this.logger.error('数据导出', `导出群${groupId}数据失败: ${exportError.message}`)
        return this.deps.sendMessage(session, [h.text(`❌ 导出失败: ${exportError.message}`)])
      }
    } catch (error) {
      const normalizedUserId = this.deps.normalizeQQId(session.userId)
      this.logger.error('数据导出', `QQ(${normalizedUserId})导出群数据失败: ${error.message}`)
      return this.deps.sendMessage(session, [h.text(this.deps.getFriendlyErrorMessage(error))])
    }
  }
}
