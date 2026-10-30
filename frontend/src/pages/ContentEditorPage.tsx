import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FileQuestion, Save, Trash2 } from 'lucide-react'
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
import { Card, EmptyState, PageHeader, Skeleton } from '@/components/ui/Layout'
import { Field, Input } from '@/components/ui/Input'
import { Select, type Option } from '@/components/ui/Select'
import { AttachmentGallery } from './AttachmentGallery'
import { MarkdownEditor, type MarkdownEditorHandle } from '@/components/content/MarkdownEditor'
import { ShareControls } from '@/components/content/ShareControls'
import { CONTENT_KIND, CONTENT_STATUS } from '@/lib/content'
import { cn, fmtDate } from '@/lib/utils'

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

export default function ContentEditorPage() {
  const { id } = useParams<{ id: string }>()
  const { search } = useLocation()
  const navigate = useNavigate()
  const contentId = id ? Number(id) : 0
  const isNew = !id

  const initialKind = (() => {
    const k = new URLSearchParams(search).get('kind') as ContentKind | null
    return k && k in CONTENT_KIND ? k : 'note'
  })()

  const { data: content, isLoading, isError } = useQuery({
    queryKey: ['content', contentId],
    queryFn: async () => (await api.get<Content>(`/contents/${contentId}`)).data,
    enabled: contentId > 0,
  })

  if (isNew) {
    return <EditorForm key="new" isNew initialKind={initialKind} onBack={() => navigate('/contents')} />
  }

  if (isLoading) {
    return (
      <div>
        <Skeleton className="mb-4 h-8 w-40" />
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="space-y-3">
            <Skeleton className="h-24" />
            <Skeleton className="h-[520px]" />
          </div>
          <Skeleton className="h-80" />
        </div>
      </div>
    )
  }

  if (isError || !content) {
    return (
      <Card>
        <EmptyState
          icon={<FileQuestion size={20} />}
          title="内容不存在或已删除"
          desc="它可能已经被删掉了，回内容库看看其他的"
          action={
            <Button size="sm" onClick={() => navigate('/contents')}>
              返回内容库
            </Button>
          }
        />
      </Card>
    )
  }

  return <EditorForm key={content.id} initial={content} onBack={() => navigate('/contents')} />
}

