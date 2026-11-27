import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { CalendarCheck, CloudMoon, FolderKanban, Flame, Hourglass, Inbox } from 'lucide-react'
import { api } from '@/lib/api'
import { Badge, Card, EmptyState, PageHeader, Skeleton } from '@/components/ui/Layout'
import { fmtDateShort } from '@/lib/utils'

interface ReviewTask {
  id: number
  no?: string
  title: string
  bucket: string
  status: string
  context: string
  waitingFor: string
  followUpAt?: string | null
  dueDate?: string | null
  projectId?: number | null
  projectName?: string
}

interface ReviewData {
  counts: Record<string, number>
  inbox: ReviewTask[]
  next: ReviewTask[]
  waiting: ReviewTask[]
  someday: ReviewTask[]
  overdue: ReviewTask[]
  noNextProjects: { id: number; name: string; kind: string; status: string }[]
}

// 每周回顾：只读聚合页。GTD 的固定动作是「清空收集箱 + 检查等待中 + 过一遍将来也许」，
// 所以这里不提供行内编辑，改任务仍然回任务页，避免两处状态各改一半。
function Section({
  icon,
  title,
  hint,
  count,
  tasks,
}: {
  icon: React.ReactNode
  title: string
  hint: string
  count: number
  tasks: ReviewTask[]
}) {
  return (
    <Card>
      <div className="flex items-center gap-2">
        <span className="text-ink-400">{icon}</span>
        <h2 className="text-xs font-semibold text-ink-900">{title}</h2>
        <span className="tabular text-[11px] text-ink-400">{count}</span>
        <span className="ml-auto hidden text-[10px] text-ink-400 sm:block">{hint}</span>
      </div>
      {tasks.length === 0 ? (
        <p className="py-4 text-center text-[11px] text-ink-400">没有要处理的</p>
      ) : (
        <ul className="mt-2 space-y-0.5">
          {tasks.map((t) => (
            <li key={t.id} className="flex items-center gap-2 rounded px-1 py-1 text-xs hover:bg-ink-50/60">
              {t.no && <span className="tabular shrink-0 text-[10px] text-ink-400">{t.no}</span>}
              <Link to="/tasks" className="min-w-0 flex-1 truncate text-ink-800 hover:text-brand-600">
                {t.title}
              </Link>
              {t.context && <span className="shrink-0 text-[10px] text-ink-400">{t.context}</span>}
              {t.waitingFor && <span className="shrink-0 text-[10px] text-amber-600">等 {t.waitingFor}</span>}
              {t.projectName && (
                <span data-private className="hidden shrink-0 sm:block">
                  <Badge className="border-ink-200 bg-white text-ink-500">{t.projectName}</Badge>
                </span>
              )}
              {(t.followUpAt || t.dueDate) && (
                <span className="tabular shrink-0 text-[10px] text-ink-400">{fmtDateShort(t.followUpAt || t.dueDate)}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

export default function ReviewPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['review'],
    queryFn: async () => (await api.get<ReviewData>('/review')).data,
  })

  const counts = data?.counts ?? {}

  return (
    <div>
      <PageHeader
        title="每周回顾"
        desc="清空收集箱、检查等待中、过一遍将来也许，给没有下一步行动的项目补一条具体动作"
      />

      {isLoading ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid gap-3 lg:grid-cols-2">
            <Section
              icon={<Inbox size={13} />}
              title="收集箱 · 待理清"
              hint="每条都要有去处：下一步 / 等待 / 日程 / 将来也许 / 删掉"
              count={counts.inbox ?? 0}
              tasks={data?.inbox ?? []}
            />
            <Section
              icon={<Hourglass size={13} />}
              title="等待中"
              hint="过了跟进日就催一下"
              count={counts.waiting ?? 0}
              tasks={data?.waiting ?? []}
            />
            <Section
              icon={<Flame size={13} />}
              title="已逾期"
              hint="截止日已过、还开着的任务"
              count={counts.overdue ?? 0}
              tasks={data?.overdue ?? []}
            />
            <Section
              icon={<CloudMoon size={13} />}
              title="将来也许"
              hint="现在不做，隔一段时间回来看还要不要"
              count={counts.someday ?? 0}
              tasks={data?.someday ?? []}
            />
          </div>

          <Card className="mt-3">
            <div className="flex items-center gap-2">
              <span className="text-ink-400">
                <FolderKanban size={13} />
              </span>
              <h2 className="text-xs font-semibold text-ink-900">活跃项目 · 缺下一步行动</h2>
              <span className="tabular text-[11px] text-ink-400">{counts.noNextProjects ?? 0}</span>
              <span className="ml-auto hidden text-[10px] text-ink-400 sm:block">没有待办也没有进行中任务的项目</span>
            </div>
            {(data?.noNextProjects ?? []).length === 0 ? (
              <EmptyState icon={<CalendarCheck size={20} />} title="所有活跃项目都有下一步" desc="不用额外处理" />
            ) : (
              <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                {(data?.noNextProjects ?? []).map((p) => (
                  <li key={p.id}>
                    <Link
                      to={'/projects/' + p.id}
                      data-private
                      className="flex items-center gap-2 rounded px-1 py-1 text-xs text-ink-800 hover:bg-ink-50/60 hover:text-brand-600"
                    >
                      <span className="min-w-0 flex-1 truncate">{p.name}</span>
                      <Badge className="border-ink-200 bg-white text-ink-500">补下一步</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  )
}
