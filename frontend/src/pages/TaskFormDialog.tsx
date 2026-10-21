import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ListChecks, Images } from 'lucide-react'
import { api, errMsg, type Client, type Project, type Task } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Field, Input, Textarea } from '@/components/ui/Input'
import { Select, type Option } from '@/components/ui/Select'
import { DatePicker } from '@/components/ui/DatePicker'
import { TASK_PRIORITY, TASK_STATUS } from '@/lib/utils'
import { Dialog } from '@/components/ui/Layout'
import { toDateInput } from '@/lib/utils'
import { SubtaskList } from './SubtaskList'
import { AttachmentGallery } from './AttachmentGallery'

export function TaskFormDialog({ task, onClose }: { task: Task | null; onClose: () => void }) {
  const qc = useQueryClient()
  const isEdit = !!task
  const [form, setForm] = useState({
    title: task?.title ?? '',
    desc: task?.desc ?? '',
    projectId: task?.projectId ? String(task.projectId) : '',
    clientId: task?.clientId ? String(task.clientId) : '',
    status: task?.status ?? 'todo',
    priority: task?.priority ?? 'normal',
    kind: task?.kind ?? 'freelance',
    dueDate: toDateInput(task?.dueDate),
    remindDays: String(task?.remindDays ?? 1),
    estimateMinutes: task?.estimateMinutes ? String(task.estimateMinutes) : '',
    actualMinutes: task?.actualMinutes ? String(task.actualMinutes) : '',
    budget: task?.budget ? String(task.budget) : '',
    note: task?.note ?? '',
  })
  const [err, setErr] = useState('')

  const { data: projects } = useQuery({
    queryKey: ['projects-lite'],
    queryFn: async () => (await api.get<{ items: Project[] }>('/projects', { params: { size: 200 } })).data.items,
  })
  const { data: clients } = useQuery({
    queryKey: ['clients'],
    queryFn: async () => (await api.get<{ items: Client[] }>('/clients')).data.items,
  })

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        ...form,
        projectId: form.projectId ? Number(form.projectId) : null,
        clientId: form.clientId ? Number(form.clientId) : null,
        remindDays: Number(form.remindDays) || 0,
        estimateMinutes: Number(form.estimateMinutes) || 0,
        actualMinutes: Number(form.actualMinutes) || 0,
        budget: Number(form.budget) || 0,
      }
      if (isEdit) return (await api.put(`/tasks/${task!.id}`, payload)).data
      return (await api.post('/tasks', payload)).data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
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

  const kindOpts: Option[] = [
    { value: 'freelance', label: '私活任务' },
    { value: 'personal', label: '个人项目' },
  ]
  const priorityOpts: Option[] = Object.entries(TASK_PRIORITY).map(([v, d]) => ({
    value: v,
    label: d.label,
    dot: d.color,
  }))
  const statusOpts: Option[] = Object.entries(TASK_STATUS).map(([v, d]) => ({
    value: v,
    label: d.label,
    dot: d.color,
  }))
  const projOpts: Option[] = [
    { value: '', label: '不关联项目' },
    ...(projects ?? []).map((p) => ({ value: String(p.id), label: p.name })),
  ]
  const clientOpts: Option[] = [
    { value: '', label: '不关联客户' },
    ...(clients ?? []).map((c) => ({ value: String(c.id), label: c.name, hint: c.source || undefined })),
  ]

  return (
    <Dialog
      open
      onClose={onClose}
      title={isEdit ? '编辑任务' : '新建任务'}
      width="max-w-xl"
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose}>
            取消
          </Button>
          <Button
            size="sm"
            loading={save.isPending}
            onClick={() => {
              if (!form.title.trim()) return setErr('任务标题必填')
              setErr('')
              save.mutate()
            }}
          >
            保存
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="任务标题" required>
          <Input value={form.title} onChange={set('title')} placeholder="如：为客户制作企业官网首页" autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-x-3 gap-y-3">
          <Field label="归属">
            <Select value={form.kind} onChange={setV('kind')} options={kindOpts} />
          </Field>
          <Field label="优先级">
            <Select value={form.priority} onChange={setV('priority')} options={priorityOpts} />
          </Field>
          <Field label="所属项目">
            <Select value={form.projectId} onChange={setV('projectId')} options={projOpts} />
          </Field>
          <Field label="客户 / 委托方">
            <Select value={form.clientId} onChange={setV('clientId')} options={clientOpts} />
          </Field>
          <Field label="状态">
            <Select value={form.status} onChange={setV('status')} options={statusOpts} />
          </Field>
          <Field label="截止日期">
            <DatePicker value={form.dueDate} onChange={setV('dueDate')} />
          </Field>
          <Field label="提前提醒（天）">
            <Input value={form.remindDays} onChange={set('remindDays')} inputMode="numeric" />
          </Field>
          <Field label="预算 / 报价">
            <Input value={form.budget} onChange={set('budget')} inputMode="decimal" placeholder="0" />
          </Field>
          <Field label="预计工时" hint="分钟，60 = 1 小时">
            <Input value={form.estimateMinutes} onChange={set('estimateMinutes')} inputMode="numeric" />
          </Field>
          <Field label="实际工时">
            <Input value={form.actualMinutes} onChange={set('actualMinutes')} inputMode="numeric" />
          </Field>
        </div>
        <Field label="描述">
          <Textarea value={form.desc} onChange={set('desc')} rows={2} />
        </Field>

        {/* 步骤清单：新建时没有任务 id，存完才能挂步骤，所以只在编辑时出现 */}
        {isEdit && (
          <div className="rounded-lg border border-[var(--border)] p-2.5">
            <div className="mb-1.5 flex items-center gap-1.5">
              <ListChecks size={13} className="text-ink-400" />
              <span className="text-xs font-medium text-ink-700">步骤</span>
              <span className="text-[10px] text-ink-400">一条任务内的分步动作</span>
            </div>
            <SubtaskList taskId={task!.id} />
          </div>
        )}

        {/* 图片：同样依赖任务 id */}
        {isEdit && (
          <div className="rounded-lg border border-[var(--border)] p-2.5">
            <div className="mb-1.5 flex items-center gap-1.5">
              <Images size={13} className="text-ink-400" />
              <span className="text-xs font-medium text-ink-700">图片</span>
              <span className="text-[10px] text-ink-400">截图、参考图</span>
            </div>
            <AttachmentGallery taskId={task!.id} enablePaste />
          </div>
        )}

        <Field label="备注">
          <Textarea value={form.note} onChange={set('note')} rows={2} />
        </Field>
        {err && (
          <div className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-600">{err}</div>
        )}
      </div>
    </Dialog>
  )
}
