import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Plus,
  Lightbulb,
  Trash2,
  Pencil,
  ExternalLink,
  Star,
  GitBranch,
  MessageSquare,
  FileText,
  FileOutput,
  Play,
  StickyNote,
  Clock,
  Inbox,
} from 'lucide-react'
import { api, errMsg, type Content, type Idea, type IdeaStats } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Badge, Card, EmptyState, PageHeader, Skeleton } from '@/components/ui/Layout'
import { cn, fmtDate, dictOf, IDEA_STATUS, IDEA_SOURCE } from '@/lib/utils'
import { IdeaFormDialog } from './IdeaFormDialog'

const SOURCE_ICON: Record<string, React.ReactNode> = {
  wechat: <MessageSquare size={14} />,
  github: <GitBranch size={14} />,
  article: <FileText size={14} />,
  video: <Play size={14} />,
  note: <StickyNote size={14} />,
  other: <Lightbulb size={14} />,
}

const SOURCE_TONE: Record<string, string> = {
  wechat: 'bg-emerald-50 text-emerald-600',
  github: 'bg-ink-100 text-ink-700',
  article: 'bg-sky-50 text-sky-600',
  video: 'bg-rose-50 text-rose-600',
  note: 'bg-brand-50 text-brand-600',
  other: 'bg-ink-100 text-ink-500',
}

const STATUS_TABS = [
  { key: '', label: '全部' },
  { key: 'inbox', label: '待看' },
  { key: 'reading', label: '在看' },
  { key: 'digested', label: '已消化' },
  { key: 'archived', label: '已归档' },
] as const

