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
  Ticket,
} from 'lucide-react'
import {
  api,
  type Client,
  type Milestone,
  type Payment,
  type Project,
  type Reminder,
  type Task,
  type WorkLog,
} from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Badge, Card, Skeleton } from '@/components/ui/Layout'
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
import { WorkLogFormDialog } from './WorkLogFormDialog'
import { TaskFormDialog } from './TaskFormDialog'
import { TaskQuickDialog } from './TaskQuickDialog'
import { TaskCompleteDialog } from '@/components/TaskCompleteDialog'
import { MilestoneTimeline } from '@/components/MilestoneTimeline'
import { GitBranch as GitBranchIcon } from 'lucide-react'

interface Detail {
  project: Project
  payments: Payment[]
  tasks: Task[]
  client: Client | null
  reminders: Reminder[]
  milestones: Milestone[]
  workLogs: WorkLog[]
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
  const [logDialog, setLogDialog] = useState<WorkLog | null | undefined>(undefined)
  // undefined=关闭, null=新建（预填当前项目）, 对象=编辑
  const [taskDialog, setTaskDialog] = useState<Task | null | undefined>(undefined)
  // 点任务时先开轻量面板，需要改更多字段再进完整编辑
  const [quickTask, setQuickTask] = useState<Task | null>(null)
  // 推进到已完成且填过预计工时时，先问实际用了多久
  const [completeTask, setCompleteTask] = useState<Task | null>(null)
  const [quickTitle, setQuickTitle] = useState('')
  // 已完成/已取消默认收起，避免长列表把工作区撑开
  const [showClosed, setShowClosed] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['project', id],
    queryFn: async () => (await api.get<Detail>('/projects/' + id)).data,
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
    mutationFn: async (pid: number) => api.delete('/payments/' + pid),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project', id] })
      qc.invalidateQueries({ queryKey: ['projects'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })

  // 客户提报链接：生成 / 换新 / 撤销
  const feedback = useMutation({
    mutationFn: async (action: 'create' | 'rotate' | 'revoke') => {
      if (action === 'create') return (await api.post('/projects/' + id + '/feedback-token')).data
      if (action === 'rotate') return (await api.post('/projects/' + id + '/feedback-token/rotate')).data
      return (await api.delete('/projects/' + id + '/feedback-token')).data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project', id] }),
  })

  const delLog = useMutation({
    mutationFn: async (lid: number) => api.delete('/worklogs/' + lid),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project', id] })
      qc.invalidateQueries({ queryKey: ['projects'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })

  // 一键记工时：默认记今天，内容先写「开发」，要详细再进自定义
  const quickLog = useMutation({
    mutationFn: async (minutes: number) =>
      api.post('/projects/' + id + '/worklogs', { workDate: todayInput(), minutes, content: '开发' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project', id] })
      qc.invalidateQueries({ queryKey: ['projects'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })

  // 一键到账：paidDate 不传，后端会自动填今天
  const markReceived = useMutation({
    mutationFn: async (pay: Payment) => api.put('/payments/' + pay.id, { ...pay, status: 'received' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project', id] })
      qc.invalidateQueries({ queryKey: ['projects'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['dashboard-badges'] })
    },
  })

  // 项目页是高频入口：输入标题回车即建任务，归属和客户自动带上
  const quickAdd = useMutation({
    mutationFn: async (title: string) =>
      api.post('/tasks', {
        title,
        projectId: Number(id),
        clientId: data?.project.clientId ?? null,
        kind: data?.project.kind === 'outsource' ? 'freelance' : data?.project.kind,
        status: 'todo',
        priority: 'normal',
      }),
    onSuccess: taskListChanged,
  })

  // 点状态徽章直接推进，不进编辑框
  const taskStatus = useMutation({
    mutationFn: async ({ tid, ...body }: { tid: number } & Record<string, unknown>) =>
      api.put('/tasks/' + tid, body),
    onSuccess: taskListChanged,
  })

  const delTask = useMutation({
    mutationFn: async (tid: number) => api.delete('/tasks/' + tid),
    onSuccess: taskListChanged,
  })

  function taskListChanged() {
    qc.invalidateQueries({ queryKey: ['project', id] })
    qc.invalidateQueries({ queryKey: ['tasks'] })
    qc.invalidateQueries({ queryKey: ['dashboard'] })
    qc.invalidateQueries({ queryKey: ['dashboard-badges'] })
  }

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
  const isHourly = p.billingMode === 'hourly'
  // 公司项目不走自己的收款流程，财务和收款相关区块都不展示
  const isCompany = p.kind === 'company'
  const workMinutes = (data.workLogs ?? []).reduce((s, l) => s + l.minutes, 0)
  const todayMinutes = (data.workLogs ?? [])
    .filter((l) => fmtDate(l.workDate) === todayInput())
    .reduce((s, l) => s + l.minutes, 0)

  const msItems = data.milestones ?? []
  const msTotal = msItems.filter((m) => m.status !== 'canceled').length
  const msDone = msItems.filter((m) => m.status === 'done').length

  const tasksBy = (s: Task['status']) => data.tasks.filter((t) => t.status === s)
  const openGroups: { key: Task['status']; label: string }[] = [
    { key: 'todo', label: '待办' },
    { key: 'doing', label: '进行中' },
    { key: 'review', label: '待验收' },
  ]
  const closedTasks = [...tasksBy('done'), ...tasksBy('canceled')]
  const taskDoneCount = tasksBy('done').length

  return (
    <div className="space-y-3">
      {/* 顶部：项目名 + 关键数字 + 操作，一行看完，不再占整屏 */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Button variant="ghost" size="icon" onClick={() => navigate('/projects')}>
          <ArrowLeft size={16} />
        </Button>
        <h1 className="min-w-0 truncate text-base font-bold text-ink-900" data-private>
          {p.name}
        </h1>
        <Badge soft={kd.soft} dot={kd.color}>
          {kd.label}
        </Badge>
        <Badge soft={sd.soft} dot={sd.color}>
          {sd.label}
        </Badge>
        <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-500">
          {!isCompany && (
            <span>
              待收 <b className="tabular text-amber-600">{money(remain > 0 ? remain : 0)}</b>
            </span>
          )}
          <span>
            工时 <b className="tabular text-ink-800">{minutesToHours(workMinutes)}</b>
          </span>
          <span>
            进度 <b className="tabular text-ink-800">{msDone}/{msTotal}</b>
          </span>
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            <Pencil size={13} /> 编辑
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
      {/* ① 任务：项目里最高频的操作，放第一块 */}
      <Card padding={false}>
        <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold text-ink-900">
            <CheckCircle2 size={13} className="text-brand-500" /> 任务
            <span className="text-[10px] font-normal text-ink-400">
              已完成 {taskDoneCount}/{data.tasks.length}
            </span>
          </h3>
          <Button size="sm" variant="outline" onClick={() => setTaskDialog(null)}>
            <Plus size={13} /> 新建
          </Button>
        </div>
        <div className="p-1.5">
          <input
            value={quickTitle}
            onChange={(e) => setQuickTitle(e.target.value)}
            onKeyDown={(e) => {
              const title = quickTitle.trim()
              if (e.key !== 'Enter' || !title) return
              quickAdd.mutate(title)
              setQuickTitle('')
            }}
            placeholder="＋ 输入任务标题，回车即添加"
            className="mb-1 h-8 w-full rounded-md bg-ink-50/70 px-2 text-xs text-ink-800 outline-none placeholder:text-ink-400 focus:bg-white focus:ring-1 focus:ring-brand-300"
          />
          {data.tasks.length === 0 && (
            <p className="py-4 text-center text-xs text-ink-400">还没有任务，输入标题回车就能加</p>
          )}
          {openGroups.map(({ key, label }) => {
            const list = tasksBy(key)
            if (!list.length) return null
            return (
              <div key={key} className="mb-1 last:mb-0">
                <p className="px-1.5 pb-0.5 pt-1 text-[10px] font-medium text-ink-400">
                  {label} {list.length}
                </p>
                {list.map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    onEdit={() => setQuickTask(t)}
                    onAdvance={() => {
                      const next = nextTaskStatus(t.status)
                      if (next === 'done' && (t.estimateMinutes ?? 0) > 0 && !(t.actualMinutes ?? 0)) {
                        setCompleteTask(t)
                        return
                      }
                      taskStatus.mutate({ tid: t.id, status: next })
                    }}
                    onDelete={() => confirm('删除任务「' + t.title + '」？') && delTask.mutate(t.id)}
                  />
                ))}
              </div>
            )
          })}
          {closedTasks.length > 0 && (
            <div className="mt-1 border-t border-[var(--border)] pt-1">
              <button
                type="button"
                onClick={() => setShowClosed((v) => !v)}
                className="w-full rounded px-1.5 py-1 text-left text-[10px] text-ink-400 hover:bg-ink-50 hover:text-ink-600"
              >
                {showClosed ? '收起' : '已完成 / 已取消 ' + closedTasks.length}
              </button>
              {showClosed &&
                closedTasks.map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    onEdit={() => setQuickTask(t)}
                    onAdvance={() => {
                      const next = nextTaskStatus(t.status)
                      if (next === 'done' && (t.estimateMinutes ?? 0) > 0 && !(t.actualMinutes ?? 0)) {
                        setCompleteTask(t)
                        return
                      }
                      taskStatus.mutate({ tid: t.id, status: next })
                    }}
                    onDelete={() => confirm('删除任务「' + t.title + '」？') && delTask.mutate(t.id)}
                  />
                ))}
            </div>
          )}
        </div>
      </Card>
        </div>
        <div className="min-w-0 space-y-3">

      {/* ② 工时：按工时计费的项目，一键打卡，不用开对话框 */}
      {isHourly && (
        <Card padding={false}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-3 py-2">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold text-ink-900">
              <Clock size={13} className="text-cyan-600" /> 工时
              <span className="text-[10px] font-normal text-ink-400">
                今天 {minutesToHours(todayMinutes)} · 累计 {minutesToHours(workMinutes)}
                {!isCompany && ' · 应结 ' + money(p.quote)}
              </span>
            </h3>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="outline" loading={quickLog.isPending} onClick={() => quickLog.mutate(30)}>
                +30m
              </Button>
              <Button size="sm" variant="outline" loading={quickLog.isPending} onClick={() => quickLog.mutate(60)}>
                +1h
              </Button>
              <Button size="sm" variant="outline" loading={quickLog.isPending} onClick={() => quickLog.mutate(120)}>
                +2h
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setLogDialog(null)}>
                自定义
              </Button>
            </div>
          </div>

          {data.workLogs.length === 0 ? (
            <div className="px-3 py-4 text-center">
              <p className="text-xs text-ink-400">还没有工时记录</p>
              <p className="mt-1 text-[11px] text-ink-400">
                点上面的 +30m / +1h 直接记今天{!isCompany && '，累计工时 × 时薪就是应结金额'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-[10px] uppercase tracking-wide text-ink-400">
                  <th className="px-3 py-1.5 font-medium">日期</th>
                  <th className="px-2 py-1.5 font-medium">工时</th>
                  <th className="px-2 py-1.5 font-medium">工作内容</th>
                  {!isCompany && <th className="px-2 py-1.5 font-medium">金额</th>}
                  <th className="px-2 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {data.workLogs.slice(0, 5).map((l) => (
                  <tr key={l.id} className="border-b border-[var(--border)] last:border-0 hover:bg-ink-50/60">
                    <td className="tabular whitespace-nowrap px-3 py-1.5 text-ink-500">{fmtDate(l.workDate)}</td>
                    <td className="tabular whitespace-nowrap px-2 py-1.5 font-semibold text-ink-900">
                      {minutesToHours(l.minutes)}
                    </td>
                    <td className="whitespace-pre-wrap px-2 py-1.5 text-ink-600">{l.content}</td>
                    {!isCompany && (
                      <td className="tabular whitespace-nowrap px-2 py-1.5 text-ink-700">
                        {money((l.minutes / 60) * p.hourlyRate)}
                      </td>
                    )}
                    <td className="whitespace-nowrap px-2 py-1.5 text-right">
                      <Button variant="ghost" size="icon" onClick={() => setLogDialog(l)}>
                        <Pencil size={12} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => confirm('删除这条工时记录？') && delLog.mutate(l.id)}
                      >
                        <Trash2 size={12} className="text-red-400" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </Card>
      )}

      {/* ③ 进度：默认只露出当前和下一个节点，需要时展开 */}
      <Card padding={false} id="milestones" className="scroll-mt-16">
        <div className="border-b border-[var(--border)] px-3 py-2">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold text-ink-900">
            <GitBranchIcon size={13} className="text-brand-500" /> 项目进度
            <span className="text-[10px] font-normal text-ink-400">
              ({msDone}/{msTotal})
            </span>
          </h3>
        </div>
        <div className="p-3">
          <MilestoneTimeline
            compact
            items={msItems}
            onEdit={(m) => setMsDialog(m)}
            onAdd={() => setMsDialog(null)}
          />
        </div>
      </Card>
        </div>
      </div>

      {/* ④ 收款：公司项目不走这里 */}
      {!isCompany && (
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
            <div className="overflow-x-auto">
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
            </div>
          )}
        </Card>
      )}

      {/* ⑤ 到期提醒：没有就不占位置 */}
      {data.reminders.length > 0 && (
        <Card padding={false}>
          <div className="border-b border-[var(--border)] px-3 py-2">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold text-ink-900">
              <BellRing size={13} className="text-rose-500" /> 到期提醒
              <span className="text-[10px] font-normal text-ink-400">({data.reminders.length})</span>
            </h3>
          </div>
          <div className="p-1.5">
            {data.reminders.map((r) => {
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
            })}
          </div>
        </Card>
      )}

      {/* ⑥ 项目资料：客户、金额、资产、提报链接、备注，默认收起 */}
      <Card padding={false}>
        <details>
          <summary className="cursor-pointer list-none px-3 py-2 text-xs font-semibold text-ink-700 hover:bg-ink-50/60">
            项目资料
            <span className="ml-1.5 text-[10px] font-normal text-ink-400">
              客户 · 金额 · 资产 · 提报链接 · 备注
            </span>
          </summary>
          <div className="space-y-2.5 border-t border-[var(--border)] px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
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

            {p.summary && <p className="text-xs leading-relaxed text-ink-500">{p.summary}</p>}

            {!isCompany && (
              <>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Metric label={isHourly ? '应结金额' : '合同金额'} value={money(p.quote)} />
                  <Metric label="已收" value={money(p.received)} tone="emerald" />
                  <Metric label="待收" value={money(remain > 0 ? remain : 0)} tone="amber" />
                  {/* 毛利按净额算：成本是为拿下净额花的，拿含抽成的合同额去减会把抽成算成利润 */}
                  <Metric
                    label="成本 / 毛利"
                    value={money(p.cost, false) + ' / ' + money((p.netQuote ?? p.quote) - p.cost, false)}
                  />
                </div>

                {isHourly && (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-cyan-200 bg-cyan-50/60 px-2.5 py-1.5 text-[11px] text-cyan-800">
                    <span className="font-semibold">按工时计费</span>
                    <span>时薪 {money(p.hourlyRate)}/小时</span>
                    <span>
                      累计 <b className="tabular">{minutesToHours(workMinutes)}</b> · 应结{' '}
                      <b className="tabular">{money(p.quote)}</b>
                    </span>
                  </div>
                )}

                {/* 中介抽成 */}
                {p.commissionType !== 'none' && p.commission > 0 && (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-amber-200 bg-amber-50/60 px-2.5 py-1.5 text-[11px]">
                    <span className="font-semibold text-amber-800">
                      中介抽成 {p.commissionType === 'pct' ? p.commissionRate + '%' : money(p.commissionRate)}
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
                <div className="h-2 overflow-hidden rounded-full bg-ink-100">
                  <div
                    className={cn('h-full rounded-full', pct >= 100 ? 'bg-emerald-500' : 'bg-brand-500')}
                    style={{ width: pct + '%' }}
                  />
                </div>
              </>
            )}

            <div className="flex flex-wrap gap-x-5 gap-y-1.5 border-t border-[var(--border)] pt-2.5 text-[11px]">
              {p.sourcePath && <AssetItem icon={<FolderOpen size={12} />} label="源码" value={p.sourcePath} />}
              {p.onlineUrl && <AssetItem icon={<Globe size={12} />} label="线上" value={p.onlineUrl} href={p.onlineUrl} />}
              {p.adminUrl && (
                <AssetItem icon={<ExternalLink size={12} />} label="后台" value={p.adminUrl} href={p.adminUrl} />
              )}
              {p.gitRepo && <AssetItem icon={<GitBranch size={12} />} label="仓库" value={p.gitRepo} href={p.gitRepo} />}
              {p.deployAt && <AssetItem icon={<Server size={12} />} label="部署" value={p.deployAt} />}
            </div>

            {/* 客户提报链接：客户免登录提交问题，只能提报，看不到任何已有工单 */}
            <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-2.5 text-[11px]">
              <span className="flex items-center gap-1 text-ink-500">
                <Ticket size={12} /> 客户提报
              </span>
              {p.feedbackToken ? (
                <>
                  <span className="min-w-0 flex-1 truncate text-ink-400">
                    {window.location.origin + '/feedback/' + p.feedbackToken}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      navigator.clipboard?.writeText(window.location.origin + '/feedback/' + p.feedbackToken)
                    }
                  >
                    复制
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={feedback.isPending}
                    onClick={() => {
                      if (confirm('换新后旧链接立即失效，已经发给客户的链接会打不开。确定？')) {
                        feedback.mutate('rotate')
                      }
                    }}
                  >
                    换新
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={feedback.isPending}
                    onClick={() => {
                      if (confirm('撤销后客户手上的链接立即失效，确定？')) feedback.mutate('revoke')
                    }}
                  >
                    撤销
                  </Button>
                </>
              ) : (
                <>
                  <span className="text-ink-400">还没生成</span>
                  <Button size="sm" variant="outline" loading={feedback.isPending} onClick={() => feedback.mutate('create')}>
                    生成链接
                  </Button>
                </>
              )}
            </div>

            <div className="flex flex-wrap gap-4 text-[11px] text-ink-400">
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

            {p.note && (
              <p className="whitespace-pre-wrap border-t border-[var(--border)] pt-2 text-xs leading-relaxed text-ink-500">
                {p.note}
              </p>
            )}
          </div>
        </details>
      </Card>

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
          hintText={
            '走中介的项目通常就一笔：客户把钱付给中介，你交付验收后中介结给你。填上' +
            (p.broker ? '「' + p.broker + '」' : '中介') +
            '说的结款日期，到点没到账会自动标逾期。'
          }
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
      {logDialog !== undefined && (
        <WorkLogFormDialog
          projectId={p.id}
          log={logDialog}
          hourlyRate={p.hourlyRate}
          onClose={() => setLogDialog(undefined)}
        />
      )}
      {completeTask && (
        <TaskCompleteDialog
          task={completeTask}
          onClose={() => setCompleteTask(null)}
          onConfirm={(m) => {
            taskStatus.mutate({ tid: completeTask.id, status: 'done', actualMinutes: m })
            setCompleteTask(null)
          }}
        />
      )}
      {quickTask && (
        <TaskQuickDialog
          task={quickTask}
          onClose={() => setQuickTask(null)}
          onEditFull={() => {
            const t = quickTask
            setQuickTask(null)
            setTaskDialog(t)
          }}
        />
      )}
      {taskDialog !== undefined && (
        <TaskFormDialog
          task={taskDialog}
          defaultProjectId={p.id}
          defaultClientId={p.clientId ?? undefined}
          defaultKind={p.kind === 'outsource' ? 'freelance' : p.kind}
          lockProject
          onClose={() => setTaskDialog(undefined)}
        />
      )}
    </div>
  )
}

// 任务行：点标题编辑，点徽章推进状态，悬停出现删除
function TaskRow({
  task,
  onEdit,
  onAdvance,
  onDelete,
}: {
  task: Task
  onEdit: () => void
  onAdvance: () => void
  onDelete: () => void
}) {
  const ts = dictOf(TASK_STATUS, task.status)
  return (
    <div className="group flex items-center gap-2 rounded-md px-1.5 py-1.5 hover:bg-ink-50">
      <button type="button" onClick={onEdit} className="flex min-w-0 flex-1 items-start gap-2 text-left">
        <span className={cn('dot mt-1', ts.color)} />
        <span
          className={cn(
            'line-clamp-2 text-xs sm:line-clamp-1',
            task.status === 'done' && 'text-ink-400 line-through',
          )}
        >
          {task.title}
        </span>
        {task.dueDate && <span className="shrink-0 text-[10px] text-ink-400">{fmtDate(task.dueDate)}</span>}
      </button>
      <button type="button" title="点一下切换：待办 → 进行中 → 已完成" onClick={onAdvance} className="shrink-0">
        <Badge soft={ts.soft}>{ts.label}</Badge>
      </button>
      <button
        type="button"
        title="删除任务"
        onClick={onDelete}
        className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
      >
        <Trash2 size={12} className="text-ink-300 hover:text-red-500" />
      </button>
    </div>
  )
}

// 项目页点徽章推进状态：常用三步循环，待验收点一下算完成
function nextTaskStatus(s: string) {
  if (s === 'todo') return 'doing'
  if (s === 'doing' || s === 'review') return 'done'
  return 'todo'
}

// 本地时区的今天，YYYY-MM-DD，用作确认收货日的默认值
function todayInput() {
  const d = new Date()
  const p = (x: number) => String(x).padStart(2, '0')
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
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
            <CheckCircle2 size={13} /> 客户确认收货了 · 记应收{net > 0 ? ' ' + money(net) : ''}
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
          客户把钱付给{broker ? '「' + broker + '」' : '中介'}，你开发交付、客户确认收货后，
          中介再结给你。所以只需要记一条：<b className="text-ink-700">中介欠你多少、说好哪天结</b>。
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={onAdd}>
            <Plus size={13} /> 记中介结款{net > 0 ? ' ' + money(net) : ''}
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
