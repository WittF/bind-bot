# koishi-plugin-mcid-bot 指令使用说明

## 普通用户命令
- `mcid bind <用户名>` 绑定Minecraft账号
- `mcid query` 查询自己绑定的Minecraft账号
- `mcid change <用户名>` 修改绑定的Minecraft账号
- `mcid unbind` 解绑Minecraft账号
- `mcid whitelist servers` 列出所有可用的Minecraft服务器
- `mcid whitelist add <服务器名称或ID>` 申请添加服务器白名单（需服务器允许自助申请）

## 管理员命令
- `mcid bind <用户名> [目标用户]` 为指定用户绑定Minecraft账号
- `mcid query [目标用户]` 查询指定用户绑定的Minecraft账号
- `mcid finduser <用户名>` 通过Minecraft用户名查询绑定的QQ账号
- `mcid change <用户名> [目标用户]` 修改指定用户绑定的Minecraft账号
- `mcid unbind [目标用户]` 为指定用户解绑Minecraft账号
- `mcid whitelist add <服务器名称或ID> [目标用户...]` 为指定用户添加服务器白名单（支持批量）
- `mcid whitelist add <服务器名称或ID> <标签名>` 为有指定标签的所有用户添加白名单
- `mcid whitelist remove <服务器名称或ID> [目标用户...]` 为指定用户移除服务器白名单（支持批量）
- `mcid whitelist remove <服务器名称或ID> <标签名>` 为有指定标签的所有用户移除白名单
- `mcid whitelist addall <服务器名称或ID>` 将所有已绑定MC账号的用户添加到指定服务器白名单
- `mcid tag add <标签名> <目标用户...>` 为用户添加标签（支持批量）
- `mcid tag remove <标签名> <目标用户...>` 移除用户标签（支持批量）
- `mcid tag list [目标用户]` 查看用户的所有标签或查看所有标签统计
- `mcid tag find <标签名>` 查找有指定标签的所有用户

## 主人命令
- `mcid admin <目标用户>` 将用户设为管理员
- `mcid unadmin <目标用户>` 撤销用户的管理员权限
- `mcid adminlist` 列出所有管理员
- `mcid whitelist reset <服务器名称或ID>` 重置指定服务器的所有白名单数据库记录

## 标签功能说明
标签功能允许管理员对用户进行分组管理，便于批量操作：
- 标签名称只能包含中文、字母、数字、下划线和连字符
- 标签功能仅限管理员使用
- 用户不需要绑定MC账号也可以拥有标签
- 在白名单命令中，当只有一个参数且不是QQ号格式时，会被识别为标签名

### 标签使用示例
```
# 为多个用户添加"VIP"标签
mcid tag add VIP @用户1 @用户2 @用户3

# 查看有"VIP"标签的所有用户
mcid tag find VIP

# 为所有有"VIP"标签的用户添加服务器白名单
mcid whitelist add 生存服 VIP

# 移除所有有"VIP"标签的用户的服务器白名单
mcid whitelist remove 生存服 VIP
```

## 配置项说明

| 配置项 | 类型 | 默认值 | 说明 |
|-------|-----|-------|------|
| cooldownDays | number | 15 | 修改绑定的冷却时间(天) |
| masterId | string | '' | 主人QQ号，拥有管理员管理权限 |
| allowTextPrefix | boolean | false | 是否允许通过文本前缀触发指令 |
| botNickname | string | '' | 机器人昵称，用于文本前缀匹配 |
| autoRecallTime | number | 0 | 消息自动撤回时间(秒)，同时控制机器人和用户消息，0表示不自动撤回 |
| recallUserMessage | boolean | false | 是否撤回用户发送的指令消息（仅群聊消息） |
| debugMode | boolean | false | 调试模式，启用详细日志输出 |
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

### v1.0.1 (最新)
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