import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CalendarClock, Wand2 } from 'lucide-react'
import { api, errMsg, type Milestone } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Field, Input, Textarea } from '@/components/ui/Input'
import { Select, type Option } from '@/components/ui/Select'
import { DatePicker } from '@/components/ui/DatePicker'
import { Dialog } from '@/components/ui/Layout'
import { cn, toDateInput, MILESTONE_STATUS } from '@/lib/utils'
import { addWorkdays, addNaturalDays, fmtDateCn, toISO } from '@/lib/workday'

const STATUS_OPTS: Option[] = Object.entries(MILESTONE_STATUS).map(([v, d]) => ({
  value: v,
  label: d.label,
  dot: d.color,
}))

const DAYTYPE_OPTS: Option[] = [
  { value: 'workday', label: '工作日（跳过周末）' },
  { value: 'natural', label: '自然日' },
]

const PRESETS = [
  { label: '备案审核', days: 12, dayType: 'workday' as const },
  { label: '客户验收', days: 5, dayType: 'workday' as const },
  { label: '等客户反馈', days: 3, dayType: 'natural' as const },
]

export function MilestoneFormDialog({
  milestone,
  projectId,
  onClose,
}: {
  milestone: Milestone | null
  projectId: number
  onClose: () => void
}) {
  const qc = useQueryClient()
  const isEdit = !!milestone

  const [form, setForm] = useState({
    title: milestone?.title ?? '',
    expect: milestone?.expect ?? '',
    status: (milestone?.status ?? 'waiting') as string,
    startDate: toDateInput(milestone?.startDate) || toISO(new Date()),
    dayType: (milestone?.dayType ?? 'workday') as string,
    days: milestone?.days ? String(milestone.days) : '12',
    dueDate: toDateInput(milestone?.dueDate),
    remindDays: String(milestone?.remindDays ?? 3),
    note: milestone?.note ?? '',
  })
  const [manualDue, setManualDue] = useState(!!milestone?.dueDate && !milestone?.days)
  const [err, setErr] = useState('')

  // 实时推算目标日期
  const preview = useMemo(() => {
    if (manualDue) return form.dueDate ? new Date(form.dueDate) : null
    const days = Number(form.days)
    if (!form.startDate || !days) return null
    const start = new Date(form.startDate)
    if (Number.isNaN(start.getTime())) return null
    return form.dayType === 'natural' ? addNaturalDays(start, days) : addWorkdays(start, days)
  }, [form.startDate, form.days, form.dayType, form.dueDate, manualDue])

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        projectId,
        title: form.title,
        expect: form.expect,
        status: form.status,
        startDate: form.startDate,
        dayType: form.dayType,
        days: manualDue ? 0 : Number(form.days) || 0,
        // 注意：必须用本地时区格式化，toISOString() 在东八区会偏移一天
        dueDate: manualDue ? form.dueDate : preview ? toISO(preview) : '',
        remindDays: Number(form.remindDays) || 3,
        note: form.note,
      }
      if (isEdit) return (await api.put(`/milestones/${milestone!.id}`, payload)).data
      return (await api.post('/milestones', payload)).data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project'] })
      qc.invalidateQueries({ queryKey: ['projects'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['dashboard-badges'] })
      qc.invalidateQueries({ queryKey: ['milestones'] })
      onClose()
    },
    onError: (e) => setErr(errMsg(e)),
  })

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<any>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  return (
    <Dialog
      open
      onClose={onClose}
      title={isEdit ? '编辑进度节点' : '新增进度节点'}
      description="记录预期效果与时间，到期提醒你去核查"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            loading={save.isPending}
            onClick={() => {
              if (!form.title.trim()) return setErr('节点名称必填')
              setErr('')
              save.mutate()
            }}
          >
            {isEdit ? '保存修改' : '添加节点'}
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <Field label="节点名称" required hint="如：提交域名备案 / 首页交付验收">
          <Input value={form.title} onChange={set('title')} placeholder="做到什么程度" autoFocus />
        </Field>

        <Field label="预期效果" hint="达到什么标准算完成？到期时你按这个去核查">
          <Textarea
            value={form.expect}
            onChange={set('expect')}
            rows={2}
            placeholder="如：备案通过拿到备案号；或 首页+列表页完成并通过客户验收"
          />
        </Field>

        <div className="grid grid-cols-2 gap-x-3 gap-y-3">
          <Field label="状态">
            <Select
              value={form.status}
              onChange={(v) => setForm((f) => ({ ...f, status: v }))}
              options={STATUS_OPTS}
            />
          </Field>
          <Field label="提前提醒（天）">
            <Input value={form.remindDays} onChange={set('remindDays')} inputMode="numeric" />
          </Field>
        </div>

        {/* 时间推算 */}
        <div className="rounded-xl border border-[var(--border)] bg-ink-50/50 p-3">
          <div className="mb-2.5 flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold text-ink-500">
              <CalendarClock size={12} /> 时间推算
            </p>
            <button
              type="button"
              onClick={() => setManualDue((v) => !v)}
              className="flex items-center gap-1 text-[10px] font-medium text-brand-600 hover:text-brand-700"
            >
              <Wand2 size={10} />
              {manualDue ? '改为按天数自动算' : '改为直接指定日期'}
            </button>
          </div>

          {!manualDue ? (
            <div className="grid grid-cols-3 gap-2.5">
              <Field label="起始日">
                <DatePicker
                  value={form.startDate}
                  onChange={(v) => setForm((f) => ({ ...f, startDate: v }))}
                />
              </Field>
              <Field label="工期">
                <Input value={form.days} onChange={set('days')} inputMode="numeric" />
              </Field>
              <Field label="计算方式">
                <Select
                  value={form.dayType}
                  onChange={(v) => setForm((f) => ({ ...f, dayType: v }))}
                  options={DAYTYPE_OPTS}
                />
              </Field>
            </div>
          ) : (
            <Field label="目标日期">
              <DatePicker value={form.dueDate} onChange={(v) => setForm((f) => ({ ...f, dueDate: v }))} />
            </Field>
          )}

          {/* 推算结果 */}
          <div
            className={cn(
              'mt-2.5 flex items-center gap-2 rounded-lg border px-2.5 py-2',
              preview ? 'border-brand-200 bg-brand-50' : 'border-ink-200 bg-ink-50',
            )}
          >
            <span className={cn('dot', preview ? 'bg-brand-500' : 'bg-ink-300')} />
            {preview ? (
              <p className="text-[11px] text-ink-600">
                预计 <span className="font-semibold text-brand-700">{fmtDateCn(preview)}</span> 到期
                <span className="ml-1 text-ink-400">
                  （{form.dayType === 'natural' ? '自然日' : '工作日'} {form.days} 天）
                </span>
              </p>
            ) : (
              <p className="text-[11px] text-ink-400">填写起始日与工期后自动计算</p>
            )}
          </div>

          {/* 常用预设 */}
          <div className="mt-2 flex flex-wrap items-center gap-1">
            <span className="text-[10px] text-ink-400">常用：</span>
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() =>
                  setForm((f) => ({ ...f, days: String(p.days), dayType: p.dayType }))
                }
                className="rounded border border-dashed border-ink-200 px-1.5 py-0.5 text-[10px] text-ink-500 hover:border-brand-300 hover:text-brand-600"
              >
                {p.label} {p.days}
                {p.dayType === 'workday' ? '工作日' : '天'}
              </button>
            ))}
          </div>
        </div>

        <Field label="备注">
          <Textarea value={form.note} onChange={set('note')} rows={2} placeholder="备案账号、核查入口等" />
        </Field>

        {err && (
          <div className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-600">{err}</div>
        )}
      </div>
    </Dialog>
  )
}
