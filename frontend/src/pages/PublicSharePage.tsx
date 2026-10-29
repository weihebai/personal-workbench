import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { FileQuestion } from 'lucide-react'
import { publicApi } from '@/lib/publicApi'
import type { PublicContent } from '@/lib/api'
import { fmtDate } from '@/lib/utils'
import { BrandMark } from '@/components/BrandMark'
import { MarkdownView } from '@/components/content/MarkdownView'
import { ImageLightbox, type LightboxImage } from '@/components/ui/ImageLightbox'

// 注入 noindex / no-referrer，卸载时把自己加的元素删掉。
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

export default function PublicSharePage() {
  const { token = '' } = useParams()
  const [preview, setPreview] = useState<LightboxImage | null>(null)
  useNoIndexMeta()

  const { data, isLoading, isError } = useQuery({
    queryKey: ['public-content', token],
    queryFn: async () => (await publicApi.get<PublicContent>(`/contents/${token}`)).data,
    retry: false,
    staleTime: 5 * 60_000,
  })

  // 已经写进正文的图片不再在底部重复铺一遍。
  const extraAttachments = data
    ? data.attachments.filter((a) => !data.body.includes(a.url))
    : []

  useEffect(() => {
    const prev = document.title
    document.title = data ? `${data.title} · 个人工作台` : '分享内容 · 个人工作台'
    return () => {
      document.title = prev
    }
  }, [data])

  return (
    <div className="min-h-screen bg-[var(--bg)] px-3 py-6 sm:px-5 sm:py-10">
      <div className="mx-auto w-full max-w-[760px]">
        <div className="mb-3 flex items-center gap-1.5 px-1 text-[11px] text-ink-400">
          <span className="flex h-5 w-5 items-center justify-center rounded bg-brand-500 text-white">
            <BrandMark className="h-3.5 w-3.5" />
          </span>
          来自个人工作台
        </div>

        {isLoading && <ShareSkeleton />}

        {isError && (
          <div className="card flex flex-col items-center justify-center gap-2 px-4 py-20 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-ink-100 text-ink-400">
              <FileQuestion size={20} />
            </div>
            <p className="text-sm font-medium text-ink-900">分享不存在或已失效</p>
            <p className="max-w-xs text-xs text-ink-400">链接可能已被撤销、已过期，或地址不完整。</p>
          </div>
        )}

        {data && (
          <article className="card px-5 py-6 sm:px-10 sm:py-9">
            <header>
              <h1 className="text-xl font-bold leading-snug tracking-tight text-ink-950 sm:text-2xl">
                {data.title}
              </h1>
              <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[11px] text-ink-400">
                <span>更新于 {fmtDate(data.updatedAt)}</span>
                {data.tags.map((t) => (
                  <span
                    key={t}
                    className="rounded-md border border-ink-200 bg-ink-50 px-1.5 py-0.5 text-[11px] text-ink-600"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </header>

            <div className="mt-6 border-t border-[var(--border)] pt-5">
              <MarkdownView>{data.body}</MarkdownView>
            </div>

            {extraAttachments.length > 0 && (
              <div className="mt-6 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                {extraAttachments.map((a, i) => (
                  <button
                    key={`${a.url}-${i}`}
                    type="button"
                    onClick={() => setPreview({ src: a.url, alt: `图片 ${i + 1}` })}
                    title="点击预览"
                    className="block overflow-hidden rounded-lg border border-[var(--border)] bg-ink-50"
                  >
                    <img
                      src={a.url}
                      alt={`图片 ${i + 1}`}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      className="h-full max-h-64 w-full cursor-zoom-in object-cover transition-opacity hover:opacity-90"
                    />
                  </button>
                ))}
              </div>
            )}
          </article>
        )}

        <p className="mt-4 text-center text-[10px] text-ink-300">仅限获得链接的人查看，请勿公开转发。</p>
      </div>

      <ImageLightbox image={preview} onClose={() => setPreview(null)} />
    </div>
  )
}

function ShareSkeleton() {
  return (
    <div className="card animate-pulse space-y-3 px-5 py-6 sm:px-10 sm:py-9">
      <div className="h-7 w-3/4 rounded bg-ink-100" />
      <div className="h-3 w-32 rounded bg-ink-100" />
      <div className="pt-3">
        <div className="h-3 w-full rounded bg-ink-100" />
        <div className="mt-2 h-3 w-11/12 rounded bg-ink-100" />
        <div className="mt-2 h-3 w-4/5 rounded bg-ink-100" />
      </div>
    </div>
  )
}
