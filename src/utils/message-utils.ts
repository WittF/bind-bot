import { Session, h } from 'koishi'
import { LoggerService } from './logger'
import { normalizeQQId, checkIrrelevantInput, extractBuidUsernameFromNickname } from './helpers'
import { BindingSession } from './session-manager'

/**
 * 消息工具配置接口
 */
export interface MessageUtilsConfig {
  autoRecallTime: number
  recallUserMessage: boolean
  autoNicknameGroupId: string
  debugMode: boolean
}

/**
 * 消息工具类
 * 处理消息发送、撤回和群昵称设置
 */
export class MessageUtils {
  private config: MessageUtilsConfig
  private logger: LoggerService
  private getBindingSessionFn: (userId: string, channelId: string) => BindingSession | null
  private validateBUID?: (uid: string) => Promise<any>
  private updateBuidInfoOnly?: (qqId: string, buidUser: any) => Promise<boolean>

  /**
   * 创建消息工具实例
   * @param config 消息工具配置
   * @param logger 日志服务
   * @param getBindingSessionFn 获取绑定会话的函数
   * @param validateBUID 验证B站UID的函数（可选）
   * @param updateBuidInfoOnly 更新B站信息的函数（可选）
   */
  constructor(
    config: MessageUtilsConfig,
    logger: LoggerService,
    getBindingSessionFn: (userId: string, channelId: string) => BindingSession | null,
    validateBUID?: (uid: string) => Promise<any>,
    updateBuidInfoOnly?: (qqId: string, buidUser: any) => Promise<boolean>
  ) {
    this.config = config
    this.logger = logger
    this.getBindingSessionFn = getBindingSessionFn
    this.validateBUID = validateBUID
    this.updateBuidInfoOnly = updateBuidInfoOnly
  }

