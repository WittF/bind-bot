import { Context, Session, h } from 'koishi'
import { Config } from '../types/config'
import { DatabaseService } from '../services/database.service'
import { MojangService } from '../services/mojang.service'
import { BuidService } from '../services/buid.service'
import { MessageService } from '../services/message.service'
import { ValidationService } from '../services/validation.service'
import { NicknameService } from '../services/nickname.service'
import { ErrorService } from '../services/error.service'

export class McidCommandHandler {
  constructor(
    private ctx: Context,
    private config: Config,
    private databaseService: DatabaseService,
    private mojangService: MojangService,
    private buidService: BuidService,
    private messageService: MessageService,
    private validationService: ValidationService,
    private nicknameService: NicknameService,
    private errorService: ErrorService
  ) {}

  /**
   * 注册所有MCID相关命令
   */
  registerCommands() {
    const cmd = this.ctx.command('mcid', 'Minecraft 账号绑定管理')

    // 查询MC账号命令
    cmd.subcommand('.query [target:string]', '查询用户绑定的MC账号')
      .action(async ({ session }, target) => this.handleQuery(session, target))

    // 通过MC用户名查询绑定QQ账号命令
    cmd.subcommand('.finduser <username:string>', '[管理员]通过MC用户名查询绑定的QQ账号')
      .action(async ({ session }, username) => this.handleFindUser(session, username))

    // 绑定MC账号命令
    cmd.subcommand('.bind <username:string> [target:string]', '绑定MC账号')
      .action(async ({ session }, username, target) => this.handleBind(session, username, target))

    // 修改MC账号命令
    cmd.subcommand('.change <username:string> [target:string]', '修改绑定的MC账号')
      .action(async ({ session }, username, target) => this.handleChange(session, username, target))

    // 解绑MC账号命令
    cmd.subcommand('.unbind [target:string]', '[管理员]解绑MC账号')
      .action(async ({ session }, target) => this.handleUnbind(session, target))

    // 管理员管理命令
    cmd.subcommand('.admin <target:string>', '[主人]将用户设为管理员')
      .action(async ({ session }, target) => this.handleSetAdmin(session, target))

    // 撤销管理员命令
    cmd.subcommand('.unadmin <target:string>', '[主人]撤销用户的管理员权限')
      .action(async ({ session }, target) => this.handleUnsetAdmin(session, target))

    // 列出所有管理员命令
    cmd.subcommand('.adminlist', '[主人]列出所有管理员')
      .action(async ({ session }) => this.handleAdminList(session))

    // 统计数据命令
    cmd.subcommand('.stats', '[管理员]查看数据库统计信息')
      .action(async ({ session }) => this.handleStats(session))

    // 检查和修复群昵称命令
    cmd.subcommand('.fixnicknames', '[管理员]检查并修复所有用户的群昵称格式')
      .action(async ({ session }) => this.handleFixNicknames(session))

    // 清除提醒冷却和次数命令
    cmd.subcommand('.clearreminder [target:string]', '[管理员]清除用户的随机提醒冷却时间和提醒次数')
      .action(async ({ session }, target) => this.handleClearReminder(session, target))
  }

