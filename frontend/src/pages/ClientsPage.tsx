import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Users, Trash2, Pencil, Phone, MessageCircle } from 'lucide-react'
import { api, errMsg, type Client } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Field, Input, Textarea } from '@/components/ui/Input'
import { Select, type Option } from '@/components/ui/Select'
import { Badge, Card, Dialog, EmptyState, PageHeader, Skeleton } from '@/components/ui/Layout'

import { CLIENT_SOURCES } from '@/lib/utils'

const SOURCE_OPTS: Option[] = CLIENT_SOURCES.map((s) => ({ value: s, label: s }))

export default function ClientsPage() {
  const [editing, setEditing] = useState<Client | null | undefined>(undefined)
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['clients'],
    queryFn: async () => (await api.get<{ items: Client[] }>('/clients')).data.items,
  })

  const del = useMutation({
    mutationFn: async (id: number) => api.delete(`/clients/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clients'] }),
  })

  const items = data ?? []

  return (
    <div>
      <PageHeader
        title="客户"
        desc={`${items.length} 位客户 / 委托方`}
        actions={
          <Button size="sm" onClick={() => setEditing(null)}>
            <Plus size={14} /> 新建客户
          </Button>
        }
      />

      {isLoading ? (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Users size={20} />}
            title="还没有客户"
            desc="客户信息集中管理，接私活时不用再翻聊天记录找联系方式"
            action={
              <Button size="sm" onClick={() => setEditing(null)}>
                <Plus size={14} /> 添加客户
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((c) => (
            <Card key={c.id} className="group flex flex-col gap-1.5">
              <div className="flex items-start gap-2">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700">
                  {c.name.slice(0, 1)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold text-ink-900">{c.name}</p>
                  {c.contact && <p className="truncate text-[11px] text-ink-400">{c.contact}</p>}
                </div>
                <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <Button variant="ghost" size="icon" onClick={() => setEditing(c)}>
                    <Pencil size={12} />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => confirm('删除该客户？') && del.mutate(c.id)}>
                    <Trash2 size={12} className="text-red-400" />
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-500">
                {c.phone && (
                  <a href={`tel:${c.phone}`} className="flex items-center gap-0.5 hover:text-sky-600">
                    <Phone size={10} /> {c.phone}
                  </a>
                )}
                {c.wechat && (
                  <span className="flex items-center gap-0.5">
                    <MessageCircle size={10} /> {c.wechat}
                  </span>
                )}
                {c.source && (
                  <Badge className="ml-auto border-ink-200 bg-white text-ink-500">{c.source}</Badge>
                )}
              </div>
              {c.note && <p className="line-clamp-2 text-[11px] text-ink-400">{c.note}</p>}
            </Card>
          ))}
        </div>
      )}

      {editing !== undefined && <ClientFormDialog client={editing} onClose={() => setEditing(undefined)} />}
    </div>
  )
}

function ClientFormDialog({ client, onClose }: { client: Client | null; onClose: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    name: client?.name ?? '',
    contact: client?.contact ?? '',
    phone: client?.phone ?? '',
    wechat: client?.wechat ?? '',
    source: client?.source ?? '闲鱼',
    note: client?.note ?? '',
  })
  const [err, setErr] = useState('')

  const save = useMutation({
    mutationFn: async () => {
      if (client) return (await api.put(`/clients/${client.id}`, form)).data
      return (await api.post('/clients', form)).data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clients'] })
      onClose()
    },
    onError: (e) => setErr(errMsg(e)),
  })

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<any>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  return (
    <Dialog
      open
      onClose={onClose}
      title={client ? '编辑客户' : '新建客户'}
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose}>
            取消
          </Button>
          <Button
            size="sm"
            loading={save.isPending}
            onClick={() => {
              if (!form.name.trim()) return setErr('客户名称必填')
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
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="客户名称" required>
            <Input value={form.name} onChange={set('name')} autoFocus />
          </Field>
          <Field label="联系人">
            <Input value={form.contact} onChange={set('contact')} />
          </Field>
          <Field label="电话">
            <Input value={form.phone} onChange={set('phone')} inputMode="tel" />
          </Field>
          <Field label="微信">
            <Input value={form.wechat} onChange={set('wechat')} />
          </Field>
          <Field label="来源渠道" className="col-span-2">
            <Select value={form.source} onChange={(v) => setForm((f) => ({ ...f, source: v }))} options={SOURCE_OPTS} />
          </Field>
        </div>
        <Field label="备注">
          <Textarea value={form.note} onChange={set('note')} rows={2} placeholder="沟通偏好、付款习惯等" />
        </Field>
        {err && (
          <div className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-600">{err}</div>
        )}
      </div>
    </Dialog>
  )
}
