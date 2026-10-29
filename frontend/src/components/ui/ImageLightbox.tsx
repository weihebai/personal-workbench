import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

export type LightboxImage = {
  src: string
  alt?: string
}

/** 图片点击预览：不用新标签页，统一在页面内浮层查看。 */
export function ImageLightbox({
  image,
  onClose,
}: {
  image: LightboxImage | null
  onClose: () => void
}) {
  useEffect(() => {
    if (!image) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prevOverflow
      document.removeEventListener('keydown', onKey)
    }
  }, [image, onClose])

  if (!image) return null

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="图片预览"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      className="fixed inset-0 z-[10000] flex flex-col items-center justify-center gap-2 bg-ink-950/85 p-4 backdrop-blur-sm animate-in"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="关闭预览"
        className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
      >
        <X size={18} />
      </button>
      <img
        src={image.src}
        alt={image.alt ?? ''}
        referrerPolicy="no-referrer"
        className="max-h-[86vh] max-w-[94vw] rounded-lg object-contain shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      />
      {image.alt && (
        <p className="max-w-[90vw] truncate text-center text-xs text-white/70">{image.alt}</p>
      )}
    </div>,
    document.body,
  )
}
