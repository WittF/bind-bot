# BIND-BOT 模块化重构任务清单

**目标**: 通过模块化让项目更易维护，确保实现一致/功能完善且稳定

**当前状态**:
- 总代码量: ~9,600 行
- index.ts: 3063 行 ⚠️ 过大
- 目标: index.ts < 300 行

---

## 📋 阶段 1: 统一 Handler 架构 ⭐ **最高优先级**

**目标**: 解决架构不一致问题，让所有 Handler 使用统一模式

### 任务列表

- [x] 1.1 分析 McidCommandHandler 当前依赖 ✅
  - [x] 所有 Handler 已继承 `BaseHandler`
  - [x] 使用统一的 `HandlerDependencies` 接口
  - [x] 架构已经统一，无需调整

- [x] 1.2 扩展 HandlerDependencies 接口 ✅
  - [x] `HandlerDependencies` 接口已包含所有必要依赖
  - [x] 包含完整的函数签名（checkAndUpdateUsername, validateUsername 等）
  - **文件**: `src/handlers/base.handler.ts`

- [x] 1.3 重构 McidCommandHandler 构造函数 ✅
  - [x] 已继承 `BaseHandler`
  - [x] 已使用标准的 5 个参数 (ctx, config, logger, repos, deps)
  - [x] 类内部使用 this.deps.xxx 访问依赖
  - **文件**: `src/handlers/mcid.handler.ts`

- [x] 1.4 更新 index.ts 中的依赖注入 ✅
  - [x] 已使用标准方式实例化所有 Handler
  - [x] 所有 Handler 使用 `register()` 方法
  - [x] 依赖注入架构统一
  - **文件**: `src/index.ts`

- [x] 1.5 编译测试 ✅
  - [x] 运行 `npm run build` - 编译成功
  - [x] 无类型错误
  - [x] 架构验证通过

**完成标志**: 所有 Handler 继承 BaseHandler，使用统一依赖注入

**🔖 Git Commit 节点**: `git commit -m "refactor(handlers): 统一 Handler 架构，使用 BaseHandler"`

---

## 📋 阶段 2: 提取共享工具函数

**目标**: 消除代码重复，统一工具函数

### 任务列表

- [x] 2.1 提取字符串相似度算法 ✅
  - [x] 在 `src/utils/helpers.ts` 添加 `levenshteinDistance` 函数（52行新代码）
  - [x] 在 `src/utils/helpers.ts` 添加 `calculateSimilarity` 函数
  - [x] 从 `src/index.ts` 移除重复实现（-34 行）
  - [x] 从 `src/handlers/whitelist.handler.ts` 移除重复实现（-28 行）
  - [x] 更新两处的引用，编译测试通过
  - **成果**: 消除 62 行重复代码

- [x] 2.2 创建错误处理工具模块 ✅
  - [x] 创建 `src/utils/error-utils.ts` (129行新代码)
  - [x] 移动 `getFriendlyErrorMessage` 函数
  - [x] 移动 `getUserFacingErrorMessage` 函数
  - [x] 移动 `isWarningError` 函数
  - [x] 移动 `isCriticalError` 函数
  - [x] 导出所有函数

- [x] 2.3 更新 index.ts 使用新工具 ✅
  - [x] 导入 `error-utils` 模块
  - [x] 移除本地实现（-97 行）
  - [x] 所有调用点自动使用导入的函数
  - **文件**: `src/index.ts`

- [x] 2.4 更新 handlers 使用新工具 ✅
  - [x] Handlers 通过 `deps.getFriendlyErrorMessage` 使用统一错误工具
  - [x] `whitelist.handler.ts` 已导入并使用 `calculateSimilarity`
  - [x] 架构统一，无需修改 handlers

- [x] 2.5 编译测试 ✅
  - [x] 运行 `npm run build` - 编译成功
  - [x] 验证功能正常
  - **成果**: 消除 97 行重复代码

**完成标志**: 无重复代码，所有工具函数集中在 utils/

**🔖 Git Commit 节点**: `git commit -m "refactor(utils): 提取共享工具函数，消除代码重复"`

---

