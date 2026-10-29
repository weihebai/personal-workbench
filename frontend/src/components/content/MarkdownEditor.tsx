import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import {
  Bold,
  Code2,
  Eye,
  Heading2,
  ImagePlus,
  Link2,
  List,
  Loader2,
  Pencil,
} from 'lucide-react'
import { errMsg } from '@/lib/api'
import { cn } from '@/lib/utils'
import { MarkdownView } from './MarkdownView'

type Tool = 'bold' | 'heading' | 'list' | 'link' | 'code'

export type MarkdownEditorHandle = {
  /** 在光标处插入一段内容（图片等块级内容会自动空行隔开）。 */
  insertMarkdown: (snippet: string) => void
}

export type UploadedImage = {
  url: string
  alt?: string
}

/**
 * Markdown 编辑器：桌面左右分栏（左写右看），移动端用 Tab 切换。
 * 工具栏只做最常用的几种包裹，不引入重型编辑器依赖。
 */
export const MarkdownEditor = forwardRef<
  MarkdownEditorHandle,
  {
    value: string
    onChange: (v: string) => void
    placeholder?: string
    className?: string
    /** 传入后显示「插入图片」按钮；上传成功会把 Markdown 写进正文。 */
    onUploadImage?: (file: File) => Promise<UploadedImage>
  }
