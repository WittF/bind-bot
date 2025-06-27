import { Context, h } from 'koishi'
import { BaseHandler } from './base.handler'
import { ServiceContainer } from '../container/service-container'
import { Config } from '../types/config'

/**
 * 管理员命令处理器
 * 处理所有管理员相关的命令操作
 */
export class AdminHandler extends BaseHandler {
  constructor(ctx: Context, config: Config, services: ServiceContainer) {
    super(ctx, config, services)
  }

  registerCommands(): void {
    const cmd = this.ctx.command('mcid')

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
  }

  private async handleSetAdmin(session: any, target: string): Promise<void> {
    await this.sendMessage(session, [h.text('设置管理员功能开发中...')])
  }

  private async handleUnsetAdmin(session: any, target: string): Promise<void> {
    await this.sendMessage(session, [h.text('撤销管理员功能开发中...')])
  }

  private async handleAdminList(session: any): Promise<void> {
    await this.sendMessage(session, [h.text('管理员列表功能开发中...')])
  }

  private async handleStats(session: any): Promise<void> {
    await this.sendMessage(session, [h.text('统计信息功能开发中...')])
  }
} 