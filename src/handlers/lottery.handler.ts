import { Context, h } from 'koishi'
import { LoggerService } from '../utils/logger'
import { BaseHandler, Repositories, HandlerDependencies } from './base.handler'
import { BindStatus } from '../utils/bind-status'
import type { LotteryResult, MCIDBIND } from '../types'

/**
 * 天选开奖统计信息接口
 */
export interface LotteryStats {
  totalWinners: number
  matchedCount: number
  notBoundCount: number
  tagAddedCount: number
  tagExistedCount: number
  matchedUsers: Array<{
    qqId: string
    mcUsername: string
    buidUsername: string
    uid: number
    username: string
  }>
  tagName: string
}

/**
 * 天选开奖处理器
 * 负责处理天选开奖结果并发送通知
 */
export class LotteryHandler extends BaseHandler {
  /**
   * 注册方法（天选处理器不需要注册命令）
   */
  register(): void {
    // 天选处理器不需要注册命令
  }

  /**
   * 处理天选开奖结果
   */
  async handleLotteryResult(lotteryData: LotteryResult): Promise<void> {
    try {
      // 检查天选播报开关
      if (!this.config?.enableLotteryBroadcast) {
        this.logger.debug(
          '天选开奖',
          `天选播报功能已禁用，跳过处理天选事件: ${lotteryData.lottery_id}`
        )
        return
      }

      this.logger.info(
        '天选开奖',
        `开始处理天选事件: ${lotteryData.lottery_id}，奖品: ${lotteryData.reward_name}，中奖人数: ${lotteryData.winners.length}`,
        true
      )

      // 生成标签名称
      const tagName = `天选-${lotteryData.lottery_id}`

      // 统计信息
      let matchedCount = 0
      let notBoundCount = 0
      let tagAddedCount = 0
      let tagExistedCount = 0
      const matchedUsers: Array<{
        qqId: string
        mcUsername: string
        buidUsername: string
        uid: number
        username: string
      }> = []

      // 处理每个中奖用户
      for (const winner of lotteryData.winners) {
        try {
          // 根据B站UID查找绑定的QQ用户（复用DatabaseService）
          const bind = await this.deps.databaseService.getBuidBindByBuid(winner.uid.toString())

          if (bind && bind.qqId) {
            matchedCount++
            matchedUsers.push({
              qqId: bind.qqId,
              mcUsername: bind.mcUsername || '未绑定MC',
              buidUsername: bind.buidUsername,
              uid: winner.uid,
              username: winner.username
            })

            // 检查是否已有该标签
            if (bind.tags && bind.tags.includes(tagName)) {
              tagExistedCount++
              this.logger.debug('天选开奖', `QQ(${bind.qqId})已有标签"${tagName}"`)
            } else {
              // 添加标签
              const newTags = [...(bind.tags || []), tagName]
              await this.repos.mcidbind.update(bind.qqId, { tags: newTags })
              tagAddedCount++
              this.logger.debug('天选开奖', `为QQ(${bind.qqId})添加标签"${tagName}"`)
            }
          } else {
            notBoundCount++
            this.logger.debug('天选开奖', `B站UID(${winner.uid})未绑定QQ账号`)
          }
        } catch (error) {
          this.logger.error('天选开奖', `处理中奖用户UID(${winner.uid})时出错: ${error.message}`)
        }
      }

      this.logger.info(
        '天选开奖',
        `处理完成: 总计${lotteryData.winners.length}人中奖，匹配${matchedCount}人，未绑定${notBoundCount}人，新增标签${tagAddedCount}人，已有标签${tagExistedCount}人`,
        true
      )

      // 生成并发送结果消息
      await this.sendLotteryResultToGroup(lotteryData, {
        totalWinners: lotteryData.winners.length,
        matchedCount,
        notBoundCount,
        tagAddedCount,
        tagExistedCount,
        matchedUsers,
        tagName
      })
    } catch (error) {
      this.logger.error('天选开奖', `处理天选事件"${lotteryData.lottery_id}"失败: ${error.message}`)
    }
  }

  /**
   * 根据 BUID 查找绑定记录
   * @deprecated 已废弃，使用 deps.getBuidBindByBuid() 替代（复用DatabaseService）
   */
  // private async getBuidBindByBuid(buid: string): Promise<MCIDBIND | null> {
  //   try {
  //     const allBinds = await this.repos.mcidbind.findAll()
  //     return allBinds.find(bind => bind.buidUid === buid) || null
  //   } catch (error) {
  //     this.logger.error('天选开奖', `查询BUID绑定失败: ${error.message}`)
  //     return null
  //   }
  // }

  /**
   * 发送天选开奖结果到群
   */
  private async sendLotteryResultToGroup(
    lotteryData: LotteryResult,
    stats: LotteryStats
  ): Promise<void> {
    try {
      // 从配置中获取目标群号和私聊目标
      const targetChannelId = this.config?.lotteryTargetGroupId || ''
      const privateTargetId = this.config?.lotteryTargetPrivateId || ''

      // 检查配置是否有效
      if (!targetChannelId && !privateTargetId) {
        this.logger.warn('天选播报', '未配置播报目标（群ID或私聊ID），跳过播报')
        return
      }

      // 格式化时间
      const lotteryTime = new Date(lotteryData.timestamp).toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      })

