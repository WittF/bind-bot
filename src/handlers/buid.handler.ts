import { Context, h } from 'koishi'
import { BaseHandler } from './base.handler'
import { ServiceContainer } from '../container/service-container'
import { Config } from '../types/config'

/**
 * B站UID绑定命令处理器
 * 处理所有B站相关的命令操作
 */
export class BuidHandler extends BaseHandler {
  constructor(ctx: Context, config: Config, services: ServiceContainer) {
    super(ctx, config, services)
  }

  registerCommands(): void {
    const buidCmd = this.ctx.command('buid', 'B站UID绑定管理')

    // 查询BUID绑定命令
    buidCmd.subcommand('.query [target:string]', '查询用户绑定的BUID')
      .action(async ({ session }, target) => this.handleQuery(session, target))

    // 绑定BUID命令
    buidCmd.subcommand('.bind <uid:string> [target:string]', '绑定B站UID')
      .action(async ({ session }, uid, target) => this.handleBind(session, uid, target))

    // 通过BUID查询绑定QQ账号命令
    buidCmd.subcommand('.finduser <uid:string>', '[管理员]通过BUID查询绑定的QQ账号')
      .action(async ({ session }, uid) => this.handleFindUser(session, uid))
  }

  private async handleQuery(session: any, target?: string): Promise<void> {
    try {
      const userId = session.userId
      const targetUserId = target ? this.database.normalizeQQId(target) : this.database.normalizeQQId(userId)

      const bind = await this.database.getMcBindByQQId(targetUserId)
      
      if (!bind || !bind.buidUid) {
        const promptText = target ? 
          `该用户尚未绑定B站账号` : 
          `您尚未绑定B站账号，请使用 ${this.formatCommand('buid bind <UID>')} 进行绑定`
        await this.sendMessage(session, [h.text(promptText)])
        return
      }

      // 刷新B站数据
      try {
        const buidUser = await this.buid.validateBUID(bind.buidUid)
        if (buidUser) {
          await this.buid.updateBuidInfoOnly(bind.qqId, buidUser)
          // 重新获取最新绑定
          const refreshedBind = await this.database.getMcBindByQQId(targetUserId)
          if (refreshedBind) {
            bind.buidUsername = refreshedBind.buidUsername
            bind.guardLevel = refreshedBind.guardLevel
            bind.guardLevelText = refreshedBind.guardLevelText
            bind.medalName = refreshedBind.medalName
            bind.medalLevel = refreshedBind.medalLevel
          }
        }
      } catch (refreshError) {
        // 刷新失败不影响查询
      }

      let userInfo = target ? 
        `用户 ${targetUserId} 的B站账号信息：` : 
        `您的B站账号信息：`
      userInfo += `\nB站UID: ${bind.buidUid}\n用户名: ${bind.buidUsername}`

      if (bind.guardLevel > 0) {
        userInfo += `\n舰长等级: ${bind.guardLevelText} (${bind.guardLevel})`
      }
      if (bind.medalName) {
        userInfo += `\n粉丝牌: ${bind.medalName} Lv.${bind.medalLevel}`
      }

      const messageElements = [h.text(userInfo)]
      
      // 添加B站头像
      if (this.config.showAvatar && bind.buidUid) {
        messageElements.push(h.image(`https://workers.vrp.moe/bilibili/avatar/${bind.buidUid}?size=160`))
      }

      await this.sendMessage(session, messageElements)
    } catch (error) {
      await this.sendMessage(session, [h.text(this.getFriendlyErrorMessage(error))])
    }
  }

