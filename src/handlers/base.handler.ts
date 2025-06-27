import { Context, Session } from 'koishi'
import { ServiceContainer } from '../container/service-container'
import { Config } from '../types/config'
import { DatabaseService } from '../services/database.service'
import { MessageService } from '../services/message.service'
import { ValidationService } from '../services/validation.service'
import { ErrorService } from '../services/error.service'
import { MojangService } from '../services/mojang.service'
import { BuidService } from '../services/buid.service'
import { RconService } from '../services/rcon.service'
import { NicknameService } from '../services/nickname.service'

/**
 * 基础命令处理器类
 * 为所有命令处理器提供通用功能和依赖注入
 */
export abstract class BaseHandler {
  protected ctx: Context
  protected config: Config
  protected services: ServiceContainer

  constructor(ctx: Context, config: Config, services: ServiceContainer) {
    this.ctx = ctx
    this.config = config
    this.services = services
  }

  /**
   * 获取服务实例的便捷方法
   */
  protected get database(): DatabaseService {
    return this.services.get<DatabaseService>('database')
  }

  protected get message(): MessageService {
    return this.services.get<MessageService>('message')
  }

  protected get validation(): ValidationService {
    return this.services.get<ValidationService>('validation')
  }

  protected get error(): ErrorService {
    return this.services.get<ErrorService>('error')
  }

  protected get mojang(): MojangService {
    return this.services.get<MojangService>('mojang')
  }

  protected get buid(): BuidService {
    return this.services.get<BuidService>('buid')
  }

  protected get rcon(): RconService {
    return this.services.get<RconService>('rcon')
  }

  protected get nickname(): NicknameService {
    return this.services.get<NicknameService>('nickname')
  }

  /**
   * 获取命令前缀（用于帮助文本）
   */
  protected getCommandPrefix(): string {
    if (this.config.allowTextPrefix && this.config.botNickname) {
      const nickname = this.config.botNickname.startsWith('@') ? 
        this.config.botNickname :
        `@${this.config.botNickname}`
      return `${nickname} `
    }
    return ''
  }

  /**
   * 格式化命令文本（添加前缀）
   */
  protected formatCommand(cmd: string): string {
    return `${this.getCommandPrefix()}${cmd}`
  }

  /**
   * 检查用户是否为管理员
   */
  protected async isAdmin(userId: string): Promise<boolean> {
    return this.validation.isAdmin(userId)
  }

  /**
   * 检查用户是否为主人
   */
  protected isMaster(userId: string): boolean {
    return this.validation.isMaster(userId)
  }

  /**
   * 发送消息的便捷方法
   */
  protected async sendMessage(session: Session, content: any[], options?: { isProactiveMessage?: boolean }): Promise<void> {
    return this.message.sendMessage(session, content, options)
  }

  /**
   * 获取用户友好的错误信息
   */
  protected getFriendlyErrorMessage(error: Error | string): string {
    return this.error.getFriendlyErrorMessage(error)
  }

  /**
   * 记录操作日志
   */
  protected logOperation(operation: string, userId: string, success: boolean, details: string = ''): void {
    this.error.logOperation(operation, userId, success, details)
  }

  /**
   * 注册命令的抽象方法，由子类实现
   */
  abstract registerCommands(): void
} 