// 消息处理服务 - 从原 index.ts 提取所有消息处理逻辑

import { Session, h, Logger } from 'koishi'
import { Config, MessageOptions } from '../types'
import { QQ_ID_REGEX, QQ_ID_MIN_LENGTH, QQ_ID_MAX_LENGTH } from '../utils/constants'

export class MessageService {
  private logger: Logger

  constructor(
    private config: Config,
    logger: Logger
  ) {
    this.logger = logger.extend('MessageService')
  }

  // 规范化QQ号 - 从原代码提取
  normalizeQQId(userId: string): string {
    if (!userId) {
      this.logger.warn('用户ID为空')
      return ''
    }

    // 移除@机器人自己的部分
    if (this.config.botNickname) {
      const cleanUserId = userId.replace(`@${this.config.botNickname}`, '').trim()
      if (cleanUserId !== userId) {
        this.logger.debug(`移除机器人昵称后的用户ID: ${cleanUserId}`)
        userId = cleanUserId
      }
    }

    // 处理Koishi的at标签格式: <at id="123456789"/>
    const atMatch = userId.match(/<at id="(\d+)"\s*\/>/)
    if (atMatch) {
      const extractedId = atMatch[1]
      this.logger.debug(`从at标签提取QQ号: ${extractedId}`)
      return this.validateAndReturnQQId(extractedId)
    }

    // 处理平台前缀格式，如 "onebot:123456789" 或 "discord:123456789"
    const colonIndex = userId.indexOf(':')
    if (colonIndex !== -1) {
      const extractedId = userId.substring(colonIndex + 1)
      this.logger.debug(`从平台前缀提取QQ号: ${extractedId}`)
      return this.validateAndReturnQQId(extractedId)
    }

    // 直接验证原始userId
    return this.validateAndReturnQQId(userId)
  }

  // 验证并返回有效的QQ号
  private validateAndReturnQQId(id: string): string {
    if (!id || !QQ_ID_REGEX.test(id)) {
      this.logger.warn(`QQ号格式无效: ${id}`)
      return ''
    }

    if (id.length < QQ_ID_MIN_LENGTH || id.length > QQ_ID_MAX_LENGTH) {
      this.logger.warn(`QQ号长度无效: ${id} (长度: ${id.length})`)
      return ''
    }

    return id
  }

  // 发送消息并处理自动撤回 - 从原代码提取
  async sendMessage(session: Session, content: any[], options: MessageOptions = {}): Promise<void> {
    try {
      const isGroupMessage = session.channelId && !session.channelId.startsWith('private:')
      const normalizedQQId = this.normalizeQQId(session.userId)
      const isProactiveMessage = options.isProactiveMessage || false
      
      // 构建消息内容
      let promptMessage: any[]
      
      if (session.channelId?.startsWith('private:')) {
        // 私聊消息
        promptMessage = isProactiveMessage ? content : [h.quote(session.messageId), ...content]
      } else {
        // 群聊消息
        if (isProactiveMessage) {
          promptMessage = [h.at(normalizedQQId), '\\n', ...content]
        } else {
          promptMessage = [h.quote(session.messageId), h.at(normalizedQQId), '\\n', ...content]
        }
      }
      
      this.logger.debug(`发送消息到${isGroupMessage ? '群聊' : '私聊'}: ${session.channelId}`)
      
      // 发送消息
      const messageResult = await session.send(promptMessage)
      
      // 如果设置了自动撤回时间且不是0，则处理撤回逻辑
      if (this.config.autoRecallTime > 0 && session.bot) {
        await this.handleAutoRecall(session, messageResult, isGroupMessage, isProactiveMessage)
      }
      
    } catch (error) {
      this.logger.error(`发送消息失败: ${error.message}`)
      throw new Error(`发送消息失败: ${error.message}`)
    }
  }