  /**
   * 处理查询MC账号命令
   */
  private async handleQuery(session: Session, target?: string): Promise<void> {
    try {
      const userId = this.messageService.normalizeQQId(session.userId)

      // 如果指定了目标用户
      if (target) {
        const targetId = this.messageService.normalizeQQId(target)
        
        if (!targetId) {
          if (target.startsWith('@')) {
            return this.messageService.sendMessage(session, [h.text('❌ 请使用真正的@功能，而不是手动输入@符号\n正确做法：点击或长按用户头像选择@功能')])
          }
          return this.messageService.sendMessage(session, [h.text('❌ 目标用户ID无效\n请提供有效的QQ号或使用@功能选择用户')])
        }
        
        const targetBind = await this.databaseService.getMcBindByQQId(targetId)
        if (!targetBind || !targetBind.mcUsername || targetBind.mcUsername.startsWith('_temp_')) {
          // 检查是否绑定了B站账号
          if (targetBind && targetBind.buidUid) {
            // 刷新B站数据
            const buidUser = await this.buidService.validateBUID(targetBind.buidUid)
            if (buidUser) {
              await this.buidService.updateBuidInfoOnly(targetBind.qqId, buidUser, this.databaseService)
              const refreshedBind = await this.databaseService.getMcBindByQQId(targetId)
              if (refreshedBind) {
                let buidInfo = `该用户尚未绑定MC账号\n\nB站账号信息：\nB站UID: ${refreshedBind.buidUid}\n用户名: ${refreshedBind.buidUsername}`
                if (refreshedBind.guardLevel > 0) {
                  buidInfo += `\n舰长等级: ${refreshedBind.guardLevelText} (${refreshedBind.guardLevel})`
                  if (refreshedBind.maxGuardLevel > 0 && refreshedBind.maxGuardLevel < refreshedBind.guardLevel) {
                    buidInfo += `\n历史最高: ${refreshedBind.maxGuardLevelText} (${refreshedBind.maxGuardLevel})`
                  }
                } else if (refreshedBind.maxGuardLevel > 0) {
                  buidInfo += `\n历史舰长: ${refreshedBind.maxGuardLevelText} (${refreshedBind.maxGuardLevel})`
                }
                if (refreshedBind.medalName) {
                  buidInfo += `\n粉丝牌: ${refreshedBind.medalName} Lv.${refreshedBind.medalLevel}`
                }
                
                const messageElements = [h.text(buidInfo)]
                if (this.config?.showAvatar) {
                  messageElements.push(h.image(`https://workers.vrp.moe/bilibili/avatar/${refreshedBind.buidUid}?size=160`))
                }
                
                return this.messageService.sendMessage(session, messageElements)
              }
            }
          }
          
          return this.messageService.sendMessage(session, [h.text(`该用户尚未绑定MC账号`)])
        }
        
        // 检查并更新用户名
        const updatedBind = await this.checkAndUpdateUsername(targetBind)
        
        // 构建消息内容
        const displayUsername = updatedBind.mcUsername && !updatedBind.mcUsername.startsWith('_temp_') ? updatedBind.mcUsername : '未绑定'
        const formattedUuid = this.mojangService.formatUuid(updatedBind.mcUuid)
        
        // 获取白名单信息
        let whitelistInfo = ''
        if (updatedBind.whitelist && updatedBind.whitelist.length > 0) {
          const circledNumbers = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩']
          const serverList = updatedBind.whitelist.map((serverId, index) => {
            const server = this.getServerConfigById(serverId)
            if (!server) {
              const disabledServer = this.config.servers?.find(s => s.id === serverId)
              if (disabledServer && disabledServer.enabled === false) {
                return `${index < circledNumbers.length ? circledNumbers[index] : (index+1)} ${disabledServer.name} [已停用]`
              }
              return `${index < circledNumbers.length ? circledNumbers[index] : (index+1)} 未知服务器(ID: ${serverId})`
            }
            
            const circledNumber = index < circledNumbers.length ? circledNumbers[index] : `${index+1}`
            let info = `${circledNumber} ${server.name}`
            if (server.displayAddress && server.displayAddress.trim()) {
              info += `\n   地址: ${server.displayAddress}`
            }
            return info
          }).join('\n')
          
          whitelistInfo = `\n已加入以下服务器的白名单:\n${serverList}`
        } else {
          whitelistInfo = '\n未加入任何服务器的白名单'
        }
        
        // 构建B站信息
        let buidInfo = ''
        let buidAvatar = null
        if (updatedBind.buidUid) {
          buidInfo = `B站账号信息：\nB站UID: ${updatedBind.buidUid}\n用户名: ${updatedBind.buidUsername}`
          if (updatedBind.guardLevel > 0) {
            buidInfo += `\n舰长等级: ${updatedBind.guardLevelText} (${updatedBind.guardLevel})`
          }
          if (updatedBind.medalName) {
            buidInfo += `\n粉丝牌: ${updatedBind.medalName} Lv.${updatedBind.medalLevel}`
          }
          if (this.config?.showAvatar) {
            buidAvatar = h.image(`https://workers.vrp.moe/bilibili/avatar/${updatedBind.buidUid}?size=160`)
          }
        } else {
          buidInfo = `该用户尚未绑定B站账号`
        }
        
        // 设置群昵称
        if (updatedBind.buidUid && updatedBind.buidUsername) {
          const mcName = updatedBind.mcUsername && !updatedBind.mcUsername.startsWith('_temp_') ? updatedBind.mcUsername : null
          await this.nicknameService.autoSetGroupNickname(session, mcName, updatedBind.buidUsername, targetId)
        }
        
        // 获取MC头图
        let mcAvatarUrl = null
        if (this.config?.showAvatar) {
          if (this.config?.showMcSkin) {
            mcAvatarUrl = this.mojangService.getStarlightSkinUrl(updatedBind.mcUsername)
          } else {
            mcAvatarUrl = this.mojangService.getCrafatarUrl(updatedBind.mcUuid)
          }
        }
        
        const messageElements = [
          h.text(`用户 ${targetId} 的MC账号信息：\n用户名: ${displayUsername}\nUUID: ${formattedUuid}${whitelistInfo}`),
          ...(mcAvatarUrl ? [h.image(mcAvatarUrl)] : []),
          h.text(`\n${buidInfo}`),
          ...(buidAvatar ? [buidAvatar] : [])
        ]
        
        return this.messageService.sendMessage(session, messageElements)
      }
      
      // 查询自己的MC账号
      const selfBind = await this.databaseService.getMcBindByQQId(userId)
      
      if (!selfBind || !selfBind.mcUsername || selfBind.mcUsername.startsWith('_temp_')) {
        // 检查是否绑定了B站账号
        if (selfBind && selfBind.buidUid) {
          const buidUser = await this.databaseService.getBuidUser(selfBind.buidUid)
          if (buidUser) {
            await this.databaseService.updateBuidInfoOnly(selfBind.qqId, buidUser)
            const refreshedBind = await this.databaseService.getMcBindByQQId(userId)
            if (refreshedBind) {
              let buidInfo = `您尚未绑定MC账号\n\nB站账号信息：\nB站UID: ${refreshedBind.buidUid}\n用户名: ${refreshedBind.buidUsername}`
              if (refreshedBind.guardLevel > 0) {
                buidInfo += `\n舰长等级: ${refreshedBind.guardLevelText} (${refreshedBind.guardLevel})`
                if (refreshedBind.maxGuardLevel > 0 && refreshedBind.maxGuardLevel < refreshedBind.guardLevel) {
                  buidInfo += `\n历史最高: ${refreshedBind.maxGuardLevelText} (${refreshedBind.maxGuardLevel})`
                }
              } else if (refreshedBind.maxGuardLevel > 0) {
                buidInfo += `\n历史舰长: ${refreshedBind.maxGuardLevelText} (${refreshedBind.maxGuardLevel})`
              }
              if (refreshedBind.medalName) {
                buidInfo += `\n粉丝牌: ${refreshedBind.medalName} Lv.${refreshedBind.medalLevel}`
              }
              
              buidInfo += `\n\n💡 您可以使用 ${this.messageService.formatCommand('mcid bind <用户名>')} 绑定MC账号`
              
              const messageElements = [h.text(buidInfo)]
              if (this.config?.showAvatar) {
                messageElements.push(h.image(`https://workers.vrp.moe/bilibili/avatar/${refreshedBind.buidUid}?size=160`))
              }
              
              return this.messageService.sendMessage(session, messageElements)
            }
          }
        }
        
        return this.messageService.sendMessage(session, [h.text(`您尚未绑定MC账号，请使用 ${this.messageService.formatCommand('mcid bind <用户名>')} 进行绑定`)])
      }
      
      // 检查并更新用户名
      const updatedBind = await this.mojangService.checkAndUpdateUsername(selfBind)
      
      // 构建消息内容
      const displayUsername = updatedBind.mcUsername && !updatedBind.mcUsername.startsWith('_temp_') ? updatedBind.mcUsername : '未绑定'
      const formattedUuid = this.mojangService.formatUuid(updatedBind.mcUuid)
      
      // 获取白名单信息
      let whitelistInfo = ''
      if (updatedBind.whitelist && updatedBind.whitelist.length > 0) {
        const circledNumbers = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩']
        const serverList = updatedBind.whitelist.map((serverId, index) => {
          const server = this.getServerConfigById(serverId)
          if (!server) {
            const disabledServer = this.config.servers?.find(s => s.id === serverId)
            if (disabledServer && disabledServer.enabled === false) {
              return `${index < circledNumbers.length ? circledNumbers[index] : (index+1)} ${disabledServer.name} [已停用]`
            }
            return `${index < circledNumbers.length ? circledNumbers[index] : (index+1)} 未知服务器(ID: ${serverId})`
          }
          
          const circledNumber = index < circledNumbers.length ? circledNumbers[index] : `${index+1}`
          let info = `${circledNumber} ${server.name}`
          if (server.displayAddress && server.displayAddress.trim()) {
            info += `\n   地址: ${server.displayAddress}`
          }
          return info
        }).join('\n')
        
        whitelistInfo = `\n已加入以下服务器的白名单:\n${serverList}`
      } else {
        whitelistInfo = '\n未加入任何服务器的白名单'
      }
      
      // 构建B站信息
      let buidInfo = ''
      let buidAvatar = null
      if (updatedBind.buidUid) {
        buidInfo = `B站账号信息：\nB站UID: ${updatedBind.buidUid}\n用户名: ${updatedBind.buidUsername}`
        if (updatedBind.guardLevel > 0) {
          buidInfo += `\n舰长等级: ${updatedBind.guardLevelText} (${updatedBind.guardLevel})`
          if (updatedBind.maxGuardLevel > 0 && updatedBind.maxGuardLevel < updatedBind.guardLevel) {
            buidInfo += `\n历史最高: ${updatedBind.maxGuardLevelText} (${updatedBind.maxGuardLevel})`
          }
        } else if (updatedBind.maxGuardLevel > 0) {
          buidInfo += `\n历史舰长: ${updatedBind.maxGuardLevelText} (${updatedBind.maxGuardLevel})`
        }
        if (updatedBind.medalName) {
          buidInfo += `\n粉丝牌: ${updatedBind.medalName} Lv.${updatedBind.medalLevel}`
        }
        if (this.config?.showAvatar) {
          buidAvatar = h.image(`https://workers.vrp.moe/bilibili/avatar/${updatedBind.buidUid}?size=160`)
        }
      } else {
        buidInfo = `您尚未绑定B站账号，使用 ${this.messageService.formatCommand('buid bind <B站UID>')} 进行绑定`
      }
      
      // 设置群昵称
      if (updatedBind.buidUid && updatedBind.buidUsername) {
        const mcName = updatedBind.mcUsername && !updatedBind.mcUsername.startsWith('_temp_') ? updatedBind.mcUsername : null
        await this.nicknameService.autoSetGroupNickname(session, mcName, updatedBind.buidUsername)
      }
      
      // 获取MC头图
      let mcAvatarUrl = null
      if (this.config?.showAvatar) {
        if (this.config?.showMcSkin) {
          mcAvatarUrl = this.mojangService.getStarlightSkinUrl(updatedBind.mcUsername)
        } else {
          mcAvatarUrl = this.mojangService.getCrafatarUrl(updatedBind.mcUuid)
        }
      }
      
      const messageElements = [
        h.text(`您的MC账号信息：\n用户名: ${displayUsername}\nUUID: ${formattedUuid}${whitelistInfo}`),
        ...(mcAvatarUrl ? [h.image(mcAvatarUrl)] : []),
        h.text(`\n${buidInfo}`),
        ...(buidAvatar ? [buidAvatar] : [])
      ]
      
      return this.messageService.sendMessage(session, messageElements)
    } catch (error) {
      return this.messageService.sendMessage(session, [h.text(this.errorService.getUserFacingErrorMessage(error.message))])
    }
  }

