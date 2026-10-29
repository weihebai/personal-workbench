import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ImagePlus, X, Loader2, ClipboardPaste, Check } from 'lucide-react'
import { api, errMsg, type Attachment } from '@/lib/api'
import { cn } from '@/lib/utils'
import { ImageLightbox, type LightboxImage } from '@/components/ui/ImageLightbox'

/**
 * 图片附件。
 *
 * 存储方式：文件传到服务器磁盘（data/uploads/<hash前2位>/<sha256>.<ext>），
 * 数据库只存哈希和元数据，读取走 /api/attachments/<hash>/raw。
 * 这样：
 *   - 备份时 data/ 一个目录把库和图片全带走，不用管对象存储密钥
 *   - 同一张图重复上传只占一份（按内容哈希去重）
 *   - 列表接口不会拖着 base64 大字符串，SQLite 也不会被撑大
 *
 * 三种录入方式：
 *   - 点「加图片」选文件
 *   - 拖进来
 *   - Ctrl+V 直接粘截图（最常见的动作：微信/QQ 截完图就粘）
 */
export function AttachmentGallery({
  taskId,
  projectId,
  contentId,
  readOnly,
  enablePaste,
  onInsert,
}: {
  taskId?: number
  projectId?: number
  contentId?: number
  readOnly?: boolean
  /** 是否监听全局粘贴。同一个页面里只应该有一处开启，否则一次粘贴传两份。 */
  enablePaste?: boolean
  /** 传入后在缩略图上显示「插入正文」。 */
  onInsert?: (attachment: Attachment) => void
}) {
  const qc = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const [err, setErr] = useState('')
  const [dragging, setDragging] = useState(false)
  const [preview, setPreview] = useState<LightboxImage | null>(null)
  // 粘贴成功后的浮层提示：图片区在弹窗底部，可能不在视野里，
  // 没有这个提示用户不知道图到底贴进去没有
  const [flash, setFlash] = useState('')

  const params = taskId ? { taskId } : projectId ? { projectId } : contentId ? { contentId } : {}
  const enabled = !!(taskId || projectId || contentId)

  const { data } = useQuery({
    queryKey: ['attachments', taskId ?? 0, projectId ?? 0, contentId ?? 0],
    queryFn: async () => (await api.get<{ items: Attachment[] }>('/attachments', { params })).data.items,
    enabled,
  })
  const items = data ?? []

  const invalidate = () => qc.invalidateQueries({ queryKey: ['attachments'] })

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData()
      fd.append('file', file)
      if (taskId) fd.append('taskId', String(taskId))
      if (projectId) fd.append('projectId', String(projectId))
      if (contentId) fd.append('contentId', String(contentId))
      return (await api.post('/attachments', fd)).data
    },
    onSuccess: () => {
      setErr('')
      setFlash('图片已添加')
      invalidate()
    },
    onError: (e) => setErr(errMsg(e)),
  })

  // 提示 2 秒后自动消失
  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(''), 2000)
    return () => clearTimeout(t)
  }, [flash])

  const remove = useMutation({
    mutationFn: async (id: number) => api.delete(`/attachments/${id}`),
    onSuccess: invalidate,
  })

  const handleFiles = (files: FileList | null) => {
    if (!files?.length) return
    for (const f of Array.from(files)) {
      if (!f.type.startsWith('image/')) {
        setErr('只能上传图片')
        continue
      }
      upload.mutate(f)
    }
  }

  // Ctrl+V 粘贴截图。
  //
  // 监听在 window 上而不是这个组件上：用户刚截完图，焦点可能在任何输入框里，
  // 这时候按 Ctrl+V 期望的是「贴到这张任务上」，不是「贴进标题输入框」。
  // 但纯文本粘贴要放行，否则会把正常粘标题的行为也吃掉。
  useEffect(() => {
    if (!enablePaste || readOnly) return
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'))
      if (files.length === 0) return
      // 只有真的带图片才拦截，纯文本照常
      e.preventDefault()
      for (const f of files) upload.mutate(f)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
    // upload.mutate 是稳定引用，不需要进依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enablePaste, readOnly, taskId, projectId, contentId])

  if (!enabled) return null

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        {items.map((a) => (
          <div key={a.id} className="group relative">
            <button
              type="button"
              onClick={() => setPreview({ src: a.url, alt: a.name })}
              title={`${a.name} · ${a.width}×${a.height} · 点击预览`}
              className="block"
            >
              <img
                src={a.url}
                alt={a.name}
                loading="lazy"
                className="h-16 w-16 cursor-zoom-in rounded-md border border-[var(--border)] object-cover transition-opacity hover:opacity-80"
              />
            </button>
            {onInsert && (
              <button
                type="button"
                onClick={() => onInsert(a)}
                className="absolute inset-x-1 bottom-1 rounded bg-ink-900/75 py-0.5 text-[9px] font-medium text-white opacity-100 transition-opacity hover:bg-ink-900 sm:opacity-0 sm:group-hover:opacity-100"
              >
                插入正文
              </button>
            )}
            {!readOnly && (
              <button
                type="button"
                onClick={() => remove.mutate(a.id)}
                aria-label="删除图片"
                className="absolute -right-1 -top-1 rounded-full bg-ink-900/80 p-0.5 text-white opacity-0 transition-opacity hover:bg-red-600 group-hover:opacity-100"
              >
                <X size={10} />
              </button>
            )}
          </div>
        ))}

        {!readOnly && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragging(false)
              handleFiles(e.dataTransfer.files)
            }}
            disabled={upload.isPending}
            className={cn(
              'flex h-16 w-16 flex-col items-center justify-center gap-0.5 rounded-md border border-dashed text-[10px] transition-colors',
              dragging
                ? 'border-brand-400 bg-brand-50 text-brand-600'
                : 'border-ink-300 text-ink-400 hover:border-brand-400 hover:text-brand-600',
            )}
          >
            {upload.isPending ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
            {upload.isPending ? '上传中' : dragging ? '松手' : '加图片'}
          </button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          handleFiles(e.target.files)
          e.target.value = ''
        }}
      />

      {err && <p className="mt-1 text-[11px] text-red-600">{err}</p>}
      {flash && (
        <p className="mt-1 flex items-center gap-1 text-[11px] font-medium text-emerald-600">
          <Check size={11} /> {flash}
        </p>
      )}
      {!readOnly && (
        <p className="mt-1 flex items-center gap-1 text-[10px] text-ink-400">
          {enablePaste && (
            <>
              <ClipboardPaste size={9} />
              <kbd className="rounded border border-ink-200 bg-white px-1 font-sans">Ctrl+V</kbd>
              粘贴截图 ·
            </>
          )}
          拖图片进来也行
        </p>
      )}

      <ImageLightbox image={preview} onClose={() => setPreview(null)} />
    </div>
  )
}
