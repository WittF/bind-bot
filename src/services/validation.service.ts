// 验证工具服务 - 从原 index.ts 提取所有验证相关逻辑

import { Session, Logger } from 'koishi'
import { Config, PermissionLevel, MCIDBIND } from '../types'
import { 
  MC_USERNAME_REGEX, 
  MC_USERNAME_MIN_LENGTH, 
  MC_USERNAME_MAX_LENGTH,
  UUID_REGEX_WITH_DASH,
  UUID_REGEX_WITHOUT_DASH,
  TAG_NAME_REGEX,
  TAG_NAME_MAX_LENGTH,
  SERVER_ID_REGEX
} from '../utils/constants'

export class ValidationService {
  private logger: Logger

  constructor(
    private config: Config,
    logger: Logger
  ) {
    this.logger = logger.extend('ValidationService')
  }

  // 验证MC用户名格式 - 从原代码提取
  isValidMcUsername(username: string): boolean {
    if (!username) {
      this.logger.debug('MC用户名为空')
      return false
    }

    // 检查长度
    if (username.length < MC_USERNAME_MIN_LENGTH || username.length > MC_USERNAME_MAX_LENGTH) {
      this.logger.debug(`MC用户名长度无效: ${username} (长度: ${username.length})`)
      return false
    }

    // 检查字符格式
    if (!MC_USERNAME_REGEX.test(username)) {
      this.logger.debug(`MC用户名格式无效: ${username}`)
      return false
    }

    // 检查是否以下划线开头（保留前缀）
    if (username.startsWith('_')) {
      this.logger.debug(`MC用户名不能以下划线开头: ${username}`)
      return false
    }

    return true
  }

  // 验证UUID格式 - 从原代码提取
  isValidUuid(uuid: string): boolean {
    if (!uuid) {
      this.logger.debug('UUID为空')
      return false
    }

    // 检查带连字符的UUID格式
    if (UUID_REGEX_WITH_DASH.test(uuid)) {
      return true
    }

    // 检查不带连字符的UUID格式
    if (UUID_REGEX_WITHOUT_DASH.test(uuid)) {
      return true
    }

    this.logger.debug(`UUID格式无效: ${uuid}`)
    return false
  }

  // 格式化UUID（添加连字符） - 从原代码提取
  formatUuid(uuid: string): string {
    if (!uuid) return ''
    
    // 如果已经有连字符，直接返回
    if (uuid.includes('-')) {
      return uuid.toLowerCase()
    }
    
    // 32位UUID，添加连字符
    if (uuid.length === 32) {
      return `${uuid.substring(0, 8)}-${uuid.substring(8, 12)}-${uuid.substring(12, 16)}-${uuid.substring(16, 20)}-${uuid.substring(20, 32)}`.toLowerCase()
    }
    
    this.logger.warn(`无法格式化UUID: ${uuid}`)
    return uuid.toLowerCase()
  }

  // 移除UUID连字符 - 从原代码提取
  removeUuidDashes(uuid: string): string {
    return uuid ? uuid.replace(/-/g, '') : ''
  }

  // 验证标签名称格式 - 从原代码提取
  isValidTagName(tagName: string): boolean {
    if (!tagName) {
      this.logger.debug('标签名称为空')
      return false
    }

    // 检查长度
    if (tagName.length > TAG_NAME_MAX_LENGTH) {
      this.logger.debug(`标签名称过长: ${tagName} (长度: ${tagName.length})`)
      return false
    }

    // 检查格式（允许中文、英文、数字、下划线）
    if (!TAG_NAME_REGEX.test(tagName)) {
      this.logger.debug(`标签名称格式无效: ${tagName}`)
      return false
    }

    // 检查保留标签名
    const reservedTags = ['admin', 'owner', 'master', 'bot', 'system']
    if (reservedTags.includes(tagName.toLowerCase())) {
      this.logger.debug(`标签名称为保留字: ${tagName}`)
      return false
    }

    return true
  }