  /**
   * 处理通过MC用户名查询绑定QQ账号命令
   */
  private async handleFindUser(session: Session, username: string): Promise<void> {
    try {
      const userId = this.messageService.normalizeQQId(session.userId)
      
      // 检查权限
      if (!await this.validationService.isAdmin(session.userId)) {
        return this.messageService.sendMessage(session, [h.text('只有管理员才能使用此命令')])
      }
      
      if (!username) {
        return this.messageService.sendMessage(session, [h.text('请提供要查询的MC用户名')])
      }
      
      const bind = await this.databaseService.getMcBindByUsername(username)
      
      if (!bind || !bind.qqId) {
        return this.messageService.sendMessage(session, [h.text(`未找到绑定MC用户名"${username}"的QQ账号`)])
      }
      
      // 获取MC头图
      let mcAvatarUrl = null
      if (this.config?.showAvatar) {
        if (this.config?.showMcSkin) {
          mcAvatarUrl = this.mojangService.getStarlightSkinUrl(bind.mcUsername)
        } else {
          mcAvatarUrl = this.mojangService.getCrafatarUrl(bind.mcUuid)
        }
      }
      
      const formattedUuid = this.mojangService.formatUuid(bind.mcUuid)
      
      // 管理员信息
      let adminInfo = ''
      if (await this.validationService.isAdmin(session.userId)) {
        if (bind.whitelist && bind.whitelist.length > 0) {
          const serverList = bind.whitelist.map(serverId => {
            const server = this.getServerConfigById(serverId)
            return server ? server.name : `未知服务器(${serverId})`
          }).join('\n- ')
          
          adminInfo = `\n\n白名单服务器:\n- ${serverList}`
        } else {
          adminInfo = '\n\n未加入任何服务器白名单'
        }
        
        adminInfo += `\n绑定时间: ${bind.lastModified ? new Date(bind.lastModified).toLocaleString() : '未知'}`
        adminInfo += `\n管理员权限: ${bind.isAdmin ? '是' : '否'}`
      }
      
      const displayUsername = bind.mcUsername && !bind.mcUsername.startsWith('_temp_') ? bind.mcUsername : '未绑定'
      return this.messageService.sendMessage(session, [
        h.text(`MC用户名"${displayUsername}"绑定信息:\nQQ号: ${bind.qqId}\nUUID: ${formattedUuid}${adminInfo}`),
        ...(mcAvatarUrl ? [h.image(mcAvatarUrl)] : [])
      ])
    } catch (error) {
      return this.messageService.sendMessage(session, [h.text(this.errorService.getUserFacingErrorMessage(error.message))])
    }
  }

