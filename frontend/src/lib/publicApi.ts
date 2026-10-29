import axios from 'axios'

// 公开分享页专用：不能带登录态，也不能有 401 → 跳登录的拦截器，
// 否则外部客户打开链接会被莫名其妙带到登录页。
export const publicApi = axios.create({
  baseURL: '/api/public',
  timeout: 20000,
})
