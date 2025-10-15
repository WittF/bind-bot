import { Context } from 'koishi'
import { LoggerService } from '../utils/logger'
import type { MCIDBIND } from '../types'

/**
 * MCIDBIND 数据仓储类
 * 封装所有 MCIDBIND 表的数据库操作
 */
export class MCIDBINDRepository {
  private ctx: Context
  private logger: LoggerService

  constructor(ctx: Context, logger: LoggerService) {
    this.ctx = ctx
    this.logger = logger
  }

  /**
   * 根据 QQ 号查询绑定信息
   * @param qqId QQ号（已规范化）
   * @returns 绑定信息或 null
   */
  async findByQQId(qqId: string): Promise<MCIDBIND | null> {
    try {
      this.logger.debug('数据库', `查询QQ(${qqId})的绑定信息`)
      const binds = await this.ctx.database.get('mcidbind', { qqId })
      return binds.length > 0 ? binds[0] : null
    } catch (error) {
      this.logger.error('数据库', `查询QQ(${qqId})绑定信息失败: ${error.message}`)
      return null
    }
  }

  /**
   * 根据 MC 用户名查询绑定信息
   * @param mcUsername MC用户名
   * @returns 绑定信息或 null
   */
  async findByMCUsername(mcUsername: string): Promise<MCIDBIND | null> {
    try {
      this.logger.debug('数据库', `查询MC用户名(${mcUsername})的绑定信息`)
      const binds = await this.ctx.database.get('mcidbind', { mcUsername })
      return binds.length > 0 ? binds[0] : null
    } catch (error) {
      this.logger.error('数据库', `查询MC用户名(${mcUsername})绑定信息失败: ${error.message}`)
      return null
    }
  }

  /**
   * 根据 B站 UID 查询绑定信息
   * @param buidUid B站UID
   * @returns 绑定信息或 null
   */
  async findByBuidUid(buidUid: string): Promise<MCIDBIND | null> {
    try {
      this.logger.debug('数据库', `查询B站UID(${buidUid})的绑定信息`)
      const binds = await this.ctx.database.get('mcidbind', { buidUid })
      return binds.length > 0 ? binds[0] : null
    } catch (error) {
      this.logger.error('数据库', `查询B站UID(${buidUid})绑定信息失败: ${error.message}`)
      return null
    }
  }

  /**
   * 获取所有绑定记录
   * @param options 查询选项
   * @returns 绑定记录列表
   */
  async findAll(options?: { limit?: number }): Promise<MCIDBIND[]> {
    try {
      this.logger.debug('数据库', `获取所有绑定记录${options?.limit ? ` (limit: ${options.limit})` : ''}`)
      const records = await this.ctx.database.get('mcidbind', {}, options)
      return records
    } catch (error) {
      this.logger.error('数据库', `获取所有绑定记录失败: ${error.message}`)
      return []
    }
  }

  /**
   * 根据标签查询绑定记录
   * @param tag 标签名称
   * @returns 包含该标签的绑定记录列表
   */
  async findByTag(tag: string): Promise<MCIDBIND[]> {
    try {
      this.logger.debug('数据库', `查询包含标签"${tag}"的绑定记录`)
      const allRecords = await this.ctx.database.get('mcidbind', {})
      return allRecords.filter(record => record.tags && record.tags.includes(tag))
    } catch (error) {
      this.logger.error('数据库', `查询标签"${tag}"的绑定记录失败: ${error.message}`)
      return []
    }
  }

  /**
   * 创建新的绑定记录
   * @param data 绑定数据
   * @returns 创建的记录
   */
  async create(data: Partial<MCIDBIND> & { qqId: string }): Promise<MCIDBIND> {
    try {
      this.logger.debug('数据库', `创建QQ(${data.qqId})的绑定记录`)
      const created = await this.ctx.database.create('mcidbind', data as any)
      this.logger.info('数据库', `成功创建QQ(${data.qqId})的绑定记录`, true)
      return created
    } catch (error) {
      this.logger.error('数据库', `创建QQ(${data.qqId})绑定记录失败: ${error.message}`)
      throw error
    }
  }

  /**
   * 更新绑定记录（部分字段）
   * @param qqId QQ号
   * @param data 要更新的字段
   */
  async update(qqId: string, data: Partial<MCIDBIND>): Promise<void> {
    try {
      this.logger.debug('数据库', `更新QQ(${qqId})的绑定记录`)
      await this.ctx.database.set('mcidbind', { qqId }, data)
      this.logger.info('数据库', `成功更新QQ(${qqId})的绑定记录`, true)
    } catch (error) {
      this.logger.error('数据库', `更新QQ(${qqId})绑定记录失败: ${error.message}`)
      throw error
    }
  }

  /**
   * 删除绑定记录
   * @param qqId QQ号
   * @returns 删除的记录数
   */
  async delete(qqId: string): Promise<number> {
    try {
      this.logger.debug('数据库', `删除QQ(${qqId})的绑定记录`)
      const result = await this.ctx.database.remove('mcidbind', { qqId })
      this.logger.info('数据库', `成功删除QQ(${qqId})的绑定记录（删除${result.removed}条）`, true)
      return result.removed
    } catch (error) {
      this.logger.error('数据库', `删除QQ(${qqId})绑定记录失败: ${error.message}`)
      throw error
    }
  }

