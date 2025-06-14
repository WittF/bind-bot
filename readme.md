# koishi-plugin-mcid-bot 指令使用说明

## 普通用户命令

### Minecraft账号相关
- `mcid bind <用户名>` 绑定Minecraft账号
- `mcid query` 查询自己绑定的Minecraft账号
- `mcid change <用户名>` 修改绑定的Minecraft账号
- `mcid unbind` 解绑Minecraft账号
- `mcid whitelist servers` 列出所有可用的Minecraft服务器
- `mcid whitelist add <服务器名称或ID>` 申请添加服务器白名单（需服务器允许自助申请）

### B站账号相关
- `buid bind <B站UID>` 绑定B站UID
- `buid query` 查询自己绑定的B站账号信息

## 管理员命令

### Minecraft账号管理
- `mcid bind <用户名> [目标用户]` 为指定用户绑定Minecraft账号（支持QQ号和@用户）
- `mcid query [目标用户]` 查询指定用户绑定的Minecraft账号（支持QQ号和@用户）
- `mcid finduser <用户名>` 通过Minecraft用户名查询绑定的QQ账号
- `mcid change <用户名> [目标用户]` 修改指定用户绑定的Minecraft账号（支持QQ号和@用户）
- `mcid unbind [目标用户]` 为指定用户解绑Minecraft账号（支持QQ号和@用户）

### B站账号管理
- `buid bind <B站UID> [目标用户]` 为指定用户绑定B站UID（支持QQ号和@用户）
- `buid query [目标用户]` 查询指定用户的B站账号信息（支持QQ号和@用户）
- `buid finduser <B站UID>` 通过B站UID查询绑定的QQ账号

### 白名单管理
- `mcid whitelist add <服务器名称或ID> [目标用户...]` 为指定用户添加服务器白名单（支持批量，支持QQ号和@用户）
- `mcid whitelist add <服务器名称或ID> <标签名>` 为有指定标签的所有用户添加白名单（优先检查标签名）
- `mcid whitelist remove <服务器名称或ID> [目标用户...]` 为指定用户移除服务器白名单（支持批量，支持QQ号和@用户）
- `mcid whitelist remove <服务器名称或ID> <标签名>` 为有指定标签的所有用户移除白名单（优先检查标签名）
- `mcid whitelist addall <服务器名称或ID>` 将所有已绑定MC账号的用户添加到指定服务器白名单

### 标签管理
- `mcid tag add <标签名> <目标用户...>` 为用户添加标签（支持批量，支持QQ号和@用户）
- `mcid tag remove <标签名> <目标用户...>` 移除用户标签（支持批量，支持QQ号和@用户）
- `mcid tag list [目标用户]` 查看用户的所有标签或查看所有标签统计（支持QQ号和@用户）
- `mcid tag find <标签名>` 查找有指定标签的所有用户

## 主人命令

### 权限管理
- `mcid admin <目标用户>` 将用户设为管理员（支持QQ号和@用户）
- `mcid unadmin <目标用户>` 撤销用户的管理员权限（支持QQ号和@用户）
- `mcid adminlist` 列出所有管理员

### 系统管理
- `mcid whitelist reset <服务器ID>` 重置指定服务器的所有白名单数据库记录（可清理配置中已删除的服务器ID）
- `mcid whitelist resetall` 清理所有未在服务器配置列表中的白名单ID
- `mcid tag deleteall <标签名>` 删除所有用户的指定标签

## B站UID绑定功能说明

### 功能特性
- **数据验证**：自动验证B站UID的有效性，通过ZMINFO API获取用户详细信息
- **信息展示**：显示B站用户名、舰长等级、粉丝牌信息、荣耀等级、最后活跃时间等
- **集成显示**：在使用 `mcid query` 查询MC账号时，同时显示B站相关信息
- **冷却时间**：B站UID绑定的冷却时间为MC账号绑定的3倍（默认45天）
- **唯一性保证**：每个B站UID只能被一个QQ号绑定，每个QQ号可同时绑定MC账号和B站UID

### 使用示例
```
# 绑定B站UID
buid bind 123456789

# 查询自己的B站信息
buid query

# 管理员为他人绑定B站UID（支持QQ号）
buid bind 123456789 123456
buid bind 123456789 @用户

# 管理员通过B站UID查找绑定的QQ号
buid finduser 123456789

# 查询MC账号信息（同时显示B站信息）
mcid query
```

## 标签功能说明
标签功能允许管理员对用户进行分组管理，便于批量操作：
- 标签名称只能包含中文、字母、数字、下划线和连字符
- 标签功能仅限管理员使用
- 用户不需要绑定MC账号也可以拥有标签
- **v1.1.3优化**：在白名单命令中，优先检查标签名，如果存在该标签则按标签处理，否则按QQ号处理

### 标签使用示例
```
# 为多个用户添加"VIP"标签（支持QQ号）
mcid tag add VIP 123456 234567 @用户3

# 查看有"VIP"标签的所有用户
mcid tag find VIP

# 为所有有"VIP"标签的用户添加服务器白名单（优先匹配标签名）
mcid whitelist add 生存服 VIP

# 如果没有"123456"这个标签，则按QQ号处理
mcid whitelist add 生存服 123456

# 移除所有有"VIP"标签的用户的服务器白名单
mcid whitelist remove 生存服 VIP
```