  /**
   * 处理绑定MC账号命令
   */
  private async handleBind(session: Session, username: string, target?: string): Promise<void> {
    try {
      const userId = this.messageService.normalizeQQId(session.userId)
      
      // 检查用户名格式
      if (!username || !/^[a-zA-Z0-9_]{3,16}$/.test(username)) {
        return this.messageService.sendMessage(session, [h.text('请提供有效的Minecraft用户名（3-16位字母、数字、下划线）')])
      }

      // 验证用户名是否存在
      const profile = await this.mojangService.validateUsername(username)
      if (!profile) {
        return this.messageService.sendMessage(session, [h.text(`无法验证用户名: ${username}，该用户可能不存在`)])
      }

      username = profile.name
      const uuid = profile.id

      // 如果指定了目标用户（管理员功能）
      if (target) {
        const targetId = this.messageService.normalizeQQId(target)
        
        if (!targetId) {
          if (target.startsWith('@')) {
            return this.messageService.sendMessage(session, [h.text('❌ 请使用真正的@功能，而不是手动输入@符号\n正确做法：点击或长按用户头像选择@功能')])
          }
          return this.messageService.sendMessage(session, [h.text('❌ 目标用户ID无效\n请提供有效的QQ号或使用@功能选择用户')])
        }
        
        // 检查权限
        if (!await this.validationService.isAdmin(session.userId)) {
          return this.messageService.sendMessage(session, [h.text('只有管理员才能为其他用户绑定MC账号')])
        }

        // 检查用户名是否已被除目标用户以外的其他用户绑定
        if (await this.databaseService.checkUsernameExists(username, target)) {
          return this.messageService.sendMessage(session, [h.text(`用户名 ${username} 已被其他用户绑定`)])
        }

        // 创建或更新绑定记录
        const bindResult = await this.databaseService.createOrUpdateMcBind(target, username, uuid)
        
        if (!bindResult) {
          return this.messageService.sendMessage(session, [h.text(`为用户 ${targetId} 绑定MC账号失败: 数据库操作出错，请联系管理员`)])
        }
        
        // 获取目标用户最新绑定信息，检查B站绑定状态
        let targetBuidStatus = ''
        try {
          const latestTargetBind = await this.databaseService.getMcBindByQQId(targetId)
          if (latestTargetBind && latestTargetBind.buidUid && latestTargetBind.buidUsername) {
            await this.nicknameService.autoSetGroupNickname(session, username, latestTargetBind.buidUsername, targetId)
            targetBuidStatus = '\n✅ 该用户已绑定B站账号，群昵称已更新'
          } else {
            targetBuidStatus = '\n⚠️ 该用户尚未绑定B站账号，建议提醒其使用 buid bind 命令完成B站绑定'
          }
        } catch (renameError) {
          // 群昵称设置失败不影响主流程
        }
        
        // 获取MC头图
        let mcAvatarUrl = null
        if (this.config?.showAvatar) {
          if (this.config?.showMcSkin) {
            mcAvatarUrl = this.mojangService.getStarlightSkinUrl(username)
          } else {
            mcAvatarUrl = this.mojangService.getCrafatarUrl(uuid)
          }
        }
        const formattedUuid = this.mojangService.formatUuid(uuid)
        
        return this.messageService.sendMessage(session, [
          h.text(`已成功为用户 ${targetId} 绑定MC账号\n用户名: ${username}\nUUID: ${formattedUuid}${targetBuidStatus}`),
          ...(mcAvatarUrl ? [h.image(mcAvatarUrl)] : [])
        ])
      }
      
      // 为自己绑定MC账号
      const selfBind = await this.databaseService.getMcBindByQQId(userId)
      if (selfBind && selfBind.mcUsername) {
        // 如果当前绑定的是临时用户名，则允许直接使用bind命令
        const isTempUsername = selfBind.mcUsername.startsWith('_temp_')
        
        if (!isTempUsername) {
          // 检查是否是管理员或是否在冷却时间内
          if (!await this.validationService.isAdmin(session.userId) && !this.validationService.checkCooldown(selfBind.lastModified)) {
            const remainingDays = this.validationService.getRemainingCooldownDays(selfBind.lastModified, this.config.cooldownDays)
            const displayUsername = selfBind.mcUsername && !selfBind.mcUsername.startsWith('_temp_') ? selfBind.mcUsername : '未绑定'
            return this.messageService.sendMessage(session, [h.text(`您已绑定MC账号: ${displayUsername}，如需修改，请在冷却期结束后(还需${remainingDays}天)使用 ${this.messageService.formatCommand('mcid change')} 命令或联系管理员。`)])
          }
          const displayUsername = selfBind.mcUsername && !selfBind.mcUsername.startsWith('_temp_') ? selfBind.mcUsername : '未绑定'
          return this.messageService.sendMessage(session, [h.text(`您已绑定MC账号: ${displayUsername}，如需修改请使用 ${this.messageService.formatCommand('mcid change')} 命令。`)])
        }
      }

      // 检查用户名是否已被绑定
      if (await this.databaseService.checkUsernameExists(username)) {
        return this.messageService.sendMessage(session, [h.text(`用户名 ${username} 已被其他用户绑定`)])
      }

      // 创建新绑定
      const bindResult = await this.databaseService.createOrUpdateMcBind(session.userId, username, uuid)
      
      if (!bindResult) {
        return this.messageService.sendMessage(session, [h.text('绑定失败，数据库操作出错，请联系管理员')])
      }
      
      // 获取最新绑定信息，检查B站绑定状态
      let buidReminder = ''
      try {
        const latestBind = await this.databaseService.getMcBindByQQId(userId)
        if (latestBind && latestBind.buidUid && latestBind.buidUsername) {
          await this.nicknameService.autoSetGroupNickname(session, username, latestBind.buidUsername)
        } else {
          buidReminder = `\n\n💡 提醒：您还未绑定B站账号，建议使用 ${this.messageService.formatCommand('buid bind <B站UID>')} 完成B站绑定以享受完整功能`
        }
      } catch (renameError) {
        // 群昵称设置失败不影响主流程
      }
      
      // 获取MC头图
      let mcAvatarUrl = null
      if (this.config?.showAvatar) {
        if (this.config?.showMcSkin) {
          mcAvatarUrl = this.mojangService.getStarlightSkinUrl(username)
        } else {
          mcAvatarUrl = this.mojangService.getCrafatarUrl(uuid)
        }
      }
      const formattedUuid = this.mojangService.formatUuid(uuid)
      
      return this.messageService.sendMessage(session, [
        h.text(`已成功绑定MC账号\n用户名: ${username}\nUUID: ${formattedUuid}${buidReminder}`),
        ...(mcAvatarUrl ? [h.image(mcAvatarUrl)] : [])
      ])
    } catch (error) {
      return this.messageService.sendMessage(session, [h.text(this.errorService.getUserFacingErrorMessage(error.message))])
    }
  }