  // 验证服务器ID格式 - 从原代码提取
  isValidServerId(serverId: string): boolean {
    if (!serverId) {
      this.logger.debug('服务器ID为空')
      return false
    }

    if (!SERVER_ID_REGEX.test(serverId)) {
      this.logger.debug(`服务器ID格式无效: ${serverId}`)
      return false
    }

    return true
  }

  // 验证B站UID格式 - 从原代码提取
  isValidBuidUid(uid: string): boolean {
    if (!uid) {
      this.logger.debug('B站UID为空')
      return false
    }

    // B站UID应该是纯数字，长度通常在6-15位
    if (!/^\d{6,15}$/.test(uid)) {
      this.logger.debug(`B站UID格式无效: ${uid}`)
      return false
    }

    return true
  }

  // 检查用户权限 - 从原代码提取
  async checkUserPermission(session: Session, requiredLevel: PermissionLevel, databaseService: any): Promise<{
    hasPermission: boolean
    userLevel: PermissionLevel
    message?: string
  }> {
    try {
      const userId = session.userId
      const normalizedQQId = databaseService?.normalizeQQId(userId)
      
      if (!normalizedQQId) {
        return {
          hasPermission: false,
          userLevel: 'user',
          message: '无法识别用户身份'
        }
      }

      // 检查是否为主人
      if (this.config.masterId && normalizedQQId === this.config.masterId) {
        this.logger.debug(`用户 ${normalizedQQId} 确认为主人身份`)
        return {
          hasPermission: true,
          userLevel: 'master'
        }
      }

      // 检查是否为管理员
      if (databaseService) {
        const bind = await databaseService.getMcBindByQQId(normalizedQQId)
        if (bind && bind.isAdmin) {
          this.logger.debug(`用户 ${normalizedQQId} 确认为管理员身份`)
          
          // 管理员可以执行用户和管理员权限的操作
          if (requiredLevel === 'user' || requiredLevel === 'admin') {
            return {
              hasPermission: true,
              userLevel: 'admin'
            }
          } else {
            return {
              hasPermission: false,
              userLevel: 'admin',
              message: '该操作需要主人权限'
            }
          }
        }
      }

      // 普通用户
      this.logger.debug(`用户 ${normalizedQQId} 为普通用户身份`)
      if (requiredLevel === 'user') {
        return {
          hasPermission: true,
          userLevel: 'user'
        }
      } else {
        const levelText = requiredLevel === 'admin' ? '管理员' : '主人'
        return {
          hasPermission: false,
          userLevel: 'user',
          message: `该操作需要${levelText}权限`
        }
      }

    } catch (error) {
      this.logger.error(`权限检查失败: ${error.message}`)
      return {
        hasPermission: false,
        userLevel: 'user',
        message: '权限检查失败'
      }
    }
  }

  // 检查用户操作冷却时间 - 从原代码提取
  async checkUserCooldown(userId: string, databaseService: any): Promise<{
    canOperate: boolean
    remainingHours?: number
    message?: string
  }> {
    try {
      if (this.config.cooldownDays <= 0) {
        // 如果冷却时间设置为0或负数，则不限制
        return { canOperate: true }
      }

      const normalizedQQId = databaseService?.normalizeQQId(userId)
      if (!normalizedQQId) {
        return {
          canOperate: false,
          message: '无法识别用户身份'
        }
      }

      const bind = await databaseService.getMcBindByQQId(normalizedQQId)
      if (!bind || !bind.lastModified) {
        // 用户未绑定或没有修改记录，可以操作
        return { canOperate: true }
      }

      const lastModifiedTime = new Date(bind.lastModified).getTime()
      const currentTime = Date.now()
      const cooldownTime = this.config.cooldownDays * 24 * 60 * 60 * 1000

      const timeSinceLastOperation = currentTime - lastModifiedTime
      const remainingTime = cooldownTime - timeSinceLastOperation

      if (remainingTime <= 0) {
        // 冷却时间已过
        return { canOperate: true }
      } else {
        // 仍在冷却期内
        const remainingHours = Math.ceil(remainingTime / (60 * 60 * 1000))
        return {
          canOperate: false,
          remainingHours,
          message: `操作冷却中，还需等待 ${remainingHours} 小时`
        }
      }

    } catch (error) {
      this.logger.error(`冷却时间检查失败: ${error.message}`)
      return {
        canOperate: false,
        message: '冷却时间检查失败'
      }
    }
  }