      // 构建简化版群消息（去掉主播信息、统计信息和标签提示）
      let groupMessage = '🎉 天选开奖结果通知\n\n'
      groupMessage += `📅 开奖时间: ${lotteryTime}\n`
      groupMessage += `🎁 奖品名称: ${lotteryData.reward_name}\n`
      groupMessage += `📊 奖品数量: ${lotteryData.reward_num}个\n`
      groupMessage += `🎲 总中奖人数: ${stats.totalWinners}人`

      // 添加未绑定用户说明
      if (stats.notBoundCount > 0) {
        groupMessage += `（其中${stats.notBoundCount}人未绑定跳过）`
      }
      groupMessage += '\n\n'

      // 如果有匹配的用户，显示详细信息
      if (stats.matchedUsers.length > 0) {
        groupMessage += '🎯 已绑定的中奖用户:\n'

        // 限制显示前10个用户，避免消息过长
        const displayUsers = stats.matchedUsers.slice(0, 10)
        for (let i = 0; i < displayUsers.length; i++) {
          const user = displayUsers[i]
          const index = i + 1
          // 注意：这里的user是简化对象，不是完整的MCIDBIND，使用字符串检查
          const displayMcName =
            user.mcUsername && !user.mcUsername.startsWith('_temp_') ? user.mcUsername : '未绑定'
          groupMessage += `${index}. ${user.buidUsername} (UID: ${user.uid})\n`
          groupMessage += `   QQ: ${user.qqId} | MC: ${displayMcName}\n`
        }

        // 如果用户太多，显示省略信息
        if (stats.matchedUsers.length > 10) {
          groupMessage += `... 还有${stats.matchedUsers.length - 10}位中奖用户\n`
        }
      } else {
        groupMessage += '😔 暂无已绑定用户中奖\n'
      }

      // 构建完整版私聊消息（包含所有信息和未绑定用户）
      let privateMessage = '🎉 天选开奖结果通知\n\n'
      privateMessage += `📅 开奖时间: ${lotteryTime}\n`
      privateMessage += `🎁 奖品名称: ${lotteryData.reward_name}\n`
      privateMessage += `📊 奖品数量: ${lotteryData.reward_num}个\n`
      privateMessage += `🏷️ 事件ID: ${lotteryData.lottery_id}\n`
      privateMessage += `👤 主播: ${lotteryData.host_username} (UID: ${lotteryData.host_uid})\n`
      privateMessage += `🏠 房间号: ${lotteryData.room_id}\n\n`

      // 统计信息
      privateMessage += '📈 处理统计:\n'
      privateMessage += `• 总中奖人数: ${stats.totalWinners}人\n`
      privateMessage += `• 已绑定用户: ${stats.matchedCount}人 ✅\n`
      privateMessage += `• 未绑定用户: ${stats.notBoundCount}人 ⚠️\n`
      privateMessage += `• 新增标签: ${stats.tagAddedCount}人\n`
      privateMessage += `• 已有标签: ${stats.tagExistedCount}人\n\n`

      // 显示所有中奖用户（包括未绑定的）
      if (lotteryData.winners.length > 0) {
        privateMessage += '🎯 所有中奖用户:\n'

        for (let i = 0; i < lotteryData.winners.length; i++) {
          const winner = lotteryData.winners[i]
          const index = i + 1

          // 查找对应的绑定用户
          const matchedUser = stats.matchedUsers.find(user => user.uid === winner.uid)

          if (matchedUser) {
            // 注意：matchedUser是简化对象，不是完整的MCIDBIND，使用字符串检查
            const displayMcName =
              matchedUser.mcUsername && !matchedUser.mcUsername.startsWith('_temp_')
                ? matchedUser.mcUsername
                : '未绑定'
            privateMessage += `${index}. ${winner.username} (UID: ${winner.uid})\n`
            privateMessage += `   QQ: ${matchedUser.qqId} | MC: ${displayMcName}\n`
          } else {
            privateMessage += `${index}. ${winner.username} (UID: ${winner.uid})\n`
            privateMessage += '   无绑定信息，自动跳过\n'
          }
        }

        privateMessage += `\n🏷️ 标签"${stats.tagName}"已自动添加到已绑定用户\n`
      }

      // 准备消息元素
      const groupMessageElements = [h.text(groupMessage)]
      const privateMessageElements = [h.text(privateMessage)]

      // 发送消息到指定群（简化版）
      if (targetChannelId) {
        for (const bot of this.ctx.bots) {
          try {
            await bot.sendMessage(targetChannelId, groupMessageElements)
            this.logger.info('天选开奖', `成功发送简化开奖结果到群${targetChannelId}`, true)
            break // 成功发送后退出循环
          } catch (error) {
            this.logger.error('天选开奖', `发送消息到群${targetChannelId}失败: ${error.message}`)
          }
        }
      }

      // 发送消息到私聊（完整版）
      if (privateTargetId) {
        for (const bot of this.ctx.bots) {
          try {
            await bot.sendMessage(privateTargetId, privateMessageElements)
            this.logger.info('天选开奖', `成功发送完整开奖结果到私聊${privateTargetId}`, true)
            break // 成功发送后退出循环
          } catch (error) {
            this.logger.error('天选开奖', `发送消息到私聊${privateTargetId}失败: ${error.message}`)
          }
        }
      }
    } catch (error) {
      this.logger.error('天选开奖', `发送开奖结果失败: ${error.message}`)
    }
  }
}
