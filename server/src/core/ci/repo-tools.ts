/**
 * 仓库代码工具集（Agent 工具循环）：list_repo_files / read_file / grep。
 * 供应商无关——只依赖「文件路径清单 + 读取单文件原文」两项能力，
 * 由代码问答（ProjectsService）与失败诊断（DeploymentsService）共享，避免重复实现。
 */
import type { AgentTool } from '../../prompts/ai.service'

// 用「最大迭代轮数 + 单次工具结果上限」控预算，而非固定文件数；模型可按需多读，逼近全文阅读。
export const LIST_FILES_LIMIT = 400 // list_repo_files 单次返回路径上限
export const READ_FILE_MAX_CHARS = 50_000 // read_file 单文件返回字符上限（超长截断并告知）
export const GREP_MAX_FILES = 200 // grep 单次最多扫描文件数
export const GREP_MAX_HITS = 80 // grep 单次最多返回命中行数

/** 交给模型的仓库工具集（Anthropic tools 协议） */
export const REPO_TOOLS: AgentTool[] = [
  {
    name: 'list_repo_files',
    description: '列出当前仓库分支的文件路径；可选 glob 子串过滤（如 "service" 或 ".ts"）。返回换行分隔的路径清单。',
    input_schema: {
      type: 'object',
      properties: { glob: { type: 'string', description: '可选：路径包含的子串，用于过滤；留空返回全部（可能被截断）' } },
    },
  },
  {
    name: 'read_file',
    description: '读取仓库中某个文件的完整内容。path 必须是 list_repo_files / grep 给出的真实路径。',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string', description: '文件路径' } },
      required: ['path'],
    },
  },
  {
    name: 'grep',
    description: '在仓库文件内容里按关键词做全文检索，返回命中的 "文件:行号: 行内容"，用于定位实现位置。',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '要检索的关键词（大小写不敏感）' },
        path_glob: { type: 'string', description: '可选：仅在路径包含该子串的文件里检索，缩小范围更快' },
      },
      required: ['query'],
    },
  },
]

/** 执行仓库工具：list_repo_files / read_file / grep，返回给模型的文本结果 */
export async function runRepoTool(
  name: string,
  input: Record<string, unknown>,
  files: string[],
  readRaw: (path: string) => Promise<string | null>,
): Promise<string> {
  if (name === 'list_repo_files') {
    const glob = typeof input.glob === 'string' ? input.glob.trim().toLowerCase() : ''
    const hit = glob ? files.filter((f) => f.toLowerCase().includes(glob)) : files
    const shown = hit.slice(0, LIST_FILES_LIMIT)
    const note = hit.length > shown.length ? `\n（共 ${hit.length} 个，仅列出前 ${shown.length} 个，请用更精确的 glob 过滤）` : ''
    return shown.length ? shown.join('\n') + note : '（没有匹配的文件）'
  }
  if (name === 'read_file') {
    const path = typeof input.path === 'string' ? input.path.trim().replace(/^\.?\//, '') : ''
    if (!path) return '错误：缺少 path 参数'
    const real = files.includes(path) ? path : files.find((f) => f === path || f.endsWith('/' + path))
    if (!real) return `错误：仓库中不存在文件 ${path}（可先用 list_repo_files 确认路径）`
    const raw = await readRaw(real)
    if (raw == null) return `错误：读取 ${real} 失败或文件不存在`
    if (raw.length > READ_FILE_MAX_CHARS) {
      return `<file path="${real}" truncated="true" total_chars="${raw.length}">\n${raw.slice(0, READ_FILE_MAX_CHARS)}\n</file>`
    }
    return `<file path="${real}">\n${raw}\n</file>`
  }
  if (name === 'grep') {
    const query = typeof input.query === 'string' ? input.query : ''
    if (!query.trim()) return '错误：缺少 query 参数'
    const pathGlob = typeof input.path_glob === 'string' ? input.path_glob.trim().toLowerCase() : ''
    const needle = query.toLowerCase()
    const candidates = (pathGlob ? files.filter((f) => f.toLowerCase().includes(pathGlob)) : files).slice(
      0,
      GREP_MAX_FILES,
    )
    const hits: string[] = []
    let scanned = 0
    for (const path of candidates) {
      if (hits.length >= GREP_MAX_HITS) break
      const raw = await readRaw(path)
      scanned++
      if (raw == null) continue
      const lines = raw.split('\n')
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(needle)) {
          hits.push(`${path}:${i + 1}: ${lines[i].trim().slice(0, 200)}`)
          if (hits.length >= GREP_MAX_HITS) break
        }
      }
    }
    const note =
      candidates.length > scanned || hits.length >= GREP_MAX_HITS
        ? `\n（已扫描 ${scanned} 个文件，命中达上限或仍有未扫描文件，可缩小 path_glob 精确检索）`
        : ''
    return hits.length ? hits.join('\n') + note : `（在 ${scanned} 个文件中未找到「${query}」）`
  }
  return `错误：未知工具 ${name}`
}

const IGNORED_DIRS = ['node_modules/', 'dist/', 'build/', '.git/', 'vendor/', 'coverage/', '__pycache__/', '.next/', 'target/']
const IGNORED_FILES = ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'poetry.lock', 'composer.lock', 'go.sum', 'cargo.lock']
const BINARY_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp',
  '.pdf', '.zip', '.gz', '.tar', '.rar', '.7z', '.jar', '.war',
  '.woff', '.woff2', '.ttf', '.eot', '.mp4', '.mp3', '.mov', '.exe', '.dll', '.so', '.bin',
])

/** 过滤明显不需要进上下文的路径（依赖、构建产物、二进制/资源、锁文件等） */
export function isIgnoredPath(path: string): boolean {
  const lower = path.toLowerCase()
  if (IGNORED_DIRS.some((d) => lower.includes(d))) return true
  if (IGNORED_FILES.some((f) => lower.endsWith(f))) return true
  const dot = lower.lastIndexOf('.')
  const ext = dot >= 0 ? lower.slice(dot) : ''
  return BINARY_EXTS.has(ext)
}
