import { Session, h } from 'koishi'
import { BaseHandler } from './base.handler'
import { BindStatus } from '../utils/bind-status'

export class TagHandler extends BaseHandler {
  register(): void {
    const cmd = this.ctx.command('mcid', 'Minecraft账号和B站账号绑定管理')
    const tagCmd = cmd.subcommand('.tag', '[管理员]用户标签管理')
    tagCmd
      .subcommand('.add <tagName:string> [...targets:string]', '为用户添加标签')
      .action(async ({ session }, tagName, ...targets) =>
        this.handleTagAdd(session, tagName, ...targets)
      )
    tagCmd
      .subcommand('.remove <tagName:string> [...targets:string]', '移除用户标签')
      .action(async ({ session }, tagName, ...targets) =>
        this.handleTagRemove(session, tagName, ...targets)
      )
    tagCmd
      .subcommand('.list [target:string]', '查看用户的所有标签')
      .action(async ({ session }, target) => this.handleTagList(session, target))
    tagCmd
      .subcommand('.find <tagName:string>', '查找有特定标签的所有用户')
      .action(async ({ session }, tagName) => this.handleTagFind(session, tagName))
    tagCmd
      .subcommand('.rename <oldTagName:string> <newTagName:string>', '[管理员]重命名标签')
      .action(async ({ session }, oldTagName, newTagName) =>
        this.handleTagRename(session, oldTagName, newTagName)
      )
    tagCmd
      .subcommand('.deleteall <tagName:string>', '[主人]删除所有用户的某个标签')
      .action(async ({ session }, tagName) => this.handleTagDeleteAll(session, tagName))
  }

  private async isAdmin(userId: string): Promise<boolean> {
    const normalizedUserId = this.deps.normalizeQQId(userId)
    const normalizedMasterId = this.deps.normalizeQQId(this.config.masterId)
    if (normalizedUserId === normalizedMasterId) return true
    try {
      const bind = await this.deps.databaseService.getMcBindByQQId(normalizedUserId)
      return bind && bind.isAdmin === true
    } catch (error) {
      this.logger.error('权限检查', `QQ(${normalizedUserId})的管理员状态查询失败`, error)
      return false
    }
  }

  private isMaster(userId: string): boolean {
    const normalizedUserId = this.deps.normalizeQQId(userId)
    const normalizedMasterId = this.deps.normalizeQQId(this.config.masterId)
    return normalizedUserId === normalizedMasterId
  }

  private getFriendlyErrorMessage(error: Error | string): string {
    return error instanceof Error ? error.message : error
  }

  private validateTagName(tagName: string): boolean {
    return /^[\u4e00-\u9fa5a-zA-Z0-9_-]+$/.test(tagName)
  }

