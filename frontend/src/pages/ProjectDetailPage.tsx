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
import { Badge, Card, Skeleton, Dialog } from '@/components/ui/Layout'
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
  // 中介结款的快捷录入（预填标题和净额，只需选日期）
  const [payQuick, setPayQuick] = useState(false)
  // 中介「钱已到账」的快捷录入：平台自动确认、次月必结的款不用提前盯，到账当天直接记已收
  const [payInstant, setPayInstant] = useState(false)
  // 「客户确认收货了」的快捷录入：预填确认收货日=今天、金额=剩余待收
  const [payConfirm, setPayConfirm] = useState(false)
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

  // 一键到账：paidDate 不传，后端会自动填今天
  const markReceived = useMutation({
    mutationFn: async (pay: Payment) => api.put(`/payments/${pay.id}`, { ...pay, status: 'received' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project', id] })
      qc.invalidateQueries({ queryKey: ['projects'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['dashboard-badges'] })
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
  // 收款记录的是实际到账（已扣抽成）的钱，进度和待收都要基于净合同额，
  // 否则会把抽成那部分算成一笔永远收不到的欠款。
  const netQuote = p.netQuote ?? p.quote
  const pct = netQuote > 0 ? Math.min(100, (p.received / netQuote) * 100) : 0
  const remain = netQuote - p.received
  // 走中介的项目：客户把钱付给中介，交付验收后中介一次性结给我。
  // 这种没有「首款/尾款」的概念，收款引导要跟直客项目区分开。
  const isBroker = (p.commission ?? 0) > 0

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => navigate('/projects')}>
          <ArrowLeft size={16} />
        </Button>
        <h1 className="truncate text-base font-bold text-ink-900" data-private>
          {p.name}
        </h1>
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
            <Link to="/clients" className="text-[11px] text-sky-600 hover:underline" data-private>
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
          {/* 毛利按净额算：成本是为拿下净额花的，拿含抽成的合同额去减会把抽成算成利润 */}
          <Metric
            label="成本 / 毛利"
            value={`${money(p.cost, false)} / ${money((p.netQuote ?? p.quote) - p.cost, false)}`}
          />
        </div>

        {/* 中介抽成 */}
        {p.commissionType !== 'none' && p.commission > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-amber-200 bg-amber-50/60 px-2.5 py-1.5 text-[11px]">
            <span className="font-semibold text-amber-800">
              中介抽成{' '}
              {p.commissionType === 'pct' ? `${p.commissionRate}%` : money(p.commissionRate)}
            </span>
            <span className="text-ink-500">
              抽走 <b className="tabular text-amber-700">-{money(p.commission)}</b>
            </span>
            <span className="text-ink-500">
              你到手 <b className="tabular text-emerald-600">{money(p.netQuote)}</b>
            </span>
            {p.broker && <span className="text-ink-400">渠道：{p.broker}</span>}
          </div>
        )}
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
            <Wallet size={13} className="text-emerald-600" /> 收款记录
            <span className="text-[10px] font-normal text-ink-400">({data.payments.length})</span>
          </h3>
          {isBroker && data.payments.length === 0 ? (
            // 空态里已经有「记中介结款」的主按钮，这里不再重复
            <span className="text-[10px] text-ink-400">走中介</span>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setPayDialog(null)}>
              <Plus size={13} /> 添加
            </Button>
          )}
        </div>

        {data.payments.length === 0 ? (
          isBroker ? (
            <BrokerEmptyState
              net={remain}
              broker={p.broker}
              onAdd={() => setPayQuick(true)}
              onInstant={() => setPayInstant(true)}
              onDivide={() => setPayDialog(null)}
            />
          ) : (
            <ConfirmPayEmptyState
              net={remain}
              onConfirm={() => setPayConfirm(true)}
              onManual={() => setPayDialog(null)}
            />
          )
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-[10px] uppercase tracking-wide text-ink-400">
                <th className="px-3 py-1.5 font-medium">款项</th>
                <th className="px-2 py-1.5 font-medium">金额</th>
                <th className="px-2 py-1.5 font-medium">到期日</th>
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
                    <td className="tabular px-2 py-1.5 text-ink-500">
                      {pay.planDate ? (
                        fmtDate(pay.planDate)
                      ) : pay.dueDate ? (
                        <span className="text-ink-400">账期至 {fmtDate(pay.dueDate)}</span>
                      ) : (
                        '—'
                      )}
                      {pay.overdue && (
                        <span className="ml-1 rounded bg-red-50 px-1 text-[9px] font-medium text-red-600">
                          逾期 {pay.daysLate} 天
                        </span>
                      )}
                    </td>
                    <td className="tabular px-2 py-1.5 text-ink-500">{fmtDate(pay.paidDate)}</td>
                    <td className="px-2 py-1.5">
                      <Badge soft={ps.soft} dot={ps.color}>
                        {ps.label}
                      </Badge>
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      {pay.status !== 'received' && (
                        <Button
                          variant="ghost"
                          size="icon"
                          title="标记到账"
                          onClick={() => markReceived.mutate(pay)}
                        >
                          <CheckCircle2 size={13} className="text-emerald-500" />
                        </Button>
                      )}
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
      {payQuick && (
        <PaymentFormDialog
          payment={null}
          defaultProjectId={p.id}
          defaultTitle="中介结款"
          defaultAmount={remain > 0 ? remain : undefined}
          hintText={`走中介的项目通常就一笔：客户把钱付给中介，你交付验收后中介结给你。填上${p.broker ? `「${p.broker}」` : '中介'}说的结款日期，到点没到账会自动标逾期。`}
          onClose={() => setPayQuick(false)}
        />
      )}
      {payInstant && (
        <PaymentFormDialog
          payment={null}
          defaultProjectId={p.id}
          defaultTitle="中介结款"
          defaultAmount={remain > 0 ? remain : undefined}
          defaultStatus="received"
          defaultPaidDate={todayInput()}
          hintText="适合平台自动确认收货、次月必结的款：不用提前盯着，钱到账当天记一笔就行。"
          onClose={() => setPayInstant(false)}
        />
      )}
      {payConfirm && (
        <PaymentFormDialog
          payment={null}
          defaultProjectId={p.id}
          defaultTitle="验收结款"
          defaultAmount={remain > 0 ? remain : undefined}
          defaultConfirmDate={todayInput()}
          confirmDelivery
          hintText="已按今天记下「客户确认收货」。约定日留空的话，拖过账期还没到账会自动标逾期；项目状态也会一起切成「已交付」。"
          onClose={() => setPayConfirm(false)}
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

// 本地时区的今天，YYYY-MM-DD，用作确认收货日的默认值
function todayInput() {
  const d = new Date()
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// 直客项目的收款空态：先干活后收钱，这里空着才正常。
// 主推「确认收货」这一步——把验收时点记下来，账期从这天起算，拖着不结会自己变逾期。
function ConfirmPayEmptyState({
  net,
  onConfirm,
  onManual,
}: {
  net: number
  onConfirm: () => void
  onManual: () => void
}) {
  return (
    <div className="px-3 py-4">
      <div className="rounded-lg border border-brand-200 bg-brand-50/50 px-3 py-2.5">
        <p className="text-[11px] font-semibold text-brand-700">
          先干活，客户确认收货后再来记收款，完全来得及
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-ink-500">
          客户（或中介）点头的那一刻点下面的按钮：记一笔应收、把今天存成确认收货日，
          之后超过账期还没到账会自动标逾期。
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={onConfirm}>
            <CheckCircle2 size={13} /> 客户确认收货了 · 记应收{net > 0 ? ` ${money(net)}` : ''}
          </Button>
          <span className="text-[10px] text-ink-400">金额按剩余待收预填，可改</span>
        </div>
        <button
          onClick={onManual}
          className="mt-2 text-[10px] text-ink-400 underline decoration-dotted hover:text-ink-600"
        >
          收定金或分几次结？手动添加
        </button>
      </div>
    </div>
  )
}

// 中介项目的收款空态：强调「就一笔」，而不是引导用户去拆分期。
// 两种记法：要盯的提前记约定日（超时自动标逾期）；
// 平台自动确认、稳到账的，等钱到了直接记一笔已收。
function BrokerEmptyState({
  net,
  broker,
  onAdd,
  onInstant,
  onDivide,
}: {
  net: number
  broker?: string
  onAdd: () => void
  onInstant: () => void
  onDivide: () => void
}) {
  return (
    <div className="px-3 py-4">
      <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2.5">
        <p className="text-[11px] font-semibold text-amber-800">
          这个项目走中介，通常只有一笔收款
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-ink-500">
          客户把钱付给{broker ? `「${broker}」` : '中介'}，你开发交付、客户确认收货后，
          中介再结给你。所以只需要记一条：<b className="text-ink-700">中介欠你多少、说好哪天结</b>。
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={onAdd}>
            <Plus size={13} /> 记中介结款{net > 0 ? ` ${money(net)}` : ''}
          </Button>
          <Button size="sm" variant="outline" onClick={onInstant}>
            <CheckCircle2 size={13} /> 钱已到账 · 直接记已收
          </Button>
        </div>
        <p className="mt-1.5 text-[10px] leading-relaxed text-ink-400">
          左边提前记好约定日期，到点没到账自动标逾期；像平台自动确认收货、次月必结的，
          用右边等钱到了记一笔就行。
        </p>
        <button
          onClick={onDivide}
          className="mt-2 text-[10px] text-ink-400 underline decoration-dotted hover:text-ink-600"
        >
          中介也分几次给？手动添加多笔
        </button>
      </div>
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