  /**
   * 发送消息并处理自动撤回
   * @param session Koishi Session对象
   * @param content 消息内容数组
   * @param options 可选参数
   */
  async sendMessage(
    session: Session,
    content: any[],
    options?: { isProactiveMessage?: boolean }
  ): Promise<void> {
    try {
      if (!session) {
        this.logger.error('消息', 'system操作失败: 无效的会话对象')
        return
      }

      // 检查是否为群聊消息
      const isGroupMessage = session.channelId && !session.channelId.startsWith('private:')
      const normalizedQQId = normalizeQQId(session.userId)
      const isProactiveMessage = options?.isProactiveMessage || false

      // 处理私聊和群聊的消息格式
      // 主动消息不引用原消息
      const promptMessage = session.channelId?.startsWith('private:')
        ? isProactiveMessage
          ? content
          : [h.quote(session.messageId), ...content]
        : isProactiveMessage
          ? [h.at(normalizedQQId), '\n', ...content]
          : [h.quote(session.messageId), h.at(normalizedQQId), '\n', ...content]

      // 发送消息并获取返回的消息ID
      const messageResult = await session.send(promptMessage)

      this.logger.debug('消息', `成功向QQ(${normalizedQQId})发送消息，频道: ${session.channelId}`)

      // 只在自动撤回时间大于0和存在bot对象时处理撤回
      if (this.config.autoRecallTime > 0 && session.bot) {
        // 处理撤回用户消息 - 只在群聊中且开启了用户消息撤回时
        // 但如果用户在绑定会话中发送聊天消息（不包括指令），不撤回
        // 主动消息不撤回用户消息
        const bindingSession = this.getBindingSessionFn(session.userId, session.channelId)
        const isBindingCommand =
          session.content &&
          (session.content.trim() === '绑定' ||
            (session.content.includes('@') && session.content.includes('绑定')))
        const shouldNotRecallUserMessage =
          bindingSession &&
          session.content &&
          !isBindingCommand &&
          checkIrrelevantInput(bindingSession.state, session.content.trim())

        if (
          this.config.recallUserMessage &&
          isGroupMessage &&
          session.messageId &&
          !shouldNotRecallUserMessage &&
          !isProactiveMessage
        ) {
          setTimeout(async () => {
            try {
              await session.bot.deleteMessage(session.channelId, session.messageId)
              this.logger.debug(
                '消息',
                `成功撤回用户QQ(${normalizedQQId})的指令消息 ${session.messageId}`
              )
            } catch (userRecallError) {
              this.logger.error(
                '消息',
                `QQ(${normalizedQQId})操作失败: 撤回用户指令消息 ${session.messageId} 失败: ${userRecallError.message}`
              )
            }
          }, this.config.autoRecallTime * 1000)

          this.logger.debug(
            '消息',
            `已设置 ${this.config.autoRecallTime} 秒后自动撤回用户QQ(${normalizedQQId})的群聊指令消息 ${session.messageId}`
          )
        } else if (shouldNotRecallUserMessage) {
          this.logger.debug(
            '消息',
            `QQ(${normalizedQQId})在绑定会话中发送聊天消息，跳过撤回用户消息`
          )
        } else if (isProactiveMessage) {
          this.logger.debug('消息', '主动发送的消息，跳过撤回用户消息')
        }

        // 处理撤回机器人消息 - 只在群聊中撤回机器人自己的消息
        // 检查是否为不应撤回的重要提示消息（只有绑定会话超时提醒）
        const shouldNotRecall = content.some(element => {
          // 检查h.text类型的元素
          if (typeof element === 'string') {
            return element.includes('绑定会话已超时，请重新开始绑定流程')
          }
          // 检查可能的对象结构
          if (typeof element === 'object' && element && 'toString' in element) {
            const text = element.toString()
            return text.includes('绑定会话已超时，请重新开始绑定流程')
          }
          return false
        })

        if (isGroupMessage && messageResult && !shouldNotRecall) {
          // 获取消息ID
          let messageId: string | undefined

          if (typeof messageResult === 'string') {
            messageId = messageResult
          } else if (Array.isArray(messageResult) && messageResult.length > 0) {
            messageId = messageResult[0]
          } else if (messageResult && typeof messageResult === 'object') {
            // 尝试提取各种可能的消息ID格式
            messageId =
              (messageResult as any).messageId ||
              (messageResult as any).id ||
              (messageResult as any).message_id
          }

          if (messageId) {
            // 设置定时器延迟撤回
            setTimeout(async () => {
              try {
                await session.bot.deleteMessage(session.channelId, messageId)
                this.logger.debug('消息', `成功撤回机器人消息 ${messageId}`)
              } catch (recallError) {
                this.logger.error(
                  '消息',
                  `QQ(${normalizedQQId})操作失败: 撤回机器人消息 ${messageId} 失败: ${recallError.message}`
                )
              }
            }, this.config.autoRecallTime * 1000)

            this.logger.debug(
              '消息',
              `已设置 ${this.config.autoRecallTime} 秒后自动撤回机器人消息 ${messageId}`
            )
          } else {
            this.logger.warn('消息', '无法获取消息ID，自动撤回功能无法生效')
          }
        } else {
          this.logger.debug('消息', '检测到私聊消息，不撤回机器人回复')
        }
      }
    } catch (error) {
      const normalizedUserId = normalizeQQId(session.userId)
      this.logger.error(
        '消息',
        `QQ(${normalizedUserId})操作失败: 向QQ(${normalizedUserId})发送消息失败: ${error.message}`
      )
    }
  }

