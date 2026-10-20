import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, BellRing, Pencil, Trash2, ShieldCheck, AlertTriangle, CircleCheck } from 'lucide-react'
import { api, type Reminder, type Client, type Project } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Badge, Card, EmptyState, PageHeader, Skeleton } from '@/components/ui/Layout'
import { cn, fmtDate, dictOf, REMINDER_CATEGORY } from '@/lib/utils'
import { ReminderFormDialog } from './ReminderFormDialog'

export default function RemindersPage() {
  const [category, setCategory] = useState('')
  const [editing, setEditing] = useState<Reminder | null | undefined>(undefined)
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['reminders', category],
    queryFn: async () => (await api.get<{ items: Reminder[] }>('/reminders', { params: { category } })).data.items,
  })

  const del = useMutation({
    mutationFn: async (id: number) => api.delete(`/reminders/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reminders'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['dashboard-badges'] })
    },
  })

  const items = data ?? []
  const expired = items.filter((r) => r.state === 'expired').length
  const soon = items.filter((r) => r.state === 'soon').length

  return (
    <div>
      <PageHeader
        title="到期提醒"
        desc="证书、域名、服务器续费，到期前主动提醒"
        actions={
          <Button size="sm" onClick={() => setEditing(null)}>
            <Plus size={14} /> 新建提醒
          </Button>
        }
      />

      <div className="mb-3 grid grid-cols-3 gap-2">
        <StatTile
          icon={<AlertTriangle size={14} />}
          label="已过期"
          value={expired}
          tone="red"
        />
        <StatTile icon={<BellRing size={14} />} label="临近到期" value={soon} tone="amber" />
        <StatTile icon={<CircleCheck size={14} />} label="全部提醒" value={items.length} tone="ink" />
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        <FilterChip active={category === ''} onClick={() => setCategory('')}>
          全部
        </FilterChip>
        {Object.entries(REMINDER_CATEGORY).map(([k, v]) => (
          <FilterChip key={k} active={category === k} onClick={() => setCategory(k)}>
            {v.label}
          </FilterChip>
        ))}
      </div>

      {isLoading ? (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ShieldCheck size={20} />}
            title="没有到期提醒"
            desc="客户服务器上的 SSL 证书、域名续费、服务器账单，都记在这里免得踩坑"
            action={
              <Button size="sm" onClick={() => setEditing(null)}>
                <Plus size={14} /> 添加第一个提醒
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((r) => {
            const d = dictOf(REMINDER_CATEGORY, r.category)
            const isExpired = r.state === 'expired'
            const isSoon = r.state === 'soon'
            return (
              <Card key={r.id} className="group relative flex flex-col gap-2">
                <div className="flex items-start gap-2">
                  <span
                    className={cn(
                      'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg',
                      isExpired ? 'bg-red-50 text-red-500' : isSoon ? 'bg-amber-50 text-amber-500' : 'bg-sky-50 text-sky-500',
                    )}
                  >
                    <ShieldCheck size={14} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold text-ink-900">{r.title}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      <Badge soft={d.soft}>{d.label}</Badge>
                      {r.autoRenew && (
                        <Badge className="border-emerald-200 bg-emerald-50 text-emerald-600">自动续期</Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <Button variant="ghost" size="icon" onClick={() => setEditing(r)}>
                      <Pencil size={12} />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => confirm('删除该提醒？') && del.mutate(r.id)}>
                      <Trash2 size={12} className="text-red-400" />
                    </Button>
                  </div>
                </div>

                {r.target && <p className="truncate text-[11px] text-ink-400">{r.target}</p>}

                <div className="flex items-end justify-between border-t border-[var(--border)] pt-2">
                  <div>
                    <p className="text-[10px] text-ink-400">到期日</p>
                    <p
                      className={cn(
                        'tabular text-xs font-semibold',
                        isExpired ? 'text-red-600' : isSoon ? 'text-amber-600' : 'text-ink-900',
                      )}
                    >
                      {fmtDate(r.expireAt)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] text-ink-400">
                      {isExpired ? '已过期' : '剩余'}
                    </p>
                    <p
                      className={cn(
                        'tabular text-xs font-bold',
                        isExpired ? 'text-red-600' : isSoon ? 'text-amber-600' : 'text-emerald-600',
                      )}
                    >
                      {isExpired
                        ? `${Math.abs(r.daysLeft ?? 0)} 天`
                        : `${Math.max(0, r.daysLeft ?? 0)} 天`}
                    </p>
                  </div>
                </div>
                {r.projectName && (
                  <p className="truncate text-[10px] text-ink-400">关联项目：{r.projectName}</p>
                )}
              </Card>
            )
          })}
        </div>
      )}

      {editing !== undefined && (
        <ReminderFormDialog reminder={editing} onClose={() => setEditing(undefined)} />
      )}
    </div>
  )
}

function StatTile({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode
  label: string
  value: number
  tone: 'red' | 'amber' | 'ink'
}) {
  const tones = { red: 'text-red-600 bg-red-50', amber: 'text-amber-600 bg-amber-50', ink: 'text-ink-500 bg-ink-100' }
  return (
    <div className="card flex items-center gap-2.5 p-2.5">
      <span className={cn('flex h-8 w-8 items-center justify-center rounded-lg', tones[tone])}>{icon}</span>
      <div>
        <p className="text-[10px] text-ink-400">{label}</p>
        <p className="tabular text-sm font-bold text-ink-900">{value}</p>
      </div>
    </div>
  )
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
        active
          ? 'border-brand-300 bg-brand-50 text-brand-700'
          : 'border-[var(--border)] bg-white text-ink-500 hover:border-ink-300',
      )}
    >
      {children}
    </button>
  )
}
