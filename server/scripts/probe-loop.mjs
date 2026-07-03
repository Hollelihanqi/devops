// 完整工具循环实测：验证「回灌 assistant 内容块 + tool_result」直到模型给出最终答案。
// 用 read_file 返回假内容，确认协议跑通、循环收敛。
// 用法：AI_KEY=<key> node scripts/probe-loop.mjs [model]
import https from 'node:https'

const KEY = process.env.AI_KEY
const BASE = (process.env.AI_GATEWAY_URL || 'https://10.0.147.128:8080').replace(/\/$/, '')
const MODEL = process.argv[2] || 'deepseek-v4-pro'
if (!KEY) { console.error('缺少 AI_KEY'); process.exit(1) }

const FAKE_FILES = {
  'README.md': '# Demo 项目\n这是一个基于 NestJS 的内部部署中心。入口见 src/main.ts。',
  'src/main.ts': "import { NestFactory } from '@nestjs/core'\nbootstrap() // 监听 3000 端口",
}
const tools = [{
  name: 'read_file',
  description: '读取仓库文件全文',
  input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
}]

function post(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload)
    const u = new URL(BASE + '/anthropic/v1/messages')
    const req = https.request(
      { hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST', rejectUnauthorized: false,
        headers: { Authorization: `Bearer ${KEY}`, 'x-api-key': KEY, 'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => { try { resolve(JSON.parse(d)) } catch { reject(new Error(d.slice(0, 300))) } }) },
    )
    req.on('error', reject); req.write(body); req.end()
  })
}

const messages = [{ role: 'user', content: '读取必要文件后，告诉我这个项目是什么框架、监听哪个端口。' }]
const system = '你可以调用 read_file 读取文件，需要时必须调用，读够后再作答。'
let toolCalls = 0
for (let i = 0; i < 10; i++) {
  const data = await post({ model: MODEL, max_tokens: 1024, system, tools, messages })
  if (data.error) { console.log('❌ error:', JSON.stringify(data.error)); process.exit(1) }
  const blocks = data.content ?? []
  messages.push({ role: 'assistant', content: blocks })
  if (data.stop_reason !== 'tool_use') {
    const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('')
    console.log(`\n✅ 循环收敛（${i + 1} 轮，工具调用 ${toolCalls} 次）`)
    console.log('最终回答:', text.slice(0, 400))
    process.exit(0)
  }
  const results = []
  for (const b of blocks.filter((x) => x.type === 'tool_use')) {
    toolCalls++
    const content = FAKE_FILES[b.input.path] ?? `错误：不存在 ${b.input.path}`
    console.log(`  → read_file(${b.input.path})`)
    results.push({ type: 'tool_result', tool_use_id: b.id, content })
  }
  messages.push({ role: 'user', content: results })
}
console.log('⚠️ 10 轮未收敛')
