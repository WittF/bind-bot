import { Logger, Session } from 'koishi'

/**
 * 通用工具函数集合
 */

/**
 * 规范化QQ号格式
 * 支持处理：
 * - platform:123456 格式
 * - <at id="123456"/> 格式
 * - @用户 格式
 * - 纯数字格式
 *
 * @param userId 用户ID（可能包含平台前缀或特殊格式）
 * @param logger Koishi Logger实例（用于警告日志）
 * @returns 纯QQ号字符串，失败返回空字符串
 */
export function normalizeQQId(userId: string, logger?: Logger): string {
  // 处理空值情况
  if (!userId) {
    logger?.warn(`[用户ID] 收到空用户ID`)
    return ''
  }

  let extractedId = ''

  // 检查是否是手动输入的@符号（错误用法）
  if (userId.startsWith('@') && !userId.match(/<at\s+id="[^"]+"\s*\/>/)) {
    logger?.warn(`[用户ID] 检测到手动输入的@符号"${userId}"，应使用真正的@功能`)
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
    logger?.warn(`[用户ID] 提取的ID"${extractedId}"不是有效的QQ号(必须为纯数字)，来源: ${userId}`)
    return ''  // 返回空字符串表示无效
  }

  // 检查QQ号长度是否合理(QQ号通常为5-12位数字)
  if (extractedId.length < 5 || extractedId.length > 12) {
    logger?.warn(`[用户ID] QQ号"${extractedId}"长度异常(${extractedId.length}位)，有效范围为5-12位`)
    return ''
  }

  return extractedId
}

/**
 * 格式化命令提示（添加机器人昵称前缀）
 * @param cmd 命令字符串
 * @param allowTextPrefix 是否允许文本前缀
 * @param botNickname 机器人昵称
 * @returns 格式化后的命令字符串
 */
export function formatCommand(cmd: string, allowTextPrefix: boolean, botNickname: string): string {
  if (allowTextPrefix && botNickname) {
    // 检查botNickname是否已经包含@符号，避免重复添加
    const nickname = botNickname.startsWith('@') ? botNickname : `@${botNickname}`;
    return `${nickname} ${cmd}`;
  }
  return cmd;
}

/**
 * 格式化UUID（添加连字符，使其符合标准格式）
 * @param uuid 不带连字符的UUID字符串
 * @param logger Koishi Logger实例（用于警告日志）
 * @returns 标准格式的UUID
 */
export function formatUuid(uuid: string, logger?: Logger): string {
  if (!uuid) return '未知'
  if (uuid.includes('-')) return uuid // 已经是带连字符的格式

  // 确保UUID长度正确
  if (uuid.length !== 32) {
    logger?.warn(`[UUID] UUID "${uuid}" 长度异常，无法格式化`)
    return uuid
  }

  return `${uuid.substring(0, 8)}-${uuid.substring(8, 12)}-${uuid.substring(12, 16)}-${uuid.substring(16, 20)}-${uuid.substring(20)}`
}

/**
 * 检查冷却时间是否已过
 * @param lastModified 上次修改时间
 * @param cooldownDays 冷却天数
 * @param multiplier 倍数（用于B站UID冷却时间）
 * @returns 是否已过冷却期
 */
export function checkCooldown(lastModified: Date | null, cooldownDays: number, multiplier: number = 1): boolean {
  if (!lastModified) return true
  const now = new Date()
  const diffTime = now.getTime() - lastModified.getTime()
  // 使用Math.floor确保冷却时间精确
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24))
  return diffDays >= cooldownDays * multiplier
}

/**
 * 获取Crafatar头像URL
 * @param uuid MC用户的UUID
 * @param logger Koishi Logger实例（用于日志）
 * @returns 头像URL或null
 */
export function getCrafatarUrl(uuid: string, logger?: Logger): string | null {
  if (!uuid) return null

  // 检查UUID格式 (不带连字符应为32位，带连字符应为36位)
  const uuidRegex = /^[0-9a-f]{32}$|^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuidRegex.test(uuid)) {
    logger?.warn(`[MC头图] UUID "${uuid}" 格式无效，无法生成头图URL`)
    return null
  }

  // 移除任何连字符，Crafatar接受不带连字符的UUID
  const cleanUuid = uuid.replace(/-/g, '')

  // 直接生成URL
  const url = `https://crafatar.com/avatars/${cleanUuid}`

  logger?.debug(`[MC头图] 为UUID "${cleanUuid}" 生成头图URL`)
  return url
}

/**
 * 获取Starlight皮肤渲染URL（随机姿势）
 * @param username MC用户名
 * @param logger Koishi Logger实例（用于日志）
 * @returns 皮肤渲染URL或null
 */
