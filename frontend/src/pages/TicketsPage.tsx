import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Plus,
  Search,
  Inbox,
  MessageSquare,
  ImageIcon,
  Copy,
  ExternalLink,
  CheckCircle2,
  PlayCircle,
  Send,
} from 'lucide-react'
import { api, errMsg, type Paged, type Project, type Ticket } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Field, Input, Textarea } from '@/components/ui/Input'
import { Select, type Option } from '@/components/ui/Select'
import { Badge, Card, Dialog, EmptyState, PageHeader, Skeleton } from '@/components/ui/Layout'
import { cn, dictOf, fmtDateShort, TICKET_STATUS } from '@/lib/utils'

const COLUMNS: { key: Ticket['status']; label: string }[] = [
  { key: 'pending', label: '待处理' },
  { key: 'doing', label: '处理中' },
  { key: 'waiting', label: '待客户确认' },
  { key: 'closed', label: '已关闭' },
]

const STATUS_FILTER: Option[] = [
  { value: '', label: '全部状态' },
  ...Object.entries(TICKET_STATUS).map(([v, d]) => ({ value: v, label: d.label, dot: d.color })),
]

export default function TicketsPage() {
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [openId, setOpenId] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['tickets', q, status],
    queryFn: async () =>
      (
        await api.get<Paged<Ticket>>('/tickets', {
          params: { size: 200, q, status },
        })
      ).data,
  })

  const items = data?.items ?? []
  const grouped = useMemo(() => {
    const map: Record<string, Ticket[]> = {}
    for (const t of items) (map[t.status] ??= []).push(t)
    return map
  }, [items])

  const open = items.find((t) => t.id === openId) ?? null

  return (
    <div>
      <PageHeader
        title="工单"
        desc={`${items.length} 张工单 · 客户反馈的问题与处理进度`}
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus size={14} /> 录入工单
          </Button>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索工单号 / 标题 / 反馈人…"
            className="h-8 pl-8 text-xs"
          />
        </div>
        <Select value={status} onChange={setStatus} options={STATUS_FILTER} size="sm" className="w-36" />
      </div>

      {isLoading ? (
        <div className="grid gap-2.5 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-64" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Inbox size={20} />}
            title="还没有工单"
            desc="在项目详情页生成「客户提报链接」发给客户，或者在这里手动录入"
            action={
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus size={14} /> 录入第一张
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid items-start gap-2.5 lg:grid-cols-4">
          {COLUMNS.map((col) => {
            const list = grouped[col.key] ?? []
            return (
              <div key={col.key} className="rounded-lg bg-ink-50/60 p-2">
                <div className="mb-2 flex items-center justify-between px-0.5">
                  <span className="text-xs font-semibold text-ink-700">{col.label}</span>
                  <span className="tabular text-[11px] text-ink-400">{list.length}</span>
                </div>
                <div className="space-y-2">
                  {list.map((t) => (
                    <TicketCard key={t.id} ticket={t} onClick={() => setOpenId(t.id)} />
                  ))}
                  {list.length === 0 && (
                    <div className="rounded-md border border-dashed border-ink-200 px-2 py-6 text-center text-[11px] text-ink-300">
                      暂无
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {open && <TicketDetailDialog ticket={open} onClose={() => setOpenId(null)} />}
      {creating && <TicketCreateDialog onClose={() => setCreating(false)} />}
    </div>
  )
}

function TicketCard({ ticket, onClick }: { ticket: Ticket; onClick: () => void }) {
  const st = dictOf(TICKET_STATUS, ticket.status)
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-lg border border-[var(--border)] bg-white p-2.5 text-left shadow-sm transition-colors hover:border-brand-300"
    >
      <div className="mb-1 flex items-center gap-1.5">
        <span className="tabular text-[10px] font-semibold text-ink-400">{ticket.no}</span>
        <Badge soft={st.soft} dot={st.color}>
          {st.label}
        </Badge>
      </div>
      <p className="text-xs font-medium leading-snug text-ink-900">{ticket.title}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-ink-400">
        <span className="truncate" data-private>
          {ticket.projectName || '—'}
        </span>
        {ticket.round > 0 && <span className="text-amber-600">第 {ticket.round + 1} 轮</span>}
        <span className="ml-auto flex items-center gap-0.5">
          <MessageSquare size={10} /> {ticket.messageCount}
        </span>
        {(ticket.attachments?.length ?? 0) > 0 && (
          <span className="flex items-center gap-0.5">
            <ImageIcon size={10} /> {ticket.attachments!.length}
          </span>
        )}
      </div>
    </button>
  )
}

function TicketDetailDialog({ ticket, onClose }: { ticket: Ticket; onClose: () => void }) {
  const qc = useQueryClient()
  const [reply, setReply] = useState('')
  const [visible, setVisible] = useState(false)
  const [closeNote, setCloseNote] = useState('')
  const [err, setErr] = useState('')

  const { data: detail } = useQuery({
    queryKey: ['ticket', ticket.id],
    queryFn: async () => (await api.get<Ticket>(`/tickets/${ticket.id}`)).data,
    initialData: ticket,
  })

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['tickets'] })
    qc.invalidateQueries({ queryKey: ['ticket', ticket.id] })
  }

  const patch = useMutation({
    mutationFn: async (body: Record<string, unknown>) => (await api.put(`/tickets/${ticket.id}`, body)).data,
    onSuccess: () => {
      setReply('')
      setErr('')
      refresh()
    },
    onError: (e) => setErr(errMsg(e)),
  })

  const st = dictOf(TICKET_STATUS, detail.status)
  const messages = detail.messages ?? []
  const accessUrl = detail.accessPath ? location.origin + detail.accessPath : ''

  return (
    <Dialog open onClose={onClose} title={`${detail.no} · ${detail.title}`} width="max-w-3xl">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge soft={st.soft} dot={st.color}>
            {st.label}
          </Badge>
          {detail.round > 0 && <Badge soft="bg-amber-50 text-amber-700 border-amber-200">第 {detail.round + 1} 轮</Badge>}
          <span className="text-[11px] text-ink-400" data-private>
            {detail.projectName}
          </span>
          {detail.reporter && <span className="text-[11px] text-ink-400">反馈人：{detail.reporter}</span>}
          {detail.contact && <span className="text-[11px] text-ink-400">联系：{detail.contact}</span>}
          <span className="tabular text-[11px] text-ink-400">{fmtDateShort(detail.createdAt)}</span>
        </div>

        {detail.expect && (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-xs text-emerald-800">
            <span className="font-medium">期望效果：</span>
            {detail.expect}
          </div>
        )}

        {detail.pageUrl && (
          <a
            href={detail.pageUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-brand-600 hover:underline"
          >
            <ExternalLink size={12} /> {detail.pageUrl}
          </a>
        )}

        {(detail.attachments?.length ?? 0) > 0 && (
          <div className="flex flex-wrap gap-2">
            {detail.attachments!.map((a) => (
              <a key={a.url} href={a.url} target="_blank" rel="noreferrer">
                <img src={a.url} alt="" className="h-16 w-16 rounded-md border border-[var(--border)] object-cover" />
              </a>
            ))}
          </div>
        )}

        <div className="space-y-2 rounded-lg border border-[var(--border)] p-2.5">
          <div className="text-xs font-medium text-ink-700">沟通记录</div>
          {messages.length === 0 && <p className="text-xs text-ink-400">还没有记录</p>}
          {messages.map((m) => (
            <div
              key={m.id}
              className={cn(
                'rounded-md px-2.5 py-1.5 text-xs',
                m.side === 'owner' ? 'bg-brand-50/70' : 'bg-ink-50',
                m.visibility === 'internal' && 'border border-dashed border-amber-300 bg-amber-50/60',
              )}
            >
              <div className="mb-0.5 flex items-center gap-1.5 text-[10px] text-ink-400">
                <span className="font-medium text-ink-600">
                  {m.side === 'owner' ? '我' : m.authorName || '客户'}
                </span>
                {m.visibility === 'internal' && <span className="text-amber-600">内部备注</span>}
                <span className="tabular ml-auto">{fmtDateShort(m.createdAt)}</span>
              </div>
              <p className="whitespace-pre-wrap leading-relaxed text-ink-700">{m.body}</p>
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <Textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            rows={2}
            placeholder="追加一条沟通记录…"
          />
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-ink-500">
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} />
              客户可见
            </label>
            <span className="text-ink-300">不勾选则只作为内部备注</span>
            <Button
              size="sm"
              className="ml-auto"
              loading={patch.isPending}
              onClick={() => {
                if (!reply.trim()) return setErr('内容不能为空')
                patch.mutate({ message: reply, visibility: visible ? 'public' : 'internal' })
              }}
            >
              <Send size={12} /> 发送
            </Button>
          </div>
        </div>

        {accessUrl && (
          <div className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-ink-50/60 px-2.5 py-1.5">
            <span className="text-[11px] text-ink-500">客户查看链接</span>
            <span className="truncate text-[11px] text-ink-400">{accessUrl}</span>
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto shrink-0"
              onClick={() => navigator.clipboard?.writeText(accessUrl)}
            >
              <Copy size={12} /> 复制
            </Button>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-3">
          {detail.status === 'pending' && (
            <Button size="sm" variant="outline" loading={patch.isPending} onClick={() => patch.mutate({ status: 'doing' })}>
              <PlayCircle size={13} /> 开始处理
            </Button>
          )}
          {detail.status !== 'waiting' && detail.status !== 'closed' && (
            <Button size="sm" variant="outline" loading={patch.isPending} onClick={() => patch.mutate({ status: 'waiting' })}>
              <CheckCircle2 size={13} /> 提交待客户确认
            </Button>
          )}
          {detail.status !== 'closed' && (
            <div className="ml-auto flex items-center gap-2">
              <Input
                value={closeNote}
                onChange={(e) => setCloseNote(e.target.value)}
                placeholder="结案说明（可选）"
                className="h-8 w-48 text-xs"
              />
              <Button
                size="sm"
                loading={patch.isPending}
                onClick={() => patch.mutate({ status: 'closed', closeNote: closeNote || '人工结案' })}
              >
                结案
              </Button>
            </div>
          )}
          {detail.status === 'closed' && detail.closeNote && (
            <p className="text-xs text-emerald-700">结案说明：{detail.closeNote}</p>
          )}
        </div>

        {err && <div className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-600">{err}</div>}
      </div>
    </Dialog>
  )
}

function TicketCreateDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    projectId: '',
    title: '',
    desc: '',
    expect: '',
    pageUrl: '',
    reporter: '',
    contact: '',
  })
  const [err, setErr] = useState('')

  const { data: projects } = useQuery({
    queryKey: ['projects-lite'],
    queryFn: async () => (await api.get<{ items: Project[] }>('/projects', { params: { size: 200 } })).data.items,
  })

  const save = useMutation({
    mutationFn: async () =>
      (await api.post('/tickets', { ...form, projectId: Number(form.projectId) })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tickets'] })
      onClose()
    },
    onError: (e) => setErr(errMsg(e)),
  })

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<any>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  const projOpts: Option[] = [
    { value: '', label: '选择项目' },
    ...(projects ?? []).map((p) => ({ value: String(p.id), label: p.name })),
  ]

  return (
    <Dialog
      open
      onClose={onClose}
      title="录入工单"
      description="客户私下反馈的问题，整理后录进来"
      width="max-w-xl"
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose}>
            取消
          </Button>
          <Button
            size="sm"
            loading={save.isPending}
            onClick={() => {
              if (!form.projectId) return setErr('请选择所属项目')
              if (!form.title.trim()) return setErr('工单标题必填')
              setErr('')
              save.mutate()
            }}
          >
            保存
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="所属项目" required>
          <Select value={form.projectId} onChange={(v) => setForm((f) => ({ ...f, projectId: v }))} options={projOpts} />
        </Field>
        <Field label="问题标题" required>
          <Input value={form.title} onChange={set('title')} placeholder="一句话说明问题" autoFocus />
        </Field>
        <Field label="问题描述">
          <Textarea value={form.desc} onChange={set('desc')} rows={3} placeholder="客户原话：在什么操作下出现什么问题" />
        </Field>
        <Field label="期望效果">
          <Textarea value={form.expect} onChange={set('expect')} rows={2} placeholder="客户认为做到什么程度算解决" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="反馈人">
            <Input value={form.reporter} onChange={set('reporter')} />
          </Field>
          <Field label="联系方式">
            <Input value={form.contact} onChange={set('contact')} placeholder="手机 / 微信 / 邮箱" />
          </Field>
        </div>
        <Field label="页面地址">
          <Input value={form.pageUrl} onChange={set('pageUrl')} placeholder="出问题的具体页面" />
        </Field>
        {err && <div className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-600">{err}</div>}
      </div>
    </Dialog>
  )
}
