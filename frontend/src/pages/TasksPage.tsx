import { useMemo, useState } from 'react'
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
          {COLUMNS.map((col) => (
            <div
              key={col.key}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (dragId) patch.mutate({ id: dragId, body: { status: col.key } })
                setDragId(null)
              }}
              className="rounded-xl bg-ink-100/60 p-1.5"
            >
              <div className="flex items-center gap-1.5 px-1.5 py-1.5">
                <span className={cn('dot', col.accent)} />
                <span className="text-[11px] font-semibold text-ink-700">{col.label}</span>
                <span className="tabular text-[10px] text-ink-400">{grouped[col.key]?.length ?? 0}</span>
              </div>
              <div className="space-y-1.5">
                {(grouped[col.key] ?? []).map((t) => (
                  <TaskCard
                    key={t.id}
                    task={t}
                    draggable
                    onDragStart={() => setDragId(t.id)}
                    onToggle={() =>
                      patch.mutate({ id: t.id, body: { status: t.status === 'done' ? 'todo' : 'done' } })
                    }
                    onEdit={() => setEditing(t)}
                    onDelete={() => confirm(`删除任务「${t.title}」？`) && del.mutate(t.id)}
                  />
                ))}
                {(grouped[col.key] ?? []).length === 0 && (
                  <p className="px-2 py-4 text-center text-[11px] text-ink-400">拖拽任务到这里</p>
                )}
              </div>
            </div>
          ))}
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
    </div>
  )
}

function TaskCard({
  task,
  draggable,
  onDragStart,
  onToggle,
  onEdit,
  onDelete,
}: {
  task: Task
  draggable?: boolean
  onDragStart?: () => void
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
      draggable={draggable && !done}
      onDragStart={onDragStart}
      className={cn(
        'group cursor-grab rounded-lg border border-[var(--border)] bg-white p-2.5 shadow-sm transition-all',
        'hover:border-ink-300 active:cursor-grabbing',
        done && 'opacity-60',
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
