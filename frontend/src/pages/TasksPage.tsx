import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCorners,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type KeyboardCoordinateGetter,
} from '@dnd-kit/core'
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

const COLUMN_LABEL = Object.fromEntries(COLUMNS.map((c) => [c.key, c.label])) as Record<string, string>

// 键盘拖拽默认每次只挪 25px，跨一列要按二十几下，等于没用。
// 这里改成「左右（或上下）方向键直接跳到相邻列」，三次按键就能从待办拖到已完成。
const jumpToColumn: KeyboardCoordinateGetter = (event, { context: { collisionRect }, currentCoordinates }) => {
  if (!collisionRect) return undefined
  const colRects = COLUMNS.map((c) => document.getElementById(`col-${c.key}`)?.getBoundingClientRect()).filter(
    (r): r is DOMRect => !!r,
  )
  if (colRects.length < 2) return undefined

  // 桌面端三列并排（左右键），手机端纵向堆叠（上下键），按实际布局决定用哪组键
  const horizontal = colRects[1].left > colRects[0].left + 10
  const next = horizontal ? 'ArrowRight' : 'ArrowDown'
  const prev = horizontal ? 'ArrowLeft' : 'ArrowUp'
  const dir = event.code === next ? 1 : event.code === prev ? -1 : 0
  if (!dir) return undefined

  const centerX = collisionRect.left + collisionRect.width / 2
  const centerY = collisionRect.top + collisionRect.height / 2
  const cur = colRects.findIndex((r) =>
    horizontal ? centerX >= r.left && centerX <= r.right : centerY >= r.top && centerY <= r.bottom,
  )
  if (cur < 0) return undefined
  const target = colRects[cur + dir]
  if (!target) return undefined // 已经在首尾列，不越界

  // 只移动换列所需的那个轴，另一个轴保持不动，避免卡片在屏幕上乱跳
  if (horizontal) {
    return { x: currentCoordinates.x + (target.left + target.width / 2 - centerX), y: currentCoordinates.y }
  }
  return { x: currentCoordinates.x, y: currentCoordinates.y + (target.top + target.height / 2 - centerY) }
}

// 键盘拖拽时给屏幕阅读器的播报，让「拿起/移动/放下」有反馈
const ANNOUNCEMENTS = {
  onDragStart({ active }: { active: { id: string | number } }) {
    const el = document.querySelector(`[data-task-title="${active.id}"]`)
    return `已拿起任务${el?.textContent ?? ''}，用方向键移动到目标列，按空格放下`
  },
  onDragOver({ over }: { over: { id: string | number } | null }) {
    return over ? `移动到${COLUMN_LABEL[String(over.id)] ?? '未知列'}` : '不在任何列上'
  },
  onDragEnd({ over }: { over: { id: string | number } | null }) {
    return over ? `已放到${COLUMN_LABEL[String(over.id)]}` : '已取消'
  },
  onDragCancel() {
    return '已取消拖拽'
  },
}

