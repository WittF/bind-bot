# koishi-plugin-bind-mcid 指令使用说明

## 普通用户命令
- `mcid bind <用户名>` 绑定Minecraft账号
- `mcid query` 查询自己绑定的Minecraft账号
- `mcid change <用户名>` 修改绑定的Minecraft账号
- `mcid unbind` 解绑Minecraft账号
- `mcid whitelist servers` 列出所有可用的Minecraft服务器
- `mcid whitelist list` 列出自己已加入的白名单服务器
- `mcid whitelist add <服务器名称>` 申请添加服务器白名单（需服务器允许自助申请）

## 管理员命令
- `mcid bind <用户名> [目标用户]` 为指定用户绑定Minecraft账号
- `mcid query [目标用户]` 查询指定用户绑定的Minecraft账号
- `mcid change <用户名> [目标用户]` 修改指定用户绑定的Minecraft账号
- `mcid unbind [目标用户]` 为指定用户解绑Minecraft账号
- `mcid whitelist add <服务器名称> [目标用户]` 为指定用户添加服务器白名单
- `mcid whitelist remove <服务器名称> [目标用户]` 为指定用户移除服务器白名单

## 主人命令
- `mcid admin <目标用户>` 将用户设为管理员
- `mcid unadmin <目标用户>` 撤销用户的管理员权限
- `mcid adminlist` 列出所有管理员

## 版本历史

### v1.1.9 (最新)
- 服务器配置增强：新增服务器说明字段，在服务器地址下方显示
- API 验证优化：改进备用 API 集成，确保 UUID 处理一致性
- 白名单管理：内部添加自动重试机制，提高白名单操作成功率
- RCON 日志优化：统一日志格式，使用服务器名称而非 ID

### v1.1.8
- API 验证优化：增加 User-Agent，改进错误处理与自动切换
- 用户名同步：自动检测并更新改名玩家
- 皮肤渲染：升级至 Starlight SkinAPI，支持随机姿势
- 界面优化：使用圈数字序号，精简显示格式
- 稳定性：改进 RCON 日志与错误处理

### v1.1.7
- 添加白名单显示服务器连接地址功能
- 优化服务器列表显示，使用圈数字序号
- 添加启动时API状态验证

### v1.1.6
- 优化文本前缀触发功能，支持使用 `@机器人昵称 mcid命令` 格式直接触发命令
- 修复在QQ平台@消息识别问题，改进命令执行逻辑
- 提升文本前缀匹配的可靠性和响应速度

### v1.1.5
- 增加并发安全机制，防止同一用户同时执行多次白名单操作
- 优化RCON命令响应处理，提高成功率
- 支持识别各种格式的成功响应

### v1.1.4
- 添加数据库兼容和迁移功能
- 支持从旧版本平滑升级
- 修复白名单状态更新bug