export function getStarlightSkinUrl(username: string, logger?: Logger): string | null {
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

  logger?.debug(`[Starlight皮肤] 为用户名"${username}"生成动作"${randomPose}"的渲染URL`)
  return url
}

/**
 * 检查绑定会话中的输入是否为无关内容
 * @param state 当前会话状态
 * @param content 用户输入内容
 * @returns 是否为无关输入
 */
export function checkIrrelevantInput(state: 'waiting_mc_username' | 'waiting_buid', content: string): boolean {
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

  if (state === 'waiting_mc_username') {
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
  } else if (state === 'waiting_buid') {
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

/**
 * 转义正则表达式特殊字符
 * @param string 需要转义的字符串
 * @returns 转义后的字符串
 */
export function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 清理用户输入中的@Bot前缀
 * @param content 用户输入内容
 * @param session Koishi Session对象
 * @param botNickname 机器人昵称配置
 * @param logger Koishi Logger实例（用于日志）
 * @returns 清理后的输入内容
 */
export function cleanUserInput(content: string, session: Session, botNickname: string, logger?: Logger): string {
  if (!content) return content

  // 获取机器人的用户ID
  const botUserId = session.bot.userId

  // 匹配各种@Bot的格式
  const atPatterns = [
    // <at id="botUserId"/> 格式
    new RegExp(`^<at id="${escapeRegExp(botUserId)}"/>\\s*`, 'i'),
    // @Bot昵称 格式（如果配置了botNickname）
    botNickname ? new RegExp(`^@${escapeRegExp(botNickname)}\\s+`, 'i') : null,
    // @botUserId 格式
    new RegExp(`^@${escapeRegExp(botUserId)}\\s+`, 'i'),
  ].filter(Boolean)

  let cleanedContent = content.trim()

  // 尝试匹配并移除@Bot前缀
  for (const pattern of atPatterns) {
    if (pattern.test(cleanedContent)) {
      cleanedContent = cleanedContent.replace(pattern, '').trim()
      logger?.debug(`[交互绑定] 清理用户输入，原始: "${content}" -> 清理后: "${cleanedContent}"`)
      break
    }
  }

  return cleanedContent
}

/**
 * 计算两个字符串之间的Levenshtein距离
 * Levenshtein距离是指将一个字符串转换成另一个字符串所需的最少编辑操作次数
 * @param str1 第一个字符串
 * @param str2 第二个字符串
 * @returns 两个字符串之间的编辑距离
 */
export function levenshteinDistance(str1: string, str2: string): number {
  const matrix: number[][] = []

  // 初始化第一列
  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i]
  }

  // 初始化第一行
  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j
  }

  // 填充矩阵
  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // 替换
          matrix[i][j - 1] + 1,     // 插入
          matrix[i - 1][j] + 1      // 删除
        )
      }
    }
  }

  return matrix[str2.length][str1.length]
}

/**
 * 计算两个字符串的相似度（基于Levenshtein距离）
 * @param str1 第一个字符串
 * @param str2 第二个字符串
 * @returns 相似度值（0到1之间，1表示完全相同）
 */
export function calculateSimilarity(str1: string, str2: string): number {
  const distance = levenshteinDistance(str1, str2)
  const maxLength = Math.max(str1.length, str2.length)
  return 1 - distance / maxLength
}

/**
 * 规范化 Minecraft 用户名（统一小写，用于存储和比较）
 * Minecraft 用户名不区分大小写，但 Mojang 返回的是规范大小写
 * 为避免 "Notch" 和 "notch" 被视为不同用户，统一转小写存储
 *
 * @param username MC 用户名
 * @param logger Koishi Logger实例（用于日志）
 * @returns 规范化后的用户名（小写）
 */
export function normalizeUsername(username: string, logger?: Logger): string {
  if (!username) {
    logger?.warn(`[用户名规范化] 收到空用户名`)
    return ''
  }

  // 移除首尾空格
  const trimmed = username.trim()

  // 检查是否为临时用户名，临时用户名不做转换
  if (trimmed.startsWith('_temp_')) {
    return trimmed
  }

  // 转小写
  const normalized = trimmed.toLowerCase()

  if (normalized !== trimmed) {
    logger?.debug(`[用户名规范化] "${trimmed}" -> "${normalized}"`)
  }

  return normalized
}

/**
 * 比较两个 Minecraft 用户名是否相同（不区分大小写）
 *
 * @param username1 第一个用户名
 * @param username2 第二个用户名
 * @returns 是否相同
 */
export function isSameUsername(username1: string, username2: string): boolean {
  if (!username1 || !username2) return false
  return normalizeUsername(username1) === normalizeUsername(username2)
}