export default function TasksPage() {
  const [q, setQ] = useState('')
  const [priority, setPriority] = useState('')
  const [kind, setKind] = useState('')
  const [view, setView] = useState<'board' | 'list'>('board')
  const [editing, setEditing] = useState<Task | null>(null)
  const [creating, setCreating] = useState(false)
  const [activeId, setActiveId] = useState<number | null>(null)
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

  // 三种输入各配一个传感器：
  // - 鼠标：移动 5px 才激活，保证点击勾选框/编辑按钮仍是普通点击
  // - 触摸：长按 180ms 才激活，且必须按在手柄上（见下面的 touch 守卫）
  // - 键盘：空格拿起、方向键换列、空格放下
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: jumpToColumn }),
  )

  const activeTask = activeId ? items.find((t) => t.id === activeId) ?? null : null

  const handleDragEnd = (e: DragEndEvent) => {
    setActiveId(null)
    const overId = e.over?.id
    if (!overId) return
    const task = items.find((t) => t.id === e.active.id)
    const target = overId as Task['status']
    if (task && COLUMNS.some((c) => c.key === target) && task.status !== target) {
      patch.mutate({ id: task.id, body: { status: target } })
    }
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
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={(e) => setActiveId(e.active.id as number)}
          onDragCancel={() => setActiveId(null)}
          onDragEnd={handleDragEnd}
          accessibility={{ announcements: ANNOUNCEMENTS }}
        >
          <div className="grid items-start gap-2.5 lg:grid-cols-3">
            {COLUMNS.map((col) => (
              <BoardColumn key={col.key} col={col} count={grouped[col.key]?.length ?? 0}>
                {(grouped[col.key] ?? []).map((t) => (
                  <TaskCard
                    key={t.id}
                    task={t}
                    onToggle={() =>
                      patch.mutate({ id: t.id, body: { status: t.status === 'done' ? 'todo' : 'done' } })
                    }
                    onEdit={() => setEditing(t)}
                    onDelete={() => confirm(`删除任务「${t.title}」？`) && del.mutate(t.id)}
                  />
                ))}
              </BoardColumn>
            ))}
          </div>

          {/* 拖动时跟着指针走的那张卡，用真实卡片渲染，不是黑块 */}
          <DragOverlay dropAnimation={null}>
            {activeTask ? (
              <div className="rotate-1 opacity-95 shadow-xl">
                <TaskCard task={activeTask} overlay onToggle={() => {}} onEdit={() => {}} onDelete={() => {}} />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
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

      {/* 拖动残影交给 dnd-kit 的 DragOverlay，这里不再手写 */}
    </div>
  )
}

// 一列 = 一个可放置区。整列都是落点，所以往列内任何位置松手都算，
// 不需要精确对准某张卡片。
function BoardColumn({
  col,
  count,
  children,
}: {
  col: (typeof COLUMNS)[number]
  count: number
  children: React.ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id: col.key })
  return (
    <div
      ref={setNodeRef}
      id={`col-${col.key}`}
      className={cn(
        // min-h 保证空列也有足够的落点区域，否则空列只有标题那点高度
        'flex min-h-[200px] flex-col rounded-xl p-1.5 transition-colors',
        isOver ? 'bg-brand-100 ring-2 ring-brand-400' : 'bg-ink-100/60',
      )}
    >
      <div className="flex items-center gap-1.5 px-1.5 py-1.5">
        <span className={cn('dot', col.accent)} />
        <span className="text-[11px] font-semibold text-ink-700">{col.label}</span>
        <span className="tabular text-[10px] text-ink-400">{count}</span>
        {isOver && <span className="ml-auto text-[10px] font-medium text-brand-600">松手放到这里</span>}
      </div>
      <div className="flex-1 space-y-1.5">
        {children}
        {count === 0 && (
          <p className={cn('px-2 py-12 text-center text-[11px]', isOver ? 'font-medium text-brand-600' : 'text-ink-400')}>
            {isOver ? '松手放到这里' : '拖拽任务到这里'}
          </p>
        )}
      </div>
    </div>
  )
}

function TaskCard({
  task,
  overlay,
  onToggle,
  onEdit,
  onDelete,
}: {
  task: Task
  /** 拖动时的那份副本：不参与拖拽逻辑，按钮也不可点 */
  overlay?: boolean
  onToggle: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const ps = dictOf(TASK_PRIORITY, task.priority)
  const overdue = task.dueState === 'overdue'
  const soon = task.dueState === 'soon'
  const done = task.status === 'done'

  // 整张卡都是拖拽激活区。鼠标靠 5px 位移阈值、触摸靠 180ms 长按来区分
  // 「点击」和「拖动」，所以里面的勾选框和编辑按钮照常可用。
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
    disabled: overlay,
  })

  return (
    <div
      ref={overlay ? undefined : setNodeRef}
      {...(overlay ? {} : attributes)}
      {...(overlay ? {} : listeners)}
      // 手指的拖拽只允许从手柄发起：dnd-kit 的触摸拖拽要求元素 touch-action:none，
      // 但整张卡都设成 none 的话，手机上就没法上下滚动任务列表了。
      // 所以在捕获阶段拦掉「不是从手柄开始」的触摸，让浏览器照常滚动。
      onTouchStartCapture={(e) => {
        if (overlay) return
        if (!(e.target as HTMLElement).closest('[data-drag-handle]')) e.stopPropagation()
      }}
      className={cn(
        'group rounded-lg border bg-white p-2.5 shadow-sm transition-all',
        isDragging
          ? 'border-brand-300 opacity-40 ring-2 ring-brand-200'
          : 'border-[var(--border)] hover:border-ink-300',
        !overlay && 'cursor-grab active:cursor-grabbing',
        done && !isDragging && 'opacity-60',
      )}
    >
      <div className="flex items-start gap-1.5">
        <input
          type="checkbox"
          checked={done}
          onChange={onToggle}
          className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-emerald-500"
        />
        <p
          data-task-title={task.id}
          className={cn('flex-1 text-xs font-medium leading-snug', done && 'text-ink-400 line-through')}
        >
          {task.title}
        </p>
        {/* 手柄：鼠标可以从整张卡拖，手指必须按这里。
            常驻显示，顺带告诉用户「这张卡是可以拖的」。
            touch-none 是 dnd-kit 触摸拖拽的必要条件，只能加在手柄上。 */}
        <button
          type="button"
          data-drag-handle
          title="拖动改变状态"
          aria-label="拖动改变状态"
          className="shrink-0 cursor-grab touch-none rounded p-0.5 text-ink-300 transition-colors hover:bg-ink-100 hover:text-ink-500 active:cursor-grabbing"
        >
          <GripVertical size={12} />
        </button>
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
