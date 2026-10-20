import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  Wallet,
  Plus,
  Trash2,
  Pencil,
  FolderOpen,
  Globe,
  ExternalLink,
  GitBranch,
  Server,
  CheckCircle2,
  Clock,
  BellRing,
} from 'lucide-react'
import {
  api,
  errMsg,
  type Client,
  type Milestone,
  type Payment,
  type Project,
  type Reminder,
  type Task,
} from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Badge, Card, EmptyState, Skeleton, Dialog } from '@/components/ui/Layout'
import {
  cn,
  money,
  fmtDate,
  minutesToHours,
  dictOf,
  PROJECT_KIND,
  PROJECT_STATUS,
  PAYMENT_STATUS,
  TASK_STATUS,
  REMINDER_CATEGORY,
} from '@/lib/utils'
import { ProjectFormDialog } from './ProjectFormDialog'
import { PaymentFormDialog } from './PaymentFormDialog'
import { MilestoneFormDialog } from './MilestoneFormDialog'
import { MilestoneTimeline } from '@/components/MilestoneTimeline'
import { GitBranch as GitBranchIcon } from 'lucide-react'

interface Detail {
  project: Project
  payments: Payment[]
  tasks: Task[]
  client: Client | null
  reminders: Reminder[]
  milestones: Milestone[]
}

