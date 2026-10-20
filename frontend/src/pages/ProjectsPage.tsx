import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Plus,
  Search,
  FolderKanban,
  ExternalLink,
  GitBranch,
  FolderOpen,
  Globe,
  Trash2,
  Pencil,
} from 'lucide-react'
import { api, errMsg, type Paged, type Project } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select, type Option } from '@/components/ui/Select'
import { Badge, Card, EmptyState, PageHeader, Skeleton } from '@/components/ui/Layout'
import { cn, money, dictOf, PROJECT_KIND, PROJECT_STATUS, fmtDate } from '@/lib/utils'
import { ProjectFormDialog } from './ProjectFormDialog'

const KIND_FILTER: Option[] = [
  { value: '', label: '全部类型' },
  ...Object.entries(PROJECT_KIND).map(([v, d]) => ({ value: v, label: d.label, dot: d.color })),
]
const STATUS_FILTER: Option[] = [
  { value: '', label: '全部状态' },
  ...Object.entries(PROJECT_STATUS).map(([v, d]) => ({ value: v, label: d.label, dot: d.color })),
]

export default function ProjectsPage() {
  const [q, setQ] = useState('')
  const [kind, setKind] = useState('')
  const [status, setStatus] = useState('')
  const [editing, setEditing] = useState<Project | null>(null)
  const [creating, setCreating] = useState(false)
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['projects', q, kind, status],
    queryFn: async () =>
      (
        await api.get<Paged<Project>>('/projects', {
          params: { q, kind, status, size: 200 },
        })
      ).data,
  })

  const del = useMutation({
    mutationFn: async (id: number) => api.delete(`/projects/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }),
  })

  const items = data?.items ?? []

  const totalQuote = items.reduce((s, p) => s + p.quote, 0)
  const totalRecv = items.reduce((s, p) => s + p.received, 0)
  const totalCommission = items.reduce((s, p) => s + (p.commission ?? 0), 0)

  return (
    <div>
      <PageHeader
        title="项目"
        desc={`${items.length} 个项目 · 合同额 ${money(totalQuote)}${totalCommission > 0 ? ` · 抽成 ${money(totalCommission)}` : ''} · 已收 ${money(totalRecv)}`}
        actions={
          <Button onClick={() => setCreating(true)} size="sm">
            <Plus size={14} /> 新建项目
          </Button>
        }
      />

      {/* 筛选栏 */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索项目名、技术栈…"
            className="h-8 pl-8 text-xs"
          />
        </div>
        <Select value={kind} onChange={setKind} options={KIND_FILTER} size="sm" className="w-32" />
        <Select value={status} onChange={setStatus} options={STATUS_FILTER} size="sm" className="w-32" />
      </div>

      {isLoading ? (
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FolderKanban size={20} />}
            title="还没有项目"
            desc="把公司项目、外包私活、个人项目都建在这里，路径、网址、收款一目了然"
            action={
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus size={14} /> 新建第一个项目
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((p) => {
            const kd = dictOf(PROJECT_KIND, p.kind)
            const sd = dictOf(PROJECT_STATUS, p.status)
            const pct = (p.netQuote ?? p.quote) > 0 ? Math.min(100, (p.received / (p.netQuote ?? p.quote)) * 100) : 0
            return (
              <Card key={p.id} className="group relative flex flex-col gap-2 hover:border-ink-300">
                <div className="flex items-start gap-2">
                  <span className={cn('mt-1 dot shrink-0', kd.color)} />
                  <div className="min-w-0 flex-1">
                    <Link
                      to={`/projects/${p.id}`}
                      className="block truncate text-[13px] font-semibold text-ink-900 hover:text-brand-600"
                    >
                      {p.name}
                    </Link>
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      <Badge soft={kd.soft}>{kd.label}</Badge>
                      <Badge soft={sd.soft} dot={sd.color}>
                        {sd.label}
                      </Badge>
                      {p.tags.map((t) => (
                        <Badge key={t} className="border-ink-200 bg-white text-ink-500">
                          {t}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <Button variant="ghost" size="icon" onClick={() => setEditing(p)} title="编辑">
                      <Pencil size={13} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="删除"
                      onClick={() => {
                        if (confirm(`删除项目「${p.name}」？相关收款与提醒也会删除。`)) del.mutate(p.id)
                      }}
                    >
                      <Trash2 size={13} className="text-red-400" />
                    </Button>
                  </div>
                </div>

                {p.summary && (
                  <p className="line-clamp-2 text-[11px] leading-relaxed text-ink-400">{p.summary}</p>
                )}

                {/* 收入进度 */}
                <div className="space-y-1">
                  <div className="flex items-baseline justify-between">
                    <span className="tabular text-[13px] font-bold text-ink-900">
                      {money(p.received, false)}
                      <span className="ml-0.5 text-[10px] font-normal text-ink-400">
                        / {money(p.netQuote ?? p.quote, false)}
                      </span>
                    </span>
                    {p.commission > 0 && (
                      <span className="rounded bg-amber-50 px-1 text-[9px] font-medium text-amber-600">
                        抽成 {p.commissionType === 'pct' ? `${p.commissionRate}%` : money(p.commissionRate, false)}
                      </span>
                    )}
                    <span
                      className={cn(
                        'tabular text-[10px] font-semibold',
                        pct >= 100 ? 'text-emerald-600' : pct > 0 ? 'text-amber-600' : 'text-ink-400',
                      )}
                    >
                      {pct >= 100 ? '已结清' : `${Math.round(pct)}%`}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-ink-100">
                    <div
                      className={cn(
                        'h-full rounded-full transition-all',
                        pct >= 100 ? 'bg-emerald-500' : 'bg-brand-500',
                      )}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>

                {/* 里程碑进度 — 点击直达详情页的项目进度区 */}
                {p.milestoneTotal > 0 ? (
                  <Link
                    to={`/projects/${p.id}#milestones`}
                    title={`查看/维护进度：已完成 ${p.milestoneDone}/${p.milestoneTotal}${
                      p.nextMilestone ? `，下一个「${p.nextMilestone}」` : ''
                    }`}
                    className="group/ms block space-y-1 rounded-md border-t border-dashed border-[var(--border)] pt-1.5 transition-colors hover:bg-ink-50/60"
                  >
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="flex items-center gap-1 text-ink-400 group-hover/ms:text-brand-600">
                        <GitBranch size={10} />
                        进度
                        {p.nextMilestone && (
                          <span className="max-w-32 truncate text-ink-500">· {p.nextMilestone}</span>
                        )}
                        <span className="opacity-0 transition-opacity group-hover/ms:opacity-100">›</span>
                      </span>
                      <span
                        className={cn(
                          'tabular font-semibold',
                          p.nextDueIn !== null && p.nextDueIn !== undefined && p.nextDueIn < 0
                            ? 'text-red-600'
                            : p.nextDueIn !== null && p.nextDueIn !== undefined && p.nextDueIn <= 3
                              ? 'text-amber-600'
                              : 'text-ink-500',
                        )}
                      >
                        {p.milestoneDone}/{p.milestoneTotal}
                        {p.nextDueIn !== null && p.nextDueIn !== undefined && (
                          <span className="ml-1 font-normal">
                            {p.nextDueIn < 0 ? `逾期${Math.abs(p.nextDueIn)}天` : `${p.nextDueIn}天`}
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="h-1 overflow-hidden rounded-full bg-ink-100">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-sky-400 to-brand-500 transition-all"
                        style={{
                          width: `${Math.round((p.milestoneDone / p.milestoneTotal) * 100)}%`,
                        }}
                      />
                    </div>
                  </Link>
                ) : (
                  <Link
                    to={`/projects/${p.id}#milestones`}
                    className="flex items-center gap-1 border-t border-dashed border-[var(--border)] pt-1.5 text-[10px] text-ink-300 transition-colors hover:text-brand-600"
                  >
                    <Plus size={10} /> 添加进度节点
                  </Link>
                )}

                {/* 资产链接 */}
                <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-2 text-[10px] text-ink-400">
                  {p.sourcePath && (
                    <span className="flex items-center gap-0.5" title={p.sourcePath}>
                      <FolderOpen size={11} /> 源码
                    </span>
                  )}
                  {p.onlineUrl && (
                    <a
                      href={p.onlineUrl}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="flex items-center gap-0.5 text-sky-600 hover:underline"
                    >
                      <Globe size={11} /> 线上
                    </a>
                  )}
                  {p.adminUrl && (
                    <a
                      href={p.adminUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-0.5 text-violet-600 hover:underline"
                    >
                      <ExternalLink size={11} /> 后台
                    </a>
                  )}
                  {p.gitRepo && (
                    <a
                      href={p.gitRepo}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-0.5 text-ink-600 hover:underline"
                    >
                      <GitBranch size={11} /> 仓库
                    </a>
                  )}
                  {p.techStack && <span className="ml-auto truncate">{p.techStack}</span>}
                </div>

                {(p.startDate || p.dueDate) && (
                  <div className="flex items-center gap-2 text-[10px] text-ink-400">
                    {p.startDate && <span>起 {fmtDate(p.startDate)}</span>}
                    {p.dueDate && (
                      <span
                        className={cn(
                          new Date(p.dueDate) < new Date() && p.status !== 'paid' && 'font-semibold text-red-500',
                        )}
                      >
                        止 {fmtDate(p.dueDate)}
                      </span>
                    )}
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}

      {(creating || editing) && (
        <ProjectFormDialog
          project={editing}
          onClose={() => {
            setCreating(false)
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}
