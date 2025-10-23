import axios from 'axios'
import { Logger } from 'koishi'
import { LoggerService } from './utils/logger'
import type {
  ForceBindConfig,
  MedalInfo,
  MedalListItem,
  BilibiliMedalAPIResponse,
  EnhancedZminfoUser
} from './types'

export class ForceBinder {
  private logger: LoggerService
  private config: ForceBindConfig
  private cookieString: string

  constructor(config: ForceBindConfig, logger: LoggerService) {
    this.config = config
    this.logger = logger
    this.cookieString = this.processCookie(config.SESSDATA)
  }

  /**
   * 处理cookie字符串，支持完整cookie或单独SESSDATA
   */
  private processCookie(input: string): string {
    if (!input || input.trim() === '') {
      throw new Error('Cookie配置不能为空')
    }

    const trimmedInput = input.trim()

    // 如果输入包含多个cookie字段（包含分号），则认为是完整cookie
    if (trimmedInput.includes(';')) {
      this.logger.debug('强制绑定', '检测到完整cookie字符串')
      return trimmedInput
    }

    // 如果输入只是SESSDATA值（不包含"SESSDATA="前缀）
    if (!trimmedInput.startsWith('SESSDATA=')) {
      this.logger.debug('强制绑定', '检测到SESSDATA值，添加前缀')
      return `SESSDATA=${trimmedInput}`
    }

    // 如果输入已经是"SESSDATA=xxx"格式
    this.logger.debug('强制绑定', '检测到SESSDATA格式')
    return trimmedInput
  }

  /**
   * 检查B站登录状态
   */
  private async checkBilibiliLoginStatus(): Promise<boolean> {
    try {
      // 使用一个简单的API来检查登录状态
      const response = await axios.get('https://api.bilibili.com/x/web-interface/nav', {
        headers: {
          Cookie: this.cookieString,
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        },
        timeout: 5000
      })

      this.logger.debug('强制绑定', `登录状态检查返回: ${response.data.code}`)

      // code为0表示登录成功
      if (response.data.code === 0) {
        this.logger.debug('强制绑定', 'B站登录状态正常')
        return true
      } else {
        this.logger.warn('强制绑定', `B站登录状态异常: ${response.data.message || '未知错误'}`)
        return false
      }
    } catch (error) {
      this.logger.warn('强制绑定', `检查B站登录状态失败: ${error.message}`)
      return false
    }
  }

  /**
   * 获取用户的粉丝勋章信息（使用B站API）
   */
  private async getBilibiliMedals(uid: string): Promise<BilibiliMedalAPIResponse> {
    this.logger.debug('强制绑定', `开始获取用户 ${uid} 的粉丝勋章`)

    try {
      const url = 'https://api.live.bilibili.com/xlive/web-ucenter/user/MedalWall'
      this.logger.debug('强制绑定', `API请求: ${url}?target_id=${uid}`)

      const response = await axios.get(url, {
        params: {
          target_id: uid
        },
        headers: {
          Cookie: this.cookieString,
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        },
        timeout: 10000
      })

      this.logger.debug('强制绑定', `B站API返回状态码: ${response.status}`)

      if (this.config.debugMode) {
        this.logger.debug('强制绑定', `B站API返回数据: ${JSON.stringify(response.data, null, 2)}`)
      }

      // 检查登录状态
      if (response.data.code !== 0) {
        if (response.data.message && response.data.message.includes('未登录')) {
          this.logger.warn('强制绑定', 'B站API返回未登录错误，SESSDATA可能无效或已过期')
          throw new Error('SESSDATA无效或已过期，无法获取粉丝勋章信息')
        }
        this.logger.warn('强制绑定', `B站API返回错误: ${response.data.message || '未知错误'}`)
        throw new Error(`B站API错误: ${response.data.message || '未知错误'}`)
      }

      return response.data
    } catch (error) {
      this.logger.error('强制绑定', '获取B站粉丝勋章失败', error)
      throw error
    }
  }

  /**
   * 获取用户的基本信息（使用ZMINFO API）
   */
  private async getZminfoUserInfo(uid: string): Promise<any> {
    this.logger.debug('强制绑定', `开始获取用户 ${uid} 的ZMINFO信息`)

    try {
      const response = await axios.get(`${this.config.zminfoApiUrl}/api/user/${uid}`, {
        timeout: 10000,
        headers: {
          'User-Agent': 'Koishi-MCID-Bot/1.0'
        }
      })

      if (response.data.success && response.data.data && response.data.data.user) {
        this.logger.debug(
          '强制绑定',
          `ZMINFO API 用户信息获取成功: ${response.data.data.user.username}`
        )
        return response.data.data.user
      } else {
        this.logger.warn('强制绑定', `ZMINFO API 返回失败: ${response.data.message}`)
        return null
      }
    } catch (error) {
      this.logger.error('强制绑定', '获取ZMINFO用户信息失败', error)
      throw new Error(`无法获取用户信息: ${error.message}`)
    }
  }