  /**
   * 删除所有绑定记录
   * @returns 删除的记录数
   */
  async deleteAll(): Promise<number> {
    try {
      this.logger.debug('数据库', `删除所有绑定记录`)
      const result = await this.ctx.database.remove('mcidbind', {})
      this.logger.info('数据库', `成功删除所有绑定记录（删除${result.removed}条）`, true)
      return result.removed
    } catch (error) {
      this.logger.error('数据库', `删除所有绑定记录失败: ${error.message}`)
      throw error
    }
  }

  /**
   * 批量创建绑定记录
   * @param records 绑定记录列表
   */
  async batchCreate(records: Array<Partial<MCIDBIND> & { qqId: string }>): Promise<void> {
    try {
      this.logger.debug('数据库', `批量创建${records.length}条绑定记录`)
      for (const record of records) {
        await this.ctx.database.create('mcidbind', record as any)
      }
      this.logger.info('数据库', `成功批量创建${records.length}条绑定记录`, true)
    } catch (error) {
      this.logger.error('数据库', `批量创建绑定记录失败: ${error.message}`)
      throw error
    }
  }

  /**
   * 为用户添加标签
   * @param qqId QQ号
   * @param tag 标签名称
   */
  async addTag(qqId: string, tag: string): Promise<void> {
    try {
      const bind = await this.findByQQId(qqId)
      if (!bind) {
        throw new Error(`QQ(${qqId})的绑定记录不存在`)
      }

      const tags = bind.tags || []
      if (!tags.includes(tag)) {
        tags.push(tag)
        await this.update(qqId, { tags })
        this.logger.info('数据库', `成功为QQ(${qqId})添加标签"${tag}"`, true)
      }
    } catch (error) {
      this.logger.error('数据库', `为QQ(${qqId})添加标签"${tag}"失败: ${error.message}`)
      throw error
    }
  }

  /**
   * 为用户移除标签
   * @param qqId QQ号
   * @param tag 标签名称
   */
  async removeTag(qqId: string, tag: string): Promise<void> {
    try {
      const bind = await this.findByQQId(qqId)
      if (!bind) {
        throw new Error(`QQ(${qqId})的绑定记录不存在`)
      }

      const tags = bind.tags || []
      const index = tags.indexOf(tag)
      if (index > -1) {
        tags.splice(index, 1)
        await this.update(qqId, { tags })
        this.logger.info('数据库', `成功为QQ(${qqId})移除标签"${tag}"`, true)
      }
    } catch (error) {
      this.logger.error('数据库', `为QQ(${qqId})移除标签"${tag}"失败: ${error.message}`)
      throw error
    }
  }

  /**
   * 为用户添加白名单服务器
   * @param qqId QQ号
   * @param serverId 服务器ID
   */
  async addWhitelist(qqId: string, serverId: string): Promise<void> {
    try {
      const bind = await this.findByQQId(qqId)
      if (!bind) {
        throw new Error(`QQ(${qqId})的绑定记录不存在`)
      }

      const whitelist = bind.whitelist || []
      if (!whitelist.includes(serverId)) {
        whitelist.push(serverId)
        await this.update(qqId, { whitelist })
        this.logger.info('数据库', `成功为QQ(${qqId})添加白名单服务器"${serverId}"`, true)
      }
    } catch (error) {
      this.logger.error('数据库', `为QQ(${qqId})添加白名单服务器"${serverId}"失败: ${error.message}`)
      throw error
    }
  }

  /**
   * 为用户移除白名单服务器
   * @param qqId QQ号
   * @param serverId 服务器ID
   */
  async removeWhitelist(qqId: string, serverId: string): Promise<void> {
    try {
      const bind = await this.findByQQId(qqId)
      if (!bind) {
        throw new Error(`QQ(${qqId})的绑定记录不存在`)
      }

      const whitelist = bind.whitelist || []
      const index = whitelist.indexOf(serverId)
      if (index > -1) {
        whitelist.splice(index, 1)
        await this.update(qqId, { whitelist })
        this.logger.info('数据库', `成功为QQ(${qqId})移除白名单服务器"${serverId}"`, true)
      }
    } catch (error) {
      this.logger.error('数据库', `为QQ(${qqId})移除白名单服务器"${serverId}"失败: ${error.message}`)
      throw error
    }
  }

  /**
   * 获取所有管理员
   * @returns 管理员列表
   */
  async findAllAdmins(): Promise<MCIDBIND[]> {
    try {
      this.logger.debug('数据库', `获取所有管理员`)
      const allRecords = await this.ctx.database.get('mcidbind', {})
      return allRecords.filter(record => record.isAdmin)
    } catch (error) {
      this.logger.error('数据库', `获取所有管理员失败: ${error.message}`)
      return []
    }
  }
}
