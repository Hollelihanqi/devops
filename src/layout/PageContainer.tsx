import type { ReactNode } from 'react'

/**
 * 页面统一骨架（约定「填满高度、头部固定、主体滚动」）。
 *
 * 用法：
 *   <PageContainer>
 *     <div className="shrink-0 ...">工具栏 / 标题（固定不滚）</div>
 *     <PageBody>主体内容（默认整块滚动）</PageBody>
 *   </PageContainer>
 *
 * 表格页则用 <PageBody scroll={false}> 内放 <div className="fill-card-host"><Card className="fill-card">...</Card></div>，
 * 让 .fill-table 接管表头固定 + 表体滚动。
 */

export function PageContainer({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={`flex h-full min-h-0 flex-col ${className ?? ''}`}>{children}</div>
  )
}

/**
 * 主体区：flex-1 min-h-0，默认整块滚动（网格/详情/设置页用）。
 * 传 scroll={false} 可改为不滚动，交给内部（如表格 .fill-table）自管滚动。
 */
export function PageBody({
  scroll = true,
  className,
  children,
}: {
  scroll?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={`flex min-h-0 flex-1 flex-col ${
        scroll ? 'overflow-y-auto' : 'overflow-hidden'
      } ${className ?? ''}`}
    >
      {children}
    </div>
  )
}
