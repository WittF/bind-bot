import { Session, h } from 'koishi'
import { BaseHandler } from './base.handler'
import type { ServerConfig, MCIDBIND } from '../types'
import { calculateSimilarity } from '../utils/helpers'
import { BindStatus } from '../utils/bind-status'

/**
 * 白名单命令处理器
 * 处理所有 mcid.whitelist 子命令
 */
export class WhitelistHandler extends BaseHandler {
  /**
   * 注册白名单相关命令
   */
  register(): void {
    const cmd = this.ctx.command('mcid')
    const whitelistCmd = cmd.subcommand('.whitelist', '白名单管理')

    // 注册6个子命令
    this.registerServersCommand(whitelistCmd)
    this.registerAddCommand(whitelistCmd)
    this.registerRemoveCommand(whitelistCmd)
    this.registerResetCommand(whitelistCmd)
    this.registerResetAllCommand(whitelistCmd)
    this.registerAddAllCommand(whitelistCmd)
  }

  /**
   * 列出所有可用的服务器
   */
  private registerServersCommand(parent: any): void {
    parent
      .subcommand('.servers', '列出所有可用的服务器')
      .action(async ({ session }: { session: Session }) => {
        try {
          const normalizedUserId = this.deps.normalizeQQId(session.userId)
          this.logger.info('白名单', `QQ(${normalizedUserId})查询可用服务器列表`)

          // 获取启用的服务器
          const enabledServers =
            this.config.servers?.filter(server => server.enabled !== false) || []

          if (!enabledServers || enabledServers.length === 0) {
            this.logger.info('白名单', '未配置或启用任何服务器')
            return this.deps.sendMessage(session, [h.text('当前未配置或启用任何服务器')])
          }

          // 检查用户是否绑定了MC账号
          const userBind = await this.deps.databaseService.getMcBindByQQId(normalizedUserId)
          if (!userBind || !userBind.mcUsername) {
            this.logger.warn('白名单', `QQ(${normalizedUserId})未绑定MC账号，无法显示白名单状态`)
            return this.deps.sendMessage(session, [
              h.text(
                `您尚未绑定MC账号，请先使用 ${this.deps.formatCommand('mcid bind <用户名>')} 命令绑定账号，然后再查看服务器列表。`
              )
            ])
          }

          // 圈数字映射（1-20）
          const circledNumbers = [
            '①',
            '②',
            '③',
            '④',
            '⑤',
            '⑥',
            '⑦',
            '⑧',
            '⑨',
            '⑩',
            '⑪',
            '⑫',
            '⑬',
            '⑭',
            '⑮',
            '⑯',
            '⑰',
            '⑱',
            '⑲',
            '⑳'
          ]

          // 格式化服务器列表
          const serverList = enabledServers
            .map((server, index) => {
              // 获取此用户是否已加入该服务器的白名单
              const hasWhitelist = userBind ? this.isInServerWhitelist(userBind, server.id) : false

              // 使用圈数字作为序号
              const circledNumber =
                index < circledNumbers.length ? circledNumbers[index] : `${index + 1}.`

              // 构建服务器信息显示文本
              let serverInfo = `${circledNumber} ${server.name}`

              // 添加状态标记
              if (hasWhitelist) {
                serverInfo += ' [✓ 已加入]'
              } else {
                serverInfo += ' [未加入]'
              }

              // 添加服务器ID信息
              serverInfo += `\n   ID: ${server.id}`

              // 添加服务器状态信息
              serverInfo += '\n   状态: ' + (server.enabled === false ? '已停用' : '已启用')

              // 添加申请权限信息
              serverInfo +=
                '\n   权限: ' + (server.allowSelfApply ? '允许自助申请' : '仅管理员可操作')

              // 只有当设置了地址时才显示地址行
              if (server.displayAddress && server.displayAddress.trim()) {
                serverInfo += '\n   地址: ' + server.displayAddress
              }

              // 只有当设置了说明信息时才显示说明行
              if (server.description && server.description.trim()) {
                serverInfo += '\n   说明: ' + server.description
              }

              return serverInfo
            })
            .join('\n\n') // 使用双换行分隔不同服务器，增强可读性

          this.logger.info(
            '白名单',
            `成功: QQ(${normalizedUserId})获取了服务器列表，共${enabledServers.length}个服务器`
          )
          const displayUsername = BindStatus.hasValidMcBind(userBind)
            ? userBind.mcUsername
            : '未绑定MC账号'
          return this.deps.sendMessage(session, [
            h.text(
              `${displayUsername} 的可用服务器列表:\n\n${serverList}\n\n使用 ${this.deps.formatCommand('mcid whitelist add <服务器名称或ID>')} 申请白名单`
            )
          ])
        } catch (error) {
          const normalizedUserId = this.deps.normalizeQQId(session.userId)
          this.logger.error('白名单', `QQ(${normalizedUserId})查询服务器列表失败: ${error.message}`)
          return this.deps.sendMessage(session, [h.text(this.getFriendlyErrorMessage(error))])
        }
      })
  }

