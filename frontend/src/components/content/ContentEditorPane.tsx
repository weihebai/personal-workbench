import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, PanelRight, Trash2 } from 'lucide-react'
import {
  api,
  errMsg,
  type Attachment,
  type Client,
  type Content,
  type ContentInput,
  type ContentKind,
  type ContentStatus,
  type Project,
} from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Layout'
import { Field, Input } from '@/components/ui/Input'
import { Select, type Option } from '@/components/ui/Select'
import { MarkdownEditor } from '@/components/content/MarkdownEditor'
import { ShareControls } from '@/components/content/ShareControls'
import { CONTENT_KIND, CONTENT_STATUS } from '@/lib/content'
import { cn } from '@/lib/utils'

const STATUS_OPTS: Option[] = Object.entries(CONTENT_STATUS).map(([v, d]) => ({
  value: v,
  label: d.label,
  dot: d.color,
}))

type FormState = {
  title: string
  kind: ContentKind
  status: ContentStatus
  tags: string
  body: string
  projectId: string
  clientId: string
}

/**
 * 内容库右栏的编辑器：改动 800ms 后自动保存，Ctrl+S 立即保存。
 * 不复用旧整页编辑器的返回/新建逻辑——切换笔记由左栏换 key 完成，
 * 这里只对「当前这条」负责。
 */
export function ContentEditorPane({
  content,
  onSaved,
  onDeleted,
}: {
  content: Content
  onSaved?: (c: Content) => void
  onDeleted?: () => void
}) {
  const qc = useQueryClient()
  const [form, setForm] = useState<FormState>({
    title: content.title ?? '',
    kind: content.kind ?? 'note',
    status: content.status ?? 'draft',
    tags: content.tags ?? '',
    body: content.body ?? '',
    projectId: content.projectId ? String(content.projectId) : '',
    clientId: content.clientId ? String(content.clientId) : '',
  })
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(content.updatedAt ?? null)
  const [infoOpen, setInfoOpen] = useState(false)

  const formRef = useRef(form)
  formRef.current = form
  const dirtyRef = useRef(false)
  const savingRef = useRef(false)
  const queuedRef = useRef(false)
  const timerRef = useRef<number | null>(null)
  const aliveRef = useRef(true)
  const persistRef = useRef<() => Promise<void>>(async () => {})

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  const { data: projects } = useQuery({
    queryKey: ['projects-lite'],
    queryFn: async () => (await api.get<{ items: Project[] }>('/projects', { params: { size: 200 } })).data.items,
  })
  const { data: clients } = useQuery({
    queryKey: ['clients'],
    queryFn: async () => (await api.get<{ items: Client[] }>('/clients')).data.items,
  })

  const projectOpts: Option[] = [
    { value: '', label: '不关联项目' },
    ...(projects ?? []).map((p) => ({ value: String(p.id), label: p.name })),
  ]
  const clientOpts: Option[] = [
    { value: '', label: '不关联客户' },
    ...(clients ?? []).map((c) => ({ value: String(c.id), label: c.name })),
  ]

  const persist = useCallback(async () => {
    const snapshot = formRef.current
    const title = snapshot.title.trim()
    if (!title) {
      setErr('标题不能为空')
      return
    }
    if (savingRef.current) {
      queuedRef.current = true
      return
    }
    savingRef.current = true
    setSaving(true)
    setErr('')
    try {
      const payload: ContentInput = {
        title,
        kind: snapshot.kind,
        status: snapshot.status,
        body: snapshot.body,
        tags: snapshot.tags.replace(/，/g, ','),
        projectId: snapshot.projectId ? Number(snapshot.projectId) : null,
        clientId: snapshot.clientId ? Number(snapshot.clientId) : null,
      }
      const saved = (await api.put<Content>(`/contents/${content.id}`, payload)).data
      if (!aliveRef.current) return
      qc.setQueryData(['content', saved.id], saved)
      dirtyRef.current = false
      setDirty(false)
      setSavedAt(saved.updatedAt)
      qc.invalidateQueries({ queryKey: ['contents'] })
      qc.invalidateQueries({ queryKey: ['contents-stats'] })
      onSaved?.(saved)
    } catch (e) {
      if (aliveRef.current) setErr(errMsg(e))
    } finally {
      savingRef.current = false
      if (aliveRef.current) setSaving(false)
      if (queuedRef.current && aliveRef.current) {
        queuedRef.current = false
        void persistRef.current()
      }
    }
  }, [content.id, qc, onSaved])
  persistRef.current = persist

  const updateForm = (patch: Partial<FormState>) => {
    dirtyRef.current = true
    setDirty(true)
    setForm((f) => ({ ...f, ...patch }))
  }

  // 自动保存：停手 800ms 后写一次，避免每个按键都打接口
  useEffect(() => {
    if (!dirtyRef.current || !form.title.trim()) return
    if (timerRef.current) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      void persistRef.current()
    }, 800)
    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [form])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (timerRef.current) {
          window.clearTimeout(timerRef.current)
          timerRef.current = null
        }
        void persistRef.current()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const remove = async () => {
    if (!confirm(`删除「${content.title || '未命名内容'}」？附件和分享链接会一起失效。`)) return
    try {
      await api.delete(`/contents/${content.id}`)
      qc.invalidateQueries({ queryKey: ['contents'] })
      qc.invalidateQueries({ queryKey: ['contents-stats'] })
      onDeleted?.()
    } catch (e) {
      setErr(errMsg(e))
    }
  }

  const uploadInlineImage = async (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('contentId', String(content.id))
    const a = (await api.post<Attachment>('/attachments', fd)).data
    qc.invalidateQueries({ queryKey: ['attachments'] })
    return { url: a.url, alt: a.name }
  }

  const previewTags = form.tags
    .replace(/，/g, ',')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)

  return (
    <div className="flex min-h-0 flex-col">
      <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border)] bg-white px-2.5 py-1.5">
        <span className="text-[11px] text-ink-400">
          {saving ? '保存中…' : dirty ? '未保存' : savedAt ? '已自动保存' : '已保存'}
        </span>
        {err && <span className="text-[11px] text-red-600">{err}</span>}
        <div className="ml-auto flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="xl:hidden"
            onClick={() => setInfoOpen((v) => !v)}
            title="显示/隐藏属性"
          >
            <PanelRight size={13} /> 属性
          </Button>
          <Button size="sm" variant="ghost" className="text-red-500 hover:bg-red-50 hover:text-red-600" onClick={remove}>
            <Trash2 size={13} />
          </Button>
          <Button size="sm" variant="outline" loading={saving} onClick={() => void persistRef.current()}>
            {saving ? <Loader2 size={13} className="animate-spin" /> : null} 保存
          </Button>
        </div>
      </div>

      <div className={cn('grid min-h-0 gap-3', infoOpen ? 'grid-cols-1' : 'xl:grid-cols-[minmax(0,1fr)_260px]')}>
        <div className="min-w-0 space-y-3">
          <Card className="space-y-2">
            <input
              value={form.title}
              onChange={(e) => updateForm({ title: e.target.value })}
              placeholder="标题"
              className="w-full bg-transparent text-lg font-bold tracking-tight text-ink-900 outline-none placeholder:text-ink-300"
            />
            <div className="flex flex-wrap gap-1">
              {(Object.keys(CONTENT_KIND) as ContentKind[]).map((k) => {
                const d = CONTENT_KIND[k]
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => updateForm({ kind: k })}
                    className={cn(
                      'rounded-md border px-2 py-1 text-[11px] font-medium transition-colors',
                      form.kind === k ? d.soft : 'border-[var(--border)] bg-white text-ink-500 hover:border-ink-300',
                    )}
                  >
                    {d.label}
                  </button>
                )
              })}
            </div>
          </Card>

          {/* 图片直接粘/拖进编辑器：上传后自动插入 Markdown，不再单独开一个图片区 */}
          <MarkdownEditor
            value={form.body}
            onChange={(v) => updateForm({ body: v })}
            onUploadImage={uploadInlineImage}
          />
        </div>

        {infoOpen && (
          <div className="space-y-3 xl:hidden">
            <MetaPanel
              form={form}
              updateForm={updateForm}
              statusOpts={STATUS_OPTS}
              projectOpts={projectOpts}
              clientOpts={clientOpts}
              previewTags={previewTags}
              content={content}
            />
          </div>
        )}

        <div className="hidden space-y-3 xl:block">
          <MetaPanel
            form={form}
            updateForm={updateForm}
            statusOpts={STATUS_OPTS}
            projectOpts={projectOpts}
            clientOpts={clientOpts}
            previewTags={previewTags}
            content={content}
          />
        </div>
      </div>
    </div>
  )
}

