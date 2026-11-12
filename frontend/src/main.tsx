import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'

import AppShell from './components/AppShell'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import ProjectsPage from './pages/ProjectsPage'
import ProjectDetailPage from './pages/ProjectDetailPage'
import TasksPage from './pages/TasksPage'
import TicketsPage from './pages/TicketsPage'
import PaymentsPage from './pages/PaymentsPage'
import RemindersPage from './pages/RemindersPage'
import WechatFilingPage from './pages/WechatFilingPage'
import IdeasPage from './pages/IdeasPage'
import ContentsPage from './pages/ContentsPage'
import ContentEditorPage from './pages/ContentEditorPage'
import ClientsPage from './pages/ClientsPage'
import SettingsPage from './pages/SettingsPage'
import PublicSharePage from './pages/PublicSharePage'
import PublicFeedbackPage from './pages/PublicFeedbackPage'
import PublicTicketPage from './pages/PublicTicketPage'
import { getToken } from './lib/api'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, retry: 1, staleTime: 10_000 },
  },
})

function RequireAuth({ children }: { children: React.ReactNode }) {
  if (!getToken()) return <Navigate to="/login" replace />
  return <>{children}</>
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          {/* 公开分享阅读页：不需要登录，也不能套 AppShell */}
          <Route path="/share/:token" element={<PublicSharePage />} />
          {/* 客户提报页与工单进度页：同样免登录 */}
          <Route path="/feedback/:token" element={<PublicFeedbackPage />} />
          <Route path="/t/:token" element={<PublicTicketPage />} />
          <Route
            element={
              <RequireAuth>
                <AppShell />
              </RequireAuth>
            }
          >
            <Route path="/" element={<DashboardPage />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/projects/:id" element={<ProjectDetailPage />} />
            <Route path="/tasks" element={<TasksPage />} />
            <Route path="/tickets" element={<TicketsPage />} />
            <Route path="/payments" element={<PaymentsPage />} />
            <Route path="/reminders" element={<RemindersPage />} />
            <Route path="/wechat-filing" element={<WechatFilingPage />} />
            <Route path="/ideas" element={<IdeasPage />} />
            <Route path="/contents" element={<ContentsPage />} />
            <Route path="/contents/new" element={<ContentEditorPage />} />
            <Route path="/contents/:id" element={<ContentEditorPage />} />
            <Route path="/clients" element={<ClientsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
)
