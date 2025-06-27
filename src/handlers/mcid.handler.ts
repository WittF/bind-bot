import { Context, h } from 'koishi'
import { BaseHandler } from './base.handler'
import { ServiceContainer } from '../container/service-container'
import { Config } from '../types/config'

/**
 * MC绑定命令处理器
 * 处理所有MC相关的命令操作
 */
export class McidHandler extends BaseHandler {
  constructor(ctx: Context, config: Config, services: ServiceContainer) {
    super(ctx, config, services)
  }

  registerCommands(): void {
    const cmd = this.ctx.command('mcid', 'Minecraft 账号绑定管理')

    // 查询MC账号命令
    cmd.subcommand('.query [target:string]', '查询用户绑定的MC账号')
      .action(async ({ session }, target) => this.handleQuery(session, target))

    // 绑定MC账号命令
    cmd.subcommand('.bind <username:string> [target:string]', '绑定MC账号')
      .action(async ({ session }, username, target) => this.handleBind(session, username, target))

    // 修改MC账号命令
    cmd.subcommand('.change <username:string> [target:string]', '修改绑定的MC账号')
      .action(async ({ session }, username, target) => this.handleChange(session, username, target))

    // 解绑MC账号命令
    cmd.subcommand('.unbind [target:string]', '[管理员]解绑MC账号')
      .action(async ({ session }, target) => this.handleUnbind(session, target))

    // 通过MC用户名查询绑定QQ账号命令
    cmd.subcommand('.finduser <username:string>', '[管理员]通过MC用户名查询绑定的QQ账号')
      .action(async ({ session }, username) => this.handleFindUser(session, username))
  }

  private async handleQuery(session: any, target?: string): Promise<void> {
    try {
      const userId = session.userId
      const targetUserId = target ? this.database.normalizeQQId(target) : this.database.normalizeQQId(userId)

      if (target && !targetUserId) {
        await this.sendMessage(session, [h.text('❌ 目标用户ID无效\n请提供有效的QQ号或使用@功能选择用户')])
        return
      }

      const bind = await this.database.getMcBindByQQId(targetUserId)
      
      if (!bind || !bind.mcUsername || bind.mcUsername.startsWith('_temp_')) {
        const promptText = target ? 
          `该用户尚未绑定MC账号` : 
          `您尚未绑定MC账号，请使用 ${this.formatCommand('mcid bind <用户名>')} 进行绑定`
        await this.sendMessage(session, [h.text(promptText)])
        return
      }

      // 检查并更新用户名（如果变更）
      const updatedBind = await this.checkAndUpdateUsername(bind)
      
      // 构建响应消息
      let responseText = target ? 
        `用户 ${targetUserId} 的MC账号信息：` : 
        `您的MC账号信息：`
      responseText += `\n用户名: ${updatedBind.mcUsername}\nUUID: ${this.validation.formatUuid(updatedBind.mcUuid)}`

      // 添加白名单信息
      if (updatedBind.whitelist && updatedBind.whitelist.length > 0) {
        const serverList = updatedBind.whitelist.map((serverId, index) => {
          const server = this.getServerConfigById(serverId)
          const serverName = server ? server.name : `未知服务器(${serverId})`
          return `${index + 1}. ${serverName}`
        }).join('\n')
        responseText += `\n\n已加入以下服务器的白名单:\n${serverList}`
      } else {
        responseText += '\n\n未加入任何服务器的白名单'
      }

      // 添加B站账号信息
      if (updatedBind.buidUid) {
        responseText += `\n\nB站账号: ${updatedBind.buidUsername} (UID: ${updatedBind.buidUid})`
        if (updatedBind.guardLevel > 0) {
          responseText += `\n舰长等级: ${updatedBind.guardLevelText}`
        }
      } else {
        responseText += '\n\n尚未绑定B站账号'
      }

      const messageElements = [h.text(responseText)]
      
      // 添加头像（如果配置启用）
      if (this.config.showAvatar) {
        if (this.config.showMcSkin) {
          const skinUrl = this.getStarlightSkinUrl(updatedBind.mcUsername)
          if (skinUrl) messageElements.push(h.image(skinUrl))
        } else {
          const avatarUrl = this.getCrafatarUrl(updatedBind.mcUuid)
          if (avatarUrl) messageElements.push(h.image(avatarUrl))
        }
      }

      await this.sendMessage(session, messageElements)
    } catch (error) {
      await this.sendMessage(session, [h.text(this.getFriendlyErrorMessage(error))])
    }
  }