function MetaPanel({
  form,
  updateForm,
  statusOpts,
  projectOpts,
  clientOpts,
  previewTags,
  content,
}: {
  form: FormState
  updateForm: (patch: Partial<FormState>) => void
  statusOpts: Option[]
  projectOpts: Option[]
  clientOpts: Option[]
  previewTags: string[]
  content: Content
}) {
  return (
    <>
      <Card className="space-y-3">
        <Field label="状态">
          <Select value={form.status} onChange={(v) => updateForm({ status: v as ContentStatus })} options={statusOpts} />
        </Field>
        <Field label="标签" hint="逗号分隔，最多 10 个">
          <Input value={form.tags} onChange={(e) => updateForm({ tags: e.target.value })} placeholder="微信小程序,备案" />
          {previewTags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {previewTags.map((t) => (
                <span key={t} className="rounded bg-ink-50 px-1 py-0.5 text-[10px] text-ink-500">
                  #{t}
                </span>
              ))}
            </div>
          )}
        </Field>
        <Field label="关联项目">
          <Select value={form.projectId} onChange={(v) => updateForm({ projectId: v })} options={projectOpts} />
        </Field>
        <Field label="关联客户">
          <Select value={form.clientId} onChange={(v) => updateForm({ clientId: v })} options={clientOpts} />
        </Field>
        {content.sourceIdeaTitle && (
          <div className="rounded-md border border-[var(--border)] bg-ink-50/60 px-2 py-1.5 text-[11px] text-ink-400">
            来源灵感：<span className="text-ink-600">{content.sourceIdeaTitle}</span>
          </div>
        )}
      </Card>
      <Card>
        <ShareControls content={content} />
      </Card>
    </>
  )
}