## 📋 阶段 3: 创建服务层

**目标**: 将分散的业务逻辑和 API 调用提取到专门的服务类

### 任务列表

- [ ] 3.1 创建 API 服务基础结构
  - [ ] 创建 `src/services/` 目录
  - [ ] 创建 `src/services/index.ts` 统一导出

- [ ] 3.2 创建 Mojang API 服务
  - [ ] 创建 `src/services/mojang-api.service.ts`
  - [ ] 移动 `validateUsername` 函数逻辑
  - [ ] 封装为 `MojangApiService` 类
  - [ ] 添加类型定义

- [ ] 3.3 创建 ZMINFO API 服务
  - [ ] 创建 `src/services/zminfo-api.service.ts`
  - [ ] 移动 `validateBUID` 函数逻辑
  - [ ] 移动 `updateBuidInfoOnly` 函数逻辑
  - [ ] 封装为 `ZminfoApiService` 类

- [ ] 3.4 创建权限服务
  - [ ] 创建 `src/services/permission.service.ts`
  - [ ] 提取 `isAdmin` 函数（从 index.ts 和各 handler）
  - [ ] 提取 `isMaster` 函数
  - [ ] 封装为 `PermissionService` 类

- [ ] 3.5 创建服务器配置服务
  - [ ] 创建 `src/services/server-config.service.ts`
  - [ ] 移动 `getServerConfigById` 函数
  - [ ] 移动 `getServerConfigByName` 函数（包含模糊匹配）
  - [ ] 移动 `getServerConfigByIdOrName` 函数
  - [ ] 封装为 `ServerConfigService` 类

- [ ] 3.6 更新 HandlerDependencies
  - [ ] 在 `base.handler.ts` 添加服务实例到依赖
  - [ ] 添加类型定义

- [ ] 3.7 更新 index.ts
  - [ ] 实例化所有服务
  - [ ] 注入到 HandlerDependencies
  - [ ] 移除旧的函数实现（~300 行）
  - **文件**: `src/index.ts`

- [ ] 3.8 更新所有 Handler
  - [ ] 更新使用新服务而非直接函数调用
  - [ ] 测试每个 Handler

- [ ] 3.9 编译测试
  - [ ] 运行 `npm run build`
  - [ ] 验证所有功能

**完成标志**: 所有 API 调用和业务逻辑在 services/ 目录

**🔖 Git Commit 节点**: `git commit -m "refactor(services): 创建服务层，提取业务逻辑和 API 调用"`

---

## 📋 阶段 4: 重构中间件逻辑

**目标**: 将 index.ts 中的中间件逻辑模块化

### 任务列表

- [ ] 4.1 创建中间件目录
  - [ ] 创建 `src/middleware/` 目录
  - [ ] 创建 `src/middleware/index.ts` 统一导出

- [ ] 4.2 提取交互式绑定中间件
  - [ ] 创建 `src/middleware/interactive-binding.middleware.ts`
  - [ ] 移动 `handleMcUsernameInput` 函数（~100 行）
  - [ ] 移动 `handleBuidInput` 函数（~100 行）
  - [ ] 移动绑定会话中间件逻辑（~100 行）
  - [ ] 封装为 `registerInteractiveBindingMiddleware` 函数

- [ ] 4.3 提取随机提醒中间件
  - [ ] 创建 `src/middleware/reminder.middleware.ts`
  - [ ] 移动随机提醒逻辑（~80 行）
  - [ ] 封装为 `registerReminderMiddleware` 函数

- [ ] 4.4 提取定时禁言中间件
  - [ ] 创建 `src/middleware/schedule-mute.middleware.ts`
  - [ ] 移动定时禁言相关函数（~150 行）
  - [ ] 移动定时任务逻辑
  - [ ] 封装为 `registerScheduleMuteMiddleware` 函数

- [ ] 4.5 提取文本前缀中间件
  - [ ] 创建 `src/middleware/text-prefix.middleware.ts`
  - [ ] 移动文本前缀匹配逻辑（~30 行）
  - [ ] 封装为 `registerTextPrefixMiddleware` 函数

