// Mojang API服务 - 从原 index.ts 提取所有Mojang API操作逻辑

import { Logger } from 'koishi'
import axios from 'axios'
import { MojangProfile, Config } from '../types'
import { 
  MOJANG_API_BASE, 
  MOJANG_PROFILE_URL, 
  MOJANG_UUID_URL,
  BACKUP_API_BASE,
  UUID_REGEX_WITH_DASH,
  UUID_REGEX_WITHOUT_DASH
} from '../utils/constants'

export class MojangService {
  private logger: Logger

  constructor(
    private config: Config,
    logger: Logger
  ) {
    this.logger = logger.extend('MojangService')
  }

  // 使用Mojang API验证用户名并获取UUID - 从原代码提取
  async validateUsername(username: string): Promise<MojangProfile | null> {
    try {
      this.logger.debug(`开始验证用户名: ${username}`)
      const response = await axios.get(`${MOJANG_API_BASE}${MOJANG_PROFILE_URL}/${username}`, {
        timeout: 10000, // 添加10秒超时
        headers: {
          'User-Agent': 'KoishiMCVerifier/1.0', // 添加User-Agent头
        }
      })
      
      if (response.status === 200 && response.data) {
        this.logger.debug(`用户名"${username}"验证成功，UUID: ${response.data.id}，标准名称: ${response.data.name}`)
        return {
          id: response.data.id,
          name: response.data.name // 使用Mojang返回的正确大小写
        }
      }
     
      return null
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        this.logger.warn(`用户名"${username}"不存在`)
      } else if (axios.isAxiosError(error) && error.code === 'ECONNABORTED') {
        this.logger.error(`验证用户名"${username}"时请求超时: ${error.message}`)
      } else {
        // 记录更详细的错误信息
        const errorMessage = axios.isAxiosError(error) 
          ? `${error.message}，响应状态: ${error.response?.status || '未知'}\n响应数据: ${JSON.stringify(error.response?.data || '无数据')}`
          : error.message || '未知错误';
        this.logger.error(`验证用户名"${username}"时发生错误: ${errorMessage}`)
        
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
          this.logger.info(`遇到错误(${error.code || error.response?.status})，将尝试使用备用API`)
          return this.tryBackupAPI(username);
        }
      }
      return null;
    }
  }

  // 使用备用API验证用户名 - 从原代码提取
  private async tryBackupAPI(username: string): Promise<MojangProfile | null> {
    this.logger.info(`尝试使用备用API验证用户名"${username}"`)
    try {
      // 使用playerdb.co作为备用API
      const backupResponse = await axios.get(`${BACKUP_API_BASE}/${username}`, { 
        timeout: 10000,
        headers: {
          'User-Agent': 'KoishiMCVerifier/1.0'
        }
      })
      
      if (backupResponse.status === 200 && backupResponse.data?.code === "player.found") {
        const playerData = backupResponse.data.data.player;
        const rawId = playerData.raw_id || playerData.id.replace(/-/g, ''); // 确保使用不带连字符的UUID
        this.logger.info(`用户名"${username}"验证成功，UUID: ${rawId}，标准名称: ${playerData.username}`)
        return {
          id: rawId, // 确保使用不带连字符的UUID
          name: playerData.username
        }
      }
      this.logger.warn(`用户名"${username}"验证失败: ${JSON.stringify(backupResponse.data)}`)
      return null;
    } catch (backupError) {
      const errorMsg = axios.isAxiosError(backupError) 
        ? `${backupError.message}, 状态码: ${backupError.response?.status || '未知'}`
        : backupError.message || '未知错误';
      this.logger.error(`验证用户名"${username}"失败: ${errorMsg}`)
      return null;
    }
  }

  // 使用Mojang API通过UUID查询用户名 - 从原代码提取
  async getUsernameByUuid(uuid: string): Promise<string | null> {
    try {
      // 确保UUID格式正确（去除连字符）
      const cleanUuid = uuid.replace(/-/g, '');
      
      this.logger.debug(`通过UUID "${cleanUuid}" 查询用户名`);
      const response = await axios.get(`${MOJANG_API_BASE}${MOJANG_UUID_URL}/${cleanUuid}`, {
        timeout: 10000,
        headers: {
          'User-Agent': 'KoishiMCVerifier/1.0',
        }
      });
      
      if (response.status === 200 && response.data) {
        // 从返回数据中提取用户名
        const username = response.data.name;
        this.logger.debug(`UUID "${cleanUuid}" 当前用户名: ${username}`);
        return username;
      }
      
      this.logger.warn(`UUID "${cleanUuid}" 查询不到用户名`);
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
        
        this.logger.info(`通过UUID查询用户名时遇到错误(${error.code || error.response?.status})，将尝试使用备用API`);
        return this.getUsernameByUuidBackupAPI(uuid);
      }
      
      const errorMessage = axios.isAxiosError(error) 
        ? `${error.message}，响应状态: ${error.response?.status || '未知'}\n响应数据: ${JSON.stringify(error.response?.data || '无数据')}`
        : error.message || '未知错误';
      this.logger.error(`通过UUID "${uuid}" 查询用户名失败: ${errorMessage}`);
      return null;
    }
  }

  // 使用备用API通过UUID查询用户名 - 从原代码提取
  private async getUsernameByUuidBackupAPI(uuid: string): Promise<string | null> {
    try {
      // 确保UUID格式正确，备用API支持带连字符的UUID
      const formattedUuid = uuid.includes('-') ? uuid : this.formatUuid(uuid);
      
      this.logger.debug(`通过UUID "${formattedUuid}" 查询用户名`);
      const response = await axios.get(`${BACKUP_API_BASE}/${formattedUuid}`, {
        timeout: 10000,
        headers: {
          'User-Agent': 'KoishiMCVerifier/1.0',
        }
      });
      
      if (response.status === 200 && response.data?.code === "player.found") {
        const playerData = response.data.data.player;
        this.logger.debug(`UUID "${formattedUuid}" 当前用户名: ${playerData.username}`);
        return playerData.username;
      }
      
      this.logger.warn(`UUID "${formattedUuid}" 查询不到用户名: ${JSON.stringify(response.data)}`);
      return null;
    } catch (error) {
      const errorMessage = axios.isAxiosError(error) 
        ? `${error.message}，响应状态: ${error.response?.status || '未知'}\n响应数据: ${JSON.stringify(error.response?.data || '无数据')}`
        : error.message || '未知错误';
      this.logger.error(`通过UUID "${uuid}" 查询用户名失败: ${errorMessage}`);
      return null;
    }
  }

  // 格式化UUID (添加连字符，使其符合标准格式) - 从原代码提取
  formatUuid(uuid: string): string {
    if (!uuid) return '未知'
    if (uuid.includes('-')) return uuid // 已经是带连字符的格式
    
    // 确保UUID长度正确
    if (uuid.length !== 32) {
      this.logger.warn(`UUID "${uuid}" 长度异常，无法格式化`)
      return uuid
    }
    
    return `${uuid.substring(0, 8)}-${uuid.substring(8, 12)}-${uuid.substring(12, 16)}-${uuid.substring(16, 20)}-${uuid.substring(20)}`
  }

  // 验证UUID格式 - 新增辅助方法
  isValidUuid(uuid: string): boolean {
    if (!uuid) return false
    
    // 检查是否符合标准UUID格式（带或不带连字符）
    return UUID_REGEX_WITH_DASH.test(uuid) || UUID_REGEX_WITHOUT_DASH.test(uuid)
  }

  // 清理UUID（移除连字符） - 新增辅助方法
  cleanUuid(uuid: string): string {
    return uuid.replace(/-/g, '')
  }

  // 检查API连接状态 - 从原代码提取
  async checkApiStatus(): Promise<{ mojangApi: boolean; backupApi: boolean }> {
    const testUsername = 'Notch' // 使用一个确定存在的用户名进行测试
    
    this.logger.info('开始测试Mojang API和备用API连接状态')
    
    // 记录API测试的状态
    let mojangApiStatus = false
    let backupApiStatus = false
    
    // 测试Mojang API
    try {
      const startTime = Date.now()
      const response = await axios.get(`${MOJANG_API_BASE}${MOJANG_PROFILE_URL}/${testUsername}`, {
        timeout: 10000,
        headers: {
          'User-Agent': 'KoishiMCVerifier/1.0',
        }
      })
      
      const mojangTime = Date.now() - startTime
      
      if (response.status === 200 && response.data) {
        this.logger.info(`Mojang API连接正常 (${mojangTime}ms)，已验证用户: ${response.data.name}, UUID: ${response.data.id}`)
        mojangApiStatus = true
      } else {
        this.logger.warn(`Mojang API返回异常状态码: ${response.status}, 响应: ${JSON.stringify(response.data || '无数据')}`)
      }
    } catch (error) {
      const errorMessage = axios.isAxiosError(error) 
        ? `${error.message}，错误代码: ${error.code || '未知'}，响应状态: ${error.response?.status || '未知'}`
        : error.message || '未知错误'
      this.logger.error(`Mojang API连接失败: ${errorMessage}`)
    }
    
    // 测试备用API
    try {
      const startTime = Date.now()
      const response = await axios.get(`${BACKUP_API_BASE}/${testUsername}`, {
        timeout: 10000,
        headers: {
          'User-Agent': 'KoishiMCVerifier/1.0',
        }
      })
      
      const backupTime = Date.now() - startTime
      
      if (response.status === 200 && response.data?.code === "player.found") {
        const playerData = response.data.data.player;
        const rawId = playerData.raw_id || playerData.id.replace(/-/g, '');
        this.logger.info(`备用API连接正常 (${backupTime}ms)，已验证用户: ${playerData.username}, UUID: ${rawId}`)
        backupApiStatus = true
      } else {
        this.logger.warn(`备用API返回异常数据: 状态码: ${response.status}, 响应代码: ${response.data?.code || '未知'}`)
      }
    } catch (error) {
      const errorMessage = axios.isAxiosError(error) 
        ? `${error.message}，错误代码: ${error.code || '未知'}，响应状态: ${error.response?.status || '未知'}`
        : error.message || '未知错误'
      this.logger.error(`备用API连接失败: ${errorMessage}`)
    }
    
    // 总结API检查结果
    if (mojangApiStatus && backupApiStatus) {
      this.logger.info('所有API连接正常!')
    } else if (mojangApiStatus) {
      this.logger.warn('Mojang API连接正常，但备用API连接失败')
    } else if (backupApiStatus) {
      this.logger.warn('Mojang API连接失败，但备用API连接正常，将使用备用API')
    } else {
      this.logger.error('所有API连接均失败，验证功能可能无法正常工作!')
    }
    
    return {
      mojangApi: mojangApiStatus,
      backupApi: backupApiStatus
    }
  }

  // 检查并更新用户名（如果与当前数据库中的不同） - 从原代码提取相关逻辑
  async checkAndUpdateUsername(currentUsername: string, uuid: string): Promise<string | null> {
    try {
      if (!uuid) {
        this.logger.warn(`无法检查用户名更新: 空UUID`);
        return currentUsername;
      }
      
      // 通过UUID查询最新用户名
      const latestUsername = await this.getUsernameByUuid(uuid);
      
      if (!latestUsername) {
        this.logger.warn(`无法获取UUID "${uuid}" 的最新用户名`);
        return currentUsername;
      }
      
      // 如果用户名与数据库中的不同，返回新用户名
      if (latestUsername !== currentUsername) {
        this.logger.info(`用户的Minecraft用户名已变更: ${currentUsername} -> ${latestUsername}`);
        return latestUsername;
      }
      
      return currentUsername;
    } catch (error) {
      this.logger.error(`检查和更新用户名失败: ${error.message}`);
      return currentUsername;
    }
  }

  // 批量验证用户名 - 新增方法，用于批量操作
  async validateUsernames(usernames: string[]): Promise<Map<string, MojangProfile | null>> {
    const results = new Map<string, MojangProfile | null>();
    
    this.logger.info(`开始批量验证${usernames.length}个用户名`);
    
    for (const username of usernames) {
      try {
        const profile = await this.validateUsername(username);
        results.set(username, profile);
        
        // 添加适当的延迟，避免API限制
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (error) {
        this.logger.error(`批量验证用户名"${username}"失败: ${error.message}`);
        results.set(username, null);
      }
    }
    
    this.logger.info(`批量验证完成，成功验证${Array.from(results.values()).filter(Boolean).length}个用户名`);
    return results;
  }

  // 销毁服务
  async dispose(): Promise<void> {
    this.logger.info('MojangService 正在销毁')
    // Mojang服务通常不需要特殊的清理工作
  }
} 