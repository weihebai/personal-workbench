import { useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Plus,
  Search,
  CheckSquare,
  Trash2,
  Pencil,
  Clock,
  Flame,
  User,
  FolderKanban,
  ListFilter,
  LayoutGrid,
  GripVertical,
} from 'lucide-react'
import { api, errMsg, type Paged, type Task } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select, type Option } from '@/components/ui/Select'
import { Badge, Card, EmptyState, PageHeader, Skeleton } from '@/components/ui/Layout'
import {
  cn,
  fmtDateShort,
  minutesToHours,
  dictOf,
  TASK_STATUS,
  TASK_PRIORITY,
} from '@/lib/utils'
import { TaskFormDialog } from './TaskFormDialog'

const PRIORITY_FILTER: Option[] = [
  { value: '', label: '全部优先级' },
  ...Object.entries(TASK_PRIORITY).map(([v, d]) => ({ value: v, label: d.label, dot: d.color })),
]
const KIND_FILTER: Option[] = [
  { value: '', label: '全部归属' },
  { value: 'freelance', label: '私活' },
  { value: 'personal', label: '个人' },
]

const COLUMNS: { key: Task['status']; label: string; accent: string }[] = [
  { key: 'todo', label: '待办', accent: 'bg-ink-400' },
  { key: 'doing', label: '进行中', accent: 'bg-brand-500' },
  { key: 'done', label: '已完成', accent: 'bg-emerald-500' },
]

