import { useState } from 'react'
import { Dialog } from '@/components/ui/Layout'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { minutesToHours } from '@/lib/utils'
import type { Task } from '@/lib/api'

// 勾选完成时问一句实际用了多久：预计工时填过才有意义，没填过就直接完成。
export function TaskCompleteDialog({
  task,
  onClose,
  onConfirm,
}: {
  task: Task
  onClose: () => void
  onConfirm: (minutes: number) => void
}) {
  const [minutes, setMinutes] = useState(String(task.actualMinutes || task.estimateMinutes || ''))

  return (
    <Dialog
      open
      onClose={onClose}
      title="完成任务"
      width="max-w-sm"
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose}>
            取消
          </Button>
          <Button size="sm" onClick={() => onConfirm(Number(minutes) || 0)}>
            标记完成
          </Button>
        </>
      }
    >
      <div className="space-y-2.5">
        <p className="text-xs font-medium text-ink-900">{task.title}</p>
        <p className="text-xs leading-relaxed text-ink-500">
          预计 {minutesToHours(task.estimateMinutes)}，实际用了多少分钟？记下来以后估时更准。
        </p>
        <Input
          value={minutes}
          onChange={(e) => setMinutes(e.target.value)}
          inputMode="numeric"
          autoFocus
          placeholder="分钟，60 = 1 小时"
        />
        <button
          type="button"
          onClick={() => onConfirm(task.actualMinutes || 0)}
          className="text-[11px] text-ink-400 underline decoration-dotted hover:text-ink-600"
        >
          不填，直接完成
        </button>
      </div>
    </Dialog>
  )
}
