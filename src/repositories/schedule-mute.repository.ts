import { Context } from 'koishi'
import { LoggerService } from '../utils/logger'
import type { SCHEDULE_MUTE_TASKS } from '../types'

/**
 * 定时禁言任务数据仓储类
 * 封装所有 SCHEDULE_MUTE_TASKS 表的数据库操作
 */
export class ScheduleMuteRepository {
  private ctx: Context
  private logger: LoggerService

  constructor(ctx: Context, logger: LoggerService) {
    this.ctx = ctx
    this.logger = logger
  }

  /**
   * 根据 ID 查询定时禁言任务
   * @param id 任务ID
   * @returns 任务信息或 null
   */
  async findById(id: number): Promise<SCHEDULE_MUTE_TASKS | null> {
    try {
      this.logger.debug('数据库', `查询定时禁言任务ID(${id})`)
      const tasks = await this.ctx.database.get('schedule_mute_tasks', { id })
      return tasks.length > 0 ? tasks[0] : null
    } catch (error) {
      this.logger.error('数据库', `查询定时禁言任务ID(${id})失败: ${error.message}`)
      return null
    }
  }

  /**
   * 根据群组 ID 查询定时禁言任务
   * @param groupId 群组ID
   * @returns 任务列表
   */
  async findByGroupId(groupId: string): Promise<SCHEDULE_MUTE_TASKS[]> {
    try {
      this.logger.debug('数据库', `查询群${groupId}的定时禁言任务`)
      const tasks = await this.ctx.database.get('schedule_mute_tasks', { groupId })
      return tasks
    } catch (error) {
      this.logger.error('数据库', `查询群${groupId}的定时禁言任务失败: ${error.message}`)
      return []
    }
  }

  /**
   * 获取所有定时禁言任务
   * @returns 任务列表
   */
  async findAll(): Promise<SCHEDULE_MUTE_TASKS[]> {
    try {
      this.logger.debug('数据库', '获取所有定时禁言任务')
      const tasks = await this.ctx.database.get('schedule_mute_tasks', {})
      return tasks
    } catch (error) {
      this.logger.error('数据库', `获取所有定时禁言任务失败: ${error.message}`)
      return []
    }
  }

  /**
   * 获取所有已启用的定时禁言任务
   * @returns 任务列表
   */
  async findAllEnabled(): Promise<SCHEDULE_MUTE_TASKS[]> {
    try {
      this.logger.debug('数据库', '获取所有已启用的定时禁言任务')
      const tasks = await this.ctx.database.get('schedule_mute_tasks', { enabled: true })
      return tasks
    } catch (error) {
      this.logger.error('数据库', `获取所有已启用的定时禁言任务失败: ${error.message}`)
      return []
    }
  }

  /**
   * 创建定时禁言任务
   * @param data 任务数据
   * @returns 创建的任务
   */
  async create(data: Omit<SCHEDULE_MUTE_TASKS, 'id'>): Promise<SCHEDULE_MUTE_TASKS> {
    try {
      this.logger.debug('数据库', `创建群${data.groupId}的定时禁言任务`)
      const created = await this.ctx.database.create('schedule_mute_tasks', data as any)
      this.logger.info(
        '数据库',
        `成功创建群${data.groupId}的定时禁言任务（ID:${created.id}）`,
        true
      )
      return created
    } catch (error) {
      this.logger.error('数据库', `创建群${data.groupId}的定时禁言任务失败: ${error.message}`)
      throw error
    }
  }

  /**
   * 更新定时禁言任务
   * @param id 任务ID
   * @param data 要更新的字段
   */
  async update(id: number, data: Partial<Omit<SCHEDULE_MUTE_TASKS, 'id'>>): Promise<void> {
    try {
      this.logger.debug('数据库', `更新定时禁言任务ID(${id})`)
      await this.ctx.database.set('schedule_mute_tasks', { id }, data)
      this.logger.info('数据库', `成功更新定时禁言任务ID(${id})`, true)
    } catch (error) {
      this.logger.error('数据库', `更新定时禁言任务ID(${id})失败: ${error.message}`)
      throw error
    }
  }

  /**
   * 删除定时禁言任务
   * @param id 任务ID
   * @returns 删除的记录数
   */
  async delete(id: number): Promise<number> {
    try {
      this.logger.debug('数据库', `删除定时禁言任务ID(${id})`)
      const result = await this.ctx.database.remove('schedule_mute_tasks', { id })
      this.logger.info('数据库', `成功删除定时禁言任务ID(${id})（删除${result.removed}条）`, true)
      return result.removed
    } catch (error) {
      this.logger.error('数据库', `删除定时禁言任务ID(${id})失败: ${error.message}`)
      throw error
    }
  }

  /**
   * 启用定时禁言任务
   * @param id 任务ID
   */
  async enable(id: number): Promise<void> {
    try {
      this.logger.debug('数据库', `启用定时禁言任务ID(${id})`)
      await this.ctx.database.set('schedule_mute_tasks', { id }, { enabled: true })
      this.logger.info('数据库', `成功启用定时禁言任务ID(${id})`, true)
    } catch (error) {
      this.logger.error('数据库', `启用定时禁言任务ID(${id})失败: ${error.message}`)
      throw error
    }
  }

  /**
   * 禁用定时禁言任务
   * @param id 任务ID
   */
  async disable(id: number): Promise<void> {
    try {
      this.logger.debug('数据库', `禁用定时禁言任务ID(${id})`)
      await this.ctx.database.set('schedule_mute_tasks', { id }, { enabled: false })
      this.logger.info('数据库', `成功禁用定时禁言任务ID(${id})`, true)
    } catch (error) {
      this.logger.error('数据库', `禁用定时禁言任务ID(${id})失败: ${error.message}`)
      throw error
    }
  }

  /**
   * 删除群组的所有定时禁言任务
   * @param groupId 群组ID
   * @returns 删除的记录数
   */
  async deleteByGroupId(groupId: string): Promise<number> {
    try {
      this.logger.debug('数据库', `删除群${groupId}的所有定时禁言任务`)
      const result = await this.ctx.database.remove('schedule_mute_tasks', { groupId })
      this.logger.info(
        '数据库',
        `成功删除群${groupId}的所有定时禁言任务（删除${result.removed}条）`,
        true
      )
      return result.removed
    } catch (error) {
      this.logger.error('数据库', `删除群${groupId}的所有定时禁言任务失败: ${error.message}`)
      throw error
    }
  }
}
