import { Context, Schema, h, Session, Logger } from 'koishi'
import {} from '@koishijs/plugin-server'
import axios from 'axios'
import * as RconClient from 'rcon-client'
import { ForceBinder } from './force-bind-utils'
import { GroupExporter } from './export-utils'
import { LoggerService } from './utils/logger'
import { RconManager } from './managers/rcon-manager'
import { RateLimiter } from './utils/rate-limiter'
import { SessionManager } from './utils/session-manager'
import {
  normalizeQQId as normalizeQQIdHelper,
  formatCommand as formatCommandHelper,
  formatUuid as formatUuidHelper,
  checkCooldown as checkCooldownHelper,
  getCrafatarUrl as getCrafatarUrlHelper,
  getStarlightSkinUrl as getStarlightSkinUrlHelper,
  checkIrrelevantInput as checkIrrelevantInputHelper,
  cleanUserInput as cleanUserInputHelper,
  normalizeUsername as normalizeUsernameHelper,
  isSameUsername as isSameUsernameHelper,
  escapeRegExp,
  levenshteinDistance,
  calculateSimilarity
} from './utils/helpers'
import {
  getFriendlyErrorMessage,
  getUserFacingErrorMessage,
  isWarningError,
  isCriticalError
} from './utils/error-utils'
import { MCIDBINDRepository } from './repositories/mcidbind.repository'
import { ScheduleMuteRepository } from './repositories/schedule-mute.repository'
import {
  BindingHandler,
  TagHandler,
  WhitelistHandler,
  BuidHandler,
  McidCommandHandler,
  Repositories,
  HandlerDependencies
} from './handlers'
// 导入所有类型定义
import type {
  Config as IConfig,
  ServerConfig,
  MCIDBIND,
  SCHEDULE_MUTE_TASKS,
  MojangProfile,
  ZminfoUser,
  ZminfoApiResponse,
  EnhancedZminfoUser,
  AvatarCache,
  BindingSession,
  LotteryWinner,
  LotteryResult,
  ForceBindConfig
} from './types'

export const name = 'bind-bot'

// 声明插件依赖
export const inject = ['database', 'server']

// 导出类型供外部使用
export type { ServerConfig, MCIDBIND, SCHEDULE_MUTE_TASKS }
// 注意：Config 作为 Schema 常量导出，类型使用 IConfig 或从 './types' 导入

// 创建配置Schema
export const Config: Schema<IConfig> = Schema.object({
  cooldownDays: Schema.number()
    .description('操作冷却时间(天)')
    .default(15),
  masterId: Schema.string()
    .description('主人QQ号，拥有管理员管理权限')
    .default(''),
  allowTextPrefix: Schema.boolean()
    .description('是否允许通过文本前缀触发指令(如"@机器人 mcid bind xxx")')
    .default(false),
  botNickname: Schema.string()
    .description('机器人昵称，用于文本前缀匹配，如"@WittF-NBot"')
    .default(''),
  autoRecallTime: Schema.number()
    .description('消息自动撤回时间(秒)，同时控制机器人和用户消息，设置为0表示不自动撤回')
    .default(0),
  recallUserMessage: Schema.boolean()
    .description('是否撤回用户发送的指令消息')
    .default(false),
  debugMode: Schema.boolean()
    .description('调试模式，启用详细日志输出')
    .default(false),
  showAvatar: Schema.boolean()
    .description('是否显示头像图片（MC用头图，B站用头像）')
    .default(false),
  showMcSkin: Schema.boolean()
    .description('是否使用MC皮肤渲染图（需要先开启showAvatar）')
    .default(false),
  zminfoApiUrl: Schema.string()
    .description('ZMINFO API地址')
    .default('https://zminfo-api.wittf.com'),
  enableLotteryBroadcast: Schema.boolean()
    .description('是否启用天选开奖播报功能')
    .default(false),
  autoNicknameGroupId: Schema.string()
    .description('自动群昵称设置目标群ID')
    .default('123456789'),
  forceBindSessdata: Schema.string()
    .description('B站Cookie信息，用于强制绑定时获取粉丝牌信息（支持完整Cookie或单独SESSDATA）')
    .default(''),
  forceBindTargetUpUid: Schema.number()
    .description('强制绑定目标UP主UID')
    .default(686127),
  forceBindTargetRoomId: Schema.number()
    .description('强制绑定目标房间号')
    .default(544853),
  forceBindTargetMedalName: Schema.string()
    .description('强制绑定目标粉丝牌名称')
    .default('生态'),
  servers: Schema.array(Schema.object({
    id: Schema.string()
      .description('服务器唯一ID（不允许重复）')
      .required(),
    name: Schema.string()
      .description('服务器名称（用于指令显示）')
      .required(),
    enabled: Schema.boolean()
      .description('服务器是否启用')
      .default(true),
    displayAddress: Schema.string()
      .description('服务器展示地址（显示给用户的连接地址）')
      .default(''),
    description: Schema.string()
      .description('服务器说明信息（显示在列表中服务器地址下方）')
      .default(''),
    rconAddress: Schema.string()
      .description('RCON地址，格式为 IP:端口，例如 127.0.0.1:25575')
      .required(),
    rconPassword: Schema.string()
      .description('RCON密码')
      .default(''),
    addCommand: Schema.string()
      .description('添加白名单命令模板，使用${MCID}作为替换符')
      .default('whitelist add ${MCID}'),
    removeCommand: Schema.string()
      .description('移除白名单命令模板，使用${MCID}作为替换符')
      .default('whitelist remove ${MCID}'),
    idType: Schema.union([
      Schema.const('username').description('使用用户名'),
      Schema.const('uuid').description('使用UUID')
    ]).default('username').description('白名单添加时使用的ID类型'),
    allowSelfApply: Schema.boolean()
      .description('是否允许用户自行申请白名单')
      .default(false),
    acceptEmptyResponse: Schema.boolean()
      .description('是否将命令的空响应视为成功（某些服务器成功执行命令后不返回内容，仅对本服务器生效）')
      .default(false),
  })).description('Minecraft服务器配置列表').default([]),
})

