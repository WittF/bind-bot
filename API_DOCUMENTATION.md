# ZMINFO API 文档

## 概览

ZMINFO 是一个专业的B站事件监听器，基于 LAPLACE Chat 标准设计。提供API接口用于查询收集到的用户数据和事件统计。

**服务地址**: `http://localhost:3001`  
**版本**: 1.1.0  
**最后更新**: 2025年6月 - 添加历史最高舰长等级字段，优化等级更新机制

## 认证

所有API接口均为公开接口，无需身份验证。

## 响应格式

所有API响应均采用统一的JSON格式：

```json
{
  "success": true,
  "message": "操作描述",
  "data": {}
}
```

## API 接口

### 1. 基础信息

#### `GET /`
获取服务基本信息

**响应**:
```json
{
  "success": true,
  "message": "ZMINFO - B站事件监听器",
  "version": "1.0.0",
  "server_time": "2024-01-01T12:00:00.000Z",
  "environment": "development",
  "features": {
    "event_listening": true,
    "user_info_collection": true,
    "api_queries": true,
    "activity_tracking": true
  },
  "api_docs": "/api",
  "health_check": "/api/health",
  "bridge_status": {
    "connected": true,
    "room_id": 544853
  }
}
```

#### `GET /api`
获取API接口列表

**响应**:
```json
{
  "success": true,
  "message": "ZMINFO-API 用户信息查询系统",
  "version": "1.0.0",
  "endpoints": {
    "user_info": "/api/user/:uid",
    "user_search": "/api/search",
    "user_stats": "/api/stats",
    "guard_users": "/api/guards",
    "active_users": "/api/active",
    "fans_medal": "/api/fans-medal",
    "user_activity": "/api/user/:uid/activity",
    "users_batch": "/api/users/batch",
    "lottery_events": "/api/lottery",
    "lottery_active": "/api/lottery/active",
    "lottery_finished": "/api/lottery/finished",
    "lottery_by_id": "/api/lottery/:lotteryId",
    "lottery_stats": "/api/lottery/stats",
    "bridge_status": "/api/bridge/status",
    "events_search": "/api/events/search",
    "events_stats": "/api/events/stats",
    "lottery_check": "/api/events/lottery/check",
    "health_check": "/api/health"
  },
  "description": "提供B站用户信息查询服务和事件日志分析"
}
```

### 2. 用户信息查询

#### 用户信息字段说明

用户信息对象包含以下字段：

- `uid`: 用户UID
- `username`: 用户昵称
- `avatar_url`: 头像URL（使用代理服务）
- `guard_level`: 当前舰长等级（0=无，1=总督，2=提督，3=舰长）
- `guard_level_text`: 当前舰长等级文本
- `max_guard_level`: **历史最高舰长等级**（0=白字，1=总督，2=提督，3=舰长）
- `max_guard_level_text`: **历史最高舰长等级文本**
- `medal`: 粉丝牌信息对象
  - `name`: 粉丝牌名称
  - `level`: 粉丝牌等级
  - `uid`: 粉丝牌主播UID
  - `room`: 粉丝牌房间号
- `wealthMedalLevel`: 荣耀等级（财富勋章等级）
- `last_active_time`: 最后活跃时间

**注意**：
- 粉丝牌等级和荣耀等级采用智能更新机制，只有在新等级大于现有等级时才更新，防止用户隐藏信息导致的数据回退
- `max_guard_level` 记录用户达到过的最高舰长等级，即使舰长过期也会保留历史记录

#### `GET /api/user/:uid`
根据UID查询用户详细信息

**参数**:
- `uid` (path): 用户UID，必须是数字

**响应**:
```json
{
  "success": true,
  "message": "查询成功",
  "data": {
    "user": {
      "uid": "123456789",
      "username": "用户昵称",
      "avatar_url": "https://workers.vrp.moe/bilibili/avatar/123456789",
      "guard_level": 3,
      "guard_level_text": "舰长",
      "max_guard_level": 1,
      "max_guard_level_text": "总督",
      "medal": {
        "name": "生态",
        "level": 27,
        "uid": "686127",
        "room": 544853
      },
      "wealthMedalLevel": 35,
      "last_active_time": "2024-01-01T12:00:00.000Z"
    }
  }
}
```

#### `GET /api/search`
搜索用户

**参数**:
- `q` (query): 搜索关键词（支持UID和用户名）
- `page` (query): 页码，默认1
- `limit` (query): 每页数量，默认20，最大100

**示例**: `/api/search?q=测试用户&page=1&limit=10`

