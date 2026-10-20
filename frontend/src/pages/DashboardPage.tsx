import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  Wallet,
  TrendingUp,
  FolderKanban,
  AlertTriangle,
  BellRing,
  CheckSquare,
  ArrowRight,
  CircleDollarSign,
  GitBranch,
} from 'lucide-react'
import { api, type DashboardData } from '@/lib/api'
import { Card, PageHeader, Skeleton, Badge } from '@/components/ui/Layout'
import {
  cn,
  money,
  moneyCompact,
  fmtDateShort,
  dictOf,
  PROJECT_KIND,
  REMINDER_CATEGORY,
} from '@/lib/utils'
import { daysLeftText } from '@/lib/workday'

export default function DashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => {
      const d = (await api.get<DashboardData>('/dashboard')).data
      // 后端未初始化切片的字段可能是 null，统一归一化为数组，
      // 避免空数据账号（新部署）打开总览页直接崩溃。
      return {
        ...d,
        followUps: d.followUps ?? [],
        overdueTasks: d.overdueTasks ?? [],
        pendingPayments: d.pendingPayments ?? [],
        soonReminders: d.soonReminders ?? [],
        monthly: d.monthly ?? [],
        byKind: d.byKind ?? [],
      }
    },
  })

  if (isLoading || !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-40" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    )
  }

  const f = data.finance
  const c = data.counts

  return (
    <div className="space-y-4">
      <PageHeader title="总览" desc="今天的钱、事、期限，一眼看完" />

      {/* 财务卡片 */}
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <StatCard
          icon={<Wallet size={14} />}
          label="累计已收"
          value={money(f.received)}
          tone="emerald"
          hint={`共 ${money(f.quote, false)} 合同额`}
        />
        <StatCard
          icon={<CircleDollarSign size={14} />}
          label="待收金额"
          value={money(f.pending)}
          tone="amber"
          hint={f.unreceived > 0 ? `另有 ${money(f.unreceived)} 未开票/未收` : '全部已结清'}
        />
        <StatCard
          icon={<TrendingUp size={14} />}
          label="预估利润"
          value={money(f.profit)}
          tone="brand"
          hint={`成本 ${money(f.cost, false)}`}
        />
        <StatCard
          icon={<FolderKanban size={14} />}
          label="进行中项目"
          value={String(c.activeProjects)}
          tone="sky"
          hint={`共 ${c.projects} 个项目`}
        />
      </div>

      {/* 图表区 */}
      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <h3 className="text-[13px] font-semibold text-ink-900">近 6 个月收款</h3>
              <p className="text-[11px] text-ink-400">按实际到账日期统计</p>
            </div>
            <Link
              to="/payments"
              className="flex items-center gap-0.5 text-[11px] font-medium text-brand-600 hover:text-brand-700"
            >
              收款台账 <ArrowRight size={12} />
            </Link>
          </div>
          <div className="h-40 sm:h-48">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.monthly} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="gRecv" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f96f12" stopOpacity={0.38} />
                    <stop offset="100%" stopColor="#f96f12" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef1f6" vertical={false} />
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 10, fill: '#9ca3af' }}
                  tickFormatter={(v: string) => v.slice(5) + '月'}
                  axisLine={false}
                  tickLine={false}
                  interval={0}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: '#9ca3af' }}
                  tickFormatter={(v: number) => moneyCompact(v)}
                  axisLine={false}
                  tickLine={false}
                  width={48}
                />
                <Tooltip
                  formatter={(v: any, n: any) => [money(v), n === 'received' ? '已收' : '合同额']}
                  labelFormatter={(l) => `${l}`}
                  contentStyle={{
                    borderRadius: 8,
                    border: '1px solid #e6e9f0',
                    fontSize: 12,
                    boxShadow: '0 4px 16px rgba(11,18,32,.08)',
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="received"
                  stroke="#f96f12"
                  strokeWidth={2}
                  fill="url(#gRecv)"
                  dot={{ r: 2.5, fill: '#f96f12', strokeWidth: 0 }}
                />
                <Area
                  type="monotone"
                  dataKey="quote"
                  stroke="#06b6d4"
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                  fill="none"
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* 按类型 */}
        <Card>
          <h3 className="mb-0.5 text-[13px] font-semibold text-ink-900">收入结构</h3>
          <p className="mb-2 text-[11px] text-ink-400">按项目类型拆分</p>
          <div className="h-28">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data.byKind.map((k) => ({
                  ...k,
                  name: dictOf(PROJECT_KIND, k.kind).label,
                }))}
                margin={{ top: 0, right: 8, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#eef1f6" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                <YAxis
                  tick={{ fontSize: 10, fill: '#9ca3af' }}
                  tickFormatter={(v: number) => moneyCompact(v)}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  formatter={(v: any) => money(v)}
                  contentStyle={{ borderRadius: 8, fontSize: 12, border: '1px solid #e6e9f0' }}
                />
                <Bar dataKey="received" radius={[4, 4, 0, 0]} maxBarSize={32}>
                  {data.byKind.map((k, i) => (
                    <Cell
                      key={i}
                      fill={k.kind === 'outsource' ? '#f96f12' : k.kind === 'company' ? '#0ea5e9' : '#8b5cf6'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 space-y-1.5 border-t border-[var(--border)] pt-2">
            {data.byKind.length === 0 && <p className="text-xs text-ink-400">暂无数据</p>}
            {data.byKind.map((k) => {
              const d = dictOf(PROJECT_KIND, k.kind)
              return (
                <div key={k.kind} className="flex items-center gap-2 text-xs">
                  <span className={cn('dot', d.color)} />
                  <span className="text-ink-600">{d.label}</span>
                  <span className="ml-auto tabular font-semibold text-ink-900">{money(k.received)}</span>
                  <span className="tabular text-[10px] text-ink-400">{k.count}个</span>
                </div>
              )
            })}
          </div>
        </Card>
      </div>

      {/* 待处理三栏 */}
      <div className="grid gap-3 lg:grid-cols-3">
        <ListCard
          title="逾期 / 临期任务"
          count={c.overdueTasks}
          icon={<AlertTriangle size={13} />}
          tone={c.overdueTasks > 0 ? 'red' : 'ink'}
          to="/tasks"
        >
          {data.overdueTasks.length === 0 ? (
            <p className="py-4 text-center text-xs text-ink-400">没有逾期任务 👍</p>
          ) : (
            data.overdueTasks.map((t) => (
              <Link
                key={t.id}
                to="/tasks"
                className="flex items-center gap-2 rounded-md px-1.5 py-1.5 text-xs hover:bg-ink-50"
              >
                <span className="dot bg-red-500" />
                <span className="truncate text-ink-700">{t.title}</span>
                <span className="ml-auto shrink-0 tabular text-[10px] font-semibold text-red-500">
                  {fmtDateShort(t.dueDate)}
                </span>
              </Link>
            ))
          )}
        </ListCard>

        <ListCard
          title="待收款项"
          count={c.unpaidProjects}
          icon={<Wallet size={13} />}
          tone={data.pendingPayments.length > 0 ? 'amber' : 'ink'}
          to="/payments"
        >
          {data.pendingPayments.length === 0 ? (
            <p className="py-4 text-center text-xs text-ink-400">没有待收款项</p>
          ) : (
            data.pendingPayments.map((p) => (
              <Link
                key={p.id}
                to="/payments"
                className="flex items-center gap-2 rounded-md px-1.5 py-1.5 text-xs hover:bg-ink-50"
              >
                <span className="dot bg-amber-500" />
                <span className="truncate text-ink-700">{p.title}</span>
                <span className="ml-auto shrink-0 tabular text-[11px] font-semibold text-amber-600">
                  {money(p.amount)}
                </span>
              </Link>
            ))
          )}
        </ListCard>

        <ListCard
          title="待跟进"
          count={c.followUps}
          icon={<GitBranch size={13} />}
          tone={data.followUps.some((f) => f.daysLeft < 0) ? 'red' : 'amber'}
          to="/projects"
        >
          {data.followUps.length === 0 ? (
            <p className="py-4 text-center text-xs text-ink-400">没有需要核查的进度节点</p>
          ) : (
            data.followUps.map((f) => {
              const overdue = f.daysLeft < 0
              return (
                <Link
                  key={f.id}
                  to={`/projects/${f.projectId}`}
                  className="flex items-start gap-2 rounded-md px-1.5 py-1.5 hover:bg-ink-50"
                >
                  <span className={cn('mt-1 dot shrink-0', overdue ? 'bg-red-500' : 'bg-amber-500')} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs text-ink-800">{f.title}</p>
                    <p className="truncate text-[10px] text-ink-400">
                      {f.projectName}
                      {f.expect && ` · ${f.expect}`}
                    </p>
                  </div>
                  <span
                    className={cn(
                      'tabular shrink-0 rounded px-1 py-0.5 text-[10px] font-semibold',
                      overdue ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-700',
                    )}
                  >
                    {daysLeftText(f.daysLeft)}
                  </span>
                </Link>
              )
            })
          )}
        </ListCard>

        <ListCard
          title="临期提醒"
          count={c.remindersSoon + c.remindersExpired}
          icon={<BellRing size={13} />}
          tone={c.remindersExpired > 0 ? 'red' : 'sky'}
          to="/reminders"
        >
          {data.soonReminders.length === 0 ? (
            <p className="py-4 text-center text-xs text-ink-400">30 天内没有到期项</p>
          ) : (
            data.soonReminders.slice(0, 6).map((r) => {
              const d = dictOf(REMINDER_CATEGORY, r.category)
              const expired = new Date(r.expireAt) < new Date()
              return (
                <Link
                  key={r.id}
                  to="/reminders"
                  className="flex items-center gap-2 rounded-md px-1.5 py-1.5 text-xs hover:bg-ink-50"
                >
                  <span className="dot" style={{ background: expired ? '#ef4444' : '#0ea5e9' }} />
                  <span className="truncate text-ink-700">{r.title}</span>
                  <Badge soft={d.soft} className="ml-auto shrink-0">
                    {fmtDateShort(r.expireAt)}
                  </Badge>
                </Link>
              )
            })
          )}
        </ListCard>
      </div>

      {/* 快捷入口 */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <QuickLink to="/tasks" icon={<CheckSquare size={15} />} label="新建任务" hint={`${c.todoTasks} 个待办`} />
        <QuickLink to="/projects" icon={<FolderKanban size={15} />} label="项目档案" hint={`${c.projects} 个项目`} />
        <QuickLink to="/payments" icon={<Wallet size={15} />} label="登记收款" hint={`待收 ${moneyCompact(f.pending)}`} />
        <QuickLink to="/reminders" icon={<BellRing size={15} />} label="到期提醒" hint={`${c.remindersSoon} 项临近`} />
      </div>
    </div>
  )
}

const tones = {
  emerald: 'bg-emerald-50 text-emerald-600',
  amber: 'bg-amber-50 text-amber-600',
  brand: 'bg-brand-50 text-brand-600',
  sky: 'bg-sky-50 text-sky-600',
  red: 'bg-red-50 text-red-600',
  ink: 'bg-ink-100 text-ink-500',
} as const

function StatCard({
  icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: React.ReactNode
  label: string
  value: string
  hint?: string
  tone: keyof typeof tones
}) {
  return (
    <Card className="card-accent flex flex-col gap-0.5">
      <div className="flex items-center gap-1.5">
        <span className={cn('flex h-5 w-5 items-center justify-center rounded-md', tones[tone])}>{icon}</span>
        <span className="text-[11px] font-medium text-ink-400">{label}</span>
      </div>
      <p className="tabular text-[18px] font-bold leading-tight tracking-tight text-ink-900">{value}</p>
      {hint && <p className="truncate text-[10px] text-ink-400">{hint}</p>}
    </Card>
  )
}

function ListCard({
  title,
  count,
  icon,
  tone,
  to,
  children,
}: {
  title: string
  count: number
  icon: React.ReactNode
  tone: keyof typeof tones
  to: string
  children: React.ReactNode
}) {
  return (
    <Card padding={false} className="flex flex-col">
      <div className="flex items-center gap-1.5 border-b border-[var(--border)] px-3 py-2">
        <span className={cn('flex h-5 w-5 items-center justify-center rounded', tones[tone])}>{icon}</span>
        <h3 className="text-xs font-semibold text-ink-900">{title}</h3>
        {count > 0 && (
          <span className="rounded bg-red-50 px-1 text-[10px] font-bold leading-4 text-red-600">{count}</span>
        )}
        <Link to={to} className="ml-auto text-[11px] text-ink-400 hover:text-brand-600">
          全部
        </Link>
      </div>
      <div className="flex-1 p-1.5">{children}</div>
    </Card>
  )
}

function QuickLink({
  to,
  icon,
  label,
  hint,
}: {
  to: string
  icon: React.ReactNode
  label: string
  hint: string
}) {
  return (
    <Link
      to={to}
      className="card flex items-center gap-2.5 p-3 transition-all hover:border-brand-300 hover:shadow-sm"
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-600">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-ink-900">{label}</p>
        <p className="truncate text-[10px] text-ink-400">{hint}</p>
      </div>
    </Link>
  )
}
