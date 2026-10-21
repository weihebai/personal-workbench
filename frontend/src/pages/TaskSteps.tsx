import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Plus, ChevronDown, ListChecks } from 'lucide-react'
import { api, type Subtask, type Task } from '@/lib/api'
import { cn } from '@/lib/utils'

/**
 * 卡片上直接展开显示的步骤清单。
 *
 * 用的是任务列表接口 withSubtasks=1 带回来的数据，所以展开不发请求，
 * 勾选后统一 invalidate ['tasks'] 刷新。之前只能进编辑弹窗才能看，
 * 一条任务想确认「还剩哪几步」得点两层，太绕。
 */
export function TaskSteps({ task, dense }: { task: Task; dense?: boolean }) {
  const qc = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const steps = task.subtasks ?? []

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['tasks'] })
    qc.invalidateQueries({ queryKey: ['subtasks', task.id] })
    qc.invalidateQueries({ queryKey: ['dashboard'] })
  }

  const toggle = useMutation({
    mutationFn: async (st: Subtask) => api.put(`/subtasks/${st.id}`, { done: !st.done }),
    onSuccess: invalidate,
  })

  const add = useMutation({
    mutationFn: async (title: string) => api.post(`/tasks/${task.id}/subtasks`, { title }),
    onSuccess: () => {
      setDraft('')
      invalidate()
    },
  })

  if (steps.length === 0 && !adding) return null

  return (
    <div className={cn('mt-1.5 rounded-md bg-ink-50/70 px-1.5 py-1', dense && 'mt-1')}>
      <ul className="space-y-0.5">
        {steps.map((st) => (
          <li key={st.id}>
            <button
              type="button"
              // 阻止冒泡：卡片本身是拖拽激活区，点步骤不应该被当成拖拽起手
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                toggle.mutate(st)
              }}
              className="group/st flex w-full items-center gap-1.5 rounded px-0.5 py-0.5 text-left hover:bg-white"
            >
              <span
                className={cn(
                  'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border transition-colors',
                  st.done
                    ? 'border-emerald-500 bg-emerald-500 text-white'
                    : 'border-ink-300 bg-white text-transparent group-hover/st:border-emerald-400',
                )}
              >
                <Check size={9} strokeWidth={3.5} />
              </span>
              <span
                className={cn(
                  'min-w-0 flex-1 truncate text-[11px]',
                  st.done ? 'text-ink-400 line-through' : 'text-ink-600',
                )}
                title={st.title}
              >
                {st.title}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {adding ? (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            e.stopPropagation()
            const v = draft.trim()
            if (v) add.mutate(v)
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className="mt-1 flex items-center gap-1"
        >
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Enter / 空格必须拦在输入框这一层：
              // 卡片的键盘拖拽激活键正好是这两个，放上去整列会亮成「松手放到这里」
              e.stopPropagation()
              if (e.key === 'Escape') {
                setAdding(false)
                setDraft('')
              }
            }}
            onKeyUp={(e) => e.stopPropagation()}
            placeholder="加一步…"
            className="h-5 min-w-0 flex-1 rounded border border-ink-200 bg-white px-1.5 text-[11px] outline-none focus:border-brand-400"
          />
          <button type="submit" className="shrink-0 rounded p-0.5 text-brand-600 hover:bg-white">
            <Plus size={11} />
          </button>
        </form>
      ) : (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            setAdding(true)
          }}
          className="mt-0.5 flex items-center gap-1 px-0.5 text-[10px] text-ink-400 hover:text-brand-600"
        >
          <Plus size={9} /> 加一步
        </button>
      )}
    </div>
  )
}

/** 卡片上的「步骤 N/M」徽标，点一下展开/收起 */
export function StepsToggle({
  task,
  open,
  onToggle,
}: {
  task: Task
  open: boolean
  onToggle: () => void
}) {
  const total = task.subtaskTotal ?? 0
  if (total === 0) return null
  const done = task.subtaskDone ?? 0
  const all = done === total
  return (
    <button
      type="button"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
      aria-expanded={open}
      title={open ? '收起步骤' : '展开步骤'}
      className={cn(
        'inline-flex items-center gap-0.5 rounded border px-1 py-0.5 text-[10px] font-medium transition-colors',
        all
          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
          : 'border-ink-200 bg-white text-ink-500 hover:border-brand-300 hover:text-brand-600',
      )}
    >
      <ListChecks size={9} />
      <span className="tabular">
        {done}/{total}
      </span>
      <ChevronDown size={9} className={cn('transition-transform', open && 'rotate-180')} />
    </button>
  )
}