  // 处理自动撤回逻辑 - 从原代码提取
  private async handleAutoRecall(session: Session, messageResult: any, isGroupMessage: boolean, isProactiveMessage: boolean): Promise<void> {
    try {
      const messageIds = Array.isArray(messageResult) ? messageResult : [messageResult]
      
      for (const messageId of messageIds) {
        if (messageId) {
          setTimeout(async () => {
            try {
              // 撤回机器人消息
              await session.bot.deleteMessage(session.channelId, messageId)
              this.logger.debug(`已撤回机器人消息: ${messageId}`)
              
              // 如果是群聊且配置允许撤回用户消息，则也撤回用户的原始消息
              if (isGroupMessage && 
                  this.config.recallUserMessage && 
                  !isProactiveMessage && 
                  session.messageId) {
                try {
                  await session.bot.deleteMessage(session.channelId, session.messageId)
                  this.logger.debug(`已撤回用户消息: ${session.messageId}`)
                } catch (userRecallError) {
                  // 撤回用户消息失败不影响整体流程，只记录调试信息
                  this.logger.debug(`撤回用户消息失败 (可能权限不足): ${userRecallError.message}`)
                }
              }
            } catch (error) {
              this.logger.debug(`撤回消息失败: ${error.message}`)
            }
          }, this.config.autoRecallTime * 1000)
        }
      }
    } catch (error) {
      this.logger.debug(`设置消息撤回失败: ${error.message}`)
    }
  }

  // 发送纯文本消息 - 便捷方法
  async sendText(session: Session, text: string, options: MessageOptions = {}): Promise<void> {
    await this.sendMessage(session, [h.text(text)], options)
  }

  // 发送带图片的消息 - 便捷方法
  async sendWithImage(session: Session, text: string, imageUrl: string, options: MessageOptions = {}): Promise<void> {
    const content = [
      h.text(text),
      h.text('\\n'),
      h.image(imageUrl)
    ]
    await this.sendMessage(session, content, options)
  }

  // 发送错误消息 - 便捷方法
  async sendError(session: Session, errorMessage: string): Promise<void> {
    await this.sendMessage(session, [h.text(`❌ ${errorMessage}`)])
  }

  // 发送成功消息 - 便捷方法
  async sendSuccess(session: Session, successMessage: string): Promise<void> {
    await this.sendMessage(session, [h.text(`✅ ${successMessage}`)])
  }

  // 发送警告消息 - 便捷方法
  async sendWarning(session: Session, warningMessage: string): Promise<void> {
    await this.sendMessage(session, [h.text(`⚠️ ${warningMessage}`)])
  }

  // 发送信息消息 - 便捷方法
  async sendInfo(session: Session, infoMessage: string): Promise<void> {
    await this.sendMessage(session, [h.text(`ℹ️ ${infoMessage}`)])
  }

  // 构建用户信息显示 - 从原代码提取
  formatUserDisplay(userId: string): string {
    const normalizedId = this.normalizeQQId(userId)
    return normalizedId ? `QQ(${normalizedId})` : '用户'
  }

  // 构建服务器列表显示 - 从原代码提取
  formatServersList(): string {
    if (!this.config.servers || this.config.servers.length === 0) {
      return '当前未配置任何服务器'
    }
    
    return this.config.servers
      .map((server, index) => {
        let serverInfo = `${index + 1}. ${server.name} (ID: ${server.id})`
        
        if (server.displayAddress) {
          serverInfo += `\\n   地址: ${server.displayAddress}`
        }
        
        if (server.description) {
          serverInfo += `\\n   说明: ${server.description}`
        }
        
        if (server.enabled === false) {
          serverInfo += ' [已禁用]'
        }
        
        return serverInfo
      })
      .join('\\n\\n')
  }

  // 构建统计信息显示 - 从原代码提取  
  formatStatsDisplay(stats: {
    totalUsers: number
    mcBindUsers: number
    buidBindUsers: number
    adminUsers: number
    tagCounts: { [tag: string]: number }
    serverStats: { [serverId: string]: number }
  }): string {
    let message = `📊 绑定统计信息\\n\\n`
    
    // 基础统计
    message += `总用户数: ${stats.totalUsers}\\n`
    message += `MC绑定用户: ${stats.mcBindUsers}\\n`
    message += `B站绑定用户: ${stats.buidBindUsers}\\n`
    message += `管理员用户: ${stats.adminUsers}\\n\\n`
    
    // 标签统计
    if (Object.keys(stats.tagCounts).length > 0) {
      message += `🏷️ 标签统计:\\n`
      Object.entries(stats.tagCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10) // 只显示前10个标签
        .forEach(([tag, count]) => {
          message += `  ${tag}: ${count}人\\n`
        })
      message += '\\n'
    }
    
    // 服务器白名单统计
    if (Object.keys(stats.serverStats).length > 0) {
      message += `🎮 服务器白名单统计:\\n`
      Object.entries(stats.serverStats).forEach(([serverId, count]) => {
        const server = this.config.servers?.find(s => s.id === serverId)
        const serverName = server ? server.name : serverId
        message += `  ${serverName}: ${count}人\\n`
      })
    }
    
    return message.trim()
  }