  /**
   * 处理修改MC账号命令
   */
  private async handleChange(session: Session, username: string, target?: string): Promise<void> {
    try {
      const userId = this.messageService.normalizeQQId(session.userId)
      
      // 检查用户名格式
      if (!username || !/^[a-zA-Z0-9_]{3,16}$/.test(username)) {
        return this.messageService.sendMessage(session, [h.text('请提供有效的Minecraft用户名（3-16位字母、数字、下划线）')])
      }

      // 验证用户名是否存在
      const profile = await this.mojangService.validateUsername(username)
      if (!profile) {
        return this.messageService.sendMessage(session, [h.text(`无法验证用户名: ${username}，该用户可能不存在`)])
      }

      username = profile.name
      const uuid = profile.id
      
      // 如果指定了目标用户（管理员功能）
      if (target) {
        const targetId = this.messageService.normalizeQQId(target)
        
        if (!targetId) {
          if (target.startsWith('@')) {
            return this.messageService.sendMessage(session, [h.text('❌ 请使用真正的@功能，而不是手动输入@符号\n正确做法：点击或长按用户头像选择@功能')])
          }
          return this.messageService.sendMessage(session, [h.text('❌ 目标用户ID无效\n请提供有效的QQ号或使用@功能选择用户')])
        }
        
        // 检查权限
        if (!await this.validationService.isAdmin(session.userId)) {
          return this.messageService.sendMessage(session, [h.text('只有管理员才能修改其他用户的MC账号')])
        }
        
        const targetBind = await this.databaseService.getMcBindByQQId(targetId)
        
        if (!targetBind || !targetBind.mcUsername) {
          return this.messageService.sendMessage(session, [h.text(`用户 ${targetId} 尚未绑定MC账号，请先使用 ${this.messageService.formatCommand('mcid bind')} 命令进行绑定`)])
        }
        
        // 检查是否与当前用户名相同
        if (targetBind.mcUsername === username) {
          return this.messageService.sendMessage(session, [h.text(`用户 ${targetId} 当前已绑定此用户名: ${username}`)])
        }
        
        // 检查用户名是否已被绑定
        if (await this.databaseService.checkUsernameExists(username, target)) {
          return this.messageService.sendMessage(session, [h.text(`用户名 ${username} 已被其他用户绑定`)])
        }
        
        const oldUsername = targetBind.mcUsername
        
        // 更新绑定信息
        const bindResult = await this.databaseService.createOrUpdateMcBind(target, username, uuid)
        
        if (!bindResult) {
          return this.messageService.sendMessage(session, [h.text(`修改用户 ${targetId} 的MC账号失败: 数据库操作出错，请联系管理员`)])
        }
        
        // 获取MC头图
        let mcAvatarUrl = null
        if (this.config?.showAvatar) {
          if (this.config?.showMcSkin) {
            mcAvatarUrl = this.mojangService.getStarlightSkinUrl(username)
          } else {
            mcAvatarUrl = this.mojangService.getCrafatarUrl(uuid)
          }
        }
        const formattedUuid = this.mojangService.formatUuid(uuid)
        
        return this.messageService.sendMessage(session, [
          h.text(`已成功将用户 ${targetId} 的MC账号从 ${oldUsername} 修改为 ${username}\nUUID: ${formattedUuid}`),
          ...(mcAvatarUrl ? [h.image(mcAvatarUrl)] : [])
        ])
      }

      // 从数据库中查询用户绑定
      const selfBind = await this.databaseService.getMcBindByQQId(userId)
      
      // 检查是否已绑定
      if (!selfBind || !selfBind.mcUsername) {
        return this.messageService.sendMessage(session, [h.text('您尚未绑定MC账号，请使用 ' + this.messageService.formatCommand('mcid bind') + ' 命令进行绑定')])
      }

      // 检查是否与当前用户名相同
      if (selfBind.mcUsername === username) {
        return this.messageService.sendMessage(session, [h.text(`您当前已绑定此用户名: ${username}`)])
      }

      // 检查冷却时间
      if (!await this.validationService.isAdmin(session.userId) && !this.validationService.checkCooldown(selfBind.lastModified)) {
        const remainingDays = this.validationService.getRemainingCooldownDays(selfBind.lastModified, this.config.cooldownDays)
        return this.messageService.sendMessage(session, [h.text(`您的MC账号绑定在冷却期内，还需${remainingDays}天才能修改。如需立即修改，请联系管理员。`)])
      }

      // 检查用户名是否已被绑定
      if (await this.databaseService.checkUsernameExists(username, session.userId)) {
        return this.messageService.sendMessage(session, [h.text(`用户名 ${username} 已被其他用户绑定`)])
      }

      const oldUsername = selfBind.mcUsername
      
      // 更新绑定信息
      const bindResult = await this.databaseService.createOrUpdateMcBind(session.userId, username, uuid)
      
      if (!bindResult) {
        return this.messageService.sendMessage(session, [h.text('修改失败，数据库操作出错，请联系管理员')])
      }
      
      // 获取MC头图
      let mcAvatarUrl = null
      if (this.config?.showAvatar) {
        if (this.config?.showMcSkin) {
          mcAvatarUrl = this.mojangService.getStarlightSkinUrl(username)
        } else {
          mcAvatarUrl = this.mojangService.getCrafatarUrl(uuid)
        }
      }
      const formattedUuid = this.mojangService.formatUuid(uuid)
      
      return this.messageService.sendMessage(session, [
        h.text(`已成功将MC账号从 ${oldUsername} 修改为 ${username}\nUUID: ${formattedUuid}`),
        ...(mcAvatarUrl ? [h.image(mcAvatarUrl)] : [])
      ])
    } catch (error) {
      return this.messageService.sendMessage(session, [h.text(this.errorService.getUserFacingErrorMessage(error.message))])
    }
  }

