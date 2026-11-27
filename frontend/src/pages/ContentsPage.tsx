import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, FileText, Link2, Plus, Search, ShieldAlert, StickyNote, Briefcase, Inbox } from 'lucide-react'
import { api, errMsg, type Content, type ContentKind, type ContentStats } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Card, EmptyState, Skeleton } from '@/components/ui/Layout'
import { cn, fmtDate } from '@/lib/utils'
import { CONTENT_KIND, CONTENT_STATUS, shareState } from '@/lib/content'
import { ContentEditorPane } from '@/components/content/ContentEditorPane'

const KIND_ICON: Record<ContentKind, React.ReactNode> = {
  pitfall: <ShieldAlert size={13} />,
  article: <FileText size={13} />,
  client: <Briefcase size={13} />,
  note: <StickyNote size={13} />,
}

const KIND_TONE: Record<ContentKind, string> = {
  pitfall: 'bg-rose-50 text-rose-600',
  article: 'bg-sky-50 text-sky-600',
  client: 'bg-brand-50 text-brand-600',
  note: 'bg-violet-50 text-violet-600',
}

const KIND_TABS = [
  { key: '' as const, label: '全部' },
  ...(Object.keys(CONTENT_KIND) as ContentKind[]).map((k) => ({ key: k, label: CONTENT_KIND[k].label })),
]

/**
 * 内容库：左栏紧凑列表 + 右栏原地编辑。
 * 选中哪条由 URL 的 :id 决定，所以 /contents/:id 依然是可分享、可收藏的地址；
 * 移动端没有并排空间，选中后只显示编辑器，返回按钮回到列表。
 */
