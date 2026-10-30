import { useEffect, useRef, useState } from 'react'
import { Mic, Square } from 'lucide-react'
import { cn } from '@/lib/utils'

// 浏览器原生语音识别。Chrome / Edge / Safari 都是前缀实现，
// 国内 Chrome 依赖 Google 的识别服务，通常不可用；Edge 走 Azure，可用性更好。
type SpeechRecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((e: any) => void) | null
  onerror: ((e: any) => void) | null
  onend: (() => void) | null
}

function recognitionCtor(): (new () => SpeechRecognitionLike) | null {
  const w = window as any
  return w.SpeechRecognition || w.webkitSpeechRecognition || null
}

/**
 * 语音输入按钮：连续识别，只把最终结果追加到目标字段。
 * 不支持的浏览器直接不渲染，避免留一个点了没反应的按钮。
 */
export function VoiceButton({
  onText,
  className,
  lang = 'zh-CN',
}: {
  onText: (text: string) => void
  className?: string
  lang?: string
}) {
  const [supported, setSupported] = useState(false)
  const [listening, setListening] = useState(false)
  const [err, setErr] = useState('')
  const recRef = useRef<SpeechRecognitionLike | null>(null)
  const onTextRef = useRef(onText)
  useEffect(() => {
    onTextRef.current = onText
  }, [onText])

  useEffect(() => {
    setSupported(!!recognitionCtor())
    return () => {
      recRef.current?.abort()
      recRef.current = null
    }
  }, [])

  if (!supported) return null

  const stop = () => {
    recRef.current?.stop()
    recRef.current = null
    setListening(false)
  }

  const start = () => {
    const Ctor = recognitionCtor()
    if (!Ctor) return
    const rec = new Ctor()
    rec.lang = lang
    rec.continuous = true
    rec.interimResults = false
    rec.onresult = (e: any) => {
      let text = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) text += e.results[i][0].transcript
      }
      if (text.trim()) onTextRef.current(text)
    }
    rec.onerror = (e: any) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        setErr('未获得麦克风权限')
      } else if (e.error === 'network') {
        setErr('语音服务不可用')
      } else if (e.error !== 'aborted') {
        setErr('识别失败，请重试')
      }
      setListening(false)
      recRef.current = null
    }
    rec.onend = () => {
      setListening(false)
      recRef.current = null
    }
    recRef.current = rec
    setErr('')
    setListening(true)
    try {
      rec.start()
    } catch {
      setErr('无法启动语音识别')
      setListening(false)
      recRef.current = null
    }
  }

  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      {err && <span className="text-[10px] text-red-500">{err}</span>}
      <button
        type="button"
        onClick={listening ? stop : start}
        aria-pressed={listening}
        className={cn(
          'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium transition-colors',
          listening
            ? 'border-red-300 bg-red-50 text-red-600'
            : 'border-ink-200 bg-white text-ink-500 hover:border-brand-300 hover:text-brand-600',
        )}
      >
        {listening ? <Square size={9} /> : <Mic size={10} />}
        {listening ? '停止' : '语音输入'}
      </button>
    </div>
  )
}