  // 检查用户是否可以操作目标用户 - 从原代码提取
  async checkCanOperateOnTarget(operatorId: string, targetId: string, databaseService: any): Promise<{
    canOperate: boolean
    message?: string
  }> {
    try {
      const normalizedOperatorId = databaseService?.normalizeQQId(operatorId)
      const normalizedTargetId = databaseService?.normalizeQQId(targetId)

      if (!normalizedOperatorId || !normalizedTargetId) {
        return {
          canOperate: false,
          message: '无法识别用户身份'
        }
      }

      // 检查操作者权限
      const operatorPermission = await this.checkUserPermission({ userId: operatorId } as Session, 'admin', databaseService)
      
      if (!operatorPermission.hasPermission) {
        return {
          canOperate: false,
          message: operatorPermission.message || '权限不足'
        }
      }

      // 主人可以操作任何人
      if (operatorPermission.userLevel === 'master') {
        return { canOperate: true }
      }

      // 管理员不能操作其他管理员或主人
      if (operatorPermission.userLevel === 'admin') {
        const targetPermission = await this.checkUserPermission({ userId: targetId } as Session, 'user', databaseService)
        
        if (targetPermission.userLevel === 'master') {
          return {
            canOperate: false,
            message: '管理员不能操作主人'
          }
        }

        if (targetPermission.userLevel === 'admin' && normalizedOperatorId !== normalizedTargetId) {
          return {
            canOperate: false,
            message: '管理员不能操作其他管理员'
          }
        }
      }

      return { canOperate: true }

    } catch (error) {
      this.logger.error(`操作权限检查失败: ${error.message}`)
      return {
        canOperate: false,
        message: '操作权限检查失败'
      }
    }
  }

  // 验证服务器是否存在 - 从原代码提取
  validateServer(serverId: string): {
    isValid: boolean
    server?: any
    message?: string
  } {
    if (!serverId) {
      return {
        isValid: false,
        message: '服务器ID不能为空'
      }
    }

    if (!this.isValidServerId(serverId)) {
      return {
        isValid: false,
        message: '服务器ID格式无效'
      }
    }

    if (!this.config.servers || this.config.servers.length === 0) {
      return {
        isValid: false,
        message: '未配置任何服务器'
      }
    }

    const server = this.config.servers.find(s => s.id === serverId)
    if (!server) {
      return {
        isValid: false,
        message: `服务器 ${serverId} 不存在`
      }
    }

    if (server.enabled === false) {
      return {
        isValid: false,
        message: `服务器 ${server.name} 已被禁用`
      }
    }

    return {
      isValid: true,
      server
    }
  }

  // 验证批量操作的用户数量限制 - 从原代码提取
  validateBatchOperationLimit(userCount: number, maxLimit: number = 50): {
    isValid: boolean
    message?: string
  } {
    if (userCount <= 0) {
      return {
        isValid: false,
        message: '用户数量必须大于0'
      }
    }

    if (userCount > maxLimit) {
      return {
        isValid: false,
        message: `批量操作用户数量不能超过${maxLimit}个`
      }
    }

    return { isValid: true }
  }

