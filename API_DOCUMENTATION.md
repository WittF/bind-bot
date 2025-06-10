# ZMINFO API 文档

## 概览

ZMINFO 是一个专业的B站事件监听器，基于 LAPLACE Chat 标准设计。提供API接口用于查询收集到的用户数据和事件统计。

**服务地址**: `http://zminfo-api.wittf.ink`  
**版本**: 1.0.0

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
  "message": "ZMINFO-API 事件监听器数据查询接口",
  "version": "1.0.0",
  "endpoints": {
    "user_info": "/api/user/:uid",
    "user_search": "/api/search",
    "user_stats": "/api/stats",
    "guard_users": "/api/guards",
    "active_users": "/api/active",
    "fans_medal": "/api/fans-medal"
  }
}
```

### 2. 用户信息查询

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

## 注意事项

1. **频率限制**: API限制每分钟100次请求
2. **数据实时性**: 用户信息通过EventBridge实时更新
3. **缓存策略**: 建议客户端适当缓存查询结果
4. **UID格式**: 所有UID必须是数字字符串
5. **分页限制**: 单次查询最多返回100条记录
6. **数据格式**: 响应数据符合 LAPLACE Chat 标准格式
7. **字段变更**: `fans_medal` 已更名为 `medal`，`wealth_medal_level` 已更名为 `wealthMedalLevel`
