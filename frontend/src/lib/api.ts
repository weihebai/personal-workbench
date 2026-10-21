import axios from 'axios'

export const api = axios.create({
  baseURL: '/api',
  timeout: 20000,
})

const TOKEN_KEY = 'wb_token'

export function getToken() {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(t: string | null) {
  if (t) localStorage.setItem(TOKEN_KEY, t)
  else localStorage.removeItem(TOKEN_KEY)
}

api.interceptors.request.use((cfg) => {
  const t = getToken()
  if (t) cfg.headers.Authorization = `Bearer ${t}`
  return cfg
})

api.interceptors.response.use(
  (res) => res,
  (err) => {
    const status = err?.response?.status
    const url: string = err?.config?.url ?? ''
    if (status === 401 && !url.includes('/auth/login')) {
      setToken(null)
      if (!location.pathname.startsWith('/login')) location.href = '/login'
    }
    return Promise.reject(err)
  },
)

export function errMsg(e: any, fallback = '操作失败') {
  return e?.response?.data?.error || e?.message || fallback
}

/* ---------- 类型 ---------- */

export interface Paged<T> {
  items: T[]
  total: number
  page: number
  size: number
  pages: number
}

export interface Project {
  id: number
  name: string
  kind: 'company' | 'outsource' | 'personal'
  status: string
  summary: string
  sourcePath: string
  onlineUrl: string
  adminUrl: string
  gitRepo: string
  deployAt: string
  techStack: string
  clientId?: number | null
  quote: number
  cost: number
  commissionType: 'none' | 'pct' | 'fixed'
  commissionRate: number
  broker: string
  /** 抽成金额（只读，后端计算） */
  commission: number
  /** 扣完抽成后应得的合同额（只读） */
  netQuote: number
  startDate?: string | null
  dueDate?: string | null
  estimateMinutes: number
  actualMinutes: number
  note: string
  received: number
  tags: string[]
  createdAt: string
  updatedAt: string
  milestoneTotal: number
  milestoneDone: number
  nextMilestone: string
  nextDueIn?: number | null
}

export interface Payment {
  id: number
  projectId: number
  title: string
  amount: number
  status: 'pending' | 'received' | 'overdue'
  planDate?: string | null
  paidDate?: string | null
  note: string
  /** 约定日已过但还没到账，由后端按日期算出来 */
  overdue?: boolean
  daysLate?: number
  projectName?: string
}

export interface Task {
  id: number
  title: string
  desc: string
  projectId?: number | null
  clientId?: number | null
  status: 'todo' | 'doing' | 'done' | 'canceled'
  priority: 'low' | 'normal' | 'high' | 'urgent'
  kind: string
  dueDate?: string | null
  remindDays: number
  estimateMinutes: number
  actualMinutes: number
  budget: number
  doneAt?: string | null
  note: string
  dueState?: 'normal' | 'soon' | 'overdue' | ''
  projectName?: string
  clientName?: string
  createdAt: string
  /** 子任务清单（只有详情里带，列表只给计数） */
  subtasks?: Subtask[]
  subtaskDone?: number
  subtaskTotal?: number
}

/** 任务内部的步骤 */
export interface Subtask {
  id: number
  taskId: number
  title: string
  done: boolean
  sort: number
}

/** 图片附件：文件在服务器磁盘上，这里只有元数据 */
export interface Attachment {
  id: number
  hash: string
  name: string
  mime: string
  size: number
  width: number
  height: number
  taskId?: number | null
  projectId?: number | null
  url: string
  createdAt: string
}

export interface Reminder {
  id: number
  title: string
  category: 'certificate' | 'domain' | 'server' | 'client' | 'other'
  projectId?: number | null
  target: string
  expireAt: string
  remindDays: number
  issuer: string
  autoRenew: boolean
  enabled: boolean
  note: string
  state?: 'normal' | 'soon' | 'expired'
  daysLeft?: number
  projectName?: string
}

export interface Client {
  id: number
  name: string
  contact: string
  phone: string
  wechat: string
  source: string
  note: string
}

export interface Milestone {
  id: number
  projectId: number
  title: string
  expect: string
  status: 'waiting' | 'done' | 'delayed' | 'canceled'
  sort: number
  startDate?: string | null
  dayType: 'workday' | 'natural'
  days: number
  dueDate?: string | null
  remindDays: number
  doneAt?: string | null
  note: string
  projectName?: string
  daysLeft?: number | null
  state?: 'normal' | 'soon' | 'overdue'
  createdAt: string
}

export interface DashboardData {
  counts: {
    projects: number
    activeProjects: number
    unpaidProjects: number
    todoTasks: number
    doingTasks: number
    overdueTasks: number
    remindersSoon: number
    remindersExpired: number
    followUps: number
  }
  finance: {
    quote: number
    cost: number
    received: number
    pending: number
    /** 预估利润 = 净合同额 - 成本 */
    profit: number
    /** 已实现利润 = 已收 - 成本 */
    profitRealized: number
    unreceived: number
    /** 中介抽成总额 */
    commission: number
    /** 扣完抽成的净合同额 */
    netQuote: number
  }
  monthly: { month: string; quote: number; received: number }[]
  byKind: { kind: string; count: number; quote: number; received: number }[]
  overdueTasks: Task[]
  pendingPayments: Payment[]
  soonReminders: Reminder[]
  followUps: FollowUp[]
}

export interface FollowUp {
  id: number
  title: string
  expect: string
  projectId: number
  projectName: string
  dueDate: string
  daysLeft: number
  status: 'waiting' | 'delayed'
  remindDays: number
}

/** 灵感记录：先存下来，之后慢慢消化 */
export interface Idea {
  id: number
  title: string
  url: string
  source: 'wechat' | 'github' | 'article' | 'video' | 'note' | 'other'
  content: string
  note: string
  status: 'inbox' | 'reading' | 'digested' | 'archived'
  star: number
  tags: string
  projectId?: number | null
  projectName?: string
  tagList: string[]
  readingMins: number
  createdAt: string
  updatedAt: string
}

export interface IdeaStats {
  byStatus: { inbox: number; reading: number; digested: number; archived: number }
  total: number
  starred: number
}