  /**
   * 自动设置群昵称
   * @param session Koishi Session对象
   * @param mcUsername MC用户名
   * @param buidUsername B站用户名
   * @param buidUid B站UID（可选，用于实时验证）
   * @param targetUserId 目标用户ID（可选，用于管理员为他人设置）
   * @param specifiedGroupId 指定的群ID（可选，默认使用配置的群ID）
   */
  async autoSetGroupNickname(
    session: Session,
    mcUsername: string | null,
    buidUsername: string,
    buidUid?: string,
    targetUserId?: string,
    specifiedGroupId?: string
  ): Promise<void> {
    try {
      // 如果指定了目标用户ID，使用目标用户ID，否则使用session的用户ID
      const actualUserId = targetUserId || session.userId
      const normalizedUserId = normalizeQQId(actualUserId)

      // 根据MC绑定状态设置不同的格式（临时用户名视为未绑定）
      const mcInfo = mcUsername && !mcUsername.startsWith('_temp_') ? mcUsername : '未绑定'
      let currentBuidUsername = buidUsername
      const newNickname = `${currentBuidUsername}（ID:${mcInfo}）`
      // 使用指定的群ID，如果没有指定则使用配置的默认群ID
      const targetGroupId = specifiedGroupId || this.config.autoNicknameGroupId

      this.logger.debug(
        '群昵称设置',
        `开始处理QQ(${normalizedUserId})的群昵称设置，目标群: ${targetGroupId}`
      )
      this.logger.debug('群昵称设置', `期望昵称: "${newNickname}"`)

      if (session.bot.internal && targetGroupId) {
        // 使用规范化的QQ号调用OneBot API
        this.logger.debug('群昵称设置', `使用用户ID: ${normalizedUserId}`)

        // 先获取当前群昵称进行比对
        try {
          this.logger.debug(
            '群昵称设置',
            `正在获取QQ(${normalizedUserId})在群${targetGroupId}的当前昵称...`
          )
          const currentGroupInfo = await session.bot.internal.getGroupMemberInfo(
            targetGroupId,
            normalizedUserId
          )
          const currentNickname = currentGroupInfo.card || currentGroupInfo.nickname || ''
          this.logger.debug('群昵称设置', `当前昵称: "${currentNickname}"`)

          // 如果当前昵称和目标昵称一致，跳过修改
          if (currentNickname === newNickname) {
            this.logger.info(
              '群昵称设置',
              `QQ(${normalizedUserId})群昵称已经是"${newNickname}"，跳过修改`
            )
            return
          }

          // 昵称不一致，先尝试获取最新的B站用户信息
          if (buidUid && this.validateBUID && this.updateBuidInfoOnly) {
            this.logger.debug(
              '群昵称设置',
              `检测到昵称不一致，尝试获取B站UID ${buidUid} 的最新信息...`
            )

            // 1. 提取当前群昵称中的B站用户名
            const currentNicknameUsername = extractBuidUsernameFromNickname(currentNickname)
            this.logger.debug(
              '群昵称设置',
              `从当前群昵称"${currentNickname}"中提取到B站名称: ${currentNicknameUsername || '(无法提取)'}`
            )

            try {
              const latestBuidUser = await this.validateBUID(buidUid)
              if (latestBuidUser && latestBuidUser.username) {
                this.logger.debug('群昵称设置', `API返回B站用户名: "${latestBuidUser.username}"`)

                // 2. 智能三层判断

                // 情况A: API返回 == 当前群昵称中的名称
                if (
                  currentNicknameUsername &&
                  latestBuidUser.username === currentNicknameUsername
                ) {
                  this.logger.info(
                    '群昵称设置',
                    `✅ 当前群昵称"${currentNickname}"已包含正确的B站名称"${currentNicknameUsername}"`
                  )

                  // 群昵称已经正确，仅需更新数据库（如果数据库是旧的）
                  if (latestBuidUser.username !== buidUsername) {
                    this.logger.info(
                      '群昵称设置',
                      `数据库中的B站名称需要更新: "${buidUsername}" → "${latestBuidUser.username}"`
                    )
                    try {
                      await this.updateBuidInfoOnly(normalizedUserId, latestBuidUser)
                      this.logger.info('群昵称设置', '已更新数据库中的B站用户名')
                    } catch (updateError) {
                      this.logger.warn('群昵称设置', `更新数据库失败: ${updateError.message}`)
                    }
                  } else {
                    this.logger.debug('群昵称设置', '数据库中的B站名称已是最新，无需更新')
                  }

                  // 跳过群昵称修改
                  this.logger.info('群昵称设置', '群昵称格式正确且名称最新，跳过修改')
                  return
                }

                // 情况B: API返回 == 数据库（都是旧的）
                if (latestBuidUser.username === buidUsername) {
                  this.logger.warn(
                    '群昵称设置',
                    `⚠️ API返回的B站名称"${latestBuidUser.username}"与数据库一致，但与群昵称不符`
                  )
                  this.logger.warn('群昵称设置', '可能是API缓存未刷新，采用保守策略：不修改群昵称')
                  return
                }

                // 情况C: API返回新数据（!= 群昵称 且 != 数据库）
                this.logger.info(
                  '群昵称设置',
                  `检测到B站用户名已更新: "${buidUsername}" → "${latestBuidUser.username}"`
                )
                currentBuidUsername = latestBuidUser.username

                // 更新数据库中的B站信息
                try {
                  await this.updateBuidInfoOnly(normalizedUserId, latestBuidUser)
                  this.logger.info(
                    '群昵称设置',
                    `已更新数据库中的B站用户名为: ${currentBuidUsername}`
                  )
                } catch (updateError) {
                  this.logger.warn(
                    '群昵称设置',
                    `更新数据库中的B站用户名失败: ${updateError.message}`
                  )
                  // 即使更新数据库失败，也继续使用最新的用户名设置昵称
                }
              } else {
                this.logger.warn(
                  '群昵称设置',
                  `获取最新B站用户信息失败，使用数据库中的用户名: ${currentBuidUsername}`
                )
              }
            } catch (validateError) {
              this.logger.warn(
                '群昵称设置',
                `获取最新B站用户信息时出错: ${validateError.message}，使用数据库中的用户名: ${currentBuidUsername}`
              )
              // API调用失败时降级处理，使用数据库中的旧名称
            }
          }

          // 使用（可能已更新的）用户名重新生成昵称
          const finalNickname = `${currentBuidUsername}（ID:${mcInfo}）`

          // 昵称不一致，执行修改
          this.logger.debug('群昵称设置', `昵称不一致，正在修改群昵称为: "${finalNickname}"`)
          await session.bot.internal.setGroupCard(targetGroupId, normalizedUserId, finalNickname)
          this.logger.info(
            '群昵称设置',
            `成功在群${targetGroupId}中将QQ(${normalizedUserId})群昵称从"${currentNickname}"修改为"${finalNickname}"`,
            true
          )

          // 验证设置是否生效 - 再次获取群昵称确认
          try {
            await new Promise(resolve => setTimeout(resolve, 1000)) // 等待1秒
            const verifyGroupInfo = await session.bot.internal.getGroupMemberInfo(
              targetGroupId,
              normalizedUserId
            )
            const verifyNickname = verifyGroupInfo.card || verifyGroupInfo.nickname || ''
            if (verifyNickname === finalNickname) {
              this.logger.info('群昵称设置', `✅ 验证成功，群昵称已生效: "${verifyNickname}"`, true)
            } else {
              this.logger.warn(
                '群昵称设置',
                `⚠️ 验证失败，期望"${finalNickname}"，实际"${verifyNickname}"，可能是权限不足或API延迟`
              )
            }
          } catch (verifyError) {
            this.logger.warn('群昵称设置', `无法验证群昵称设置结果: ${verifyError.message}`)
          }
        } catch (getInfoError) {
          // 如果获取当前昵称失败，直接尝试设置新昵称
          this.logger.warn(
            '群昵称设置',
            `获取QQ(${normalizedUserId})当前群昵称失败: ${getInfoError.message}`
          )
          this.logger.warn('群昵称设置', `错误详情: ${JSON.stringify(getInfoError)}`)
          this.logger.debug('群昵称设置', '将直接尝试设置新昵称...')

          // 如果传入了 buidUid，尝试获取最新的B站用户信息
          if (buidUid && this.validateBUID && this.updateBuidInfoOnly) {
            this.logger.debug('群昵称设置', `尝试获取B站UID ${buidUid} 的最新信息...`)
            try {
              const latestBuidUser = await this.validateBUID(buidUid)
              if (latestBuidUser && latestBuidUser.username) {
                this.logger.debug('群昵称设置', `API返回B站用户名: "${latestBuidUser.username}"`)

                // 智能判断：API返回 == 数据库（都是旧的）
                if (latestBuidUser.username === buidUsername) {
                  this.logger.warn(
                    '群昵称设置',
                    `⚠️ API返回的B站名称"${latestBuidUser.username}"与数据库一致`
                  )
                  this.logger.warn(
                    '群昵称设置',
                    '可能是API缓存未刷新，且无法获取当前群昵称，采用保守策略：跳过修改'
                  )
                  return
                }

                // API返回新数据（!= 数据库）
                this.logger.info(
                  '群昵称设置',
                  `检测到B站用户名已更新: "${buidUsername}" → "${latestBuidUser.username}"`
                )
                currentBuidUsername = latestBuidUser.username

                // 更新数据库
                try {
                  await this.updateBuidInfoOnly(normalizedUserId, latestBuidUser)
                  this.logger.info(
                    '群昵称设置',
                    `已更新数据库中的B站用户名为: ${currentBuidUsername}`
                  )
                } catch (updateError) {
                  this.logger.warn('群昵称设置', `更新数据库失败: ${updateError.message}`)
                }
              } else {
                this.logger.warn('群昵称设置', '获取最新B站用户信息失败')
              }
            } catch (validateError) {
              this.logger.warn('群昵称设置', `获取最新B站用户信息失败: ${validateError.message}`)
            }
          }

          try {
            // 使用（可能已更新的）用户名生成昵称
            const nicknameToSet = `${currentBuidUsername}（ID:${mcInfo}）`
            await session.bot.internal.setGroupCard(targetGroupId, normalizedUserId, nicknameToSet)
            this.logger.info(
              '群昵称设置',
              `成功在群${targetGroupId}中将QQ(${normalizedUserId})群昵称设置为: ${nicknameToSet}`,
              true
            )

            // 验证设置是否生效
            try {
              await new Promise(resolve => setTimeout(resolve, 1000)) // 等待1秒
              const verifyGroupInfo = await session.bot.internal.getGroupMemberInfo(
                targetGroupId,
                normalizedUserId
              )
              const verifyNickname = verifyGroupInfo.card || verifyGroupInfo.nickname || ''
              if (verifyNickname === nicknameToSet) {
                this.logger.info(
                  '群昵称设置',
                  `✅ 验证成功，群昵称已生效: "${verifyNickname}"`,
                  true
                )
              } else {
                this.logger.warn(
                  '群昵称设置',
                  `⚠️ 验证失败，期望"${nicknameToSet}"，实际"${verifyNickname}"，可能是权限不足`
                )
                this.logger.warn(
                  '群昵称设置',
                  '建议检查: 1.机器人是否为群管理员 2.群设置是否允许管理员修改昵称 3.OneBot实现是否支持该功能'
                )
              }
            } catch (verifyError) {
              this.logger.warn('群昵称设置', `无法验证群昵称设置结果: ${verifyError.message}`)
            }
          } catch (setCardError) {
            this.logger.error('群昵称设置', `设置群昵称失败: ${setCardError.message}`)
            this.logger.error('群昵称设置', `错误详情: ${JSON.stringify(setCardError)}`)
            throw setCardError
          }
        }
      } else if (!session.bot.internal) {
        this.logger.debug(
          '群昵称设置',
          `QQ(${normalizedUserId})bot不支持OneBot内部API，跳过自动群昵称设置`
        )
      } else if (!targetGroupId) {
        this.logger.debug(
          '群昵称设置',
          `QQ(${normalizedUserId})未配置自动群昵称设置目标群，跳过群昵称设置`
        )
      }
    } catch (error) {
      const actualUserId = targetUserId || session.userId
      const normalizedUserId = normalizeQQId(actualUserId)
      this.logger.error('群昵称设置', `QQ(${normalizedUserId})自动群昵称设置失败: ${error.message}`)
      this.logger.error('群昵称设置', `完整错误信息: ${JSON.stringify(error)}`)
    }
  }
}
