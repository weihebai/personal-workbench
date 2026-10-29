import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Check, Copy, Link2, RefreshCw, Trash2 } from 'lucide-react'
import { api, errMsg, type Content } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { SHARE_EXPIRY_OPTIONS, expiryLabel, shareState, shareUrl } from '@/lib/content'

const EXPIRY_OPTS = SHARE_EXPIRY_OPTIONS.map((o) => ({
  value: String(o.value),
  label: o.label,
}))

/** 分享链接控件：生成 / 更新有效期 / 轮换 / 撤销 */
export function ShareControls({ content }: { content: Content }) {
  const qc = useQueryClient()
  const [days, setDays] = useState('0')
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState(false)
  const [copyErr, setCopyErr] = useState('')
  const linkRef = useRef<HTMLInputElement>(null)

  const state = shareState(content)
  const url = shareUrl(content.sharePath)

  const refresh = (c: Content) => {
    qc.setQueryData(['content', c.id], c)
    qc.invalidateQueries({ queryKey: ['contents'] })
    qc.invalidateQueries({ queryKey: ['contents-stats'] })
  }

  const share = useMutation({
    mutationFn: async () =>
      (await api.post<Content>(`/contents/${content.id}/share`, { expiresInDays: Number(days) })).data,
    onSuccess: refresh,
    onError: (e) => setErr(errMsg(e)),
  })

  const rotate = useMutation({
    mutationFn: async () => (await api.post<Content>(`/contents/${content.id}/share/rotate`)).data,
    onSuccess: refresh,
    onError: (e) => setErr(errMsg(e)),
  })

  const revoke = useMutation({
    mutationFn: async () => (await api.delete<Content>(`/contents/${content.id}/share`)).data,
    onSuccess: refresh,
    onError: (e) => setErr(errMsg(e)),
  })

  const copy = async () => {
    setCopyErr('')
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      linkRef.current?.focus()
      linkRef.current?.select()
      setCopyErr('复制失败，请手动选择链接复制')
    }
  }

  const act = (fn: () => void) => {
    setErr('')
    fn()
  }

  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5">
        <Link2 size={13} className="text-ink-400" />
        <p className="text-xs font-semibold text-ink-700">公开分享</p>
        {state === 'active' && (
          <span className="ml-auto rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600">
            已开启
          </span>
        )}
      </div>

      {state === 'none' && (
        <div className="space-y-2">
          <div className="flex items-center gap-1">
            <Select size="sm" value={days} onChange={setDays} options={EXPIRY_OPTS} className="flex-1" />
            <Button size="sm" loading={share.isPending} onClick={() => act(() => share.mutate())}>
              <Link2 size={12} /> 生成链接
            </Button>
          </div>
        </div>
      )}

      {state === 'active' && (
        <div className="space-y-2">
          <div className="flex items-center gap-1">
            <div className="relative min-w-0 flex-1">
              <Link2
                size={11}
                className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-400"
              />
              <input
                ref={linkRef}
                readOnly
                value={url}
                onFocus={(e) => e.currentTarget.select()}
                className="h-8 w-full rounded-md border border-[var(--border)] bg-ink-50/60 pl-6 pr-2 text-[11px] text-ink-600 outline-none"
              />
            </div>
            <Button size="sm" variant="outline" onClick={copy}>
              {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
              {copied ? '已复制' : '复制'}
            </Button>
          </div>
          <p className="text-[10px] text-ink-400">{expiryLabel(content.shareExpiresAt)}</p>

          <div className="flex items-center gap-1">
            <Select size="sm" value={days} onChange={setDays} options={EXPIRY_OPTS} className="flex-1" />
            <Button size="sm" variant="outline" loading={share.isPending} onClick={() => act(() => share.mutate())}>
              更新有效期
            </Button>
          </div>

          <div className="flex items-center gap-1 border-t border-[var(--border)] pt-2">
            <Button
              size="sm"
              variant="ghost"
              loading={rotate.isPending}
              onClick={() => {
                if (confirm('重新生成后，旧链接会立即失效，确定吗？')) act(() => rotate.mutate())
              }}
            >
              <RefreshCw size={11} /> 重新生成
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-red-500 hover:bg-red-50 hover:text-red-600"
              loading={revoke.isPending}
              onClick={() => {
                if (confirm('撤销后，已发出的链接会立即失效，确定吗？')) act(() => revoke.mutate())
              }}
            >
              <Trash2 size={11} /> 撤销分享
            </Button>
          </div>
        </div>
      )}

      {state === 'expired' && (
        <div className="space-y-2">
          <p className="flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-700">
            <AlertTriangle size={11} /> 链接已过期，重新生成后旧链接仍然无效
          </p>
          <div className="flex items-center gap-1">
            <Select size="sm" value={days} onChange={setDays} options={EXPIRY_OPTS} className="flex-1" />
            <Button size="sm" loading={share.isPending} onClick={() => act(() => share.mutate())}>
              <RefreshCw size={12} /> 重新生成链接
            </Button>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="text-red-500 hover:bg-red-50 hover:text-red-600"
            loading={revoke.isPending}
            onClick={() => {
              if (confirm('撤销后，这条内容的分享状态会被清空，确定吗？')) act(() => revoke.mutate())
            }}
          >
            <Trash2 size={11} /> 撤销分享
          </Button>
        </div>
      )}

      {copyErr && <p className="mt-1.5 text-[11px] text-red-600">{copyErr}</p>}
      {err && <p className="mt-1.5 text-[11px] text-red-600">{err}</p>}

      <p className="mt-2 text-[10px] leading-relaxed text-ink-400">
        拿到链接的人无需登录即可查看正文和图片；页面已标记不收录。撤销后链接立即失效。
      </p>
    </div>
  )
}
