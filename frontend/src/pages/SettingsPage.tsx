import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { KeyRound, User, Server, ShieldCheck, Info } from 'lucide-react'
import { api, errMsg, setToken } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Input'
import { Card, PageHeader } from '@/components/ui/Layout'

export default function SettingsPage() {
  const [oldPassword, setOld] = useState('')
  const [newPassword, setNew] = useState('')
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const navigate = useNavigate()

  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: async () => (await api.get('/auth/me')).data,
  })

  const change = useMutation({
    mutationFn: async () => (await api.post('/auth/password', { oldPassword, newPassword })).data,
    onSuccess: () => {
      // 后端已吊销当前 token，本地登录态同步清掉，回登录页重新登录。
      setToken(null)
      navigate('/login?reason=password', { replace: true })
    },
    onError: (e) => setMsg({ type: 'err', text: errMsg(e) }),
  })

  return (
    <div>
      <PageHeader title="设置" desc="账号与系统信息" />

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <h3 className="mb-3 flex items-center gap-1.5 text-[13px] font-semibold text-ink-900">
            <User size={14} className="text-brand-500" /> 账号
          </h3>
          <div className="mb-3 flex items-center gap-2.5 rounded-lg bg-ink-50 px-3 py-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-500 text-sm font-bold text-white">
              {(me?.nickname || me?.username || '?').slice(0, 1)}
            </div>
            <div>
              <p className="text-xs font-semibold text-ink-900">{me?.nickname || me?.username || '—'}</p>
              <p className="text-[10px] text-ink-400">@{me?.username || '—'}</p>
            </div>
          </div>

          <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-ink-700">
            <KeyRound size={13} /> 修改密码
          </h4>
          <div className="space-y-2.5">
            <Field label="原密码">
              <Input type="password" value={oldPassword} onChange={(e) => setOld(e.target.value)} />
            </Field>
            <Field label="新密码" hint="至少 6 位">
              <Input type="password" value={newPassword} onChange={(e) => setNew(e.target.value)} />
            </Field>
            {msg && (
              <div
                className={
                  msg.type === 'ok'
                    ? 'rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-700'
                    : 'rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-600'
                }
              >
                {msg.text}
              </div>
            )}
            <Button
              size="sm"
              loading={change.isPending}
              onClick={() => {
                if (!oldPassword || newPassword.length < 6) {
                  setMsg({ type: 'err', text: '请填写原密码，新密码至少 6 位' })
                  return
                }
                setMsg(null)
                change.mutate()
              }}
            >
              更新密码
            </Button>
          </div>
        </Card>

        <div className="space-y-3">
          <Card>
            <h3 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-ink-900">
              <Server size={14} className="text-sky-500" /> 部署信息
            </h3>
            <dl className="space-y-1.5 text-xs">
              <Row k="访问方式" v="Cloudflare Tunnel（源站不开放端口）" />
              <Row k="数据存储" v="SQLite，单文件，容器内 /app/data" />
              <Row k="备份建议" v="定期复制 workbench.db 到宿主机" />
              <Row k="登录保护" v="JWT + 密码哈希 + 失败限流；登出/改密即吊销旧 token" />
            </dl>
          </Card>

          <Card>
            <h3 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-ink-900">
              <ShieldCheck size={14} className="text-emerald-500" /> 安全提示
            </h3>
            <div className="flex gap-2 rounded-lg bg-amber-50 px-2.5 py-2 text-[11px] leading-relaxed text-amber-800">
              <Info size={13} className="mt-0.5 shrink-0" />
              <span>
                若仍在使用初始密码，请立即修改。该工作台保存客户联系方式与收款信息，请勿分享访问地址，
                如需更强保护可在 Cloudflare 侧开启 Access 应用层鉴权。
              </span>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-20 shrink-0 text-ink-400">{k}</dt>
      <dd className="text-ink-700">{v}</dd>
    </div>
  )
}