  private async handleTagAdd(
    session: Session,
    tagName: string,
    ...targets: string[]
  ): Promise<any> {
    try {
      const normalizedUserId = this.deps.normalizeQQId(session.userId)
      if (!(await this.isAdmin(session.userId))) {
        this.logger.warn('标签', `权限不足: QQ(${normalizedUserId})不是管理员`)
        return this.deps.sendMessage(session, [h.text('只有管理员才能管理用户标签')])
      }
      if (!tagName) {
        this.logger.warn('标签', `QQ(${normalizedUserId})未提供标签名称`)
        return this.deps.sendMessage(session, [h.text('请提供标签名称')])
      }
      if (!this.validateTagName(tagName)) {
        this.logger.warn('标签', `QQ(${normalizedUserId})提供的标签名称"${tagName}"格式无效`)
        return this.deps.sendMessage(session, [
          h.text('标签名称只能包含中文、字母、数字、下划线和连字符')
        ])
      }
      if (!targets || targets.length === 0) {
        this.logger.warn('标签', `QQ(${normalizedUserId})未指定目标用户`)
        return this.deps.sendMessage(session, [h.text('请使用@指定要添加标签的用户')])
      }
      if (targets.length === 1) {
        const target = targets[0]
        const normalizedTargetId = this.deps.normalizeQQId(target)
        this.logger.info(
          '标签',
          `管理员QQ(${normalizedUserId})尝试为QQ(${normalizedTargetId})添加标签"${tagName}"`,
          true
        )
        let targetBind = await this.deps.databaseService.getMcBindByQQId(normalizedTargetId)
        if (!targetBind) {
          await this.repos.mcidbind.create({
            qqId: normalizedTargetId,
            mcUsername: null,
            mcUuid: null,
            lastModified: new Date(),
            isAdmin: false,
            whitelist: [],
            tags: [],
            hasMcBind: false,
            hasBuidBind: false
          })
          targetBind = await this.deps.databaseService.getMcBindByQQId(normalizedTargetId)
        }
        if (targetBind.tags && targetBind.tags.includes(tagName)) {
          this.logger.warn('标签', `QQ(${normalizedTargetId})已有标签"${tagName}"`)
          return this.deps.sendMessage(session, [
            h.text(`用户 ${normalizedTargetId} 已有标签"${tagName}"`)
          ])
        }
        const newTags = [...(targetBind.tags || []), tagName]
        await this.repos.mcidbind.update(normalizedTargetId, { tags: newTags })
        this.logger.info(
          '标签',
          `成功: 管理员QQ(${normalizedUserId})为QQ(${normalizedTargetId})添加了标签"${tagName}"`,
          true
        )
        return this.deps.sendMessage(session, [
          h.text(`已成功为用户 ${normalizedTargetId} 添加标签"${tagName}"`)
        ])
      }
      this.logger.info(
        '标签',
        `管理员QQ(${normalizedUserId})尝试批量为${targets.length}个用户添加标签"${tagName}"`,
        true
      )
      await this.deps.sendMessage(session, [
        h.text(`开始为${targets.length}个用户添加标签"${tagName}"，请稍候...`)
      ])
      let successCount = 0,
        failCount = 0,
        skipCount = 0
      const results: string[] = []
      for (let i = 0; i < targets.length; i++) {
        const target = targets[i]
        const normalizedTargetId = this.deps.normalizeQQId(target)
        try {
          let targetBind = await this.deps.databaseService.getMcBindByQQId(normalizedTargetId)
          if (!targetBind) {
            await this.repos.mcidbind.create({
              qqId: normalizedTargetId,
              mcUsername: null,
              mcUuid: null,
              lastModified: new Date(),
              isAdmin: false,
              whitelist: [],
              tags: [],
              hasMcBind: false,
              hasBuidBind: false
            })
            targetBind = await this.deps.databaseService.getMcBindByQQId(normalizedTargetId)
          }
          if (targetBind.tags && targetBind.tags.includes(tagName)) {
            skipCount++
            results.push(`⏭️ ${normalizedTargetId}: 已有该标签`)
            this.logger.warn('标签', `QQ(${normalizedTargetId})已有标签"${tagName}"`)
            continue
          }
          const newTags = [...(targetBind.tags || []), tagName]
          await this.repos.mcidbind.update(normalizedTargetId, { tags: newTags })
          successCount++
          results.push(`✅ ${normalizedTargetId}: 添加成功`)
          this.logger.info(
            '标签',
            `成功: 管理员QQ(${normalizedUserId})为QQ(${normalizedTargetId})添加了标签"${tagName}"`,
            true
          )
          if (i < targets.length - 1) await new Promise(resolve => setTimeout(resolve, 100))
        } catch (error) {
          failCount++
          results.push(`❌ ${normalizedTargetId}: 处理出错`)
          this.logger.error('标签', `处理用户QQ(${normalizedTargetId})时出错: ${error.message}`)
        }
      }
      let resultMessage = `批量添加标签"${tagName}"完成\n共处理${targets.length}个用户\n✅ 成功: ${successCount} 个\n❌ 失败: ${failCount} 个\n⏭️ 跳过: ${skipCount} 个`
      if (targets.length <= 10) resultMessage += '\n\n详细结果:\n' + results.join('\n')
      this.logger.info(
        '标签',
        `批量操作完成: 管理员QQ(${normalizedUserId})为${targets.length}个用户添加标签"${tagName}"，成功: ${successCount}，失败: ${failCount}，跳过: ${skipCount}`,
        true
      )
      return this.deps.sendMessage(session, [h.text(resultMessage)])
    } catch (error) {
      const normalizedUserId = this.deps.normalizeQQId(session.userId)
      this.logger.error('标签', `QQ(${normalizedUserId})添加标签失败: ${error.message}`)
      return this.deps.sendMessage(session, [h.text(this.getFriendlyErrorMessage(error))])
    }
  }

