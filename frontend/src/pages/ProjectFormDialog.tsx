import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Percent } from 'lucide-react'
import { api, errMsg, type Client, type Project } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Field, Input, Textarea } from '@/components/ui/Input'
import { Select, type Option } from '@/components/ui/Select'
import { DatePicker } from '@/components/ui/DatePicker'
import { Badge, Dialog } from '@/components/ui/Layout'
import {
  cn,
  money,
  toDateInput,
  PROJECT_KIND,
  PROJECT_STATUS,
  CLIENT_SOURCES,
  COMMISSION_TYPE,
} from '@/lib/utils'
import { useEscClose } from '@/lib/useEscClose'

const KIND_OPTS: Option[] = Object.entries(PROJECT_KIND).map(([v, d]) => ({
  value: v,
  label: d.label,
  dot: d.color,
}))
const STATUS_OPTS: Option[] = Object.entries(PROJECT_STATUS).map(([v, d]) => ({
  value: v,
  label: d.label,
  dot: d.color,
}))

const SUGGEST_TAGS = ['外包', '公司', '个人', '长期客户', '急件', '闲鱼', '小红书']

const COMMISSION_OPTS: Option[] = Object.entries(COMMISSION_TYPE).map(([v, d]) => ({
  value: v,
  label: d.label,
  dot: d.color,
}))

