// 错误处理服务 - 从原 index.ts 提取错误处理相关逻辑

import { Logger } from 'koishi'
import { Config } from '../types'
import { ERROR_TYPES } from '../utils/constants'

// 错误信息接口
export interface ErrorInfo {
  type: string
  code?: string
  message: string
  originalError?: Error
  userMessage: string
  shouldLog: boolean
  logLevel: 'debug' | 'info' | 'warn' | 'error'
}

export class ErrorService {
  private logger: Logger

  constructor(
    private config: Config,
    logger: Logger
  ) {
    this.logger = logger.extend('ErrorService')
  }

  // 处理并格式化错误 - 从原代码提取
  handleError(error: any, context?: string): ErrorInfo {
    const errorInfo: ErrorInfo = {
      type: ERROR_TYPES.VALIDATION,
      message: '',
      userMessage: '',
      shouldLog: true,
      logLevel: 'error'
    }

    try {
      // 分析错误类型并处理
      if (error instanceof Error) {
        errorInfo.originalError = error
        errorInfo.message = error.message
        
        // 根据错误消息判断错误类型
        if (this.isNetworkError(error)) {
          errorInfo.type = ERROR_TYPES.NETWORK
          errorInfo.userMessage = this.formatNetworkError(error)
          errorInfo.logLevel = 'warn'
        } else if (this.isDatabaseError(error)) {
          errorInfo.type = ERROR_TYPES.DATABASE
          errorInfo.userMessage = this.formatDatabaseError(error)
          errorInfo.logLevel = 'error'
        } else if (this.isPermissionError(error)) {
          errorInfo.type = ERROR_TYPES.PERMISSION
          errorInfo.userMessage = this.formatPermissionError(error)
          errorInfo.logLevel = 'info'
        } else if (this.isValidationError(error)) {
          errorInfo.type = ERROR_TYPES.VALIDATION
          errorInfo.userMessage = this.formatValidationError(error)
          errorInfo.logLevel = 'debug'
        } else {
          errorInfo.userMessage = this.formatGenericError(error)
        }
      } else if (typeof error === 'string') {
        errorInfo.message = error
        errorInfo.userMessage = error
        errorInfo.logLevel = 'info'
      } else {
        errorInfo.message = '未知错误'
        errorInfo.userMessage = '发生未知错误，请稍后再试'
      }

      // 记录错误日志
      if (errorInfo.shouldLog) {
        const logMessage = context 
          ? `[${context}] ${errorInfo.message}` 
          : errorInfo.message

        switch (errorInfo.logLevel) {
          case 'debug':
            this.logger.debug(logMessage)
            break
          case 'info':
            this.logger.info(logMessage)
            break
          case 'warn':
            this.logger.warn(logMessage)
            break
          case 'error':
            this.logger.error(logMessage, errorInfo.originalError)
            break
        }
      }

    } catch (handleError) {
      // 处理错误处理过程中的异常
      this.logger.error(`错误处理过程中发生异常: ${handleError.message}`)
      errorInfo.message = '错误处理异常'
      errorInfo.userMessage = '系统处理错误时发生异常，请联系管理员'
    }

    return errorInfo
  }

  // 判断是否为网络错误 - 从原代码提取
  private isNetworkError(error: Error): boolean {
    const networkErrorPatterns = [
      'ECONNREFUSED',
      'ETIMEDOUT',
      'ECONNRESET',
      'ENOTFOUND',
      'EHOSTUNREACH',
      'ENETUNREACH',
      'timeout',
      'network',
      'connection',
      'request failed',
      'fetch failed'
    ]

    const message = error.message.toLowerCase()
    return networkErrorPatterns.some(pattern => message.includes(pattern.toLowerCase()))
  }

