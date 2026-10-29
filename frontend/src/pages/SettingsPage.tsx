import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  KeyRound,
  User,
  Server,
  ShieldCheck,
  Info,
  DatabaseBackup,
  Download,
  Upload,
  Plug,
  Copy,
  Check,
  RefreshCw,
  Eye,
  EyeOff,
  Trash2,
  Wallet,
  Cloud,
} from 'lucide-react'
import { api, errMsg } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Card, Dialog, PageHeader } from '@/components/ui/Layout'

type Msg = { type: 'ok' | 'err'; text: string }

type McpSetting = { token: string; source: 'db' | 'env' | 'off' }
type R2Setting = {
  configured: boolean
  accountId: string
  bucket: string
  accessKeyIdMasked: string
  jurisdiction: string
}

// 生成 48 位十六进制令牌（192 位熵）
function genToken() {
  const b = new Uint8Array(24)
  crypto.getRandomValues(b)
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
}

function maskToken(t: string) {
  return t.length <= 12 ? '••••••' : `${t.slice(0, 8)}••••••••${t.slice(-6)}`
}

function fmtSize(n: number) {
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB'
  if (n >= 1024) return (n / 1024).toFixed(0) + ' KB'
  return n + ' B'
}

export default function SettingsPage() {
  const [oldPassword, setOld] = useState('')
  const [newPassword, setNew] = useState('')
  const [msg, setMsg] = useState<Msg | null>(null)

  // 备份与迁移
  const qc = useQueryClient()
  const [backupMsg, setBackupMsg] = useState<Msg | null>(null)
  const [exporting, setExporting] = useState(false)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [progress, setProgress] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // MCP 连接
  const [showToken, setShowToken] = useState(false)
  const [copied, setCopied] = useState<'token' | 'text' | null>(null)
  const { data: mcp } = useQuery({
    queryKey: ['mcp-setting'],
    queryFn: async () => (await api.get<McpSetting>('/settings/mcp')).data,
  })
  const saveToken = useMutation({
    mutationFn: async (token: string) => (await api.put('/settings/mcp', { token })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mcp-setting'] })
      setCopied(null)
    },
  })

  // 图片存储
  const [r2Form, setR2Form] = useState({
    accountId: '',
    bucket: '',
    accessKeyId: '',
    secretAccessKey: '',
    jurisdiction: '',
  })
  const [r2Msg, setR2Msg] = useState<Msg | null>(null)
  const [showR2Secret, setShowR2Secret] = useState(false)
  const { data: r2 } = useQuery({
    queryKey: ['r2-setting'],
    queryFn: async () => (await api.get<R2Setting>('/settings/r2')).data,
  })
  useEffect(() => {
    if (!r2) return
    setR2Form({
      accountId: r2.accountId,
      bucket: r2.bucket,
      accessKeyId: '',
      secretAccessKey: '',
      jurisdiction: r2.jurisdiction,
    })
  }, [r2])

  const r2Payload = () => ({ ...r2Form })

  const testR2 = useMutation({
    mutationFn: async () => (await api.post('/settings/r2/test', r2Payload())).data,
    onSuccess: () => setR2Msg({ type: 'ok', text: '连接成功' }),
    onError: (e) => setR2Msg({ type: 'err', text: errMsg(e, '连接失败') }),
  })

  const saveR2 = useMutation({
    mutationFn: async () => (await api.put('/settings/r2', r2Payload())).data,
    onSuccess: () => {
      setR2Msg({ type: 'ok', text: '已保存，新上传图片会写入 R2' })
      setR2Form((f) => ({ ...f, accessKeyId: '', secretAccessKey: '' }))
      qc.invalidateQueries({ queryKey: ['r2-setting'] })
    },
    onError: (e) => setR2Msg({ type: 'err', text: errMsg(e, '保存失败') }),
  })

  const clearR2 = useMutation({
    mutationFn: async () => (await api.delete('/settings/r2')).data,
    onSuccess: () => {
      setR2Msg({ type: 'ok', text: '已切换回本地存储' })
      qc.invalidateQueries({ queryKey: ['r2-setting'] })
    },
    onError: (e) => setR2Msg({ type: 'err', text: errMsg(e, '操作失败') }),
  })

  const mcpOn = !!mcp?.token
  const mcpUrl = `${window.location.origin}/mcp`
  const copy = async (kind: 'token' | 'text', text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(kind)
      setTimeout(() => setCopied(null), 2000)
    } catch {
      // 剪贴板不可用（非 https 等）时退化为选中文本提示
      setCopied(null)
    }
  }
  // 发给 AI 的完整配置文案：包含地址、令牌、JSON 与验证步骤，粘贴给 AI 即可代为配置
  const mcpAiText = mcp?.token
    ? `请把下面的 MCP 服务添加到你的 MCP 客户端配置里（Streamable HTTP 传输）：

服务地址：${mcpUrl}
鉴权请求头：Authorization: Bearer ${mcp.token}

可用工具：list_projects、get_project、create_project、update_project、list_tasks、create_task、update_task、get_task_attachments（读取任务上的截图，AI 可直接看图）。没有删除工具，删除请在网页里手动操作。

mcpServers JSON 配置（适用于 Cursor / ZCode 等客户端）：
{
  "mcpServers": {
    "personal-workbench": {
      "url": "${mcpUrl}",
      "headers": { "Authorization": "Bearer ${mcp.token}" }
    }
  }
}

配置完成后，请调用 list_projects 工具验证连接是否正常。`
    : ''

  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: async () => (await api.get('/auth/me')).data,
  })

  const change = useMutation({
    mutationFn: async () => (await api.post('/auth/password', { oldPassword, newPassword })).data,
    onSuccess: () => {
      setMsg({ type: 'ok', text: '密码已更新' })
      setOld('')
      setNew('')
    },
    onError: (e) => setMsg({ type: 'err', text: errMsg(e) }),
  })

  // 收款账期：确认收货后 N 天还没到账就算逾期（只影响没填约定日的收款）
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await api.get<Record<string, string>>('/settings')).data,
  })
  const [creditDays, setCreditDays] = useState('')
  const [settingsMsg, setSettingsMsg] = useState<Msg | null>(null)
  useEffect(() => {
    if (settings?.paymentCreditDays) setCreditDays(settings.paymentCreditDays)
  }, [settings])

  const saveSettings = useMutation({
    mutationFn: async () => (await api.put('/settings', { paymentCreditDays: creditDays })).data,
    onSuccess: () => {
      setSettingsMsg({ type: 'ok', text: '账期已更新' })
      // 逾期是后端读取时现算的，改完要刷新各处列表
      qc.invalidateQueries({ queryKey: ['payments'] })
      qc.invalidateQueries({ queryKey: ['projects'] })
      qc.invalidateQueries({ queryKey: ['project'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
    onError: (e) => setSettingsMsg({ type: 'err', text: errMsg(e) }),
  })

  // 导出是流式下载，备份包可能不小，单独关掉默认 20s 超时
  async function doExport() {
    setExporting(true)
    setBackupMsg(null)
    try {
      const res = await api.get('/backup/export', { responseType: 'blob', timeout: 0 })
      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a')
      const now = new Date()
      const pad = (n: number) => String(n).padStart(2, '0')
      a.href = url
      a.download = `workbench-backup-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.zip`
      a.click()
      URL.revokeObjectURL(url)
      setBackupMsg({ type: 'ok', text: '备份包已生成并开始下载' })
    } catch (e) {
      setBackupMsg({ type: 'err', text: errMsg(e, '导出失败') })
    } finally {
      setExporting(false)
    }
  }

  const importBackup = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData()
      fd.append('file', file)
      return await api.post('/backup/import', fd, {
        timeout: 0,
        onUploadProgress: (e) => {
          if (e.total) setProgress(Math.round((e.loaded / e.total) * 100))
        },
      })
    },
    onSuccess: (res) => {
      const files = (res.data as { filesRestored?: number })?.filesRestored ?? 0
      setBackupMsg({
        type: 'ok',
        text: `导入完成${files > 0 ? `，恢复图片 ${files} 张` : ''}，页面即将刷新…`,
      })
      setPendingFile(null)
      qc.invalidateQueries()
      setTimeout(() => window.location.reload(), 1200)
    },
    onError: (e) => {
      setBackupMsg({ type: 'err', text: errMsg(e, '导入失败') })
      setPendingFile(null)
    },
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
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-ink-900">
                <Cloud size={14} className="text-sky-500" /> 图片存储
              </h3>
              <span
                className={
                  r2?.configured
                    ? 'rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700'
                    : 'rounded-md border border-ink-200 bg-ink-50 px-1.5 py-0.5 text-[10px] font-medium text-ink-400'
                }
              >
                {r2?.configured ? 'Cloudflare R2' : '本地磁盘'}
              </span>
            </div>
            <p className="mb-3 text-xs leading-relaxed text-ink-400">
              配置后新上传图片写入 R2，原有图片仍可读取。Bucket 保持私有，图片继续通过工作台接口访问。
            </p>
            <div className="space-y-2.5">
              <Field label="Account ID">
                <Input
                  value={r2Form.accountId}
                  onChange={(e) => setR2Form((f) => ({ ...f, accountId: e.target.value }))}
                  autoComplete="off"
                />
              </Field>
              <Field label="Bucket">
                <Input
                  value={r2Form.bucket}
                  onChange={(e) => setR2Form((f) => ({ ...f, bucket: e.target.value }))}
                  autoComplete="off"
                />
              </Field>
              <Field label="区域" hint="Bucket 创建时选择了 EU jurisdiction 才需要改">
                <Select
                  value={r2Form.jurisdiction}
                  onChange={(v) => setR2Form((f) => ({ ...f, jurisdiction: v }))}
                  options={[
                    { value: '', label: '默认区域' },
                    { value: 'eu', label: 'EU' },
                  ]}
                />
              </Field>
              <Field
                label="Access Key ID"
                hint={r2?.configured ? `当前：${r2.accessKeyIdMasked}；留空保持不变` : undefined}
              >
                <Input
                  value={r2Form.accessKeyId}
                  onChange={(e) => setR2Form((f) => ({ ...f, accessKeyId: e.target.value }))}
                  autoComplete="off"
                />
              </Field>
              <Field
                label="Secret Access Key"
                hint={r2?.configured ? '留空保持不变' : undefined}
              >
                <div className="relative">
                  <Input
                    type={showR2Secret ? 'text' : 'password'}
                    value={r2Form.secretAccessKey}
                    onChange={(e) => setR2Form((f) => ({ ...f, secretAccessKey: e.target.value }))}
                    autoComplete="new-password"
                    className="pr-9"
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-700"
                    aria-label={showR2Secret ? '隐藏密钥' : '显示密钥'}
                    onClick={() => setShowR2Secret((v) => !v)}
                  >
                    {showR2Secret ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </Field>
            </div>
            {r2Msg && (
              <div
                className={
                  r2Msg.type === 'ok'
                    ? 'mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-700'
                    : 'mt-2 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-600'
                }
              >
                {r2Msg.text}
              </div>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                size="sm"
                loading={saveR2.isPending}
                onClick={() => {
                  setR2Msg(null)
                  if (!r2Form.accountId.trim() || !r2Form.bucket.trim()) {
                    setR2Msg({ type: 'err', text: '请填写 Account ID 和 Bucket' })
                    return
                  }
                  saveR2.mutate()
                }}
              >
                保存并启用
              </Button>
              <Button
                size="sm"
                variant="outline"
                loading={testR2.isPending}
                onClick={() => {
                  setR2Msg(null)
                  testR2.mutate()
                }}
              >
                测试连接
              </Button>
              {r2?.configured && (
                <Button
                  size="sm"
                  variant="ghost"
                  loading={clearR2.isPending}
                  onClick={() => {
                    if (confirm('切换回本地存储后，新图片会写入服务器磁盘；R2 中的已有图片不会删除。确定继续？')) {
                      clearR2.mutate()
                    }
                  }}
                >
                  <Trash2 size={13} className="text-red-400" /> 切换回本地
                </Button>
              )}
            </div>
          </Card>

          <Card>
            <h3 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-ink-900">
              <Wallet size={14} className="text-emerald-500" /> 收款
            </h3>
            <Field label="收款账期（天）" hint="确认收货后 N 天还没到账，自动标逾期（只影响没填约定日的收款）">
              <Input
                value={creditDays}
                onChange={(e) => setCreditDays(e.target.value.replace(/\D/g, ''))}
                inputMode="numeric"
                className="w-24"
                placeholder="7"
              />
            </Field>
            {settingsMsg && (
              <div
                className={
                  settingsMsg.type === 'ok'
                    ? 'mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-700'
                    : 'mt-2 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-600'
                }
              >
                {settingsMsg.text}
              </div>
            )}
            <Button
              size="sm"
              className="mt-2"
              loading={saveSettings.isPending}
              onClick={() => {
                setSettingsMsg(null)
                saveSettings.mutate()
              }}
            >
              保存
            </Button>
          </Card>

          <Card>
            <h3 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-ink-900">
              <Server size={14} className="text-sky-500" /> 部署信息
            </h3>
            <dl className="space-y-1.5 text-xs">
              <Row k="访问方式" v="Cloudflare Tunnel（源站不开放端口）" />
              <Row k="数据存储" v="SQLite，单文件，容器内 /app/data" />
              <Row k="备份迁移" v="下方「备份与迁移」一键导出 / 导入" />
              <Row k="登录保护" v="JWT + 密码哈希 + 失败限流（5 次锁 10 分钟）" />
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

        <Card className="lg:col-span-2">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-ink-900">
              <Plug size={14} className="text-brand-500" /> MCP 连接（AI 助手接入）
            </h3>
            <span
              className={
                mcpOn
                  ? 'rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700'
                  : 'rounded-md border border-ink-200 bg-ink-50 px-1.5 py-0.5 text-[10px] font-medium text-ink-400'
              }
            >
              {mcpOn ? (mcp?.source === 'db' ? '已开启' : '已开启 · 来自环境变量') : '未开启'}
            </span>
          </div>
          <p className="mb-3 text-xs leading-relaxed text-ink-400">
            开启后，AI 客户端（Claude / ZCode / Cursor 等）通过 <code className="text-ink-600">{mcpUrl}</code>{' '}
            连接工作台，可以查询和创建项目、任务；没有删除类工具，删除仍在网页里手动做。
          </p>

          <div className="mb-3 flex flex-wrap items-center gap-2">
            <code className="max-w-full truncate rounded-md bg-ink-50 px-2 py-1.5 font-mono text-[11px] text-ink-700">
              {mcp?.token ? (showToken ? mcp.token : maskToken(mcp.token)) : '（未生成令牌）'}
            </code>
            {mcp?.token && (
              <>
                <Button size="icon" variant="ghost" title={showToken ? '隐藏' : '显示'} onClick={() => setShowToken((v) => !v)}>
                  {showToken ? <EyeOff size={13} /> : <Eye size={13} />}
                </Button>
                <Button size="sm" variant="outline" onClick={() => mcp?.token && copy('token', mcp.token)}>
                  {copied === 'token' ? <Check size={13} /> : <Copy size={13} />}
                  {copied === 'token' ? '已复制' : '复制令牌'}
                </Button>
              </>
            )}
            <Button
              size="sm"
              variant="secondary"
              loading={saveToken.isPending}
              onClick={() => saveToken.mutate(genToken())}
            >
              <RefreshCw size={13} /> 生成新令牌
            </Button>
            {mcp?.source === 'db' && (
              <Button
                size="sm"
                variant="ghost"
                loading={saveToken.isPending}
                onClick={() => {
                  if (confirm('清除令牌后所有已配置的 AI 客户端都会失去连接，确定清除？')) saveToken.mutate('')
                }}
              >
                <Trash2 size={13} className="text-red-400" /> 清除
              </Button>
            )}
          </div>

          {mcpOn && (
            <div className="rounded-lg border border-dashed border-[var(--border)] p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-ink-500">
                  把下面这段话发给 AI（Claude / ZCode 等），它会帮你把 MCP 配置好：
                </p>
                <Button size="sm" onClick={() => copy('text', mcpAiText)}>
                  {copied === 'text' ? <Check size={13} /> : <Copy size={13} />}
                  {copied === 'text' ? '已复制，去发给 AI' : '复制配置文案'}
                </Button>
              </div>
              <details>
                <summary className="cursor-pointer text-[11px] text-ink-400 hover:text-ink-600">查看文案内容</summary>
                <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-md bg-ink-50 p-2.5 font-mono text-[10px] leading-relaxed text-ink-600">
{mcpAiText}
                </pre>
              </details>
            </div>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <h3 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-ink-900">
            <DatabaseBackup size={14} className="text-violet-500" /> 备份与迁移
          </h3>
          <p className="mb-3 text-xs leading-relaxed text-ink-400">
            备份是一个 zip 包：完整数据库（含已删除记录）+ 全部图片。换服务器时，在新部署的设置页导入这个包即可完成迁移。
            导入会<b className="text-ink-600">覆盖当前全部数据</b>，不可恢复。
          </p>
          {backupMsg && (
            <div
              className={
                backupMsg.type === 'ok'
                  ? 'mb-3 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-700'
                  : 'mb-3 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-600'
              }
            >
              {backupMsg.text}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" loading={exporting} onClick={doExport}>
              <Download size={14} /> 导出备份
            </Button>
            <Button
              size="sm"
              variant="secondary"
              loading={importBackup.isPending}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload size={14} /> 导入备份
            </Button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) {
                setBackupMsg(null)
                setProgress(0)
                setPendingFile(f)
              }
            }}
          />
        </Card>
      </div>

      <Dialog
        open={!!pendingFile}
        onClose={() => {
          if (!importBackup.isPending) setPendingFile(null)
        }}
        title="确认导入备份"
        description={pendingFile ? `${pendingFile.name}（${fmtSize(pendingFile.size)}）` : undefined}
        footer={
          <>
            <Button
              variant="secondary"
              size="sm"
              disabled={importBackup.isPending}
              onClick={() => setPendingFile(null)}
            >
              取消
            </Button>
            <Button
              variant="danger"
              size="sm"
              loading={importBackup.isPending}
              onClick={() => pendingFile && importBackup.mutate(pendingFile)}
            >
              覆盖导入
            </Button>
          </>
        }
      >
        <div className="rounded-lg bg-red-50 px-3 py-2.5 text-xs leading-relaxed text-red-700">
          导入会用备份包<b>覆盖当前全部数据</b>（项目、任务、客户、图片等），此操作不可恢复。
          建议先「导出备份」留一份当前数据再操作。
        </div>
        {importBackup.isPending && (
          <div className="mt-3">
            <div className="mb-1 flex justify-between text-[11px] text-ink-400">
              <span>正在上传备份包</span>
              <span>{progress}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-ink-100">
              <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}
        <p className="mt-3 text-[11px] leading-relaxed text-ink-400">
          导入完成后如登录态失效，用备份包里的账号密码重新登录即可。
        </p>
      </Dialog>
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