export function ProjectFormDialog({
  project,
  onClose,
}: {
  project: Project | null
  onClose: () => void
}) {
  const qc = useQueryClient()
  const isEdit = !!project

  const [form, setForm] = React.useState({
    name: project?.name ?? '',
    kind: project?.kind ?? 'outsource',
    status: project?.status ?? 'active',
    summary: project?.summary ?? '',
    sourcePath: project?.sourcePath ?? '',
    onlineUrl: project?.onlineUrl ?? '',
    adminUrl: project?.adminUrl ?? '',
    gitRepo: project?.gitRepo ?? '',
    deployAt: project?.deployAt ?? '',
    techStack: project?.techStack ?? '',
    clientId: project?.clientId ? String(project.clientId) : '',
    quote: project?.quote ? String(project.quote) : '',
    cost: project?.cost ? String(project.cost) : '',
    commissionType: project?.commissionType ?? 'none',
    commissionRate: project?.commissionRate ? String(project.commissionRate) : '',
    broker: project?.broker ?? '',
    startDate: toDateInput(project?.startDate),
    dueDate: toDateInput(project?.dueDate),
    estimateMinutes: project?.estimateMinutes ? String(project.estimateMinutes) : '',
    actualMinutes: project?.actualMinutes ? String(project.actualMinutes) : '',
    note: project?.note ?? '',
  })
  const [tags, setTags] = React.useState<string[]>(project?.tags ?? [])
  const [tagInput, setTagInput] = React.useState('')
  const [err, setErr] = React.useState('')

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<any>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  const { data: clients } = useQuery({
    queryKey: ['clients'],
    queryFn: async () => (await api.get<{ items: Client[] }>('/clients')).data.items,
  })

  const clientOpts: Option[] = [
    { value: '', label: '不关联客户' },
    ...(clients ?? []).map((c) => ({ value: String(c.id), label: c.name, hint: c.source || undefined })),
  ]

  const addTag = (raw: string) => {
    const t = raw.trim()
    if (!t) return
    setTags((prev) => (prev.includes(t) ? prev : [...prev, t]))
    setTagInput('')
  }

  // 抽成实时预览：与后端 commissionOf 保持同一套规则（抽成封顶在合同额）。
  // 没有抽成时不显示，避免出现「抽成 -¥0.00」这种无意义提示。
  const commitPreview = React.useMemo(() => {
    const quote = Number(form.quote) || 0
    const rate = Number(form.commissionRate) || 0
    if (quote <= 0 || form.commissionType === 'none' || rate <= 0) return null
    let commission = form.commissionType === 'pct' ? (quote * rate) / 100 : rate
    commission = Math.max(0, Math.min(commission, quote))
    return { quote, commission, net: quote - commission }
  }, [form.quote, form.commissionRate, form.commissionType])

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        ...form,
        clientId: form.clientId ? Number(form.clientId) : null,
        quote: Number(form.quote) || 0,
        cost: Number(form.cost) || 0,
        commissionRate: Number(form.commissionRate) || 0,
        estimateMinutes: Number(form.estimateMinutes) || 0,
        actualMinutes: Number(form.actualMinutes) || 0,
        tags,
      }
      if (isEdit) return (await api.put(`/projects/${project!.id}`, payload)).data
      return (await api.post('/projects', payload)).data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['dashboard-badges'] })
      onClose()
    },
    onError: (e) => setErr(errMsg(e)),
  })

  return (
    <Dialog
      open
      onClose={onClose}
      title={isEdit ? '编辑项目' : '新建项目'}
      description="项目资料 + 资产索引 + 收入，一处维护"
      width="max-w-2xl"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            loading={save.isPending}
            onClick={() => {
              if (!form.name.trim()) {
                setErr('项目名称必填')
                return
              }
              setErr('')
              save.mutate()
            }}
          >
            {isEdit ? '保存修改' : '创建项目'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* 基本信息 */}
        <section className="grid grid-cols-2 gap-x-3 gap-y-3">
          <Field label="项目名称" required className="col-span-2 sm:col-span-1">
            <Input value={form.name} onChange={set('name')} placeholder="如：企业官网改版" />
          </Field>
          <Field label="项目类型" className="col-span-2 sm:col-span-1">
            <Select value={form.kind} onChange={(v) => setForm((f) => ({ ...f, kind: v as any }))} options={KIND_OPTS} />
          </Field>
          <Field label="状态">
            <Select
              value={form.status}
              onChange={(v) => setForm((f) => ({ ...f, status: v }))}
              options={STATUS_OPTS}
            />
          </Field>
          <Field label="关联客户" hint="没有客户？点右侧 + 直接新建">
            <div className="flex gap-1.5">
              <div className="min-w-0 flex-1">
                <Select
                  value={form.clientId}
                  onChange={(v) => setForm((f) => ({ ...f, clientId: v }))}
                  options={clientOpts}
                  placeholder="选择客户"
                />
              </div>
              <InlineClientCreate
                onCreated={(c) => {
                  qc.invalidateQueries({ queryKey: ['clients'] })
                  setForm((f) => ({ ...f, clientId: String(c.id) }))
                }}
              />
            </div>
          </Field>
          <Field label="简介" className="col-span-2">
            <Textarea value={form.summary} onChange={set('summary')} rows={2} placeholder="一句话说明这个项目做什么" />
          </Field>
        </section>

        {/* 资产索引 */}
        <section className="rounded-xl border border-[var(--border)] bg-ink-50/50 p-3">
          <p className="mb-2.5 text-[11px] font-semibold text-ink-500">资产索引</p>
          <div className="grid grid-cols-2 gap-x-3 gap-y-3">
            <Field label="源码目录">
              <Input value={form.sourcePath} onChange={set('sourcePath')} placeholder="E:\abyss\workspace\xxx" />
            </Field>
            <Field label="技术栈">
              <Input value={form.techStack} onChange={set('techStack')} placeholder="Vue3 + Go" />
            </Field>
            <Field label="线上网址">
              <Input value={form.onlineUrl} onChange={set('onlineUrl')} placeholder="https://..." />
            </Field>
            <Field label="管理后台">
              <Input value={form.adminUrl} onChange={set('adminUrl')} placeholder="https://.../admin" />
            </Field>
            <Field label="Git 仓库">
              <Input value={form.gitRepo} onChange={set('gitRepo')} placeholder="https://github.com/..." />
            </Field>
            <Field label="部署位置">
              <Input value={form.deployAt} onChange={set('deployAt')} placeholder="阿里云 / 客户服务器 / Vercel" />
            </Field>
          </div>
        </section>

        {/* 收入与工期 */}
        <section className="grid grid-cols-2 gap-x-3 gap-y-3 sm:grid-cols-4">
          <Field label="合同金额" hint="客户付的全款">
            <Input value={form.quote} onChange={set('quote')} inputMode="decimal" placeholder="0" />
          </Field>
          <Field label="成本">
            <Input value={form.cost} onChange={set('cost')} inputMode="decimal" placeholder="0" />
          </Field>
          <Field label="开始日期">
            <DatePicker value={form.startDate} onChange={(v) => setForm((f) => ({ ...f, startDate: v }))} />
          </Field>
          <Field label="截止日期">
            <DatePicker value={form.dueDate} onChange={(v) => setForm((f) => ({ ...f, dueDate: v }))} />
          </Field>
          <Field label="预计工时" hint="分钟，60 = 1 小时">
            <Input value={form.estimateMinutes} onChange={set('estimateMinutes')} inputMode="numeric" />
          </Field>
          <Field label="实际工时">
            <Input value={form.actualMinutes} onChange={set('actualMinutes')} inputMode="numeric" />
          </Field>
        </section>

        {/* 中介抽成 */}
        <section className="rounded-xl border border-amber-200 bg-amber-50/60 p-3">
          <p className="mb-2.5 flex items-center gap-1.5 text-[11px] font-semibold text-amber-800">
            <Percent size={12} /> 中介抽成
            <span className="font-normal text-amber-600">有中介从中间接单、要抽走一部分时填这里</span>
          </p>
          <div className="grid grid-cols-2 gap-x-3 gap-y-3 sm:grid-cols-4">
            <Field label="抽成方式">
              <Select
                value={form.commissionType}
                onChange={(v) => setForm((f) => ({ ...f, commissionType: v as any }))}
                options={COMMISSION_OPTS}
              />
            </Field>
            <Field
              label={form.commissionType === 'fixed' ? '抽成金额' : '抽成比例'}
              hint={form.commissionType === 'fixed' ? '元' : form.commissionType === 'pct' ? '%，如 20' : undefined}
            >
              <Input
                value={form.commissionRate}
                onChange={set('commissionRate')}
                inputMode="decimal"
                placeholder={form.commissionType === 'none' ? '—' : '0'}
                disabled={form.commissionType === 'none'}
                className={form.commissionType === 'none' ? 'bg-ink-50 text-ink-400' : ''}
              />
            </Field>
            <Field label="中介 / 渠道" className="col-span-2">
              <Input value={form.broker} onChange={set('broker')} placeholder="如：XX接单群、老李介绍" />
            </Field>
          </div>

          {/* 实时预览：填完立刻看到到手多少 */}
          {commitPreview && (
            <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-white/80 px-2.5 py-2 text-[11px]">
              <span className="text-ink-500">
                合同 <b className="tabular text-ink-900">{money(commitPreview.quote)}</b>
              </span>
              <span className="text-ink-500">
                抽成 <b className="tabular text-amber-600">-{money(commitPreview.commission)}</b>
              </span>
              <span className="text-ink-500">
                你到手 <b className="tabular text-emerald-600">{money(commitPreview.net)}</b>
              </span>
              <span className="text-ink-400">
                收款按 {money(commitPreview.net)} 记（填实际到账）
              </span>
            </div>
          )}
        </section>

        {/* 标签 */}
        <Field label="标签">
          <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-[var(--border)] bg-white p-1.5">
            {tags.map((t) => (
              <Badge key={t} className="border-brand-200 bg-brand-50 text-brand-700">
                {t}
                <button
                  type="button"
                  onClick={() => setTags((prev) => prev.filter((x) => x !== t))}
                  className="ml-0.5 text-brand-400 hover:text-brand-700"
                >
                  ×
                </button>
              </Badge>
            ))}
            <input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault()
                  addTag(tagInput)
                } else if (e.key === 'Backspace' && !tagInput && tags.length) {
                  setTags((prev) => prev.slice(0, -1))
                }
              }}
              onBlur={() => addTag(tagInput)}
              placeholder={tags.length ? '' : '输入后回车添加'}
              className="h-6 min-w-24 flex-1 bg-transparent px-1 text-xs outline-none placeholder:text-ink-400"
            />
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {SUGGEST_TAGS.filter((s) => !tags.includes(s)).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => addTag(s)}
                className="rounded border border-dashed border-ink-200 px-1.5 py-0.5 text-[10px] text-ink-400 hover:border-brand-300 hover:text-brand-600"
              >
                + {s}
              </button>
            ))}
          </div>
        </Field>

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

