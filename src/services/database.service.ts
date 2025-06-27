// 数据库服务 - 从原 index.ts 提取所有数据库操作逻辑

import { Context, Logger } from 'koishi'
import { MCIDBIND, Config } from '../types'
import { QQ_ID_REGEX, QQ_ID_MIN_LENGTH, QQ_ID_MAX_LENGTH } from '../utils/constants'

export class DatabaseService {
  private logger: Logger

  constructor(
    private ctx: Context,
    private config: Config,
    logger: Logger
  ) {
    this.logger = logger.extend('DatabaseService')
  }

  // 初始化数据库表结构
  async initializeDatabase(): Promise<void> {
    try {
      // 扩展数据库表定义 - 从原代码提取
      this.ctx.model.extend('mcidbind', {
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

      this.logger.info('数据库表结构初始化完成')
    } catch (error) {
      this.logger.error(`数据库表结构初始化失败: ${error.message}`)
      throw error
    }
  }

  // 检查表结构是否包含旧字段 - 从原代码提取
  async checkTableStructure(): Promise<boolean> {
    try {
      // 尝试获取一条记录来检查字段
      const records = await this.ctx.database.get('mcidbind', {}, { limit: 1 })
      
      // 如果没有记录，不需要迁移
      if (!records || records.length === 0) return false
      
      // 检查记录中是否包含id或userId字段，或缺少whitelist字段
      const record = records[0]
      return 'id' in record || 'userId' in record || !('whitelist' in record)
    } catch (error) {
      this.logger.error(`检查表结构失败: ${error.message}`)
      return false
    }
  }

  // 添加缺失字段 - 从原代码提取
  async addMissingFields(): Promise<boolean> {
    try {
      // 获取所有记录
      const records = await this.ctx.database.get('mcidbind', {})
      
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
          await this.ctx.database.set('mcidbind', { qqId: record.qqId }, updateData)
          updatedCount++
        }
      }
      
      if (updatedCount > 0) {
        this.logger.info(`成功为${updatedCount}条记录添加缺失字段`)
      } else {
        this.logger.info(`所有记录都包含必要字段，无需更新`)
      }
      return true
    } catch (error) {
      this.logger.error(`添加缺失字段失败: ${error.message}`)
      return false
    }
  }