  // 判断是否为数据库错误 - 从原代码提取
  private isDatabaseError(error: Error): boolean {
    const dbErrorPatterns = [
      'database',
      'sql',
      'sqlite',
      'mysql',
      'postgresql',
      'constraint',
      'unique',
      'foreign key',
      'syntax error',
      'table',
      'column'
    ]

    const message = error.message.toLowerCase()
    return dbErrorPatterns.some(pattern => message.includes(pattern.toLowerCase()))
  }

  // 判断是否为权限错误 - 从原代码提取
  private isPermissionError(error: Error): boolean {
    const permissionErrorPatterns = [
      'permission',
      'unauthorized',
      'forbidden',
      'access denied',
      'insufficient',
      'privilege',
      '权限',
      '无权',
      '拒绝'
    ]

    const message = error.message.toLowerCase()
    return permissionErrorPatterns.some(pattern => 
      message.includes(pattern.toLowerCase())
    )
  }

  // 判断是否为验证错误 - 从原代码提取
  private isValidationError(error: Error): boolean {
    const validationErrorPatterns = [
      'validation',
      'invalid',
      'format',
      'required',
      'missing',
      'empty',
      '格式',
      '无效',
      '不能为空',
      '必填'
    ]

    const message = error.message.toLowerCase()
    return validationErrorPatterns.some(pattern => 
      message.includes(pattern.toLowerCase())
    )
  }

  // 格式化网络错误消息 - 从原代码提取
  private formatNetworkError(error: Error): string {
    const message = error.message.toLowerCase()
    
    if (message.includes('timeout') || message.includes('etimedout')) {
      return '网络请求超时，请检查网络连接后重试'
    } else if (message.includes('econnrefused')) {
      return '无法连接到服务器，请稍后再试'
    } else if (message.includes('enotfound')) {
      return '无法找到服务器地址，请检查配置'
    } else if (message.includes('econnreset')) {
      return '网络连接被重置，请重试'
    } else {
      return `网络错误: ${error.message}`
    }
  }

  // 格式化数据库错误消息 - 从原代码提取
  private formatDatabaseError(error: Error): string {
    const message = error.message.toLowerCase()
    
    if (message.includes('unique constraint')) {
      return '数据重复，该记录已存在'
    } else if (message.includes('foreign key constraint')) {
      return '数据关联错误，请检查相关数据'
    } else if (message.includes('not null constraint')) {
      return '缺少必要的数据字段'
    } else if (message.includes('syntax error')) {
      return '数据查询语法错误'
    } else {
      return '数据库操作失败，请稍后再试'
    }
  }

  // 格式化权限错误消息 - 从原代码提取
  private formatPermissionError(error: Error): string {
    const message = error.message.toLowerCase()
    
    if (message.includes('admin') || message.includes('管理员')) {
      return '该操作需要管理员权限'
    } else if (message.includes('master') || message.includes('主人')) {
      return '该操作需要主人权限'
    } else if (message.includes('insufficient')) {
      return '权限不足，无法执行该操作'
    } else {
      return '没有执行该操作的权限'
    }
  }

  // 格式化验证错误消息 - 从原代码提取
  private formatValidationError(error: Error): string {
    // 验证错误通常已经有用户友好的消息，直接返回
    return error.message
  }

  // 格式化通用错误消息 - 从原代码提取
  private formatGenericError(error: Error): string {
    // 检查是否包含敏感信息，如果是则返回通用消息
    const sensitivePatterns = [
      'password',
      'token',
      'key',
      'secret',
      'api',
      'config'
    ]

    const message = error.message.toLowerCase()
    const hasSensitiveInfo = sensitivePatterns.some(pattern => 
      message.includes(pattern)
    )

    if (hasSensitiveInfo) {
      return '操作失败，请联系管理员'
    } else {
      return error.message
    }
  }