## 配置项说明

| 配置项 | 类型 | 默认值 | 说明 |
|-------|-----|-------|------|
| cooldownDays | number | 15 | 修改绑定的冷却时间(天)，B站UID绑定为此值的3倍 |
| masterId | string | '' | 主人QQ号，拥有管理员管理权限 |
| allowTextPrefix | boolean | false | 是否允许通过文本前缀触发指令 |
| botNickname | string | '' | 机器人昵称，用于文本前缀匹配 |
| autoRecallTime | number | 0 | 消息自动撤回时间(秒)，同时控制机器人和用户消息，0表示不自动撤回 |
| recallUserMessage | boolean | false | 是否撤回用户发送的指令消息（仅群聊消息） |
| debugMode | boolean | false | 调试模式，启用详细日志输出 |
| showAvatar | boolean | false | 是否显示头像图片（MC用头图，B站用头像） |
| showMcSkin | boolean | false | 是否使用MC皮肤渲染图（需要先开启showAvatar） |
| zminfoApiUrl | string | 'http://zminfo-api.wittf.ink' | ZMINFO API地址，用于获取B站用户信息 |
| servers | array | [] | Minecraft服务器配置列表 |

### 服务器配置项

| 配置项 | 类型 | 默认值 | 说明 |
|-------|-----|-------|------|
| id | string | (必填) | 服务器唯一ID |
| name | string | (必填) | 服务器名称 |
| enabled | boolean | true | 服务器是否启用，停用后不会显示在列表中 |
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

### v1.1.3 (最新)
- 🔧 **逻辑优化**：白名单命令标签处理逻辑优化
  - 修复 `mcid whitelist add/remove` 命令的标签识别问题
  - 现在优先检查是否存在指定标签名，如果存在则按标签处理，否则按QQ号处理
  - 避免了纯数字标签被误识别为QQ号的问题
- 📝 **文档更新**：完善管理员命令说明，明确支持QQ号和@用户两种格式

### v1.1.2
- 🐛 **修复**：B站账号查询时错误更新绑定时间的问题
- 🆕 **新增功能**：天选播报功能开关
- 🔧 **功能改进**：优化天选开奖结果处理逻辑

### v1.0.10
- 🔧 **配置优化**：图像显示配置重构
  - 将 `showBuidAvatar` 重命名为 `showAvatar`，作为图像显示总开关
  - `showMcSkin` 现在需要 `showAvatar` 开启后才能使用，控制MC是否使用皮肤渲染图
  - 简化MC头图API，直接使用 `https://crafatar.com/avatars/uuid`
- 🆕 **新增功能**：`buid query` 命令图像显示，根据配置显示B站头像
- 🔧 **智能图像显示逻辑**：
  - `showAvatar=false`：不显示任何图像
  - `showAvatar=true & showMcSkin=false`：MC显示头图，B站显示头像
  - `showAvatar=true & showMcSkin=true`：MC显示皮肤渲染图，B站显示头像

### v1.0.9
- 🐛 **修复**：B站绑定成功消息重复问题、Mojang API 403错误处理
- 🆕 **新增功能**：mcid query B站绑定提醒
- 📊 **新增命令**：`mcid stats` 管理员统计命令

### v1.0.4
- 🎨 **新增功能**：B站UID绑定功能
  - 支持绑定和查询B站账号信息
  - 集成ZMINFO API获取详细用户数据
  - B站UID绑定冷却时间为MC绑定的3倍
  - 在MC查询中同时显示B站信息
- 🔧 **功能改进**：头像显示优化
  - 配置项从 `showPlayerAvatar` 改为 `showAvatar`
  - 支持显示MC皮肤和B站头像
  - B站头像使用专用URL格式
- 📝 **术语优化**：将"BUID"改为用户友好的"B站UID"或"B站账号"

### v1.0.3
- 🎨 **新增功能**：可选玩家头像显示 - 在配置中控制是否显示Minecraft玩家皮肤图片
- 🔧 **改进功能**：reset命令现支持直接删除任意服务器ID，无需验证是否存在于配置中
- 🆕 **新增命令**：`mcid whitelist resetall` - 一键清理所有未在服务器配置列表中的无效白名单ID
- ⚡ **优化机制**：RCON执行改为真正的队列处理，按绑定时间优先（早绑定优先），避免并发冲突
- 🏷️ **新增命令**：`mcid tag deleteall <标签名>` - 主人权限，一键删除所有用户的指定标签
- 🛡️ **安全改进**：增强配置访问的防护性检查，提高代码稳定性

### v1.0.2
- 新增功能：支持解析 `<at id="..."/>` 格式的@用户字符串
- 改进用户ID处理：增强对不同@用户格式的兼容性
- 添加构建发布脚本：新增自动化构建和发布的bat脚本

### v1.0.1
- 修复Logger名称：将内部日志记录器名称从'bind-mcid'更新为'mcid-bot'
- 代码清理：确保所有内部引用都使用正确的项目名称

### v1.0.0
- 初始发布版本
- 支持Minecraft账号绑定和管理功能
- 支持多服务器白名单管理
- 支持用户标签系统，便于批量管理
- 支持批量白名单操作
- 支持管理员权限控制
- 支持RCON连接管理
- 支持消息自动撤回
- 支持文本前缀触发指令
- 完整的错误处理和日志系统