  /**
   * 检查是否拥有目标粉丝牌
   */
  private checkTargetMedal(medalList: MedalListItem[]): {
    found: boolean
    name?: string
    level?: number
    guard_level?: number
    wearing_status?: number
  } {
    // 查找目标UP主的粉丝牌
    const targetMedal = medalList.find(
      item =>
        item.medal_info.target_id === this.config.targetUpUid &&
        item.medal_info.medal_name === this.config.targetMedalName
    )

    if (targetMedal) {
      this.logger.info(
        '强制绑定',
        `找到目标粉丝牌: ${targetMedal.medal_info.medal_name} LV.${targetMedal.medal_info.level}`
      )
      return {
        found: true,
        name: targetMedal.medal_info.medal_name,
        level: targetMedal.medal_info.level,
        guard_level: targetMedal.medal_info.guard_level,
        wearing_status: targetMedal.medal_info.wearing_status
      }
    }

    this.logger.debug(
      '强制绑定',
      `未找到目标粉丝牌 ${this.config.targetMedalName}（UP主UID: ${this.config.targetUpUid}）`
    )
    return { found: false }
  }

  /**
   * 强制绑定用户，获取完整信息包括目标粉丝牌数据
   */
  async forceBindUser(uid: string): Promise<EnhancedZminfoUser> {
    this.logger.info('强制绑定', `开始强制绑定用户 ${uid}`)

    try {
      // 首先检查B站登录状态
      const isLoggedIn = await this.checkBilibiliLoginStatus()

      if (!isLoggedIn) {
        throw new Error('B站登录状态异常，无法进行绑定，请检查Cookie配置')
      }

      this.logger.debug('强制绑定', 'B站登录状态正常，开始通过B站API获取用户信息')

      // 强制绑定模式仅使用B站API，不再尝试ZMINFO（避免404错误）
      const medalData = await this.getBilibiliMedals(uid)

      // 验证B站API返回结果
      if (medalData.code !== 0 || !medalData.data) {
        const errorMsg = medalData.message || 'B站API未返回有效数据'
        this.logger.error('强制绑定', `获取B站用户信息失败: ${errorMsg}`)
        throw new Error(`无法获取用户 ${uid} 的信息: ${errorMsg}`)
      }

      // 从B站API构建用户信息
      const userInfo = {
        uid: uid,
        username: medalData.data.name || `B站用户${uid}`,
        avatar_url: medalData.data.icon || '',
        guard_level: 0,
        guard_level_text: '',
        max_guard_level: 0,
        max_guard_level_text: '',
        medal: null,
        wealthMedalLevel: 0,
        last_active_time: new Date().toISOString()
      }

      this.logger.debug('强制绑定', `成功从B站API获取用户信息: ${userInfo.username}`)

      // 处理粉丝勋章信息
      let targetMedalInfo = { found: false }
      let enhancedUserInfo: EnhancedZminfoUser = {
        ...userInfo,
        targetMedal: targetMedalInfo
      }

      // 检查目标粉丝牌
      if (medalData.data && medalData.data.list) {
        // 检查目标粉丝牌
        targetMedalInfo = this.checkTargetMedal(medalData.data.list)
        enhancedUserInfo.targetMedal = targetMedalInfo
        this.logger.debug('强制绑定', `已检查目标粉丝牌，找到: ${targetMedalInfo.found}`)
      } else {
        this.logger.warn('强制绑定', 'B站API未返回粉丝勋章列表数据')
      }

      this.logger.info(
        '强制绑定',
        `强制绑定完成: 用户=${enhancedUserInfo.username}(${uid}), 目标粉丝牌=${targetMedalInfo.found ? '已找到' : '未找到'}`
      )

      return enhancedUserInfo
    } catch (error) {
      this.logger.error('强制绑定', '强制绑定过程出错', error)
      throw error // 直接重抛原始错误，不添加前缀
    }
  }

  /**
   * 转换为标准的ZminfoUser格式（用于数据库存储）
   */
  convertToZminfoUser(enhancedUser: EnhancedZminfoUser): any {
    const { targetMedal, ...standardUser } = enhancedUser
    return standardUser
  }

  /**
   * 获取目标粉丝牌的详细信息（用于显示）
   */
  getTargetMedalDetails(enhancedUser: EnhancedZminfoUser): string {
    // 检查是否有目标粉丝牌信息（即是否尝试了B站API调用）
    if (!enhancedUser.targetMedal) {
      return 'ℹ️ 未检查粉丝牌信息（B站登录状态异常，请检查SESSDATA配置）'
    }

    if (!enhancedUser.targetMedal.found) {
      return `未找到目标粉丝牌"${this.config.targetMedalName}"（UP主UID: ${this.config.targetUpUid}）`
    }

    const medal = enhancedUser.targetMedal
    let details = `🎯 目标粉丝牌: ${medal.name} LV.${medal.level}`

    if (medal.guard_level && medal.guard_level > 0) {
      const guardText =
        medal.guard_level === 1
          ? '总督'
          : medal.guard_level === 2
            ? '提督'
            : medal.guard_level === 3
              ? '舰长'
              : '未知'
      details += ` (${guardText})`
    }

    if (medal.wearing_status === 1) {
      details += ' 【已佩戴】'
    }

    return details
  }
}
