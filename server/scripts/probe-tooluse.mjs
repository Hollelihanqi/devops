// 网关 tool_use 能力实测脚本。
// 用法：AI_KEY=<网关Key> node scripts/probe-tooluse.mjs [model]
// 作用：发一个带 tools 的最小请求，看模型是否回 tool_use 块。
import https from 'node:https'

const KEY = process.env.AI_KEY
const BASE = (process.env.AI_GATEWAY_URL || 'https://10.0.147.128:8080').replace(/\/$/, '')
const MODEL = process.argv[2] || 'deepseek-v4-pro'
if (!KEY) {
  console.error('缺少 AI_KEY 环境变量')
  process.exit(1)
}

const body = JSON.stringify({
  model: MODEL,
  max_tokens: 512,
  // 故意问一个必须调用工具才能答的问题，逼模型走 tool_use
  system: '你可以调用工具读取文件。需要文件内容时必须调用 read_file，不要凭空作答。',
  tools: [
    {
      name: 'read_file',
      description: '读取仓库中某个文件的全文内容',
      input_schema: {
        type: 'object',
        properties: { path: { type: 'string', description: '文件路径' } },
        required: ['path'],
      },
    },
  ],
  messages: [{ role: 'user', content: '请读取 README.md 并告诉我项目名称。' }],
})

const u = new URL(BASE + '/anthropic/v1/messages')
const req = https.request(
  {
    hostname: u.hostname,
    port: u.port,
    path: u.pathname,
    method: 'POST',
    rejectUnauthorized: false,
    headers: {
      Authorization: `Bearer ${KEY}`,
      'x-api-key': KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
  },
  (res) => {
    let data = ''
    res.on('data', (c) => (data += c))
    res.on('end', () => {
      console.log('HTTP', res.statusCode, '| model:', MODEL)
      let json
      try {
        json = JSON.parse(data)
      } catch {
        console.log('原始返回:', data.slice(0, 1500))
        return
      }
      const blocks = Array.isArray(json.content) ? json.content : []
      const types = blocks.map((b) => b.type)
      const hasToolUse = types.includes('tool_use')
      console.log('stop_reason:', json.stop_reason)
      console.log('content 块类型:', JSON.stringify(types))
      console.log(hasToolUse ? '✅ 网关支持 tool_use（走 Agent 工具循环）' : '❌ 未返回 tool_use（走放大预算方案）')
      if (json.error) console.log('error:', JSON.stringify(json.error))
      if (hasToolUse) console.log('tool_use 详情:', JSON.stringify(blocks.find((b) => b.type === 'tool_use')))
    })
  },
)
req.on('error', (e) => console.error('请求失败:', e.message))
req.write(body)
req.end()
