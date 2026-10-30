import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
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
import { EditorState } from '@codemirror/state'
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  keymap,
  placeholder as placeholderExt,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language'
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

const editorTheme = EditorView.theme({
  '&': { backgroundColor: '#ffffff', fontSize: '13px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    lineHeight: '1.6',
    minHeight: '360px',
  },
  '.cm-content': { padding: '12px 0', caretColor: '#111827' },
  '.cm-line': { padding: '0 12px' },
  '.cm-placeholder': { color: '#d1d5db' },
  '.cm-gutters': { display: 'none' },
})

/**
 * Markdown 编辑器：桌面左右分栏（左写右看），移动端用 Tab 切换。
 * 编辑区用 CodeMirror 6 提供语法高亮、撤销栈和快捷键，工具栏只做常用包裹。
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
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const valueRef = useRef(value)
  valueRef.current = value
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onUploadImageRef = useRef(onUploadImage)
  onUploadImageRef.current = onUploadImage
  const uploadImagesRef = useRef<(files: File[]) => void>(() => {})
  const [mobileTab, setMobileTab] = useState<'edit' | 'preview'>('edit')
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState('')

  const insert = (text: string, block: boolean) => {
    const view = viewRef.current
    if (!view) return
    const { from, to } = view.state.selection.main
    const doc = view.state.doc.toString()
    let snippet = text
    if (block) {
      if (from > 0 && doc[from - 1] !== '\n') snippet = `\n\n${snippet}`
      if (to < doc.length && doc[to] !== '\n') snippet = `${snippet}\n\n`
    }
    view.dispatch({
      changes: { from, to, insert: snippet },
      selection: { anchor: from + snippet.length },
      scrollIntoView: true,
    })
    view.focus()
  }

  useImperativeHandle(outerRef, () => ({
    insertMarkdown: (snippet) => insert(snippet, true),
  }))

  const apply = (tool: Tool) => {
    const view = viewRef.current
    if (!view) return
    const { from, to } = view.state.selection.main
    const doc = view.state.doc.toString()

    if (tool === 'heading' || tool === 'list') {
      const line = view.state.doc.lineAt(from)
      const prefix = tool === 'heading' ? '## ' : '- '
      view.dispatch({
        changes: { from: line.from, insert: prefix },
        selection: { anchor: from + prefix.length, head: to + prefix.length },
      })
      view.focus()
      return
    }

    const [before, after, fallback] =
      tool === 'bold' ? ['**', '**', '加粗文字'] : tool === 'code' ? ['`', '`', '代码'] : ['[', '](https://)', '链接文字']
    const body = doc.slice(from, to) || fallback
    const snippet = `${before}${body}${after}`
    view.dispatch({
      changes: { from, to, insert: snippet },
      selection: {
        anchor: from + before.length,
        head: from + before.length + body.length,
      },
    })
    view.focus()
  }

  const uploadImages = async (files: File[]) => {
    const upload = onUploadImageRef.current
    if (!upload || files.length === 0) return
    setUploading(true)
    setErr('')
    try {
      const snippets: string[] = []
      for (const file of files) {
        if (!file.type.startsWith('image/')) {
          setErr('只能插入图片')
          continue
        }
        const img = await upload(file)
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
  uploadImagesRef.current = (files) => {
    if (!onUploadImageRef.current) {
      setErr('先保存内容，再插入图片')
      return
    }
    void uploadImages(files)
  }

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const view = new EditorView({
      state: EditorState.create({
        doc: valueRef.current,
        extensions: [
          history(),
          markdown(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          drawSelection(),
          highlightActiveLine(),
          EditorView.lineWrapping,
          placeholderExt(placeholder),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          editorTheme,
          EditorView.domEventHandlers({
            paste: (event) => {
              const files = Array.from(event.clipboardData?.files ?? []).filter((f) =>
                f.type.startsWith('image/'),
              )
              if (files.length === 0) return false
              event.preventDefault()
              event.stopPropagation()
              uploadImagesRef.current(files)
              return true
            },
            drop: (event) => {
              const files = Array.from(event.dataTransfer?.files ?? []).filter((f) =>
                f.type.startsWith('image/'),
              )
              if (files.length === 0) return false
              event.preventDefault()
              uploadImagesRef.current(files)
              return true
            },
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString())
          }),
        ],
      }),
      parent: host,
    })
    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [placeholder])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current === value) return
    view.dispatch({ changes: { from: 0, to: current.length, insert: value } })
  }, [value])

  useEffect(() => {
    if (mobileTab === 'edit') {
      requestAnimationFrame(() => viewRef.current?.requestMeasure())
    }
  }, [mobileTab])

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
          uploadImagesRef.current(files)
        }}
      />

      {err && (
        <p className="border-b border-red-100 bg-red-50 px-2.5 py-1 text-[11px] text-red-600">{err}</p>
      )}

      <div className="grid lg:grid-cols-2">
        <div
          className={cn(
            'content-editor min-w-0',
            mobileTab === 'preview' && 'hidden lg:block',
          )}
        >
          <div ref={hostRef} />
        </div>
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