function EditorForm({
  initial,
  isNew = false,
  initialKind = 'note',
  onBack,
}: {
  initial?: Content
  isNew?: boolean
  initialKind?: ContentKind
  onBack: () => void
}) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const editorRef = useRef<MarkdownEditorHandle>(null)
  const [form, setForm] = useState<FormState>({
    title: initial?.title ?? '',
    kind: initial?.kind ?? initialKind,
    status: initial?.status ?? 'draft',
    tags: initial?.tags ?? '',
    body: initial?.body ?? '',
    projectId: initial?.projectId ? String(initial.projectId) : '',
    clientId: initial?.clientId ? String(initial.clientId) : '',
  })
  const [err, setErr] = useState('')
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [dirty, setDirty] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(initial?.updatedAt ?? null)
  const dirtyRef = useRef(false)
  const savingRef = useRef(false)
  const queuedRef = useRef(false)
  const aliveRef = useRef(true)
  const timerRef = useRef<number | null>(null)
  const formRef = useRef(form)
  formRef.current = form
  const persistRef = useRef<() => Promise<boolean>>(async () => false)

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

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['contents'] })
    qc.invalidateQueries({ queryKey: ['contents-stats'] })
  }

  const persist = useCallback(async () => {
    const snapshot = formRef.current
    const title = snapshot.title.trim()
    if (!title) {
      if (!isNew) {
        setSaveState('error')
        setErr('标题不能为空')
      }
      return false
    }
    if (savingRef.current) {
      queuedRef.current = true
      return false
    }
    savingRef.current = true
    setSaveState('saving')
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
      const saved = isNew
        ? (await api.post<Content>('/contents', payload)).data
        : (await api.put<Content>(`/contents/${initial!.id}`, payload)).data
      if (!aliveRef.current) return true
      qc.setQueryData(['content', saved.id], saved)
      qc.invalidateQueries({ queryKey: ['contents'] })
      qc.invalidateQueries({ queryKey: ['contents-stats'] })
      dirtyRef.current = false
      setDirty(false)
      setSaveState('saved')
      setLastSavedAt(saved.updatedAt)
      if (isNew) {
        queuedRef.current = false
        navigate(`/contents/${saved.id}`, { replace: true })
      }
      return true
    } catch (e) {
      if (!aliveRef.current) return false
      setSaveState('error')
      setErr(errMsg(e))
      return false
    } finally {
      savingRef.current = false
      if (queuedRef.current && aliveRef.current) {
        queuedRef.current = false
        void persistRef.current()
      }
    }
  }, [isNew, initial, navigate, qc])
  persistRef.current = persist

  const updateForm = (patch: Partial<FormState>) => {
    dirtyRef.current = true
    setDirty(true)
    setSaveState('idle')
    setForm((f) => ({ ...f, ...patch }))
  }

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

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

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current && !savingRef.current) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!dirtyRef.current && !savingRef.current) return
      const link = (e.target as Element | null)?.closest('a[href]')
      if (!link) return
      const href = link.getAttribute('href') ?? ''
      if (!href || href.startsWith('#') || /^https?:/i.test(href)) return
      if (!window.confirm('还有改动没保存，确定离开？')) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [])

  const del = useMutation({
    mutationFn: async () => api.delete(`/contents/${initial!.id}`),
    onSuccess: () => {
      qc.removeQueries({ queryKey: ['content', initial!.id] })
      invalidate()
      navigate('/contents', { replace: true })
    },
    onError: (e) => setErr(errMsg(e)),
  })

  // 编辑器里插入图片：先作为该内容的附件上传，再把 URL 写进正文。
  const uploadInlineImage = async (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('contentId', String(initial!.id))
    const a = (await api.post<Attachment>('/attachments', fd)).data
    qc.invalidateQueries({ queryKey: ['attachments'] })
    return { url: a.url, alt: a.name }
  }

  const previewTags = form.tags
    .replace(/，/g, ',')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)

  const submit = () => {
    if (!formRef.current.title.trim()) {
      setSaveState('error')
      setErr('标题不能为空')
      return
    }
    if (timerRef.current) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    void persistRef.current()
  }

  const leave = () => {
    if (dirtyRef.current || savingRef.current) {
      if (!window.confirm('还有改动没保存，确定离开？')) return
    }
    onBack()
  }

  return (
    <div>
      <PageHeader
        title={isNew ? '新建内容' : '编辑内容'}
        desc={
          isNew
            ? '写下来会自动保存，之后可以继续打磨或生成分享链接'
            : `最后更新 ${fmtDate(lastSavedAt ?? initial!.updatedAt)}`
        }
        actions={
          <>
            {saveState === 'saving' && <span className="text-xs text-ink-400">保存中…</span>}
            {saveState === 'saved' && <span className="text-xs font-medium text-emerald-600">已保存</span>}
            {saveState === 'error' && <span className="text-xs font-medium text-red-600">保存失败</span>}
            {saveState === 'idle' && dirty && <span className="text-xs text-ink-400">未保存</span>}
            {!isNew && (
              <Button
                size="sm"
                variant="ghost"
                className="text-red-500 hover:bg-red-50 hover:text-red-600"
                loading={del.isPending}
                onClick={() => {
                  if (confirm(`删除「${initial!.title}」？附件和分享链接会一起失效。`)) del.mutate()
                }}
              >
                <Trash2 size={13} /> 删除
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={leave}>
              返回
            </Button>
            <Button size="sm" loading={saveState === 'saving'} onClick={submit}>
              <Save size={13} /> 保存
            </Button>
          </>
        }
      />

      {err && (
        <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
          {err}
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-3">
          <Card className="space-y-2">
            <input
              value={form.title}
              onChange={(e) => updateForm({ title: e.target.value })}
              placeholder="标题"
              autoFocus={isNew}
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
                      form.kind === k
                        ? d.soft
                        : 'border-[var(--border)] bg-white text-ink-500 hover:border-ink-300',
                    )}
                  >
                    {d.label}
                  </button>
                )
              })}
            </div>
          </Card>

          <MarkdownEditor
            ref={editorRef}
            value={form.body}
            onChange={(v) => updateForm({ body: v })}
            onUploadImage={isNew ? undefined : uploadInlineImage}
          />

          <Card>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-semibold text-ink-700">图片</p>
              {!isNew && (
                <span className="text-[10px] text-ink-400">上传后可点「插入正文」，也可以直接粘进正文</span>
              )}
            </div>
            {isNew ? (
              <p className="text-[11px] text-ink-400">保存后可添加图片，并插入到正文里</p>
            ) : (
              <AttachmentGallery
                contentId={initial!.id}
                enablePaste
                onInsert={(a) =>
                  editorRef.current?.insertMarkdown(
                    `![${a.name.replace(/[[\]]/g, '') || '图片'}](${a.url})`,
                  )
                }
              />
            )}
          </Card>
        </div>

        <div className="space-y-3">
          <Card className="space-y-3">
            <Field label="状态">
              <Select
                value={form.status}
                onChange={(v) => updateForm({ status: v as ContentStatus })}
                options={STATUS_OPTS}
              />
            </Field>

            <Field label="标签" hint="逗号分隔，最多 10 个">
              <Input
                value={form.tags}
                onChange={(e) => updateForm({ tags: e.target.value })}
                placeholder="微信小程序,备案"
              />
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
              <Select
                value={form.projectId}
                onChange={(v) => updateForm({ projectId: v })}
                options={projectOpts}
              />
            </Field>

            <Field label="关联客户">
              <Select
                value={form.clientId}
                onChange={(v) => updateForm({ clientId: v })}
                options={clientOpts}
              />
            </Field>

            {initial?.sourceIdeaTitle && (
              <div className="rounded-md border border-[var(--border)] bg-ink-50/60 px-2 py-1.5 text-[11px] text-ink-400">
                来源灵感：
                <span className="text-ink-600">{initial.sourceIdeaTitle}</span>
              </div>
            )}
          </Card>

          <Card>
            {isNew ? (
              <p className="text-[11px] text-ink-400">保存后可生成公开分享链接</p>
            ) : (
              <ShareControls content={initial!} />
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