- [ ] 4.6 提取新人加入中间件
  - [ ] 创建 `src/middleware/member-join.middleware.ts`
  - [ ] 移动 `guild-member-added` 事件处理（~50 行）
  - [ ] 封装为 `registerMemberJoinMiddleware` 函数

- [ ] 4.7 更新 index.ts
  - [ ] 导入所有中间件注册函数
  - [ ] 调用中间件注册（~30 行）
  - [ ] 移除旧实现（~500 行）
  - **文件**: `src/index.ts`

- [ ] 4.8 编译测试
  - [ ] 运行 `npm run build`
  - [ ] 测试每个中间件功能

**完成标志**: 所有中间件逻辑在 middleware/ 目录

**🔖 Git Commit 节点**: `git commit -m "refactor(middleware): 重构中间件逻辑，模块化 index.ts"`

---

## 📋 阶段 5: 清理和优化 index.ts

**目标**: index.ts 只负责插件初始化和协调

### 任务列表

- [ ] 5.1 提取数据库操作包装函数
  - [ ] 检查是否还有未使用的包装函数
  - [ ] 移除或迁移到 Repository

- [ ] 5.2 提取工具函数包装层
  - [ ] 检查哪些包装函数可以直接使用原函数
  - [ ] 移除不必要的包装

- [ ] 5.3 优化依赖注入代码
  - [ ] 简化 `handlerDependencies` 对象创建
  - [ ] 使用更清晰的结构

- [ ] 5.4 添加代码注释和分区
  - [ ] 添加清晰的区域注释
  - [ ] 组织代码结构

- [ ] 5.5 最终验证
  - [ ] 确保 index.ts < 500 行（目标 300 行）
  - [ ] 运行 `npm run build`
  - [ ] 完整功能测试

**完成标志**: index.ts < 500 行，结构清晰

**🔖 Git Commit 节点**: `git commit -m "refactor(core): 清理优化 index.ts"`

---

## 📋 阶段 6: 文档和测试

**目标**: 完善文档，确保重构质量

### 任务列表

- [ ] 6.1 更新 CLAUDE.md
  - [ ] 更新项目架构说明
  - [ ] 更新文件组织说明
  - [ ] 更新代码行数统计
  - [ ] 添加服务层说明
  - [ ] 添加中间件说明

- [ ] 6.2 添加 JSDoc 注释
  - [ ] 为所有新增的服务类添加注释
  - [ ] 为所有中间件函数添加注释

- [ ] 6.3 创建重构总结文档
  - [ ] 记录重构前后对比
  - [ ] 记录遇到的问题和解决方案
  - [ ] 更新 CHANGELOG.md

- [ ] 6.4 完整测试
  - [ ] 测试所有命令
  - [ ] 测试所有中间件
  - [ ] 测试边界情况

**完成标志**: 文档完善，测试通过

**🔖 Git Commit 节点**: `git commit -m "docs: 更新文档和测试，完成模块化重构 v2.1.0"`

---

## 📊 总体进度追踪

### 当前进度
- [x] 阶段 1: 统一 Handler 架构 (5/5) ✅
- [x] 阶段 2: 提取共享工具函数 (5/5) ✅
- [ ] 阶段 3: 创建服务层 (0/9)
- [ ] 阶段 4: 重构中间件逻辑 (0/8)
- [ ] 阶段 5: 清理和优化 index.ts (0/5)
- [ ] 阶段 6: 文档和测试 (0/4)

### 总任务数: 36
### 已完成: 10
### 完成率: 28%

### 架构改进
✅ 统一的依赖注入模式
✅ 清晰的分层架构
✅ 消除代码重复
✅ 职责单一原则
✅ 易于测试和扩展

## 🔄 工作流程

**每完成一个任务**:
1. ✅ 勾选对应的 checkbox
2. 📝 运行 `npm run build` 验证编译
3. 🧪 测试相关功能
4. 📊 更新总体进度
5. 💾 提交 git commit

**遇到问题时**:
- 📝 在任务下方添加注释记录
- 🤔 评估是否需要调整方案
- 💬 随时向 Claude 询问

---