export default function IdeasPage() {
  const [status, setStatus] = useState('')
  const [source, setSource] = useState('')
  const [q, setQ] = useState('')
  const [starOnly, setStarOnly] = useState(false)
  const [editing, setEditing] = useState<Idea | null | undefined>(undefined)
  const qc = useQueryClient()
  const navigate = useNavigate()

  const { data, isLoading } = useQuery({
    queryKey: ['ideas', status, source, q, starOnly],
    queryFn: async () => {
      const { data } = await api.get<{ items: Idea[]; total: number }>('/ideas', {
        params: { status, source, q, star: starOnly ? 3 : '', size: 100 },
      })
      return data
    },
  })

  const { data: stats } = useQuery({
    queryKey: ['ideas-stats'],
    queryFn: async () => (await api.get<IdeaStats>('/ideas/stats')).data,
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['ideas'] })
    qc.invalidateQueries({ queryKey: ['ideas-stats'] })
  }

  const del = useMutation({
    mutationFn: async (id: number) => api.delete(`/ideas/${id}`),
    onSuccess: invalidate,
  })

  const setStatusMut = useMutation({
    mutationFn: async ({ id, next }: { id: number; next: string }) =>
      api.patch(`/ideas/${id}/status`, { status: next }),
    onSuccess: invalidate,
  })

  const toggleStar = useMutation({
    mutationFn: async ({ id, star }: { id: number; star: number }) =>
      api.patch(`/ideas/${id}/status`, { star }),
    onSuccess: invalidate,
  })

  const convert = useMutation({
    mutationFn: async (id: number) =>
      (await api.post<Content>('/contents/from-idea', { ideaId: id })).data,
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ['contents'] })
      qc.invalidateQueries({ queryKey: ['contents-stats'] })
      navigate(`/contents/${c.id}`)
    },
    onError: (e) => alert(errMsg(e)),
  })

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const counts = stats?.byStatus

  const activeCount = useMemo(
    () => (counts ? counts.inbox + counts.reading : 0),
    [counts],
  )

  return (
    <div>
      <PageHeader
        title="灵感记录"
        desc="刷到好文章、开源项目、公众号，先扔进来，有空再慢慢消化"
        actions={
          <Button size="sm" onClick={() => setEditing(null)}>
            <Plus size={14} /> 记一条
          </Button>
        }
      />

      {/* 状态筛选 + 统计 */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {STATUS_TABS.map((t) => {
          const n = t.key ? counts?.[t.key as keyof typeof counts] : stats?.total
          return (
            <button
              key={t.key}
              onClick={() => setStatus(t.key)}
              className={cn(
                'rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
                status === t.key
                  ? 'border-brand-300 bg-brand-50 text-brand-700'
                  : 'border-[var(--border)] bg-white text-ink-500 hover:border-ink-300',
              )}
            >
              {t.label}
              {typeof n === 'number' && n > 0 && (
                <span className={cn('ml-1', status === t.key ? 'text-brand-500' : 'text-ink-400')}>{n}</span>
              )}
            </button>
          )
        })}

        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={() => setStarOnly((v) => !v)}
            className={cn(
              'flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
              starOnly
                ? 'border-amber-300 bg-amber-50 text-amber-700'
                : 'border-[var(--border)] bg-white text-ink-500 hover:border-ink-300',
            )}
          >
            <Star size={11} className={starOnly ? 'fill-amber-500 text-amber-500' : ''} />
            精选
          </button>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜标题、正文、标签…"
            className="h-7 w-40 rounded-full border border-[var(--border)] bg-white px-2.5 text-[11px] outline-none placeholder:text-ink-400 focus:border-brand-300 sm:w-52"
          />
        </div>
      </div>

      {/* 来源筛选 */}
      <div className="mb-3 flex flex-wrap gap-1">
        <button
          onClick={() => setSource('')}
          className={cn(
            'rounded px-1.5 py-0.5 text-[10px] transition-colors',
            source === '' ? 'bg-ink-100 text-ink-700' : 'text-ink-400 hover:text-ink-600',
          )}
        >
          全部来源
        </button>
        {Object.entries(IDEA_SOURCE).map(([k, v]) => (
          <button
            key={k}
            onClick={() => setSource(source === k ? '' : k)}
            className={cn(
              'rounded px-1.5 py-0.5 text-[10px] transition-colors',
              source === k ? 'bg-ink-100 text-ink-700' : 'text-ink-400 hover:text-ink-600',
            )}
          >
            {v.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Inbox size={20} />}
            title={q || status || source || starOnly ? '没有匹配的记录' : '收件箱是空的'}
            desc={
              q || status || source || starOnly
                ? '换个筛选条件试试'
                : '看到好的公众号文章、开源项目、教程，粘个链接进来就行，标题会自动识别'
            }
            action={
              !q && !status && !source && !starOnly ? (
                <Button size="sm" onClick={() => setEditing(null)}>
                  <Plus size={14} /> 存第一条
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <>
          <p className="mb-2 text-[11px] text-ink-400">
            共 {total} 条
            {activeCount > 0 && <span className="ml-1">· 还有 {activeCount} 条没消化</span>}
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((it) => (
              <IdeaCard
                key={it.id}
                idea={it}
                onEdit={() => setEditing(it)}
                onDelete={() => confirm(`删除「${it.title}」？`) && del.mutate(it.id)}
                onStatus={(next) => setStatusMut.mutate({ id: it.id, next })}
                onStar={(star) => toggleStar.mutate({ id: it.id, star })}
                onConvert={() => convert.mutate(it.id)}
              />
            ))}
          </div>
        </>
      )}

      {editing !== undefined && <IdeaFormDialog idea={editing} onClose={() => setEditing(undefined)} />}
    </div>
  )
}

function IdeaCard({
  idea,
  onEdit,
  onDelete,
  onStatus,
  onStar,
  onConvert,
}: {
  idea: Idea
  onEdit: () => void
  onDelete: () => void
  onStatus: (next: string) => void
  onStar: (star: number) => void
  onConvert: () => void
}) {
  const sd = dictOf(IDEA_STATUS, idea.status)
  const src = dictOf(IDEA_SOURCE, idea.source)
  const undigested = idea.status === 'inbox' || idea.status === 'reading'

  return (
    <Card className="group relative flex flex-col gap-2">
      <div className="flex items-start gap-2">
        <span
          className={cn(
            'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg',
            SOURCE_TONE[idea.source] ?? SOURCE_TONE.other,
          )}
        >
          {SOURCE_ICON[idea.source] ?? SOURCE_ICON.other}
        </span>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-[13px] font-semibold leading-snug text-ink-900">
            {idea.url ? (
              <a
                href={idea.url}
                target="_blank"
                rel="noreferrer"
                className="hover:text-brand-600 hover:underline"
              >
                {idea.title}
              </a>
            ) : (
              idea.title
            )}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <Badge soft={src.soft}>{src.label}</Badge>
            <Badge soft={sd.soft}>{sd.label}</Badge>
            {idea.readingMins > 0 && (
              <span className="inline-flex items-center gap-0.5 text-[10px] text-ink-400">
                <Clock size={9} /> {idea.readingMins} 分钟
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <Button variant="ghost" size="icon" onClick={onEdit} title="编辑">
            <Pencil size={12} />
          </Button>
          <Button variant="ghost" size="icon" onClick={onDelete} title="删除">
            <Trash2 size={12} className="text-red-400" />
          </Button>
        </div>
      </div>

      {/* 自己的思考摘要 */}
      {idea.note && (
        <p className="line-clamp-2 text-[11px] leading-relaxed text-ink-500">{idea.note}</p>
      )}
      {!idea.note && idea.content && (
        <p className="line-clamp-2 text-[11px] leading-relaxed text-ink-400">{idea.content}</p>
      )}

      {/* 标签 */}
      {idea.tagList.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {idea.tagList.map((t) => (
            <span key={t} className="rounded bg-ink-50 px-1 py-0.5 text-[10px] text-ink-500">
              #{t}
            </span>
          ))}
        </div>
      )}

      {/* 底部：星级 + 状态切换 */}
      <div className="mt-auto flex items-center justify-between border-t border-[var(--border)] pt-2">
        <div className="flex items-center gap-0.5">
          {[1, 2, 3].map((s) => (
            <button
              key={s}
              onClick={() => onStar(idea.star === s ? 0 : s)}
              title={`${s} 星`}
              className="p-0.5"
            >
              <Star
                size={11}
                className={cn(
                  s <= idea.star ? 'fill-amber-400 text-amber-400' : 'text-ink-300 hover:text-amber-300',
                )}
              />
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={onConvert}
            title="整理成内容"
            className="flex items-center gap-1 rounded border border-brand-200 bg-brand-50 px-1.5 py-0.5 text-[10px] font-medium text-brand-600 hover:bg-brand-100"
          >
            <FileOutput size={10} /> 整理成内容
          </button>
          {idea.url && (
            <a
              href={idea.url}
              target="_blank"
              rel="noreferrer"
              className="rounded p-1 text-ink-400 hover:bg-ink-50 hover:text-brand-600"
              title="打开原文"
            >
              <ExternalLink size={11} />
            </a>
          )}
          {undigested && (
            <button
              onClick={() => onStatus('digested')}
              className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 hover:bg-emerald-100"
            >
              消化掉
            </button>
          )}
          {idea.status === 'digested' && (
            <button
              onClick={() => onStatus('archived')}
              className="rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-ink-500 hover:bg-ink-50"
            >
              归档
            </button>
          )}
          {idea.status === 'archived' && (
            <button
              onClick={() => onStatus('inbox')}
              className="rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-ink-500 hover:bg-ink-50"
            >
              放回收件箱
            </button>
          )}
        </div>
      </div>

      <p className="text-[10px] text-ink-300">
        存入 {fmtDate(idea.createdAt)}
        {idea.projectName && <span className="ml-1.5 text-sky-500">· {idea.projectName}</span>}
      </p>
    </Card>
  )
}