export default function TasksPage() {
  const [q, setQ] = useState('')
  const [priority, setPriority] = useState('')
  const [kind, setKind] = useState('')
  const [view, setView] = useState<'board' | 'list'>('board')
  const [editing, setEditing] = useState<Task | null>(null)
  const [creating, setCreating] = useState(false)
  const [dragId, setDragId] = useState<number | null>(null)
  const [hoverCol, setHoverCol] = useState<Task['status'] | null>(null)
  const [ghost, setGhost] = useState<{ x: number; y: number; title: string } | null>(null)
  const colRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const dragInfo = useRef<{ task: Task; startX: number; startY: number; active: boolean; pointerId: number } | null>(
    null,
  )
  const justDragged = useRef(false)
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['tasks', q, priority, kind],
    queryFn: async () =>
      (
        await api.get<Paged<Task>>('/tasks', {
          params: { q, priority, kind, size: 200, sort: 'due' },
        })
      ).data,
  })

  const patch = useMutation({
    mutationFn: async ({ id, body }: { id: number; body: any }) => api.put(`/tasks/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['dashboard-badges'] })
    },
  })

  const del = useMutation({
    mutationFn: async (id: number) => api.delete(`/tasks/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })

  const items = data?.items ?? []
  const grouped = useMemo(() => {
    const g: Record<string, Task[]> = { todo: [], doing: [], done: [], canceled: [] }
    for (const t of items) (g[t.status] ??= []).push(t)
    return g
  }, [items])

  // 指针落在哪一列。用列容器的矩形判断，比 elementFromPoint 更稳，
  // 因为拖动时鼠标下方可能是卡片本身而不是列容器。
  const columnAt = (x: number, y: number): Task['status'] | null => {
    for (const col of COLUMNS) {
      const el = colRefs.current[col.key]
      if (!el) continue
      const r = el.getBoundingClientRect()
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return col.key
    }
    return null
  }

  // 用 pointer 事件自己实现拖拽，而不是 HTML5 drag：
  // 1) 原生的 draggable 在触摸屏上根本不触发，手机上没法拖
  // 2) 原生没有拖动残影和目标列高亮，用户会以为拖不动
  const startDrag = (e: React.PointerEvent, task: Task) => {
    // 触摸/手写笔必须从手柄开始拖，否则和列表滚动抢手势
    const fromHandle = !!(e.target as HTMLElement).closest('[data-drag-handle]')
    if (e.pointerType !== 'mouse' && !fromHandle) return
    if (e.button !== 0) return

    const startX = e.clientX
    const startY = e.clientY
    const info = { task, startX, startY, active: false, pointerId: e.pointerId }
    dragInfo.current = info

    const cleanup = () => {
      dragInfo.current = null
      setDragId(null)
      setHoverCol(null)
      setGhost(null)
      document.body.classList.remove('select-none')
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
    }

    const move = (ev: PointerEvent) => {
      if (!dragInfo.current || ev.pointerId !== info.pointerId) return
      if (!info.active) {
        // 超过 5px 才算拖拽，否则仍然是一次普通点击（勾选框、编辑按钮要能用）
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5) return
        info.active = true
        setDragId(task.id)
        document.body.classList.add('select-none')
      }
      setGhost({ x: ev.clientX, y: ev.clientY, title: task.title })
      setHoverCol(columnAt(ev.clientX, ev.clientY))
    }

    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== info.pointerId) return
      const target = columnAt(ev.clientX, ev.clientY)
      const moved = info.active
      cleanup()
      if (!moved) return
      // 拖完会紧接着触发一次 click，屏蔽掉，避免误触勾选框
      justDragged.current = true
      setTimeout(() => (justDragged.current = false), 150)
      if (target && target !== task.status) {
        patch.mutate({ id: task.id, body: { status: target } })
      }
    }

    const cancel = () => cleanup()

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
  }

  const overdueCount = items.filter((t) => t.dueState === 'overdue').length

  return (
    <div>
      <PageHeader
        title="任务"
        desc={`${items.length} 个任务${overdueCount ? ` · ${overdueCount} 个已逾期` : ''}`}
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus size={14} /> 新建任务
          </Button>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索任务…"
            className="h-8 pl-8 text-xs"
          />
        </div>
        <Select value={priority} onChange={setPriority} options={PRIORITY_FILTER} size="sm" className="w-32" />
        <Select value={kind} onChange={setKind} options={KIND_FILTER} size="sm" className="w-28" />
        <div className="ml-auto flex rounded-md border border-[var(--border)] bg-white p-0.5">
          <button
            onClick={() => setView('board')}
            className={cn(
              'flex h-7 items-center gap-1 rounded px-2 text-[11px] font-medium',
              view === 'board' ? 'bg-ink-100 text-ink-900' : 'text-ink-400',
            )}
          >
            <LayoutGrid size={12} /> 看板
          </button>
          <button
            onClick={() => setView('list')}
            className={cn(
              'flex h-7 items-center gap-1 rounded px-2 text-[11px] font-medium',
              view === 'list' ? 'bg-ink-100 text-ink-900' : 'text-ink-400',
            )}
          >
            <ListFilter size={12} /> 列表
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-3 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-64" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            icon={<CheckSquare size={20} />}
            title="还没有任务"
            desc="把个人计划和客户交付分开管理，别让它们混在一起"
            action={
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus size={14} /> 添加第一个任务
              </Button>
            }
          />
        </Card>
      ) : view === 'board' ? (
        <div className="grid items-start gap-2.5 lg:grid-cols-3">
          {COLUMNS.map((col) => {
            const isHover = dragId !== null && hoverCol === col.key
            return (
              <div
                key={col.key}
                ref={(el) => {
                  colRefs.current[col.key] = el
                }}
                className={cn(
                  // min-h 保证空列也有足够的落点区域，否则空列只有标题那点高度，
                  // 往下一拖就落到列外，看起来像「拖不进去」
                  'flex min-h-[200px] flex-col rounded-xl p-1.5 transition-colors',
                  isHover ? 'bg-brand-100 ring-2 ring-brand-400' : 'bg-ink-100/60',
                )}
              >
                <div className="flex items-center gap-1.5 px-1.5 py-1.5">
                  <span className={cn('dot', col.accent)} />
                  <span className="text-[11px] font-semibold text-ink-700">{col.label}</span>
                  <span className="tabular text-[10px] text-ink-400">{grouped[col.key]?.length ?? 0}</span>
                  {isHover && <span className="ml-auto text-[10px] font-medium text-brand-600">松手放到这里</span>}
                </div>
                <div className="flex-1 space-y-1.5">
                  {(grouped[col.key] ?? []).map((t) => (
                    <TaskCard
                      key={t.id}
                      task={t}
                      dragging={dragId === t.id}
                      onPointerDown={(e) => startDrag(e, t)}
                      suppressClick={() => justDragged.current}
                      onToggle={() =>
                        patch.mutate({ id: t.id, body: { status: t.status === 'done' ? 'todo' : 'done' } })
                      }
                      onEdit={() => setEditing(t)}
                      onDelete={() => confirm(`删除任务「${t.title}」？`) && del.mutate(t.id)}
                    />
                  ))}
                  {(grouped[col.key] ?? []).length === 0 && (
                    <p
                      className={cn(
                        'px-2 py-12 text-center text-[11px]',
                        isHover ? 'font-medium text-brand-600' : 'text-ink-400',
                      )}
                    >
                      {isHover ? '松手放到这里' : '拖拽任务到这里'}
                    </p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <Card padding={false} className="overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--border)] bg-ink-50/60 text-left text-[10px] uppercase tracking-wide text-ink-400">
                <th className="px-3 py-2 font-medium">任务</th>
                <th className="hidden px-2 py-2 font-medium sm:table-cell">项目</th>
                <th className="px-2 py-2 font-medium">优先级</th>
                <th className="px-2 py-2 font-medium">截止</th>
                <th className="px-2 py-2 font-medium">状态</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {items.map((t) => {
                const ts = dictOf(TASK_STATUS, t.status)
                const ps = dictOf(TASK_PRIORITY, t.priority)
                return (
                  <tr key={t.id} className="border-b border-[var(--border)] last:border-0 hover:bg-ink-50/60">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={t.status === 'done'}
                          onChange={() =>
                            patch.mutate({ id: t.id, body: { status: t.status === 'done' ? 'todo' : 'done' } })
                          }
                          className="h-3.5 w-3.5 accent-emerald-500"
                        />
                        <span className={cn('truncate', t.status === 'done' && 'text-ink-400 line-through')}>
                          {t.title}
                        </span>
                      </div>
                    </td>
                    <td className="hidden px-2 py-2 text-ink-500 sm:table-cell">{t.projectName || '—'}</td>
                    <td className="px-2 py-2">
                      <Badge soft={ps.soft} dot={ps.color}>
                        {ps.label}
                      </Badge>
                    </td>
                    <td
                      className={cn(
                        'tabular px-2 py-2',
                        t.dueState === 'overdue'
                          ? 'font-semibold text-red-500'
                          : t.dueState === 'soon'
                            ? 'font-medium text-amber-600'
                            : 'text-ink-500',
                      )}
                    >
                      {fmtDateShort(t.dueDate)}
                    </td>
                    <td className="px-2 py-2">
                      <Badge soft={ts.soft} dot={ts.color}>
                        {ts.label}
                      </Badge>
                    </td>
                    <td className="px-2 py-2 text-right">
                      <Button variant="ghost" size="icon" onClick={() => setEditing(t)}>
                        <Pencil size={12} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => confirm(`删除任务「${t.title}」？`) && del.mutate(t.id)}
                      >
                        <Trash2 size={12} className="text-red-400" />
                      </Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      )}

      {(creating || editing) && (
        <TaskFormDialog
          task={editing}
          onClose={() => {
            setCreating(false)
            setEditing(null)
          }}
        />
      )}

      {/* 拖动残影：跟着指针走，让用户清楚自己正在拖哪一条 */}
      {ghost && (
        <div
          className="pointer-events-none fixed z-50 max-w-64 truncate rounded-md bg-ink-900/90 px-2 py-1 text-[11px] font-medium text-white shadow-lg"
          style={{ left: ghost.x + 12, top: ghost.y + 12 }}
        >
          {ghost.title}
        </div>
      )}
    </div>
  )
}

function TaskCard({
  task,
  dragging,
  onPointerDown,
  suppressClick,
  onToggle,
  onEdit,
  onDelete,
}: {
  task: Task
  dragging?: boolean
  onPointerDown?: (e: React.PointerEvent) => void
  suppressClick?: () => boolean
  onToggle: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const ps = dictOf(TASK_PRIORITY, task.priority)
  const overdue = task.dueState === 'overdue'
  const soon = task.dueState === 'soon'
  const done = task.status === 'done'

  return (
    <div
      onPointerDown={onPointerDown}
      onClickCapture={(e) => {
        if (suppressClick?.()) {
          e.stopPropagation()
          e.preventDefault()
        }
      }}
      className={cn(
        'group rounded-lg border bg-white p-2.5 shadow-sm transition-all',
        dragging
          ? 'border-brand-300 opacity-40 ring-2 ring-brand-200'
          : 'border-[var(--border)] hover:border-ink-300',
        done && !dragging && 'opacity-60',
      )}
    >
      <div className="flex items-start gap-1.5">
        <input
          type="checkbox"
          checked={done}
          onChange={onToggle}
          className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-emerald-500"
        />
        <p className={cn('flex-1 text-xs font-medium leading-snug', done && 'text-ink-400 line-through')}>
          {task.title}
        </p>
        {/* 拖拽手柄：鼠标可从整张卡拖动，触摸屏必须从手柄拖（避免和滚动抢手势）。
            常驻显示，顺带告诉用户「这张卡是可以拖的」。 */}
        <span
          data-drag-handle
          title="拖动改变状态"
          className="shrink-0 cursor-grab touch-none rounded p-0.5 text-ink-300 transition-colors hover:bg-ink-100 hover:text-ink-500 active:cursor-grabbing"
        >
          <GripVertical size={12} />
        </span>
        <div className="flex shrink-0 opacity-0 transition-opacity group-hover:opacity-100">
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onEdit}>
            <Pencil size={11} />
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onDelete}>
            <Trash2 size={11} className="text-red-400" />
          </Button>
        </div>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        <Badge soft={ps.soft} dot={ps.color}>
          {ps.label}
        </Badge>
        {task.projectName && (
          <Badge className="border-ink-200 bg-white text-ink-500">
            <FolderKanban size={9} /> {task.projectName}
          </Badge>
        )}
        {task.clientName && (
          <Badge className="border-ink-200 bg-white text-ink-500">
            <User size={9} /> {task.clientName}
          </Badge>
        )}
      </div>

      <div className="mt-1.5 flex items-center gap-2.5 text-[10px]">
        {task.dueDate && (
          <span
            className={cn(
              'flex items-center gap-0.5',
              overdue ? 'font-semibold text-red-500' : soon ? 'font-medium text-amber-600' : 'text-ink-400',
            )}
          >
            {overdue || soon ? <Flame size={10} /> : <Clock size={10} />}
            {fmtDateShort(task.dueDate)}
          </span>
        )}
        {(task.estimateMinutes > 0 || task.actualMinutes > 0) && (
          <span className="text-ink-400">
            {minutesToHours(task.actualMinutes)}/{minutesToHours(task.estimateMinutes)}
          </span>
        )}
        {task.budget > 0 && (
          <span className="tabular ml-auto font-semibold text-emerald-600">¥{task.budget}</span>
        )}
      </div>
    </div>
  )
}
