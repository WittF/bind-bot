# koishi-plugin-mcid-bot 指令使用说明

## 普通用户命令

### Minecraft账号相关
- `绑定` 交互式绑定流程（引导式绑定MC账号和B站账号）
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

### 绑定流程管理
- `绑定 <目标用户>` 为指定用户启动交互式绑定流程（支持QQ号和@用户）

### Minecraft账号管理
- `mcid bind <用户名> [目标用户]` 为指定用户绑定Minecraft账号（支持QQ号和@用户）
- `mcid query [目标用户]` 查询指定用户绑定的Minecraft账号（支持QQ号和@用户）
- `mcid finduser <用户名>` 通过Minecraft用户名查询绑定的QQ账号
- `mcid change <用户名> [目标用户]` 修改指定用户绑定的Minecraft账号（支持QQ号和@用户）
- `mcid unbind [目标用户]` 为指定用户解绑Minecraft账号（支持QQ号和@用户）
- `mcid stats` 查看绑定信息统计

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
- `mcid tag rename <旧标签名> <新标签名>` 重命名标签（管理员权限）

## 主人命令

### 权限管理
- `mcid admin <目标用户>` 将用户设为管理员（支持QQ号和@用户）
- `mcid unadmin <目标用户>` 撤销用户的管理员权限（支持QQ号和@用户）
- `mcid adminlist` 列出所有管理员

### 系统管理
- `mcid whitelist reset <服务器ID>` 重置指定服务器的所有白名单数据库记录（可清理配置中已删除的服务器ID）
- `mcid whitelist resetall` 清理所有未在服务器配置列表中的白名单ID
- `mcid tag deleteall <标签名>` 删除所有用户的指定标签
- `mcid fixnicknames` 批量检查并修复所有用户的群昵称格式
- `mcid clearreminder [目标用户]` 清除用户的随机提醒冷却时间和提醒次数

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

## 随机提醒功能说明

### 功能特性
- **智能检测**：随机检测正在发言用户的绑定状态和群昵称格式
- **三种场景**：
  - 完全未绑定账号的用户：提醒绑定MC和B站账号
  - 仅绑定B站的用户：自动修复群昵称并提醒绑定MC账号
  - 群昵称格式错误的用户：自动修复为规范格式并提醒保持
- **触发概率**：普通用户3%，管理员1%，避免过度打扰
- **冷却机制**：24小时冷却期，同一用户不会重复收到提醒
- **提醒升级**：前三次显示为"提醒"，第四次及以后升级为"警告"
- **群昵称规范**：`B站名称（ID:MC用户名）` 或 `B站名称（ID:未绑定）`

### 管理员工具
- 使用 `mcid fixnicknames` 批量修复所有用户的群昵称
- 使用 `mcid clearreminder [目标用户]` 清除提醒冷却和次数

## 标签功能说明
标签功能允许管理员对用户进行分组管理，便于批量操作：
- 标签名称只能包含中文、字母、数字、下划线和连字符
- 标签功能仅限管理员使用
- 用户不需要绑定MC账号也可以拥有标签
- 在白名单命令中，优先检查标签名，如果存在该标签则按标签处理，否则按QQ号处理

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
| autoNicknameGroupId | string | '123456789' | 自动群昵称设置目标群ID，交互式绑定完成后自动设置群昵称 |
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

详细的版本更新记录请查看 [CHANGELOG.md](CHANGELOG.md) 文件。