**响应**:
```json
{
  "success": true,
  "message": "搜索完成",
  "data": {
    "users": [
      {
        "uid": "123456789",
        "username": "测试用户1",
        "avatar_url": "https://workers.vrp.moe/bilibili/avatar/123456789",
        "guard_level": 3,
        "guard_level_text": "舰长",
        "max_guard_level": 2,
        "max_guard_level_text": "提督",
        "medal": {
          "name": "生态",
          "level": 25,
          "uid": "686127",
          "room": 544853
        },
        "wealthMedalLevel": 30,
        "last_active_time": "2024-01-01T11:45:00.000Z"
      }
    ],
    "search": {
      "keyword": "测试用户",
      "page": 1,
      "limit": 10,
      "total": 1
    }
  }
}
```

#### `POST /api/users/batch`
批量查询用户信息

**请求体**:
```json
{
  "uids": ["123456789", "987654321", "456789123"]
}
```

**响应**:
```json
{
  "success": true,
  "message": "批量查询完成",
  "data": {
    "users": {
      "123456789": { /* 用户信息 */ },
      "987654321": null,
      "456789123": { /* 用户信息 */ }
    },
    "requested": 3,
    "found": 2
  }
}
```

### 3. 用户列表和统计

#### `GET /api/stats`
获取系统统计信息

**响应**:
```json
{
  "success": true,
  "message": "查询成功",
  "data": {
    "stats": {
      "total_users": 1500,
      "guard_users": 120,
      "guard_breakdown": {
        "governors": 2,
        "admirals": 8,
        "captains": 110
      },
      "fans_medal_users": 800,
      "avg_medal_level": "18.5",
      "max_medal_level": 45,
      "activity": {
        "active_24h": 320,
        "active_7d": 980
      }
    }
  }
}
```

#### `GET /api/guards`
获取舰长用户列表

**参数**:
- `guard_level` (query): 舰长等级筛选（1=总督，2=提督，3=舰长）
- `page` (query): 页码，默认1
- `limit` (query): 每页数量，默认20

**示例**: `/api/guards?guard_level=3&page=1&limit=20`

#### `GET /api/fans-medal`
获取高等级粉丝牌用户

**参数**:
- `min_level` (query): 最低粉丝牌等级，默认20
- `page` (query): 页码，默认1
- `limit` (query): 每页数量，默认20

**示例**: `/api/fans-medal?min_level=25&page=1&limit=10`

#### `GET /api/active`
获取活跃用户列表

**参数**:
- `hours` (query): 活跃时间范围（小时），默认24
- `page` (query): 页码，默认1
- `limit` (query): 每页数量，默认20

**示例**: `/api/active?hours=24&page=1&limit=20`

### 4. 用户活动

#### `GET /api/user/:uid/activity`
获取用户活动历史

**参数**:
- `uid` (path): 用户UID
- `limit` (query): 返回数量，默认50

**响应**:
```json
{
  "success": true,
  "message": "查询成功",
  "data": {
    "user": {
      "uid": "123456789",
      "username": "用户昵称"
    },
    "activities": [
      {
        "id": 1001,
        "activity_type": "message",
        "content": "用户发送的弹幕内容",
        "metadata": {
          "room_id": 544853,
          "message_type": "danmu"
        },
        "timestamp": "2024-01-01T12:00:00.000Z"
      },
      {
        "id": 1002,
        "activity_type": "gift",
        "content": "小心心 x3",
        "metadata": {
          "room_id": 544853,
          "gift_id": 30607,
          "gift_count": 3,
          "total_coin": 15000
        },
        "timestamp": "2024-01-01T11:45:00.000Z"
      }
    ]
  }
}
```

### 5. 系统管理

#### `GET /api/health`
健康检查

**响应**:
```json
{
  "success": true,
  "message": "ZMINFO API 服务正常",
  "timestamp": "2024-01-01T12:00:00.000Z",
  "uptime": 3600.5
}
```

#### `GET /bridge/status`
获取EventBridge状态

**响应**:
```json
{
  "success": true,
  "message": "EventBridge状态",
  "data": {
    "connected": true,
    "room_id": 544853,
    "ws_url": "ws://localhost:8080/",
    "stats": {
      "messagesReceived": 1250,
      "usersUpdated": 300,
      "uptime": 7200000,
      "lastMessageTime": "2024-01-01T12:00:00.000Z"
    }
  }
}
```

#### `POST /bridge/restart`
重启EventBridge

**响应**:
```json
{
  "success": true,
  "message": "EventBridge重启成功",
  "data": {
    "connected": true,
    "room_id": 544853
  }
}
```

## 6. 天选事件相关接口

### 6.1 获取所有天选事件

#### `GET /api/lottery`
获取天选事件列表，支持分页和状态过滤