  /**
   * 处理解绑MC账号命令
   */
  private async handleUnbind(session: Session, target?: string): Promise<void> {
    try {
      const userId = this.messageService.normalizeQQId(session.userId)
      
      // 如果指定了目标用户（管理员功能）
      if (target) {
        const targetId = this.messageService.normalizeQQId(target)
        
        if (!targetId) {
          if (target.startsWith('@')) {
            return this.messageService.sendMessage(session, [h.text('❌ 请使用真正的@功能，而不是手动输入@符号\n正确做法：点击或长按用户头像选择@功能')])
          }
          return this.messageService.sendMessage(session, [h.text('❌ 目标用户ID无效\n请提供有效的QQ号或使用@功能选择用户')])
        }
        
        // 检查权限
        if (!await this.validationService.isAdmin(session.userId)) {
          return this.messageService.sendMessage(session, [h.text('只有管理员才能为其他用户解绑MC账号')])
        }

        const targetBind = await this.databaseService.getMcBindByQQId(targetId)
        
        if (!targetBind || !targetBind.mcUsername) {
          return this.messageService.sendMessage(session, [h.text(`用户 ${targetId} 尚未绑定MC账号`)])
        }

        const oldUsername = targetBind.mcUsername && !targetBind.mcUsername.startsWith('_temp_') ? targetBind.mcUsername : '未绑定'
        const oldBuidInfo = targetBind.buidUid ? ` 和 B站账号: ${targetBind.buidUsername}(${targetBind.buidUid})` : ''
        
        // 删除绑定记录
        await this.databaseService.deleteMcBind(target)
        
        return this.messageService.sendMessage(session, [h.text(`已成功为用户 ${targetId} 解绑MC账号: ${oldUsername}${oldBuidInfo}`)])
      }
      
      // 为自己解绑MC账号
      const selfBind = await this.databaseService.getMcBindByQQId(userId)
      
      if (!selfBind || !selfBind.mcUsername) {
        return this.messageService.sendMessage(session, [h.text('您尚未绑定MC账号')])
      }

      const oldUsername = selfBind.mcUsername && !selfBind.mcUsername.startsWith('_temp_') ? selfBind.mcUsername : '未绑定'
      const oldBuidInfo = selfBind.buidUid ? ` 和 B站账号: ${selfBind.buidUsername}(${selfBind.buidUid})` : ''
      
      // 删除绑定记录
      await this.databaseService.deleteMcBind(userId)
      
      return this.messageService.sendMessage(session, [h.text(`已成功解绑MC账号: ${oldUsername}${oldBuidInfo}`)])
    } catch (error) {
      return this.messageService.sendMessage(session, [h.text(this.errorService.getUserFacingErrorMessage(error.message))])
    }
  }

