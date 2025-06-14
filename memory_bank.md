# koishi-plugin-mcid-bot 项目记忆库

## 项目概述
- **项目名称**: koishi-plugin-mcid-bot
- **当前版本**: 1.1.3
- **项目类型**: Koishi框架插件
- **核心功能**: Minecraft账号绑定机器人，支持QQ用户绑定和管理
- **技术栈**: TypeScript, Koishi Framework, axios, rcon-client

## 项目结构
```
├── src/
│   └── index.ts         # 主源码文件（5047行）
├── lib/                 # 编译输出目录
├── package.json         # 项目配置
├── tsconfig.json        # TypeScript配置
├── readme.md            # 使用说明文档
├── CHANGELOG.md         # 版本更新日志
├── API_DOCUMENTATION.md # API文档
└── BUID_USAGE.md        # B站UID使用说明
```

## 代码特点与规范
- **编码风格**: TypeScript，使用严格类型检查
- **数据库表**: MCIDBIND - 存储QQ号、MC账号、B站UID绑定信息
- **命令系统**: 基于Koishi命令系统，支持子命令
- **日志系统**: 完整的日志记录，支持调试模式
- **权限管理**: 三级权限（普通用户、管理员、主人）

## 重要依赖与配置
- **核心依赖**: koishi ^4.3.2, axios ^1.6.0, rcon-client ^4.2.3
- **数据库**: 使用Koishi内置数据库系统
- **RCON连接**: 支持多服务器RCON连接管理
- **API集成**: Mojang API（MC账号验证）、ZMINFO API（B站账号验证）

## 主要功能模块
1. **MC账号绑定管理**: bind, query, change, unbind, finduser
2. **B站UID绑定**: buid bind, buid query, buid finduser  
3. **白名单管理**: whitelist add/remove/addall/servers
4. **标签系统**: tag add/remove/list/find/deleteall
5. **权限管理**: admin/unadmin/adminlist（主人权限）
6. **RCON连接**: 自动管理多服务器RCON连接池
7. **天选播报**: 天选开奖结果自动播报功能并为已中奖用户添加TAG

## v1.1.3版本修复记录

### 已完成修复
1. ✅ **管理员命令支持QQ号**: `normalizeQQId`函数已完美支持多种格式
   - `<at id="123456"/>` 格式的@用户  
   - `onebot:123456` 等平台前缀格式
   - 纯QQ号 `123456`

2. ✅ **白名单命令标签优先逻辑**: 修复了标签识别问题
   - 修改位置: src/index.ts 第3517行和第3780行附近
   - **修复前**: 先调用`normalizeQQId`再判断数字，导致`@12345`被误判为QQ号
   - **修复后**: 优先检查数据库中是否存在该标签名，没有匹配标签再按QQ号处理
   - 影响命令: `mcid whitelist add/remove`

3. ✅ **版本更新**: 
   - package.json: 1.1.2 → 1.1.3
   - 更新koishi描述信息
   - readme.md: 添加v1.1.3版本说明和优化文档

### 技术细节
- **标签检查逻辑**: 通过查询数据库`ctx.database.get('mcidbind', {})`检查是否存在标签
- **兼容性**: 保持所有现有功能完全兼容
- **文档更新**: 明确标注支持QQ号和@用户两种格式

## 待处理任务
- [ ] 构建项目 (npm run build)
- [ ] 提交代码到git
- [ ] 发布到npm (npm publish)

## 更新日志
- **创建时间**: 当前会话开始
- **v1.1.3修复完成时间**: 当前会话
- **最后更新**: v1.1.3版本修复和文档更新完成 