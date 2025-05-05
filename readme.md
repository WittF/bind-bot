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
