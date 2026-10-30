import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  FileQuestion,
  ImagePlus,
  Send,
  CheckCircle2,
  Copy,
  X,
  Plus,
  ChevronRight,
  ArrowLeft,
} from 'lucide-react'
import { publicApi } from '@/lib/publicApi'
import { errMsg, type PublicFeedback } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Field, Input, Textarea } from '@/components/ui/Input'
import { VoiceButton } from '@/components/ui/VoiceButton'
import { Badge } from '@/components/ui/Layout'
import { BrandMark } from '@/components/BrandMark'
import { cn, dictOf, fmtDate, TICKET_STATUS } from '@/lib/utils'

function useNoIndexMeta() {
  useEffect(() => {
    const created: HTMLMetaElement[] = []
    const set = (name: string, content: string) => {
      let el = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)
      if (!el) {
        el = document.createElement('meta')
        el.setAttribute('name', name)
        document.head.appendChild(el)
        created.push(el)
      }
      el.setAttribute('content', content)
    }
    set('robots', 'noindex,nofollow')
    set('referrer', 'no-referrer')
    return () => {
      for (const el of created) el.remove()
    }
  }, [])
}

interface Picked {
  file: File
  url: string
}

export default function PublicFeedbackPage() {
  const { token = '' } = useParams()
  useNoIndexMeta()
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)

  const [form, setForm] = useState({
    title: '',
    desc: '',
    expect: '',
    pageUrl: '',
    contact: '',
  })
  const [picked, setPicked] = useState<Picked[]>([])
  const [err, setErr] = useState('')
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState<{ no: string; path: string } | null>(null)
  const [showForm, setShowForm] = useState(false)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['public-feedback', token],
    queryFn: async () => (await publicApi.get<PublicFeedback>(`/feedback/${token}`)).data,
    retry: false,
  })

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<any>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  // 语音识别结果按句追加，不覆盖客户已经打好的文字
  const appendText = (key: 'desc' | 'expect') => (text: string) =>
    setForm((f) => ({ ...f, [key]: f[key] ? `${f[key]}${text}` : text }))

  const addFiles = (files: FileList | null) => {
    if (!files) return
    const next: Picked[] = []
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue
      next.push({ file, url: URL.createObjectURL(file) })
    }
    setPicked((p) => [...p, ...next].slice(0, 9))
  }

  const submit = async () => {
    if (!form.title.trim()) return setErr('请填写问题标题')
    if (!form.desc.trim()) return setErr('请描述遇到的问题')
    setErr('')
    setSending(true)
    try {
      const res = await publicApi.post<{ no: string; accessPath: string }>(`/feedback/${token}/tickets`, form)
      const { no, accessPath } = res.data
      // 工单创建成功后才有上传地址：按工单 Token 逐张补图
      const ticketToken = accessPath.split('/').pop()
      for (const p of picked) {
        const fd = new FormData()
        fd.append('file', p.file)
        try {
          await publicApi.post(`/tickets/${ticketToken}/attachments`, fd)
        } catch {
          // 单张失败不影响工单本身，客户可以在进度页重新补
        }
      }
      qc.invalidateQueries({ queryKey: ['public-feedback', token] })
      setDone({ no, path: accessPath })
      setForm({ title: '', desc: '', expect: '', pageUrl: '', contact: '' })
      setPicked([])
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (e) {
      setErr(errMsg(e, '提交失败，请稍后再试'))
    } finally {
      setSending(false)
    }
  }

  if (done) {
    const url = location.origin + done.path
    return (
      <PublicShell>
        <div className="card px-5 py-8 text-center sm:px-10">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
            <CheckCircle2 size={22} />
          </div>
          <h1 className="text-lg font-bold text-ink-900">已提交</h1>
          <p className="mt-1 text-xs text-ink-500">
            工单号 <span className="tabular font-semibold text-ink-700">{done.no}</span>
          </p>
          <p className="mt-3 text-xs text-ink-400">
            之后查看进度、补充说明、上传截图，从下面这条链接进。
          </p>
          <div className="mt-3 rounded-md border border-[var(--border)] bg-ink-50/60 px-3 py-2 text-left">
            <p className="break-all text-[11px] text-ink-600">{url}</p>
          </div>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            <Button size="sm" variant="outline" onClick={() => navigator.clipboard?.writeText(url)}>
              <Copy size={13} /> 复制链接
            </Button>
            <a href={done.path}>
              <Button size="sm">查看进度</Button>
            </a>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setDone(null)
                setShowForm(false)
              }}
            >
              返回工单列表
            </Button>
          </div>
        </div>
      </PublicShell>
    )
  }

  const tickets = data?.tickets ?? []
  const showList = tickets.length > 0 && !showForm

  return (
    <PublicShell>
      {isLoading && <div className="card h-64 animate-pulse" />}

      {isError && (
        <div className="card flex flex-col items-center justify-center gap-2 px-4 py-20 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-ink-100 text-ink-400">
            <FileQuestion size={20} />
          </div>
          <p className="text-sm font-medium text-ink-900">提报链接不存在或已失效</p>
          <p className="max-w-xs text-xs text-ink-400">请向对接人要一条新的链接。</p>
        </div>
      )}

      {data && showList && (
        <div className="card px-5 py-6 sm:px-8 sm:py-7">
          <header className="mb-4">
            <h1 className="text-lg font-bold tracking-tight text-ink-950">问题反馈</h1>
            <p className="mt-1 text-xs text-ink-400" data-private>
              {data.projectName}
            </p>
          </header>

          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-xs text-ink-500">你提交过 {tickets.length} 个问题</span>
            <Button size="sm" onClick={() => setShowForm(true)}>
              <Plus size={13} /> 提交新问题
            </Button>
          </div>

          <div className="space-y-2">
            {tickets.map((t) => {
              const st = dictOf(TICKET_STATUS, t.status)
              return (
                <Link
                  key={t.no}
                  to={t.accessPath}
                  className="block rounded-lg border border-[var(--border)] bg-white px-3 py-2.5 transition-colors hover:border-brand-300"
                >
                  <div className="flex items-center gap-2">
                    <span className="tabular text-[10px] font-semibold text-ink-400">{t.no}</span>
                    <Badge soft={st.soft} dot={st.color}>
                      {st.label}
                    </Badge>
                    {t.round > 0 && (
                      <span className="text-[10px] text-amber-600">第 {t.round + 1} 轮</span>
                    )}
                    <span className="tabular ml-auto text-[10px] text-ink-400">{fmtDate(t.updatedAt)}</span>
                    <ChevronRight size={13} className="text-ink-300" />
                  </div>
                  <p className="mt-1 text-xs font-medium leading-snug text-ink-900">{t.title}</p>
                </Link>
              )
            })}
          </div>
        </div>
      )}

      {data && !showList && (
        <div className="card px-5 py-6 sm:px-8 sm:py-7">
          <header className="mb-4">
            {tickets.length > 0 && (
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="mb-2 inline-flex items-center gap-1 text-[11px] text-ink-400 hover:text-ink-600"
              >
                <ArrowLeft size={12} /> 返回工单列表
              </button>
            )}
            <h1 className="text-lg font-bold tracking-tight text-ink-950">提交问题反馈</h1>
            <p className="mt-1 text-xs text-ink-400" data-private>
              {data.projectName}
            </p>
          </header>

          <div className="space-y-3">
            <Field label="问题标题" required>
              <Input value={form.title} onChange={set('title')} placeholder="一句话说明问题，如：订单页保存后提示失败" />
            </Field>

            <Field label="遇到的情况" required action={<VoiceButton onText={appendText('desc')} />}>
              <Textarea
                value={form.desc}
                onChange={set('desc')}
                rows={4}
                placeholder="什么操作下出现、看到什么现象、有没有报错提示"
              />
            </Field>

            <Field label="期望的效果" action={<VoiceButton onText={appendText('expect')} />}>
              <Textarea value={form.expect} onChange={set('expect')} rows={2} placeholder="你认为改成什么样算解决" />
            </Field>

            <Field label="出问题的页面地址">
              <Input value={form.pageUrl} onChange={set('pageUrl')} placeholder="可以直接粘贴浏览器地址栏" />
            </Field>

            <Field label="联系方式（可选）" hint="留个手机或微信，处理完方便找你确认">
              <Input value={form.contact} onChange={set('contact')} placeholder="手机 / 微信 / 邮箱" />
            </Field>

            <Field label="截图（最多 9 张）">
              <div className="flex flex-wrap gap-2">
                {picked.map((p, i) => (
                  <div key={p.url} className="relative">
                    <img src={p.url} alt="" className="h-16 w-16 rounded-md border border-[var(--border)] object-cover" />
                    <button
                      type="button"
                      onClick={() => setPicked((list) => list.filter((_, idx) => idx !== i))}
                      className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-ink-900 text-white"
                      aria-label="移除"
                    >
                      <X size={10} />
                    </button>
                  </div>
                ))}
                {picked.length < 9 && (
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="flex h-16 w-16 flex-col items-center justify-center gap-0.5 rounded-md border border-dashed border-ink-300 text-[10px] text-ink-400"
                  >
                    <ImagePlus size={16} />
                    添加
                  </button>
                )}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  addFiles(e.target.files)
                  e.target.value = ''
                }}
              />
            </Field>

            {err && <div className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-600">{err}</div>}

            <Button className={cn('w-full')} loading={sending} onClick={submit}>
              <Send size={14} /> 提交
            </Button>
          </div>
        </div>
      )}

      <p className="mt-4 text-center text-[10px] text-ink-300">仅限获得链接的人使用，请勿公开转发。</p>
    </PublicShell>
  )
}

export function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[var(--bg)] px-3 py-6 sm:px-5 sm:py-10">
      <div className="mx-auto w-full max-w-[680px]">
        <div className="mb-3 flex items-center gap-1.5 px-1 text-[11px] text-ink-400">
          <span className="flex h-5 w-5 items-center justify-center rounded bg-brand-500 text-white">
            <BrandMark className="h-3.5 w-3.5" />
          </span>
          来自个人工作台
        </div>
        {children}
      </div>
    </div>
  )
}
