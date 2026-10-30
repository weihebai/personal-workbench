import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Clock } from 'lucide-react'
import { api, errMsg, type WorkLog } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Field, Input, Textarea } from '@/components/ui/Input'
import { DatePicker } from '@/components/ui/DatePicker'
import { Dialog } from '@/components/ui/Layout'
import { money, toDateInput } from '@/lib/utils'

export function WorkLogFormDialog({
  projectId,
  log,
  hourlyRate,
  onClose,
}: {
  projectId: number
  log: WorkLog | null
  hourlyRate: number
  onClose: () => void
}) {
  const qc = useQueryClient()
  const isEdit = !!log

  const [form, setForm] = useState({
    workDate: toDateInput(log?.workDate) || todayInput(),
    hours: log ? minutesToHoursInput(log.minutes) : '',
    content: log?.content ?? '',
  })
  const [err, setErr] = useState('')

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<any>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  const hours = Number(form.hours) || 0
  const amount = hours > 0 && hourlyRate > 0 ? Math.round(hours * hourlyRate * 100) / 100 : 0

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        workDate: form.workDate,
        minutes: Math.round(hours * 60),
        content: form.content.trim(),
      }
      if (isEdit) return (await api.put(`/worklogs/${log!.id}`, payload)).data
      return (await api.post(`/projects/${projectId}/worklogs`, payload)).data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project', String(projectId)] })
      qc.invalidateQueries({ queryKey: ['project'] })
      qc.invalidateQueries({ queryKey: ['projects'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      onClose()
    },
    onError: (e) => setErr(errMsg(e)),
  })

  return (
    <Dialog
      open
      onClose={onClose}
      title={isEdit ? '编辑工时' : '记录工时'}
      description={hourlyRate > 0 ? '记下这次干了多久、做了什么，应结金额自动跟着算' : '记下这次干了多久、做了什么'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            loading={save.isPending}
            onClick={() => {
              if (!form.workDate) return setErr('日期必填')
              if (!(hours > 0)) return setErr('工时必须大于 0')
              if (!form.content.trim()) return setErr('工作内容必填')
              setErr('')
              save.mutate()
            }}
          >
            {isEdit ? '保存修改' : '添加记录'}
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <div className="grid grid-cols-2 gap-x-3 gap-y-3">
          <Field label="日期" required>
            <DatePicker value={form.workDate} onChange={(v) => setForm((f) => ({ ...f, workDate: v }))} />
          </Field>
          <Field label="工时" required hint="小时，支持小数，如 1.5">
            <Input value={form.hours} onChange={set('hours')} inputMode="decimal" placeholder="0" autoFocus />
          </Field>
        </div>

        <Field label="工作内容" required hint="这次做了什么，之后对账和复盘都靠它">
          <Textarea
            value={form.content}
            onChange={set('content')}
            rows={3}
            placeholder="如：首页改版、对接支付回调、修列表分页问题"
          />
        </Field>

        {amount > 0 && (
          <div className="flex items-center gap-1.5 rounded-lg border border-cyan-200 bg-cyan-50/60 px-2.5 py-2 text-[11px] text-cyan-800">
            <Clock size={12} />
            <span>
              {hours} 小时 × {money(hourlyRate)}/小时 = <b className="tabular">{money(amount)}</b>
            </span>
          </div>
        )}

        {err && (
          <div className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-600">{err}</div>
        )}
      </div>
    </Dialog>
  )
}

function todayInput() {
  const d = new Date()
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function minutesToHoursInput(minutes: number) {
  return String(Number((minutes / 60).toFixed(2)))
}
