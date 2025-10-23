import * as XLSX from 'xlsx'
import * as fs from 'fs'
import * as path from 'path'
import { Session, Context } from 'koishi'
import { LoggerService } from './utils/logger'
import { MCIDBINDRepository } from './repositories/mcidbind.repository'
import type { MCIDBIND } from './types'

// 群成员信息接口
interface GroupMemberInfo {
  qqId: string
  nickname: string
  card: string
  role: string
  join_time: number
  last_sent_time: number
}

// 导出数据行接口
interface ExportDataRow {
  QQ号: string
  群昵称: string
  用户昵称: string
  角色: string
  加群时间: string
  最后发言: string
  MC用户名: string
  MC_UUID: string
  B站UID: string
  B站用户名: string
  舰长等级: string
  粉丝牌名称: string
  粉丝牌等级: string
  荣耀等级: string
  绑定状态: string
  最后修改时间: string
}

export class GroupExporter {
  private logger: LoggerService
  private ctx: Context
  private mcidbindRepo: MCIDBINDRepository

  constructor(ctx: Context, logger: LoggerService, mcidbindRepo: MCIDBINDRepository) {
    this.ctx = ctx
    this.logger = logger
    this.mcidbindRepo = mcidbindRepo
  }

  /**
   * 获取群成员列表
   */
  private async getGroupMembers(session: Session, groupId: string): Promise<GroupMemberInfo[]> {
    try {
      this.logger.debug('群数据导出', `开始获取群 ${groupId} 的成员列表`)

      if (!session.bot.internal) {
        throw new Error('Bot不支持获取群成员列表')
      }

      const memberList = await session.bot.internal.getGroupMemberList(groupId)
      this.logger.debug('群数据导出', `获取到 ${memberList.length} 个群成员`)

      return memberList.map(member => ({
        qqId: member.user_id.toString(),
        nickname: member.nickname || '',
        card: member.card || '',
        role: this.translateRole(member.role),
        join_time: member.join_time || 0,
        last_sent_time: member.last_sent_time || 0
      }))
    } catch (error) {
      this.logger.error('群数据导出', `获取群成员列表失败: ${error.message}`)
      throw new Error(`无法获取群 ${groupId} 的成员列表: ${error.message}`)
    }
  }

  /**
   * 翻译群角色
   */
  private translateRole(role: string): string {
    switch (role) {
      case 'owner':
        return '群主'
      case 'admin':
        return '管理员'
      case 'member':
        return '成员'
      default:
        return role || '未知'
    }
  }

  /**
   * 获取所有绑定信息
   */
  private async getAllBindings(): Promise<MCIDBIND[]> {
    try {
      this.logger.debug('群数据导出', '开始获取数据库绑定信息')
      const bindings = await this.mcidbindRepo.findAll()
      this.logger.debug('群数据导出', `获取到 ${bindings.length} 条绑定记录`)
      return bindings
    } catch (error) {
      this.logger.error('群数据导出', `获取绑定信息失败: ${error.message}`)
      throw new Error(`无法获取绑定信息: ${error.message}`)
    }
  }

  /**
   * 格式化时间戳
   */
  private formatTimestamp(timestamp: number | Date | null): string {
    if (!timestamp) return '未知'

    let date: Date
    if (timestamp instanceof Date) {
      date = timestamp
    } else if (typeof timestamp === 'number') {
      // 如果是秒级时间戳，转换为毫秒
      date = new Date(timestamp < 10000000000 ? timestamp * 1000 : timestamp)
    } else {
      return '未知'
    }

    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
  }

  /**
   * 合并群成员信息和绑定信息
   */
  private mergeData(members: GroupMemberInfo[], bindings: MCIDBIND[]): ExportDataRow[] {
    this.logger.debug('群数据导出', '开始合并群成员和绑定信息')

    // 创建绑定信息映射
    const bindingMap = new Map<string, MCIDBIND>()
    bindings.forEach(binding => {
      bindingMap.set(binding.qqId, binding)
    })

    return members.map(member => {
      const binding = bindingMap.get(member.qqId)

      // 判断绑定状态
      let bindingStatus = '未绑定'
      if (binding) {
        const hasMc = binding.mcUsername && !binding.mcUsername.startsWith('_temp_')
        const hasBuid = binding.buidUid

        if (hasMc && hasBuid) {
          bindingStatus = '完全绑定'
        } else if (hasMc) {
          bindingStatus = '仅MC绑定'
        } else if (hasBuid) {
          bindingStatus = '仅B站绑定'
        } else {
          bindingStatus = '未绑定'
        }
      }

      return {
        QQ号: member.qqId,
        群昵称: member.card || member.nickname,
        用户昵称: member.nickname,
        角色: member.role,
        加群时间: this.formatTimestamp(member.join_time),
        最后发言: this.formatTimestamp(member.last_sent_time),
        MC用户名:
          binding?.mcUsername && !binding.mcUsername.startsWith('_temp_') ? binding.mcUsername : '',
        MC_UUID: binding?.mcUuid || '',
        B站UID: binding?.buidUid || '',
        B站用户名: binding?.buidUsername || '',
        舰长等级: binding?.guardLevelText || '',
        粉丝牌名称: binding?.medalName || '',
        粉丝牌等级: binding?.medalLevel ? binding.medalLevel.toString() : '',
        荣耀等级: binding?.wealthMedalLevel ? binding.wealthMedalLevel.toString() : '',
        绑定状态: bindingStatus,
        最后修改时间: this.formatTimestamp(binding?.lastModified)
      }
    })
  }

