import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, QrCode, RefreshCw, Trash2, ShieldCheck } from 'lucide-react'
import { api, errMsg, type FilingLogin, type FilingMonitor, type Project } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Badge, Card, Dialog, EmptyState, PageHeader, Skeleton } from '@/components/ui/Layout'
import { Field, Input, Textarea } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'

const SESSION_TEXT = { disconnected: '未登录', connected: '已登录', expired: '登录已失效' }

export default function WechatFilingPage() {
  const qc = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [projectId, setProjectId] = useState('')
  const [provider, setProvider] = useState<FilingMonitor['provider']>('wechat')
  const [baOrderId, setBaOrderId] = useState('')
  const [sessionMonitor, setSessionMonitor] = useState<FilingMonitor | null>(null)
  const [cookie, setCookie] = useState('')
  const [sessionError, setSessionError] = useState('')
  const [error, setError] = useState('')
  const [loginMonitor, setLoginMonitor] = useState<FilingMonitor | null>(null)
  const [login, setLogin] = useState<FilingLogin | null>(null)
  const [loginError, setLoginError] = useState('')

  const monitors = useQuery({
    queryKey: ['wechat-filing'],
    queryFn: async () => (await api.get<{ items: FilingMonitor[] }>('/wechat-filing')).data.items,
    refetchInterval: 30_000,
  })
  const projects = useQuery({
    queryKey: ['projects', 'filing-options'],
    queryFn: async () => (await api.get<{ items: Project[] }>('/projects', { params: { size: 200 } })).data.items,
  })
  const refresh = () => qc.invalidateQueries({ queryKey: ['wechat-filing'] })
  const create = useMutation({
    mutationFn: async () => api.post('/wechat-filing', { name, provider, baOrderId: provider === 'aliyun' ? baOrderId : '', projectId: projectId === '' ? null : Number(projectId) }),
    onSuccess: () => { setCreating(false); setName(''); setProjectId(''); setBaOrderId(''); setError(''); refresh() },
    onError: (e) => setError(errMsg(e)),
  })
  const check = useMutation({
    mutationFn: async (id: number) => api.post(`/wechat-filing/${id}/check`, {}, { timeout: 45_000 }),
    onSuccess: () => { setError(''); refresh() },
    onError: (e) => setError(errMsg(e)),
  })
  const toggle = useMutation({
    mutationFn: async (m: FilingMonitor) => api.put(`/wechat-filing/${m.id}`, { enabled: !m.enabled }),
    onSuccess: () => { setError(''); refresh() },
    onError: (e) => setError(errMsg(e)),
  })
  const remove = useMutation({
    mutationFn: async (id: number) => api.delete(`/wechat-filing/${id}`),
    onSuccess: () => { setError(''); refresh() },
    onError: (e) => setError(errMsg(e)),
  })
  const startLogin = useMutation({
    mutationFn: async (m: FilingMonitor) => (await api.post<FilingLogin>(`/wechat-filing/${m.id}/login`, {}, { timeout: 50_000 })).data,
    onMutate: (m) => { setLoginMonitor(m); setLogin(null); setLoginError('') },
    onSuccess: (data) => setLogin(data),
    onError: (e) => setLoginError(errMsg(e)),
  })
  const importSession = useMutation({
    mutationFn: async (id: number) => {
      try {
        await api.post(`/wechat-filing/${id}/session`, { cookie }, { timeout: 30_000 })
      } catch (e) {
        throw new Error(errMsg(e))
      }
    },
    onSuccess: () => { setCookie(''); setSessionMonitor(null); setSessionError(''); refresh() },
    onError: (e) => setSessionError(errMsg(e)),
  })

  useEffect(() => {
    if (!loginMonitor || !login || loginError || login.state === 'connected' || login.state === 'expired') return
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      if (Date.now() >= Date.parse(login.expiresAt)) {
        if (!stopped) setLogin((previous) => previous === null ? null : { ...previous, state: 'expired' })
        return
      }
      try {
        const { data } = await api.get<{ state: FilingLogin['state'] }>(`/wechat-filing/${loginMonitor.id}/login`, { timeout: 50_000 })
        if (stopped) return
        if (data.state === 'connected' || data.state === 'expired' || data.state !== login.state) {
          setLogin((previous) => previous === null ? null : { ...previous, state: data.state })
          if (data.state === 'connected') qc.invalidateQueries({ queryKey: ['wechat-filing'] })
          return
        }
        timer = setTimeout(poll, 2500)
      } catch (e) {
        if (!stopped) setLoginError(errMsg(e))
      }
    }
    timer = setTimeout(poll, 2500)
    return () => { stopped = true; clearTimeout(timer) }
  }, [loginMonitor, login, loginError, qc])

  return (
    <div>
      <PageHeader title="备案监控" desc="每小时检查微信小程序和阿里云域名备案审核状态" actions={
        <Button size="sm" onClick={() => { setError(''); setCreating(true) }}><Plus size={14} /> 新建监控</Button>
      } />
      <p className="mb-4 text-xs text-ink-500">状态变化或登录失效时发送邮件，请先在<Link to="/settings" className="text-brand-600">设置</Link>中启用邮件通知。</p>
      {error && <p role="alert" className="mb-3 text-sm text-red-600">{error}</p>}
      {monitors.error && <p role="alert" className="mb-3 text-sm text-red-600">{errMsg(monitors.error)}</p>}
      {monitors.isLoading ? <Skeleton className="h-32" /> : monitors.data?.length === 0 ? (
        <Card><EmptyState icon={<ShieldCheck size={20} />} title="暂无备案监控" desc="添加微信小程序或阿里云备案订单，登录后自动检查审核进度" /></Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {monitors.data?.map((m) => (
            <Card key={m.id}>
              <div className="mb-3 flex items-center justify-between gap-2">
                <div><h2 className="text-sm font-semibold text-ink-900">{m.name}</h2><p className="mt-1 text-xs text-ink-500">{m.provider === 'aliyun' ? '阿里云域名备案' : '微信小程序备案'}</p></div>
                <Badge>{m.enabled ? '监控已启用' : '已暂停'}</Badge>
              </div>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-base font-semibold text-ink-800">{m.status === null ? '尚未查询' : <>{m.provider === 'aliyun' && <>{m.title} · </>}{m.statusText}</>}</span>
                <Badge>{SESSION_TEXT[m.sessionState]}</Badge>
              </div>
              {m.projectId !== null && <Link to={`/projects/${m.projectId}`} className="text-xs text-brand-600">查看关联项目</Link>}
              {m.accountId !== '' && <p className="mt-2 text-xs text-ink-500">账号：{m.accountId}</p>}
              {m.provider === 'aliyun' && <>
                <p className="mt-2 text-xs text-ink-500">订单号：{m.baOrderId} · <a className="text-brand-600" href={`https://beian.aliyun.com/pcContainer/orderdetail?baOrderId=${encodeURIComponent(m.baOrderId)}`} target="_blank" rel="noreferrer">查看阿里云订单</a></p>
                {m.progressInfo !== '' && <p className="mt-2 text-xs text-ink-500">{m.progressInfo}</p>}
              </>}
              <p className="mt-2 text-xs text-ink-500">最近检查：{m.lastCheckedAt === null ? '尚未检查' : new Date(m.lastCheckedAt).toLocaleString('zh-CN')}</p>
              {m.lastSuccessAt !== null && <p className="mt-1 text-xs text-ink-500">最近成功：{new Date(m.lastSuccessAt).toLocaleString('zh-CN')}</p>}
              {m.lastError !== '' && <p role="alert" className="mt-2 text-xs text-red-600">{m.lastError}</p>}
              {m.notificationError !== '' && <p role="alert" className="mt-2 text-xs text-red-600">{m.notificationError}</p>}
              <div className="mt-4 flex flex-wrap gap-2">
                {m.provider === 'wechat' ? <Button size="sm" variant="outline" disabled={startLogin.isPending} onClick={() => startLogin.mutate(m)}><QrCode size={14} />{m.sessionState === 'connected' ? '重新扫码' : '扫码登录'}</Button> : <Button size="sm" variant="outline" onClick={() => { setSessionMonitor(m); setCookie(''); setSessionError('') }}>{m.sessionState === 'connected' ? '更新会话' : '导入登录会话'}</Button>}
                <Button size="sm" variant="outline" loading={check.isPending && check.variables === m.id} disabled={m.sessionState !== 'connected' || check.isPending} onClick={() => check.mutate(m.id)}><RefreshCw size={14} />立即检查</Button>
                <Button size="sm" variant="ghost" disabled={toggle.isPending} onClick={() => toggle.mutate(m)}>{m.enabled ? '暂停' : '启用'}</Button>
                <Button size="icon" variant="ghost" aria-label={`移除${m.name}`} disabled={remove.isPending} onClick={() => { if (window.confirm(`移除“${m.name}”的备案监控及登录凭据？`)) remove.mutate(m.id) }}><Trash2 size={14} /></Button>
              </div>
            </Card>
          ))}
        </div>
      )}
      <Dialog open={creating} onClose={() => setCreating(false)} title="新建备案监控" footer={<Button loading={create.isPending} onClick={() => create.mutate()}>创建</Button>}>
        <div className="space-y-3">
          <Field label="备案平台" required><Select value={provider} onChange={(value) => setProvider(value as FilingMonitor['provider'])} options={[
            { value: 'wechat', label: '微信小程序备案' },
            { value: 'aliyun', label: '阿里云域名备案' },
          ]} /></Field>
          <Field label="监控名称" required><Input value={name} maxLength={128} onChange={(e) => setName(e.target.value)} /></Field>
          {provider === 'aliyun' && <Field label="阿里云备案订单号" required hint="订单详情页地址中 baOrderId 后面的数字"><Input value={baOrderId} maxLength={32} inputMode="numeric" onChange={(e) => setBaOrderId(e.target.value)} /></Field>}
          <Field label="关联项目"><Select value={projectId} onChange={setProjectId} options={[
            { value: '', label: '不关联项目' },
            ...(projects.data === undefined ? [] : projects.data.map((p) => ({ value: String(p.id), label: p.name }))),
          ]} /></Field>
          {projects.error && <p role="alert" className="text-sm text-red-600">{errMsg(projects.error)}</p>}
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        </div>
      </Dialog>
      <Dialog open={sessionMonitor !== null} onClose={() => { if (!importSession.isPending) { setSessionMonitor(null); setCookie(''); setSessionError('') } }} title="导入阿里云登录会话" description={sessionMonitor === null ? '' : sessionMonitor.name} footer={<Button loading={importSession.isPending} disabled={cookie.trim() === ''} onClick={() => { if (sessionMonitor !== null) importSession.mutate(sessionMonitor.id) }}>验证并保存</Button>}>
        <div className="space-y-3">
          <ol className="list-decimal space-y-2 pl-4 text-xs text-ink-600">
            <li>在浏览器中使用 RAM 账号登录阿里云，并打开此备案订单详情。</li>
            <li>按 F12 打开开发者工具，选择“网络（Network）”，刷新订单页并搜索 progress.json。</li>
            <li>打开该请求，在“请求标头（Request Headers）”中复制 Cookie 的完整值，粘贴到下方。</li>
          </ol>
          <Field label="登录会话 Cookie" required hint="会话验证成功后加密保存。登录失效时重新登录并更新，无需填写 AccessKey。"><Textarea value={cookie} onChange={(e) => setCookie(e.target.value)} maxLength={32768} autoComplete="off" spellCheck={false} disabled={importSession.isPending} /></Field>
          <p className="text-xs text-ink-500">请勿使用控制台中的 document.cookie，它无法读取查询所需的完整会话。</p>
          {sessionError !== '' && <p role="alert" className="text-sm text-red-600">{sessionError}</p>}
        </div>
      </Dialog>
      <Dialog open={loginMonitor !== null} onClose={() => { setLoginMonitor(null); setLogin(null); setLoginError('') }} title="微信扫码登录" description={loginMonitor === null ? '' : loginMonitor.name}>
        <div className="flex flex-col items-center gap-3 py-3">
          {startLogin.isPending && <p className="text-sm text-ink-500">正在获取微信登录二维码…</p>}
          {login !== null && login.state !== 'connected' && login.state !== 'expired' && <>
            <img src={login.qrCode} alt="微信公众平台登录二维码" className="h-56 w-56 object-contain" />
            <p className="text-center text-sm text-ink-600">{login.state === 'scanned' ? '已扫码，请在微信中选择小程序并确认登录' : '请用微信扫码，选择需要监控的小程序并确认登录'}</p>
          </>}
          {login?.state === 'connected' && <p role="status" className="text-sm text-emerald-600">登录成功，已开始监控备案状态</p>}
          {login?.state === 'expired' && <p role="status" className="text-sm text-amber-600">二维码已过期，请重新生成</p>}
          {loginError !== '' && <p role="alert" className="text-sm text-red-600">{loginError}</p>}
          {!startLogin.isPending && login?.state !== 'connected' && loginMonitor !== null && <Button variant="outline" size="sm" onClick={() => startLogin.mutate(loginMonitor)}>重新生成二维码</Button>}
        </div>
      </Dialog>
    </div>
  )
}
