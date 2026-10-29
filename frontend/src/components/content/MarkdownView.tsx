import { useMemo, useState } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import { cn } from '@/lib/utils'
import { ImageLightbox, type LightboxImage } from '@/components/ui/ImageLightbox'

// 只允许这几种协议；相对路径（/api/attachments/...）没有协议，会正常保留。
const schema = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    href: ['http', 'https', 'mailto'],
    src: ['http', 'https'],
  },
}

/**
 * 安全 Markdown 渲染。
 *
 * 不用 rehype-raw，再开 skipHtml：正文里的原始 HTML（<script>、onerror 等）
 * 不会进入 DOM。URL 协议也在 rehype-sanitize 里白名单化，
 * javascript: 链接会被剥掉 href，点了也没反应。
 */
export function MarkdownView({
  children,
  className,
  emptyText,
}: {
  children?: string | null
  className?: string
  emptyText?: string
}) {
  const text = children ?? ''
  const [preview, setPreview] = useState<LightboxImage | null>(null)

  const components = useMemo<Components>(
    () => ({
      a: ({ node: _node, ...props }) => (
        <a {...props} target="_blank" rel="noopener noreferrer nofollow" />
      ),
      img: ({ node: _node, alt, src, ...props }) => (
        <button
          type="button"
          className="md-image-button"
          title="点击预览"
          onClick={(e) => {
            // 图片可能被包在链接里，预览时不要顺带跳走。
            e.preventDefault()
            e.stopPropagation()
            if (src) setPreview({ src, alt: alt ?? '' })
          }}
        >
          <img {...props} src={src} alt={alt ?? ''} loading="lazy" referrerPolicy="no-referrer" />
        </button>
      ),
    }),
    [],
  )

  if (!text.trim() && emptyText) {
    return <p className={cn('text-sm text-ink-400', className)}>{emptyText}</p>
  }
  return (
    <>
      <div className={cn('markdown-body', className)}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[[rehypeSanitize, schema]]}
          skipHtml
          components={components}
        >
          {text}
        </ReactMarkdown>
      </div>
      <ImageLightbox image={preview} onClose={() => setPreview(null)} />
    </>
  )
}
