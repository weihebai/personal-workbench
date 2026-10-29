import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Plus,
  ShieldAlert,
  FileText,
  Briefcase,
  StickyNote,
  Link2,
  Image as ImageIcon,
  Inbox,
} from 'lucide-react'
import { api, type Content, type ContentKind, type ContentStats } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Badge, Card, EmptyState, PageHeader, Skeleton } from '@/components/ui/Layout'
import { cn, fmtDate } from '@/lib/utils'
import { CONTENT_KIND, CONTENT_STATUS, shareState } from '@/lib/content'

const KIND_ICON: Record<ContentKind, React.ReactNode> = {
  pitfall: <ShieldAlert size={14} />,
  article: <FileText size={14} />,
  client: <Briefcase size={14} />,
  note: <StickyNote size={14} />,
}

const KIND_TONE: Record<ContentKind, string> = {
  pitfall: 'bg-rose-50 text-rose-600',
  article: 'bg-sky-50 text-sky-600',
  client: 'bg-brand-50 text-brand-600',
  note: 'bg-violet-50 text-violet-600',
}

const KIND_TABS = [
  { key: '' as const, label: '全部' },
  ...(Object.keys(CONTENT_KIND) as ContentKind[]).map((k) => ({
    key: k,
    label: CONTENT_KIND[k].label,
  })),
]

export default function ContentsPage() {
  const navigate = useNavigate()
  const [kind, setKind] = useState<ContentKind | ''>('')
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')

  const hasFilter = !!(kind || status || q)

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

  const items = data?.items ?? []
  const total = data?.total ?? 0

  const newHref = useMemo(
    () => (kind ? `/contents/new?kind=${kind}` : '/contents/new'),
    [kind],
  )

  return (
    <div>
      <PageHeader
        title="内容库"
        desc="开发踩过的坑、要写的文章、给客户的素材，写好后可以生成只读分享链接"
        actions={
          <Button size="sm" onClick={() => navigate(newHref)}>
            <Plus size={14} /> 新建内容
          </Button>
        }
      />

      {/* 类型筛选 */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {KIND_TABS.map((t) => {
          const n = t.key ? stats?.byKind[t.key] : stats?.total
          return (
            <button
              key={t.key}
              onClick={() => setKind(t.key)}
              className={cn(
                'rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
                kind === t.key
                  ? 'border-brand-300 bg-brand-50 text-brand-700'
                  : 'border-[var(--border)] bg-white text-ink-500 hover:border-ink-300',
              )}
            >
              {t.label}
              {typeof n === 'number' && n > 0 && (
                <span className={cn('ml-1', kind === t.key ? 'text-brand-500' : 'text-ink-400')}>
                  {n}
                </span>
              )}
            </button>
          )
        })}

        <div className="ml-auto flex items-center gap-1.5">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="h-7 rounded-full border border-[var(--border)] bg-white px-2 text-[11px] text-ink-600 outline-none focus:border-brand-300"
          >
            <option value="">全部状态</option>
            {Object.entries(CONTENT_STATUS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜标题、正文、标签…"
            className="h-7 w-40 rounded-full border border-[var(--border)] bg-white px-2.5 text-[11px] outline-none placeholder:text-ink-400 focus:border-brand-300 sm:w-52"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-36" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Inbox size={20} />}
            title={hasFilter ? '没有匹配的内容' : '内容库还是空的'}
            desc={
              hasFilter
                ? '换个类型、状态或关键词试试'
                : '把踩过的坑、要写的文章、给客户的素材放进来，需要时生成一个只读链接'
            }
            action={
              hasFilter ? undefined : (
                <Button size="sm" onClick={() => navigate('/contents/new')}>
                  <Plus size={14} /> 写第一条
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <>
          <p className="mb-2 text-[11px] text-ink-400">
            共 {total} 条
            {!hasFilter && stats && stats.shared > 0 && (
              <span className="ml-1">· {stats.shared} 条已开启分享</span>
            )}
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((it) => (
              <ContentCard key={it.id} content={it} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function ContentCard({ content: it }: { content: Content }) {
  const k = CONTENT_KIND[it.kind] ?? CONTENT_KIND.note
  const s = CONTENT_STATUS[it.status] ?? CONTENT_STATUS.draft
  const share = shareState(it)

  return (
    <Link to={`/contents/${it.id}`} className="group block">
      <Card className="flex h-full flex-col gap-2 transition-colors hover:border-brand-200 hover:shadow-sm">
        <div className="flex items-start gap-2">
          <span
            className={cn(
              'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg',
              KIND_TONE[it.kind] ?? KIND_TONE.note,
            )}
          >
            {KIND_ICON[it.kind] ?? KIND_ICON.note}
          </span>
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-[13px] font-semibold leading-snug text-ink-900 group-hover:text-brand-700">
              {it.title || '未命名内容'}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-1">
              <Badge soft={k.soft}>{k.label}</Badge>
              <Badge soft={s.soft}>{s.label}</Badge>
              {share !== 'none' && (
                <span
                  title={share === 'active' ? '已开启分享' : '分享链接已过期'}
                  className={cn(
                    'inline-flex items-center',
                    share === 'active' ? 'text-emerald-500' : 'text-amber-500',
                  )}
                >
                  <Link2 size={11} />
                </span>
              )}
            </div>
          </div>
          {it.coverUrl && (
            <img
              src={it.coverUrl}
              alt=""
              loading="lazy"
              className="h-14 w-14 shrink-0 rounded-md border border-[var(--border)] object-cover"
            />
          )}
        </div>

        <p className="line-clamp-3 text-[11px] leading-relaxed text-ink-500">
          {it.excerpt || '还没有正文，点开继续写'}
        </p>

        {it.tagList.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {it.tagList.map((t) => (
              <span key={t} className="rounded bg-ink-50 px-1 py-0.5 text-[10px] text-ink-500">
                #{t}
              </span>
            ))}
          </div>
        )}

        <div className="mt-auto flex items-center justify-between gap-2 border-t border-[var(--border)] pt-2 text-[10px] text-ink-400">
          <span className="min-w-0 truncate">
            {fmtDate(it.updatedAt)} 更新
            {it.projectName && <span className="ml-1.5 text-sky-500">· {it.projectName}</span>}
            {it.clientName && <span className="ml-1.5 text-brand-500">· {it.clientName}</span>}
          </span>
          <span className="flex shrink-0 items-center gap-0.5">
            <ImageIcon size={10} />
            {it.attachmentCount}
          </span>
        </div>
      </Card>
    </Link>
  )
}