  // 创建用户友好的错误消息 - 从原代码提取
  createUserFriendlyMessage(error: any, context?: string): string {
    const errorInfo = this.handleError(error, context)
    
    // 如果是调试模式，返回详细错误信息
    if (this.config.debugMode) {
      let debugMessage = `[${errorInfo.type}] ${errorInfo.userMessage}`
      if (errorInfo.originalError) {
        debugMessage += `\\n详细错误: ${errorInfo.originalError.message}`
      }
      if (context) {
        debugMessage += `\\n上下文: ${context}`
      }
      return debugMessage
    } else {
      return errorInfo.userMessage
    }
  }

  // 记录错误统计 - 从原代码提取
  private errorStats: Map<string, { count: number, lastOccurred: Date }> = new Map()

  logErrorStats(errorType: string): void {
    const current = this.errorStats.get(errorType) || { count: 0, lastOccurred: new Date() }
    current.count++
    current.lastOccurred = new Date()
    this.errorStats.set(errorType, current)
    
    // 如果错误频率过高，记录警告
    if (current.count > 10) {
      this.logger.warn(`错误类型 ${errorType} 发生频率过高: ${current.count} 次`)
    }
  }

  // 获取错误统计信息
  getErrorStats(): { [errorType: string]: { count: number, lastOccurred: string } } {
    const stats: { [errorType: string]: { count: number, lastOccurred: string } } = {}
    
    for (const [errorType, info] of this.errorStats.entries()) {
      stats[errorType] = {
        count: info.count,
        lastOccurred: info.lastOccurred.toLocaleString('zh-CN', {
          timeZone: 'Asia/Shanghai'
        })
      }
    }
    
    return stats
  }

  // 清理错误统计
  clearErrorStats(): void {
    this.errorStats.clear()
    this.logger.info('错误统计已清理')
  }

  // 检查是否为临时错误（可重试）
  isTemporaryError(error: any): boolean {
    if (!(error instanceof Error)) return false
    
    const temporaryErrorPatterns = [
      'timeout',
      'temporary',
      'busy',
      'unavailable',
      'rate limit',
      'too many requests',
      'try again'
    ]
    
    const message = error.message.toLowerCase()
    return temporaryErrorPatterns.some(pattern => 
      message.includes(pattern.toLowerCase())
    )
  }

  // 检查是否为严重错误（需要立即关注）
  isCriticalError(error: any): boolean {
    if (!(error instanceof Error)) return false
    
    const criticalErrorPatterns = [
      'out of memory',
      'stack overflow',
      'segmentation fault',
      'fatal',
      'critical',
      'corruption',
      'integrity'
    ]
    
    const message = error.message.toLowerCase()
    return criticalErrorPatterns.some(pattern => 
      message.includes(pattern.toLowerCase())
    )
  }

  // 生成错误报告
  generateErrorReport(errors: ErrorInfo[]): string {
    if (errors.length === 0) {
      return '没有错误记录'
    }
    
    const report = [
      `错误报告 (${new Date().toLocaleString('zh-CN')})`,
      `总计错误数量: ${errors.length}`,
      ''
    ]
    
    // 按错误类型分组
    const groupedErrors = errors.reduce((groups, error) => {
      const type = error.type
      if (!groups[type]) {
        groups[type] = []
      }
      groups[type].push(error)
      return groups
    }, {} as { [type: string]: ErrorInfo[] })
    
    // 生成分组报告
    for (const [type, typeErrors] of Object.entries(groupedErrors)) {
      report.push(`## ${type} 错误 (${typeErrors.length} 个)`)
      
      typeErrors.slice(0, 5).forEach((error, index) => {
        report.push(`${index + 1}. ${error.userMessage}`)
        if (error.originalError && this.config.debugMode) {
          report.push(`   详细: ${error.originalError.message}`)
        }
      })
      
      if (typeErrors.length > 5) {
        report.push(`   ... 还有 ${typeErrors.length - 5} 个同类错误`)
      }
      
      report.push('')
    }
    
    return report.join('\\n')
  }

  // 销毁服务
  async dispose(): Promise<void> {
    this.logger.info('ErrorService 正在销毁')
    this.clearErrorStats()
  }
} 