  // 验证用户绑定状态 - 从原代码提取
  validateUserBinding(bind: MCIDBIND | null, requireMc: boolean = false, requireBuid: boolean = false): {
    isValid: boolean
    message?: string
  } {
    if (!bind) {
      return {
        isValid: false,
        message: '用户未进行任何绑定'
      }
    }

    if (requireMc) {
      if (!bind.mcUsername || bind.mcUsername.startsWith('_temp_')) {
        return {
          isValid: false,
          message: '用户未绑定MC账号'
        }
      }
    }

    if (requireBuid) {
      if (!bind.buidUid || !bind.buidUsername) {
        return {
          isValid: false,
          message: '用户未绑定B站账号'
        }
      }
    }

    return { isValid: true }
  }

  // 验证标签操作权限 - 从原代码提取
  validateTagOperation(tagName: string, operationType: 'add' | 'remove' | 'rename' | 'delete'): {
    isValid: boolean
    message?: string
  } {
    if (!this.isValidTagName(tagName)) {
      return {
        isValid: false,
        message: '标签名称格式无效（只能包含中文、英文、数字、下划线，且长度不超过20字符）'
      }
    }

    // 系统保留标签不允许某些操作
    const systemTags = ['新用户', '活跃用户', 'VIP']
    if (systemTags.includes(tagName)) {
      if (operationType === 'rename' || operationType === 'delete') {
        return {
          isValid: false,
          message: `系统标签"${tagName}"不允许${operationType === 'rename' ? '重命名' : '删除'}操作`
        }
      }
    }

    return { isValid: true }
  }

  // 验证群昵称格式 - 从原代码提取
  validateGroupNickname(nickname: string): {
    isValid: boolean
    suggestedNickname?: string
    message?: string
  } {
    if (!nickname) {
      return {
        isValid: false,
        message: '群昵称不能为空'
      }
    }

    // 检查长度限制
    if (nickname.length > 32) {
      return {
        isValid: false,
        message: '群昵称长度不能超过32字符'
      }
    }

    // 检查是否包含特殊字符
    const invalidChars = /[<>@#&"']/
    if (invalidChars.test(nickname)) {
      return {
        isValid: false,
        message: '群昵称不能包含特殊字符: < > @ # & " \''
      }
    }

    // 建议的昵称格式：MC用户名(B站用户名)
    const suggestedFormat = /^[a-zA-Z0-9_]{3,16}\([^)]+\)$/
    if (!suggestedFormat.test(nickname)) {
      return {
        isValid: true, // 格式不标准但可以接受
        message: '建议使用格式: MC用户名(B站用户名)'
      }
    }

    return { isValid: true }
  }

  // 检查命令参数数量 - 从原代码提取
  validateCommandArgs(args: string[], minArgs: number, maxArgs?: number): {
    isValid: boolean
    message?: string
  } {
    if (args.length < minArgs) {
      return {
        isValid: false,
        message: `参数不足，至少需要${minArgs}个参数`
      }
    }

    if (maxArgs && args.length > maxArgs) {
      return {
        isValid: false,
        message: `参数过多，最多只能有${maxArgs}个参数`
      }
    }

    return { isValid: true }
  }

  // 验证输入内容安全性 - 从原代码提取
  validateInputSecurity(input: string): {
    isSafe: boolean
    sanitizedInput?: string
    message?: string
  } {
    if (!input) {
      return { isSafe: true, sanitizedInput: '' }
    }

    // 检查SQL注入风险
    const sqlInjectionPattern = /['";\\x00\\n\\r\\x1a]/g
    if (sqlInjectionPattern.test(input)) {
      return {
        isSafe: false,
        message: '输入包含潜在的安全风险字符'
      }
    }

    // 检查命令注入风险
    const commandInjectionPattern = /[;&|`$(){}\\[\\]]/g
    if (commandInjectionPattern.test(input)) {
      const sanitized = input.replace(commandInjectionPattern, '')
      return {
        isSafe: false,
        sanitizedInput: sanitized,
        message: '输入包含潜在的命令注入字符，已自动过滤'
      }
    }

    return { isSafe: true, sanitizedInput: input }
  }

  // 销毁服务
  async dispose(): Promise<void> {
    this.logger.info('ValidationService 正在销毁')
    // 验证服务通常不需要特殊的清理工作
  }
} 