>(function MarkdownEditor(
  {
    value,
    onChange,
    placeholder = '用 Markdown 写正文，支持标题、列表、表格、代码块和图片…',
    className,
    onUploadImage,
  },
  outerRef,
) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const valueRef = useRef(value)
  valueRef.current = value
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  // textarea 失焦后 selectionStart 仍然可读，但按钮点击会抢走焦点，
  // 记一份最后的光标位置，保证「插入正文」还能插到原处。
  const lastSel = useRef<{ start: number; end: number } | null>(null)
  const [mobileTab, setMobileTab] = useState<'edit' | 'preview'>('edit')
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState('')

  const rememberSelection = () => {
    const el = ref.current
    if (!el) return
    lastSel.current = { start: el.selectionStart ?? 0, end: el.selectionEnd ?? 0 }
  }

  const insert = (text: string, block: boolean) => {
    const el = ref.current
    const current = valueRef.current
    let start = el?.selectionStart ?? current.length
    let end = el?.selectionEnd ?? current.length
    if (!el || document.activeElement !== el) {
      start = lastSel.current?.start ?? current.length
      end = lastSel.current?.end ?? current.length
    }
    if (start > end) [start, end] = [end, start]

    let snippet = text
    if (block) {
      if (start > 0 && current[start - 1] !== '\n') snippet = `\n\n${snippet}`
      if (end < current.length && current[end] !== '\n') snippet = `${snippet}\n\n`
    }
    const next = current.slice(0, start) + snippet + current.slice(end)
    onChangeRef.current(next)
    const caret = start + snippet.length
    lastSel.current = { start: caret, end: caret }
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(caret, caret)
    })
  }

  useImperativeHandle(outerRef, () => ({
    insertMarkdown: (snippet) => insert(snippet, true),
  }))

  const apply = (tool: Tool) => {
    const el = ref.current
    if (!el) return
    const start = el.selectionStart ?? value.length
    const end = el.selectionEnd ?? value.length
    const selected = value.slice(start, end)

    let next = value
    let selStart = start
    let selEnd = end

    if (tool === 'heading' || tool === 'list') {
      const lineStart = value.lastIndexOf('\n', start - 1) + 1
      const prefix = tool === 'heading' ? '## ' : '- '
      next = value.slice(0, lineStart) + prefix + value.slice(lineStart)
      selStart = start + prefix.length
      selEnd = end + prefix.length
    } else {
      const [before, after, fallback] =
        tool === 'bold' ? ['**', '**', '加粗文字'] : tool === 'code' ? ['`', '`', '代码'] : ['[', '](https://)', '链接文字']
      const body = selected || fallback
      next = value.slice(0, start) + before + body + after + value.slice(end)
      selStart = start + before.length
      selEnd = selStart + body.length
    }

    onChange(next)
    lastSel.current = { start: selStart, end: selEnd }
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(selStart, selEnd)
    })
  }

  const uploadImages = async (files: File[]) => {
    if (!onUploadImage || files.length === 0) return
    setUploading(true)
    setErr('')
    try {
      const snippets: string[] = []
      for (const file of files) {
        if (!file.type.startsWith('image/')) {
          setErr('只能插入图片')
          continue
        }
        const img = await onUploadImage(file)
        const alt = (img.alt || '图片').replace(/[[\]]/g, '')
        snippets.push(`![${alt}](${img.url})`)
      }
      if (snippets.length > 0) insert(snippets.join('\n\n'), true)
    } catch (e) {
      setErr(errMsg(e))
    } finally {
      setUploading(false)
    }
  }

  const tools: { key: Tool; icon: typeof Bold; label: string }[] = [
    { key: 'bold', icon: Bold, label: '加粗' },
    { key: 'heading', icon: Heading2, label: '标题' },
    { key: 'list', icon: List, label: '列表' },
    { key: 'link', icon: Link2, label: '链接' },
    { key: 'code', icon: Code2, label: '行内代码' },
  ]

  return (
    <div className={cn('overflow-hidden rounded-lg border border-[var(--border)] bg-white', className)}>
      <div className="flex items-center gap-0.5 border-b border-[var(--border)] bg-ink-50/60 px-1.5 py-1">
        {tools.map((t) => {
          const Icon = t.icon
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => apply(t.key)}
              title={t.label}
              aria-label={t.label}
              className="flex h-7 w-7 items-center justify-center rounded text-ink-500 transition-colors hover:bg-white hover:text-ink-900"
            >
              <Icon size={14} />
            </button>
          )
        })}

        <span className="mx-0.5 h-4 w-px bg-ink-200" />

        <button
          type="button"
          onClick={() => {
            if (!onUploadImage) {
              setErr('先保存内容，再插入图片')
              return
            }
            fileRef.current?.click()
          }}
          disabled={uploading}
          title={onUploadImage ? '插入图片' : '保存后可插入图片'}
          aria-label="插入图片"
          className="flex h-7 w-7 items-center justify-center rounded text-ink-500 transition-colors hover:bg-white hover:text-ink-900 disabled:cursor-not-allowed disabled:text-ink-300 disabled:hover:bg-transparent"
        >
          {uploading ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
        </button>

        <div className="ml-auto flex items-center gap-0.5 lg:hidden">
          <button
            type="button"
            onClick={() => setMobileTab('edit')}
            className={cn(
              'flex h-7 items-center gap-1 rounded px-2 text-[11px] font-medium',
              mobileTab === 'edit' ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-400',
            )}
          >
            <Pencil size={11} /> 编辑
          </button>
          <button
            type="button"
            onClick={() => setMobileTab('preview')}
            className={cn(
              'flex h-7 items-center gap-1 rounded px-2 text-[11px] font-medium',
              mobileTab === 'preview' ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-400',
            )}
          >
            <Eye size={11} /> 预览
          </button>
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          e.target.value = ''
          void uploadImages(files)
        }}
      />

      {err && (
        <p className="border-b border-red-100 bg-red-50 px-2.5 py-1 text-[11px] text-red-600">{err}</p>
      )}

      <div className="grid lg:grid-cols-2">
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onSelect={rememberSelection}
          onClick={rememberSelection}
          onKeyUp={rememberSelection}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.files ?? []).filter((f) =>
              f.type.startsWith('image/'),
            )
            if (files.length === 0) return
            e.preventDefault()
            if (!onUploadImage) {
              setErr('先保存内容，再插入图片')
              return
            }
            // 编辑器里粘图 = 直接插到正文；阻止冒泡避免外层附件区再传一份。
            e.stopPropagation()
            void uploadImages(files)
          }}
          onDrop={(e) => {
            const files = Array.from(e.dataTransfer.files ?? []).filter((f) =>
              f.type.startsWith('image/'),
            )
            if (files.length === 0) return
            e.preventDefault()
            if (!onUploadImage) {
              setErr('先保存内容，再插入图片')
              return
            }
            void uploadImages(files)
          }}
          placeholder={placeholder}
          spellCheck={false}
          className={cn(
            'min-h-[360px] w-full resize-y bg-white p-3 font-mono text-[13px] leading-6 text-ink-900 outline-none placeholder:text-ink-300 lg:min-h-[520px]',
            mobileTab === 'preview' && 'hidden lg:block',
          )}
        />
        <div
          className={cn(
            'min-h-[360px] overflow-y-auto border-t border-[var(--border)] p-3 lg:min-h-[520px] lg:border-l lg:border-t-0',
            mobileTab === 'edit' && 'hidden lg:block',
          )}
        >
          {value.trim() ? (
            <MarkdownView>{value}</MarkdownView>
          ) : (
            <p className="text-xs text-ink-300">预览会显示在这里</p>
          )}
        </div>
      </div>
    </div>
  )
})
