import { Context, h } from 'koishi'
import { BaseHandler } from './base.handler'
import { ServiceContainer } from '../container/service-container'
import { Config } from '../types/config'

/**
 * 交互式绑定命令处理器
 * 处理交互式绑定流程和相关功能
 */
export class InteractiveHandler extends BaseHandler {
  constructor(ctx: Context, config: Config, services: ServiceContainer) {
    super(ctx, config, services)
  }

  registerCommands(): void {
    // 交互型绑定命令
    this.ctx.command('绑定 [target:string]', '交互式绑定流程')
      .alias('bind')
      .alias('interact')
      .action(async ({ session }, target) => this.handleInteractiveBind(session, target))

    // 其他相关命令
    const cmd = this.ctx.command('mcid')

    // 检查和修复群昵称命令
    cmd.subcommand('.fixnicknames', '[管理员]检查并修复所有用户的群昵称格式')
      .action(async ({ session }) => this.handleFixNicknames(session))

    // 清除提醒冷却和次数命令
    cmd.subcommand('.clearreminder [target:string]', '[管理员]清除用户的随机提醒冷却时间和提醒次数')
      .action(async ({ session }, target) => this.handleClearReminder(session, target))
  }

  private async handleInteractiveBind(session: any, target?: string): Promise<void> {
    await this.sendMessage(session, [h.text('交互式绑定功能开发中...')])
  }

  private async handleFixNicknames(session: any): Promise<void> {
    await this.sendMessage(session, [h.text('群昵称修复功能开发中...')])
  }

  private async handleClearReminder(session: any, target?: string): Promise<void> {
    await this.sendMessage(session, [h.text('清除提醒功能开发中...')])
  }
} 