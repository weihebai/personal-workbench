import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Check,
  Clock,
  AlertTriangle,
  Pencil,
  Trash2,
  Plus,
  RotateCcw,
  XCircle,
} from 'lucide-react'
import { api, type Milestone } from '@/lib/api'
import { Badge } from '@/components/ui/Layout'
import { cn, dictOf, fmtDate, MILESTONE_STATUS } from '@/lib/utils'
import { daysUntil, daysLeftText } from '@/lib/workday'

/**
 * 项目进度时间线。
 * 视觉：左侧一条竖线串起节点，未完成在上、已完成沉底；
 * 临期/过期的节点高亮，主操作是"标记完成"。
 */
export function MilestoneTimeline({
  items,
  onEdit,
  onAdd,
}: {
  items: Milestone[]
  onEdit: (m: Milestone) => void
  onAdd: () => void
}) {
  const qc = useQueryClient()

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['project'] })
    qc.invalidateQueries({ queryKey: ['projects'] })
    qc.invalidateQueries({ queryKey: ['dashboard'] })
    qc.invalidateQueries({ queryKey: ['dashboard-badges'] })
  }

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) =>
      (await api.patch(`/milestones/${id}/status`, { status })).data,
    onSuccess: refresh,
  })

  const del = useMutation({
    mutationFn: async (id: number) => (await api.delete(`/milestones/${id}`)).data,
    onSuccess: refresh,
  })

  const open = items.filter((m) => m.status === 'waiting' || m.status === 'delayed')
  const closed = items.filter((m) => m.status === 'done' || m.status === 'canceled')
  const total = items.filter((m) => m.status !== 'canceled').length
  const done = items.filter((m) => m.status === 'done').length
  const pct = total ? Math.round((done / total) * 100) : 0

  return (
    <div>
      {/* 进度概览 */}
      <div className="mb-3 flex items-center gap-2.5">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-100">
          <div
            className="h-full rounded-full bg-gradient-to-r from-brand-400 to-brand-600 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="tabular shrink-0 text-[11px] font-semibold text-ink-600">
          {done}/{total}
        </span>
      </div>

      {items.length === 0 && (
        <div className="py-6 text-center">
          <p className="text-xs text-ink-400">还没有进度节点</p>
          <p className="mt-0.5 text-[11px] text-ink-300">记录「提交备案 12 个工作日」这类等待节点</p>
          <button
            onClick={onAdd}
            className="mt-2 inline-flex items-center gap-1 rounded-md border border-dashed border-brand-300 px-2 py-1 text-[11px] font-medium text-brand-600 hover:bg-brand-50"
          >
            <Plus size={11} /> 添加第一个节点
          </button>
        </div>
      )}

      <div className="relative">
        {items.length > 0 && (
          <span className="absolute bottom-2 left-[7px] top-2 w-px bg-[var(--border)]" aria-hidden />
        )}
        <ul className="space-y-0.5">
          {[...open, ...closed].map((m) => {
            const st = dictOf(MILESTONE_STATUS, m.status)
            const dl = m.dueDate ? daysUntil(m.dueDate) : null
            const isDone = m.status === 'done'
            const isCanceled = m.status === 'canceled'
            const overdue = !isDone && !isCanceled && dl !== null && dl < 0
            const soon = !isDone && !isCanceled && dl !== null && dl >= 0 && dl <= m.remindDays

            return (
              <li key={m.id} className="group relative flex gap-2.5 py-1.5 pl-0">
                {/* 节点圆点 */}
                <span
                  className={cn(
                    'relative z-10 mt-1 flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-full ring-2 ring-white',
                    isDone
                      ? 'bg-emerald-500'
                      : isCanceled
                        ? 'bg-ink-300'
                        : overdue
                          ? 'bg-red-500'
                          : soon
                            ? 'bg-amber-500'
                            : 'bg-sky-500',
                  )}
                >
                  {isDone && <Check size={9} className="text-white" strokeWidth={3} />}
                  {isCanceled && <XCircle size={9} className="text-white" strokeWidth={3} />}
                  {overdue && <AlertTriangle size={8} className="text-white" strokeWidth={3} />}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex items-start gap-1.5">
                    <span
                      className={cn(
                        'text-xs font-medium leading-5',
                        isCanceled ? 'text-ink-400 line-through' : isDone ? 'text-ink-400' : 'text-ink-900',
                      )}
                    >
                      {m.title}
                    </span>
                    {isDone && <Badge soft={st.soft}>{st.label}</Badge>}
                    {m.status === 'delayed' && <Badge soft={st.soft}>{st.label}</Badge>}

                    {/* 悬停操作 */}
                    <div className="ml-auto flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                      {!isDone && (
                        <button
                          onClick={() => setStatus.mutate({ id: m.id, status: 'done' })}
                          title="标记完成"
                          className="rounded p-1 text-ink-400 hover:bg-emerald-50 hover:text-emerald-600"
                        >
                          <Check size={12} />
                        </button>
                      )}
                      {isDone && (
                        <button
                          onClick={() => setStatus.mutate({ id: m.id, status: 'waiting' })}
                          title="重新打开"
                          className="rounded p-1 text-ink-400 hover:bg-sky-50 hover:text-sky-600"
                        >
                          <RotateCcw size={12} />
                        </button>
                      )}
                      <button
                        onClick={() => onEdit(m)}
                        title="编辑"
                        className="rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(`删除节点「${m.title}」？`)) del.mutate(m.id)
                        }}
                        title="删除"
                        className="rounded p-1 text-ink-400 hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>

                  {/* 预期效果 */}
                  {m.expect && (
                    <p className="mt-0.5 text-[11px] leading-relaxed text-ink-500">{m.expect}</p>
                  )}

                  {/* 时间信息 */}
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px]">
                    {m.dueDate && (
                      <span
                        className={cn(
                          'tabular inline-flex items-center gap-1 rounded px-1 py-0.5',
                          overdue
                            ? 'bg-red-50 font-medium text-red-600'
                            : soon
                              ? 'bg-amber-50 font-medium text-amber-700'
                              : 'text-ink-400',
                        )}
                      >
                        <Clock size={9} />
                        {fmtDate(m.dueDate)}
                        {!isDone && !isCanceled && dl !== null && <span>· {daysLeftText(dl)}</span>}
                      </span>
                    )}
                    {!isDone && !isCanceled && m.days > 0 && (
                      <span className="text-ink-300">
                        {m.dayType === 'natural' ? '自然日' : '工作日'} {m.days} 天
                      </span>
                    )}
                    {isDone && m.doneAt && (
                      <span className="text-emerald-600">完成于 {fmtDate(m.doneAt)}</span>
                    )}
                    {m.note && <span className="truncate text-ink-300">{m.note}</span>}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      </div>

      {items.length > 0 && (
        <button
          onClick={onAdd}
          className="mt-2 inline-flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-[var(--border)] py-1.5 text-[11px] font-medium text-ink-500 transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-600"
        >
          <Plus size={11} /> 添加进度节点
        </button>
      )}
    </div>
  )
}