export function apply(ctx: Context, config: IConfig) {
  // 创建日志服务
  const logger = new Logger('bind-bot')
  const loggerService = new LoggerService(logger, config.debugMode)

  // 创建数据仓储实例
  const mcidbindRepo = new MCIDBINDRepository(ctx, loggerService)
  const scheduleMuteRepo = new ScheduleMuteRepository(ctx, loggerService)

  // 交互型绑定会话管理
  const bindingSessions = new Map<string, BindingSession>()
  const BINDING_SESSION_TIMEOUT = 3 * 60 * 1000 // 3分钟超时

  // 日志辅助函数（包装 LoggerService，保持向后兼容）
  const logDebug = (context: string, message: string): void => {
    loggerService.debug(context, message)
  }

  const logInfo = (context: string, message: string, forceOutput: boolean = false): void => {
    loggerService.info(context, message, forceOutput)
  }

  const logWarn = (context: string, message: string): void => {
    loggerService.warn(context, message)
  }

  const logError = (context: string, userId: string, error: Error | string): void => {
    const errorMessage = error instanceof Error ? error.message : error
    const normalizedQQId = normalizeQQId(userId)
    loggerService.error(context, `QQ(${normalizedQQId})操作失败: ${errorMessage}`)
  }

  // 操作记录函数 - 用于记录主要操作状态，减少日志量
  const logOperation = (operation: string, userId: string, success: boolean, details: string = ''): void => {
    loggerService.logOperation(operation, userId, success, details)
  }
  
  // 创建头像缓存对象
  const avatarCache: Record<string, AvatarCache> = {}
  
  // 缓存有效期（12小时，单位毫秒）
  const CACHE_DURATION = 12 * 60 * 60 * 1000

  // 随机提醒功能的冷却缓存
  const reminderCooldown = new Map<string, number>()
  const REMINDER_COOLDOWN_TIME = 24 * 60 * 60 * 1000 // 24小时冷却

  // 检查群昵称是否符合规范格式
  const checkNicknameFormat = (nickname: string, buidUsername: string, mcUsername: string | null): boolean => {
    if (!nickname || !buidUsername) return false
    
    // 期望格式：B站名称（ID:MC用户名）或 B站名称（ID:未绑定）
    const mcInfo = mcUsername && !mcUsername.startsWith('_temp_') ? mcUsername : "未绑定"
    const expectedFormat = `${buidUsername}（ID:${mcInfo}）`
    
    return nickname === expectedFormat
  }

  // 检查用户是否在冷却期内
  const isInReminderCooldown = (userId: string): boolean => {
    const lastReminder = reminderCooldown.get(userId)
    if (!lastReminder) return false
    
    return (Date.now() - lastReminder) < REMINDER_COOLDOWN_TIME
  }

  // 设置用户提醒冷却
  const setReminderCooldown = (userId: string): void => {
    reminderCooldown.set(userId, Date.now())
  }

  // 检查当前时间是否在群组的禁言时间段内
  const isInMuteTime = async (groupId: string): Promise<boolean> => {
    try {
      // 查询该群组的定时禁言任务
      const allTasks = await scheduleMuteRepo.findByGroupId(groupId)
      const muteTasks = allTasks.filter(task => task.enabled)

      if (!muteTasks || muteTasks.length === 0) {
        return false // 没有禁言任务
      }

      const now = new Date()
      const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`

      // 检查是否在任何一个禁言时间段内
      for (const task of muteTasks) {
        const startTime = task.startTime
        const endTime = task.endTime

        // 处理跨天的情况
        if (startTime <= endTime) {
          // 同一天内的时间段 (如 22:01 到 22:02)
          if (currentTime >= startTime && currentTime <= endTime) {
            logger.debug(`[禁言检查] 群组${groupId}当前时间${currentTime}在禁言时间段内: ${startTime}-${endTime}`)
            return true
          }
        } else {
          // 跨天的时间段 (如 00:10 到 07:00，表示凌晨0:10到早上7:00)
          if (currentTime >= startTime || currentTime <= endTime) {
            logger.debug(`[禁言检查] 群组${groupId}当前时间${currentTime}在跨天禁言时间段内: ${startTime}-${endTime}`)
            return true
          }
        }
      }

      return false
    } catch (error) {
      logger.error(`[禁言检查] 查询群组${groupId}的禁言时间失败: ${error.message}`)
      return false // 查询失败时不阻止提醒
    }
  }

  // 创建RCON连接管理器
  const rconManager = new RconManager(loggerService.createChild('RCON管理器'), config.servers || []);
  
  // 创建RCON限流器实例
  const rconRateLimiter = new RateLimiter(10, 3000); // 3秒内最多10个请求
  
  // 会话管理辅助函数
  const createBindingSession = (userId: string, channelId: string): void => {
    const sessionKey = `${normalizeQQId(userId)}_${channelId}`
    
    // 如果已有会话，先清理
    const existingSession = bindingSessions.get(sessionKey)
    if (existingSession) {
      clearTimeout(existingSession.timeout)
      bindingSessions.delete(sessionKey)
    }
    
    // 创建超时定时器
    const timeout = setTimeout(() => {
      bindingSessions.delete(sessionKey)
      // 发送超时消息，@用户
      const normalizedUser = normalizeQQId(userId)
      ctx.bots.forEach(bot => {
        bot.sendMessage(channelId, [h.at(normalizedUser), h.text(' 绑定会话已超时，请重新开始绑定流程\n\n⚠️ 温馨提醒：若在管理员多次提醒后仍不配合绑定账号信息，将按群规进行相应处理。')]).catch(() => {})
      })
      logger.info(`[交互绑定] QQ(${normalizedUser})的绑定会话因超时被清理`)
    }, BINDING_SESSION_TIMEOUT)
    
    // 创建新会话
    const session: BindingSession = {
      userId: normalizeQQId(userId),
      channelId,
      state: 'waiting_buid',
      startTime: Date.now(),
      timeout
    }
    
    bindingSessions.set(sessionKey, session)
    logger.info(`[交互绑定] 为QQ(${normalizeQQId(userId)})创建了新的绑定会话`)
  }
  
  const getBindingSession = (userId: string, channelId: string): BindingSession | null => {
    const sessionKey = `${normalizeQQId(userId)}_${channelId}`
    return bindingSessions.get(sessionKey) || null
  }
  
  const updateBindingSession = (userId: string, channelId: string, updates: Partial<BindingSession>): void => {
    const sessionKey = `${normalizeQQId(userId)}_${channelId}`
    const session = bindingSessions.get(sessionKey)
    if (session) {
      Object.assign(session, updates)
    }
  }
  
  const removeBindingSession = (userId: string, channelId: string): void => {
    const sessionKey = `${normalizeQQId(userId)}_${channelId}`
    const session = bindingSessions.get(sessionKey)
    if (session) {
      clearTimeout(session.timeout)
      bindingSessions.delete(sessionKey)
      logger.info(`[交互绑定] 移除了QQ(${normalizeQQId(userId)})的绑定会话`)
    }
  }

  // 自动群昵称设置功能
  const autoSetGroupNickname = async (session: Session, mcUsername: string | null, buidUsername: string, targetUserId?: string, specifiedGroupId?: string): Promise<void> => {
    try {
      // 如果指定了目标用户ID，使用目标用户ID，否则使用session的用户ID
      const actualUserId = targetUserId || session.userId
      const normalizedUserId = normalizeQQId(actualUserId)
      
      // 根据MC绑定状态设置不同的格式（临时用户名视为未绑定）
      const mcInfo = (mcUsername && !mcUsername.startsWith('_temp_')) ? mcUsername : "未绑定"
      const newNickname = `${buidUsername}（ID:${mcInfo}）`
      // 使用指定的群ID，如果没有指定则使用配置的默认群ID
      const targetGroupId = specifiedGroupId || config.autoNicknameGroupId
      
      logger.debug(`[群昵称设置] 开始处理QQ(${normalizedUserId})的群昵称设置，目标群: ${targetGroupId}`)
      logger.debug(`[群昵称设置] 期望昵称: "${newNickname}"`)
      
      if (session.bot.internal && targetGroupId) {
        // 使用规范化的QQ号调用OneBot API
        logger.debug(`[群昵称设置] 使用用户ID: ${normalizedUserId}`)
        
        // 先获取当前群昵称进行比对
        try {
          logger.debug(`[群昵称设置] 正在获取QQ(${normalizedUserId})在群${targetGroupId}的当前昵称...`)
          const currentGroupInfo = await session.bot.internal.getGroupMemberInfo(targetGroupId, normalizedUserId)
          const currentNickname = currentGroupInfo.card || currentGroupInfo.nickname || ''
          logger.debug(`[群昵称设置] 当前昵称: "${currentNickname}"`)
          
          // 如果当前昵称和目标昵称一致，跳过修改
          if (currentNickname === newNickname) {
            logger.info(`[群昵称设置] QQ(${normalizedUserId})群昵称已经是"${newNickname}"，跳过修改`)
            return
          }
          
          // 昵称不一致，执行修改
          logger.debug(`[群昵称设置] 昵称不一致，正在修改群昵称...`)
          await session.bot.internal.setGroupCard(targetGroupId, normalizedUserId, newNickname)
          logger.info(`[群昵称设置] 成功在群${targetGroupId}中将QQ(${normalizedUserId})群昵称从"${currentNickname}"修改为"${newNickname}"`)
          
          // 验证设置是否生效 - 再次获取群昵称确认
          try {
            await new Promise(resolve => setTimeout(resolve, 1000)) // 等待1秒
            const verifyGroupInfo = await session.bot.internal.getGroupMemberInfo(targetGroupId, normalizedUserId)
            const verifyNickname = verifyGroupInfo.card || verifyGroupInfo.nickname || ''
            if (verifyNickname === newNickname) {
              logger.info(`[群昵称设置] ✅ 验证成功，群昵称已生效: "${verifyNickname}"`)
            } else {
              logger.warn(`[群昵称设置] ⚠️ 验证失败，期望"${newNickname}"，实际"${verifyNickname}"，可能是权限不足或API延迟`)
            }
          } catch (verifyError) {
            logger.warn(`[群昵称设置] 无法验证群昵称设置结果: ${verifyError.message}`)
          }
        } catch (getInfoError) {
          // 如果获取当前昵称失败，直接尝试设置新昵称
          logger.warn(`[群昵称设置] 获取QQ(${normalizedUserId})当前群昵称失败: ${getInfoError.message}`)
          logger.warn(`[群昵称设置] 错误详情: ${JSON.stringify(getInfoError)}`)
          logger.debug(`[群昵称设置] 将直接尝试设置新昵称...`)
          
          try {
          await session.bot.internal.setGroupCard(targetGroupId, normalizedUserId, newNickname)
          logger.info(`[群昵称设置] 成功在群${targetGroupId}中将QQ(${normalizedUserId})群昵称设置为: ${newNickname}`)
            
            // 验证设置是否生效
            try {
              await new Promise(resolve => setTimeout(resolve, 1000)) // 等待1秒
              const verifyGroupInfo = await session.bot.internal.getGroupMemberInfo(targetGroupId, normalizedUserId)
              const verifyNickname = verifyGroupInfo.card || verifyGroupInfo.nickname || ''
              if (verifyNickname === newNickname) {
                logger.info(`[群昵称设置] ✅ 验证成功，群昵称已生效: "${verifyNickname}"`)
              } else {
                logger.warn(`[群昵称设置] ⚠️ 验证失败，期望"${newNickname}"，实际"${verifyNickname}"，可能是权限不足`)
                logger.warn(`[群昵称设置] 建议检查: 1.机器人是否为群管理员 2.群设置是否允许管理员修改昵称 3.OneBot实现是否支持该功能`)
              }
            } catch (verifyError) {
              logger.warn(`[群昵称设置] 无法验证群昵称设置结果: ${verifyError.message}`)
            }
          } catch (setCardError) {
            logger.error(`[群昵称设置] 设置群昵称失败: ${setCardError.message}`)
            logger.error(`[群昵称设置] 错误详情: ${JSON.stringify(setCardError)}`)
            throw setCardError
          }
        }
      } else if (!session.bot.internal) {
        logger.debug(`[群昵称设置] QQ(${normalizedUserId})bot不支持OneBot内部API，跳过自动群昵称设置`)
      } else if (!targetGroupId) {
        logger.debug(`[群昵称设置] QQ(${normalizedUserId})未配置自动群昵称设置目标群，跳过群昵称设置`)
      }
    } catch (error) {
      const actualUserId = targetUserId || session.userId
      const normalizedUserId = normalizeQQId(actualUserId)
      logger.error(`[群昵称设置] QQ(${normalizedUserId})自动群昵称设置失败: ${error.message}`)
      logger.error(`[群昵称设置] 完整错误信息: ${JSON.stringify(error)}`)
    }
  }

  // 检查是否为无关输入
  const checkIrrelevantInput = (bindingSession: BindingSession, content: string): boolean => {
    if (!content) return false
    
    // 常见的聊天用语或明显无关的内容
    const chatKeywords = ['你好', 'hello', 'hi', '在吗', '在不在', '怎么样', '什么', '为什么', '好的', '谢谢', '哈哈', '呵呵', '早上好', '晚上好', '晚安', '再见', '拜拜', '666', '牛', '厉害', '真的吗', '不是吧', '哇', '哦', '嗯', '好吧', '行', '可以', '没事', '没问题', '没关系']
    const lowercaseContent = content.toLowerCase()
    
    // 检查是否包含明显的聊天用语
    if (chatKeywords.some(keyword => lowercaseContent.includes(keyword))) {
      return true
    }
    
    // 检查是否为明显的聊天模式（多个连续的标点符号、表情等）
    if (/[！？。，；：""''（）【】〈〉《》「」『』〔〕〖〗〘〙〚〛]{2,}/.test(content) || 
        /[!?.,;:"'()[\]<>{}]{3,}/.test(content)) {
      return true
    }
    
    if (bindingSession.state === 'waiting_mc_username') {
      // 先排除跳过命令，这些是有效输入
      if (content === '跳过' || content === 'skip') {
        return false
      }
      
      // MC用户名检查
      // 长度明显不符合MC用户名规范（3-16位）
      if (content.length < 2 || content.length > 20) {
        return true
      }
      // 包含中文或其他明显不是MC用户名的字符
      if (/[\u4e00-\u9fa5]/.test(content) || content.includes(' ') || content.includes('@')) {
        return true
      }
      // 如果是明显的指令格式
      if (content.startsWith('.') || content.startsWith('/') || content.startsWith('mcid') || content.startsWith('buid')) {
        return true
      }
    } else if (bindingSession.state === 'waiting_buid') {
      // B站UID检查
      // 移除UID:前缀后检查
      let actualContent = content
      if (content.toLowerCase().startsWith('uid:')) {
        actualContent = content.substring(4)
      }
      // 如果不是纯数字且不是跳过命令
      if (!/^\d+$/.test(actualContent) && content !== '跳过' && content !== 'skip') {
        // 检查是否明显是聊天内容（包含字母、中文、空格等）
        if (/[a-zA-Z\u4e00-\u9fa5\s]/.test(content) && !content.toLowerCase().startsWith('uid:')) {
          return true
        }
        // 如果是明显的指令格式
        if (content.startsWith('.') || content.startsWith('/') || content.startsWith('mcid') || content.startsWith('buid')) {
          return true
        }
      }
    }
    
    return false
  }
  
  // 根据配置获取命令前缀
  const getCommandPrefix = (): string => {
    if (config.allowTextPrefix && config.botNickname) {
      // 检查botNickname是否已经包含@符号，避免重复添加
      const nickname = config.botNickname.startsWith('@') ? 
        config.botNickname :
        `@${config.botNickname}`;
      return `${nickname} `;
    }
    return '';
  };
  
  // 格式化命令提示
  const formatCommand = (cmd: string): string => {
    return `${getCommandPrefix()}${cmd}`;
  };
  
  // 简单的锁机制，用于防止并发操作
  const operationLocks: Record<string, boolean> = {};
  
  // 获取锁
  const acquireLock = (key: string): boolean => {
    if (operationLocks[key]) {
      return false;
    }
    operationLocks[key] = true;
    return true;
  };
  
  // 释放锁
  const releaseLock = (key: string): void => {
    operationLocks[key] = false;
  };
  
  // 使用锁执行异步操作
  const withLock = async <T>(key: string, operation: () => Promise<T>, timeoutMs = 10000): Promise<T> => {
    // 操作ID，用于日志
    const operationId = Math.random().toString(36).substr(2, 9);
    
    // 尝试获取锁
    let acquired = false;
    let attempts = 0;
    const maxAttempts = 5;
    
    while (!acquired && attempts < maxAttempts) {
      acquired = acquireLock(key);
      if (!acquired) {
        logger.debug(`[锁] 操作${operationId}等待锁 ${key} 释放 (尝试 ${attempts + 1}/${maxAttempts})`);
        // 等待一段时间后重试
        await new Promise(resolve => setTimeout(resolve, 200));
        attempts++;
      }
    }
    
    if (!acquired) {
      logger.warn(`[锁] 操作${operationId}无法获取锁 ${key}，强制获取`);
      // 强制获取锁
      acquireLock(key);
    }
    
    try {
      // 设置超时
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`操作超时 (${timeoutMs}ms)`)), timeoutMs);
      });
      
      // 执行操作
      const operationPromise = operation();
      const result = await Promise.race([operationPromise, timeoutPromise]);
      return result;
    } finally {
      // 无论成功失败，都释放锁
      releaseLock(key);
      logger.debug(`[锁] 操作${operationId}释放锁 ${key}`);
    }
  };

  // 插件销毁时关闭所有RCON连接
  ctx.on('dispose', async () => {
    logger.info('[RCON管理器] 插件卸载，关闭所有RCON连接');
    await rconManager.closeAll();
  });

  // 监听群成员加入事件，自动启动绑定流程
  ctx.on('guild-member-added', async (session) => {
    try {
      // 只处理指定群的成员加入
      if (session.channelId !== config.autoNicknameGroupId) {
        return;
      }
      
      const normalizedUserId = normalizeQQId(session.userId);
      logger.info(`[新人绑定] 用户QQ(${normalizedUserId})加入群聊，准备发送绑定提醒`);
      
      // 检查用户是否已有绑定记录
      const existingBind = await getMcBindByQQId(normalizedUserId);
      
      // 如果用户已完成全部绑定，不需要提醒
      if (existingBind && existingBind.mcUsername && existingBind.buidUid) {
        logger.info(`[新人绑定] 用户QQ(${normalizedUserId})已完成全部绑定，跳过提醒`);
        return;
      }
      
      // 检查是否在禁言时间段内
      const inMuteTime = await isInMuteTime(session.channelId);
      
      // 发送欢迎消息
      let welcomeMessage = `🎉 欢迎新成员 ${h.at(session.userId)} 加入群聊！\n\n`;
      
      if (!existingBind || (!existingBind.mcUsername && !existingBind.buidUid)) {
        // 完全未绑定
        if (inMuteTime) {
          // 在禁言时间内，只发送欢迎消息和基本提醒
          welcomeMessage += `📋 请在非禁言时间段使用 ${formatCommand('buid bind <B站UID>')} 绑定B站账号\n`;
          welcomeMessage += `🎮 也可以使用 ${formatCommand('mcid bind <MC用户名>')} 绑定MC账号`;
          
          await session.bot.sendMessage(session.channelId, welcomeMessage);
          logger.info(`[新人绑定] 新成员QQ(${normalizedUserId})在禁言时间内，仅发送欢迎消息，不启动绑定流程`);
        } else {
          // 不在禁言时间，自动启动交互式绑定
          welcomeMessage += `📋 请选择绑定方式：\n1️⃣ 发送您的B站UID进行B站绑定\n2️⃣ 发送"跳过"仅绑定MC账号`;
          
          await session.bot.sendMessage(session.channelId, welcomeMessage);
          logger.info(`[新人绑定] 为新成员QQ(${normalizedUserId})自动启动交互式绑定流程`);
          
          // 创建绑定会话并发送初始提示
          createBindingSession(session.userId, session.channelId);
          const bindingSession = getBindingSession(session.userId, session.channelId);
          bindingSession.state = 'waiting_buid';
        }
        
      } else if (existingBind.mcUsername && !existingBind.buidUid) {
        // 只绑定了MC，未绑定B站
        // 检查是否为有效的MC绑定（非临时用户名）
        if (existingBind.mcUsername.startsWith('_temp_')) {
          // 临时用户名，实际上应该是只绑定了B站但MC是临时的，不应该进入这个分支
          // 这种情况应该按照"只绑定了B站"处理
          welcomeMessage += `📋 检测到您已绑定B站账号，但尚未绑定MC账号\n`;
          welcomeMessage += `🎮 可使用 ${formatCommand('mcid bind <MC用户名>')} 绑定MC账号`;
          
          await session.bot.sendMessage(session.channelId, welcomeMessage);
          logger.info(`[新人绑定] 新成员QQ(${normalizedUserId})实际只绑定了B站（MC为临时用户名），已发送绑定提醒`);
        } else {
          // 真正绑定了MC账号
          const displayUsername = existingBind.mcUsername
          welcomeMessage += `🎮 已绑定MC: ${displayUsername}\n`;
          
          if (inMuteTime) {
            // 在禁言时间内，只发送状态信息
            welcomeMessage += `📋 请在非禁言时间段使用 ${formatCommand('buid bind <B站UID>')} 绑定B站账号`;
            await session.bot.sendMessage(session.channelId, welcomeMessage);
            logger.info(`[新人绑定] 新成员QQ(${normalizedUserId})在禁言时间内，仅发送绑定状态提醒`);
          } else {
            // 不在禁言时间，自动启动B站绑定
            welcomeMessage += `📋 请发送您的B站UID进行绑定`;
            await session.bot.sendMessage(session.channelId, welcomeMessage);
            logger.info(`[新人绑定] 为新成员QQ(${normalizedUserId})自动启动B站绑定流程`);
            
            // 创建绑定会话，直接进入B站绑定步骤
            createBindingSession(session.userId, session.channelId);
            const bindingSession = getBindingSession(session.userId, session.channelId);
            bindingSession.state = 'waiting_buid';
            bindingSession.mcUsername = existingBind.mcUsername;
          }
        }
        
      } else if (!existingBind.mcUsername && existingBind.buidUid) {
        // 只绑定了B站，未绑定MC - 仅发送提醒
        welcomeMessage += `📋 检测到您已绑定B站账号，但尚未绑定MC账号\n`;
        welcomeMessage += `🎮 可使用 ${formatCommand('mcid bind <MC用户名>')} 绑定MC账号`;
        
        await session.bot.sendMessage(session.channelId, welcomeMessage);
        logger.info(`[新人绑定] 新成员QQ(${normalizedUserId})已绑定B站但未绑定MC，已发送绑定提醒`);
      } else if (existingBind.mcUsername && existingBind.mcUsername.startsWith('_temp_') && existingBind.buidUid) {
        // MC是临时用户名但已绑定B站 - 也按照"只绑定了B站"处理
        welcomeMessage += `📋 检测到您已绑定B站账号，但尚未绑定MC账号\n`;
        welcomeMessage += `🎮 可使用 ${formatCommand('mcid bind <MC用户名>')} 绑定MC账号`;
        
        await session.bot.sendMessage(session.channelId, welcomeMessage);
        logger.info(`[新人绑定] 新成员QQ(${normalizedUserId})已绑定B站但MC为临时用户名，已发送绑定提醒`);
      }
      
      logger.info(`[新人绑定] 已处理新成员QQ(${normalizedUserId})的入群事件`);
      
    } catch (error) {
      logger.error(`[新人绑定] 处理新成员加入失败: ${error.message}`);
    }
  });

  // 注册天选开奖 Webhook
  ctx.server.post('/lottery', async (content) => {
    try {
      logger.info(`[天选开奖] 收到天选开奖webhook请求`)
      
      // 检查天选播报开关
      if (!config?.enableLotteryBroadcast) {
        logger.info(`[天选开奖] 天选播报功能已禁用，忽略webhook请求`)
        content.status = 200
        content.body = 'Lottery broadcast disabled'
        return
      }
      
      // 检查请求头
      const userAgent = content.header['user-agent'] || content.header['User-Agent']
      if (userAgent && !userAgent.includes('ZMINFO-EventBridge')) {
        logger.warn(`[天选开奖] 无效的User-Agent: ${userAgent}`)
        content.status = 400
        content.body = 'Invalid User-Agent'
        return
      }
      
      // 解析请求数据
      let lotteryData: LotteryResult
      try {
        // 如果是字符串，尝试解析为JSON
        if (typeof content.request.body === 'string') {
          lotteryData = JSON.parse(content.request.body)
        } else {
          lotteryData = content.request.body as LotteryResult
        }
      } catch (parseError) {
        logger.error(`[天选开奖] 解析请求数据失败: ${parseError.message}`)
        content.status = 400
        content.body = 'Invalid JSON format'
        return
      }
      
      // 验证数据格式
      if (!lotteryData.type || lotteryData.type !== 'lottery-result') {
        logger.warn(`[天选开奖] 无效的事件类型: ${lotteryData.type}`)
        content.status = 400
        content.body = 'Invalid event type'
        return
      }
      
      if (!lotteryData.lottery_id || !lotteryData.winners || !Array.isArray(lotteryData.winners)) {
        logger.warn(`[天选开奖] 数据格式不完整`)
        content.status = 400
        content.body = 'Incomplete data format'
        return
      }
      
      // 记录接收的数据
      if (config.debugMode) {
        logger.debug(`[天选开奖] 接收到的数据: ${JSON.stringify(lotteryData, null, 2)}`)
      } else {
        logger.info(`[天选开奖] 接收到天选事件: ${lotteryData.lottery_id}，奖品: ${lotteryData.reward_name}，中奖人数: ${lotteryData.winners.length}`)
      }
      
      // 异步处理天选开奖数据（不阻塞响应）
      handleLotteryResult(lotteryData).catch(error => {
        logger.error(`[天选开奖] 异步处理天选开奖数据失败: ${error.message}`)
      })
      
      // 立即返回成功响应
      content.status = 200
      content.body = 'OK'
      
    } catch (error) {
      logger.error(`[天选开奖] 处理webhook请求失败: ${error.message}`)
      content.status = 500
      content.body = 'Internal Server Error'
    }
  });

  // 在数据库中创建MCIDBIND表
  ctx.model.extend('mcidbind', {
    qqId: {
      type: 'string',
    },
    mcUsername: {
      type: 'string',
      initial: '',
    },
    mcUuid: {
      type: 'string',
      initial: '',
    },
    lastModified: {
      type: 'timestamp',
      initial: null,
    },
    isAdmin: {
      type: 'boolean',
      initial: false,
    },
    whitelist: {
      type: 'json',
      initial: [],
    },
    tags: {
      type: 'json',
      initial: [],
    },
    // BUID相关字段
    buidUid: {
      type: 'string',
      initial: '',
    },
    buidUsername: {
      type: 'string',
      initial: '',
    },
    guardLevel: {
      type: 'integer',
      initial: 0,
    },
    guardLevelText: {
      type: 'string',
      initial: '',
    },
    maxGuardLevel: {
      type: 'integer',
      initial: 0,
    },
    maxGuardLevelText: {
      type: 'string',
      initial: '',
    },
    medalName: {
      type: 'string',
      initial: '',
    },
    medalLevel: {
      type: 'integer',
      initial: 0,
    },
    wealthMedalLevel: {
      type: 'integer',
      initial: 0,
    },
    lastActiveTime: {
      type: 'timestamp',
      initial: null,
    },
    reminderCount: {
      type: 'integer',
      initial: 0,
    },
  }, {
    // 设置主键为qqId
    primary: 'qqId',
    // 添加索引
    unique: [['mcUsername'], ['buidUid']],
    // 添加isAdmin索引，提高查询效率
    indexes: [['isAdmin'], ['buidUid']],
  })



  // 检查表结构是否包含旧字段
  const checkTableStructure = async (): Promise<boolean> => {
    try {
      // 尝试获取一条记录来检查字段
      const records = await mcidbindRepo.findAll({ limit: 1 })

      // 如果没有记录，不需要迁移
      if (!records || records.length === 0) return false
      
      // 检查记录中是否包含id或userId字段，或缺少whitelist字段
      const record = records[0]
      return 'id' in record || 'userId' in record || !('whitelist' in record)
    } catch (error) {
      logger.error(`[初始化] 检查表结构失败: ${error.message}`)
      return false
    }
  }
  
  // 添加缺失字段
  const addMissingFields = async (): Promise<boolean> => {
    try {
      // 获取所有记录
      const records = await mcidbindRepo.findAll()

      let updatedCount = 0
      
      // 更新每个缺少字段的记录
      for (const record of records) {
        let needUpdate = false
        const updateData: any = {}
        
        // 检查并添加whitelist字段
        if (!record.whitelist) {
          updateData.whitelist = []
          needUpdate = true
        }
        
        // 检查并添加tags字段
        if (!record.tags) {
          updateData.tags = []
          needUpdate = true
        }
        
        // 检查并添加maxGuardLevel字段
        if (!('maxGuardLevel' in record)) {
          updateData.maxGuardLevel = 0
          needUpdate = true
        }
        
        // 检查并添加maxGuardLevelText字段
        if (!('maxGuardLevelText' in record)) {
          updateData.maxGuardLevelText = ''
          needUpdate = true
        }
        
        // 检查并添加reminderCount字段
        if (!('reminderCount' in record)) {
          updateData.reminderCount = 0
          needUpdate = true
        }
        
        // 如果需要更新，执行更新操作
        if (needUpdate) {
          await mcidbindRepo.update(record.qqId, updateData)
          updatedCount++
        }
      }
      
      if (updatedCount > 0) {
        logger.info(`[初始化] 成功为${updatedCount}条记录添加缺失字段`)
      } else {
        logger.info(`[初始化] 所有记录都包含必要字段，无需更新`)
      }
      return true
    } catch (error) {
      logger.error(`[初始化] 添加缺失字段失败: ${error.message}`)
      return false
    }
  }
  
  // 重建MCIDBIND表
  const rebuildMcidBindTable = async () => {
    try {
      // 备份现有数据
      const oldRecords = await mcidbindRepo.findAll()
      logger.info(`[初始化] 成功备份${oldRecords.length}条记录`)
      
      // 创建数据备份（用于恢复）
      const backupData = JSON.parse(JSON.stringify(oldRecords))
      
      try {
        // 提取有效数据
        const validRecords = oldRecords.map(record => {
          // 确保qqId存在
          if (!record.qqId) {
            // 如果没有qqId但有userId，尝试从userId提取
            if ('userId' in record && record.userId) {
              record.qqId = normalizeQQId(String(record.userId))
            } else {
              // 既没有qqId也没有userId，跳过此记录
              return null
            }
          }
          
          return {
            qqId: record.qqId,
            mcUsername: record.mcUsername || '',
            mcUuid: record.mcUuid || '',
            lastModified: record.lastModified || new Date(),
            isAdmin: record.isAdmin || false,
            whitelist: record.whitelist || [],
            tags: record.tags || []
          }
        }).filter(record => record !== null)

        // 删除现有表
        await mcidbindRepo.deleteAll()
        logger.info('[初始化] 成功删除旧表数据')

        // 重新创建记录
        let successCount = 0
        let errorCount = 0

        for (const record of validRecords) {
          try {
            await mcidbindRepo.create(record)
            successCount++
          } catch (e) {
            errorCount++
            logger.warn(`[初始化] 重建记录失败 (QQ=${record.qqId}): ${e.message}`)
          }
        }
        
        logger.info(`[初始化] 成功重建了${successCount}条记录，失败${errorCount}条`)
        return true
      } catch (migrationError) {
        // 迁移过程出错，尝试恢复
        logger.error(`[初始化] 表重建过程失败，尝试恢复数据: ${migrationError.message}`)

        try {
          // 清空表以避免重复数据
          await mcidbindRepo.deleteAll()

          // 恢复原始数据
          for (const record of backupData) {
            await mcidbindRepo.create(record)
          }

          logger.info(`[初始化] 成功恢复${backupData.length}条原始记录`)
        } catch (recoveryError) {
          logger.error(`[初始化] 数据恢复失败，可能导致数据丢失: ${recoveryError.message}`)
          throw new Error('数据迁移失败且无法恢复')
        }
        
        throw migrationError
      }
    } catch (error) {
      logger.error(`[初始化] 重建表失败: ${error.message}`)
      throw error
    }
  }

  // 处理用户ID，去除平台前缀，只保留QQ号
  const normalizeQQId = (userId: string): string => {
    // 处理空值情况
    if (!userId) {
      logger.warn(`[用户ID] 收到空用户ID`)
      return ''
    }
    
    let extractedId = ''
    
    // 检查是否是手动输入的@符号（错误用法）
    if (userId.startsWith('@') && !userId.match(/<at\s+id="[^"]+"\s*\/>/)) {
      logger.warn(`[用户ID] 检测到手动输入的@符号"${userId}"，应使用真正的@功能`)
      return ''  // 返回空字符串表示无效
    }
    
    // 处理 <at id="..."/> 格式的@用户字符串
    const atMatch = userId.match(/<at id="(\d+)"\s*\/>/)
    if (atMatch) {
      extractedId = atMatch[1]
    } else {
      // 如果包含冒号，说明有平台前缀(如 onebot:123456)
      const colonIndex = userId.indexOf(':')
      if (colonIndex !== -1) {
        extractedId = userId.substring(colonIndex + 1)
      } else {
        extractedId = userId
      }
    }
    
    // 验证提取的ID是否为纯数字QQ号
    if (!/^\d+$/.test(extractedId)) {
      logger.warn(`[用户ID] 提取的ID"${extractedId}"不是有效的QQ号(必须为纯数字)，来源: ${userId}`)
      return ''  // 返回空字符串表示无效
    }
    
    // 检查QQ号长度是否合理(QQ号通常为5-12位数字)
    if (extractedId.length < 5 || extractedId.length > 12) {
      logger.warn(`[用户ID] QQ号"${extractedId}"长度异常(${extractedId.length}位)，有效范围为5-12位`)
      return ''
    }
    
    return extractedId
  }

  // 获取用户友好的错误信息

  // 封装发送消息的函数，处理私聊和群聊的不同格式
  const sendMessage = async (session: Session, content: any[], options?: { isProactiveMessage?: boolean }): Promise<void> => {
    try {
      if (!session) {
        logError('消息', 'system', '无效的会话对象')
        return
      }
      
      // 检查是否为群聊消息
      const isGroupMessage = session.channelId && !session.channelId.startsWith('private:');
      const normalizedQQId = normalizeQQId(session.userId)
      const isProactiveMessage = options?.isProactiveMessage || false
      
      // 处理私聊和群聊的消息格式
      // 主动消息不引用原消息
      const promptMessage = session.channelId?.startsWith('private:')
        ? (isProactiveMessage ? content : [h.quote(session.messageId), ...content])
        : (isProactiveMessage ? [h.at(normalizedQQId), '\n', ...content] : [h.quote(session.messageId), h.at(normalizedQQId), '\n', ...content])

      // 发送消息并获取返回的消息ID
      const messageResult = await session.send(promptMessage)
      
      if (config.debugMode) {
        logDebug('消息', `成功向QQ(${normalizedQQId})发送消息，频道: ${session.channelId}`)
      }
      
      // 只在自动撤回时间大于0和存在bot对象时处理撤回
      if (config.autoRecallTime > 0 && session.bot) {
        // 处理撤回用户消息 - 只在群聊中且开启了用户消息撤回时
        // 但如果用户在绑定会话中发送聊天消息（不包括指令），不撤回
        // 主动消息不撤回用户消息
        const bindingSession = getBindingSession(session.userId, session.channelId)
        const isBindingCommand = session.content && (
          session.content.trim() === '绑定' ||
          session.content.includes('@') && session.content.includes('绑定')
        )
        const shouldNotRecallUserMessage = bindingSession && session.content && 
          !isBindingCommand && checkIrrelevantInput(bindingSession, session.content.trim())
        
        if (config.recallUserMessage && isGroupMessage && session.messageId && !shouldNotRecallUserMessage && !isProactiveMessage) {
          setTimeout(async () => {
            try {
              await session.bot.deleteMessage(session.channelId, session.messageId)
              if (config.debugMode) {
                logDebug('消息', `成功撤回用户QQ(${normalizedQQId})的指令消息 ${session.messageId}`)
              }
            } catch (userRecallError) {
              logError('消息', normalizedQQId, `撤回用户指令消息 ${session.messageId} 失败: ${userRecallError.message}`)
            }
          }, config.autoRecallTime * 1000)
          
          if (config.debugMode) {
            logDebug('消息', `已设置 ${config.autoRecallTime} 秒后自动撤回用户QQ(${normalizedQQId})的群聊指令消息 ${session.messageId}`)
          }
        } else if (shouldNotRecallUserMessage && config.debugMode) {
          logDebug('消息', `QQ(${normalizedQQId})在绑定会话中发送聊天消息，跳过撤回用户消息`)
        } else if (isProactiveMessage && config.debugMode) {
          logDebug('消息', `主动发送的消息，跳过撤回用户消息`)
        }
        
        // 处理撤回机器人消息 - 只在群聊中撤回机器人自己的消息
        // 检查是否为不应撤回的重要提示消息（只有绑定会话超时提醒）
        const shouldNotRecall = content.some(element => {
          // 检查h.text类型的元素
          if (typeof element === 'string') {
            return element.includes('绑定会话已超时，请重新开始绑定流程');
          }
          // 检查可能的对象结构
          if (typeof element === 'object' && element && 'toString' in element) {
            const text = element.toString();
            return text.includes('绑定会话已超时，请重新开始绑定流程');
          }
          return false;
        });
        
        if (isGroupMessage && messageResult && !shouldNotRecall) {
          // 获取消息ID
          let messageId: string | undefined
          
          if (typeof messageResult === 'string') {
            messageId = messageResult
          } else if (Array.isArray(messageResult) && messageResult.length > 0) {
            messageId = messageResult[0]
          } else if (messageResult && typeof messageResult === 'object') {
            // 尝试提取各种可能的消息ID格式
            messageId = (messageResult as any).messageId || 
                     (messageResult as any).id || 
                     (messageResult as any).message_id
          }
          
          if (messageId) {
            // 设置定时器延迟撤回
            setTimeout(async () => {
              try {
                await session.bot.deleteMessage(session.channelId, messageId)
                if (config.debugMode) {
                  logDebug('消息', `成功撤回机器人消息 ${messageId}`)
                }
              } catch (recallError) {
                logError('消息', normalizedQQId, `撤回机器人消息 ${messageId} 失败: ${recallError.message}`)
              }
            }, config.autoRecallTime * 1000)
            
            if (config.debugMode) {
              logDebug('消息', `已设置 ${config.autoRecallTime} 秒后自动撤回机器人消息 ${messageId}`)
            }
          } else if (config.debugMode) {
            logWarn('消息', `无法获取消息ID，自动撤回功能无法生效`)
          }
        } else if (config.debugMode) {
          logDebug('消息', `检测到私聊消息，不撤回机器人回复`)
        }
      }
    } catch (error) {
      const normalizedUserId = normalizeQQId(session.userId)
      logError('消息', normalizedUserId, `向QQ(${normalizedUserId})发送消息失败: ${error.message}`)
    }
  }

  // 检查冷却时间
  const checkCooldown = (lastModified: Date | null, multiplier: number = 1): boolean => {
    if (!lastModified) return true
    const now = new Date()
    const diffTime = now.getTime() - lastModified.getTime()
    // 使用Math.floor确保冷却时间精确
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24))
    return diffDays >= config.cooldownDays * multiplier
  }
  
  // 根据QQ号查询MCIDBIND表中的绑定信息
  const getMcBindByQQId = async (qqId: string): Promise<MCIDBIND | null> => {
    try {
      // 处理空值
      if (!qqId) {
        logger.warn(`[MCIDBIND] 尝试查询空QQ号`)
        return null
      }
      
      const normalizedQQId = normalizeQQId(qqId)
      // 查询MCIDBIND表中对应QQ号的绑定记录
      return await mcidbindRepo.findByQQId(normalizedQQId)
    } catch (error) {
      logError('MCIDBIND', qqId, `根据QQ号查询绑定信息失败: ${error.message}`)
      return null
    }
  }
  
  // 根据MC用户名查询MCIDBIND表中的绑定信息
  const getMcBindByUsername = async (mcUsername: string): Promise<MCIDBIND | null> => {
    // 处理空值
    if (!mcUsername) {
      logger.warn(`[MCIDBIND] 尝试查询空MC用户名`)
      return null
    }

    // 使用 Repository 查询
    return await mcidbindRepo.findByMCUsername(mcUsername)
  }
  
  // 根据QQ号确保获取完整的用户ID (处理纯QQ号的情况)
  const ensureFullUserId = (userId: string): string => {
    // 如果已经包含冒号，说明已经是完整的用户ID
    if (userId.includes(':')) return userId
    
    // 否则，检查是否为数字（纯QQ号）
    if (/^\d+$/.test(userId)) {
      // 默认使用onebot平台前缀
      return `onebot:${userId}`
    }
    
    // 如果不是数字也没有冒号，保持原样返回
    logger.warn(`[用户ID] 无法确定用户ID格式: ${userId}`)
    return userId
  }

  // 创建或更新MCIDBIND表中的绑定信息
  const createOrUpdateMcBind = async (userId: string, mcUsername: string, mcUuid: string, isAdmin?: boolean): Promise<boolean> => {
    try {
      // 验证输入参数
      if (!userId) {
        logger.error(`[MCIDBIND] 创建/更新绑定失败: 无效的用户ID`)
        return false
      }
      
      if (!mcUsername) {
        logger.error(`[MCIDBIND] 创建/更新绑定失败: 无效的MC用户名`)
        return false
      }
      
      const normalizedQQId = normalizeQQId(userId)
      if (!normalizedQQId) {
        logger.error(`[MCIDBIND] 创建/更新绑定失败: 无法提取有效的QQ号`)
        return false
      }
      
      // 查询是否已存在绑定记录
      let bind = await getMcBindByQQId(normalizedQQId)
      
      if (bind) {
        // 更新现有记录，但保留管理员状态
        const updateData: any = {
          mcUsername,
          mcUuid,
          lastModified: new Date()
        }
        
        // 仅当指定了isAdmin参数时更新管理员状态
        if (typeof isAdmin !== 'undefined') {
          updateData.isAdmin = isAdmin
        }

        await mcidbindRepo.update(normalizedQQId, updateData)
        logger.info(`[MCIDBIND] 更新绑定: QQ=${normalizedQQId}, MC用户名=${mcUsername}, UUID=${mcUuid}`)
        return true
      } else {
        // 创建新记录
        try {
          await mcidbindRepo.create({
            qqId: normalizedQQId,
            mcUsername,
            mcUuid,
            lastModified: new Date(),
            isAdmin: isAdmin || false
          })
          logger.info(`[MCIDBIND] 创建绑定: QQ=${normalizedQQId}, MC用户名=${mcUsername}, UUID=${mcUuid}`)
          return true
        } catch (createError) {
          logError('MCIDBIND', userId, `创建绑定失败: MC用户名=${mcUsername}, 错误=${createError.message}`)
          return false
        }
      }
    } catch (error) {
      logError('MCIDBIND', userId, `创建/更新绑定失败: MC用户名=${mcUsername}, 错误=${error.message}`)
      return false
    }
  }
  
  // 删除MCIDBIND表中的绑定信息 (同时解绑MC和B站账号)
  const deleteMcBind = async (userId: string): Promise<boolean> => {
    try {
      // 验证输入参数
      if (!userId) {
        logger.error(`[MCIDBIND] 删除绑定失败: 无效的用户ID`)
        return false
      }
      
      const normalizedQQId = normalizeQQId(userId)
      if (!normalizedQQId) {
        logger.error(`[MCIDBIND] 删除绑定失败: 无法提取有效的QQ号`)
        return false
      }
      
      // 查询是否存在绑定记录
      const bind = await getMcBindByQQId(normalizedQQId)
      
      if (bind) {
        // 删除整个绑定记录，包括MC和B站账号
        const removedCount = await mcidbindRepo.delete(normalizedQQId)

        // 检查是否真正删除成功
        if (removedCount > 0) {
          let logMessage = `[MCIDBIND] 删除绑定: QQ=${normalizedQQId}`
          if (bind.mcUsername) logMessage += `, MC用户名=${bind.mcUsername}`
          if (bind.buidUid) logMessage += `, B站UID=${bind.buidUid}(${bind.buidUsername})`
          logger.info(logMessage)
          return true
        } else {
          logger.warn(`[MCIDBIND] 删除绑定异常: QQ=${normalizedQQId}, 可能未实际删除`)
          return false
        }
      }
      
      logger.warn(`[MCIDBIND] 删除绑定失败: QQ=${normalizedQQId}不存在绑定记录`)
      return false
    } catch (error) {
      logError('MCIDBIND', userId, `删除绑定失败: 错误=${error.message}`)
      return false
    }
  }

  // 检查MC用户名是否已被其他QQ号绑定（支持不区分大小写和UUID检查）
  const checkUsernameExists = async (username: string, currentUserId?: string, uuid?: string): Promise<boolean> => {
    try {
      // 验证输入参数
      if (!username) {
        logger.warn(`[绑定检查] 尝试检查空MC用户名`)
        return false
      }

      // 跳过临时用户名的检查
      if (username.startsWith('_temp_')) {
        return false
      }

      // 使用不区分大小写的查询
      const bind = await mcidbindRepo.findByUsernameIgnoreCase(username)

      // 如果没有绑定，返回false
      if (!bind) return false

      // 如果绑定的用户名是临时用户名，视为未绑定
      if (bind.mcUsername && bind.mcUsername.startsWith('_temp_')) {
        return false
      }

      // 如果提供了 UUID，检查是否为同一个 MC 账号（用户改名场景）
      if (uuid && bind.mcUuid) {
        const cleanUuid = uuid.replace(/-/g, '')
        const bindCleanUuid = bind.mcUuid.replace(/-/g, '')

        if (cleanUuid === bindCleanUuid) {
          // 同一个 UUID，说明是用户改名，允许绑定
          logger.info(`[绑定检查] 检测到MC账号改名: UUID=${uuid}, 旧用户名=${bind.mcUsername}, 新用户名=${username}`)
          return false
        }
      }

      // 如果提供了当前用户ID，需要排除当前用户
      if (currentUserId) {
        const normalizedCurrentId = normalizeQQId(currentUserId)
        // 如果绑定的用户就是当前用户，返回false，表示没有被其他用户绑定
        return normalizedCurrentId ? bind.qqId !== normalizedCurrentId : true
      }

      return true
    } catch (error) {
      logError('绑定检查', currentUserId || 'system', `检查用户名"${username}"是否已被绑定失败: ${error.message}`)
      return false
    }
  }

  // 使用Mojang API验证用户名并获取UUID
  const validateUsername = async (username: string): Promise<MojangProfile | null> => {
    try {
      logger.debug(`[Mojang API] 开始验证用户名: ${username}`)
      const response = await axios.get(`https://api.mojang.com/users/profiles/minecraft/${username}`, {
        timeout: 10000, // 添加10秒超时
        headers: {
          'User-Agent': 'KoishiMCVerifier/1.0', // 添加User-Agent头
        }
      })
      
      if (response.status === 200 && response.data) {
        logger.debug(`[Mojang API] 用户名"${username}"验证成功，UUID: ${response.data.id}，标准名称: ${response.data.name}`)
        return {
          id: response.data.id,
          name: response.data.name // 使用Mojang返回的正确大小写
        }
      }
     
      return null
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        logger.warn(`[Mojang API] 用户名"${username}"不存在`)
      } else if (axios.isAxiosError(error) && error.code === 'ECONNABORTED') {
        logger.error(`[Mojang API] 验证用户名"${username}"时请求超时: ${error.message}`)
      } else {
        // 记录更详细的错误信息
        const errorMessage = axios.isAxiosError(error) 
          ? `${error.message}，响应状态: ${error.response?.status || '未知'}\n响应数据: ${JSON.stringify(error.response?.data || '无数据')}`
          : error.message || '未知错误';
        logger.error(`[Mojang API] 验证用户名"${username}"时发生错误: ${errorMessage}`)
        
        // 如果是网络相关错误，尝试使用备用API检查
        if (axios.isAxiosError(error) && (
            error.code === 'ENOTFOUND' || 
            error.code === 'ETIMEDOUT' || 
            error.code === 'ECONNRESET' || 
            error.code === 'ECONNREFUSED' || 
            error.code === 'ECONNABORTED' || 
            error.response?.status === 429 || // 添加429 (Too Many Requests)
            error.response?.status === 403)) { // 添加403 (Forbidden)
          // 尝试使用playerdb.co作为备用API
          logger.info(`[Mojang API] 遇到错误(${error.code || error.response?.status})，将尝试使用备用API`)
          return tryBackupAPI(username);
        }
      }
      return null;
    }
  }

  // 使用备用API验证用户名
  const tryBackupAPI = async (username: string): Promise<MojangProfile | null> => {
    logger.info(`[备用API] 尝试使用备用API验证用户名"${username}"`)
    try {
      // 使用playerdb.co作为备用API
      const backupResponse = await axios.get(`https://playerdb.co/api/player/minecraft/${username}`, { 
        timeout: 10000,
        headers: {
          'User-Agent': 'KoishiMCVerifier/1.0'
        }
      })
      
      if (backupResponse.status === 200 && backupResponse.data?.code === "player.found") {
        const playerData = backupResponse.data.data.player;
        const rawId = playerData.raw_id || playerData.id.replace(/-/g, ''); // 确保使用不带连字符的UUID
        logger.info(`[备用API] 用户名"${username}"验证成功，UUID: ${rawId}，标准名称: ${playerData.username}`)
        return {
          id: rawId, // 确保使用不带连字符的UUID
          name: playerData.username
        }
      }
      logger.warn(`[备用API] 用户名"${username}"验证失败: ${JSON.stringify(backupResponse.data)}`)
      return null;
    } catch (backupError) {
      const errorMsg = axios.isAxiosError(backupError) 
        ? `${backupError.message}, 状态码: ${backupError.response?.status || '未知'}`
        : backupError.message || '未知错误';
      logger.error(`[备用API] 验证用户名"${username}"失败: ${errorMsg}`)
      return null;
    }
  }

  // 获取MC头图URL
  const getCrafatarUrl = (uuid: string): string | null => {
    if (!uuid) return null
    
    // 检查UUID格式 (不带连字符应为32位，带连字符应为36位)
    const uuidRegex = /^[0-9a-f]{32}$|^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(uuid)) {
      logger.warn(`[MC头图] UUID "${uuid}" 格式无效，无法生成头图URL`)
      return null
    }
    
    // 移除任何连字符，Crafatar接受不带连字符的UUID
    const cleanUuid = uuid.replace(/-/g, '')
    
    // 直接生成URL
    const url = `https://crafatar.com/avatars/${cleanUuid}`
    
    logger.debug(`[MC头图] 为UUID "${cleanUuid}" 生成头图URL`)
    return url
  }

  // 使用Starlight SkinAPI获取皮肤渲染
  const getStarlightSkinUrl = (username: string): string | null => {
    if (!username) return null
    
    // 可用的动作列表 (共16种)
    const poses = [
      'default',    // 默认站立
      'marching',   // 行军
      'walking',    // 行走
      'crouching',  // 下蹲
      'crossed',    // 交叉手臂
      'crisscross', // 交叉腿
      'cheering',   // 欢呼
      'relaxing',   // 放松
      'trudging',   // 艰难行走
      'cowering',   // 退缩
      'pointing',   // 指向
      'lunging',    // 前冲
      'dungeons',   // 地下城风格
      'facepalm',   // 捂脸
      'mojavatar',  // Mojave姿态
      'head',   // 头部特写
    ]
    
    // 随机选择一个动作
    const randomPose = poses[Math.floor(Math.random() * poses.length)]
    
    // 视图类型（full为全身图）
    const viewType = 'full'
    
    // 生成URL
    const url = `https://starlightskins.lunareclipse.studio/render/${randomPose}/${username}/${viewType}`
    
    logger.debug(`[Starlight皮肤] 为用户名"${username}"生成动作"${randomPose}"的渲染URL`)
    return url
  }

  // 格式化UUID (添加连字符，使其符合标准格式)
  const formatUuid = (uuid: string): string => {
    if (!uuid) return '未知'
    if (uuid.includes('-')) return uuid // 已经是带连字符的格式
    
    // 确保UUID长度正确
    if (uuid.length !== 32) {
      logger.warn(`[UUID] UUID "${uuid}" 长度异常，无法格式化`)
      return uuid
    }
    
    return `${uuid.substring(0, 8)}-${uuid.substring(8, 12)}-${uuid.substring(12, 16)}-${uuid.substring(16, 20)}-${uuid.substring(20)}`
  }

  // 检查是否为管理员 (QQ号作为主键检查)
  const isAdmin = async (userId: string): Promise<boolean> => {
    // 主人始终是管理员
    const normalizedMasterId = normalizeQQId(config.masterId)
    const normalizedQQId = normalizeQQId(userId)
    
    if (normalizedQQId === normalizedMasterId) return true
    
    // 查询MCIDBIND表中是否是管理员
    try {
      const bind = await getMcBindByQQId(normalizedQQId)
      return bind && bind.isAdmin === true
    } catch (error) {
      logger.error(`[权限检查] QQ(${normalizedQQId})的管理员状态查询失败: ${error.message}`)
      return false
    }
  }

  // 检查是否为主人 (QQ号作为主键检查)
  const isMaster = (qqId: string): boolean => {
    const normalizedMasterId = normalizeQQId(config.masterId)
    const normalizedQQId = normalizeQQId(qqId)
    return normalizedQQId === normalizedMasterId
  }

  // =========== BUID相关功能 ===========
  
  // 验证BUID是否存在
  const validateBUID = async (buid: string): Promise<ZminfoUser | null> => {
    try {
      if (!buid || !/^\d+$/.test(buid)) {
        logWarn('B站账号验证', `无效的B站UID格式: ${buid}`)
        return null
      }

      logDebug('B站账号验证', `验证B站UID: ${buid}`)
      
      const response = await axios.get(`${config.zminfoApiUrl}/api/user/${buid}`, {
        timeout: 10000,
        headers: {
          'User-Agent': 'Koishi-MCID-Bot/1.0'
        }
      })

      if (response.data.success && response.data.data && response.data.data.user) {
        const user = response.data.data.user
        logDebug('B站账号验证', `B站UID ${buid} 验证成功: ${user.username}`)
        return user
      } else {
        logWarn('B站账号验证', `B站UID ${buid} 不存在或API返回失败: ${response.data.message}`)
        return null
      }
    } catch (error) {
      if (error.response?.status === 404) {
        logWarn('B站账号验证', `B站UID ${buid} 不存在`)
        return null
      }
      
      logError('B站账号验证', 'system', `验证B站UID ${buid} 时出错: ${error.message}`)
      throw new Error(`无法验证B站UID: ${error.message}`)
    }
  }

  // 根据B站UID查询绑定信息
  const getBuidBindByBuid = async (buid: string): Promise<MCIDBIND | null> => {
    try {
      if (!buid) {
        logger.warn(`[B站账号绑定] 尝试查询空B站UID`)
        return null
      }

      const bind = await mcidbindRepo.findByBuidUid(buid)
      return bind
    } catch (error) {
      logError('B站账号绑定', 'system', `根据B站UID(${buid})查询绑定信息失败: ${error.message}`)
      return null
    }
  }

  // 检查B站UID是否已被绑定
  const checkBuidExists = async (buid: string, currentUserId?: string): Promise<boolean> => {
    try {
      const bind = await getBuidBindByBuid(buid)
      if (!bind) return false
      
      // 如果指定了当前用户ID，则排除当前用户的绑定
      if (currentUserId) {
        const normalizedCurrentId = normalizeQQId(currentUserId)
        return bind.qqId !== normalizedCurrentId
      }
      
      return true
    } catch (error) {
      logError('B站账号绑定', 'system', `检查B站UID(${buid})是否存在时出错: ${error.message}`)
      return false
    }
  }

  // 创建或更新B站账号绑定
  const createOrUpdateBuidBind = async (userId: string, buidUser: ZminfoUser): Promise<boolean> => {
    try {
      const normalizedQQId = normalizeQQId(userId)
      if (!normalizedQQId) {
        logger.error(`[B站账号绑定] 创建/更新绑定失败: 无法提取有效的QQ号`)
        return false
      }
      
      // 检查该UID是否已被其他用户绑定（安全检查）
      const existingBuidBind = await getBuidBindByBuid(buidUser.uid)
      if (existingBuidBind && existingBuidBind.qqId !== normalizedQQId) {
        logger.error(`[B站账号绑定] 安全检查失败: B站UID ${buidUser.uid} 已被QQ(${existingBuidBind.qqId})绑定，无法为QQ(${normalizedQQId})绑定`)
        return false
      }
      
      // 查询是否已存在绑定记录
      let bind = await getMcBindByQQId(normalizedQQId)
      const updateData: any = {
        buidUid: buidUser.uid,
        buidUsername: buidUser.username,
        guardLevel: buidUser.guard_level || 0,
        guardLevelText: buidUser.guard_level_text || '',
        maxGuardLevel: buidUser.max_guard_level || 0,
        maxGuardLevelText: buidUser.max_guard_level_text || '',
        medalName: buidUser.medal?.name || '',
        medalLevel: buidUser.medal?.level || 0,
        wealthMedalLevel: buidUser.wealthMedalLevel || 0,
        lastActiveTime: buidUser.last_active_time ? new Date(buidUser.last_active_time) : new Date(),
        lastModified: new Date()
      }
      if (bind) {
        await mcidbindRepo.update(normalizedQQId, updateData)
        logger.info(`[B站账号绑定] 更新绑定: QQ=${normalizedQQId}, B站UID=${buidUser.uid}, 用户名=${buidUser.username}`)
      } else {
        // 为跳过MC绑定的用户生成唯一的临时用户名，避免UNIQUE constraint冲突
        const tempMcUsername = `_temp_skip_${normalizedQQId}_${Date.now()}`;
        const newBind: any = {
          qqId: normalizedQQId,
          mcUsername: tempMcUsername,
          mcUuid: '',
          isAdmin: false,
          whitelist: [],
          tags: [],
          ...updateData
        }
        await mcidbindRepo.create(newBind)
        logger.info(`[B站账号绑定] 创建绑定(跳过MC): QQ=${normalizedQQId}, B站UID=${buidUser.uid}, 用户名=${buidUser.username}, 临时MC用户名=${tempMcUsername}`)
      }
      return true
    } catch (error) {
      logError('B站账号绑定', userId, `创建/更新B站账号绑定失败: ${error.message}`)
      return false
    }
  }

  // 仅更新B站信息，不更新绑定时间（用于查询时刷新数据）
  const updateBuidInfoOnly = async (userId: string, buidUser: ZminfoUser): Promise<boolean> => {
    try {
      const normalizedQQId = normalizeQQId(userId)
      if (!normalizedQQId) {
        logger.error(`[B站账号信息更新] 更新失败: 无法提取有效的QQ号`)
        return false
      }
      
      // 查询是否已存在绑定记录
      const bind = await getMcBindByQQId(normalizedQQId)
      if (!bind) {
        logger.warn(`[B站账号信息更新] QQ(${normalizedQQId})没有绑定记录，无法更新B站信息`)
        return false
      }
      
      // 仅更新B站相关字段，不更新lastModified
      const updateData: any = {
        buidUsername: buidUser.username,
        guardLevel: buidUser.guard_level || 0,
        guardLevelText: buidUser.guard_level_text || '',
        maxGuardLevel: buidUser.max_guard_level || 0,
        maxGuardLevelText: buidUser.max_guard_level_text || '',
        medalName: buidUser.medal?.name || '',
        medalLevel: buidUser.medal?.level || 0,
        wealthMedalLevel: buidUser.wealthMedalLevel || 0,
        lastActiveTime: buidUser.last_active_time ? new Date(buidUser.last_active_time) : new Date()
      }

      await mcidbindRepo.update(normalizedQQId, updateData)
      logger.info(`[B站账号信息更新] 刷新信息: QQ=${normalizedQQId}, B站UID=${bind.buidUid}, 用户名=${buidUser.username}`)
      return true
    } catch (error) {
      logError('B站账号信息更新', userId, `更新B站账号信息失败: ${error.message}`)
      return false
    }
  }

  // =========== 辅助函数 ===========
  // RCON连接检查
  const checkRconConnections = async (): Promise<void> => {
    if (!config.servers || config.servers.length === 0) {
      logger.info('[RCON检查] 未配置任何服务器，跳过RCON检查')
      return
    }

    const results: { [id: string]: boolean } = {}

    for (const server of config.servers) {
      try {
        logger.info(`[RCON检查] 正在检查服务器 ${server.name} (${server.rconAddress}) 的连接状态`)

        // 尝试执行/list命令来测试连接 (使用RCON管理器)
        await rconManager.executeCommand(server, 'list')

        // 如果没有抛出异常，表示连接成功
        logger.info(`[RCON检查] 服务器 ${server.name} 连接成功`)
        results[server.id] = true
      } catch (error) {
        logger.error(`[RCON检查] 服务器 ${server.name} 连接失败: ${error.message}`)
        results[server.id] = false
      }
    }

    // 生成检查结果摘要
    const totalServers = config.servers.length
    const successCount = Object.values(results).filter(Boolean).length
    const failCount = totalServers - successCount

    logger.info(`[RCON检查] 检查完成: ${successCount}/${totalServers} 个服务器连接成功，${failCount} 个连接失败`)

    if (failCount > 0) {
      const failedServers = config.servers
        .filter(server => !results[server.id])
        .map(server => server.name)
        .join(', ')

      logger.warn(`[RCON检查] 以下服务器连接失败，白名单功能可能无法正常工作: ${failedServers}`)
    }
  }

  // 使用Mojang API通过UUID查询用户名
  const getUsernameByUuid = async (uuid: string): Promise<string | null> => {
    try {
      // 确保UUID格式正确（去除连字符）
      const cleanUuid = uuid.replace(/-/g, '');

      logger.debug(`[Mojang API] 通过UUID "${cleanUuid}" 查询用户名`);
      const response = await axios.get(`https://api.mojang.com/user/profile/${cleanUuid}`, {
        timeout: 10000,
        headers: {
          'User-Agent': 'KoishiMCVerifier/1.0',
        }
      });

      if (response.status === 200 && response.data) {
        // 从返回数据中提取用户名
        const username = response.data.name;
        logger.debug(`[Mojang API] UUID "${cleanUuid}" 当前用户名: ${username}`);
        return username;
      }

      logger.warn(`[Mojang API] UUID "${cleanUuid}" 查询不到用户名`);
      return null;
    } catch (error) {
      // 如果是网络相关错误，尝试使用备用API
      if (axios.isAxiosError(error) && (
        error.code === 'ENOTFOUND' ||
        error.code === 'ETIMEDOUT' ||
        error.code === 'ECONNRESET' ||
        error.code === 'ECONNREFUSED' ||
        error.code === 'ECONNABORTED' ||
        error.response?.status === 429 || // 添加429 (Too Many Requests)
        error.response?.status === 403)) { // 添加403 (Forbidden)

        logger.info(`[Mojang API] 通过UUID查询用户名时遇到错误(${error.code || error.response?.status})，将尝试使用备用API`);
        return getUsernameByUuidBackupAPI(uuid);
      }

      const errorMessage = axios.isAxiosError(error)
        ? `${error.message}，响应状态: ${error.response?.status || '未知'}\n响应数据: ${JSON.stringify(error.response?.data || '无数据')}`
        : error.message || '未知错误';
      logger.error(`[Mojang API] 通过UUID "${uuid}" 查询用户名失败: ${errorMessage}`);
      return null;
    }
  };

  // 使用备用API通过UUID查询用户名
  const getUsernameByUuidBackupAPI = async (uuid: string): Promise<string | null> => {
    try {
      // 确保UUID格式正确，备用API支持带连字符的UUID
      const formattedUuid = uuid.includes('-') ? uuid : formatUuid(uuid);

      logger.debug(`[备用API] 通过UUID "${formattedUuid}" 查询用户名`);
      const response = await axios.get(`https://playerdb.co/api/player/minecraft/${formattedUuid}`, {
        timeout: 10000,
        headers: {
          'User-Agent': 'KoishiMCVerifier/1.0',
        }
      });

      if (response.status === 200 && response.data?.code === "player.found") {
        const playerData = response.data.data.player;
        logger.debug(`[备用API] UUID "${formattedUuid}" 当前用户名: ${playerData.username}`);
        return playerData.username;
      }

      logger.warn(`[备用API] UUID "${formattedUuid}" 查询不到用户名: ${JSON.stringify(response.data)}`);
      return null;
    } catch (error) {
      const errorMessage = axios.isAxiosError(error)
        ? `${error.message}，响应状态: ${error.response?.status || '未知'}\n响应数据: ${JSON.stringify(error.response?.data || '无数据')}`
        : error.message || '未知错误';
      logger.error(`[备用API] 通过UUID "${uuid}" 查询用户名失败: ${errorMessage}`);
      return null;
    }
  };

  // 检查并更新用户名（如果与当前数据库中的不同）
  const checkAndUpdateUsername = async (bind: MCIDBIND): Promise<MCIDBIND> => {
    try {
      if (!bind || !bind.mcUuid) {
        logger.warn(`[用户名更新] 无法检查用户名更新: 空绑定或空UUID`);
        return bind;
      }

      // 通过UUID查询最新用户名
      const latestUsername = await getUsernameByUuid(bind.mcUuid);

      if (!latestUsername) {
        logger.warn(`[用户名更新] 无法获取UUID "${bind.mcUuid}" 的最新用户名`);
        return bind;
      }

      // 如果用户名与数据库中的不同，更新数据库（使用规范化比较，不区分大小写）
      const normalizedLatest = normalizeUsernameHelper(latestUsername)
      const normalizedCurrent = normalizeUsernameHelper(bind.mcUsername)

      if (normalizedLatest !== normalizedCurrent) {
        logger.info(`[用户名更新] 用户 QQ(${bind.qqId}) 的Minecraft用户名已变更: ${bind.mcUsername} -> ${latestUsername}`);

        // 更新数据库中的用户名
        await ctx.database.set('mcidbind', { qqId: bind.qqId }, {
          mcUsername: latestUsername
        });

        // 更新返回的绑定对象
        bind.mcUsername = latestUsername;
      }

      return bind;
    } catch (error) {
      logger.error(`[用户名更新] 检查和更新用户名失败: ${error.message}`);
      return bind;
    }
  };

  /**
   * 智能缓存版本的改名检测函数
   * 特性：
   * - 24小时冷却期（失败>=3次时延长到72小时）
   * - 失败计数追踪
   * - 成功时重置失败计数
   * @param bind 绑定记录
   * @returns 更新后的绑定记录
   */
  const checkAndUpdateUsernameWithCache = async (bind: MCIDBIND): Promise<MCIDBIND> => {
    try {
      if (!bind || !bind.mcUuid) {
        logger.warn(`[改名检测缓存] 无法检查用户名更新: 空绑定或空UUID`);
        return bind;
      }

      const now = new Date();
      const failCount = bind.usernameCheckFailCount || 0;

      // 根据失败次数决定冷却期：普通24小时，失败>=3次则72小时
      const cooldownHours = failCount >= 3 ? 72 : 24;

      // 检查是否在冷却期内
      if (bind.usernameLastChecked) {
        const lastCheck = new Date(bind.usernameLastChecked);
        const hoursSinceCheck = (now.getTime() - lastCheck.getTime()) / (1000 * 60 * 60);

        if (hoursSinceCheck < cooldownHours) {
          logger.debug(`[改名检测缓存] QQ(${bind.qqId}) 在冷却期内(${hoursSinceCheck.toFixed(1)}h/${cooldownHours}h)，跳过检查`);
          return bind;
        }
      }

      logger.debug(`[改名检测缓存] QQ(${bind.qqId}) 开始检查用户名变更（失败计数: ${failCount}）`);

      // 执行实际的改名检测
      const oldUsername = bind.mcUsername;
      const updatedBind = await checkAndUpdateUsername(bind);

      // 判断检测是否成功
      const detectionSuccess = updatedBind.mcUsername !== null && updatedBind.mcUsername !== undefined;

      if (detectionSuccess) {
        // 检测成功
        const usernameChanged = normalizeUsernameHelper(updatedBind.mcUsername) !== normalizeUsernameHelper(oldUsername);

        // 更新检查时间和重置失败计数
        await mcidbindRepo.update(bind.qqId, {
          usernameLastChecked: now,
          usernameCheckFailCount: 0
        });

        if (usernameChanged) {
          logger.info(`[改名检测缓存] QQ(${bind.qqId}) 用户名已变更: ${oldUsername} -> ${updatedBind.mcUsername}`);
        } else {
          logger.debug(`[改名检测缓存] QQ(${bind.qqId}) 用户名无变更: ${updatedBind.mcUsername}`);
        }

        // 更新返回对象的缓存字段
        updatedBind.usernameLastChecked = now;
        updatedBind.usernameCheckFailCount = 0;
      } else {
        // 检测失败��API失败或返回null）
        const newFailCount = failCount + 1;

        await mcidbindRepo.update(bind.qqId, {
          usernameLastChecked: now,
          usernameCheckFailCount: newFailCount
        });

        logger.warn(`[改名检测缓存] QQ(${bind.qqId}) 检测失败，失败计数: ${newFailCount}`);

        // 更新返回对象的缓存字段
        updatedBind.usernameLastChecked = now;
        updatedBind.usernameCheckFailCount = newFailCount;
      }

      return updatedBind;
    } catch (error) {
      logger.error(`[改名检测缓存] 检查和更新用户名失败: ${error.message}`);

      // 失败时也更新检查时间和递增失败计数
      try {
        const failCount = bind.usernameCheckFailCount || 0;
        await mcidbindRepo.update(bind.qqId, {
          usernameLastChecked: new Date(),
          usernameCheckFailCount: failCount + 1
        });
      } catch (updateError) {
        logger.error(`[改名检测缓存] 更新失败计数时出错: ${updateError.message}`);
      }

      return bind;
    }
  };

  // 安全地替换命令模板
  const safeCommandReplace = (template: string, mcid: string): string => {
    // 过滤可能导致命令注入的字符
    const sanitizedMcid = mcid.replace(/[;&|"`'$\\]/g, '');

    // 如果经过过滤后的mcid与原始mcid不同，记录警告
    if (sanitizedMcid !== mcid) {
      logger.warn(`[安全] 检测到潜在危险字符，已自动过滤: '${mcid}' -> '${sanitizedMcid}'`);
    }

    return template.replace(/\${MCID}/g, sanitizedMcid);
  };

  // 根据服务器ID获取服务器配置
  const getServerConfigById = (serverId: string): ServerConfig | null => {
    if (!config.servers || !Array.isArray(config.servers)) return null
    return config.servers.find(server => server.id === serverId && (server.enabled !== false)) || null
  }

  // 根据服务器名称获取服务器配置
  const getServerConfigByName = (serverName: string): ServerConfig | null => {
    if (!config.servers || !Array.isArray(config.servers)) return null

    // 过滤出启用的服务器
    const enabledServers = config.servers.filter(server => server.enabled !== false)

    // 尝试精确匹配
    let server = enabledServers.find(server => server.name === serverName)

    // 如果精确匹配失败，尝试模糊匹配
    if (!server) {
      const lowerServerName = serverName.toLowerCase().trim();

      // 最小相似度阈值，低于此值的匹配结果将被忽略
      const MIN_SIMILARITY = 0.6; // 60%的相似度

      // 查找最相似的服务器名称
      let bestMatch: ServerConfig | null = null;
      let bestSimilarity = 0;

      for (const s of enabledServers) {
        const similarity = calculateSimilarity(lowerServerName, s.name.toLowerCase().trim());

        if (similarity > bestSimilarity && similarity >= MIN_SIMILARITY) {
          bestSimilarity = similarity;
          bestMatch = s;
        }
      }

      if (bestMatch && bestSimilarity < 1) {
        logger.info(`[服务器配置] 模糊匹配成功: "${serverName}" -> "${bestMatch.name}" (相似度: ${(bestSimilarity * 100).toFixed(1)}%)`);
      }

      server = bestMatch;
    }

    return server || null;
  }

  // 根据服务器ID或名称获取服务器配置
  const getServerConfigByIdOrName = (serverIdOrName: string): ServerConfig | null => {
    if (!config.servers || !Array.isArray(config.servers)) return null

    // 先尝试通过ID精确匹配
    const serverById = getServerConfigById(serverIdOrName)
    if (serverById) return serverById

    // 如果ID未匹配到，尝试通过名称匹配
    return getServerConfigByName(serverIdOrName)
  }

  // =========== Handler 服务实例创建 ===========
  // 创建 MessageUtils 实例（暂时使用null，因为MessageUtils需要重构）
  const messageUtils = null as any

  // 创建 ForceBinder 实例
  const forceBindConfig: ForceBindConfig = {
    SESSDATA: config.forceBindSessdata,
    zminfoApiUrl: config.zminfoApiUrl,
    targetUpUid: config.forceBindTargetUpUid,
    targetRoomId: config.forceBindTargetRoomId,
    targetMedalName: config.forceBindTargetMedalName,
    debugMode: config.debugMode
  }
  const forceBinder = new ForceBinder(forceBindConfig, loggerService.createChild('强制绑定'))

  // 创建 GroupExporter 实例
  const groupExporter = new GroupExporter(ctx, loggerService.createChild('群数据导出'), mcidbindRepo)

  // =========== Handler 实例化和注册 ===========
  // 创建仓储对象
  const repositories: Repositories = {
    mcidbind: mcidbindRepo,
    scheduleMute: scheduleMuteRepo
  }

  // 创建依赖对象，包含所有wrapper函数和服务
  const handlerDependencies: HandlerDependencies = {
    // Utility functions
    normalizeQQId,
    formatCommand,
    formatUuid,
    checkCooldown,
    getCrafatarUrl,
    getStarlightSkinUrl,

    // Database operations (for McidCommandHandler)
    getMcBindByQQId,
    getMcBindByUsername,
    createOrUpdateMcBind,
    deleteMcBind,
    checkUsernameExists,
    checkAndUpdateUsername,
    checkAndUpdateUsernameWithCache,

    // API operations
    validateUsername,
    validateBUID,
    updateBuidInfoOnly,

    // Permission check functions
    isAdmin,
    isMaster,

    // Business functions
    sendMessage,
    autoSetGroupNickname,
    checkNicknameFormat,
    getBindInfo: getMcBindByQQId,

    // Config operations
    getServerConfigById,

    // Error handling
    getFriendlyErrorMessage,

    // Service instances
    rconManager,
    messageUtils,
    forceBinder,
    groupExporter,

    // Session management
    getBindingSession,
    createBindingSession,
    updateBindingSession,
    removeBindingSession,

    // Shared state
    avatarCache: new Map(Object.entries(avatarCache).map(([k, v]) => [k, v])),
    bindingSessions
  }

  // 实例化Handler
  const bindingHandler = new BindingHandler(ctx, config, loggerService, repositories, handlerDependencies)
  const tagHandler = new TagHandler(ctx, config, loggerService, repositories, handlerDependencies)
  const whitelistHandler = new WhitelistHandler(ctx, config, loggerService, repositories, handlerDependencies)
  const buidHandler = new BuidHandler(ctx, config, loggerService, repositories, handlerDependencies)

  // 注册Handler命令
  bindingHandler.register()
  tagHandler.register()
  whitelistHandler.register()
  buidHandler.register()

  // 实例化McidCommandHandler并注册命令
  const mcidHandler = new McidCommandHandler(ctx, config, loggerService, repositories, handlerDependencies)
  mcidHandler.register()

  // 自定义文本前缀匹配
  if (config.allowTextPrefix && config.botNickname) {
    // 创建一个前缀匹配器
    ctx.middleware((session, next) => {
      // 不处理没有内容的消息
      if (!session.content) return next()
      
      // 检查是否是命令开头，如果已经是命令就不处理
      if (session.content.startsWith('.') || session.content.startsWith('/')) {
        return next()
      }
      
      // 获取消息内容并规范化空格
      const content = session.content.trim()
      
      // 使用机器人昵称，支持多种匹配方式
      const botNickname = config.botNickname
      
      // 尝试识别以机器人昵称开头的mcid或buid命令
      let matchedCommand = null
      
      // 1. 尝试匹配原始的botNickname格式（支持mcid、buid和绑定命令）
      const regularPrefixRegex = new RegExp(`^${escapeRegExp(botNickname)}\\s+((mcid|buid|绑定|bind)\\s*.*)$`, 'i')
      const regularMatch = content.match(regularPrefixRegex)
      
      // 2. 如果botNickname不包含@，也尝试匹配带@的版本
      const atPrefixRegex = !botNickname.startsWith('@') ? 
        new RegExp(`^@${escapeRegExp(botNickname)}\\s+((mcid|buid|绑定|bind)\\s*.*)$`, 'i') : 
        null
      
      if (regularMatch && regularMatch[1]) {
        matchedCommand = regularMatch[1].trim()
      } else if (atPrefixRegex) {
        const atMatch = content.match(atPrefixRegex)
        if (atMatch && atMatch[1]) {
          matchedCommand = atMatch[1].trim()
        }
      }
      
      // 如果找到匹配的命令，执行它
      if (matchedCommand) {
        let commandType = 'unknown'
        if (matchedCommand.startsWith('mcid')) {
          commandType = 'mcid'
        } else if (matchedCommand.startsWith('buid')) {
          commandType = 'buid'
        } else if (matchedCommand.startsWith('绑定') || matchedCommand.startsWith('bind')) {
          commandType = '绑定'
        }
        
        logger.info(`[前缀匹配] 成功识别${commandType}命令，原始消息: "${content}"，执行命令: "${matchedCommand}"`)
        
        // 使用session.execute方法主动触发命令执行
        session.execute(matchedCommand).catch(error => {
          logger.error(`[前缀匹配] 执行命令"${matchedCommand}"失败: ${error.message}`)
        })
        
        // 返回终止后续中间件处理，避免重复处理
        return 
      }
      
      return next()
    })
  }

  // 随机提醒中间件 - 检查用户绑定状态和群昵称
  ctx.middleware(async (session, next) => {
    try {
      // 只在指定群中处理
      if (session.channelId !== config.autoNicknameGroupId) {
        return next()
      }

      // 跳过机器人自己的消息和系统消息
      if (!session.userId || session.userId === session.bot.userId) {
        return next()
      }

      // 跳过空消息或命令消息
      if (!session.content || session.content.startsWith('.') || session.content.startsWith('/') || 
          session.content.includes('mcid') || session.content.includes('buid') || session.content.includes('绑定')) {
        return next()
      }

      // 检查当前时间是否在群组禁言时间段内
      const inMuteTime = await isInMuteTime(session.channelId)
      if (inMuteTime) {
        logger.debug(`[随机提醒] 群组${session.channelId}当前处于禁言时间段，跳过提醒`)
        return next()
      }

      const normalizedUserId = normalizeQQId(session.userId)
      
      // 检查是否在冷却期内
      if (isInReminderCooldown(normalizedUserId)) {
        return next()
      }

      // 随机触发概率：管理员 1%，普通用户 80%，避免过于频繁
      const isUserAdmin = await isAdmin(session.userId)
      const triggerRate = isUserAdmin ? 0.01 : 0.80
      if (Math.random() > triggerRate) {
        return next()
      }
      
      logger.debug(`[随机提醒] 触发提醒检查: QQ(${normalizedUserId})${isUserAdmin ? ' (管理员)' : ''}`)

      // 检查是否在进行绑定会话，避免重复提醒
      const activeBindingSession = getBindingSession(session.userId, session.channelId)
      if (activeBindingSession) {
        logger.debug(`[随机提醒] QQ(${normalizedUserId})正在进行绑定会话，跳过提醒`)
        return next()
      }

      // 获取用户绑定信息
      const bind = await getMcBindByQQId(normalizedUserId)
      
      // 获取用户群昵称信息
      let currentNickname = ''
      try {
        if (session.bot.internal) {
          const groupInfo = await session.bot.internal.getGroupMemberInfo(session.channelId, session.userId)
          currentNickname = groupInfo.card || groupInfo.nickname || ''
        }
      } catch (error) {
        // 获取群昵称失败，跳过处理
        return next()
      }

      // 情况1：完全未绑定
      if (!bind || (!bind.mcUsername && !bind.buidUid)) {
        // 创建新记录或获取提醒次数
        let reminderCount = 0
        if (!bind) {
          // 创建新记录
          const tempUsername = `_temp_${normalizedUserId}`
          await mcidbindRepo.create({
            qqId: normalizedUserId,
            mcUsername: tempUsername,
            mcUuid: '',
            lastModified: new Date(),
            isAdmin: false,
            whitelist: [],
            tags: [],
            reminderCount: 1
          })
          reminderCount = 1
        } else {
          // 更新提醒次数
          reminderCount = (bind.reminderCount || 0) + 1
          await mcidbindRepo.update(normalizedUserId, { reminderCount })
        }
        
        setReminderCooldown(normalizedUserId)
        
        // 根据次数决定用词
        const reminderType = reminderCount >= 4 ? '警告' : '提醒'
        const reminderPrefix = `【第${reminderCount}次${reminderType}】`
        
        logger.info(`[随机提醒] 向完全未绑定的用户QQ(${normalizedUserId})发送第${reminderCount}次${reminderType}`)
        await sendMessage(session, [
          h.text(`${reminderPrefix} \n👋 你好！检测到您尚未绑定账号\n\n📋 为了更好的群聊体验，建议您绑定MC和B站账号\n💡 使用 ${formatCommand('绑定')} 开始绑定流程\n\n⚠️ 温馨提醒：请按群规设置合适的群昵称。若在管理员多次提醒后仍不配合绑定账号信息或按规修改群昵称，将按群规进行相应处理。`)
        ], { isProactiveMessage: true })
        return next()
      }

      // 情况2：只绑定了B站，未绑定MC
      if (bind.buidUid && bind.buidUsername && (!bind.mcUsername || bind.mcUsername.startsWith('_temp_'))) {
        const mcInfo = null
        const isNicknameCorrect = checkNicknameFormat(currentNickname, bind.buidUsername, mcInfo)
        
        if (!isNicknameCorrect) {
          // 更新提醒次数
          const reminderCount = (bind.reminderCount || 0) + 1
          await mcidbindRepo.update(normalizedUserId, { reminderCount })

          // 根据次数决定用词
          const reminderType = reminderCount >= 4 ? '警告' : '提醒'
          const reminderPrefix = `【第${reminderCount}次${reminderType}】`

          // 自动修改群昵称
          await autoSetGroupNickname(session, mcInfo, bind.buidUsername)
          setReminderCooldown(normalizedUserId)
          logger.info(`[随机提醒] 为仅绑定B站的用户QQ(${normalizedUserId})修复群昵称并发送第${reminderCount}次${reminderType}`)

          await sendMessage(session, [
            h.text(`${reminderPrefix} ✅ 已修改您的群昵称为规范格式\n\n💡 若您有Minecraft Java版账号，请使用 ${formatCommand('mcid bind <用户名>')} 绑定MC账号\n📝 这样可以申请服务器白名单哦！\n\n⚠️ 请勿随意修改群昵称，保持规范格式`)
          ], { isProactiveMessage: true })
        }
        return next()
      }

      // 情况3：都已绑定，但群昵称格式不正确
      if (bind.buidUid && bind.buidUsername && bind.mcUsername && !bind.mcUsername.startsWith('_temp_')) {
        const isNicknameCorrect = checkNicknameFormat(currentNickname, bind.buidUsername, bind.mcUsername)

        if (!isNicknameCorrect) {
          // 更新提醒次数
          const reminderCount = (bind.reminderCount || 0) + 1
          await mcidbindRepo.update(normalizedUserId, { reminderCount })
          
          // 根据次数决定用词
          const reminderType = reminderCount >= 4 ? '警告' : '提醒'
          const reminderPrefix = `【第${reminderCount}次${reminderType}】`
          
          // 自动修改群昵称
          await autoSetGroupNickname(session, bind.mcUsername, bind.buidUsername)
          setReminderCooldown(normalizedUserId)
          logger.info(`[随机提醒] 为已完全绑定的用户QQ(${normalizedUserId})修复群昵称并发送第${reminderCount}次${reminderType}`)
          
          await sendMessage(session, [
            h.text(`${reminderPrefix} ✅ 已修改您的群昵称为规范格式\n\n⚠️ 请勿随意修改群昵称！群昵称格式为：B站名称（ID:MC用户名）\n📋 这有助于管理员和群友识别您的身份\n\n`)
          ], { isProactiveMessage: true })
        }
        return next()
      }

      return next()
    } catch (error) {
      logger.error(`[随机提醒] 处理用户消息时出错: ${error.message}`)
      return next()
    }
  })

  // 交互型绑定会话处理中间件
  ctx.middleware(async (session, next) => {
    try {
      // 检查是否有进行中的绑定会话
      const bindingSession = getBindingSession(session.userId, session.channelId)
      if (!bindingSession) {
        return next()
      }
      
      const normalizedUserId = normalizeQQId(session.userId)
      const rawContent = session.content?.trim()
      // 清理用户输入中的@Bot前缀
      const content = cleanUserInput(rawContent || '', session)
      
      // 处理取消命令
      if (content === '取消' || content === 'cancel') {
        removeBindingSession(session.userId, session.channelId)
        logger.info(`[交互绑定] QQ(${normalizedUserId})手动取消了绑定会话`)
        await sendMessage(session, [h.text('❌ 绑定会话已取消\n\n📋 温馨提醒：请按群规设置合适的群昵称。若在管理员多次提醒后仍不配合绑定账号信息或按规修改群昵称，将按群规进行相应处理。')])
        return
      }
      
      // 检查是否在绑定过程中使用了其他绑定相关命令（排除跳过选项）
      // 这里使用原始内容检测命令，避免误判@Bot发送的正常输入
      if (rawContent && content !== '跳过' && content !== 'skip' && (
        rawContent.includes('绑定') || 
        rawContent.includes('bind') || 
        rawContent.includes('mcid') || 
        rawContent.includes('buid') ||
        rawContent.startsWith('.') ||
        rawContent.startsWith('/')
      )) {
        const currentState = bindingSession.state === 'waiting_mc_username' ? 'MC用户名' : 'B站UID'
        await sendMessage(session, [h.text(`🔄 您正在进行交互式绑定，请继续输入${currentState}\n\n如需取消当前绑定，请发送"取消"`)])
        return
      }
      
      // 检查是否为明显无关的输入
      const isIrrelevantInput = checkIrrelevantInput(bindingSession, content)
      if (isIrrelevantInput) {
        const currentCount = bindingSession.invalidInputCount || 0
        const newCount = currentCount + 1
        
        updateBindingSession(session.userId, session.channelId, {
          invalidInputCount: newCount
        })
        
        // 检查是否为明显的聊天内容（使用清理后的内容）
        const chatKeywords = ['你好', 'hello', 'hi', '在吗', '在不在', '怎么样', '什么', '为什么', '好的', '谢谢', '哈哈', '呵呵', '早上好', '晚上好', '晚安', '再见', '拜拜', '666', '牛', '厉害', '真的吗', '不是吧', '哇', '哦', '嗯', '好吧', '行', '可以', '没事', '没问题', '没关系']
        const isChatMessage = chatKeywords.some(keyword => content.toLowerCase().includes(keyword)) ||
                              /[！？。，；：""''（）【】〈〉《》「」『』〔〕〖〗〘〙〚〛]{2,}/.test(content) ||
                              /[!?.,;:"'()[\]<>{}]{3,}/.test(content)
        
        if (isChatMessage) {
          // 对于聊天消息，更快地取消绑定会话，避免持续打扰
          if (newCount >= 2) {
            removeBindingSession(session.userId, session.channelId)
            logger.info(`[交互绑定] QQ(${normalizedUserId})持续发送聊天消息，自动取消绑定会话避免打扰`)
            // 对于聊天取消，给一个更温和的提示，同时提醒群规
            await sendMessage(session, [h.text(`💬 看起来您在聊天，绑定流程已自动取消\n\n📋 温馨提醒：请按群规设置合适的群昵称。若在管理员多次提醒后仍不配合绑定账号信息或按规修改群昵称，将按群规进行相应处理。\n\n如需绑定账号，请随时使用 ${formatCommand('绑定')} 命令重新开始`)])
            return
          } else {
            // 第一次聊天消息，给温和提醒
            const expectedInput = bindingSession.state === 'waiting_mc_username' ? 'MC用户名' : 'B站UID'
            await sendMessage(session, [h.text(`💭 您当前正在进行账号绑定，需要输入${expectedInput}\n\n如不需要绑定，请发送"取消"，或继续聊天我们会自动取消绑定流程`)])
            return
          }
        } else {
          // 对于非聊天的无关输入，使用原来的逻辑
          if (newCount === 1) {
            // 第1次无关输入，提醒检查
            const expectedInput = bindingSession.state === 'waiting_mc_username' ? 'MC用户名' : 'B站UID'
            await sendMessage(session, [h.text(`🤔 您当前正在进行绑定流程，需要输入${expectedInput}\n\n如果您想取消绑定，请发送"取消"`)])
            return
          } else if (newCount >= 2) {
            // 第2次无关输入，建议取消
            removeBindingSession(session.userId, session.channelId)
            logger.info(`[交互绑定] QQ(${normalizedUserId})因多次无关输入自动取消绑定会话`)
            await sendMessage(session, [h.text('🔄 检测到您可能不想继续绑定流程，已自动取消绑定会话\n\n📋 温馨提醒：请按群规设置合适的群昵称。若在管理员多次提醒后仍不配合绑定账号信息或按规修改群昵称，将按群规进行相应处理。\n\n如需重新绑定，请使用 ' + formatCommand('绑定') + ' 命令')])
            return
          }
        }
      }
      
      // 根据当前状态处理用户输入
      if (bindingSession.state === 'waiting_mc_username') {
        // 处理MC用户名输入
        await handleMcUsernameInput(session, bindingSession, content)
        return
      } else if (bindingSession.state === 'waiting_buid') {
        // 处理B站UID输入
        await handleBuidInput(session, bindingSession, content)
        return
      }
      
      return next()
    } catch (error) {
      const normalizedUserId = normalizeQQId(session.userId)
      logger.error(`[交互绑定] QQ(${normalizedUserId})的会话处理出错: ${error.message}`)
      removeBindingSession(session.userId, session.channelId)
      await sendMessage(session, [h.text('绑定过程中出现错误，会话已重置')])
      return
    }
  })

  // 处理MC用户名输入
  const handleMcUsernameInput = async (session: Session, bindingSession: BindingSession, content: string): Promise<void> => {
    const normalizedUserId = normalizeQQId(session.userId)
    
    // 处理跳过MC绑定，直接完成绑定流程
    if (content === '跳过' || content === 'skip') {
      // 检查用户是否已绑定B站账号
      const existingBind = await getMcBindByQQId(normalizedUserId)
      if (existingBind && existingBind.buidUid && existingBind.buidUsername) {
        // 用户已绑定B站账号，直接完成绑定
        logger.info(`[交互绑定] QQ(${normalizedUserId})跳过了MC账号绑定，已有B站绑定，完成绑定流程`)
        
        // 清理会话
        removeBindingSession(session.userId, session.channelId)
        
        // 设置群昵称
        try {
          await autoSetGroupNickname(session, null, existingBind.buidUsername)
          logger.info(`[交互绑定] QQ(${normalizedUserId})完成绑定，已设置群昵称`)
        } catch (renameError) {
          logger.warn(`[交互绑定] QQ(${normalizedUserId})自动群昵称设置失败: ${renameError.message}`)
        }
        
        await sendMessage(session, [
          h.text(`🎉 绑定完成！\nMC: 未绑定\nB站: ${existingBind.buidUsername}\n\n💡 您可以随时使用 ${formatCommand('mcid bind <用户名>')} 绑定MC账号`),
          ...(config?.showAvatar ? [h.image(`https://workers.vrp.moe/bilibili/avatar/${existingBind.buidUid}?size=160`)] : [])
        ])
        return
      } else {
        // 用户未绑定B站账号，需要完成B站绑定
        logger.info(`[交互绑定] QQ(${normalizedUserId})跳过了MC账号绑定，需要完成B站绑定`)
        
        // 为跳过MC绑定的用户创建临时绑定记录
        const timestamp = Date.now()
        const tempMcUsername = `_temp_skip_${timestamp}`
        
        // 创建临时MC绑定
        const tempBindResult = await createOrUpdateMcBind(session.userId, tempMcUsername, '', false)
        if (!tempBindResult) {
          logger.error(`[交互绑定] QQ(${normalizedUserId})创建临时MC绑定失败`)
          await sendMessage(session, [h.text('❌ 创建临时绑定失败，请稍后重试')])
          return
        }
        
        // 跳转到B站绑定流程
        updateBindingSession(session.userId, session.channelId, {
          state: 'waiting_buid',
          mcUsername: tempMcUsername,
          mcUuid: ''
        })
        
        await sendMessage(session, [h.text('✅ 已跳过MC绑定\n📋 请发送您的B站UID')])
        return
      }
    }
    
    // 验证用户名格式
    if (!content || !/^[a-zA-Z0-9_]{3,16}$/.test(content)) {
      logger.warn(`[交互绑定] QQ(${normalizedUserId})输入的MC用户名"${content}"格式无效`)
      await sendMessage(session, [h.text('❌ 用户名格式无效，请重新输入\n或发送"跳过"完成绑定')])
      return
    }
    
    // 验证用户名是否存在
    const profile = await validateUsername(content)
    if (!profile) {
      logger.warn(`[交互绑定] QQ(${normalizedUserId})输入的MC用户名"${content}"不存在`)
      await sendMessage(session, [h.text(`❌ 用户名 ${content} 不存在\n请重新输入或发送"跳过"完成绑定`)])
      return
    }
    
    const username = profile.name
    const uuid = profile.id
    
    // 检查用户是否已绑定MC账号
    const existingBind = await getMcBindByQQId(normalizedUserId)
    if (existingBind && existingBind.mcUsername && !existingBind.mcUsername.startsWith('_temp_')) {
      // 检查冷却时间
      if (!await isAdmin(session.userId) && !checkCooldown(existingBind.lastModified)) {
        const days = config.cooldownDays
        const now = new Date()
        const diffTime = now.getTime() - existingBind.lastModified.getTime()
        const passedDays = Math.floor(diffTime / (1000 * 60 * 60 * 24))
        const remainingDays = days - passedDays
        
        removeBindingSession(session.userId, session.channelId)
        const displayUsername = existingBind.mcUsername && !existingBind.mcUsername.startsWith('_temp_') ? existingBind.mcUsername : '未绑定'
        await sendMessage(session, [h.text(`❌ 您已绑定MC账号: ${displayUsername}\n\n如需修改，请在冷却期结束后(还需${remainingDays}天)使用 ${formatCommand('mcid change')} 命令或联系管理员`)])
        return
      }
    }
    
    // 检查用户名是否已被其他人绑定
    if (await checkUsernameExists(username, session.userId, uuid)) {
      logger.warn(`[交互绑定] MC用户名"${username}"已被其他用户绑定`)
      await sendMessage(session, [h.text(`❌ 用户名 ${username} 已被其他用户绑定\n\n请输入其他MC用户名或发送"跳过"完成绑定`)])
      return
    }
    
    // 绑定MC账号
    const bindResult = await createOrUpdateMcBind(session.userId, username, uuid)
    if (!bindResult) {
      logger.error(`[交互绑定] QQ(${normalizedUserId})绑定MC账号失败`)
      removeBindingSession(session.userId, session.channelId)
      await sendMessage(session, [h.text('❌ 绑定失败，数据库操作出错\n\n请联系管理员或稍后重试')])
      return
    }
    
    logger.info(`[交互绑定] QQ(${normalizedUserId})成功绑定MC账号: ${username}`)
    
    // 检查用户是否已经绑定了B站账号
    const updatedBind = await getMcBindByQQId(normalizedUserId)
    if (updatedBind && updatedBind.buidUid && updatedBind.buidUsername) {
      // 用户已经绑定了B站账号，直接完成绑定流程
      logger.info(`[交互绑定] QQ(${normalizedUserId})已绑定B站账号，完成绑定流程`)
      
      // 清理会话
      removeBindingSession(session.userId, session.channelId)
      
      // 设置群昵称
      try {
        await autoSetGroupNickname(session, username, updatedBind.buidUsername)
        logger.info(`[交互绑定] QQ(${normalizedUserId})绑定完成，已设置群昵称`)
      } catch (renameError) {
        logger.warn(`[交互绑定] QQ(${normalizedUserId})自动群昵称设置失败: ${renameError.message}`)
      }
      
      // 根据配置决定显示哪种图像
      let mcAvatarUrl = null
      if (config?.showAvatar) {
        if (config?.showMcSkin) {
          mcAvatarUrl = getStarlightSkinUrl(username)
        } else {
          mcAvatarUrl = getCrafatarUrl(uuid)
        }
      }
      
      // 发送完成消息
      await sendMessage(session, [
        h.text(`🎉 绑定完成！\nMC: ${username}\nB站: ${updatedBind.buidUsername}`),
        ...(mcAvatarUrl ? [h.image(mcAvatarUrl)] : [])
      ])
      return
    }
    
    // 用户未绑定B站账号，继续B站绑定流程
    // 更新会话状态
    updateBindingSession(session.userId, session.channelId, {
      state: 'waiting_buid',
      mcUsername: username,
      mcUuid: uuid
    })
    
    // 根据配置决定显示哪种图像
    let mcAvatarUrl = null
    if (config?.showAvatar) {
      if (config?.showMcSkin) {
        mcAvatarUrl = getStarlightSkinUrl(username)
      } else {
        mcAvatarUrl = getCrafatarUrl(uuid)
      }
    }
    
    const formattedUuid = formatUuid(uuid)
    
    // 发送简化的MC绑定成功消息
    await sendMessage(session, [
      h.text(`✅ MC账号: ${username}\n🔗 请发送您的B站UID`),
      ...(mcAvatarUrl ? [h.image(mcAvatarUrl)] : [])
    ])
  }



  // 处理B站UID输入
  const handleBuidInput = async (session: Session, bindingSession: BindingSession, content: string): Promise<void> => {
    const normalizedUserId = normalizeQQId(session.userId)
    
    // 处理跳过B站绑定，直接进入MC绑定流程
    if (content === '跳过' || content === 'skip') {
      bindingSession.state = 'waiting_mc_username'
      
      logger.info(`[交互绑定] QQ(${normalizedUserId})跳过了B站账号绑定，直接进入MC绑定流程`)
      await sendMessage(session, [h.text('✅ 已跳过B站绑定\n🎮 请发送您的MC用户名')])
      return
    }
    
    // 解析UID格式，支持多种格式
    let actualUid = content
    
    if (content && content.toLowerCase().startsWith('uid:')) {
      // UID:数字格式
      actualUid = content.substring(4)
    } else if (content && content.includes('space.bilibili.com/')) {
      // B站空间URL格式
      try {
        // 删除前缀 https://space.bilibili.com/ 或 http://space.bilibili.com/
        let urlPart = content.replace(/^https?:\/\/space\.bilibili\.com\//, '')
        
        // 删除后缀参数 ?***
        if (urlPart.includes('?')) {
          urlPart = urlPart.split('?')[0]
        }
        
        // 删除可能的路径后缀 /***
        if (urlPart.includes('/')) {
          urlPart = urlPart.split('/')[0]
        }
        
        actualUid = urlPart
        logger.info(`[交互绑定] QQ(${normalizedUserId})从URL提取UID: ${content} -> ${actualUid}`)
      } catch (error) {
        logger.warn(`[交互绑定] QQ(${normalizedUserId})URL解析失败: ${error.message}`)
        actualUid = ''
      }
    }
    
    // 验证UID格式
    if (!actualUid || !/^\d+$/.test(actualUid)) {
      logger.warn(`[交互绑定] QQ(${normalizedUserId})输入的B站UID"${content}"格式无效`)
      await sendMessage(session, [h.text('❌ UID格式无效，请重新输入\n支持格式：纯数字、UID:数字、空间链接\n或发送"跳过"仅绑定MC账号')])
      return
    }
    
    // 检查UID是否已被绑定
    if (await checkBuidExists(actualUid, session.userId)) {
      logger.warn(`[交互绑定] B站UID"${actualUid}"已被其他用户绑定`)
      await sendMessage(session, [h.text(`❌ UID ${actualUid} 已被其他用户绑定\n\n请输入其他B站UID\n或发送"跳过"仅绑定MC账号`)])
      return
    }
    
    // 验证UID是否存在
    const buidUser = await validateBUID(actualUid)
    if (!buidUser) {
      logger.warn(`[交互绑定] QQ(${normalizedUserId})输入的B站UID"${actualUid}"不存在`)
      await sendMessage(session, [h.text(`❌ 无法验证UID: ${actualUid}\n\n该用户可能不存在或未被发现\n可以去直播间发个弹幕后重试绑定\n或发送"跳过"仅绑定MC账号`)])
      return
    }
    
    // 绑定B站账号
    const bindResult = await createOrUpdateBuidBind(session.userId, buidUser)
    if (!bindResult) {
      logger.error(`[交互绑定] QQ(${normalizedUserId})绑定B站账号失败`)
      removeBindingSession(session.userId, session.channelId)
      
      // 根据是否有MC绑定提供不同的提示
      const displayMcName = bindingSession.mcUsername && !bindingSession.mcUsername.startsWith('_temp_') ? bindingSession.mcUsername : null
      const mcStatus = displayMcName ? `您的MC账号${displayMcName}已成功绑定\n` : ''
      await sendMessage(session, [h.text(`❌ B站账号绑定失败，数据库操作出错\n\n${mcStatus}可稍后使用 ${formatCommand('buid bind <UID>')} 命令单独绑定B站账号`)])
      return
    }
    
    logger.info(`[交互绑定] QQ(${normalizedUserId})成功绑定B站UID: ${actualUid}`)
    
    // 清理会话
    removeBindingSession(session.userId, session.channelId)
    
    // 自动群昵称设置功能 - 使用新的autoSetGroupNickname函数
    try {
      // 检查是否有有效的MC用户名（不是临时用户名）
      const mcName = bindingSession.mcUsername && !bindingSession.mcUsername.startsWith('_temp_') ? bindingSession.mcUsername : null
      await autoSetGroupNickname(session, mcName, buidUser.username)
      logger.info(`[交互绑定] QQ(${normalizedUserId})绑定完成，已设置群昵称`)
    } catch (renameError) {
      logger.warn(`[交互绑定] QQ(${normalizedUserId})自动群昵称设置失败: ${renameError.message}`)
      // 群昵称设置失败不影响主流程，只记录日志
    }
    
    // 发送完整的绑定成功消息
    const buidInfo = `B站UID: ${buidUser.uid}\n用户名: ${buidUser.username}`
    let extraInfo = ''
    if (buidUser.guard_level > 0) {
      extraInfo += `\n舰长等级: ${buidUser.guard_level_text} (${buidUser.guard_level})`
    }
    if (buidUser.medal) {
      extraInfo += `\n粉丝牌: ${buidUser.medal.name} Lv.${buidUser.medal.level}`
    }
    if (buidUser.wealthMedalLevel > 0) {
      extraInfo += `\n荣耀等级: ${buidUser.wealthMedalLevel}`
    }
    
    // 准备完成消息
    const displayMcName = bindingSession.mcUsername && !bindingSession.mcUsername.startsWith('_temp_') ? bindingSession.mcUsername : null
    const mcInfo = displayMcName ? `MC: ${displayMcName}` : 'MC: 未绑定'
    let extraTip = ''
    
    // 如果用户跳过了MC绑定或MC账号是temp，提供后续绑定的指引
    if (!displayMcName) {
      extraTip = `\n\n💡 您可以随时使用 ${formatCommand('mcid bind <用户名>')} 绑定MC账号`
    }
    
    await sendMessage(session, [
      h.text(`🎉 绑定完成！\n${mcInfo}\nB站: ${buidUser.username}${extraInfo}${extraTip}`),
      ...(config?.showAvatar ? [h.image(`https://workers.vrp.moe/bilibili/avatar/${buidUser.uid}?size=160`)] : [])
    ])
  }

  // 帮助函数：转义正则表达式中的特殊字符
  const escapeRegExp = (string: string): string => {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  // 帮助函数：清理用户输入中的@Bot前缀
  const cleanUserInput = (content: string, session: Session): string => {
    if (!content) return content
    
    // 获取机器人的用户ID
    const botUserId = session.bot.userId
    
    // 匹配各种@Bot的格式
    const atPatterns = [
      // <at id="botUserId"/> 格式
      new RegExp(`^<at id="${escapeRegExp(botUserId)}"/>\\s*`, 'i'),
      // @Bot昵称 格式（如果配置了botNickname）
      config.botNickname ? new RegExp(`^@${escapeRegExp(config.botNickname)}\\s+`, 'i') : null,
      // @botUserId 格式
      new RegExp(`^@${escapeRegExp(botUserId)}\\s+`, 'i'),
    ].filter(Boolean)
    
    let cleanedContent = content.trim()
    
    // 尝试匹配并移除@Bot前缀
    for (const pattern of atPatterns) {
      if (pattern.test(cleanedContent)) {
        cleanedContent = cleanedContent.replace(pattern, '').trim()
        logger.debug(`[交互绑定] 清理用户输入，原始: "${content}" -> 清理后: "${cleanedContent}"`)
        break
      }
    }
    
    return cleanedContent
  }


  // =========== 天选开奖 Webhook 处理 ===========
  
  // 处理天选开奖结果
  const handleLotteryResult = async (lotteryData: LotteryResult): Promise<void> => {
    try {
      // 检查天选播报开关
      if (!config?.enableLotteryBroadcast) {
        logger.debug(`[天选开奖] 天选播报功能已禁用，跳过处理天选事件: ${lotteryData.lottery_id}`)
        return
      }
      
      logger.info(`[天选开奖] 开始处理天选事件: ${lotteryData.lottery_id}，奖品: ${lotteryData.reward_name}，中奖人数: ${lotteryData.winners.length}`)
      
      // 生成标签名称
      const tagName = `天选-${lotteryData.lottery_id}`
      
      // 统计信息
      let matchedCount = 0
      let notBoundCount = 0
      let tagAddedCount = 0
      let tagExistedCount = 0
      const matchedUsers: Array<{qqId: string, mcUsername: string, buidUsername: string, uid: number, username: string}> = []
      
      // 处理每个中奖用户
      for (const winner of lotteryData.winners) {
        try {
          // 根据B站UID查找绑定的QQ用户
          const bind = await getBuidBindByBuid(winner.uid.toString())
          
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
              logger.debug(`[天选开奖] QQ(${bind.qqId})已有标签"${tagName}"`)
            } else {
              // 添加标签
              const newTags = [...(bind.tags || []), tagName]
              await mcidbindRepo.update(bind.qqId, { tags: newTags })
              tagAddedCount++
              logger.debug(`[天选开奖] 为QQ(${bind.qqId})添加标签"${tagName}"`)
            }
          } else {
            notBoundCount++
            logger.debug(`[天选开奖] B站UID(${winner.uid})未绑定QQ账号`)
          }
        } catch (error) {
          logger.error(`[天选开奖] 处理中奖用户UID(${winner.uid})时出错: ${error.message}`)
        }
      }
      
      logger.info(`[天选开奖] 处理完成: 总计${lotteryData.winners.length}人中奖，匹配${matchedCount}人，未绑定${notBoundCount}人，新增标签${tagAddedCount}人，已有标签${tagExistedCount}人`)
      
      // 生成并发送结果消息
      await sendLotteryResultToGroup(lotteryData, {
        totalWinners: lotteryData.winners.length,
        matchedCount,
        notBoundCount,
        tagAddedCount,
        tagExistedCount,
        matchedUsers,
        tagName
      })
      
    } catch (error) {
      logger.error(`[天选开奖] 处理天选事件"${lotteryData.lottery_id}"失败: ${error.message}`)
    }
  }
  
  // 发送天选开奖结果到群
  const sendLotteryResultToGroup = async (
    lotteryData: LotteryResult, 
    stats: {
      totalWinners: number
      matchedCount: number
      notBoundCount: number
      tagAddedCount: number
      tagExistedCount: number
      matchedUsers: Array<{qqId: string, mcUsername: string, buidUsername: string, uid: number, username: string}>
      tagName: string
    }
  ): Promise<void> => {
    try {
      const targetChannelId = '123456789' // 目标群号
      const privateTargetId = 'private:3431185320' // 私聊目标
      
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
      let groupMessage = `🎉 天选开奖结果通知\n\n`
      groupMessage += `📅 开奖时间: ${lotteryTime}\n`
      groupMessage += `🎁 奖品名称: ${lotteryData.reward_name}\n`
      groupMessage += `📊 奖品数量: ${lotteryData.reward_num}个\n`
      groupMessage += `🎲 总中奖人数: ${stats.totalWinners}人`
      
      // 添加未绑定用户说明
      if (stats.notBoundCount > 0) {
        groupMessage += `（其中${stats.notBoundCount}人未绑定跳过）`
      }
      groupMessage += `\n\n`
      
      // 如果有匹配的用户，显示详细信息
      if (stats.matchedUsers.length > 0) {
        groupMessage += `🎯 已绑定的中奖用户:\n`
        
        // 限制显示前10个用户，避免消息过长
        const displayUsers = stats.matchedUsers.slice(0, 10)
        for (let i = 0; i < displayUsers.length; i++) {
          const user = displayUsers[i]
          const index = i + 1
          const displayMcName = user.mcUsername && !user.mcUsername.startsWith('_temp_') ? user.mcUsername : '未绑定'
          groupMessage += `${index}. ${user.buidUsername} (UID: ${user.uid})\n`
          groupMessage += `   QQ: ${user.qqId} | MC: ${displayMcName}\n`
        }
        
        // 如果用户太多，显示省略信息
        if (stats.matchedUsers.length > 10) {
          groupMessage += `... 还有${stats.matchedUsers.length - 10}位中奖用户\n`
        }
      } else {
        groupMessage += `😔 暂无已绑定用户中奖\n`
      }
      
      // 构建完整版私聊消息（包含所有信息和未绑定用户）
      let privateMessage = `🎉 天选开奖结果通知\n\n`
      privateMessage += `📅 开奖时间: ${lotteryTime}\n`
      privateMessage += `🎁 奖品名称: ${lotteryData.reward_name}\n`
      privateMessage += `📊 奖品数量: ${lotteryData.reward_num}个\n`
      privateMessage += `🏷️ 事件ID: ${lotteryData.lottery_id}\n`
      privateMessage += `👤 主播: ${lotteryData.host_username} (UID: ${lotteryData.host_uid})\n`
      privateMessage += `🏠 房间号: ${lotteryData.room_id}\n\n`
      
      // 统计信息
      privateMessage += `📈 处理统计:\n`
      privateMessage += `• 总中奖人数: ${stats.totalWinners}人\n`
      privateMessage += `• 已绑定用户: ${stats.matchedCount}人 ✅\n`
      privateMessage += `• 未绑定用户: ${stats.notBoundCount}人 ⚠️\n`
      privateMessage += `• 新增标签: ${stats.tagAddedCount}人\n`
      privateMessage += `• 已有标签: ${stats.tagExistedCount}人\n\n`
      
      // 显示所有中奖用户（包括未绑定的）
      if (lotteryData.winners.length > 0) {
        privateMessage += `🎯 所有中奖用户:\n`
        
        for (let i = 0; i < lotteryData.winners.length; i++) {
          const winner = lotteryData.winners[i]
          const index = i + 1
          
          // 查找对应的绑定用户
          const matchedUser = stats.matchedUsers.find(user => user.uid === winner.uid)
          
          if (matchedUser) {
            const displayMcName = matchedUser.mcUsername && !matchedUser.mcUsername.startsWith('_temp_') ? matchedUser.mcUsername : '未绑定'
            privateMessage += `${index}. ${winner.username} (UID: ${winner.uid})\n`
            privateMessage += `   QQ: ${matchedUser.qqId} | MC: ${displayMcName}\n`
          } else {
            privateMessage += `${index}. ${winner.username} (UID: ${winner.uid})\n`
            privateMessage += `   无绑定信息，自动跳过\n`
          }
        }
        
        privateMessage += `\n🏷️ 标签"${stats.tagName}"已自动添加到已绑定用户\n`
      }
      
      // 准备消息元素
      const groupMessageElements = [h.text(groupMessage)]
      const privateMessageElements = [h.text(privateMessage)]
      
      // 发送消息到指定群（简化版）
      for (const bot of ctx.bots) {
        try {
          await bot.sendMessage(targetChannelId, groupMessageElements)
          logger.info(`[天选开奖] 成功发送简化开奖结果到群${targetChannelId}`)
          break // 成功发送后退出循环
        } catch (error) {
          logger.error(`[天选开奖] 发送消息到群${targetChannelId}失败: ${error.message}`)
        }
      }
      
      // 发送消息到私聊（完整版）
      for (const bot of ctx.bots) {
        try {
          await bot.sendMessage(privateTargetId, privateMessageElements)
          logger.info(`[天选开奖] 成功发送完整开奖结果到私聊${privateTargetId}`)
          break // 成功发送后退出循环
        } catch (error) {
          logger.error(`[天选开奖] 发送消息到私聊${privateTargetId}失败: ${error.message}`)
        }
      }
      
    } catch (error) {
      logger.error(`[天选开奖] 发送开奖结果失败: ${error.message}`)
    }
  }
}