  private async handleBind(session: any, username: string, target?: string): Promise<void> {
    try {
      const userId = session.userId

      // 验证用户名格式
      if (!this.validation.isValidMcUsername(username)) {
        await this.sendMessage(session, [h.text('请提供有效的Minecraft用户名（3-16位字母、数字、下划线）')])
        return
      }

      // 验证用户名是否存在
      const profile = await this.mojang.validateUsername(username)
      if (!profile) {
        await this.sendMessage(session, [h.text(`无法验证用户名: ${username}，该用户可能不存在`)])
        return
      }

      username = profile.name // 使用Mojang返回的正确大小写
      const uuid = profile.id

      // 处理为其他用户绑定（管理员功能）
      if (target) {
        if (!await this.isAdmin(userId)) {
          await this.sendMessage(session, [h.text('只有管理员才能为其他用户绑定MC账号')])
          return
        }

        const targetUserId = this.database.normalizeQQId(target)
        if (!targetUserId) {
          await this.sendMessage(session, [h.text('❌ 目标用户ID无效')])
          return
        }

        // 检查用户名是否已被绑定
        if (await this.database.checkUsernameExists(username, target)) {
          await this.sendMessage(session, [h.text(`用户名 ${username} 已被其他用户绑定`)])
          return
        }

        const bindResult = await this.database.createOrUpdateMcBind(target, username, uuid)
        if (bindResult) {
          this.logOperation('为他人绑定MC账号', userId, true, `为${targetUserId}绑定: ${username}`)
          await this.sendMessage(session, [h.text(`已成功为用户 ${targetUserId} 绑定MC账号\n用户名: ${username}`)])
        } else {
          await this.sendMessage(session, [h.text('绑定失败，数据库操作出错')])
        }
        return
      }

      // 为自己绑定MC账号
      const normalizedUserId = this.database.normalizeQQId(userId)
      const selfBind = await this.database.getMcBindByQQId(normalizedUserId)

      // 检查是否已绑定且不在冷却期
      if (selfBind && selfBind.mcUsername && !selfBind.mcUsername.startsWith('_temp_')) {
        if (!await this.isAdmin(userId)) {
          const cooldownResult = await this.validation.checkUserCooldown(userId, this.database)
          if (!cooldownResult.canOperate) {
            await this.sendMessage(session, [h.text(cooldownResult.message || '在冷却期内，无法修改绑定')])
            return
          }
        }
        await this.sendMessage(session, [h.text(`您已绑定MC账号: ${selfBind.mcUsername}，如需修改请使用 ${this.formatCommand('mcid change')} 命令`)])
        return
      }

      // 检查用户名是否已被绑定
      if (await this.database.checkUsernameExists(username)) {
        await this.sendMessage(session, [h.text(`用户名 ${username} 已被其他用户绑定`)])
        return
      }

      // 创建绑定
      const bindResult = await this.database.createOrUpdateMcBind(userId, username, uuid)
      if (bindResult) {
        this.logOperation('绑定MC账号', normalizedUserId, true, `绑定: ${username}`)
        await this.sendMessage(session, [h.text(`已成功绑定MC账号\n用户名: ${username}`)])
      } else {
        await this.sendMessage(session, [h.text('绑定失败，数据库操作出错')])
      }

    } catch (error) {
      await this.sendMessage(session, [h.text(this.getFriendlyErrorMessage(error))])
    }
  }

  private async handleChange(session: any, username: string, target?: string): Promise<void> {
    // 实现类似bind的逻辑，但要求用户已有绑定
    // 这里简化实现，实际应该检查现有绑定等
    await this.sendMessage(session, [h.text('功能开发中...')])
  }

  private async handleUnbind(session: any, target?: string): Promise<void> {
    // 实现解绑逻辑
    await this.sendMessage(session, [h.text('功能开发中...')])
  }

  private async handleFindUser(session: any, username: string): Promise<void> {
    // 实现通过用户名查找QQ的逻辑
    await this.sendMessage(session, [h.text('功能开发中...')])
  }

  // 辅助方法
  private async checkAndUpdateUsername(bind: any): Promise<any> {
    // 简化实现，实际应该调用Mojang API检查用户名变更
    return bind
  }

  private getServerConfigById(serverId: string): any {
    return this.config.servers?.find(s => s.id === serverId && s.enabled !== false)
  }

  private getCrafatarUrl(uuid: string): string | null {
    return uuid ? `https://crafatar.com/avatars/${uuid.replace(/-/g, '')}` : null
  }

  private getStarlightSkinUrl(username: string): string | null {
    return username ? `https://starlightskins.lunareclipse.studio/render/default/${username}/full` : null
  }
} 