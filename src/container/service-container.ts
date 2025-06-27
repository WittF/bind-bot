// 服务容器 - 依赖注入管理

import { Context, Logger } from 'koishi'
import { Config } from '../types'

// 服务接口定义
export interface IServiceContainer {
  // 基础服务
  context: Context
  config: Config
  logger: Logger
  
  // 获取服务实例
  get<T>(serviceName: string): T
  
  // 注册服务
  register<T>(serviceName: string, serviceInstance: T): void
  
  // 初始化所有服务
  initialize(): Promise<void>
  
  // 销毁所有服务
  dispose(): Promise<void>
}

export class ServiceContainer implements IServiceContainer {
  private services: Map<string, any> = new Map()
  private initialized: boolean = false
  
  constructor(
    public context: Context,
    public config: Config,
    public logger: Logger
  ) {}

  get<T>(serviceName: string): T {
    const service = this.services.get(serviceName)
    if (!service) {
      throw new Error(`Service '${serviceName}' not found`)
    }
    return service as T
  }

  register<T>(serviceName: string, serviceInstance: T): void {
    if (this.services.has(serviceName)) {
      throw new Error(`Service '${serviceName}' already registered`)
    }
    this.services.set(serviceName, serviceInstance)
    this.logger.debug(`[ServiceContainer] Registered service: ${serviceName}`)
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      throw new Error('ServiceContainer already initialized')
    }

    try {
      // 初始化服务顺序很重要，按依赖关系排序
      this.logger.info('[ServiceContainer] Initializing services...')
      
      // 这里将在后续阶段填充具体的服务初始化逻辑
      
      this.initialized = true
      this.logger.info('[ServiceContainer] All services initialized successfully')
    } catch (error) {
      this.logger.error(`[ServiceContainer] Service initialization failed: ${error.message}`)
      throw error
    }
  }

  async dispose(): Promise<void> {
    if (!this.initialized) {
      return
    }

    try {
      this.logger.info('[ServiceContainer] Disposing services...')
      
      // 按相反顺序销毁服务
      for (const [serviceName, service] of this.services.entries()) {
        try {
          if (service && typeof service.dispose === 'function') {
            await service.dispose()
            this.logger.debug(`[ServiceContainer] Disposed service: ${serviceName}`)
          }
        } catch (error) {
          this.logger.warn(`[ServiceContainer] Error disposing service ${serviceName}: ${error.message}`)
        }
      }
      
      this.services.clear()
      this.initialized = false
      this.logger.info('[ServiceContainer] All services disposed')
    } catch (error) {
      this.logger.error(`[ServiceContainer] Service disposal failed: ${error.message}`)
      throw error
    }
  }

  // 检查服务是否已注册
  has(serviceName: string): boolean {
    return this.services.has(serviceName)
  }

  // 获取所有已注册的服务名称
  getServiceNames(): string[] {
    return Array.from(this.services.keys())
  }

  // 获取服务状态
  getStatus(): { initialized: boolean; serviceCount: number; services: string[] } {
    return {
      initialized: this.initialized,
      serviceCount: this.services.size,
      services: this.getServiceNames()
    }
  }
} 