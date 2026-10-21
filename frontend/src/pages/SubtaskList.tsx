import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Plus, Trash2, ListChecks, ChevronsDown } from 'lucide-react'
import { api, type Subtask } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { cn } from '@/lib/utils'

/**
 * 任务内部的步骤清单。
 *
 * 为什么是「步骤」而不是「子任务」父子结构：一个交付动作（比如上线）拆成
 * 上传代码 / 域名访问 / 完善信息 / 测试支付 四步，这四步并不需要各自的
 * 状态、负责人、截止日——它们只需要被勾掉。做成任务内清单最省事，
 * 看板上也不会碎成一堆卡片。
 */
export function SubtaskList({ taskId, compact }: { taskId: number; compact?: boolean }) {
  const qc = useQueryClient()
  const [draft, setDraft] = useState('')
  const [bulk, setBulk] = useState('')
  const [bulkOpen, setBulkOpen] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['subtasks', taskId],
    queryFn: async () => (await api.get<{ items: Subtask[] }>(`/tasks/${taskId}/subtasks`)).data.items,
  })
  const items = data ?? []

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['subtasks', taskId] })
    qc.invalidateQueries({ queryKey: ['tasks'] })
    qc.invalidateQueries({ queryKey: ['dashboard'] })
  }

  const add = useMutation({
    mutationFn: async (title: string) => api.post(`/tasks/${taskId}/subtasks`, { title }),
    onSuccess: () => {
      setDraft('')
      invalidate()
    },
  })

  const bulkAdd = useMutation({
    mutationFn: async (text: string) =>
      api.post(`/tasks/${taskId}/subtasks/bulk`, { text }),
    onSuccess: () => {
      setBulk('')
      setBulkOpen(false)
      invalidate()
    },
  })

  const toggle = useMutation({
    mutationFn: async (st: Subtask) => api.put(`/subtasks/${st.id}`, { done: !st.done }),
    onSuccess: invalidate,
  })

  const rename = useMutation({
    mutationFn: async ({ id, title }: { id: number; title: string }) =>
      api.put(`/subtasks/${id}`, { title }),
    onSuccess: invalidate,
  })

  const remove = useMutation({
    mutationFn: async (id: number) => api.delete(`/subtasks/${id}`),
    onSuccess: invalidate,
  })

  const doneCount = items.filter((s) => s.done).length
  const pct = items.length ? Math.round((doneCount / items.length) * 100) : 0

  return (
    <div>
      {/* 进度条：一眼看出这条任务推进到哪了 */}
      {items.length > 0 && (
        <div className="mb-2 flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-100">
            <div
              className={cn('h-full rounded-full transition-all', pct === 100 ? 'bg-emerald-500' : 'bg-brand-500')}
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="tabular shrink-0 text-[11px] font-medium text-ink-500">
            {doneCount}/{items.length}
          </span>
        </div>
      )}

      {isLoading ? (
        <p className="py-3 text-center text-[11px] text-ink-400">加载中…</p>
      ) : items.length === 0 ? (
        <p className="py-3 text-center text-[11px] text-ink-400">
          把这条任务拆成几步，比如「上传代码 / 域名访问 / 测支付」
        </p>
      ) : (
        <ul className="space-y-0.5">
          {items.map((st) => (
            <li key={st.id} className="group flex items-center gap-2 rounded-md px-1 py-1 hover:bg-ink-50">
              <button
                type="button"
                onClick={() => toggle.mutate(st)}
                aria-label={st.done ? '标为未完成' : '标为完成'}
                className={cn(
                  'flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors',
                  st.done
                    ? 'border-emerald-500 bg-emerald-500 text-white'
                    : 'border-ink-300 bg-white text-transparent hover:border-emerald-400',
                )}
              >
                <Check size={11} strokeWidth={3} />
              </button>
              <input
                defaultValue={st.title}
                onBlur={(e) => {
                  const v = e.target.value.trim()
                  if (v && v !== st.title) rename.mutate({ id: st.id, title: v })
                  else if (!v) e.target.value = st.title
                }}
                className={cn(
                  'min-w-0 flex-1 bg-transparent text-xs outline-none',
                  st.done ? 'text-ink-400 line-through' : 'text-ink-700',
                )}
              />
              <button
                type="button"
                onClick={() => remove.mutate(st.id)}
                aria-label="删除步骤"
                className="shrink-0 rounded p-0.5 text-ink-300 opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100"
              >
                <Trash2 size={11} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* 单条追加 */}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          const v = draft.trim()
          if (v) add.mutate(v)
        }}
        className="mt-1.5 flex items-center gap-1.5"
      >
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="加一步…"
          className="h-7 text-xs"
        />
        <Button type="submit" size="sm" variant="outline" disabled={!draft.trim() || add.isPending}>
          <Plus size={12} />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          title="一次粘贴多行，自动拆成多个步骤"
          onClick={() => setBulkOpen((v) => !v)}
        >
          <ListChecks size={13} />
        </Button>
      </form>

      {/* 多行批量：直接把「上传代码 / 域名访问 / …」整段粘进来 */}
      {bulkOpen && (
        <div className="mt-2 rounded-lg border border-ink-200 bg-ink-50/60 p-2">
          <p className="mb-1 text-[10px] text-ink-500">
            每行一步，支持 <code className="rounded bg-white px-1">1. 2.</code> 这种编号，会自动去掉
          </p>
          <textarea
            value={bulk}
            onChange={(e) => setBulk(e.target.value)}
            rows={4}
            placeholder={'上传代码\n域名访问\n完善信息\n测试支付功能'}
            className="w-full resize-y rounded-md border border-ink-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-brand-400"
          />
          <div className="mt-1.5 flex justify-end gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => setBulkOpen(false)}>
              取消
            </Button>
            <Button
              size="sm"
              disabled={!bulk.trim() || bulkAdd.isPending}
              onClick={() => bulkAdd.mutate(bulk)}
            >
              <ChevronsDown size={12} /> 拆成 {bulk.split('\n').filter((l) => l.trim()).length} 步
            </Button>
          </div>
        </div>
      )}

      {compact && items.length > 0 && (
        <p className="mt-1 text-[10px] text-ink-400">
          还有 {items.length - doneCount} 步没做完
        </p>
      )}
    </div>
  )
}