  /**
   * 处理设置管理员命令
   */
  private async handleSetAdmin(session: Session, target: string): Promise<void> {
    try {
      const userId = this.messageService.normalizeQQId(session.userId)
      const targetId = this.messageService.normalizeQQId(target)
      
      // 检查是否为主人
      if (!this.validationService.isMaster(session.userId)) {
        return this.messageService.sendMessage(session, [h.text('只有主人才能设置管理员')])
      }
      
      // 检查目标用户是否已经是管理员
      const targetBind = await this.databaseService.getMcBindByQQId(targetId)
      const isAlreadyAdmin = targetBind && targetBind.isAdmin === true
      
      if (isAlreadyAdmin) {
        return this.messageService.sendMessage(session, [h.text(`用户 ${targetId} 已经是管理员`)])
      }
      
      // 如果用户存在绑定记录，更新为管理员
      if (targetBind) {
        await this.databaseService.updateAdminStatus(targetId, true)
        return this.messageService.sendMessage(session, [h.text(`已成功将用户 ${targetId} 设为管理员`)])
      } else {
        // 用户不存在绑定记录，创建一个新记录并设为管理员
        const tempUsername = `_temp_${targetId}`
        await this.databaseService.createMcBindWithAdmin(targetId, tempUsername, true)
        return this.messageService.sendMessage(session, [h.text(`已成功将用户 ${targetId} 设为管理员 (未绑定MC账号)`)])
      }
    } catch (error) {
      return this.messageService.sendMessage(session, [h.text(this.errorService.getUserFacingErrorMessage(error.message))])
    }
  }

  /**
   * 处理撤销管理员命令
   */
  private async handleUnsetAdmin(session: Session, target: string): Promise<void> {
    try {
      const userId = this.messageService.normalizeQQId(session.userId)
      const targetId = this.messageService.normalizeQQId(target)
      
      // 检查是否为主人
      if (!this.validationService.isMaster(session.userId)) {
        return this.messageService.sendMessage(session, [h.text('只有主人才能撤销管理员权限')])
      }
      
      // 检查目标用户是否是管理员
      const targetBind = await this.databaseService.getMcBindByQQId(targetId)
      const isAdmin = targetBind && targetBind.isAdmin === true
      
      if (!isAdmin) {
        return this.messageService.sendMessage(session, [h.text(`用户 ${targetId} 不是管理员`)])
      }
      
      // 撤销管理员权限
      await this.databaseService.updateAdminStatus(targetId, false)
      
      return this.messageService.sendMessage(session, [h.text(`已成功撤销用户 ${targetId} 的管理员权限`)])
    } catch (error) {
      return this.messageService.sendMessage(session, [h.text(this.errorService.getUserFacingErrorMessage(error.message))])
    }
  }

  /**
   * 处理列出管理员命令
   */
  private async handleAdminList(session: Session): Promise<void> {
    try {
      const userId = this.messageService.normalizeQQId(session.userId)
      
      // 检查是否为主人
      if (!this.validationService.isMaster(session.userId)) {
        return this.messageService.sendMessage(session, [h.text('只有主人才能查看管理员列表')])
      }
      
      // 查询所有管理员
      const admins = await this.databaseService.getAllAdmins()
      
      if (admins.length === 0) {
        return this.messageService.sendMessage(session, [h.text('当前没有管理员')])
      }
      
      // 格式化管理员列表
      const adminList = admins.map(admin => {
        const displayUsername = admin.mcUsername && !admin.mcUsername.startsWith('_temp_') ? admin.mcUsername : null
        return `- ${admin.qqId}${displayUsername ? ` (MC: ${displayUsername})` : ''}`
      }).join('\n')
      
      return this.messageService.sendMessage(session, [h.text(`管理员列表:\n${adminList}\n\n共 ${admins.length} 名管理员`)])
    } catch (error) {
      return this.messageService.sendMessage(session, [h.text(this.errorService.getUserFacingErrorMessage(error.message))])
    }
  }

