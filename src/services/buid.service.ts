// B站API服务 - 从原 index.ts 提取所有B站相关逻辑

import { Logger } from 'koishi'
import axios from 'axios'
import { ZminfoUser, ZminfoApiResponse, MCIDBIND, Config } from '../types'

export class BuidService {
  private logger: Logger

  constructor(
    private config: Config,
    logger: Logger
  ) {
    this.logger = logger.extend('BuidService')
  }

  // 验证BUID是否存在 - 从原代码提取
  async validateBUID(buid: string): Promise<ZminfoUser | null> {
    try {
      if (!buid || !/^\d+$/.test(buid)) {
        this.logger.warn(`无效的B站UID格式: ${buid}`)
        return null
      }

      this.logger.debug(`验证B站UID: ${buid}`)
      
      const response = await axios.get(`${this.config.zminfoApiUrl}/api/user/${buid}`, {
        timeout: 10000,
        headers: {
          'User-Agent': 'Koishi-MCID-Bot/1.0'
        }
      })

      if (response.data.success && response.data.data && response.data.data.user) {
        const user = response.data.data.user
        this.logger.debug(`B站UID ${buid} 验证成功: ${user.username}`)
        return user
      } else {
        this.logger.warn(`B站UID ${buid} 不存在或API返回失败: ${response.data.message}`)
        return null
      }
    } catch (error) {
      if (error.response?.status === 404) {
        this.logger.warn(`B站UID ${buid} 不存在`)
        return null
      }
      
      this.logger.error(`验证B站UID ${buid} 时出错: ${error.message}`)
      throw new Error(`无法验证B站UID: ${error.message}`)
    }
  }