  private async handleTagRemove(
    session: Session,
    tagName: string,
    ...targets: string[]
  ): Promise<any> {
    try {
      const normalizedUserId = this.deps.normalizeQQId(session.userId)
      if (!(await this.isAdmin(session.userId))) {
        this.logger.warn('标签', `权限不足: QQ(${normalizedUserId})不是管理员`)
        return this.deps.sendMessage(session, [h.text('只有管理员才能管理用户标签')])
      }
      if (!tagName) {
        this.logger.warn('标签', `QQ(${normalizedUserId})未提供标签名称`)
        return this.deps.sendMessage(session, [h.text('请提供标签名称')])
      }
      if (!targets || targets.length === 0) {
        this.logger.warn('标签', `QQ(${normalizedUserId})未指定目标用户`)
        return this.deps.sendMessage(session, [h.text('请使用@指定要移除标签的用户')])
      }
      if (targets.length === 1) {
        const target = targets[0]
        const normalizedTargetId = this.deps.normalizeQQId(target)
        this.logger.info(
          '标签',
          `管理员QQ(${normalizedUserId})尝试为QQ(${normalizedTargetId})移除标签"${tagName}"`,
          true
        )
        const targetBind = await this.deps.databaseService.getMcBindByQQId(normalizedTargetId)
        if (!targetBind) {
          this.logger.warn('标签', `QQ(${normalizedTargetId})无记录`)
          return this.deps.sendMessage(session, [h.text(`用户 ${normalizedTargetId} 无记录`)])
        }
        if (!targetBind.tags || !targetBind.tags.includes(tagName)) {
          this.logger.warn('标签', `QQ(${normalizedTargetId})没有标签"${tagName}"`)
          return this.deps.sendMessage(session, [
            h.text(`用户 ${normalizedTargetId} 没有标签"${tagName}"`)
          ])
        }
        const newTags = targetBind.tags.filter(tag => tag !== tagName)
        await this.repos.mcidbind.update(normalizedTargetId, { tags: newTags })
        this.logger.info(
          '标签',
          `成功: 管理员QQ(${normalizedUserId})为QQ(${normalizedTargetId})移除了标签"${tagName}"`,
          true
        )
        return this.deps.sendMessage(session, [
          h.text(`已成功为用户 ${normalizedTargetId} 移除标签"${tagName}"`)
        ])
      }
      this.logger.info(
        '标签',
        `管理员QQ(${normalizedUserId})尝试批量为${targets.length}个用户移除标签"${tagName}"`,
        true
      )
      await this.deps.sendMessage(session, [
        h.text(`开始为${targets.length}个用户移除标签"${tagName}"，请稍候...`)
      ])
      let successCount = 0,
        failCount = 0,
        skipCount = 0
      const results: string[] = []
      for (let i = 0; i < targets.length; i++) {
        const target = targets[i]
        const normalizedTargetId = this.deps.normalizeQQId(target)
        try {
          const targetBind = await this.deps.databaseService.getMcBindByQQId(normalizedTargetId)
          if (!targetBind) {
            failCount++
            results.push(`❌ ${normalizedTargetId}: 无记录`)
            this.logger.warn('标签', `QQ(${normalizedTargetId})无记录`)
            continue
          }
          if (!targetBind.tags || !targetBind.tags.includes(tagName)) {
            skipCount++
            results.push(`⏭️ ${normalizedTargetId}: 没有该标签`)
            this.logger.warn('标签', `QQ(${normalizedTargetId})没有标签"${tagName}"`)
            continue
          }
          const newTags = targetBind.tags.filter(tag => tag !== tagName)
          await this.repos.mcidbind.update(normalizedTargetId, { tags: newTags })
          successCount++
          results.push(`✅ ${normalizedTargetId}: 移除成功`)
          this.logger.info(
            '标签',
            `成功: 管理员QQ(${normalizedUserId})为QQ(${normalizedTargetId})移除了标签"${tagName}"`,
            true
          )
          if (i < targets.length - 1) await new Promise(resolve => setTimeout(resolve, 100))
        } catch (error) {
          failCount++
          results.push(`❌ ${normalizedTargetId}: 处理出错`)
          this.logger.error('标签', `处理用户QQ(${normalizedTargetId})时出错: ${error.message}`)
        }
      }
      let resultMessage = `批量移除标签"${tagName}"完成\n共处理${targets.length}个用户\n✅ 成功: ${successCount} 个\n❌ 失败: ${failCount} 个\n⏭️ 跳过: ${skipCount} 个`
      if (targets.length <= 10) resultMessage += '\n\n详细结果:\n' + results.join('\n')
      this.logger.info(
        '标签',
        `批量操作完成: 管理员QQ(${normalizedUserId})为${targets.length}个用户移除标签"${tagName}"，成功: ${successCount}，失败: ${failCount}，跳过: ${skipCount}`,
        true
      )
      return this.deps.sendMessage(session, [h.text(resultMessage)])
    } catch (error) {
      const normalizedUserId = this.deps.normalizeQQId(session.userId)
      this.logger.error('标签', `QQ(${normalizedUserId})移除标签失败: ${error.message}`)
      return this.deps.sendMessage(session, [h.text(this.getFriendlyErrorMessage(error))])
    }
  }