  /**
   * 处理统计信息命令
   */
  private async handleStats(session: Session): Promise<void> {
    try {
      const userId = this.messageService.normalizeQQId(session.userId)
      
      // 检查权限
      if (!await this.validationService.isAdmin(session.userId)) {
        return this.messageService.sendMessage(session, [h.text('只有管理员才能查看统计信息')])
      }
      
      // 获取统计数据
      const stats = await this.databaseService.getBindingStats()
      
      let statsInfo = `📊 绑定统计\n`
      statsInfo += `\n已绑定MCID: ${stats.mcidBoundUsers}人\n`
      statsInfo += `已绑定BUID: ${stats.buidBoundUsers}人`
      
      return this.messageService.sendMessage(session, [h.text(statsInfo)])
    } catch (error) {
      return this.messageService.sendMessage(session, [h.text(this.errorService.getUserFacingErrorMessage(error.message))])
    }
  }

  /**
   * 处理修复群昵称命令
   */
  private async handleFixNicknames(session: Session): Promise<void> {
    try {
      const userId = this.messageService.normalizeQQId(session.userId)
      
      // 检查权限
      if (!await this.validationService.isAdmin(session.userId)) {
        return this.messageService.sendMessage(session, [h.text('只有管理员才能执行群昵称修复操作')])
      }
      
      // 检查是否在目标群
      if (session.channelId !== this.config.autoNicknameGroupId) {
        return this.messageService.sendMessage(session, [h.text('此命令只能在指定群中使用')])
      }
      
      await this.messageService.sendMessage(session, [h.text('🔧 开始检查并修复所有用户的群昵称格式，请稍候...')])
      
      // 获取所有已绑定B站的用户
      const usersWithBuid = await this.databaseService.getAllUsersWithBuid()
      
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
              const groupInfo = await session.bot.internal.getGroupMemberInfo(session.channelId, bind.qqId)
              currentNickname = groupInfo.card || groupInfo.nickname || ''
            }
          } catch (error) {
            errorCount++
            results.push(`❌ ${bind.qqId}: 获取群信息失败`)
            continue
          }
          
          // 检查昵称格式
          const mcInfo = bind.mcUsername && !bind.mcUsername.startsWith('_temp_') ? bind.mcUsername : null
          const isCorrect = this.nicknameService.checkNicknameFormat(currentNickname, bind.buidUsername, mcInfo)
          
          if (!isCorrect) {
            // 修复群昵称
            await this.nicknameService.autoSetGroupNickname(session, mcInfo, bind.buidUsername, bind.qqId)
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
            await this.messageService.sendMessage(session, [h.text(`进度: ${checkedCount}/${usersWithBuid.length} | 修复: ${fixedCount} | 错误: ${errorCount}`)])
          }
          
        } catch (error) {
          errorCount++
          results.push(`❌ ${bind.qqId}: 处理出错 - ${error.message}`)
        }
      }
      
      // 生成最终报告
      let resultMessage = `🔧 群昵称修复完成\n共检查${checkedCount}个用户\n✅ 修复: ${fixedCount}个\n❌ 错误: ${errorCount}个`
      
      // 如果用户数量不多，显示详细结果
      if (usersWithBuid.length <= 20) {
        resultMessage += '\n\n详细结果:\n' + results.join('\n')
      } else {
        // 只显示修复的结果
        const fixedResults = results.filter(r => r.includes('→'))
        if (fixedResults.length > 0) {
          resultMessage += '\n\n修复的用户:\n' + fixedResults.slice(0, 10).join('\n')
          if (fixedResults.length > 10) {
            resultMessage += `\n... 还有${fixedResults.length - 10}个用户被修复`
          }
        }
      }
      
      return this.messageService.sendMessage(session, [h.text(resultMessage)])
    } catch (error) {
      return this.messageService.sendMessage(session, [h.text(this.errorService.getUserFacingErrorMessage(error.message))])
    }
  }

  /**
   * 处理清除提醒冷却命令
   */
  private async handleClearReminder(session: Session, target?: string): Promise<void> {
    try {
      const userId = this.messageService.normalizeQQId(session.userId)
      
      // 检查权限
      if (!await this.validationService.isAdmin(session.userId)) {
        return this.messageService.sendMessage(session, [h.text('只有管理员才能清除提醒冷却和次数')])
      }
      
      if (target) {
        // 清除指定用户的冷却和次数
        const targetId = this.messageService.normalizeQQId(target)
        await this.databaseService.clearReminderCooldown(targetId)
        await this.databaseService.resetReminderCount(targetId)
        
        return this.messageService.sendMessage(session, [h.text(`已清除用户 ${targetId} 的随机提醒冷却时间和提醒次数`)])
      } else {
        // 清除所有用户的冷却
        const clearedCount = await this.databaseService.clearAllReminderCooldowns()
        await this.databaseService.resetAllReminderCounts()
        
        return this.messageService.sendMessage(session, [h.text(`已清除所有用户的随机提醒冷却时间和提醒次数，共清除 ${clearedCount} 条冷却记录`)])
      }
    } catch (error) {
      return this.messageService.sendMessage(session, [h.text(this.errorService.getUserFacingErrorMessage(error.message))])
    }
  }

  private getServerConfigById(serverId: string): any {
    if (!this.config.servers || !Array.isArray(this.config.servers)) return null
    return this.config.servers.find(server => server.id === serverId && (server.enabled !== false)) || null
  }
} 