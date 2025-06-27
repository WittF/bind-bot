// 常量定义 - 从原 index.ts 提取

// 插件信息
export const PLUGIN_NAME = 'mcid-bot'
export const PLUGIN_INJECT = ['database', 'server']

// 时间常量
export const BINDING_SESSION_TIMEOUT = 3 * 60 * 1000 // 3分钟超时
export const CACHE_DURATION = 12 * 60 * 60 * 1000 // 12小时缓存有效期
export const REMINDER_COOLDOWN_TIME = 24 * 60 * 60 * 1000 // 24小时冷却

// RCON 相关常量
export const RCON_HEARTBEAT_INTERVAL = 5 * 60 * 1000 // 5分钟发送一次心跳
export const RCON_MAX_IDLE_TIME = 30 * 60 * 1000 // 连接空闲30分钟后关闭
export const RCON_MAX_CONNECTIONS = 20 // 最大同时连接数
export const RCON_HEARTBEAT_CMD = 'list' // 心跳命令

// 频率限制常量
export const RATE_LIMIT_REQUESTS = 10 // 请求限制数量
export const RATE_LIMIT_WINDOW = 3000 // 3秒时间窗口

// API 相关常量
export const MOJANG_API_BASE = 'https://api.mojang.com'
export const MOJANG_PROFILE_URL = '/users/profiles/minecraft'
export const MOJANG_UUID_URL = '/user/profile'
export const BACKUP_API_BASE = 'https://playerdb.co/api/player/minecraft'
export const CRAFATAR_BASE = 'https://crafatar.com/avatars'
export const STARLIGHT_SKIN_BASE = 'https://starlightskins.lunareclipse.studio/render'
export const BILIBILI_AVATAR_BASE = 'https://workers.vrp.moe/bilibili/avatar'

// 验证相关常量
export const MC_USERNAME_REGEX = /^[a-zA-Z0-9_]{3,16}$/
export const MC_USERNAME_MIN_LENGTH = 3
export const MC_USERNAME_MAX_LENGTH = 16
export const QQ_ID_REGEX = /^\d+$/
export const QQ_ID_MIN_LENGTH = 5
export const QQ_ID_MAX_LENGTH = 12
export const UUID_REGEX_WITH_DASH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const UUID_REGEX_WITHOUT_DASH = /^[0-9a-f]{32}$/i
export const BUID_REGEX = /^\d+$/
export const TAG_NAME_REGEX = /^[\u4e00-\u9fa5a-zA-Z0-9_-]+$/
export const TAG_NAME_MAX_LENGTH = 20
export const SERVER_ID_REGEX = /^[a-zA-Z0-9_-]+$/

// 皮肤渲染动作列表
export const STARLIGHT_POSES = [
  'default',    // 默认站立
  'marching',   // 行军
  'walking',    // 行走
  'crouching',  // 下蹲
  'crossed',    // 交叉手臂
  'crisscross', // 交叉腿
  'cheering',   // 欢呼
  'relaxing',   // 放松
  'trudging',   // 艰难行走
  'cowering',   // 退缩
  'pointing',   // 指向
  'lunging',    // 前冲
  'dungeons',   // 地下城风格
  'facepalm',   // 捂脸
  'mojavatar',  // Mojave姿态
  'head',       // 头部特写
]

// 圈数字映射（用于美化显示）
export const CIRCLED_NUMBERS = [
  '①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', 
  '⑪', '⑫', '⑬', '⑭', '⑮', '⑯', '⑰', '⑱', '⑲', '⑳'
]

// 聊天关键词（用于检测无关输入）
export const CHAT_KEYWORDS = [
  '你好', 'hello', 'hi', '在吗', '在不在', '怎么样', '什么', '为什么',
  '好的', '谢谢', '哈哈', '呵呵', '早上好', '晚上好', '晚安', '再见', 
  '拜拜', '666', '牛', '厉害', '真的吗', '不是吧', '哇', '哦', '嗯', 
  '好吧', '行', '可以', '没事', '没问题', '没关系'
]

// 服务名称常量（用于服务容器）
export const SERVICE_NAMES = {
  DATABASE: 'database',
  MOJANG: 'mojang',
  BUID: 'buid',
  RCON: 'rcon',
  MESSAGE: 'message',
  NICKNAME: 'nickname',
  VALIDATION: 'validation',
  ERROR: 'error'
} as const

// 错误类型常量
export const ERROR_TYPES = {
  VALIDATION: 'validation',
  NETWORK: 'network', 
  DATABASE: 'database',
  PERMISSION: 'permission',
  COOLDOWN: 'cooldown',
  NOT_FOUND: 'not_found'
} as const 