import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Wallet, Pencil, Trash2, Search, CheckCircle2 } from 'lucide-react'
import { api, type Paged, type Payment, type Project } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select, type Option } from '@/components/ui/Select'
import { Badge, Card, EmptyState, PageHeader, Skeleton } from '@/components/ui/Layout'
import { cn, money, fmtDate, dictOf, PAYMENT_STATUS } from '@/lib/utils'
import { PaymentFormDialog } from './PaymentFormDialog'

const STATUS_FILTER: Option[] = [
  { value: '', label: '全部状态' },
  { value: 'pending', label: '待收', dot: 'bg-amber-500' },
  { value: 'received', label: '已收', dot: 'bg-emerald-500' },
  { value: 'overdue', label: '已逾期', dot: 'bg-red-500' },
]

export default function PaymentsPage() {
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<Payment | null | undefined>(undefined)
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['payments'],
    // 一次取全量（个人应用量级很小），状态筛选放本地做，
    // 这样「已逾期」才能同时覆盖手动标 overdue 和按约定日算出来的逾期
    queryFn: async () => (await api.get<Paged<Payment>>('/payments', { params: { size: 500 } })).data,
  })

  const { data: projects } = useQuery({
    queryKey: ['projects-lite'],
    queryFn: async () => (await api.get<{ items: Project[] }>('/projects', { params: { size: 200 } })).data.items,
  })
  const projName = (id: number) => projects?.find((p) => p.id === id)?.name ?? `#${id}`

  const patch = useMutation({
    mutationFn: async ({ id, body }: { id: number; body: any }) => api.put(`/payments/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payments'] })
      qc.invalidateQueries({ queryKey: ['projects'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['dashboard-badges'] })
    },
  })

  const del = useMutation({
    mutationFn: async (id: number) => api.delete(`/payments/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payments'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })

  // 逾期有两种来源：手动标成 overdue 的，以及约定日已过但状态还是 pending 的
  const isLate = (p: Payment) => p.status === 'overdue' || !!p.overdue
  const matchStatus = (p: Payment) => {
    if (!status) return true
    if (status === 'overdue') return isLate(p)
    if (status === 'pending') return p.status === 'pending' && !p.overdue
    return p.status === status
  }
  const items = (data?.items ?? []).filter(
    (p) => matchStatus(p) && (q ? projName(p.projectId).includes(q) || p.title.includes(q) : true),
  )
  const sumWhere = (f: (p: Payment) => boolean) =>
    items.filter(f).reduce((a, b) => a + b.amount, 0)
  const sum = (s: string) => sumWhere((p) => p.status === s && !p.overdue)

  return (
    <div>
      <PageHeader
        title="收款台账"
        desc="每笔钱的去向，都要有记录"
        actions={
          <Button size="sm" onClick={() => setEditing(null)}>
            <Plus size={14} /> 登记收款
          </Button>
        }
      />

      <div className="mb-3 grid grid-cols-3 gap-2">
        <SummaryCard label="待收" value={money(sum('pending'))} tone="amber" />
        <SummaryCard label="已收" value={money(sum('received'))} tone="emerald" />
        <SummaryCard label="逾期" value={money(sumWhere(isLate))} tone="red" />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索项目或款项…" className="h-8 pl-8 text-xs" />
        </div>
        <Select value={status} onChange={setStatus} options={STATUS_FILTER} size="sm" className="w-32" />
      </div>

      {isLoading ? (
        <Skeleton className="h-64" />
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Wallet size={20} />}
            title="还没有收款记录"
            desc="在项目里「确认收货 · 记应收」，或在这里直接登记"
            action={
              <Button size="sm" onClick={() => setEditing(null)}>
                <Plus size={14} /> 登记第一笔
              </Button>
            }
          />
        </Card>
      ) : (
        <Card padding={false} className="overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--border)] bg-ink-50/60 text-left text-[10px] uppercase tracking-wide text-ink-400">
                <th className="px-3 py-2 font-medium">款项</th>
                <th className="hidden px-2 py-2 font-medium sm:table-cell">项目</th>
                <th className="px-2 py-2 text-right font-medium">金额</th>
                <th className="hidden px-2 py-2 font-medium md:table-cell">到期日</th>
                <th className="hidden px-2 py-2 font-medium md:table-cell">到账日</th>
                <th className="px-2 py-2 font-medium">状态</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {items.map((p) => {
                const ps = dictOf(PAYMENT_STATUS, p.status)
                return (
                  <tr key={p.id} className="border-b border-[var(--border)] last:border-0 hover:bg-ink-50/60">
                    <td className="px-3 py-2 font-medium text-ink-900">{p.title || '未命名款项'}</td>
                    <td className="hidden max-w-32 truncate px-2 py-2 text-ink-500 sm:table-cell">
                      {projName(p.projectId)}
                    </td>
                    <td className="tabular px-2 py-2 text-right font-bold text-ink-900">{money(p.amount)}</td>
                    <td className="tabular hidden px-2 py-2 text-ink-500 md:table-cell">
                      {p.planDate ? (
                        fmtDate(p.planDate)
                      ) : p.dueDate ? (
                        <span className="text-ink-400">账期至 {fmtDate(p.dueDate)}</span>
                      ) : (
                        '—'
                      )}
                      {p.overdue && (
                        <span className="ml-1 rounded bg-red-50 px-1 text-[9px] font-medium text-red-600">
                          逾期 {p.daysLate} 天
                        </span>
                      )}
                    </td>
                    <td className="tabular hidden px-2 py-2 text-ink-500 md:table-cell">{fmtDate(p.paidDate)}</td>
                    <td className="px-2 py-2">
                      <Badge soft={ps.soft} dot={ps.color}>
                        {ps.label}
                      </Badge>
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-right">
                      {p.status !== 'received' && (
                        <Button
                          variant="ghost"
                          size="icon"
                          title="标记已收"
                          onClick={() => patch.mutate({ id: p.id, body: { ...p, status: 'received' } })}
                        >
                          <CheckCircle2 size={13} className="text-emerald-500" />
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" onClick={() => setEditing(p)}>
                        <Pencil size={12} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => confirm('删除这笔收款？') && del.mutate(p.id)}
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

      {editing !== undefined && (
        <PaymentFormDialog payment={editing} onClose={() => setEditing(undefined)} />
      )}
    </div>
  )
}

function SummaryCard({ label, value, tone }: { label: string; value: string; tone: 'amber' | 'emerald' | 'red' }) {
  const tones = {
    amber: 'text-amber-600 bg-amber-50',
    emerald: 'text-emerald-600 bg-emerald-50',
    red: 'text-red-600 bg-red-50',
  }
  return (
    <div className={cn('rounded-lg border border-[var(--border)] bg-white px-3 py-2')}>
      <p className="text-[10px] text-ink-400">{label}</p>
      <p className={cn('tabular mt-0.5 text-sm font-bold', tones[tone].split(' ')[0])}>{value}</p>
    </div>
  )
}
