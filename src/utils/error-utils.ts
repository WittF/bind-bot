/**
 * 错误处理工具函数集合
 * 提供统一的错误信息格式化和分类功能
 */

/**
 * 获取用户友好的错误信息
 * 将技术性错误转换为用户可理解的提示
 * @param error 错误对象或错误消息字符串
 * @returns 格式化后的用户友好错误信息
 */
export function getFriendlyErrorMessage(error: Error | string): string {
  const errorMsg = error instanceof Error ? error.message : error

  // 拆分错误信息
  const userError = getUserFacingErrorMessage(errorMsg)

  // 将警告级别错误标记出来
  if (isWarningError(userError)) {
    return `⚠️ ${userError}`
  }

  // 将严重错误标记出来
  if (isCriticalError(userError)) {
    return `❌ ${userError}`
  }

  return userError
}

/**
 * 提取用户友好的错误信息
 * 根据错误消息内容返回对应的用户提示
 * @param errorMsg 原始错误消息
 * @returns 用户可理解的错误提示
 */
export function getUserFacingErrorMessage(errorMsg: string): string {
  // Mojang API相关错误
  if (errorMsg.includes('ECONNABORTED') || errorMsg.includes('timeout')) {
    return '无法连接到Mojang服务器，请稍后再试'
  }

  if (errorMsg.includes('404')) {
    return '该Minecraft用户名不存在'
  }

  if (errorMsg.includes('network') || errorMsg.includes('connect')) {
    return '网络连接异常，请稍后再试'
  }

  // 数据库相关错误
  if (errorMsg.includes('unique') || errorMsg.includes('duplicate')) {
    return '该Minecraft用户名已被其他用户绑定'
  }

  // RCON相关错误
  if (errorMsg.includes('RCON') || errorMsg.includes('服务器')) {
    if (
      errorMsg.includes('authentication') ||
      errorMsg.includes('auth') ||
      errorMsg.includes('认证')
    ) {
      return 'RCON认证失败，服务器拒绝访问，请联系管理员检查密码'
    }
    if (
      errorMsg.includes('ECONNREFUSED') ||
      errorMsg.includes('ETIMEDOUT') ||
      errorMsg.includes('无法连接')
    ) {
      return '无法连接到游戏服务器，请确认服务器是否在线或联系管理员'
    }
    if (errorMsg.includes('command') || errorMsg.includes('执行命令')) {
      return '服务器命令执行失败，请稍后再试'
    }
    return '与游戏服务器通信失败，请稍后再试'
  }

  // 用户名相关错误
  if (errorMsg.includes('用户名') || errorMsg.includes('username')) {
    if (errorMsg.includes('不存在')) {
      return '该Minecraft用户名不存在，请检查拼写'
    }
    if (errorMsg.includes('已被')) {
      return '该Minecraft用户名已被其他用户绑定，请使用其他用户名'
    }
    if (errorMsg.includes('格式')) {
      return 'Minecraft用户名格式不正确，应为3-16位字母、数字和下划线'
    }
    return '用户名验证失败，请检查用户名并重试'
  }

  // 默认错误信息
  return '操作失败，请稍后再试'
}

/**
 * 判断是否为警告级别错误（用户可能输入有误）
 * @param errorMsg 错误消息
 * @returns 是否为警告级别错误
 */
export function isWarningError(errorMsg: string): boolean {
  const warningPatterns = [
    '用户名不存在',
    '格式不正确',
    '已被其他用户绑定',
    '已在白名单中',
    '不在白名单中',
    '未绑定MC账号',
    '冷却期内'
  ]

  return warningPatterns.some(pattern => errorMsg.includes(pattern))
}

/**
 * 判断是否为严重错误（系统问题）
 * @param errorMsg 错误消息
 * @returns 是否为严重错误
 */
export function isCriticalError(errorMsg: string): boolean {
  const criticalPatterns = ['无法连接', 'RCON认证失败', '服务器通信失败', '数据库操作出错']

  return criticalPatterns.some(pattern => errorMsg.includes(pattern))
}
