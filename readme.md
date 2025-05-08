# koishi-plugin-bind-mcid 指令使用说明

## 普通用户命令
- `mcid bind <用户名>` 绑定Minecraft账号
- `mcid query` 查询自己绑定的Minecraft账号
- `mcid change <用户名>` 修改绑定的Minecraft账号
- `mcid unbind` 解绑Minecraft账号
- `mcid whitelist servers` 列出所有可用的Minecraft服务器
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
- `mcid whitelist reset <服务器名称>` 重置指定服务器的所有白名单数据库记录

## 配置项说明

| 配置项 | 类型 | 默认值 | 说明 |
|-------|-----|-------|------|
| cooldownDays | number | 15 | 修改绑定的冷却时间(天) |
| masterId | string | '' | 主人QQ号，拥有管理员管理权限 |
| allowTextPrefix | boolean | false | 是否允许通过文本前缀触发指令 |
| botNickname | string | '' | 机器人昵称，用于文本前缀匹配 |
| autoRecallTime | number | 0 | 机器人消息自动撤回时间(秒)，0表示不自动撤回 |
| servers | array | [] | Minecraft服务器配置列表 |

### 服务器配置项

| 配置项 | 类型 | 默认值 | 说明 |
|-------|-----|-------|------|
| id | string | (必填) | 服务器唯一ID |
| name | string | (必填) | 服务器名称 |
| displayAddress | string | '' | 服务器展示地址 |
| description | string | '' | 服务器说明信息 |
| rconAddress | string | (必填) | RCON地址，格式为IP:端口 |
| rconPassword | string | '' | RCON密码 |
| addCommand | string | 'whitelist add ${MCID}' | 添加白名单命令模板 |
| removeCommand | string | 'whitelist remove ${MCID}' | 移除白名单命令模板 |
| idType | string | 'username' | 白名单添加时使用的ID类型(username或uuid) |
| allowSelfApply | boolean | false | 是否允许用户自行申请白名单 |
| acceptEmptyResponse | boolean | false | 是否将命令的空响应视为成功 |

## 版本历史

### v1.3.0 (最新)
- 添加消息自动撤回功能：新增`autoRecallTime`配置，可设置机器人消息自动撤回时间
- 添加主人专用重置命令：`mcid whitelist reset <服务器名称>`可清除所有用户的指定服务器白名单记录
- 优化@前缀匹配：修复了包含特殊字符的昵称无法正确匹配的问题
- 增强正则表达式安全性：对特殊字符进行转义，防止注入攻击
- 改进前缀匹配逻辑：同时支持带@和不带@的昵称格式，增强用户体验

### v1.2.0
- 文本前缀匹配优化：修复了前缀匹配逻辑，现在严格匹配配置中的完整机器人昵称
- 安全性增强：解决了可能导致非预期命令执行的问题
- 用户体验优化：改进了命令触发方式，与Koishi框架标准行为保持一致

### v1.1.9
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