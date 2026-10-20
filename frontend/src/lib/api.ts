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
    profit: number
    unreceived: number
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
