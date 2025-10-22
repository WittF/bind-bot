import axios from 'axios'
import { LoggerService } from '../utils/logger'
import type { MojangProfile, ZminfoUser } from '../types'

/**
 * API 服务层
 * 统一管理外部 API 调用（Mojang API、ZMINFO API 等）
 */
export class ApiService {
  constructor(
    private logger: LoggerService,
    private config: { zminfoApiUrl: string }
  ) {}

  // =========== Mojang API ===========

  /**
   * 验证 Minecraft 用户名是否存在
   * @param username MC 用户名
   * @returns Mojang Profile 或 null
   */
  async validateUsername(username: string): Promise<MojangProfile | null> {
    try {
      this.logger.debug('Mojang API', `开始验证用户名: ${username}`)
      const response = await axios.get(`https://api.mojang.com/users/profiles/minecraft/${username}`, {
        timeout: 10000, // 添加10秒超时
        headers: {
          'User-Agent': 'KoishiMCVerifier/1.0', // 添加User-Agent头
        }
      })

      if (response.status === 200 && response.data) {
        this.logger.debug('Mojang API', `用户名"${username}"验证成功，UUID: ${response.data.id}，标准名称: ${response.data.name}`)
        return {
          id: response.data.id,
          name: response.data.name // 使用Mojang返回的正确大小写
        }
      }

      return null
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        this.logger.warn('Mojang API', `用户名"${username}"不存在`)
      } else if (axios.isAxiosError(error) && error.code === 'ECONNABORTED') {
        this.logger.error('Mojang API', `验证用户名"${username}"时请求超时: ${error.message}`)
      } else {
        // 记录更详细的错误信息
        const errorMessage = axios.isAxiosError(error)
          ? `${error.message}，响应状态: ${error.response?.status || '未知'}\n响应数据: ${JSON.stringify(error.response?.data || '无数据')}`
          : error.message || '未知错误';
        this.logger.error('Mojang API', `验证用户名"${username}"时发生错误: ${errorMessage}`)

        // 如果是网络相关错误，尝试使用备用API检查
        if (axios.isAxiosError(error) && (
            error.code === 'ENOTFOUND' ||
            error.code === 'ETIMEDOUT' ||
            error.code === 'ECONNRESET' ||
            error.code === 'ECONNREFUSED' ||
            error.code === 'ECONNABORTED' ||
            error.response?.status === 429 || // 添加429 (Too Many Requests)
            error.response?.status === 403)) { // 添加403 (Forbidden)
          // 尝试使用playerdb.co作为备用API
          this.logger.info('Mojang API', `遇到错误(${error.code || error.response?.status})，将尝试使用备用API`)
          return this.tryBackupAPI(username);
        }
      }
      return null;
    }
  }

  /**
   * 使用备用 API 验证用户名
   * @param username MC 用户名
   * @returns Mojang Profile 或 null
   */
  private async tryBackupAPI(username: string): Promise<MojangProfile | null> {
    this.logger.info('备用API', `尝试使用备用API验证用户名"${username}"`)
    try {
      // 使用playerdb.co作为备用API
      const backupResponse = await axios.get(`https://playerdb.co/api/player/minecraft/${username}`, {
        timeout: 10000,
        headers: {
          'User-Agent': 'KoishiMCVerifier/1.0'
        }
      })

      if (backupResponse.status === 200 && backupResponse.data?.code === "player.found") {
        const playerData = backupResponse.data.data.player;
        const rawId = playerData.raw_id || playerData.id.replace(/-/g, ''); // 确保使用不带连字符的UUID
        this.logger.info('备用API', `用户名"${username}"验证成功，UUID: ${rawId}，标准名称: ${playerData.username}`)
        return {
          id: rawId, // 确保使用不带连字符的UUID
          name: playerData.username
        }
      }
      this.logger.warn('备用API', `用户名"${username}"验证失败: ${JSON.stringify(backupResponse.data)}`)
      return null;
    } catch (backupError) {
      const errorMsg = axios.isAxiosError(backupError)
        ? `${backupError.message}, 状态码: ${backupError.response?.status || '未知'}`
        : backupError.message || '未知错误';
      this.logger.error('备用API', `验证用户名"${username}"失败: ${errorMsg}`)
      return null;
    }
  }

  /**
   * 通过 UUID 查询用户名
   * @param uuid MC UUID
   * @returns 用户名或 null
   */
  async getUsernameByUuid(uuid: string): Promise<string | null> {
    try {
      // 确保UUID格式正确（去除连字符）
      const cleanUuid = uuid.replace(/-/g, '');

      this.logger.debug('Mojang API', `通过UUID "${cleanUuid}" 查询用户名`);
      const response = await axios.get(`https://api.mojang.com/user/profile/${cleanUuid}`, {
        timeout: 10000,
        headers: {
          'User-Agent': 'KoishiMCVerifier/1.0',
        }
      });

      if (response.status === 200 && response.data) {
        // 从返回数据中提取用户名
        const username = response.data.name;
        this.logger.debug('Mojang API', `UUID "${cleanUuid}" 当前用户名: ${username}`);
        return username;
      }

      this.logger.warn('Mojang API', `UUID "${cleanUuid}" 查询不到用户名`);
      return null;
    } catch (error) {
      // 如果是网络相关错误，尝试使用备用API
      if (axios.isAxiosError(error) && (
        error.code === 'ENOTFOUND' ||
        error.code === 'ETIMEDOUT' ||
        error.code === 'ECONNRESET' ||
        error.code === 'ECONNREFUSED' ||
        error.code === 'ECONNABORTED' ||
        error.response?.status === 429 || // 添加429 (Too Many Requests)
        error.response?.status === 403)) { // 添加403 (Forbidden)

        this.logger.info('Mojang API', `通过UUID查询用户名时遇到错误(${error.code || error.response?.status})，将尝试使用备用API`);
        return this.getUsernameByUuidBackupAPI(uuid);
      }

      const errorMessage = axios.isAxiosError(error)
        ? `${error.message}，响应状态: ${error.response?.status || '未知'}\n响应数据: ${JSON.stringify(error.response?.data || '无数据')}`
        : error.message || '未知错误';
      this.logger.error('Mojang API', `通过UUID "${uuid}" 查询用户名失败: ${errorMessage}`);
      return null;
    }
  }

  /**
   * 使用备用 API 通过 UUID 查询用户名
   * @param uuid MC UUID
   * @returns 用户名或 null
   */
  private async getUsernameByUuidBackupAPI(uuid: string): Promise<string | null> {
    try {
      // 确保UUID格式正确，备用API支持带连字符的UUID
      const formattedUuid = uuid.includes('-') ? uuid : this.formatUuid(uuid);

      this.logger.debug('备用API', `通过UUID "${formattedUuid}" 查询用户名`);
      const response = await axios.get(`https://playerdb.co/api/player/minecraft/${formattedUuid}`, {
        timeout: 10000,
        headers: {
          'User-Agent': 'KoishiMCVerifier/1.0',
        }
      });

      if (response.status === 200 && response.data?.code === "player.found") {
        const playerData = response.data.data.player;
        this.logger.debug('备用API', `UUID "${formattedUuid}" 当前用户名: ${playerData.username}`);
        return playerData.username;
      }

      this.logger.warn('备用API', `UUID "${formattedUuid}" 查询不到用户名: ${JSON.stringify(response.data)}`);
      return null;
    } catch (error) {
      const errorMessage = axios.isAxiosError(error)
        ? `${error.message}，响应状态: ${error.response?.status || '未知'}\n响应数据: ${JSON.stringify(error.response?.data || '无数据')}`
        : error.message || '未知错误';
      this.logger.error('备用API', `通过UUID "${uuid}" 查询用户名失败: ${errorMessage}`);
      return null;
    }
  }

  // =========== B站官方API ===========

  /**
   * 通过B站官方API获取用户基本信息（最权威的数据源）
   * @param uid B站UID
   * @returns 用户基本信息或null
   */
  async getBilibiliOfficialUserInfo(uid: string): Promise<{ name: string; mid: number } | null> {
    try {
      if (!uid || !/^\d+$/.test(uid)) {
        this.logger.warn('B站官方API', `无效的B站UID格式: ${uid}`)
        return null
      }

      this.logger.debug('B站官方API', `开始查询UID ${uid} 的官方信息`)

      const response = await axios.get(`https://api.bilibili.com/x/space/acc/info`, {
        params: { mid: uid },
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://space.bilibili.com/',
          'Origin': 'https://space.bilibili.com'
        }
      })

      if (response.data.code === 0 && response.data.data) {
        const userData = response.data.data
        this.logger.debug('B站官方API', `UID ${uid} 的官方用户名: "${userData.name}"`)

        return {
          name: userData.name,
          mid: userData.mid
        }
      } else {
        this.logger.warn('B站官方API', `UID ${uid} 查询失败: ${response.data.message || '未知错误'}`)
        return null
      }
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 404) {
          this.logger.warn('B站官方API', `UID ${uid} 不存在`)
          return null
        }
        this.logger.error('B站官方API', `查询UID ${uid} 时出错: ${error.message}`)
      } else {
        this.logger.error('B站官方API', `查询UID ${uid} 时出错: ${error.message}`)
      }
      return null
    }
  }

  // =========== ZMINFO API ===========

  /**
   * 验证 B 站 UID 是否存在
   * @param buid B站UID
   * @returns ZminfoUser 或 null
   */
  async validateBUID(buid: string): Promise<ZminfoUser | null> {
    try {
      if (!buid || !/^\d+$/.test(buid)) {
        this.logger.warn('B站账号验证', `无效的B站UID格式: ${buid}`)
        return null
      }

      this.logger.debug('B站账号验证', `验证B站UID: ${buid}`)

      const response = await axios.get(`${this.config.zminfoApiUrl}/api/user/${buid}`, {
        timeout: 10000,
        headers: {
          'User-Agent': 'Koishi-MCID-Bot/1.0'
        }
      })

      if (response.data.success && response.data.data && response.data.data.user) {
        const user = response.data.data.user
        this.logger.debug('B站账号验证', `B站UID ${buid} 验证成功: ${user.username}`)
        return user
      } else {
        this.logger.warn('B站账号验证', `B站UID ${buid} 不存在或API返回失败: ${response.data.message}`)
        return null
      }
    } catch (error) {
      if (error.response?.status === 404) {
        this.logger.warn('B站账号验证', `B站UID ${buid} 不存在`)
        return null
      }

      this.logger.error('B站账号验证', `验证B站UID ${buid} 时出错: ${error.message}`)
      throw new Error(`无法验证B站UID: ${error.message}`)
    }
  }

  // =========== 工具方法 ===========

  /**
   * 获取 MC 头图 URL (Crafatar)
   * @param uuid MC UUID
   * @returns 头图 URL 或 null
   */
  getCrafatarUrl(uuid: string): string | null {
    if (!uuid) return null

    // 检查UUID格式 (不带连字符应为32位，带连字符应为36位)
    const uuidRegex = /^[0-9a-f]{32}$|^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(uuid)) {
      this.logger.warn('MC头图', `UUID "${uuid}" 格式无效，无法生成头图URL`)
      return null
    }

    // 移除任何连字符，Crafatar接受不带连字符的UUID
    const cleanUuid = uuid.replace(/-/g, '')

    // 直接生成URL
    const url = `https://crafatar.com/avatars/${cleanUuid}`

    this.logger.debug('MC头图', `为UUID "${cleanUuid}" 生成头图URL`)
    return url
  }

  /**
   * 使用 Starlight SkinAPI 获取皮肤渲染
   * @param username MC 用户名
   * @returns 皮肤渲染 URL 或 null
   */
  getStarlightSkinUrl(username: string): string | null {
    if (!username) return null

    // 可用的动作列表 (共16种)
    const poses = [
      'default',    // 默认站立
      'marching',   // 行军
      'walking',    // 行走
      'crouching',  // 下蹲
      'crossed',    // 交叉手臂
      'crisscross', // 交叉腿
      'cheering',   // 欢呼
      'relaxing',   // 放松
      'trudging',   // 艰难行走
      'cowering',   // 退缩
      'pointing',   // 指向
      'lunging',    // 前冲
      'dungeons',   // 地下城风格
      'facepalm',   // 捂脸
      'mojavatar',  // Mojave姿态
      'head',   // 头部特写
    ]

    // 随机选择一个动作
    const randomPose = poses[Math.floor(Math.random() * poses.length)]

    // 视图类型（full为全身图）
    const viewType = 'full'

    // 生成URL
    const url = `https://starlightskins.lunareclipse.studio/render/${randomPose}/${username}/${viewType}`

    this.logger.debug('Starlight皮肤', `为用户名"${username}"生成动作"${randomPose}"的渲染URL`)
    return url
  }

  /**
   * 格式化 UUID (添加连字符，使其符合标准格式)
   * @param uuid 原始 UUID
   * @returns 格式化后的 UUID
   */
  formatUuid(uuid: string): string {
    if (!uuid) return '未知'
    if (uuid.includes('-')) return uuid // 已经是带连字符的格式

    // 确保UUID长度正确
    if (uuid.length !== 32) {
      this.logger.warn('UUID', `UUID "${uuid}" 长度异常，无法格式化`)
      return uuid
    }

    return `${uuid.substring(0, 8)}-${uuid.substring(8, 12)}-${uuid.substring(12, 16)}-${uuid.substring(16, 20)}-${uuid.substring(20)}`
  }
}