  // 构建标签列表显示 - 从原代码提取
  formatTagsList(tags: string[], target?: string): string {
    if (!tags || tags.length === 0) {
      const user = target ? this.formatUserDisplay(target) : '该用户'
      return `${user}暂无任何标签`
    }
    
    const user = target ? this.formatUserDisplay(target) : '当前用户'
    return `${user}的标签:\\n🏷️ ${tags.join(', ')}`
  }

  // 构建白名单状态显示 - 从原代码提取
  formatWhitelistStatus(whitelist: string[], showDetails: boolean = false): string {
    if (!this.config.servers || this.config.servers.length === 0) {
      return '未配置任何服务器'
    }
    
    if (!whitelist || whitelist.length === 0) {
      return '未添加到任何服务器白名单'
    }
    
    const statusList = this.config.servers.map(server => {
      const isInWhitelist = whitelist.includes(server.id)
      const status = isInWhitelist ? '✅' : '❌'
      
      if (showDetails) {
        let serverInfo = `${status} ${server.name}`
        if (server.displayAddress) {
          serverInfo += ` (${server.displayAddress})`
        }
        return serverInfo
      } else {
        return `${status} ${server.name}`
      }
    })
    
    return statusList.join('\\n')
  }

  // 构建帮助信息显示 - 从原代码提取
  formatHelpDisplay(commands: { [key: string]: string }): string {
    let help = '📖 可用命令:\\n\\n'
    
    for (const [command, description] of Object.entries(commands)) {
      help += `${command}\\n  ${description}\\n\\n`
    }
    
    return help.trim()
  }

  // 验证是否为有效的用户ID格式
  isValidUserId(userId: string): boolean {
    return !!this.normalizeQQId(userId)
  }

  // 解析多个目标用户 - 从原代码提取
  parseTargetUsers(targets: string[]): string[] {
    const normalizedTargets: string[] = []
    
    for (const target of targets) {
      const normalizedId = this.normalizeQQId(target)
      if (normalizedId) {
        normalizedTargets.push(normalizedId)
      } else {
        this.logger.warn(`无效的用户ID格式: ${target}`)
      }
    }
    
    return normalizedTargets
  }

  // 检查消息长度并分割 - 防止消息过长
  splitLongMessage(message: string, maxLength: number = 4000): string[] {
    if (message.length <= maxLength) {
      return [message]
    }
    
    const parts: string[] = []
    let currentPart = ''
    
    const lines = message.split('\\n')
    
    for (const line of lines) {
      if (currentPart.length + line.length + 1 > maxLength) {
        if (currentPart) {
          parts.push(currentPart.trim())
          currentPart = ''
        }
        
        // 如果单行就超过最大长度，强制分割
        if (line.length > maxLength) {
          let remaining = line
          while (remaining.length > maxLength) {
            parts.push(remaining.substring(0, maxLength))
            remaining = remaining.substring(maxLength)
          }
          if (remaining) {
            currentPart = remaining
          }
        } else {
          currentPart = line
        }
      } else {
        if (currentPart) {
          currentPart += '\\n' + line
        } else {
          currentPart = line
        }
      }
    }
    
    if (currentPart) {
      parts.push(currentPart.trim())
    }
    
    return parts
  }

  // 发送长消息（自动分割）
  async sendLongMessage(session: Session, message: string, options: MessageOptions = {}): Promise<void> {
    const parts = this.splitLongMessage(message)
    
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const partPrefix = parts.length > 1 ? `[${i + 1}/${parts.length}] ` : ''
      await this.sendText(session, partPrefix + part, options)
      
      // 在多部分消息之间添加短暂延迟
      if (i < parts.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500))
      }
    }
  }

  // 销毁服务
  async dispose(): Promise<void> {
    this.logger.info('MessageService 正在销毁')
    // 消息服务通常不需要特殊的清理工作
  }
} 