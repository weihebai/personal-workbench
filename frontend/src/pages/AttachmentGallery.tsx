import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ImagePlus, X, Loader2 } from 'lucide-react'
import { api, errMsg, type Attachment } from '@/lib/api'
import { cn } from '@/lib/utils'

/**
 * 图片附件。
 *
 * 存储方式：文件传到服务器磁盘（data/uploads/<hash前2位>/<sha256>.<ext>），
 * 数据库只存哈希和元数据，读取走 /api/attachments/<hash>/raw。
 * 这样：
 *   - 备份时 data/ 一个目录把库和图片全带走，不用管对象存储密钥
 *   - 同一张图重复上传只占一份（按内容哈希去重）
 *   - 列表接口不会拖着 base64 大字符串，SQLite 也不会被撑大
 */
export function AttachmentGallery({
  taskId,
  projectId,
  readOnly,
}: {
  taskId?: number
  projectId?: number
  readOnly?: boolean
}) {
  const qc = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const [err, setErr] = useState('')
  const [dragging, setDragging] = useState(false)

  const params = taskId ? { taskId } : projectId ? { projectId } : {}
  const enabled = !!(taskId || projectId)

  const { data } = useQuery({
    queryKey: ['attachments', taskId ?? 0, projectId ?? 0],
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
      return (await api.post('/attachments', fd)).data
    },
    onSuccess: () => {
      setErr('')
      invalidate()
    },
    onError: (e) => setErr(errMsg(e)),
  })

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

  if (!enabled) return null

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        {items.map((a) => (
          <div key={a.id} className="group relative">
            <a href={a.url} target="_blank" rel="noreferrer" title={`${a.name} · ${a.width}×${a.height}`}>
              <img
                src={a.url}
                alt={a.name}
                loading="lazy"
                className="h-16 w-16 rounded-md border border-[var(--border)] object-cover transition-opacity hover:opacity-80"
              />
            </a>
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
      {items.length === 0 && !readOnly && (
        <p className="mt-1 text-[10px] text-ink-400">截图、参考图直接拖进来，存在服务器上，备份跟着数据库走</p>
      )}
    </div>
  )
}
