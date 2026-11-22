import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Bell, Images, ListChecks } from 'lucide-react'
import { api, type Task } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Badge, Dialog } from '@/components/ui/Layout'
import { TASK_STATUS, cn } from '@/lib/utils'
import { SubtaskList } from './SubtaskList'
import { AttachmentGallery } from './AttachmentGallery'

const QUICK_STATUS: Task['status'][] = ['todo', 'doing', 'review', 'done']

// 项目页点任务时的轻量面板：改标题、切状态、勾步骤、看图片都在这里完成，
// 需要改截止日、预算这类字段再进「完整编辑」。
function toDateTimeInput(v?: string | null) {
  if (!v) return ''
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return ''
  const p = (x: number) => String(x).padStart(2, '0')
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes())
}

export function TaskQuickDialog({
  task,
  onClose,
  onEditFull,
}: {
  task: Task
  onClose: () => void
  onEditFull: () => void
}) {
  const qc = useQueryClient()
  const [title, setTitle] = useState(task.title)
  const [status, setStatus] = useState<Task['status']>(task.status)
  const [remindAt, setRemindAt] = useState(toDateTimeInput(task.remindAt))

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['project'] })
    qc.invalidateQueries({ queryKey: ['tasks'] })
    qc.invalidateQueries({ queryKey: ['dashboard'] })
    qc.invalidateQueries({ queryKey: ['dashboard-badges'] })
  }

  const patch = useMutation({
    mutationFn: async (body: Record<string, unknown>) => api.put('/tasks/' + task.id, body),
    onSuccess: refresh,
  })

  const saveTitle = () => {
    const v = title.trim()
    if (!v) {
      setTitle(task.title)
      return
    }
    if (v !== task.title) patch.mutate({ title: v })
  }

  const pickStatus = (s: Task['status']) => {
    if (s === status) return
    setStatus(s)
    patch.mutate({ status: s })
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="任务"
      width="max-w-lg"
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose}>
            关闭
          </Button>
          <Button size="sm" onClick={onEditFull}>
            完整编辑
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={saveTitle}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
          className="w-full rounded-md border border-transparent bg-ink-50/70 px-2 py-1.5 text-sm font-semibold text-ink-900 outline-none focus:border-brand-300 focus:bg-white"
        />

        <div className="flex flex-wrap items-center gap-1.5">
          {QUICK_STATUS.map((s) => {
            const d = TASK_STATUS[s]
            const active = s === status
            return (
              <button
                key={s}
                type="button"
                onClick={() => pickStatus(s)}
                className={cn(
                  'rounded-md border px-2 py-1 text-[11px] font-medium transition-colors',
                  active ? d.soft : 'border-transparent text-ink-400 hover:bg-ink-50 hover:text-ink-700',
                )}
              >
                {d.label}
              </button>
            )
          })}
          {status === 'canceled' && <Badge soft={TASK_STATUS.canceled.soft}>已取消</Badge>}
          {status === 'archived' && <Badge soft={TASK_STATUS.archived.soft}>已归档</Badge>}
        </div>

        {task.kind === 'life' && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border)] px-2.5 py-2">
            <Bell size={13} className="text-ink-400" />
            <span className="text-xs font-medium text-ink-700">提醒时间</span>
            <input
              type="datetime-local"
              value={remindAt}
              onChange={(e) => setRemindAt(e.target.value)}
              onBlur={() => patch.mutate({ remindAt })}
              className="rounded-md bg-ink-50/70 px-2 py-1 text-xs text-ink-800 outline-none focus:bg-white focus:ring-1 focus:ring-brand-300"
            />
            <span className="text-[10px] text-ink-400">到点发邮件</span>
          </div>
        )}

        <div className="rounded-lg border border-[var(--border)] p-2.5">
          <div className="mb-1.5 flex items-center gap-1.5">
            <ListChecks size={13} className="text-ink-400" />
            <span className="text-xs font-medium text-ink-700">步骤</span>
            <span className="text-[10px] text-ink-400">回车添加，点方框打勾</span>
          </div>
          <SubtaskList taskId={task.id} compact />
        </div>

        <div className="rounded-lg border border-[var(--border)] p-2.5">
          <div className="mb-1.5 flex items-center gap-1.5">
            <Images size={13} className="text-ink-400" />
            <span className="text-xs font-medium text-ink-700">图片</span>
            <span className="text-[10px] text-ink-400">可直接粘贴截图</span>
          </div>
          <AttachmentGallery taskId={task.id} enablePaste />
        </div>
      </div>
    </Dialog>
  )
}