  private async handleTagList(session: Session, target?: string): Promise<any> {
    try {
      const normalizedUserId = this.deps.normalizeQQId(session.userId)
      if (!(await this.isAdmin(session.userId))) {
        this.logger.warn('标签', `权限不足: QQ(${normalizedUserId})不是管理员`)
        return this.deps.sendMessage(session, [h.text('只有管理员才能查看用户标签')])
      }
      if (target) {
        const normalizedTargetId = this.deps.normalizeQQId(target)
        this.logger.info(
          '标签',
          `管理员QQ(${normalizedUserId})查看QQ(${normalizedTargetId})的标签`,
          true
        )
        const targetBind = await this.deps.databaseService.getMcBindByQQId(normalizedTargetId)
        if (!targetBind) {
          this.logger.info('标签', `QQ(${normalizedTargetId})无记录`)
          return this.deps.sendMessage(session, [h.text(`用户 ${normalizedTargetId} 无记录`)])
        }
        if (!targetBind.tags || targetBind.tags.length === 0) {
          this.logger.info('标签', `QQ(${normalizedTargetId})没有任何标签`)
          return this.deps.sendMessage(session, [h.text(`用户 ${normalizedTargetId} 没有任何标签`)])
        }
        const tagList = targetBind.tags.map(tag => `• ${tag}`).join('\n')
        return this.deps.sendMessage(session, [
          h.text(`用户 ${normalizedTargetId} 的标签:\n${tagList}`)
        ])
      }
      this.logger.info('标签', `管理员QQ(${normalizedUserId})查看所有标签统计`, true)
      const allBinds = await this.repos.mcidbind.findAll()
      const tagStats: Record<string, number> = {}
      for (const bind of allBinds) {
        if (bind.tags && bind.tags.length > 0) {
          for (const tag of bind.tags) {
            tagStats[tag] = (tagStats[tag] || 0) + 1
          }
        }
      }
      if (Object.keys(tagStats).length === 0) {
        return this.deps.sendMessage(session, [h.text('当前没有任何用户标签')])
      }
      const sortedTags = Object.entries(tagStats)
        .sort((a, b) => b[1] - a[1])
        .map(([tag, count]) => `• ${tag} (${count}人)`)
        .join('\n')
      return this.deps.sendMessage(session, [h.text(`所有标签统计:\n${sortedTags}`)])
    } catch (error) {
      const normalizedUserId = this.deps.normalizeQQId(session.userId)
      this.logger.error('标签', `QQ(${normalizedUserId})查看标签失败: ${error.message}`)
      return this.deps.sendMessage(session, [h.text(this.getFriendlyErrorMessage(error))])
    }
  }