  /**
   * 生成Excel文件
   */
  private generateExcelFile(allData: ExportDataRow[], groupId: string): Buffer {
    this.logger.debug('群数据导出', '开始生成Excel文件')

    // 分类数据
    const boundData = allData.filter(row => row.绑定状态 !== '未绑定')
    const unboundData = allData.filter(row => row.绑定状态 === '未绑定')

    // 创建工作簿
    const workbook = XLSX.utils.book_new()

    // Sheet1: 所有成员
    const allSheet = XLSX.utils.json_to_sheet(allData)
    XLSX.utils.book_append_sheet(workbook, allSheet, '所有成员')

    // Sheet2: 已绑定成员
    const boundSheet = XLSX.utils.json_to_sheet(boundData)
    XLSX.utils.book_append_sheet(workbook, boundSheet, '已绑定成员')

    // Sheet3: 未绑定成员
    const unboundSheet = XLSX.utils.json_to_sheet(unboundData)
    XLSX.utils.book_append_sheet(workbook, unboundSheet, '未绑定成员')

    // 设置列宽
    const colWidths = [
      { wch: 12 }, // QQ号
      { wch: 20 }, // 群昵称
      { wch: 15 }, // 用户昵称
      { wch: 8 }, // 角色
      { wch: 18 }, // 加群时间
      { wch: 18 }, // 最后发言
      { wch: 16 }, // MC用户名
      { wch: 36 }, // MC_UUID
      { wch: 12 }, // B站UID
      { wch: 20 }, // B站用户名
      { wch: 10 }, // 舰长等级
      { wch: 12 }, // 粉丝牌名称
      { wch: 10 }, // 粉丝牌等级
      { wch: 8 }, // 荣耀等级
      { wch: 12 }, // 绑定状态
      { wch: 18 } // 最后修改时间
    ]

    // 应用列宽到所有sheet
    allSheet['!cols'] = colWidths
    boundSheet['!cols'] = colWidths
    unboundSheet['!cols'] = colWidths

    // 生成Excel文件
    const excelBuffer = XLSX.write(workbook, {
      type: 'buffer',
      bookType: 'xlsx',
      compression: true
    })

    this.logger.debug('群数据导出', 'Excel文件生成完成')
    return excelBuffer
  }

  /**
   * 导出群数据
   */
  async exportGroupData(session: Session, groupId: string): Promise<Buffer> {
    try {
      this.logger.info('群数据导出', `开始导出群 ${groupId} 的数据`)

      // 并行获取群成员和绑定信息
      const [members, bindings] = await Promise.all([
        this.getGroupMembers(session, groupId),
        this.getAllBindings()
      ])

      // 合并数据
      const mergedData = this.mergeData(members, bindings)

      // 生成Excel文件
      const excelBuffer = this.generateExcelFile(mergedData, groupId)

      this.logger.info(
        '群数据导出',
        `群 ${groupId} 数据导出完成，共 ${members.length} 个成员，其中 ${mergedData.filter(d => d.绑定状态 !== '未绑定').length} 个已绑定`
      )

      return excelBuffer
    } catch (error) {
      this.logger.error('群数据导出', '导出群数据失败', error)
      throw error
    }
  }

  /**
   * 获取导出文件名
   */
  getExportFileName(groupId: string): string {
    const now = new Date()
    const dateStr = now
      .toISOString()
      .slice(0, 19)
      .replace(/[:\-T]/g, '')
    return `群${groupId}_绑定数据_${dateStr}.xlsx`
  }

  /**
   * 保存Excel文件到临时目录并返回文件路径
   */
  async saveExcelFile(excelBuffer: Buffer, fileName: string): Promise<string> {
    try {
      // 创建临时目录
      const tempDir = path.join(process.cwd(), 'temp', 'exports')
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true })
      }

      // 生成文件路径
      const filePath = path.join(tempDir, fileName)

      // 写入文件
      fs.writeFileSync(filePath, excelBuffer)

      this.logger.debug('群数据导出', `Excel文件已保存到: ${filePath}`)
      return filePath
    } catch (error) {
      this.logger.error('群数据导出', `保存Excel文件失败: ${error.message}`)
      throw new Error(`保存文件失败: ${error.message}`)
    }
  }

  /**
   * 清理过期的临时文件（可选）
   */
  async cleanupOldFiles(maxAgeHours: number = 24): Promise<void> {
    try {
      const tempDir = path.join(process.cwd(), 'temp', 'exports')
      if (!fs.existsSync(tempDir)) return

      const files = fs.readdirSync(tempDir)
      const now = Date.now()
      const maxAge = maxAgeHours * 60 * 60 * 1000

      for (const file of files) {
        const filePath = path.join(tempDir, file)
        const stats = fs.statSync(filePath)

        if (now - stats.mtime.getTime() > maxAge) {
          fs.unlinkSync(filePath)
          this.logger.debug('群数据导出', `已清理过期文件: ${file}`)
        }
      }
    } catch (error) {
      this.logger.warn('群数据导出', `清理临时文件失败: ${error.message}`)
    }
  }
}