  // 创建或更新B站账号绑定 - 从原代码提取
  async createOrUpdateBuidBind(userId: string, buidUser: ZminfoUser, databaseService: any): Promise<boolean> {
    try {
      const normalizedQQId = databaseService.normalizeQQId(userId)
      if (!normalizedQQId) {
        this.logger.error(`创建/更新绑定失败: 无法提取有效的QQ号`)
        return false
      }
      
      // 查询是否已存在绑定记录
      let bind = await databaseService.getMcBindByQQId(normalizedQQId)
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
        await databaseService.ctx.database.set('mcidbind', { qqId: normalizedQQId }, updateData)
        this.logger.info(`更新绑定: QQ=${normalizedQQId}, B站UID=${buidUser.uid}, 用户名=${buidUser.username}`)
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
        await databaseService.ctx.database.create('mcidbind', newBind)
        this.logger.info(`创建绑定(跳过MC): QQ=${normalizedQQId}, B站UID=${buidUser.uid}, 用户名=${buidUser.username}, 临时MC用户名=${tempMcUsername}`)
      }
      return true
    } catch (error) {
      this.logger.error(`创建/更新B站账号绑定失败: ${error.message}`)
      return false
    }
  }

  // 仅更新B站信息，不更新绑定时间（用于查询时刷新数据） - 从原代码提取
  async updateBuidInfoOnly(userId: string, buidUser: ZminfoUser, databaseService: any): Promise<boolean> {
    try {
      const normalizedQQId = databaseService.normalizeQQId(userId)
      if (!normalizedQQId) {
        this.logger.error(`更新失败: 无法提取有效的QQ号`)
        return false
      }
      
      // 查询是否已存在绑定记录
      const bind = await databaseService.getMcBindByQQId(normalizedQQId)
      if (!bind) {
        this.logger.warn(`QQ(${normalizedQQId})没有绑定记录，无法更新B站信息`)
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
      
      await databaseService.ctx.database.set('mcidbind', { qqId: normalizedQQId }, updateData)
      this.logger.info(`刷新信息: QQ=${normalizedQQId}, B站UID=${bind.buidUid}, 用户名=${buidUser.username}`)
      return true
    } catch (error) {
      this.logger.error(`更新B站账号信息失败: ${error.message}`)
      return false
    }
  }

  // 获取B站头像URL
  getBilibiliAvatarUrl(uid: string, size: number = 160): string {
    return `https://workers.vrp.moe/bilibili/avatar/${uid}?size=${size}`
  }

  // 格式化B站用户信息显示
  formatBuidUserInfo(bind: MCIDBIND, detailed: boolean = false): string {
    if (!bind.buidUid || !bind.buidUsername) {
      return '未绑定B站账号'
    }

    let info = `B站UID: ${bind.buidUid}\n用户名: ${bind.buidUsername}`
    
    if (detailed) {
      if (bind.guardLevel > 0) {
        info += `\n舰长等级: ${bind.guardLevelText} (${bind.guardLevel})`
        // 只有当历史最高等级比当前等级更高时才显示（数值越小等级越高）
        if (bind.maxGuardLevel > 0 && bind.maxGuardLevel < bind.guardLevel) {
          info += `\n历史最高: ${bind.maxGuardLevelText} (${bind.maxGuardLevel})`
        }
      } else if (bind.maxGuardLevel > 0) {
        // 当前无舰长但有历史记录，显示历史最高
        info += `\n历史舰长: ${bind.maxGuardLevelText} (${bind.maxGuardLevel})`
      }
      
      if (bind.medalName) {
        info += `\n粉丝牌: ${bind.medalName} Lv.${bind.medalLevel}`
      }
      
      if (bind.wealthMedalLevel > 0) {
        info += `\n荣耀等级: ${bind.wealthMedalLevel}`
      }
      
      if (bind.lastActiveTime) {
        info += `\n最后活跃: ${new Date(bind.lastActiveTime).toLocaleString('zh-CN', { 
          timeZone: 'Asia/Shanghai',
          year: 'numeric',
          month: '2-digit', 
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        })}`
      }
    } else {
      // 简化信息
      if (bind.guardLevel > 0) {
        info += `\n舰长等级: ${bind.guardLevelText}`
      }
      if (bind.medalName) {
        info += `\n粉丝牌: ${bind.medalName} Lv.${bind.medalLevel}`
      }
    }
    
    return info
  }

  // 批量验证B站UID - 新增方法，用于批量操作
  async validateBUIDs(buids: string[]): Promise<Map<string, ZminfoUser | null>> {
    const results = new Map<string, ZminfoUser | null>();
    
    this.logger.info(`开始批量验证${buids.length}个B站UID`);
    
    for (const buid of buids) {
      try {
        const user = await this.validateBUID(buid);
        results.set(buid, user);
        
        // 添加适当的延迟，避免API限制
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        this.logger.error(`批量验证B站UID"${buid}"失败: ${error.message}`);
        results.set(buid, null);
      }
    }
    
    this.logger.info(`批量验证完成，成功验证${Array.from(results.values()).filter(Boolean).length}个B站UID`);
    return results;
  }

  // 检查API连接状态
  async checkApiStatus(): Promise<boolean> {
    const testUid = '3461561' // 使用一个已知存在的UID进行测试
    
    this.logger.info('开始测试B站API连接状态')
    
    try {
      const startTime = Date.now()
      const response = await axios.get(`${this.config.zminfoApiUrl}/api/user/${testUid}`, {
        timeout: 10000,
        headers: {
          'User-Agent': 'Koishi-MCID-Bot/1.0'
        }
      })
      
      const responseTime = Date.now() - startTime
      
      if (response.data.success && response.data.data && response.data.data.user) {
        const user = response.data.data.user
        this.logger.info(`B站API连接正常 (${responseTime}ms)，测试用户: ${user.username}, UID: ${user.uid}`)
        return true
      } else {
        this.logger.warn(`B站API返回异常数据: ${JSON.stringify(response.data)}`)
        return false
      }
    } catch (error) {
      const errorMessage = axios.isAxiosError(error) 
        ? `${error.message}，错误代码: ${error.code || '未知'}，响应状态: ${error.response?.status || '未知'}`
        : error.message || '未知错误'
      this.logger.error(`B站API连接失败: ${errorMessage}`)
      return false
    }
  }

  // 解析UID格式，支持 "UID:12345" 和 "12345" 两种格式
  parseUidInput(input: string): string | null {
    if (!input) return null
    
    let actualUid = input.trim()
    
    // 移除 "UID:" 前缀（不区分大小写）
    if (actualUid.toLowerCase().startsWith('uid:')) {
      actualUid = actualUid.substring(4)
    }
    
    // 验证是否为纯数字
    if (!/^\d+$/.test(actualUid)) {
      return null
    }
    
    return actualUid
  }

  // 验证UID格式
  isValidUid(uid: string): boolean {
    return uid && /^\d+$/.test(uid) && uid.length >= 1 && uid.length <= 15
  }

  // 更新用户的历史最高舰长等级
  updateMaxGuardLevel(currentGuardLevel: number, currentGuardLevelText: string, 
                     existingMaxLevel: number, existingMaxLevelText: string): {
    maxGuardLevel: number;
    maxGuardLevelText: string;
  } {
    // 舰长等级数值越小等级越高，0表示无舰长
    if (currentGuardLevel > 0 && (existingMaxLevel === 0 || currentGuardLevel < existingMaxLevel)) {
      return {
        maxGuardLevel: currentGuardLevel,
        maxGuardLevelText: currentGuardLevelText
      }
    }
    
    return {
      maxGuardLevel: existingMaxLevel,
      maxGuardLevelText: existingMaxLevelText
    }
  }

  // 获取用户守护/粉丝牌等级的显示文本
  getGuardLevelDisplay(guardLevel: number, guardLevelText: string): string {
    if (guardLevel <= 0) return '无'
    return `${guardLevelText} (${guardLevel})`
  }

  // 获取粉丝牌信息显示
  getMedalDisplay(medalName: string, medalLevel: number): string {
    if (!medalName) return '无'
    return `${medalName} Lv.${medalLevel || 0}`
  }

  // 处理天选开奖数据中的B站用户信息
  async processLotteryWinners(winners: Array<{ uid: number; username: string; medal_level: number }>, 
                             databaseService: any): Promise<{
    matchedUsers: Array<{qqId: string, mcUsername: string, buidUsername: string, uid: number, username: string}>;
    matchedCount: number;
    notBoundCount: number;
  }> {
    const matchedUsers: Array<{qqId: string, mcUsername: string, buidUsername: string, uid: number, username: string}> = []
    let matchedCount = 0
    let notBoundCount = 0
    
    for (const winner of winners) {
      try {
        // 根据B站UID查找绑定的QQ用户
        const bind = await databaseService.getBuidBindByBuid(winner.uid.toString())
        
        if (bind && bind.qqId) {
          matchedCount++
          matchedUsers.push({
            qqId: bind.qqId,
            mcUsername: bind.mcUsername || '未绑定MC',
            buidUsername: bind.buidUsername,
            uid: winner.uid,
            username: winner.username
          })
        } else {
          notBoundCount++
          this.logger.debug(`B站UID(${winner.uid})未绑定QQ账号`)
        }
      } catch (error) {
        this.logger.error(`处理中奖用户UID(${winner.uid})时出错: ${error.message}`)
        notBoundCount++
      }
    }
    
    return {
      matchedUsers,
      matchedCount,
      notBoundCount
    }
  }

  // 销毁服务
  async dispose(): Promise<void> {
    this.logger.info('BuidService 正在销毁')
    // B站服务通常不需要特殊的清理工作
  }
} 