  private async handleTagFind(session: Session, tagName: string): Promise<any> {
    try {
      const normalizedUserId = this.deps.normalizeQQId(session.userId)
      if (!(await this.isAdmin(session.userId))) {
        this.logger.warn('标签', `权限不足: QQ(${normalizedUserId})不是管理员`)
        return this.deps.sendMessage(session, [h.text('只有管理员才能查找标签')])
      }
      if (!tagName) {
        this.logger.warn('标签', `QQ(${normalizedUserId})未提供标签名称`)
        return this.deps.sendMessage(session, [h.text('请提供要查找的标签名称')])
      }
      this.logger.info('标签', `管理员QQ(${normalizedUserId})查找标签"${tagName}"的用户`, true)
      const allBinds = await this.repos.mcidbind.findAll()
      const usersWithTag = allBinds.filter(bind => bind.tags && bind.tags.includes(tagName))
      if (usersWithTag.length === 0) {
        this.logger.info('标签', `没有用户有标签"${tagName}"`)
        return this.deps.sendMessage(session, [h.text(`没有用户有标签"${tagName}"`)])
      }
      const userList = usersWithTag
        .map(bind => {
          const mcInfo = BindStatus.hasValidMcBind(bind)
            ? ` (MC: ${bind.mcUsername})`
            : ''
          return `• ${bind.qqId}${mcInfo}`
        })
        .join('\n')
      this.logger.info('标签', `找到${usersWithTag.length}个用户有标签"${tagName}"`, true)
      return this.deps.sendMessage(session, [
        h.text(`有标签"${tagName}"的用户 (共${usersWithTag.length}人):\n${userList}`)
      ])
    } catch (error) {
      const normalizedUserId = this.deps.normalizeQQId(session.userId)
      this.logger.error('标签', `QQ(${normalizedUserId})查找标签失败: ${error.message}`)
      return this.deps.sendMessage(session, [h.text(this.getFriendlyErrorMessage(error))])
    }
  }

  private async handleTagRename(
    session: Session,
    oldTagName: string,
    newTagName: string
  ): Promise<any> {
    try {
      const normalizedUserId = this.deps.normalizeQQId(session.userId)
      if (!(await this.isAdmin(session.userId))) {
        this.logger.warn('标签', `权限不足: QQ(${normalizedUserId})不是管理员`)
        return this.deps.sendMessage(session, [h.text('只有管理员才能重命名标签')])
      }
      if (!oldTagName || !newTagName) {
        this.logger.warn('标签', `QQ(${normalizedUserId})参数不完整`)
        return this.deps.sendMessage(session, [h.text('请提供旧标签名和新标签名')])
      }
      if (!this.validateTagName(newTagName)) {
        this.logger.warn('标签', `QQ(${normalizedUserId})提供的新标签名称"${newTagName}"格式无效`)
        return this.deps.sendMessage(session, [
          h.text('新标签名称只能包含中文、字母、数字、下划线和连字符')
        ])
      }
      const allBinds = await this.repos.mcidbind.findAll()
      const usersWithOldTag = allBinds.filter(bind => bind.tags && bind.tags.includes(oldTagName))
      if (usersWithOldTag.length === 0) {
        this.logger.info('标签', `标签"${oldTagName}"不存在，无需重命名`)
        return this.deps.sendMessage(session, [h.text(`标签"${oldTagName}"不存在`)])
      }
      const usersWithNewTag = allBinds.filter(bind => bind.tags && bind.tags.includes(newTagName))
      if (usersWithNewTag.length > 0) {
        this.logger.warn('标签', `新标签"${newTagName}"已存在，无法重命名`)
        return this.deps.sendMessage(session, [
          h.text(`新标签"${newTagName}"已存在，请选择其他名称`)
        ])
      }
      this.logger.info(
        '标签',
        `管理员QQ(${normalizedUserId})开始将标签"${oldTagName}"重命名为"${newTagName}"`,
        true
      )
      await this.deps.sendMessage(session, [
        h.text(
          `找到${usersWithOldTag.length}个用户有标签"${oldTagName}"，开始重命名为"${newTagName}"...`
        )
      ])
      let successCount = 0,
        failCount = 0
      for (const bind of usersWithOldTag) {
        try {
          const newTags = bind.tags.map(tag => (tag === oldTagName ? newTagName : tag))
          await this.repos.mcidbind.update(bind.qqId, { tags: newTags })
          successCount++
          this.logger.debug(
            '标签',
            `成功为用户QQ(${bind.qqId})将标签"${oldTagName}"重命名为"${newTagName}"`
          )
        } catch (error) {
          failCount++
          this.logger.error('标签', `为用户QQ(${bind.qqId})重命名标签失败: ${error.message}`)
        }
      }
      const resultMessage = `标签重命名完成\n"${oldTagName}" → "${newTagName}"\n共处理${usersWithOldTag.length}个用户\n✅ 成功: ${successCount} 个\n❌ 失败: ${failCount} 个`
      this.logger.info(
        '标签',
        `重命名完成: 管理员QQ(${normalizedUserId})将标签"${oldTagName}"重命名为"${newTagName}"，处理${usersWithOldTag.length}个用户，成功: ${successCount}，失败: ${failCount}`,
        true
      )
      return this.deps.sendMessage(session, [h.text(resultMessage)])
    } catch (error) {
      const normalizedUserId = this.deps.normalizeQQId(session.userId)
      this.logger.error('标签', `QQ(${normalizedUserId})重命名标签失败: ${error.message}`)
      return this.deps.sendMessage(session, [h.text(this.getFriendlyErrorMessage(error))])
    }
  }

