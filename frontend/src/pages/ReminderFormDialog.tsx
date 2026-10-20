import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, errMsg, type Project, type Reminder } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Field, Input, Textarea } from '@/components/ui/Input'
import { Select, type Option } from '@/components/ui/Select'
import { DatePicker } from '@/components/ui/DatePicker'
import { Dialog } from '@/components/ui/Layout'
import { toDateInput, REMINDER_CATEGORY } from '@/lib/utils'

const CAT_OPTS: Option[] = Object.entries(REMINDER_CATEGORY).map(([v, d]) => ({
  value: v,
  label: d.label,
  dot: d.color,
}))

export function ReminderFormDialog({
  reminder,
  onClose,
}: {
  reminder: Reminder | null
  onClose: () => void
}) {
  const qc = useQueryClient()
  const isEdit = !!reminder
  const [form, setForm] = useState({
    title: reminder?.title ?? '',
    category: reminder?.category ?? 'certificate',
    projectId: reminder?.projectId ? String(reminder.projectId) : '',
    target: reminder?.target ?? '',
    expireAt: toDateInput(reminder?.expireAt),
    remindDays: String(reminder?.remindDays ?? 15),
    issuer: reminder?.issuer ?? '',
    autoRenew: reminder?.autoRenew ?? false,
    note: reminder?.note ?? '',
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

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        ...form,
        projectId: form.projectId ? Number(form.projectId) : null,
        remindDays: Number(form.remindDays) || 7,
      }
      if (isEdit) return (await api.put(`/reminders/${reminder!.id}`, payload)).data
      return (await api.post('/reminders', payload)).data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reminders'] })
      qc.invalidateQueries({ queryKey: ['project'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['dashboard-badges'] })
      onClose()
    },
    onError: (e) => setErr(errMsg(e)),
  })

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<any>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))
  const setV = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }))

  const showCertFields = form.category === 'certificate' || form.category === 'domain'

  return (
    <Dialog
      open
      onClose={onClose}
      title={isEdit ? '编辑提醒' : '新建到期提醒'}
      description="客户服务器上的证书、域名、账单，到期前提醒你"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            loading={save.isPending}
            onClick={() => {
              if (!form.title.trim()) return setErr('提醒名称必填')
              if (!form.expireAt) return setErr('请选择到期日期')
              setErr('')
              save.mutate()
            }}
          >
            保存
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <Field label="提醒名称" required>
          <Input value={form.title} onChange={set('title')} placeholder="如：客户A 官网 SSL 证书" autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-x-3 gap-y-3">
          <Field label="类型">
            <Select value={form.category} onChange={setV('category')} options={CAT_OPTS} />
          </Field>
          <Field label="关联项目">
            <Select value={form.projectId} onChange={setV('projectId')} options={projOpts} />
          </Field>
          <Field label={form.category === 'domain' ? '域名' : '目标 / 主机'} className="col-span-2">
            <Input
              value={form.target}
              onChange={set('target')}
              placeholder={form.category === 'certificate' ? 'client-a.com' : '目标地址或说明'}
            />
          </Field>
          <Field label="到期日期" required>
            <DatePicker value={form.expireAt} onChange={setV('expireAt')} />
          </Field>
          <Field label="提前提醒（天）">
            <Input value={form.remindDays} onChange={set('remindDays')} inputMode="numeric" />
          </Field>
          {showCertFields && (
            <Field label="签发机构" className="col-span-2">
              <Input value={form.issuer} onChange={set('issuer')} placeholder="Let's Encrypt / 阿里云 / 腾讯云" />
            </Field>
          )}
        </div>
        <label className="flex items-center gap-2 text-xs text-ink-600">
          <input
            type="checkbox"
            checked={form.autoRenew}
            onChange={(e) => setForm((f) => ({ ...f, autoRenew: e.target.checked }))}
            className="h-3.5 w-3.5 accent-brand-500"
          />
          已配置自动续期（仅作记录）
        </label>
        <Field label="备注">
          <Textarea value={form.note} onChange={set('note')} rows={2} placeholder="续费账号、操作步骤等" />
        </Field>
        {err && (
          <div className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-600">{err}</div>
        )}
      </div>
    </Dialog>
  )
}
