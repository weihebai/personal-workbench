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

// datetime-local 需要 YYYY-MM-DDTHH:mm（本地时间）
function toDateTimeInput(v?: string | null) {
  if (!v) return ''
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return ''
  const p = (x: number) => String(x).padStart(2, '0')
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes())
}

export function TaskFormDialog({
  task,
  defaultProjectId,
  defaultClientId,
  defaultKind,
  lockProject,
  onClose,
}: {
  task: Task | null
  defaultProjectId?: number
  defaultClientId?: number
  defaultKind?: string
  // 从项目页进来时，归属/项目/客户已经确定，不再让用户选
  lockProject?: boolean
  onClose: () => void
}) {
  const qc = useQueryClient()
  const isEdit = !!task
  const [form, setForm] = useState({
    title: task?.title ?? '',
    desc: task?.desc ?? '',
    acceptCriteria: task?.acceptCriteria ?? '',
    projectId: task?.projectId ? String(task.projectId) : defaultProjectId ? String(defaultProjectId) : '',
    clientId: task?.clientId ? String(task.clientId) : defaultClientId ? String(defaultClientId) : '',
    status: task?.status ?? 'todo',
    priority: task?.priority ?? 'normal',
    kind: task?.kind ?? defaultKind ?? 'freelance',
    dueDate: toDateInput(task?.dueDate),
    remindAt: toDateTimeInput(task?.remindAt),
    remindDays: String(task?.remindDays ?? 1),
    estimateMinutes: task?.estimateMinutes ? String(task.estimateMinutes) : '',
    actualMinutes: task?.actualMinutes ? String(task.actualMinutes) : '',
    budget: task?.budget ? String(task.budget) : '',
    note: task?.note ?? '',
  })
  const [err, setErr] = useState('')
  // 项目内新建：只留标题、优先级、状态、截止，其余收进「更多选项」
  const quickMode = !!lockProject && !isEdit
  const [showMore, setShowMore] = useState(false)

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
    { value: 'company', label: '公司任务' },
    { value: 'freelance', label: '私活任务' },
    { value: 'personal', label: '个人项目' },
    { value: 'life', label: '生活' },
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
          {!lockProject && (
            <Field label="归属">
              <Select value={form.kind} onChange={setV('kind')} options={kindOpts} />
            </Field>
          )}
          <Field label="优先级">
            <Select value={form.priority} onChange={setV('priority')} options={priorityOpts} />
          </Field>
          {!lockProject && (
            <>
              <Field label="所属项目">
                <Select value={form.projectId} onChange={setV('projectId')} options={projOpts} />
              </Field>
              <Field label="客户 / 委托方">
                <Select value={form.clientId} onChange={setV('clientId')} options={clientOpts} />
              </Field>
            </>
          )}
          <Field label="状态">
            <Select value={form.status} onChange={setV('status')} options={statusOpts} />
          </Field>
          <Field label="截止日期">
            <DatePicker value={form.dueDate} onChange={setV('dueDate')} />
          </Field>
          {form.kind === 'life' && (
            <Field label="提醒时间" hint="到点发邮件提醒，需在设置里开启邮件通知">
              <Input type="datetime-local" value={form.remindAt} onChange={set('remindAt')} />
            </Field>
          )}
          {(!quickMode || showMore) && (
            <>
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
            </>
          )}
        </div>
        {quickMode && (
          <button
            type="button"
            onClick={() => setShowMore((v) => !v)}
            className="text-[11px] text-ink-400 underline decoration-dotted hover:text-ink-600"
          >
            {showMore ? '收起更多选项' : '更多选项：提醒、预算、工时、描述、验收标准、备注'}
          </button>
        )}
        {(!quickMode || showMore) && (
          <>
        <Field label="描述">
          <Textarea value={form.desc} onChange={set('desc')} rows={2} />
        </Field>
        <Field
          label="验收标准"
          hint="一行一条；AI 完成的任务会先进入「待验收」，对着这里逐条实测后再标记完成"
        >
          <Textarea
            value={form.acceptCriteria}
            onChange={set('acceptCriteria')}
            rows={2}
            placeholder={'如：\n页面 /login 可正常登录并跳转\n接口返回 200 且无控制台报错'}
          />
        </Field>
        {/* 备注紧跟验收标准：AI 的交付物和自检记录都写在这里，验收时一眼能对照 */}
        <Field label="备注">
          <Textarea value={form.note} onChange={set('note')} rows={2} />
        </Field>
          </>
        )}

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
        {err && (
          <div className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-600">{err}</div>
        )}
      </div>
    </Dialog>
  )
}
