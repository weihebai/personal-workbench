import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Lightbulb, Link2, Zap } from 'lucide-react'
import { api, errMsg, type Idea, type Project } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Field, Input, Textarea } from '@/components/ui/Input'
import { Select, type Option } from '@/components/ui/Select'
import { Dialog } from '@/components/ui/Layout'
import { cn, IDEA_STATUS, IDEA_SOURCE } from '@/lib/utils'

const STATUS_OPTS: Option[] = Object.entries(IDEA_STATUS).map(([v, d]) => ({
  value: v,
  label: d.label,
  dot: d.color,
}))
const SOURCE_OPTS: Option[] = Object.entries(IDEA_SOURCE).map(([v, d]) => ({
  value: v,
  label: d.label,
  dot: d.color,
}))

export function IdeaFormDialog({ idea, onClose }: { idea: Idea | null; onClose: () => void }) {
  const qc = useQueryClient()
  const isEdit = !!idea
  const [form, setForm] = useState({
    title: idea?.title ?? '',
    url: idea?.url ?? '',
    source: idea?.source ?? '',
    content: idea?.content ?? '',
    note: idea?.note ?? '',
    status: idea?.status ?? 'inbox',
    star: idea?.star ?? 0,
    tags: idea?.tags ?? '',
    projectId: idea?.projectId ? String(idea.projectId) : '',
  })
  const [err, setErr] = useState('')

  const { data: projects } = useQuery({
    queryKey: ['projects-lite'],
    queryFn: async () => (await api.get<{ items: Project[] }>('/projects', { params: { size: 200 } })).data.items,
  })

  const projOpts: Option[] = [
    { value: '', label: '不关联项目' },
    ...(projects ?? []).map((p) => ({ value: String(p.id), label: p.name })),
  ]

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['ideas'] })
    qc.invalidateQueries({ queryKey: ['ideas-stats'] })
  }

  const save = useMutation({
    mutationFn: async (payload: any) => {
      if (isEdit) return (await api.put(`/ideas/${idea!.id}`, payload)).data
      return (await api.post('/ideas', payload)).data
    },
    onSuccess: () => {
      invalidate()
      onClose()
    },
    onError: (e) => setErr(errMsg(e)),
  })

  const buildPayload = (over?: Partial<typeof form>) => {
    const f = { ...form, ...over }
    return {
      ...f,
      projectId: f.projectId ? Number(f.projectId) : null,
      star: Number(f.star) || 0,
      source: f.source, // 留空时后端自动识别
    }
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<any>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  const canSave = !!(form.title.trim() || form.url.trim() || form.content.trim() || form.note.trim())

  // 只粘了链接 → 允许一键保存，标题由后端推导
  const urlOnlySave = () => {
    if (!form.url.trim()) return
    setErr('')
    save.mutate(buildPayload({ title: '' }))
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={isEdit ? '编辑记录' : '记一条灵感'}
      description="粘个链接就行，标题会自动识别；也可以只写想法"
      width="max-w-xl"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          {!isEdit && form.url.trim() && !form.title.trim() && (
            <Button variant="outline" loading={save.isPending} onClick={urlOnlySave}>
              <Zap size={13} /> 直接存链接
            </Button>
          )}
          <Button
            loading={save.isPending}
            onClick={() => {
              if (!canSave) return setErr('至少填链接、标题或内容中的一项')
              setErr('')
              save.mutate(buildPayload())
            }}
          >
            {isEdit ? '保存修改' : '存入收件箱'}
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <Field label="链接" hint="公众号 / GitHub / 任意文章地址">
          <div className="relative">
            <Link2 size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400" />
            <Input
              value={form.url}
              onChange={set('url')}
              placeholder="https://mp.weixin.qq.com/s/..."
              className="pl-8"
              autoFocus
            />
          </div>
        </Field>

        <Field label="标题" hint={!form.title.trim() && form.url.trim() ? '留空自动从链接生成' : undefined}>
          <Input value={form.title} onChange={set('title')} placeholder="给它起个名，方便以后找" />
        </Field>

        <div className="grid grid-cols-2 gap-x-3 gap-y-3">
          <Field label="来源" hint="留空自动判断">
            <Select
              value={form.source}
              onChange={(v) => setForm((f) => ({ ...f, source: v as any }))}
              options={[{ value: '', label: '自动识别' }, ...SOURCE_OPTS]}
            />
          </Field>
          <Field label="状态">
            <Select
              value={form.status}
              onChange={(v) => setForm((f) => ({ ...f, status: v as any }))}
              options={STATUS_OPTS}
            />
          </Field>
        </div>

        <Field label="我的想法" hint="为什么存它、能怎么用——这是以后真正有价值的">
          <Textarea
            value={form.note}
            onChange={set('note')}
            rows={3}
            placeholder="如：这个思路可以用到 XX 项目里，回头试试"
          />
        </Field>

        <Field label="原文摘录" hint="怕链接失效可以贴一段关键内容">
          <Textarea value={form.content} onChange={set('content')} rows={3} placeholder="关键段落…" />
        </Field>

        <div className="grid grid-cols-2 gap-x-3 gap-y-3">
          <Field label="标签" hint="逗号分隔">
            <Input value={form.tags} onChange={set('tags')} placeholder="AI,前端,副业" />
          </Field>
          <Field label="关联项目">
            <Select
              value={form.projectId}
              onChange={(v) => setForm((f) => ({ ...f, projectId: v }))}
              options={projOpts}
            />
          </Field>
        </div>

        <Field label="重要程度">
          <div className="flex items-center gap-1">
            {[1, 2, 3].map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setForm((f) => ({ ...f, star: f.star === s ? 0 : s }))}
                className={cn(
                  'flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] transition-colors',
                  form.star >= s
                    ? 'border-amber-300 bg-amber-50 text-amber-700'
                    : 'border-[var(--border)] text-ink-400 hover:border-ink-300',
                )}
              >
                <Lightbulb size={11} className={form.star >= s ? 'text-amber-500' : ''} />
                {['一般', '有用', '很有价值'][s - 1]}
              </button>
            ))}
          </div>
        </Field>

        {err && (
          <div className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-600">{err}</div>
        )}
      </div>
    </Dialog>
  )
}