  private async handleTagDeleteAll(session: Session, tagName: string): Promise<any> {
    try {
      const normalizedUserId = this.deps.normalizeQQId(session.userId)
      if (!this.isMaster(session.userId)) {
        this.logger.warn('标签', `权限不足: QQ(${normalizedUserId})不是主人`)
        return this.deps.sendMessage(session, [h.text('只有主人才能删除所有用户的标签')])
      }
      if (!tagName) {
        this.logger.warn('标签', `QQ(${normalizedUserId})未提供标签名称`)
        return this.deps.sendMessage(session, [h.text('请提供要删除的标签名称')])
      }
      this.logger.info(
        '标签',
        `主人QQ(${normalizedUserId})开始删除所有用户的标签"${tagName}"`,
        true
      )
      const allBinds = await this.repos.mcidbind.findAll()
      const usersWithTag = allBinds.filter(bind => bind.tags && bind.tags.includes(tagName))
      if (usersWithTag.length === 0) {
        this.logger.info('标签', `没有用户有标签"${tagName}"，无需删除`)
        return this.deps.sendMessage(session, [h.text(`没有用户有标签"${tagName}"，无需删除`)])
      }
      this.logger.info(
        '标签',
        `找到${usersWithTag.length}个用户有标签"${tagName}"，开始批量删除`,
        true
      )
      await this.deps.sendMessage(session, [
        h.text(`找到${usersWithTag.length}个用户有标签"${tagName}"，开始批量删除...`)
      ])
      let successCount = 0,
        failCount = 0
      for (const bind of usersWithTag) {
        try {
          const newTags = bind.tags.filter(tag => tag !== tagName)
          await this.repos.mcidbind.update(bind.qqId, { tags: newTags })
          successCount++
          this.logger.debug('标签', `成功从用户QQ(${bind.qqId})移除标签"${tagName}"`)
        } catch (error) {
          failCount++
          this.logger.error(
            '标签',
            `从用户QQ(${bind.qqId})移除标签"${tagName}"失败: ${error.message}`
          )
        }
      }
      const resultMessage = `批量删除标签"${tagName}"完成\n共处理${usersWithTag.length}个用户\n✅ 成功: ${successCount} 个\n❌ 失败: ${failCount} 个`
      this.logger.info(
        '标签',
        `批量删除完成: 主人QQ(${normalizedUserId})删除了${usersWithTag.length}个用户的标签"${tagName}"，成功: ${successCount}，失败: ${failCount}`,
        true
      )
      return this.deps.sendMessage(session, [h.text(resultMessage)])
    } catch (error) {
      const normalizedUserId = this.deps.normalizeQQId(session.userId)
      this.logger.error('标签', `QQ(${normalizedUserId})批量删除标签失败: ${error.message}`)
      return this.deps.sendMessage(session, [h.text(this.getFriendlyErrorMessage(error))])
    }
  }
}