**参数**:
- `page` (query): 页码，默认1
- `limit` (query): 每页数量，默认20，最大100
- `status` (query): 状态过滤 (0:未开始 1:进行中 2:已开奖 3:已取消)

**示例**: `/api/lottery?page=1&limit=20&status=2`

**响应**:
```json
{
  "success": true,
  "message": "查询成功",
  "data": {
    "events": [
      {
        "lottery_id": "lottery_123456",
        "room_id": 544853,
        "title": "天选B坷垃一袋",
        "award": {
          "name": "B坷垃一袋",
          "image": "https://example.com/award.jpg",
          "num": 1
        },
        "requirement": {
          "type": 1,
          "value": "关注主播",
          "text": "关注主播",
          "danmu": ""
        },
        "time": {
          "start_time": "2024-01-20T10:00:00.000Z",
          "end_time": "2024-01-20T10:10:00.000Z",
          "current_time": "2024-01-20T10:00:00.000Z",
          "remaining_seconds": 0
        },
        "status": {
          "code": 2,
          "text": "已开奖",
          "is_active": false,
          "is_finished": true
        },
        "winner": {
          "uid": "12345678",
          "username": "中奖用户",
          "avatar": "https://workers.vrp.moe/bilibili/avatar/12345678",
          "medal": {
            "name": "张三",
            "level": 18
          }
        },
        "metadata": {},
        "created_at": "2024-01-20T10:00:00.000Z",
        "updated_at": "2024-01-20T10:10:00.000Z"
      }
    ],
    "filter": {
      "page": 1,
      "limit": 20,
      "status": 2
    }
  }
}
```

### 6.2 获取进行中的天选事件

#### `GET /api/lottery/active`
获取当前正在进行的天选事件

**响应**:
```json
{
  "success": true,
  "message": "查询成功",
  "data": {
    "events": [
      {
        "lottery_id": "lottery_active_123",
        "room_id": 544853,
        "title": "天选谢谢惠顾",
        "award": {
          "name": "谢谢惠顾",
          "num": 2
        },
        "requirement": {
          "type": 0,
          "text": "无要求"
        },
        "status": {
          "code": 1,
          "text": "进行中",
          "is_active": true,
          "is_finished": false
        },
        "time": {
          "start_time": "2024-01-20T10:05:00.000Z",
          "end_time": "2024-01-20T10:15:00.000Z",
          "remaining_seconds": 420
        },
        "winner": null
      }
    ],
    "count": 1
  }
}
```

### 6.3 获取已开奖的天选事件

#### `GET /api/lottery/finished`
获取已经开奖的天选事件列表

**参数**:
- `page` (query): 页码，默认1
- `limit` (query): 每页数量，默认20，最大100

**示例**: `/api/lottery/finished?page=1&limit=10`

**响应**:
```json
{
  "success": true,
  "message": "查询成功",
  "data": {
    "events": [
      {
        "lottery_id": "lottery_finished_123",
        "room_id": 544853,
        "title": "天选礼品卡",
        "award": {
          "name": "京东卡50元",
          "num": 1
        },
        "status": {
          "code": 2,
          "text": "已开奖",
          "is_finished": true
        },
        "winner": {
          "uid": "87654321",
          "username": "幸运儿",
          "avatar": "https://workers.vrp.moe/bilibili/avatar/87654321",
          "medal": {
            "name": "张三",
            "level": 25
          }
        },
        "created_at": "2024-01-20T09:30:00.000Z",
        "updated_at": "2024-01-20T09:40:00.000Z"
      }
    ],
    "filter": {
      "page": 1,
      "limit": 10
    }
  }
}
```

### 6.4 根据天选ID查询事件

#### `GET /api/lottery/:lotteryId`
根据天选事件ID查询具体事件信息

**参数**:
- `lotteryId` (path): 天选事件ID

**示例**: `/api/lottery/lottery_123456`

**响应**:
```json
{
  "success": true,
  "message": "查询成功",
  "data": {
    "event": {
      "lottery_id": "lottery_123456",
      "room_id": 544853,
      "title": "天选B坷垃一袋",
      "award": {
        "name": "B坷垃一袋",
        "image": "https://example.com/award.jpg",
        "num": 1
      },
      "requirement": {
        "type": 1,
        "value": "关注主播",
        "text": "关注主播",
        "danmu": ""
      },
      "time": {
        "start_time": "2024-01-20T10:00:00.000Z",
        "end_time": "2024-01-20T10:10:00.000Z",
        "remaining_seconds": 0
      },
      "status": {
        "code": 2,
        "text": "已开奖",
        "is_finished": true
      },
      "winner": {
        "uid": "12345678",
        "username": "中奖用户",
        "avatar": "https://workers.vrp.moe/bilibili/avatar/12345678",
        "medal": {
          "name": "张三",
          "level": 18
        }
      },
      "metadata": {
        "lottery_start_event": {
          "duration": 600,
          "giftName": "小心心",
          "giftPrice": 5000
        }
      }
    }
  }
}
```

