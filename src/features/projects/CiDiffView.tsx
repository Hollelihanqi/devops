/**
 * 轻量行级 diff 视图：对比「当前 yml」与「AI 优化后 yml」。
 * 自带 LCS，不引第三方 diff 依赖（与本工程谨慎的依赖策略一致）。
 * yml 体量为百行级，O(n*m) LCS 足够。
 */

type Op = { type: 'eq' | 'del' | 'add'; text: string }

/** 经典 LCS 回溯，产出按原顺序排列的 eq/del/add 行序列 */
function diffLines(oldText: string, newText: string): Op[] {
  const a = oldText.split('\n')
  const b = newText.split('\n')
  const n = a.length
  const m = b.length
  // dp[i][j] = a[i:] 与 b[j:] 的 LCS 长度
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const ops: Op[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: 'eq', text: a[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: 'del', text: a[i] })
      i++
    } else {
      ops.push({ type: 'add', text: b[j] })
      j++
    }
  }
  while (i < n) ops.push({ type: 'del', text: a[i++] })
  while (j < m) ops.push({ type: 'add', text: b[j++] })
  return ops
}

const ROW_STYLE: Record<Op['type'], React.CSSProperties> = {
  eq: { color: '#595959' },
  del: { background: 'rgba(255,77,79,0.12)', color: '#cf1322' },
  add: { background: 'rgba(82,196,26,0.14)', color: '#389e0d' },
}
const SIGN: Record<Op['type'], string> = { eq: ' ', del: '-', add: '+' }

export default function CiDiffView({ oldText, newText }: { oldText: string; newText: string }) {
  const ops = diffLines(oldText, newText)
  const added = ops.filter((o) => o.type === 'add').length
  const removed = ops.filter((o) => o.type === 'del').length

  return (
    <div className="flex flex-col" style={{ height: '60vh' }}>
      <div className="mb-2 text-xs shrink-0">
        <span style={{ color: '#389e0d' }}>+{added} 新增</span>
        <span className="mx-2" style={{ color: '#cf1322' }}>
          -{removed} 删除
        </span>
        {added === 0 && removed === 0 && <span style={{ color: '#8c8c8c' }}>无差异</span>}
      </div>
      <div
        className="flex-1 min-h-0 overflow-auto"
        style={{
          border: '1px solid #f0f0f0',
          borderRadius: 6,
          fontFamily: 'monospace',
          fontSize: 12,
          lineHeight: '18px',
          background: '#fafafa',
        }}
      >
        {ops.map((op, idx) => (
          <div key={idx} style={{ ...ROW_STYLE[op.type], padding: '0 8px', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            <span style={{ userSelect: 'none', opacity: 0.6, marginRight: 8 }}>{SIGN[op.type]}</span>
            {op.text || ' '}
          </div>
        ))}
      </div>
    </div>
  )
}