  // 重建MCIDBIND表 - 从原代码提取
  async rebuildMcidBindTable(): Promise<void> {
    try {
      // 备份现有数据
      const oldRecords = await this.ctx.database.get('mcidbind', {})
      this.logger.info(`成功备份${oldRecords.length}条记录`)
      
      // 创建数据备份（用于恢复）
      const backupData = JSON.parse(JSON.stringify(oldRecords))
      
      try {
        // 提取有效数据
        const validRecords = oldRecords.map(record => {
          // 确保qqId存在
          if (!record.qqId) {
            // 如果没有qqId但有userId，尝试从userId提取
            if ('userId' in record && record.userId) {
              record.qqId = this.normalizeQQId(String(record.userId))
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
        await this.ctx.database.remove('mcidbind', {})
        this.logger.info('成功删除旧表数据')
        
        // 重新创建记录
        let successCount = 0
        let errorCount = 0
        
        for (const record of validRecords) {
          try {
            await this.ctx.database.create('mcidbind', record)
            successCount++
          } catch (e) {
            errorCount++
            this.logger.warn(`重建记录失败 (QQ=${record.qqId}): ${e.message}`)
          }
        }
        
        this.logger.info(`成功重建了${successCount}条记录，失败${errorCount}条`)
      } catch (migrationError) {
        // 迁移过程出错，尝试恢复
        this.logger.error(`表重建过程失败，尝试恢复数据: ${migrationError.message}`)
        
        try {
          // 清空表以避免重复数据
          await this.ctx.database.remove('mcidbind', {})
          
          // 恢复原始数据
          for (const record of backupData) {
            await this.ctx.database.create('mcidbind', record)
          }
          
          this.logger.info(`成功恢复${backupData.length}条原始记录`)
        } catch (recoveryError) {
          this.logger.error(`数据恢复失败，可能导致数据丢失: ${recoveryError.message}`)
          throw new Error('数据迁移失败且无法恢复')
        }
        
        throw migrationError
      }
    } catch (error) {
      this.logger.error(`重建表失败: ${error.message}`)
      throw error
    }
  }

  // 处理用户ID，去除平台前缀，只保留QQ号 - 从原代码提取
  normalizeQQId(userId: string): string {
    // 处理空值情况
    if (!userId) {
      this.logger.warn(`收到空用户ID`)
      return ''
    }
    
    let extractedId = ''
    
    // 检查是否是手动输入的@符号（错误用法）
    if (userId.startsWith('@') && !userId.match(/<at\s+id="[^"]+"\s*\/>/)) {
      this.logger.warn(`检测到手动输入的@符号"${userId}"，应使用真正的@功能`)
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
    if (!QQ_ID_REGEX.test(extractedId)) {
      this.logger.warn(`提取的ID"${extractedId}"不是有效的QQ号(必须为纯数字)，来源: ${userId}`)
      return ''  // 返回空字符串表示无效
    }
    
    // 检查QQ号长度是否合理(QQ号通常为5-12位数字)
    if (extractedId.length < QQ_ID_MIN_LENGTH || extractedId.length > QQ_ID_MAX_LENGTH) {
      this.logger.warn(`QQ号"${extractedId}"长度异常(${extractedId.length}位)，有效范围为5-12位`)
      return ''
    }
    
    return extractedId
  }

  // 根据QQ号查询MCIDBIND表中的绑定信息 - 从原代码提取
  async getMcBindByQQId(qqId: string): Promise<MCIDBIND | null> {
    try {
      // 处理空值
      if (!qqId) {
        this.logger.warn(`尝试查询空QQ号`)
        return null
      }
      
      const normalizedQQId = this.normalizeQQId(qqId)
      // 查询MCIDBIND表中对应QQ号的绑定记录
      const binds = await this.ctx.database.get('mcidbind', { qqId: normalizedQQId })
      return binds.length > 0 ? binds[0] : null
    } catch (error) {
      this.logger.error(`根据QQ号查询绑定信息失败: ${error.message}`)
      return null
    }
  }

  // 根据MC用户名查询MCIDBIND表中的绑定信息 - 从原代码提取
  async getMcBindByUsername(mcUsername: string): Promise<MCIDBIND | null> {
    try {
      // 处理空值
      if (!mcUsername) {
        this.logger.warn(`尝试查询空MC用户名`)
        return null
      }
      
      // 查询MCIDBIND表中对应MC用户名的绑定记录
      const binds = await this.ctx.database.get('mcidbind', { mcUsername })
      return binds.length > 0 ? binds[0] : null
    } catch (error) {
      this.logger.error(`根据MC用户名(${mcUsername})查询绑定信息失败: ${error.message}`)
      return null
    }
  }

  // 根据B站UID查询绑定信息 - 从原代码提取
  async getBuidBindByBuid(buid: string): Promise<MCIDBIND | null> {
    try {
      if (!buid) {
        this.logger.warn(`尝试查询空B站UID`)
        return null
      }
      
      const binds = await this.ctx.database.get('mcidbind', { buidUid: buid })
      return binds.length > 0 ? binds[0] : null
    } catch (error) {
      this.logger.error(`根据B站UID(${buid})查询绑定信息失败: ${error.message}`)
      return null
    }
  }

  // 创建或更新MC绑定 - 从原代码提取
  async createOrUpdateMcBind(userId: string, mcUsername: string, mcUuid: string, isAdmin?: boolean): Promise<boolean> {
    try {
      // 验证输入参数
      if (!userId) {
        this.logger.error(`创建/更新绑定失败: 无效的用户ID`)
        return false
      }
      
      if (!mcUsername) {
        this.logger.error(`创建/更新绑定失败: 无效的MC用户名`)
        return false
      }
      
      const normalizedQQId = this.normalizeQQId(userId)
      if (!normalizedQQId) {
        this.logger.error(`创建/更新绑定失败: 无法提取有效的QQ号`)
        return false
      }
      
      // 查询是否已存在绑定记录
      let bind = await this.getMcBindByQQId(normalizedQQId)
      
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
        
        await this.ctx.database.set('mcidbind', { qqId: normalizedQQId }, updateData)
        this.logger.info(`更新绑定: QQ=${normalizedQQId}, MC用户名=${mcUsername}, UUID=${mcUuid}`)
        return true
      } else {
        // 创建新记录
        try {
          await this.ctx.database.create('mcidbind', {
            qqId: normalizedQQId,
            mcUsername,
            mcUuid,
            lastModified: new Date(),
            isAdmin: isAdmin || false
          })
          this.logger.info(`创建绑定: QQ=${normalizedQQId}, MC用户名=${mcUsername}, UUID=${mcUuid}`)
          return true
        } catch (createError) {
          this.logger.error(`创建绑定失败: MC用户名=${mcUsername}, 错误=${createError.message}`)
          return false
        }
      }
    } catch (error) {
      this.logger.error(`创建/更新绑定失败: MC用户名=${mcUsername}, 错误=${error.message}`)
      return false
    }
  }

  // 删除绑定信息 - 从原代码提取
  async deleteMcBind(userId: string): Promise<boolean> {
    try {
      // 验证输入参数
      if (!userId) {
        this.logger.error(`删除绑定失败: 无效的用户ID`)
        return false
      }
      
      const normalizedQQId = this.normalizeQQId(userId)
      if (!normalizedQQId) {
        this.logger.error(`删除绑定失败: 无法提取有效的QQ号`)
        return false
      }
      
      // 查询是否存在绑定记录
      const bind = await this.getMcBindByQQId(normalizedQQId)
      
      if (bind) {
        // 删除整个绑定记录，包括MC和B站账号
        const result = await this.ctx.database.remove('mcidbind', { qqId: normalizedQQId })
        
        // 检查是否真正删除成功
        if (result) {
          let logMessage = `删除绑定: QQ=${normalizedQQId}`
          if (bind.mcUsername) logMessage += `, MC用户名=${bind.mcUsername}`
          if (bind.buidUid) logMessage += `, B站UID=${bind.buidUid}(${bind.buidUsername})`
          this.logger.info(logMessage)
          return true
        } else {
          this.logger.warn(`删除绑定异常: QQ=${normalizedQQId}, 可能未实际删除`)
          return false
        }
      }
      
      this.logger.warn(`删除绑定失败: QQ=${normalizedQQId}不存在绑定记录`)
      return false
    } catch (error) {
      this.logger.error(`删除绑定失败: 错误=${error.message}`)
      return false
    }
  }

  // 检查MC用户名是否已被其他QQ号绑定 - 从原代码提取
  async checkUsernameExists(username: string, currentUserId?: string): Promise<boolean> {
    try {
      // 验证输入参数
      if (!username) {
        this.logger.warn(`尝试检查空MC用户名`)
        return false
      }
      
      // 跳过临时用户名的检查
      if (username.startsWith('_temp_')) {
        return false
      }
      
      // 查询新表中是否已有此用户名的绑定
      const bind = await this.getMcBindByUsername(username)
      
      // 如果没有绑定，返回false
      if (!bind) return false
      
      // 如果绑定的用户名是临时用户名，视为未绑定
      if (bind.mcUsername && bind.mcUsername.startsWith('_temp_')) {
        return false
      }
      
      // 如果提供了当前用户ID，需要排除当前用户
      if (currentUserId) {
        const normalizedCurrentId = this.normalizeQQId(currentUserId)
        // 如果绑定的用户就是当前用户，返回false，表示没有被其他用户绑定
        return normalizedCurrentId ? bind.qqId !== normalizedCurrentId : true
      }
      
      return true
    } catch (error) {
      this.logger.error(`检查用户名"${username}"是否已被绑定失败: ${error.message}`)
      return false
    }
  }

  // 检查B站UID是否已被绑定 - 从原代码提取
  async checkBuidExists(buid: string, currentUserId?: string): Promise<boolean> {
    try {
      const bind = await this.getBuidBindByBuid(buid)
      if (!bind) return false
      
      // 如果指定了当前用户ID，则排除当前用户的绑定
      if (currentUserId) {
        const normalizedCurrentId = this.normalizeQQId(currentUserId)
        return bind.qqId !== normalizedCurrentId
      }
      
      return true
    } catch (error) {
      this.logger.error(`检查B站UID(${buid})是否存在时出错: ${error.message}`)
      return false
    }
  }

  // 检查是否为管理员 - 从原代码提取
  async isAdmin(userId: string): Promise<boolean> {
    // 主人始终是管理员
    const normalizedMasterId = this.normalizeQQId(this.config.masterId)
    const normalizedQQId = this.normalizeQQId(userId)
    
    if (normalizedQQId === normalizedMasterId) return true
    
    // 查询MCIDBIND表中是否是管理员
    try {
      const bind = await this.getMcBindByQQId(normalizedQQId)
      return bind && bind.isAdmin === true
    } catch (error) {
      this.logger.error(`QQ(${normalizedQQId})的管理员状态查询失败: ${error.message}`)
      return false
    }
  }

  // 检查是否为主人 - 从原代码提取
  isMaster(qqId: string): boolean {
    const normalizedMasterId = this.normalizeQQId(this.config.masterId)
    const normalizedQQId = this.normalizeQQId(qqId)
    return normalizedQQId === normalizedMasterId
  }

  // 获取所有管理员列表
  async getAllAdmins(): Promise<MCIDBIND[]> {
    try {
      return await this.ctx.database.get('mcidbind', { isAdmin: true })
    } catch (error) {
      this.logger.error(`获取管理员列表失败: ${error.message}`)
      return []
    }
  }

  // 获取统计信息
  async getStats(): Promise<{ total: number; mcBound: number; buidBound: number; bothBound: number }> {
    try {
      const allBinds = await this.ctx.database.get('mcidbind', {})
      
      let mcBound = 0
      let buidBound = 0
      let bothBound = 0
      
      for (const bind of allBinds) {
        const hasMc = bind.mcUsername && !bind.mcUsername.startsWith('_temp_')
        const hasBuid = bind.buidUid && bind.buidUid.trim() !== ''
        
        if (hasMc) mcBound++
        if (hasBuid) buidBound++
        if (hasMc && hasBuid) bothBound++
      }
      
      return {
        total: allBinds.length,
        mcBound,
        buidBound, 
        bothBound
      }
    } catch (error) {
      this.logger.error(`获取统计信息失败: ${error.message}`)
      return { total: 0, mcBound: 0, buidBound: 0, bothBound: 0 }
    }
  }

  // 销毁服务
  async dispose(): Promise<void> {
    this.logger.info('DatabaseService 正在销毁')
    // 数据库服务通常不需要特殊的清理工作
  }
} 