### 6.5 获取天选事件统计信息

#### `GET /api/lottery/stats`
获取天选事件的统计信息

**响应**:
```json
{
  "success": true,
  "message": "查询成功",
  "data": {
    "stats": {
      "total_events": 156,
      "active_events": 2,
      "finished_events": 145,
      "pending_events": 9,
      "events_with_winners": 140,
      "avg_duration_minutes": "8.5"
    }
  }
}
```

## 错误响应

### 错误格式

```json
{
  "success": false,
  "message": "错误描述",
  "error_type": "error_code"
}
```

### 常见错误码

| 状态码 | 错误类型 | 说明 |
|--------|----------|------|
| 400 | Bad Request | 参数错误、格式错误 |
| 404 | Not Found | 用户不存在、接口不存在 |
| 429 | Too Many Requests | 请求过于频繁 |
| 500 | Internal Server Error | 服务器内部错误 |

### 错误示例

**用户不存在**:
```json
{
  "success": false,
  "message": "用户不存在",
  "data": {
    "uid": "999999999",
    "exists": false
  }
}
```

**参数错误**:
```json
{
  "success": false,
  "message": "UID格式错误，必须是数字"
}
```

**频率限制**:
```json
{
  "success": false,
  "message": "请求过于频繁，请稍后再试",
  "error_type": "rate_limit_exceeded"
}
```

## 使用示例

### JavaScript (fetch)

```javascript
// 查询用户信息
const response = await fetch('http://localhost:3001/api/user/123456789');
const data = await response.json();

if (data.success) {
  console.log('用户信息:', data.data.user);
} else {
  console.error('查询失败:', data.message);
}

// 搜索用户
const searchResponse = await fetch('http://localhost:3001/api/search?q=测试&limit=10');
const searchData = await searchResponse.json();

// 批量查询
const batchResponse = await fetch('http://localhost:3001/api/users/batch', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ uids: ['123456789', '987654321'] })
});
```

### Python (requests)

```python
import requests

# 查询用户信息
response = requests.get('http://localhost:3001/api/user/123456789')
data = response.json()

if data['success']:
    user = data['data']['user']
    print(f"用户: {user['username']} (UID: {user['uid']})")
    print(f"舰长等级: {user['guard_level_text']}")
    print(f"最后活跃: {user['last_active_time']}")
else:
    print(f"查询失败: {data['message']}")

# 获取统计信息
stats_response = requests.get('http://localhost:3001/api/stats')
stats = stats_response.json()['data']['stats']
print(f"总用户数: {stats['total_users']}")
```

### cURL

```bash
# 查询用户信息
curl "http://localhost:3001/api/user/123456789"

# 搜索用户
curl "http://localhost:3001/api/search?q=测试用户&limit=5"

# 获取舰长列表
curl "http://localhost:3001/api/guards?guard_level=3"

# 批量查询
curl -X POST "http://localhost:3001/api/users/batch" \
  -H "Content-Type: application/json" \
  -d '{"uids": ["123456789", "987654321"]}'
```

## 更新日志

### v1.1.0 (2024年6月)

**新增功能**:
- ✅ 添加 `max_guard_level` 字段 - 记录用户历史最高舰长等级
- ✅ 添加 `max_guard_level_text` 字段 - 历史最高舰长等级的文本描述
- ✅ 智能等级更新机制 - 粉丝牌等级和荣耀等级只有在新值更大时才更新
- ✅ 数据保护机制 - 防止用户隐藏信息导致的等级数据回退

**API变更**:
- 所有返回用户信息的接口都新增了 `max_guard_level` 和 `max_guard_level_text` 字段
- 用户信息更新逻辑优化，确保等级数据的准确性和持久性

**舰长等级说明**:
- 0: 白字（普通用户）
- 1: 总督（最高等级）
- 2: 提督（中等级）  
- 3: 舰长（基础等级）
- 数值越小代表等级越高

**向后兼容性**:
- 所有现有API接口保持兼容
- 新字段为新增字段，不影响现有客户端使用

### v1.0.0 (2025年5月)

**初始版本**:
- 基础用户信息查询API
- 用户搜索和筛选功能
- 天选事件监听和查询
- 用户活动记录和统计
- 系统状态监控接口

---

*本文档由 ZMINFO 项目自动生成和维护*