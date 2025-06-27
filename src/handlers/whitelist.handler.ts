import { Context, h } from 'koishi'
import { BaseHandler } from './base.handler'
import { ServiceContainer } from '../container/service-container'
import { Config } from '../types/config'

/**
 * 白名单管理命令处理器
 * 处理所有白名单相关的命令操作
 */
export class WhitelistHandler extends BaseHandler {
  constructor(ctx: Context, config: Config, services: ServiceContainer) {
    super(ctx, config, services)
  }

  registerCommands(): void {
    const cmd = this.ctx.command('mcid')
    const whitelistCmd = cmd.subcommand('.whitelist', '白名单管理')

    // 列出服务器
    whitelistCmd.subcommand('.servers', '列出所有可用的服务器')
      .action(async ({ session }) => this.handleServers(session))

    // 添加白名单
    whitelistCmd.subcommand('.add <serverIdOrName:string> [...targets:string]', '申请/添加服务器白名单')
      .action(async ({ session }, serverIdOrName, ...targets) => this.handleAdd(session, serverIdOrName, targets))

    // 移除白名单
    whitelistCmd.subcommand('.remove <serverIdOrName:string> [...targets:string]', '[管理员]移除服务器白名单')
      .action(async ({ session }, serverIdOrName, ...targets) => this.handleRemove(session, serverIdOrName, targets))
  }

  private async handleServers(session: any): Promise<void> {
    await this.sendMessage(session, [h.text('白名单服务器列表功能开发中...')])
  }

  private async handleAdd(session: any, serverIdOrName: string, targets: string[]): Promise<void> {
    await this.sendMessage(session, [h.text('添加白名单功能开发中...')])
  }

  private async handleRemove(session: any, serverIdOrName: string, targets: string[]): Promise<void> {
    await this.sendMessage(session, [h.text('移除白名单功能开发中...')])
  }
} 