  private async handleBind(session: any, uid: string, target?: string): Promise<void> {
    try {
      const userId = session.userId

      // 解析UID格式
      let actualUid = uid
      if (uid.toLowerCase().startsWith('uid:')) {
        actualUid = uid.substring(4)
      }

      // 验证UID格式
      if (!this.validation.isValidBuidUid(actualUid)) {
        await this.sendMessage(session, [h.text('请提供有效的B站UID（纯数字或UID:数字格式）')])
        return
      }

      // 处理为其他用户绑定（管理员功能）
      if (target) {
        if (!await this.isAdmin(userId)) {
          await this.sendMessage(session, [h.text('只有管理员才能为其他用户绑定BUID')])
          return
        }

        const targetUserId = this.database.normalizeQQId(target)
        if (!targetUserId) {
          await this.sendMessage(session, [h.text('❌ 目标用户ID无效')])
          return
        }

        // 检查UID是否已被绑定
        if (await this.buid.checkBuidExists(actualUid, target)) {
          await this.sendMessage(session, [h.text(`UID ${actualUid} 已被其他用户绑定`)])
          return
        }

        // 验证UID是否存在
        const buidUser = await this.buid.validateBUID(actualUid)
        if (!buidUser) {
          await this.sendMessage(session, [h.text(`无法验证UID: ${actualUid}，该用户可能不存在`)])
          return
        }

        const bindResult = await this.buid.createOrUpdateBuidBind(target, buidUser)
        if (bindResult) {
          this.logOperation('为他人绑定BUID', userId, true, `为${targetUserId}绑定: ${actualUid}`)
          await this.sendMessage(session, [h.text(`已成功为用户 ${targetUserId} 绑定B站账号\n用户名: ${buidUser.username}`)])
        } else {
          await this.sendMessage(session, [h.text('绑定失败，数据库操作出错')])
        }
        return
      }

      // 为自己绑定BUID
      const normalizedUserId = this.database.normalizeQQId(userId)
      const selfBind = await this.database.getMcBindByQQId(normalizedUserId)

      // 检查是否已绑定且不在冷却期
      if (selfBind && selfBind.buidUid) {
        if (!await this.isAdmin(userId)) {
          const cooldownResult = await this.validation.checkUserCooldown(userId, this.database)
          if (!cooldownResult.canOperate) {
            await this.sendMessage(session, [h.text(cooldownResult.message || '在冷却期内，无法修改绑定')])
            return
          }
        }
      }

      // 检查UID是否已被绑定
      if (await this.buid.checkBuidExists(actualUid)) {
        await this.sendMessage(session, [h.text(`UID ${actualUid} 已被其他用户绑定`)])
        return
      }

      // 验证UID是否存在
      const buidUser = await this.buid.validateBUID(actualUid)
      if (!buidUser) {
        await this.sendMessage(session, [h.text(`无法验证UID: ${actualUid}，该用户可能不存在`)])
        return
      }

      // 创建绑定
      const bindResult = await this.buid.createOrUpdateBuidBind(userId, buidUser)
      if (bindResult) {
        this.logOperation('绑定BUID', normalizedUserId, true, `绑定: ${actualUid}`)

        let responseText = `成功绑定B站账号！\nB站UID: ${buidUser.uid}\n用户名: ${buidUser.username}`
        if (buidUser.guard_level > 0) {
          responseText += `\n舰长等级: ${buidUser.guard_level_text}`
        }
        if (buidUser.medal) {
          responseText += `\n粉丝牌: ${buidUser.medal.name} Lv.${buidUser.medal.level}`
        }

        const messageElements = [h.text(responseText)]
        
        // 添加B站头像
        if (this.config.showAvatar) {
          messageElements.push(h.image(`https://workers.vrp.moe/bilibili/avatar/${buidUser.uid}?size=160`))
        }

        await this.sendMessage(session, messageElements)
      } else {
        await this.sendMessage(session, [h.text('绑定失败，数据库操作出错')])
      }

    } catch (error) {
      await this.sendMessage(session, [h.text(this.getFriendlyErrorMessage(error))])
    }
  }

  private async handleFindUser(session: any, uid: string): Promise<void> {
    try {
      const userId = session.userId

      // 检查权限
      if (!await this.isAdmin(userId)) {
        await this.sendMessage(session, [h.text('只有管理员才能使用此命令')])
        return
      }

      // 解析UID格式
      let actualUid = uid
      if (uid.toLowerCase().startsWith('uid:')) {
        actualUid = uid.substring(4)
      }

      // 验证UID格式
      if (!this.validation.isValidBuidUid(actualUid)) {
        await this.sendMessage(session, [h.text('请提供有效的B站UID')])
        return
      }

      // 查询绑定信息
      const bind = await this.buid.getBuidBindByBuid(actualUid)
      
      if (!bind) {
        await this.sendMessage(session, [h.text(`未找到绑定B站UID"${actualUid}"的QQ账号`)])
        return
      }

      let adminInfo = `B站UID"${bind.buidUid}"绑定信息:\nQQ号: ${bind.qqId}\n用户名: ${bind.buidUsername}`
      
      if (bind.guardLevel > 0) {
        adminInfo += `\n舰长等级: ${bind.guardLevelText} (${bind.guardLevel})`
      }
      if (bind.medalName) {
        adminInfo += `\n粉丝牌: ${bind.medalName} Lv.${bind.medalLevel}`
      }
      adminInfo += `\n绑定时间: ${bind.lastModified ? new Date(bind.lastModified).toLocaleString() : '未知'}`

      await this.sendMessage(session, [h.text(adminInfo)])
    } catch (error) {
      await this.sendMessage(session, [h.text(this.getFriendlyErrorMessage(error))])
    }
  }
} 