export default function ProjectDetailPage() {
  const { id } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [payDialog, setPayDialog] = useState<Payment | null | undefined>(undefined)
  // undefined=关闭, null=新建, 对象=编辑
  const [msDialog, setMsDialog] = useState<Milestone | null | undefined>(undefined)

  const { data, isLoading } = useQuery({
    queryKey: ['project', id],
    queryFn: async () => (await api.get<Detail>(`/projects/${id}`)).data,
  })

  // 从项目卡片点击「进度」跳转过来时，自动滚到进度区
  useEffect(() => {
    if (location.hash !== '#milestones') return
    const el = document.getElementById('milestones')
    if (!el) return
    const t = setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120)
    return () => clearTimeout(t)
  }, [location.hash, data])

  const delPay = useMutation({
    mutationFn: async (pid: number) => api.delete(`/payments/${pid}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project', id] })
      qc.invalidateQueries({ queryKey: ['projects'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })

  if (isLoading || !data) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-40" />
        <Skeleton className="h-56" />
      </div>
    )
  }

  const p = data.project
  const kd = dictOf(PROJECT_KIND, p.kind)
  const sd = dictOf(PROJECT_STATUS, p.status)
  const pct = p.quote > 0 ? Math.min(100, (p.received / p.quote) * 100) : 0
  const remain = p.quote - p.received

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => navigate('/projects')}>
          <ArrowLeft size={16} />
        </Button>
        <h1 className="truncate text-base font-bold text-ink-900">{p.name}</h1>
        <div className="ml-auto flex gap-1">
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            <Pencil size={13} /> 编辑
          </Button>
        </div>
      </div>

      {/* 概览 */}
      <Card>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge soft={kd.soft} dot={kd.color}>
            {kd.label}
          </Badge>
          <Badge soft={sd.soft} dot={sd.color}>
            {sd.label}
          </Badge>
          {p.tags.map((t) => (
            <Badge key={t}>{t}</Badge>
          ))}
          {data.client && (
            <Link to="/clients" className="text-[11px] text-sky-600 hover:underline">
              客户：{data.client.name}
            </Link>
          )}
          {p.techStack && <span className="ml-auto text-[11px] text-ink-400">{p.techStack}</span>}
        </div>

        {p.summary && <p className="mt-2 text-xs leading-relaxed text-ink-500">{p.summary}</p>}

        {/* 财务 */}
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Metric label="合同金额" value={money(p.quote)} />
          <Metric label="已收" value={money(p.received)} tone="emerald" />
          <Metric label="待收" value={money(remain > 0 ? remain : 0)} tone="amber" />
          <Metric label="成本 / 毛利" value={`${money(p.cost, false)} / ${money(p.received - p.cost, false)}`} />
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-ink-100">
          <div
            className={cn('h-full rounded-full', pct >= 100 ? 'bg-emerald-500' : 'bg-brand-500')}
            style={{ width: `${pct}%` }}
          />
        </div>

        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 border-t border-[var(--border)] pt-2.5 text-[11px]">
          {p.sourcePath && <AssetItem icon={<FolderOpen size={12} />} label="源码" value={p.sourcePath} />}
          {p.onlineUrl && <AssetItem icon={<Globe size={12} />} label="线上" value={p.onlineUrl} href={p.onlineUrl} />}
          {p.adminUrl && (
            <AssetItem icon={<ExternalLink size={12} />} label="后台" value={p.adminUrl} href={p.adminUrl} />
          )}
          {p.gitRepo && <AssetItem icon={<GitBranch size={12} />} label="仓库" value={p.gitRepo} href={p.gitRepo} />}
          {p.deployAt && <AssetItem icon={<Server size={12} />} label="部署" value={p.deployAt} />}
        </div>

        <div className="mt-2 flex flex-wrap gap-4 text-[11px] text-ink-400">
          {p.startDate && <span>开始 {fmtDate(p.startDate)}</span>}
          {p.dueDate && (
            <span className={cn(new Date(p.dueDate) < new Date() && p.status !== 'paid' && 'text-red-500')}>
              截止 {fmtDate(p.dueDate)}
            </span>
          )}
          <span>
            工时 {minutesToHours(p.actualMinutes)} / 预计 {minutesToHours(p.estimateMinutes)}
          </span>
        </div>
      </Card>

      {/* 收款 */}
      <Card padding={false}>
        <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold text-ink-900">
            <Wallet size={13} className="text-emerald-600" /> 收款安排
            <span className="text-[10px] font-normal text-ink-400">({data.payments.length})</span>
          </h3>
          <Button size="sm" variant="outline" onClick={() => setPayDialog(null)}>
            <Plus size={13} /> 添加
          </Button>
        </div>
        {data.payments.length === 0 ? (
          <EmptyState title="还没有收款记录" desc="按分期添加，追踪每笔到账" />
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-[10px] uppercase tracking-wide text-ink-400">
                <th className="px-3 py-1.5 font-medium">款项</th>
                <th className="px-2 py-1.5 font-medium">金额</th>
                <th className="px-2 py-1.5 font-medium">约定日</th>
                <th className="px-2 py-1.5 font-medium">到账日</th>
                <th className="px-2 py-1.5 font-medium">状态</th>
                <th className="px-2 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {data.payments.map((pay) => {
                const ps = dictOf(PAYMENT_STATUS, pay.status)
                return (
                  <tr key={pay.id} className="border-b border-[var(--border)] last:border-0 hover:bg-ink-50/60">
                    <td className="px-3 py-1.5 font-medium text-ink-900">{pay.title || '—'}</td>
                    <td className="tabular px-2 py-1.5 font-semibold text-ink-900">{money(pay.amount)}</td>
                    <td className="tabular px-2 py-1.5 text-ink-500">{fmtDate(pay.planDate)}</td>
                    <td className="tabular px-2 py-1.5 text-ink-500">{fmtDate(pay.paidDate)}</td>
                    <td className="px-2 py-1.5">
                      <Badge soft={ps.soft} dot={ps.color}>
                        {ps.label}
                      </Badge>
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <Button variant="ghost" size="icon" onClick={() => setPayDialog(pay)}>
                        <Pencil size={12} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => confirm('删除这笔收款？') && delPay.mutate(pay.id)}
                      >
                        <Trash2 size={12} className="text-red-400" />
                      </Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Card>

      {/* 任务 + 提醒 */}
      <div className="grid gap-3 lg:grid-cols-2">
        <Card padding={false}>
          <div className=" border-b border-[var(--border)] px-3 py-2">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold text-ink-900">
              <CheckCircle2 size={13} className="text-brand-500" /> 关联任务
              <span className="text-[10px] font-normal text-ink-400">({data.tasks.length})</span>
            </h3>
          </div>
          <div className="p-1.5">
            {data.tasks.length === 0 ? (
              <p className="py-5 text-center text-xs text-ink-400">还没有关联任务</p>
            ) : (
              data.tasks.map((t) => {
                const ts = dictOf(TASK_STATUS, t.status)
                return (
                  <div key={t.id} className="flex items-center gap-2 rounded-md px-1.5 py-1.5 hover:bg-ink-50">
                    <span className={cn('dot', ts.color)} />
                    <span className={cn('truncate text-xs', t.status === 'done' && 'text-ink-400 line-through')}>
                      {t.title}
                    </span>
                    <Badge soft={ts.soft} className="ml-auto shrink-0">
                      {ts.label}
                    </Badge>
                  </div>
                )
              })
            )}
          </div>
        </Card>

        <Card padding={false} id="milestones" className="scroll-mt-16">
          <div className="border-b border-[var(--border)] px-3 py-2">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold text-ink-900">
              <GitBranchIcon size={13} className="text-brand-500" /> 项目进度
              <span className="text-[10px] font-normal text-ink-400">
                ({data.milestones?.length ?? 0})
              </span>
            </h3>
          </div>
          <div className="p-3">
            <MilestoneTimeline
              items={data.milestones ?? []}
              onEdit={(m) => setMsDialog(m)}
              onAdd={() => setMsDialog(null)}
            />
          </div>
        </Card>

        <Card padding={false}>
          <div className="border-b border-[var(--border)] px-3 py-2">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold text-ink-900">
              <BellRing size={13} className="text-rose-500" /> 到期提醒
              <span className="text-[10px] font-normal text-ink-400">({data.reminders.length})</span>
            </h3>
          </div>
          <div className="p-1.5">
            {data.reminders.length === 0 ? (
              <p className="py-5 text-center text-xs text-ink-400">没有关联提醒</p>
            ) : (
              data.reminders.map((r) => {
                const rd = dictOf(REMINDER_CATEGORY, r.category)
                const expired = new Date(r.expireAt) < new Date()
                return (
                  <div key={r.id} className="flex items-center gap-2 rounded-md px-1.5 py-1.5 hover:bg-ink-50">
                    <span className={cn('dot', expired ? 'bg-red-500' : rd.color)} />
                    <span className="truncate text-xs">{r.title}</span>
                    <Badge soft={rd.soft} className="ml-auto shrink-0">
                      {fmtDate(r.expireAt)}
                    </Badge>
                  </div>
                )
              })
            )}
          </div>
        </Card>
      </div>

      {p.note && (
        <Card>
          <h3 className="mb-1 text-xs font-semibold text-ink-900">备注</h3>
          <p className="whitespace-pre-wrap text-xs leading-relaxed text-ink-500">{p.note}</p>
        </Card>
      )}

      {editing && <ProjectFormDialog project={p} onClose={() => setEditing(false)} />}
      {payDialog !== undefined && (
        <PaymentFormDialog
          payment={payDialog}
          defaultProjectId={p.id}
          onClose={() => setPayDialog(undefined)}
        />
      )}
      {msDialog !== undefined && (
        <MilestoneFormDialog
          milestone={msDialog}
          projectId={p.id}
          onClose={() => setMsDialog(undefined)}
        />
      )}
    </div>
  )
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'emerald' | 'amber' }) {
  return (
    <div className="rounded-md bg-ink-50/70 px-2 py-1.5">
      <p className="text-[10px] text-ink-400">{label}</p>
      <p
        className={cn(
          'tabular text-[13px] font-bold',
          tone === 'emerald' ? 'text-emerald-600' : tone === 'amber' ? 'text-amber-600' : 'text-ink-900',
        )}
      >
        {value}
      </p>
    </div>
  )
}

function AssetItem({
  icon,
  label,
  value,
  href,
}: {
  icon: React.ReactNode
  label: string
  value: string
  href?: string
}) {
  const content = (
    <span className="flex min-w-0 items-center gap-1">
      <span className="text-ink-400">{icon}</span>
      <span className="text-ink-400">{label}</span>
      <span className={cn('truncate', href ? 'text-sky-600 hover:underline' : 'text-ink-600')}>{value}</span>
    </span>
  )
  if (href)
    return (
      <a href={href} target="_blank" rel="noreferrer" className="max-w-full">
        {content}
      </a>
    )
  return <span className="max-w-full">{content}</span>
}
