# BUID 绑定功能使用说明

## 概述

BUID绑定功能允许用户将自己的QQ号与B站UID进行绑定，支持查询B站用户信息，包括舰长等级、粉丝牌等级、荣耀等级等。

## 配置

在插件配置中添加ZMINFO API地址：

```yaml
zminfoApiUrl: "http://zminfo-api.wittf.ink"
```

## 可用指令

### 1. 绑定BUID
```
buid bind <UID>
```
- 绑定自己的B站UID
- 示例：`buid bind 123456789`

### 2. 查询BUID信息
```
buid query [target:user]
```
- 查询自己或指定用户的BUID信息
- 示例：
  - `buid query` - 查询自己
  - `buid query @用户` - 查询指定用户

### 3. 管理员功能

#### 为他人绑定BUID（仅管理员）
```
buid bind <UID> [target:user]
```
- 示例：`buid bind 123456789 @用户`

#### 反向查询（仅管理员）
```
buid finduser <UID>
```
- 通过B站UID查询绑定的QQ号
- 示例：`buid finduser 123456789`

## 功能特性

### 1. 数据验证
- 自动验证B站UID的有效性
- 通过ZMINFO API获取用户详细信息

### 2. 信息展示
绑定成功后显示的信息包括：
- B站用户名
- 舰长等级（如果有）
- 粉丝牌信息（名称和等级）
- 荣耀等级
- 最后活跃时间

### 3. 集成显示
在使用 `mcid query` 查询MC账号信息时，如果用户已绑定BUID，会同时显示B站相关信息。

### 4. 冷却时间
- 普通用户修改绑定有冷却时间限制（默认15天）
- 管理员可以随时修改绑定
- 首次绑定无冷却时间限制

### 5. 唯一性保证
- 每个B站UID只能被一个QQ号绑定
- 每个QQ号可以同时绑定MC账号和B站UID

## 使用示例

### 用户绑定流程：
1. `buid bind 123456789` - 绑定B站UID
2. `buid query` - 查看绑定信息
3. `mcid query` - 查看MC账号信息（同时显示BUID信息）

### 管理员操作：
1. `buid bind 123456789 @用户` - 为用户绑定BUID
2. `buid finduser 123456789` - 通过UID查找绑定的QQ号

## 注意事项

1. B站UID必须是纯数字格式
2. 绑定的B站用户必须在ZMINFO数据库中存在
3. 如果ZMINFO API无法访问，绑定操作将失败
4. 管理员权限基于现有的MCID管理员系统 