/** 弹窗内快速新建客户，创建后自动选中 */
function InlineClientCreate({ onCreated }: { onCreated: (c: Client) => void }) {
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState('')
  const [phone, setPhone] = React.useState('')
  const [source, setSource] = React.useState('闲鱼')
  const [err, setErr] = React.useState('')

  useEscClose(open, () => setOpen(false))

  const create = useMutation({
    mutationFn: async () =>
      (
        await api.post<Client>('/clients', {
          name: name.trim(),
          phone: phone.trim(),
          source,
        })
      ).data,
    onSuccess: (c) => {
      onCreated(c)
      setOpen(false)
      setName('')
      setPhone('')
      setErr('')
    },
    onError: (e) => setErr(errMsg(e)),
  })

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="快速新建客户"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-dashed border-brand-300 bg-brand-50 text-brand-600 transition-colors hover:bg-brand-100"
      >
        <Plus size={15} />
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-ink-950/40" onClick={() => setOpen(false)} />
          <div className="relative z-10 w-full max-w-xs rounded-xl bg-white p-3.5 shadow-2xl animate-in">
            <p className="mb-2.5 text-[13px] font-semibold text-ink-900">快速新建客户</p>
            <div className="space-y-2.5">
              <Field label="客户名称" required>
                <Input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="如：王总（XX科技）"
                  onKeyDown={(e) => e.key === 'Enter' && name.trim() && create.mutate()}
                />
              </Field>
              <Field label="电话">
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" />
              </Field>
              <Field label="来源">
                <Select
                  value={source}
                  onChange={setSource}
                  options={CLIENT_SOURCES.map((s) => ({ value: s, label: s }))}
                  size="md"
                />
              </Field>
              {err && <p className="text-[11px] text-red-600">{err}</p>}
            </div>
            <div className="mt-3 flex justify-end gap-2.5">
              <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
                取消
              </Button>
              <Button size="sm" loading={create.isPending} onClick={() => create.mutate()} disabled={!name.trim()}>
                创建并选中
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