export default function ContentsPage() {
  const { id } = useParams<{ id: string }>()
  const contentId = id ? Number(id) : 0
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [kind, setKind] = useState<ContentKind | ''>('')
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['contents', kind, status, q],
    queryFn: async () => {
      const { data } = await api.get<{ items: Content[]; total: number }>('/contents', {
        params: { kind, status, q, size: 100 },
      })
      return data
    },
  })
  const { data: stats } = useQuery({
    queryKey: ['contents-stats'],
    queryFn: async () => (await api.get<ContentStats>('/contents/stats')).data,
  })
  const { data: current, isLoading: loadingCurrent } = useQuery({
    queryKey: ['content', contentId],
    queryFn: async () => (await api.get<Content>(`/contents/${contentId}`)).data,
    enabled: contentId > 0,
  })

  const items = data?.items ?? []

  // 桌面端第一次进来没有选中项时，直接落在最近更新的一条上，少一次点击
  useEffect(() => {
    if (contentId || items.length === 0) return
    if (!window.matchMedia('(min-width: 1024px)').matches) return
    navigate(`/contents/${items[0].id}`, { replace: true })
  }, [contentId, items, navigate])

  const create = useMutation({
    mutationFn: async () => {
      const payload = {
        title: '未命名笔记',
        kind: kind || 'note',
        status: 'draft',
        body: '',
        tags: '',
      }
      return (await api.post<Content>('/contents', payload)).data
    },
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ['contents'] })
      qc.invalidateQueries({ queryKey: ['contents-stats'] })
      navigate(`/contents/${c.id}`)
    },
    onError: (e) => alert(errMsg(e)),
  })

  const total = data?.total ?? 0
  const selected = contentId > 0

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <h1 className="text-base font-bold tracking-tight text-ink-900">内容库</h1>
        <span className="text-[11px] text-ink-400">
          共 {total} 条
          {stats && stats.shared > 0 ? ` · ${stats.shared} 条已开启分享` : ''}
        </span>
        <Button size="sm" className="ml-auto" loading={create.isPending} onClick={() => create.mutate()}>
          <Plus size={14} /> 新建
        </Button>
      </div>

      <div className="grid gap-3 lg:grid-cols-[280px_minmax(0,1fr)]">
        {/* 左栏：筛选 + 紧凑列表 */}
        <div className={cn('min-w-0', selected && 'hidden lg:block')}>
          <div className="mb-2 flex flex-wrap gap-1">
            {KIND_TABS.map((t) => {
              const n = t.key ? stats?.byKind[t.key] : stats?.total
              return (
                <button
                  key={t.key}
                  onClick={() => setKind(t.key)}
                  className={cn(
                    'rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors',
                    kind === t.key
                      ? 'border-brand-300 bg-brand-50 text-brand-700'
                      : 'border-[var(--border)] bg-white text-ink-500 hover:border-ink-300',
                  )}
                >
                  {t.label}
                  {typeof n === 'number' && n > 0 && <span className="ml-1 text-ink-400">{n}</span>}
                </button>
              )
            })}
          </div>

          <div className="mb-2 flex items-center gap-1.5">
            <div className="relative flex-1">
              <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-400" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="搜标题、正文、标签…"
                className="h-7 w-full rounded-md border border-[var(--border)] bg-white pl-6 pr-2 text-[11px] outline-none placeholder:text-ink-400 focus:border-brand-300"
              />
            </div>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="h-7 shrink-0 rounded-md border border-[var(--border)] bg-white px-1.5 text-[11px] text-ink-600 outline-none focus:border-brand-300"
            >
              <option value="">全部状态</option>
              {Object.entries(CONTENT_STATUS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </select>
          </div>

          <Card padding={false} className="overflow-hidden">
            {isLoading ? (
              <div className="space-y-1 p-2">
                {[0, 1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} className="h-10" />
                ))}
              </div>
            ) : items.length === 0 ? (
              <EmptyState
                icon={<Inbox size={18} />}
                title={kind || status || q ? '没有匹配的内容' : '还没有内容'}
                desc={kind || status || q ? '换个筛选条件试试' : '点右上角「新建」开始写'}
              />
            ) : (
              <ul className="max-h-[calc(100vh-260px)] overflow-y-auto">
                {items.map((it) => {
                  const k = CONTENT_KIND[it.kind] ?? CONTENT_KIND.note
                  const share = shareState(it)
                  const active = it.id === contentId
                  return (
                    <li key={it.id}>
                      <button
                        type="button"
                        onClick={() => navigate(`/contents/${it.id}`)}
                        className={cn(
                          'flex w-full items-center gap-2 border-b border-[var(--border)] px-2.5 py-2 text-left transition-colors last:border-b-0',
                          active ? 'bg-brand-50/70' : 'hover:bg-ink-50/70',
                        )}
                      >
                        <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded', KIND_TONE[it.kind] ?? KIND_TONE.note)}>
                          {KIND_ICON[it.kind] ?? KIND_ICON.note}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className={cn('block truncate text-xs font-medium', active ? 'text-brand-700' : 'text-ink-800')}>
                            {it.title || '未命名内容'}
                          </span>
                          <span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-ink-400">
                            <span>{k.label}</span>
                            <span>·</span>
                            <span>{fmtDate(it.updatedAt)}</span>
                          </span>
                        </span>
                        {share !== 'none' && (
                          <Link2 size={11} className={share === 'active' ? 'shrink-0 text-emerald-500' : 'shrink-0 text-amber-500'} />
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>
        </div>

        {/* 右栏：原地编辑 */}
        <div className={cn('min-w-0', !selected && 'hidden lg:block')}>
          <div className="mb-2 lg:hidden">
            <Button size="sm" variant="ghost" onClick={() => navigate('/contents')}>
              <ArrowLeft size={13} /> 返回列表
            </Button>
          </div>
          {!selected ? (
            <Card>
              <EmptyState icon={<StickyNote size={20} />} title="选择左侧一条内容" desc="也可以点右上角「新建」直接开始写" />
            </Card>
          ) : loadingCurrent ? (
            <div className="space-y-3">
              <Skeleton className="h-24" />
              <Skeleton className="h-64" />
            </div>
          ) : current ? (
            <ContentEditorPane
              key={current.id}
              content={current}
              onDeleted={() => navigate('/contents', { replace: true })}
              onSaved={() => qc.invalidateQueries({ queryKey: ['contents'] })}
            />
          ) : (
            <Card>
              <EmptyState icon={<FileText size={20} />} title="这条内容不存在" desc="可能已被删除" />
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
