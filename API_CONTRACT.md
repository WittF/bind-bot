# API 契约文档
 **BIND-BOT** - 账号绑定管理机器人 API 规范

---

## 目录

- [1. 外部 API 接口](#1-外部-api-接口)
  - [1.1 Mojang API](#11-mojang-api)
  - [1.2 ZMINFO API](#12-zminfo-api)
  - [1.3 Bilibili 官方 API](#13-bilibili-官方-api)
- [2. 内部服务层 API](#2-内部服务层-api)
  - [2.1 ApiService](#21-apiservice)
  - [2.2 DatabaseService](#22-databaseservice)
  - [2.3 NicknameService](#23-nicknameservice)
- [3. 数据模型](#3-数据模型)
  - [3.1 数据库表结构](#31-数据库表结构)
  - [3.2 类型定义](#32-类型定义)
- [4. 命令接口](#4-命令接口)
- [5. 错误处理](#5-错误处理)

---

## 1. 外部 API 接口

### 1.1 Mojang API

#### 验证用户名是否存在

**端点**: `GET https://api.mojang.com/users/profiles/minecraft/{username}`

**请求参数**:
- `username` (路径参数): Minecraft 用户名

**响应类型**: `MojangProfile | null`

```typescript
interface MojangProfile {
  id: string        // UUID (不带连字符)
  name: string      // 玩家名称 (标准大小写)
}
```

**成功响应示例**:
```json
{
  "id": "069a79f444e94726a5befca90e38aaf5",
  "name": "Notch"
}
```

**错误处理**:
- `404`: 用户名不存在
- `429`: 请求过于频繁（自动切换到备用 API）
- `403`: 被禁止访问（自动切换到备用 API）
- 网络错误: 自动尝试备用 API (playerdb.co)

**备用 API**: `GET https://playerdb.co/api/player/minecraft/{username}`

**超时设置**: 10 秒

---

#### 通过 UUID 查询用户名

**端点**: `GET https://api.mojang.com/user/profile/{uuid}`

**请求参数**:
- `uuid` (路径参数): Minecraft UUID (不带连字符)

**响应类型**: `string | null`

**成功响应示例**:
```json
{
  "id": "069a79f444e94726a5befca90e38aaf5",
  "name": "Notch"
}
```

**备用 API**: `GET https://playerdb.co/api/player/minecraft/{uuid}`

---

### 1.2 ZMINFO API

#### 获取用户信息

**端点**: `GET {zminfoApiUrl}/api/user/{uid}`

**请求参数**:
- `uid` (路径参数): B 站用户 UID

**响应类型**: `ZminfoApiResponse`

```typescript
interface ZminfoApiResponse {
  success: boolean
  message: string
  data?: {
    user?: ZminfoUser
  }
}

interface ZminfoUser {
  uid: string
  username: string
  avatar_url: string
  guard_level: number              // 当前舰长等级
  guard_level_text: string         // 当前舰长等级文本
  max_guard_level: number          // 历史最高舰长等级
  max_guard_level_text: string     // 历史最高舰长等级文本
  medal: {
    name: string
    level: number
    uid: string
    room: number
  } | null
  wealthMedalLevel: number         // 荣耀等级
  last_active_time: string
}
```

**成功响应示例**:
```json
{
  "success": true,
  "message": "success",
  "data": {
    "user": {
      "uid": "12345678",
      "username": "用户名",
      "avatar_url": "https://...",
      "guard_level": 3,
      "guard_level_text": "总督",
      "max_guard_level": 3,
      "max_guard_level_text": "总督",
      "medal": {
        "name": "粉丝牌",
        "level": 20,
        "uid": "87654321",
        "room": 123456
      },
      "wealthMedalLevel": 15,
      "last_active_time": "2025-10-23T12:00:00Z"
    }
  }
}
```

---

### 1.3 Bilibili 官方 API

#### 获取用户基本信息

**端点**: `GET https://api.bilibili.com/x/space/acc/info`

**请求参数**:
- `mid` (查询参数): B 站用户 UID

**请求头**:
```
User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36
Referer: https://space.bilibili.com/
Origin: https://space.bilibili.com
```

**响应类型**: `{ name: string; mid: number } | null`

**成功响应示例**:
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "mid": 12345678,
    "name": "用户名",
    "sex": "男",
    "face": "https://...",
    "sign": "个性签名"
  }
}
```

**错误代码**:
- `0`: 成功
- `404`: 用户不存在
- `-404`: 啥都木有

---

#### 获取粉丝勋章列表

**端点**: `GET https://api.live.bilibili.com/xlive/app-ucenter/v1/user/GetMyMedals`

**请求参数**:
- `page` (查询参数): 页码，默认 1
- `page_size` (查询参数): 每页数量，默认 50

**请求头**:
```
Cookie: SESSDATA={用户认证 Cookie}
User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36
Referer: https://live.bilibili.com/
Origin: https://live.bilibili.com
```

**响应类型**: `BilibiliMedalAPIResponse`

```typescript
interface BilibiliMedalAPIResponse {
  code: number
  message: string
  ttl: number
  data?: {
    list: MedalListItem[]
    count: number
    close_space_medal: number
    only_show_wearing: number
    name: string
    icon: string
    uid: number
    level: number
  }
}

interface MedalListItem {
  medal_info: MedalInfo
  target_name: string       // UP 主名称
  target_icon: string       // UP 主头像
  link: string              // 直播间链接
  live_status: number       // 直播状态
  official: number          // 是否官方认证
  uinfo_medal: UinfoMedal
}

interface MedalInfo {
  target_id: number         // UP 主 UID
  level: number             // 粉丝牌等级
  medal_name: string        // 粉丝牌名称
  medal_color_start: number
  medal_color_end: number
  medal_color_border: number
  guard_level: number       // 舰长等级 (0=无, 1=总督, 2=提督, 3=舰长)
  wearing_status: number    // 是否佩戴 (0=未佩戴, 1=已佩戴)
  medal_id: number
  intimacy: number          // 当前亲密度
  next_intimacy: number     // 下一级所需亲密度
  today_feed: number        // 今日亲密度
  day_limit: number         // 每日亲密度上限
  guard_icon: string
  honor_icon: string
}
```

---

## 2. 内部服务层 API

### 2.1 ApiService

位置: `src/services/api.service.ts`

#### 构造函数

```typescript
constructor(
  logger: LoggerService,
  config: { zminfoApiUrl: string }
)
```

#### 方法列表

##### validateUsername

验证 Minecraft 用户名是否存在

```typescript
async validateUsername(username: string): Promise<MojangProfile | null>
```

**参数**:
- `username`: MC 用户名

**返回**: `MojangProfile` 对象或 `null`

**特性**:
- 自动处理大小写规范化
- 失败时自动切换到备用 API
- 超时时间 10 秒

---

##### getUsernameByUuid

通过 UUID 查询当前用户名

```typescript
async getUsernameByUuid(uuid: string): Promise<string | null>
```

**参数**:
- `uuid`: MC UUID (支持带/不带连字符)

**返回**: 用户名或 `null`

**用途**: 检测玩家改名

---

##### getBilibiliOfficialUserInfo

通过 B 站官方 API 获取用户基本信息

```typescript
async getBilibiliOfficialUserInfo(uid: string): Promise<{ name: string; mid: number } | null>
```

**参数**:
- `uid`: B 站 UID

**返回**: 用户信息对象或 `null`

**数据权威性**: ⭐⭐⭐⭐⭐ (最权威)

---

##### validateBUID

验证 B 站 UID 是否存在 (通过 ZMINFO API)

```typescript
async validateBUID(buid: string): Promise<ZminfoUser | null>
```

**参数**:
- `buid`: B 站 UID

**返回**: `ZminfoUser` 对象或 `null`

**验证规则**:
- 必须为纯数字
- 调用 ZMINFO API 获取完整用户信息

---

##### getCrafatarUrl

获取 MC 头像 URL (使用 Crafatar 服务)

```typescript
getCrafatarUrl(uuid: string): string | null
```

**参数**:
- `uuid`: MC UUID

**返回**: 头像 URL 或 `null`

**URL 格式**: `https://crafatar.com/avatars/{uuid}`

---

##### getStarlightSkinUrl

获取 MC 皮肤渲染 URL (使用 Starlight Skins 服务)

```typescript
getStarlightSkinUrl(username: string): string | null
```

**参数**:
- `username`: MC 用户名

**返回**: 皮肤渲染 URL 或 `null`

**URL 格式**: `https://starlightskins.lunareclipse.studio/render/{pose}/{username}/full`

**可用姿势**: default, marching, walking, crouching, crossed, crisscross, cheering, relaxing, trudging, cowering, pointing, lunging, dungeons, facepalm, mojavatar, head

---

##### formatUuid

格式化 UUID (添加连字符)

```typescript
formatUuid(uuid: string): string
```

**参数**:
- `uuid`: 原始 UUID

**返回**: 格式化后的 UUID (带连字符)

**示例**:
```
输入: 069a79f444e94726a5befca90e38aaf5
输出: 069a79f4-44e9-4726-a5be-fca90e38aaf5
```

---

### 2.2 DatabaseService

位置: `src/services/database.service.ts`

#### 构造函数

```typescript
constructor(
  ctx: Context,
  logger: LoggerService,
  mcidbindRepo: MCIDBINDRepository,
  normalizeQQId: (userId: string) => string,
  getUsernameByUuid: (uuid: string) => Promise<string | null>
)
```

#### MC 绑定相关方法

##### getMcBindByQQId

根据 QQ 号查询 MC 绑定信息

```typescript
async getMcBindByQQId(qqId: string): Promise<MCIDBIND | null>
```

---

##### getMcBindByUsername

根据 MC 用户名查询绑定信息

```typescript
async getMcBindByUsername(mcUsername: string): Promise<MCIDBIND | null>
```

---

##### createOrUpdateMcBind

创建或更新 MC 绑定

```typescript
async createOrUpdateMcBind(
  userId: string,
  mcUsername: string,
  mcUuid: string,
  isAdmin?: boolean
): Promise<boolean>
```

**参数**:
- `userId`: 用户 ID (QQ 号)
- `mcUsername`: MC 用户名
- `mcUuid`: MC UUID
- `isAdmin`: 是否为管理员 (可选)

**返回**: 操作是否成功

**行为**:
- 已存在记录: 更新用户名和 UUID
- 不存在记录: 创建新绑定
- 保留管理员状态 (除非显式指定)

---

##### deleteMcBind

删除 MC 绑定 (同时解绑 MC 和 B 站账号)

```typescript
async deleteMcBind(userId: string): Promise<boolean>
```

**参数**:
- `userId`: 用户 ID (QQ 号)

**返回**: 操作是否成功

**副作用**: 删除整个绑定记录，包括 B 站账号信息

---

##### checkUsernameExists

检查 MC 用户名是否已被其他 QQ 号绑定

```typescript
async checkUsernameExists(
  username: string,
  currentUserId?: string,
  uuid?: string
): Promise<boolean>
```

**参数**:
- `username`: MC 用户名
- `currentUserId`: 当前用户 ID (可选)
- `uuid`: MC UUID (可选)

**返回**: 是否已被其他用户绑定

**特性**:
- 不区分大小写
- 支持改名检测 (通过 UUID 判断)
- 跳过临时用户名 (`_temp_*`)

---

#### BUID 绑定相关方法

##### getBuidBindByBuid

根据 B 站 UID 查询绑定信息

```typescript
async getBuidBindByBuid(buid: string): Promise<MCIDBIND | null>
```

---

##### checkBuidExists

检查 B 站 UID 是否已被绑定

```typescript
async checkBuidExists(buid: string, currentUserId?: string): Promise<boolean>
```

---

##### createOrUpdateBuidBind

创建或更新 B 站账号绑定

```typescript
async createOrUpdateBuidBind(userId: string, buidUser: ZminfoUser): Promise<boolean>
```

**参数**:
- `userId`: 用户 ID (QQ 号)
- `buidUser`: ZMINFO 用户信息

**返回**: 操作是否成功

**行为**:
- 已存在 MC 绑定: 在原记录上添加 B 站信息
- 不存在 MC 绑定: 创建新记录 (使用临时 MC 用户名)

**临时用户名格式**: `_temp_skip_{qqId}_{timestamp}`

---

##### updateBuidInfoOnly

仅更新 B 站信息 (不更新 lastModified 字段)

```typescript
async updateBuidInfoOnly(userId: string, buidUser: ZminfoUser): Promise<boolean>
```

**用途**: 查询时刷新 B 站数据，不影响绑定时间

---

#### 用户名更新检查

##### checkAndUpdateUsername

检查并更新用户名 (如果与当前数据库中的不同)

```typescript
async checkAndUpdateUsername(bind: MCIDBIND): Promise<MCIDBIND>
```

**参数**:
- `bind`: 绑定记录

**返回**: 更新后的绑定记录

**行为**:
- 通过 UUID 查询最新用户名
- 如果不同则更新数据库
- 不区分大小写比较

---

##### checkAndUpdateUsernameWithCache

智能缓存版本的改名检测

```typescript
async checkAndUpdateUsernameWithCache(bind: MCIDBIND): Promise<MCIDBIND>
```

**参数**:
- `bind`: 绑定记录

**返回**: 更新后的绑定记录

**缓存策略**:
- **24 小时冷却期** (普通情况)
- **72 小时冷却期** (连续失败 ≥3 次)
- 成功时重置失败计数
- 失败时递增失败计数

**数据库字段**:
- `usernameLastChecked`: 上次检查时间
- `usernameCheckFailCount`: 失败次数

---

### 2.3 NicknameService

位置: `src/services/nickname.service.ts`

#### 主要功能

- 自动设置群昵称 (B 站用户名 + MC 用户名)
- 智能判断是否需要更新 (避免误覆盖用户手动修改)
- 三层判断机制

#### 核心方法

##### setGroupNickname

设置群昵称

```typescript
async setGroupNickname(
  groupId: string,
  userId: string,
  nickname: string
): Promise<boolean>
```

**参数**:
- `groupId`: 群组 ID
- `userId`: 用户 ID
- `nickname`: 新昵称

**返回**: 操作是否成功

---

##### shouldUpdateNickname

智能判断是否需要更新群昵称

```typescript
shouldUpdateNickname(
  currentNickname: string,
  targetNickname: string,
  buidUsername: string
): boolean
```

**三层判断机制**:
1. 当前昵称为空或是 QQ 号 → 需要更新
2. 当前昵称包含目标 B 站用户名 → 不更新 (可能是用户手动设置)
3. 当前昵称与目标昵称不同 → 需要更新

---

## 3. 数据模型

### 3.1 数据库表结构

#### MCIDBIND 表

MC 和 B 站账号绑定主表

```typescript
interface MCIDBIND {
  // 主键
  qqId: string                    // 纯 QQ 号

  // MC 绑定字段
  mcUsername: string              // MC 用户名
  mcUuid: string                  // MC UUID
  usernameLastChecked?: Date      // MC 用户名上次检查时间
  usernameCheckFailCount?: number // 用户名检查失败次数
  lastModified: Date              // 上次修改时间
  isAdmin: boolean                // 是否为 MC 绑定管理员
  whitelist: string[]             // 已添加白名单的服务器 ID 列表
  tags: string[]                  // 用户标签列表

  // BUID 绑定字段
  buidUid: string                 // B 站 UID
  buidUsername: string            // B 站用户名
  guardLevel: number              // 当前舰长等级
  guardLevelText: string          // 当前舰长等级文本
  maxGuardLevel: number           // 历史最高舰长等级
  maxGuardLevelText: string       // 历史最高舰长等级文本
  medalName: string               // 粉丝牌名称
  medalLevel: number              // 粉丝牌等级
  wealthMedalLevel: number        // 荣耀等级
  lastActiveTime: Date            // 最后活跃时间
  reminderCount: number           // 随机提醒次数
}
```

**索引**:
- 主键: `qqId`
- 唯一索引: `mcUsername`
- 索引: `buidUid`

---

#### SCHEDULE_MUTE_TASKS 表

定时禁言任务配置表

```typescript
interface SCHEDULE_MUTE_TASKS {
  id: number          // 任务 ID (自增主键)
  groupId: string     // 群组 ID
  startTime: string   // 开始时间 (格式: HH:MM)
  endTime: string     // 结束时间 (格式: HH:MM)
  enabled: boolean    // 是否启用
  setterId: string    // 设置者 ID
}
```

---

### 3.2 类型定义

#### 更新数据类型

##### UpdateMcBindData

MC 绑定更新数据

```typescript
interface UpdateMcBindData {
  mcUsername?: string
  mcUuid?: string
  lastModified?: Date
  isAdmin?: boolean
  usernameLastChecked?: Date
  usernameCheckFailCount?: number
}
```

---

##### UpdateBuidBindData

BUID 绑定更新数据 (完整更新)

```typescript
interface UpdateBuidBindData {
  buidUid?: string
  buidUsername?: string
  guardLevel?: number
  guardLevelText?: string
  maxGuardLevel?: number
  maxGuardLevelText?: string
  medalName?: string
  medalLevel?: number
  wealthMedalLevel?: number
  lastActiveTime?: Date
  lastModified?: Date
}
```

---

##### UpdateBuidInfoData

BUID 信息更新数据 (仅更新信息，不更新 lastModified)

```typescript
interface UpdateBuidInfoData {
  buidUsername?: string
  guardLevel?: number
  guardLevelText?: string
  maxGuardLevel?: number
  maxGuardLevelText?: string
  medalName?: string
  medalLevel?: number
  wealthMedalLevel?: number
  lastActiveTime?: Date
}
```

---

##### CreateBindData

创建新绑定时的完整数据

```typescript
interface CreateBindData {
  qqId: string
  mcUsername: string
  mcUuid: string
  isAdmin: boolean
  whitelist: string[]
  tags: string[]
  [key: string]: any  // 允许额外的 BUID 字段
}
```

---

##### UpdateTagsData

标签更新数据

```typescript
interface UpdateTagsData {
  tags?: string[]
}
```

---

##### UpdateWhitelistData

白名单更新数据

```typescript
interface UpdateWhitelistData {
  whitelist?: string[]
}
```

---

## 4. 命令接口

### 命令列表

| 命令                    | 描述                     | 权限要求          |
| ----------------------- | ------------------------ | ----------------- |
| `mcid`                  | MC 账号绑定管理          | 所有用户          |
| `mcid.bind <username>`  | 绑定 MC 账号             | 所有用户          |
| `mcid.unbind`           | 解绑 MC 账号             | 所有用户          |
| `mcid.query [username]` | 查询绑定信息             | 所有用户          |
| `buid`                  | B 站 UID 绑定管理        | 所有用户          |
| `buid.bind <uid>`       | 绑定 B 站账号            | 所有用户          |
| `buid.unbind`           | 解绑 B 站账号            | 所有用户          |
| `buid.query [uid]`      | 查询 B 站绑定信息        | 所有用户          |
| `mcid.whitelist.*`      | 白名单管理命令组         | 根据配置          |
| `mcid.tag.*`            | 标签管理命令组           | MC 绑定管理员     |
| `mcid.admin.*`          | 管理员命令组             | MC 绑定管理员     |

---

### 命令详细说明

#### mcid.bind

绑定 Minecraft 账号

**语法**: `mcid.bind <username>`

**参数**:
- `username`: Minecraft 用户名

**流程**:
1. 验证用户名是否存在 (通过 Mojang API)
2. 检查用户名是否已被其他用户绑定
3. 创建或更新绑定记录
4. 返回绑定成功消息 (包含头像/皮肤)

**冷却时间**: 根据配置的 `cooldownDays`

---

#### buid.bind

绑定 B 站账号

**语法**: `buid.bind <uid>`

**参数**:
- `uid`: B 站 UID

**流程**:
1. 验证 UID 是否存在 (通过 ZMINFO API)
2. 检查 UID 是否已被其他用户绑定
3. 创建或更新绑定记录 (包含粉丝牌、舰长等级等信息)
4. 自动设置群昵称 (如果配置了 `autoNicknameGroupId`)

---

#### mcid.query

查询绑定信息

**语法**: `mcid.query [username]`

**参数**:
- `username`: MC 用户名 (可选)

**行为**:
- 不提供参数: 查询自己的绑定信息
- 提供参数: 查询指定用户名的绑定信息

**返回信息**:
- MC 用户名、UUID
- B 站用户名、UID
- 粉丝牌、舰长等级
- 白名单状态
- 标签列表

**副作用**:
- 自动检查并更新用户名 (如果玩家改名)
- 刷新 B 站信息 (如果已绑定 BUID)
- 自动设置群昵称

---

## 5. 错误处理

### 错误类型

#### 网络错误

- `ENOTFOUND`: DNS 解析失败
- `ETIMEDOUT`: 请求超时
- `ECONNRESET`: 连接重置
- `ECONNREFUSED`: 连接被拒绝
- `ECONNABORTED`: 连接中止

**处理策略**: 自动切换到备用 API

---

#### HTTP 错误

- `404`: 资源不存在
- `429`: 请求过于频繁
- `403`: 被禁止访问

**处理策略**:
- `404`: 返回 null 或提示用户
- `429/403`: 切换到备用 API

---

#### 业务错误

- 用户名已被绑定
- UID 已被绑定
- 绑定不存在
- 权限不足

**处理策略**: 返回友好的错误消息

---

### 错误工具函数

位置: `src/utils/error-utils.ts`

```typescript
// 获取友好的错误消息
function getFriendlyErrorMessage(error: any): string

// 获取面向用户的错误消息
function getUserFacingErrorMessage(error: any): string

// 判断是否为警告级别错误
function isWarningError(error: any): boolean

// 判断是否为严重错误
function isCriticalError(error: any): boolean
```

---

## 附录

### A. 配置接口

```typescript
interface Config {
  cooldownDays: number                    // 绑定冷却天数
  masterId: string                        // 主管理员 QQ 号
  servers: ServerConfig[]                 // 服务器列表
  allowTextPrefix: boolean                // 是否允许文本前缀
  botNickname: string                     // 机器人昵称
  autoRecallTime: number                  // 自动撤回时间 (秒)
  recallUserMessage: boolean              // 是否撤回用户消息
  debugMode: boolean                      // 调试模式
  showAvatar: boolean                     // 显示头像
  showMcSkin: boolean                     // 显示 MC 皮肤
  zminfoApiUrl: string                    // ZMINFO API 地址
  enableLotteryBroadcast: boolean         // 启用天选播报
  lotteryTargetGroupId: string            // 天选播报目标群 ID
  lotteryTargetPrivateId: string          // 天选播报私聊目标 ID
  autoNicknameGroupId: string             // 自动群昵称设置目标群
  forceBindSessdata: string               // 强制绑定 SESSDATA
  forceBindTargetUpUid: number            // 强制绑定目标 UP UID
  forceBindTargetRoomId: number           // 强制绑定目标房间号
  forceBindTargetMedalName: string        // 强制绑定目标粉丝牌名称
}

interface ServerConfig {
  id: string                              // 服务器 ID
  name: string                            // 服务器名称
  rconAddress: string                     // RCON 地址
  rconPassword: string                    // RCON 密码
  addCommand: string                      // 添加白名单命令模板
  removeCommand: string                   // 移除白名单命令模板
  idType: 'username' | 'uuid'             // ID 类型
  allowSelfApply: boolean                 // 允许自助申请
  acceptEmptyResponse?: boolean           // 接受空响应
  displayAddress?: string                 // 服务器展示地址
  description?: string                    // 服务器说明信息
  enabled?: boolean                       // 服务器启用状态
}
```

---

### B. 日志级别

位置: `src/utils/logger.ts`

```typescript
class LoggerService {
  debug(category: string, message: string): void
  info(category: string, message: string, isOperation?: boolean): void
  warn(category: string, message: string): void
  error(category: string, message: string): void
}
```

**文档结束**
