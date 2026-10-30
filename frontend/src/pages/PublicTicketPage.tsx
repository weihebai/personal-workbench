import { useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FileQuestion, ImagePlus, Send, CheckCircle2, XCircle, X } from 'lucide-react'
import { publicApi } from '@/lib/publicApi'
import { errMsg, type PublicTicket } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Textarea } from '@/components/ui/Input'
import { VoiceButton } from '@/components/ui/VoiceButton'
import { cn, fmtDate, TICKET_STATUS } from '@/lib/utils'
import { PublicShell } from './PublicFeedbackPage'

const STEPS: { key: PublicTicket['status']; label: string }[] = [
  { key: 'pending', label: '已提交' },
  { key: 'doing', label: '处理中' },
  { key: 'waiting', label: '待你确认' },
  { key: 'closed', label: '已解决' },
]

export default function PublicTicketPage() {
  const { token = '' } = useParams()
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [reply, setReply] = useState('')
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['public-ticket', token],
    queryFn: async () => (await publicApi.get<PublicTicket>(`/tickets/${token}`)).data,
    retry: false,
  })

  const refresh = () => qc.invalidateQueries({ queryKey: ['public-ticket', token] })

  const postMessage = useMutation({
    mutationFn: async (body: string) => publicApi.post(`/tickets/${token}/messages`, { body }),
    onSuccess: () => {
      setReply('')
      refresh()
    },
    onError: (e) => setErr(errMsg(e)),
  })

  const confirm = useMutation({
    mutationFn: async (payload: { ok: boolean; reason?: string }) =>
      publicApi.post(`/tickets/${token}/confirm`, payload),
    onSuccess: () => {
      setRejecting(false)
      setReason('')
      refresh()
    },
    onError: (e) => setErr(errMsg(e)),
  })

  const upload = async (files: FileList | null) => {
    if (!files?.length) return
    setBusy(true)
    for (const file of Array.from(files)) {
      const fd = new FormData()
      fd.append('file', file)
      try {
        await publicApi.post(`/tickets/${token}/attachments`, fd)
      } catch (e) {
        setErr(errMsg(e, '图片上传失败'))
      }
    }
    setBusy(false)
    refresh()
  }

  if (isLoading) return <PublicShell><div className="card h-64 animate-pulse" /></PublicShell>

  if (isError || !data) {
    return (
      <PublicShell>
        <div className="card flex flex-col items-center justify-center gap-2 px-4 py-20 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-ink-100 text-ink-400">
            <FileQuestion size={20} />
          </div>
          <p className="text-sm font-medium text-ink-900">工单不存在或链接已失效</p>
          <p className="max-w-xs text-xs text-ink-400">请确认链接是否完整，或联系对接人重新获取。</p>
        </div>
      </PublicShell>
    )
  }

  const st = TICKET_STATUS[data.status]
  const currentStep = STEPS.findIndex((s) => s.key === data.status)

  return (
    <PublicShell>
      <div className="card px-5 py-6 sm:px-8 sm:py-7">
        <header>
          <div className="flex flex-wrap items-center gap-2">
            <span className="tabular text-[11px] font-semibold text-ink-400">{data.no}</span>
            <span className={cn('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium', st.soft)}>
              <span className={cn('dot', st.color)} />
              {st.label}
            </span>
            {data.round > 0 && (
              <span className="rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-700">
                第 {data.round + 1} 轮
              </span>
            )}
          </div>
          <h1 className="mt-2 text-lg font-bold leading-snug text-ink-950">{data.title}</h1>
          <p className="mt-1 text-[11px] text-ink-400" data-private>
            {data.projectName} · 提交于 {fmtDate(data.createdAt)}
          </p>
        </header>

        <div className="mt-4 flex items-center gap-1">
          {STEPS.map((s, i) => (
            <div key={s.key} className="flex flex-1 items-center gap-1">
              <div
                className={cn(
                  'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
                  i <= currentStep ? 'bg-brand-500 text-white' : 'bg-ink-100 text-ink-400',
                )}
              >
                {i + 1}
              </div>
              <span className={cn('text-[10px]', i <= currentStep ? 'text-brand-700' : 'text-ink-400')}>{s.label}</span>
              {i < STEPS.length - 1 && (
                <div className={cn('h-px flex-1', i < currentStep ? 'bg-brand-300' : 'bg-ink-200')} />
              )}
            </div>
          ))}
        </div>

        {data.expect && (
          <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-xs text-emerald-800">
            <span className="font-medium">你期望的效果：</span>
            {data.expect}
          </div>
        )}

        {data.closedAt && (
          <div className="mt-2 rounded-md border border-[var(--border)] bg-ink-50/60 px-2.5 py-2 text-xs text-ink-600">
            已于 {fmtDate(data.closedAt)} 结案{data.closeNote ? `：${data.closeNote}` : ''}
          </div>
        )}

        {data.attachments.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {data.attachments.map((a, i) => (
              <a key={`${a.url}-${i}`} href={a.url} target="_blank" rel="noreferrer">
                <img src={a.url} alt="" className="h-16 w-16 rounded-md border border-[var(--border)] object-cover" />
              </a>
            ))}
          </div>
        )}

        <div className="mt-4 space-y-2 rounded-lg border border-[var(--border)] p-2.5">
          <div className="text-xs font-medium text-ink-700">沟通记录</div>
          {data.messages.length === 0 && <p className="text-xs text-ink-400">还没有记录</p>}
          {data.messages.map((m, i) => (
            <div
              key={i}
              className={cn('rounded-md px-2.5 py-1.5 text-xs', m.side === 'owner' ? 'bg-brand-50/70' : 'bg-ink-50')}
            >
              <div className="mb-0.5 flex items-center gap-1.5 text-[10px] text-ink-400">
                <span className="font-medium text-ink-600">{m.side === 'owner' ? '处理人' : m.authorName || '你'}</span>
                <span className="tabular ml-auto">{fmtDate(m.createdAt)}</span>
              </div>
              <p className="whitespace-pre-wrap leading-relaxed text-ink-700">{m.body}</p>
            </div>
          ))}
        </div>

        {data.status === 'waiting' && (
          <div className="mt-3 rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-2.5">
            <p className="text-xs font-medium text-sky-800">问题解决了吗？</p>
            <p className="mt-0.5 text-[11px] text-sky-600">确认后工单关闭；如果还没解决，说明一下具体现象。</p>
            {!rejecting ? (
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" loading={confirm.isPending} onClick={() => confirm.mutate({ ok: true })}>
                  <CheckCircle2 size={13} /> 已解决，关闭工单
                </Button>
                <Button size="sm" variant="outline" onClick={() => setRejecting(true)}>
                  <XCircle size={13} /> 还没解决
                </Button>
              </div>
            ) : (
              <div className="mt-2 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-sky-700">具体哪里还不对</span>
                  <VoiceButton onText={(t) => setReason((v) => (v ? `${v}${t}` : t))} />
                </div>
                <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="具体哪里还不对" />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    loading={confirm.isPending}
                    onClick={() => {
                      if (!reason.trim()) return setErr('请说明还没解决的地方')
                      confirm.mutate({ ok: false, reason })
                    }}
                  >
                    提交
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setRejecting(false)}>
                    取消
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-ink-500">补充说明</span>
            <VoiceButton onText={(t) => setReply((v) => (v ? `${v}${t}` : t))} />
          </div>
          <Textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={2} placeholder="补充说明…" />
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="ml-auto"
              loading={busy}
              onClick={() => fileRef.current?.click()}
            >
              <ImagePlus size={13} /> 传图
            </Button>
            <Button
              size="sm"
              loading={postMessage.isPending}
              onClick={() => {
                if (!reply.trim()) return setErr('内容不能为空')
                setErr('')
                postMessage.mutate(reply)
              }}
            >
              <Send size={13} /> 发送
            </Button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              upload(e.target.files)
              e.target.value = ''
            }}
          />
        </div>

        {err && <div className="mt-2 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-600">{err}</div>}
      </div>

      <p className="mt-4 text-center text-[10px] text-ink-300">这条链接只能查看这一张工单，请自行保存。</p>
    </PublicShell>
  )
}
