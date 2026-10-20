import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, errMsg, type Payment, type Project } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Field, Input, Textarea } from '@/components/ui/Input'
import { Select, type Option } from '@/components/ui/Select'
import { DatePicker } from '@/components/ui/DatePicker'
import { Dialog } from '@/components/ui/Layout'
import { toDateInput, PAYMENT_STATUS } from '@/lib/utils'

const STATUS_OPTS: Option[] = Object.entries(PAYMENT_STATUS).map(([v, d]) => ({
  value: v,
  label: d.label,
  dot: d.color,
}))

export function PaymentFormDialog({
  payment,
  defaultProjectId,
  onClose,
}: {
  payment: Payment | null
  defaultProjectId?: number
  onClose: () => void
}) {
  const qc = useQueryClient()
  const isEdit = !!payment
  const [form, setForm] = useState({
    projectId: String(payment?.projectId ?? defaultProjectId ?? ''),
    title: payment?.title ?? '',
    amount: payment?.amount ? String(payment.amount) : '',
    status: payment?.status ?? 'pending',
    planDate: toDateInput(payment?.planDate),
    paidDate: toDateInput(payment?.paidDate),
    note: payment?.note ?? '',
  })
  const [err, setErr] = useState('')

  const { data: projects } = useQuery({
    queryKey: ['projects-lite'],
    queryFn: async () => (await api.get<{ items: Project[] }>('/projects', { params: { size: 200 } })).data.items,
  })

  const projOpts: Option[] = [
    { value: '', label: '选择项目' },
    ...(projects ?? []).map((p) => ({ value: String(p.id), label: p.name })),
  ]

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        ...form,
        projectId: Number(form.projectId),
        amount: Number(form.amount) || 0,
      }
      if (isEdit) return (await api.put(`/payments/${payment!.id}`, payload)).data
      return (await api.post('/payments', payload)).data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payments'] })
      qc.invalidateQueries({ queryKey: ['projects'] })
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

  return (
    <Dialog
      open
      onClose={onClose}
      title={isEdit ? '编辑收款' : '添加收款'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            loading={save.isPending}
            onClick={() => {
              if (!form.projectId) return setErr('请选择项目')
              if (!form.amount) return setErr('请填写金额')
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
        <Field label="所属项目" required>
          <Select
            value={form.projectId}
            onChange={setV('projectId')}
            options={projOpts}
            disabled={!!defaultProjectId}
          />
        </Field>
        <div className="grid grid-cols-2 gap-x-3 gap-y-3">
          <Field label="款项名称" hint="首款 / 中期款 / 尾款">
            <Input value={form.title} onChange={set('title')} />
          </Field>
          <Field label="金额" required>
            <Input value={form.amount} onChange={set('amount')} inputMode="decimal" placeholder="0.00" />
          </Field>
          <Field label="状态">
            <Select value={form.status} onChange={setV('status')} options={STATUS_OPTS} />
          </Field>
          <Field label="约定收款日">
            <DatePicker value={form.planDate} onChange={setV('planDate')} />
          </Field>
          <Field label="实际到账日" className="col-span-2">
            <DatePicker value={form.paidDate} onChange={setV('paidDate')} />
          </Field>
        </div>
        <Field label="备注">
          <Textarea value={form.note} onChange={set('note')} rows={2} placeholder="支付方式、发票等" />
        </Field>
        {err && (
          <div className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-600">{err}</div>
        )}
      </div>
    </Dialog>
  )
}