  /**
   * 添加白名单
   */
  private registerAddCommand(parent: any): void {
    parent
      .subcommand('.add <serverIdOrName:string> [...targets:string]', '申请/添加服务器白名单')
      .action(
        async ({ session }: { session: Session }, serverIdOrName: string, ...targets: string[]) => {
          try {
            const normalizedUserId = this.deps.normalizeQQId(session.userId)

            // 检查服务器名称或ID
            if (!serverIdOrName) {
              this.logger.warn('白名单', `QQ(${normalizedUserId})未提供服务器名称或ID`)
              return this.deps.sendMessage(session, [
                h.text('请提供服务器名称或ID\n使用 mcid whitelist servers 查看可用服务器列表')
              ])
            }

            // 获取服务器配置
            const server = this.getServerConfigByIdOrName(serverIdOrName)
            if (!server) {
              this.logger.warn(
                '白名单',
                `QQ(${normalizedUserId})提供的服务器名称或ID"${serverIdOrName}"无效`
              )
              return this.deps.sendMessage(session, [
                h.text(
                  `未找到名称或ID为"${serverIdOrName}"的服务器\n使用 mcid whitelist servers 查看可用服务器列表`
                )
              ])
            }

            // 如果有指定目标用户（批量操作或单个用户管理）
            if (targets && targets.length > 0) {
              // 检查权限
              if (!(await this.isAdmin(session.userId))) {
                this.logger.warn(
                  '白名单',
                  `权限不足: QQ(${normalizedUserId})不是管理员，无法为其他用户添加白名单`
                )
                return this.deps.sendMessage(session, [
                  h.text('只有管理员才能为其他用户添加白名单')
                ])
              }

              // 检查是否为标签（优先检查标签名，没有匹配标签再按QQ号处理）
              if (targets.length === 1) {
                const targetValue = targets[0]

                // 首先检查是否存在该标签名
                const allBinds = await this.repos.mcidbind.findAll()
                const usersWithTag = allBinds.filter(
                  bind => bind.tags && bind.tags.includes(targetValue) && BindStatus.hasValidMcBind(bind)
                )

                if (usersWithTag.length > 0) {
                  // 作为标签处理
                  const tagName = targetValue
                  this.logger.info(
                    '白名单',
                    `管理员QQ(${normalizedUserId})尝试为标签"${tagName}"的所有用户添加服务器"${server.name}"白名单`
                  )

                  // 转换为用户ID数组
                  targets = usersWithTag.map(bind => bind.qqId)
                  this.logger.info(
                    '白名单',
                    `找到${targets.length}个有标签"${tagName}"的已绑定用户`
                  )

                  await this.deps.sendMessage(session, [
                    h.text(
                      `找到${targets.length}个有标签"${tagName}"的已绑定用户，开始添加白名单...`
                    )
                  ])
                }
                // 如果没有找到标签，将继续按单个用户处理
              }

              // 单个用户的简洁处理逻辑
              if (targets.length === 1) {
                const target = targets[0]
                const normalizedTargetId = this.deps.normalizeQQId(target)
                this.logger.info(
                  '白名单',
                  `QQ(${normalizedUserId})尝试为QQ(${normalizedTargetId})添加服务器"${server.name}"白名单`
                )

                // 获取目标用户的绑定信息
                const targetBind =
                  await this.deps.databaseService.getMcBindByQQId(normalizedTargetId)
                if (!targetBind || !targetBind.mcUsername) {
                  this.logger.warn('白名单', `QQ(${normalizedTargetId})未绑定MC账号`)
                  return this.deps.sendMessage(session, [
                    h.text(`用户 ${normalizedTargetId} 尚未绑定MC账号，无法添加白名单`)
                  ])
                }

                // 检查是否已在白名单中
                if (this.isInServerWhitelist(targetBind, server.id)) {
                  this.logger.warn(
                    '白名单',
                    `QQ(${normalizedTargetId})已在服务器"${server.name}"的白名单中`
                  )
                  return this.deps.sendMessage(session, [
                    h.text(`用户 ${normalizedTargetId} 已在服务器"${server.name}"的白名单中`)
                  ])
                }

                // 执行添加白名单操作
                const result = await this.addServerWhitelist(targetBind, server)

                if (result) {
                  this.logger.info(
                    '白名单',
                    `成功: 管理员QQ(${normalizedUserId})为QQ(${normalizedTargetId})添加了服务器"${server.name}"的白名单`
                  )
                  return this.deps.sendMessage(session, [
                    h.text(`已成功为用户 ${normalizedTargetId} 添加服务器"${server.name}"的白名单`)
                  ])
                } else {
                  this.logger.error(
                    '白名单',
                    `管理员QQ(${normalizedUserId})为QQ(${normalizedTargetId})添加服务器"${server.name}"白名单失败`
                  )
                  return this.deps.sendMessage(session, [
                    h.text(
                      `为用户 ${normalizedTargetId} 添加服务器"${server.name}"白名单失败，请检查RCON连接和命令配置`
                    )
                  ])
                }
              }

              // 批量用户的详细处理逻辑
              this.logger.info(
                '白名单',
                `QQ(${normalizedUserId})尝试批量为${targets.length}个用户添加服务器"${server.name}"白名单`
              )

              // 发送开始处理的通知
              await this.deps.sendMessage(session, [
                h.text(`开始为${targets.length}个用户添加服务器"${server.name}"的白名单，请稍候...`)
              ])

              // 统计信息
              let successCount = 0
              let failCount = 0
              let skipCount = 0
              const results: string[] = []

              // 处理每个目标用户
              for (let i = 0; i < targets.length; i++) {
                const target = targets[i]
                const normalizedTargetId = this.deps.normalizeQQId(target)

                try {
                  // 获取目标用户的绑定信息
                  const targetBind =
                    await this.deps.databaseService.getMcBindByQQId(normalizedTargetId)
                  if (!targetBind || !targetBind.mcUsername) {
                    failCount++
                    results.push(`❌ ${normalizedTargetId}: 未绑定MC账号`)
                    this.logger.warn('白名单', `QQ(${normalizedTargetId})未绑定MC账号`)
                    continue
                  }

                  // 检查是否已在白名单中
                  if (this.isInServerWhitelist(targetBind, server.id)) {
                    skipCount++
                    results.push(`⏭️ ${normalizedTargetId}: 已在白名单中`)
                    this.logger.warn(
                      '白名单',
                      `QQ(${normalizedTargetId})已在服务器"${server.name}"的白名单中`
                    )
                    continue
                  }

                  // 执行添加白名单操作
                  const result = await this.addServerWhitelist(targetBind, server)

                  if (result) {
                    successCount++
                    results.push(`✅ ${normalizedTargetId}: 添加成功`)
                    this.logger.info(
                      '白名单',
                      `成功: 管理员QQ(${normalizedUserId})为QQ(${normalizedTargetId})添加了服务器"${server.name}"的白名单`
                    )
                  } else {
                    failCount++
                    results.push(`❌ ${normalizedTargetId}: 添加失败`)
                    this.logger.error(
                      '白名单',
                      `管理员QQ(${normalizedUserId})为QQ(${normalizedTargetId})添加服务器"${server.name}"白名单失败`
                    )
                  }

                  // 批量操作时添加适当延迟，避免过载
                  if (i < targets.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 500))
                  }

                  // 每处理5个用户发送一次进度更新（仅在批量操作时）
                  if (targets.length > 5 && (i + 1) % 5 === 0) {
                    const progress = Math.round(((i + 1) / targets.length) * 100)
                    await this.deps.sendMessage(session, [
                      h.text(
                        `批量添加白名单进度: ${progress}% (${i + 1}/${targets.length})\n成功: ${successCount} | 失败: ${failCount} | 跳过: ${skipCount}`
                      )
                    ])
                  }
                } catch (error) {
                  failCount++
                  results.push(`❌ ${normalizedTargetId}: 处理出错`)
                  this.logger.error(
                    '白名单',
                    `处理用户QQ(${normalizedTargetId})时出错: ${error.message}`
                  )
                }
              }

              // 生成结果报告
              let resultMessage = `批量添加服务器"${server.name}"白名单完成\n共处理${targets.length}个用户\n✅ 成功: ${successCount} 个\n❌ 失败: ${failCount} 个\n⏭️ 跳过: ${skipCount} 个`

              // 如果有详细结果且用户数量不太多，显示详细信息
              if (targets.length <= 10) {
                resultMessage += '\n\n详细结果:\n' + results.join('\n')
              }

              this.logger.info(
                '白名单',
                `批量操作完成: 管理员QQ(${normalizedUserId})为${targets.length}个用户添加服务器"${server.name}"白名单，成功: ${successCount}，失败: ${failCount}，跳过: ${skipCount}`
              )
              return this.deps.sendMessage(session, [h.text(resultMessage)])
            }

            // 为自己添加白名单（原有逻辑保持不变）
            this.logger.info(
              '白名单',
              `QQ(${normalizedUserId})尝试为自己添加服务器"${server.name}"白名单`
            )

            // 检查服务器是否允许自助申请
            if (!server.allowSelfApply && !(await this.isAdmin(session.userId))) {
              this.logger.warn(
                '白名单',
                `服务器"${server.name}"不允许自助申请，且QQ(${normalizedUserId})不是管理员`
              )
              return this.deps.sendMessage(session, [
                h.text(`服务器"${server.name}"不允许自助申请白名单，请联系管理员`)
              ])
            }

            // 获取自己的绑定信息
            const selfBind = await this.deps.databaseService.getMcBindByQQId(normalizedUserId)
            if (!selfBind || !selfBind.mcUsername) {
              this.logger.warn('白名单', `QQ(${normalizedUserId})未绑定MC账号`)
              return this.deps.sendMessage(session, [
                h.text(
                  '您尚未绑定MC账号，请先使用 ' +
                    this.deps.formatCommand('mcid bind <用户名>') +
                    ' 进行绑定'
                )
              ])
            }

            // 检查是否已在白名单中
            if (this.isInServerWhitelist(selfBind, server.id)) {
              this.logger.warn(
                '白名单',
                `QQ(${normalizedUserId})已在服务器"${server.name}"的白名单中`
              )
              return this.deps.sendMessage(session, [
                h.text(`您已在服务器"${server.name}"的白名单中`)
              ])
            }

            // 执行添加白名单操作
            const result = await this.addServerWhitelist(selfBind, server)

            if (result) {
              this.logger.info(
                '白名单',
                `成功: QQ(${normalizedUserId})添加了服务器"${server.name}"的白名单`
              )
              return this.deps.sendMessage(session, [
                h.text(`已成功添加服务器"${server.name}"的白名单`)
              ])
            } else {
              this.logger.error(
                '白名单',
                `QQ(${normalizedUserId})添加服务器"${server.name}"白名单失败`
              )
              return this.deps.sendMessage(session, [
                h.text(`添加服务器"${server.name}"白名单失败，请联系管理员`)
              ])
            }
          } catch (error) {
            const normalizedUserId = this.deps.normalizeQQId(session.userId)
            this.logger.error('白名单', `QQ(${normalizedUserId})添加白名单失败: ${error.message}`)
            return this.deps.sendMessage(session, [h.text(this.getFriendlyErrorMessage(error))])
          }
        }
      )
  }

  /**
   * 移除白名单
   */
  private registerRemoveCommand(parent: any): void {
    parent
      .subcommand('.remove <serverIdOrName:string> [...targets:string]', '[管理员]移除服务器白名单')
      .action(
        async ({ session }: { session: Session }, serverIdOrName: string, ...targets: string[]) => {
          try {
            const normalizedUserId = this.deps.normalizeQQId(session.userId)

            // 检查权限，只有管理员可以移除白名单
            if (!(await this.isAdmin(session.userId))) {
              this.logger.warn(
                '白名单',
                `权限不足: QQ(${normalizedUserId})不是管理员，无法移除白名单`
              )
              return this.deps.sendMessage(session, [h.text('只有管理员才能移除白名单')])
            }

            // 检查服务器名称或ID
            if (!serverIdOrName) {
              this.logger.warn('白名单', `QQ(${normalizedUserId})未提供服务器名称或ID`)
              return this.deps.sendMessage(session, [
                h.text('请提供服务器名称或ID\n使用 mcid whitelist servers 查看可用服务器列表')
              ])
            }

            // 获取服务器配置
            const server = this.getServerConfigByIdOrName(serverIdOrName)
            if (!server) {
              this.logger.warn(
                '白名单',
                `QQ(${normalizedUserId})提供的服务器名称或ID"${serverIdOrName}"无效`
              )
              return this.deps.sendMessage(session, [
                h.text(
                  `未找到名称或ID为"${serverIdOrName}"的服务器\n使用 mcid whitelist servers 查看可用服务器列表`
                )
              ])
            }

            // 如果有指定目标用户（批量操作或单个用户管理）
            if (targets && targets.length > 0) {
              // 检查是否为标签（优先检查标签名，没有匹配标签再按QQ号处理）
              if (targets.length === 1) {
                const targetValue = targets[0]

                // 首先检查是否存在该标签名
                const allBinds = await this.repos.mcidbind.findAll()
                const usersWithTag = allBinds.filter(
                  bind => bind.tags && bind.tags.includes(targetValue) && BindStatus.hasValidMcBind(bind)
                )

                if (usersWithTag.length > 0) {
                  // 作为标签处理
                  const tagName = targetValue
                  this.logger.info(
                    '白名单',
                    `管理员QQ(${normalizedUserId})尝试为标签"${tagName}"的所有用户移除服务器"${server.name}"白名单`
                  )

                  // 转换为用户ID数组
                  targets = usersWithTag.map(bind => bind.qqId)
                  this.logger.info(
                    '白名单',
                    `找到${targets.length}个有标签"${tagName}"的已绑定用户`
                  )

                  await this.deps.sendMessage(session, [
                    h.text(
                      `找到${targets.length}个有标签"${tagName}"的已绑定用户，开始移除白名单...`
                    )
                  ])
                }
                // 如果没有找到标签，将继续按单个用户处理
              }

              // 单个用户的简洁处理逻辑
              if (targets.length === 1) {
                const target = targets[0]
                const normalizedTargetId = this.deps.normalizeQQId(target)
                this.logger.info(
                  '白名单',
                  `管理员QQ(${normalizedUserId})尝试为QQ(${normalizedTargetId})移除服务器"${server.name}"白名单`
                )

                // 获取目标用户的绑定信息
                const targetBind =
                  await this.deps.databaseService.getMcBindByQQId(normalizedTargetId)
                if (!targetBind || !targetBind.mcUsername) {
                  this.logger.warn('白名单', `QQ(${normalizedTargetId})未绑定MC账号`)
                  return this.deps.sendMessage(session, [
                    h.text(`用户 ${normalizedTargetId} 尚未绑定MC账号，无法移除白名单`)
                  ])
                }

                // 检查是否在白名单中
                if (!this.isInServerWhitelist(targetBind, server.id)) {
                  this.logger.warn(
                    '白名单',
                    `QQ(${normalizedTargetId})不在服务器"${server.name}"的白名单中`
                  )
                  return this.deps.sendMessage(session, [
                    h.text(`用户 ${normalizedTargetId} 不在服务器"${server.name}"的白名单中`)
                  ])
                }

                // 执行移除白名单操作
                const result = await this.removeServerWhitelist(targetBind, server)

                if (result) {
                  this.logger.info(
                    '白名单',
                    `成功: 管理员QQ(${normalizedUserId})为QQ(${normalizedTargetId})移除了服务器"${server.name}"的白名单`
                  )
                  return this.deps.sendMessage(session, [
                    h.text(`已成功为用户 ${normalizedTargetId} 移除服务器"${server.name}"的白名单`)
                  ])
                } else {
                  this.logger.error(
                    '白名单',
                    `管理员QQ(${normalizedUserId})为QQ(${normalizedTargetId})移除服务器"${server.name}"白名单失败`
                  )
                  return this.deps.sendMessage(session, [
                    h.text(
                      `为用户 ${normalizedTargetId} 移除服务器"${server.name}"白名单失败，请检查RCON连接和命令配置`
                    )
                  ])
                }
              }

              // 批量用户的详细处理逻辑
              this.logger.info(
                '白名单',
                `管理员QQ(${normalizedUserId})尝试批量为${targets.length}个用户移除服务器"${server.name}"白名单`
              )

              // 发送开始处理的通知
              await this.deps.sendMessage(session, [
                h.text(`开始为${targets.length}个用户移除服务器"${server.name}"的白名单，请稍候...`)
              ])

              // 统计信息
              let successCount = 0
              let failCount = 0
              let skipCount = 0
              const results: string[] = []

              // 处理每个目标用户
              for (let i = 0; i < targets.length; i++) {
                const target = targets[i]
                const normalizedTargetId = this.deps.normalizeQQId(target)

                try {
                  // 获取目标用户的绑定信息
                  const targetBind =
                    await this.deps.databaseService.getMcBindByQQId(normalizedTargetId)
                  if (!targetBind || !targetBind.mcUsername) {
                    failCount++
                    results.push(`❌ ${normalizedTargetId}: 未绑定MC账号`)
                    this.logger.warn('白名单', `QQ(${normalizedTargetId})未绑定MC账号`)
                    continue
                  }

                  // 检查是否在白名单中
                  if (!this.isInServerWhitelist(targetBind, server.id)) {
                    skipCount++
                    results.push(`⏭️ ${normalizedTargetId}: 不在白名单中`)
                    this.logger.warn(
                      '白名单',
                      `QQ(${normalizedTargetId})不在服务器"${server.name}"的白名单中`
                    )
                    continue
                  }

                  // 执行移除白名单操作
                  const result = await this.removeServerWhitelist(targetBind, server)

                  if (result) {
                    successCount++
                    results.push(`✅ ${normalizedTargetId}: 移除成功`)
                    this.logger.info(
                      '白名单',
                      `成功: 管理员QQ(${normalizedUserId})为QQ(${normalizedTargetId})移除了服务器"${server.name}"的白名单`
                    )
                  } else {
                    failCount++
                    results.push(`❌ ${normalizedTargetId}: 移除失败`)
                    this.logger.error(
                      '白名单',
                      `管理员QQ(${normalizedUserId})为QQ(${normalizedTargetId})移除服务器"${server.name}"白名单失败`
                    )
                  }

                  // 批量操作时添加适当延迟，避免过载
                  if (i < targets.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 500))
                  }

                  // 每处理5个用户发送一次进度更新（仅在批量操作时）
                  if (targets.length > 5 && (i + 1) % 5 === 0) {
                    const progress = Math.round(((i + 1) / targets.length) * 100)
                    await this.deps.sendMessage(session, [
                      h.text(
                        `批量移除白名单进度: ${progress}% (${i + 1}/${targets.length})\n成功: ${successCount} | 失败: ${failCount} | 跳过: ${skipCount}`
                      )
                    ])
                  }
                } catch (error) {
                  failCount++
                  results.push(`❌ ${normalizedTargetId}: 处理出错`)
                  this.logger.error(
                    '白名单',
                    `处理用户QQ(${normalizedTargetId})时出错: ${error.message}`
                  )
                }
              }

              // 生成结果报告
              let resultMessage = `批量移除服务器"${server.name}"白名单完成\n共处理${targets.length}个用户\n✅ 成功: ${successCount} 个\n❌ 失败: ${failCount} 个\n⏭️ 跳过: ${skipCount} 个`

              // 如果有详细结果且用户数量不太多，显示详细信息
              if (targets.length <= 10) {
                resultMessage += '\n\n详细结果:\n' + results.join('\n')
              }

              this.logger.info(
                '白名单',
                `批量操作完成: 管理员QQ(${normalizedUserId})为${targets.length}个用户移除服务器"${server.name}"白名单，成功: ${successCount}，失败: ${failCount}，跳过: ${skipCount}`
              )
              return this.deps.sendMessage(session, [h.text(resultMessage)])
            }

            // 为自己移除白名单（原有逻辑保持不变）
            this.logger.info(
              '白名单',
              `管理员QQ(${normalizedUserId})尝试为自己移除服务器"${server.name}"白名单`
            )

            // 获取自己的绑定信息
            const selfBind = await this.deps.databaseService.getMcBindByQQId(normalizedUserId)
            if (!selfBind || !selfBind.mcUsername) {
              this.logger.warn('白名单', `QQ(${normalizedUserId})未绑定MC账号`)
              return this.deps.sendMessage(session, [
                h.text(
                  '您尚未绑定MC账号，请先使用 ' +
                    this.deps.formatCommand('mcid bind <用户名>') +
                    ' 进行绑定'
                )
              ])
            }

            // 检查是否在白名单中
            if (!this.isInServerWhitelist(selfBind, server.id)) {
              this.logger.warn(
                '白名单',
                `QQ(${normalizedUserId})不在服务器"${server.name}"的白名单中`
              )
              return this.deps.sendMessage(session, [
                h.text(`您不在服务器"${server.name}"的白名单中`)
              ])
            }

            // 执行移除白名单操作
            const result = await this.removeServerWhitelist(selfBind, server)

            if (result) {
              this.logger.info(
                '白名单',
                `成功: 管理员QQ(${normalizedUserId})移除了自己服务器"${server.name}"的白名单`
              )
              return this.deps.sendMessage(session, [
                h.text(`已成功移除服务器"${server.name}"的白名单`)
              ])
            } else {
              this.logger.error(
                '白名单',
                `管理员QQ(${normalizedUserId})移除服务器"${server.name}"白名单失败`
              )
              return this.deps.sendMessage(session, [
                h.text(`移除服务器"${server.name}"白名单失败，请检查RCON连接和命令配置`)
              ])
            }
          } catch (error) {
            const normalizedUserId = this.deps.normalizeQQId(session.userId)
            this.logger.error('白名单', `QQ(${normalizedUserId})移除白名单失败: ${error.message}`)
            return this.deps.sendMessage(session, [h.text(this.getFriendlyErrorMessage(error))])
          }
        }
      )
  }

  /**
   * 重置服务器所有白名单记录
   */
  private registerResetCommand(parent: any): void {
    parent
      .subcommand('.reset <serverIdOrName:string>', '[主人]重置服务器所有白名单记录')
      .action(async ({ session }: { session: Session }, serverIdOrName: string) => {
        try {
          const normalizedUserId = this.deps.normalizeQQId(session.userId)

          // 检查是否为主人
          if (!this.isMaster(session.userId)) {
            this.logger.warn(
              '重置白名单',
              `权限不足: QQ(${normalizedUserId})不是主人，无法重置白名单数据库`
            )
            return this.deps.sendMessage(session, [h.text('只有主人才能重置服务器白名单数据库')])
          }

          // 检查服务器ID或名称
          if (!serverIdOrName) {
            this.logger.warn('重置白名单', `QQ(${normalizedUserId})未提供服务器ID或名称`)
            return this.deps.sendMessage(session, [
              h.text('请提供服务器ID或名称\n使用 mcid whitelist servers 查看可用服务器列表')
            ])
          }

          // 直接使用提供的ID进行删除，不验证服务器是否存在于配置中
          const serverId = serverIdOrName
          this.logger.info(
            '重置白名单',
            `主人QQ(${normalizedUserId})正在重置服务器ID"${serverId}"的白名单数据库记录`
          )

          // 查询所有用户绑定记录
          const allBinds = await this.repos.mcidbind.findAll()
          this.logger.info('重置白名单', `共有${allBinds.length}条记录需要检查`)

          // 统计信息
          let processedCount = 0
          let updatedCount = 0

          // 处理每条记录
          for (const bind of allBinds) {
            processedCount++

            // 检查该用户是否有此服务器的白名单
            if (bind.whitelist && bind.whitelist.includes(serverId)) {
              // 更新记录，移除该服务器的白名单
              const newWhitelist = bind.whitelist.filter(id => id !== serverId)
              await this.repos.mcidbind.update(bind.qqId, {
                whitelist: newWhitelist
              })
              updatedCount++
              this.logger.info(
                '重置白名单',
                `已从QQ(${bind.qqId})的白名单记录中移除服务器ID"${serverId}"`
              )
            }
          }

          this.logger.info(
            '重置白名单',
            `成功: 主人QQ(${normalizedUserId})重置了服务器ID"${serverId}"的白名单数据库，共处理${processedCount}条记录，更新${updatedCount}条记录`
          )
          return this.deps.sendMessage(session, [
            h.text(
              `已成功重置服务器ID"${serverId}"的白名单数据库记录\n共处理${processedCount}条记录，更新${updatedCount}条记录\n\n注意：此操作仅清除数据库记录，如需同时清除服务器上的白名单，请使用RCON命令手动操作`
            )
          ])
        } catch (error) {
          const normalizedUserId = this.deps.normalizeQQId(session.userId)
          this.logger.error(
            '重置白名单',
            `QQ(${normalizedUserId})重置白名单数据库失败: ${error.message}`
          )
          return this.deps.sendMessage(session, [h.text(this.getFriendlyErrorMessage(error))])
        }
      })
  }

  /**
   * 重置所有未在服务器配置中的白名单ID
   */
  private registerResetAllCommand(parent: any): void {
    parent
      .subcommand('.resetall', '[主人]清理所有未在服务器配置列表中的白名单ID')
      .action(async ({ session }: { session: Session }) => {
        try {
          const normalizedUserId = this.deps.normalizeQQId(session.userId)

          // 检查是否为主人
          if (!this.isMaster(session.userId)) {
            this.logger.warn(
              '清理白名单',
              `权限不足: QQ(${normalizedUserId})不是主人，无法执行清理操作`
            )
            return this.deps.sendMessage(session, [h.text('只有主人才能执行白名单清理操作')])
          }

          // 获取当前配置中所有有效的服务器ID
          const validServerIds = new Set(this.config.servers?.map(server => server.id) || [])
          this.logger.info(
            '清理白名单',
            `主人QQ(${normalizedUserId})开始清理白名单，有效服务器ID: ${Array.from(validServerIds).join(', ')}`
          )

          // 查询所有用户绑定记录
          const allBinds = await this.repos.mcidbind.findAll()

          // 统计信息
          let processedCount = 0
          let updatedCount = 0
          let removedIdsTotal = 0
          const invalidIdsFound = new Set<string>()

          // 处理每条记录
          for (const bind of allBinds) {
            processedCount++

            if (bind.whitelist && bind.whitelist.length > 0) {
              // 分离有效和无效的服务器ID
              const validIds = bind.whitelist.filter(id => validServerIds.has(id))
              const invalidIds = bind.whitelist.filter(id => !validServerIds.has(id))

              // 记录发现的无效ID
              invalidIds.forEach(id => invalidIdsFound.add(id))

              // 如果有无效ID需要移除
              if (invalidIds.length > 0) {
                await this.repos.mcidbind.update(bind.qqId, {
                  whitelist: validIds
                })
                updatedCount++
                removedIdsTotal += invalidIds.length
                this.logger.info(
                  '清理白名单',
                  `QQ(${bind.qqId})移除了${invalidIds.length}个无效的服务器ID: ${invalidIds.join(', ')}`
                )
              }
            }
          }

          // 生成清理报告
          const invalidIdsArray = Array.from(invalidIdsFound)
          let resultMessage = `白名单清理完成\n共处理${processedCount}条记录，更新${updatedCount}条记录\n移除了${removedIdsTotal}个无效的白名单条目`

          if (invalidIdsArray.length > 0) {
            resultMessage += `\n\n发现的无效服务器ID:\n${invalidIdsArray.map(id => `• ${id}`).join('\n')}`
          }

          this.logger.info(
            '清理白名单',
            `成功: 主人QQ(${normalizedUserId})清理完成，处理${processedCount}条记录，更新${updatedCount}条记录，移除${removedIdsTotal}个无效条目`
          )
          return this.deps.sendMessage(session, [h.text(resultMessage)])
        } catch (error) {
          const normalizedUserId = this.deps.normalizeQQId(session.userId)
          this.logger.error('清理白名单', `QQ(${normalizedUserId})清理白名单失败: ${error.message}`)
          return this.deps.sendMessage(session, [h.text(this.getFriendlyErrorMessage(error))])
        }
      })
  }

  /**
   * 批量将所有用户添加到服务器白名单
   */
  private registerAddAllCommand(parent: any): void {
    parent
      .subcommand('.addall <serverIdOrName:string>', '[管理员]将所有用户添加到指定服务器白名单')
      .action(async ({ session }: { session: Session }, serverIdOrName: string) => {
        try {
          const normalizedUserId = this.deps.normalizeQQId(session.userId)

          // 检查是否为管理员
          if (!(await this.isAdmin(session.userId))) {
            this.logger.warn(
              '批量白名单',
              `权限不足: QQ(${normalizedUserId})不是管理员，无法执行批量添加白名单操作`
            )
            return this.deps.sendMessage(session, [h.text('只有管理员才能执行批量添加白名单操作')])
          }

          // 检查服务器名称或ID
          if (!serverIdOrName) {
            this.logger.warn('批量白名单', `QQ(${normalizedUserId})未提供服务器名称或ID`)
            return this.deps.sendMessage(session, [
              h.text('请提供服务器名称或ID\n使用 mcid whitelist servers 查看可用服务器列表')
            ])
          }

          // 获取服务器配置
          const server = this.getServerConfigByIdOrName(serverIdOrName)
          if (!server) {
            this.logger.warn(
              '批量白名单',
              `QQ(${normalizedUserId})提供的服务器名称或ID"${serverIdOrName}"无效`
            )
            return this.deps.sendMessage(session, [
              h.text(
                `未找到名称或ID为"${serverIdOrName}"的服务器\n使用 mcid whitelist servers 查看可用服务器列表`
              )
            ])
          }

          // 检查服务器是否启用
          if (server.enabled === false) {
            this.logger.warn(
              '批量白名单',
              `QQ(${normalizedUserId})尝试为已停用的服务器"${server.name}"批量添加白名单`
            )
            return this.deps.sendMessage(session, [
              h.text(`服务器"${server.name}"已停用，无法添加白名单`)
            ])
          }

          // 发送开始执行的通知
          await this.deps.sendMessage(session, [
            h.text(`开始批量添加白名单到服务器"${server.name}"，请稍候...`)
          ])

          // 查询所有已绑定MC账号的用户
          const allBinds = await this.repos.mcidbind.findAll()

          // 过滤掉无效的绑定：没有用户名或UUID的记录
          const validBinds = allBinds.filter(
            bind => BindStatus.hasValidMcBind(bind) || (bind.mcUuid && bind.mcUuid.trim() !== '')
          )

          // 按绑定时间排序，早绑定的用户优先处理
          validBinds.sort((a, b) => {
            const timeA = a.lastModified ? new Date(a.lastModified).getTime() : 0
            const timeB = b.lastModified ? new Date(b.lastModified).getTime() : 0
            return timeA - timeB // 升序排序，早绑定的在前
          })

          this.logger.info(
            '批量白名单',
            `管理员QQ(${normalizedUserId})正在批量添加服务器"${server.name}"的白名单，共有${validBinds.length}条有效记录需要处理，已按绑定时间排序（早绑定优先）`
          )

          // 统计信息
          let successCount = 0
          let failCount = 0
          let skipCount = 0

          // 记录最后一次通知的进度百分比
          let lastNotifiedProgress = 0

          // 使用队列处理，每个请求等待上一个完成后再继续
          // 移除并发处理，改为顺序处理确保RCON命令按顺序执行
          for (let i = 0; i < validBinds.length; i++) {
            const bind = validBinds[i]

            try {
              // 跳过已经在白名单中的用户
              if (this.isInServerWhitelist(bind, server.id)) {
                skipCount++
                this.logger.debug(
                  '批量白名单',
                  `跳过已在白名单中的用户QQ(${bind.qqId})的MC账号(${bind.mcUsername})`
                )
              } else {
                // 添加错误阈值检查
                const currentFailRate = failCount / (successCount + failCount + 1)
                if (currentFailRate > 0.5 && successCount + failCount >= 5) {
                  this.logger.error(
                    '批量白名单',
                    `失败率过高(${Math.round(currentFailRate * 100)}%)，中止操作`
                  )
                  await this.deps.sendMessage(session, [
                    h.text(
                      `⚠️ 批量添加白名单操作已中止: 失败率过高(${Math.round(currentFailRate * 100)}%)，请检查服务器连接`
                    )
                  ])
                  break
                }

                // 执行添加白名单操作，顺序执行确保每个命令等待上一个完成
                const result = await this.addServerWhitelist(bind, server)

                if (result) {
                  successCount++
                  this.logger.debug(
                    '批量白名单',
                    `成功添加用户QQ(${bind.qqId})的MC账号(${bind.mcUsername})到服务器"${server.name}"的白名单`
                  )
                } else {
                  failCount++
                  this.logger.error(
                    '批量白名单',
                    `添加用户QQ(${bind.qqId})的MC账号(${bind.mcUsername})到服务器"${server.name}"的白名单失败`
                  )
                }
              }
            } catch (error) {
              failCount++
              this.logger.error('批量白名单', `处理用户QQ(${bind.qqId})时出错: ${error.message}`)

              // 如果错误指示操作已中止，退出循环
              if (error.message.includes('失败率过高')) {
                await this.deps.sendMessage(session, [
                  h.text(`⚠️ 批量添加白名单操作已中止: ${error.message}`)
                ])
                break
              }
            }

            // 计算进度
            const processedCount = i + 1
            const progress = Math.floor((processedCount / validBinds.length) * 100)

            // 只有当进度增加了20%或以上，或者是首次或最后一次才发送通知
            if (i === 0 || progress - lastNotifiedProgress >= 20 || i === validBinds.length - 1) {
              await this.deps.sendMessage(session, [
                h.text(
                  `批量添加白名单进度: ${progress}%，已处理${processedCount}/${validBinds.length}个用户\n成功: ${successCount} | 失败: ${failCount} | 跳过: ${skipCount}`
                )
              ])
              lastNotifiedProgress = progress
            }

            // 添加延迟确保RCON命令有足够的处理时间，避免过载
            await new Promise(resolve => setTimeout(resolve, 1000)) // 每个请求间隔1秒
          }

          this.logger.info(
            '批量白名单',
            `成功: 管理员QQ(${normalizedUserId})批量添加了服务器"${server.name}"的白名单，成功: ${successCount}，失败: ${failCount}，跳过: ${skipCount}`
          )
          return this.deps.sendMessage(session, [
            h.text(
              `批量添加服务器"${server.name}"白名单完成\n共处理${validBinds.length}个有效用户\n✅ 成功: ${successCount} 个\n❌ 失败: ${failCount} 个\n⏭️ 跳过(已在白名单): ${skipCount} 个\n\n如需查看详细日志，请查看服务器日志文件`
            )
          ])
        } catch (error) {
          const normalizedUserId = this.deps.normalizeQQId(session.userId)
          this.logger.error(
            '批量白名单',
            `QQ(${normalizedUserId})批量添加白名单失败: ${error.message}`
          )
          return this.deps.sendMessage(session, [h.text(this.getFriendlyErrorMessage(error))])
        }
      })
  }

  /**
   * 私有辅助方法：检查用户是否为管理员
   */
  private async isAdmin(userId: string): Promise<boolean> {
    // 主人始终是管理员
    const normalizedMasterId = this.deps.normalizeQQId(this.config.masterId)
    const normalizedQQId = this.deps.normalizeQQId(userId)

    if (normalizedQQId === normalizedMasterId) return true

    // 查询MCIDBIND表中是否是管理员
    try {
      const bind = await this.deps.databaseService.getMcBindByQQId(normalizedQQId)
      return bind && bind.isAdmin === true
    } catch (error) {
      this.logger.error('权限检查', `QQ(${normalizedQQId})的管理员状态查询失败: ${error.message}`)
      return false
    }
  }

  /**
   * 私有辅助方法：检查是否为主人
   */
  private isMaster(qqId: string): boolean {
    const normalizedMasterId = this.deps.normalizeQQId(this.config.masterId)
    const normalizedQQId = this.deps.normalizeQQId(qqId)
    return normalizedQQId === normalizedMasterId
  }

  /**
   * 私有辅助方法：根据服务器ID或名称获取服务器配置
   */
  private getServerConfigByIdOrName(serverIdOrName: string): ServerConfig | null {
    if (!this.config.servers || !Array.isArray(this.config.servers)) return null

    // 先尝试通过ID精确匹配
    const serverById = this.getServerConfigById(serverIdOrName)
    if (serverById) return serverById

    // 如果ID未匹配到，尝试通过名称匹配
    return this.getServerConfigByName(serverIdOrName)
  }

  /**
   * 私有辅助方法：根据服务器ID获取服务器配置
   */
  private getServerConfigById(serverId: string): ServerConfig | null {
    if (!this.config.servers || !Array.isArray(this.config.servers)) return null
    return (
      this.config.servers.find(server => server.id === serverId && server.enabled !== false) || null
    )
  }

  /**
   * 私有辅助方法：根据服务器名称获取服务器配置
   */
  private getServerConfigByName(serverName: string): ServerConfig | null {
    if (!this.config.servers || !Array.isArray(this.config.servers)) return null

    // 过滤出启用的服务器
    const enabledServers = this.config.servers.filter(server => server.enabled !== false)

    // 尝试精确匹配
    let server = enabledServers.find(server => server.name === serverName)

    // 如果精确匹配失败，尝试模糊匹配
    if (!server) {
      const lowerServerName = serverName.toLowerCase().trim()

      // 最小相似度阈值，低于此值的匹配结果将被忽略
      const MIN_SIMILARITY = 0.6 // 60%的相似度

      // 首先尝试包含关系匹配（A包含于B，或B包含于A）
      const containsMatches = enabledServers.filter(
        server =>
          server.name.toLowerCase().includes(lowerServerName) ||
          lowerServerName.includes(server.name.toLowerCase())
      )

      if (containsMatches.length === 1) {
        // 如果只有一个匹配，验证相似度是否达到阈值
        const similarity = this.similarityScore(
          containsMatches[0].name.toLowerCase(),
          lowerServerName
        )
        if (similarity >= MIN_SIMILARITY) {
          // 相似度达到阈值，返回匹配结果
          server = containsMatches[0]
        }
      } else if (containsMatches.length > 1) {
        // 如果有多个匹配，计算相似度并选择最接近的一个
        let bestServer = null
        let bestSimilarity = 0

        for (const candidate of containsMatches) {
          const similarity = this.similarityScore(candidate.name.toLowerCase(), lowerServerName)
          // 记录最佳匹配（相似度最高且达到阈值）
          if (similarity > bestSimilarity && similarity >= MIN_SIMILARITY) {
            bestSimilarity = similarity
            bestServer = candidate
          }
        }

        server = bestServer
      }
    }

    return server || null
  }

  /**
   * 私有辅助方法：计算两个字符串的相似度
   */
  private similarityScore(a: string, b: string): number {
    // 如果两个字符串相同，直接返回1
    if (a === b) return 1

    // 如果长度为0，返回0
    if (a.length === 0 || b.length === 0) return 0

    // 如果一个字符串完全包含另一个字符串，计算其占比
    if (a.includes(b)) {
      return b.length / a.length
    }
    if (b.includes(a)) {
      return a.length / b.length
    }

    // 否则使用工具函数计算Levenshtein距离的相似度
    return calculateSimilarity(a, b)
  }

  /**
   * 私有辅助方法：检查用户是否在特定服务器的白名单中
   */
  private isInServerWhitelist(mcBind: MCIDBIND, serverId: string): boolean {
    if (!mcBind || !mcBind.whitelist) return false
    return mcBind.whitelist.includes(serverId)
  }

  /**
   * 私有辅助方法：添加服务器白名单
   * 注意：这是对 RconManager 的封装，实际执行逻辑在主文件中
   */
  private async addServerWhitelist(mcBind: MCIDBIND, server: ServerConfig): Promise<boolean> {
    try {
      if (!mcBind || !mcBind.mcUsername) {
        this.logger.warn('白名单', '尝试为未绑定MC账号的用户添加白名单')
        return false
      }

      // 重新获取最新的用户绑定信息
      let freshBind = await this.deps.databaseService.getMcBindByQQId(mcBind.qqId)
      if (!freshBind || !freshBind.mcUsername) {
        this.logger.warn('白名单', `用户QQ(${mcBind.qqId})可能在操作过程中解绑了MC账号`)
        return false
      }

      // 智能检测用户名变更（带缓存，避免频繁API调用）
      freshBind = await this.deps.databaseService.checkAndUpdateUsernameWithCache(freshBind)

      // 检查最新状态是否已在白名单中
      if (freshBind.whitelist && freshBind.whitelist.includes(server.id)) {
        this.logger.info('白名单', `用户QQ(${mcBind.qqId})已在服务器${server.name}的白名单中`)
        return true
      }

      // 判断使用用户名还是UUID
      let mcid: string
      if (server.idType === 'uuid') {
        if (!freshBind.mcUuid) {
          this.logger.warn('白名单', '用户缺少UUID信息，无法添加白名单')
          return false
        }
        const uuid = freshBind.mcUuid.trim()
        mcid = uuid.replace(/-/g, '')

        if (!/^[0-9a-f]{32}$/i.test(mcid)) {
          this.logger.warn('白名单', `UUID格式无效: ${mcid}，应为32位十六进制字符`)
          return false
        }
      } else {
        mcid = freshBind.mcUsername
      }

      this.logger.info(
        '白名单',
        `为用户QQ(${freshBind.qqId})添加白名单，使用${server.idType === 'uuid' ? 'UUID' : '用户名'}: ${mcid}`
      )

      // 使用 RconManager 执行命令
      const command = this.safeCommandReplace(server.addCommand, mcid)
      const response = await this.deps.rconManager.executeCommand(server, command)

      // 判断是否成功
      let success = false
      if (response.trim() === '') {
        if (server.acceptEmptyResponse) {
          this.logger.info('白名单', '收到空响应，根据配置将其视为成功')
          success = true
        }
      } else {
        const successKeywords = [
          '已',
          '成功',
          'success',
          'added',
          'okay',
          'done',
          'completed',
          'added to',
          'whitelist has',
          'whitelisted'
        ]
        const failureKeywords = [
          '失败',
          'error',
          'failed',
          'not found',
          '不存在',
          'cannot',
          'unable',
          'failure',
          'exception',
          'denied'
        ]

        const hasFailureKeyword = failureKeywords.some(keyword =>
          response.toLowerCase().includes(keyword.toLowerCase())
        )
        const hasSuccessKeyword = successKeywords.some(keyword =>
          response.toLowerCase().includes(keyword.toLowerCase())
        )

        if (!hasFailureKeyword && (hasSuccessKeyword || response.length > 0)) {
          success = true
        }
      }

      if (success) {
        // 更新数据库
        const currentBind = await this.deps.databaseService.getMcBindByQQId(freshBind.qqId)
        if (currentBind) {
          const whitelistSet = new Set(currentBind.whitelist || [])
          whitelistSet.add(server.id)
          await this.repos.mcidbind.update(freshBind.qqId, {
            whitelist: Array.from(whitelistSet)
          })
          this.logger.info(
            '白名单',
            `成功将QQ(${freshBind.qqId})添加到服务器${server.name}的白名单`
          )
        }
        return true
      } else {
        this.logger.warn('白名单', `添加白名单失败，服务器响应: ${response}`)
        return false
      }
    } catch (error) {
      this.logger.error('白名单', `添加白名单失败: ${error.message}`)
      return false
    }
  }

  /**
   * 私有辅助方法：移除服务器白名单
   */
  private async removeServerWhitelist(mcBind: MCIDBIND, server: ServerConfig): Promise<boolean> {
    try {
      if (!mcBind || !mcBind.mcUsername) {
        this.logger.warn('白名单', '尝试为未绑定MC账号的用户移除白名单')
        return false
      }

      // 重新获取最新的用户绑定信息
      let freshBind = await this.deps.databaseService.getMcBindByQQId(mcBind.qqId)
      if (!freshBind || !freshBind.mcUsername) {
        this.logger.warn('白名单', `用户QQ(${mcBind.qqId})可能在操作过程中解绑了MC账号`)
        return false
      }

      // 智能检测用户名变更（带缓存，避免频繁API调用）
      freshBind = await this.deps.databaseService.checkAndUpdateUsernameWithCache(freshBind)

      // 检查最新状态是否在白名单中
      if (!freshBind.whitelist || !freshBind.whitelist.includes(server.id)) {
        this.logger.info('白名单', `用户QQ(${mcBind.qqId})不在服务器${server.name}的白名单中`)
        return true // 不在白名单中，无需移除，视为成功
      }

      // 判断使用用户名还是UUID
      let mcid: string
      if (server.idType === 'uuid') {
        if (!freshBind.mcUuid) {
          this.logger.warn('白名单', '用户缺少UUID信息，无法移除白名单')
          return false
        }
        const uuid = freshBind.mcUuid.trim()
        mcid = uuid.replace(/-/g, '')

        if (!/^[0-9a-f]{32}$/i.test(mcid)) {
          this.logger.warn('白名单', `UUID格式无效: ${mcid}，应为32位十六进制字符`)
          return false
        }
      } else {
        mcid = freshBind.mcUsername
      }

      this.logger.info(
        '白名单',
        `为用户QQ(${freshBind.qqId})移除白名单，使用${server.idType === 'uuid' ? 'UUID' : '用户名'}: ${mcid}`
      )

      // 使用 RconManager 执行命令
      const command = this.safeCommandReplace(server.removeCommand, mcid)
      const response = await this.deps.rconManager.executeCommand(server, command)

      // 判断是否成功
      let success = false
      if (response.trim() === '') {
        if (server.acceptEmptyResponse) {
          this.logger.info('白名单', '收到空响应，根据配置将其视为成功')
          success = true
        }
      } else {
        const successKeywords = [
          '移除',
          '已完成',
          '成功',
          'success',
          'removed',
          'okay',
          'done',
          'completed',
          'removePlayer',
          'took',
          'off'
        ]
        const failureKeywords = [
          '失败',
          '错误',
          'error',
          'failed',
          'cannot',
          'unable',
          'failure',
          'exception',
          'denied'
        ]
        const notFoundKeywords = [
          'not found',
          '不存在',
          'no player was removed',
          'is not whitelisted',
          'not in'
        ]

        const hasSuccessKeyword = successKeywords.some(keyword =>
          response.toLowerCase().includes(keyword.toLowerCase())
        )
        const hasFailureKeyword = failureKeywords.some(keyword =>
          response.toLowerCase().includes(keyword.toLowerCase())
        )
        const isNotExist = notFoundKeywords.some(keyword =>
          response.toLowerCase().includes(keyword.toLowerCase())
        )
        const notInLocal = !freshBind.whitelist || !freshBind.whitelist.includes(server.id)

        if ((hasSuccessKeyword && !hasFailureKeyword) || (isNotExist && notInLocal)) {
          success = true
        }
      }

      if (success) {
        // 更新数据库
        const currentBind = await this.deps.databaseService.getMcBindByQQId(freshBind.qqId)
        if (currentBind && currentBind.whitelist && currentBind.whitelist.includes(server.id)) {
          currentBind.whitelist = currentBind.whitelist.filter(id => id !== server.id)
          await this.repos.mcidbind.update(freshBind.qqId, {
            whitelist: currentBind.whitelist
          })
          this.logger.info(
            '白名单',
            `成功将QQ(${freshBind.qqId})从服务器${server.name}的白名单移除`
          )
        }
        return true
      } else {
        this.logger.warn('白名单', `移除白名单失败，服务器响应: ${response}`)
        return false
      }
    } catch (error) {
      this.logger.error('白名单', `移除白名单失败: ${error.message}`)
      return false
    }
  }

  /**
   * 私有辅助方法：安全地替换命令模板
   */
  private safeCommandReplace(template: string, mcid: string): string {
    // 过滤可能导致命令注入的字符
    const sanitizedMcid = mcid.replace(/[;&|"`'$\\]/g, '')

    // 如果经过过滤后的mcid与原始mcid不同，记录警告
    if (sanitizedMcid !== mcid) {
      this.logger.warn('安全', `检测到潜在危险字符，已自动过滤: '${mcid}' -> '${sanitizedMcid}'`)
    }

    return template.replace(/\${MCID}/g, sanitizedMcid)
  }

  /**
   * 私有辅助方法：获取友好的错误信息
   */
  private getFriendlyErrorMessage(error: Error | string): string {
    const errorMsg = error instanceof Error ? error.message : error

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
    }

    return errorMsg
  }
}
