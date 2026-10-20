# 个人工作台 (Personal Workbench)

自托管的个人工作管理系统，把**公司项目、外包私活、个人收入**放在同一个地方管。

设计灵感来自 [ProjectVault](https://mp.weixin.qq.com/s/gfeGCYS9lWqrzZmJ0gEzXw)（项目/任务/证书管理），并强化了它的薄弱环节：**收入台账**与**多端访问**。

---

## 功能

| 模块 | 说明 |
|---|---|
| **总览** | 已收/待收/利润、近 6 个月收款趋势、收入结构、逾期任务与临期提醒汇总 |
| **项目** | 项目资料 + **资产索引**（源码目录、线上网址、管理后台、Git 仓库、部署位置、技术栈）+ 收入进度 |
| **收款** | 分期收款节点、待收/已收/逾期状态、一键标记到账 |
| **任务** | 看板拖拽（待办/进行中/已完成）+ 列表视图，支持优先级、截止日、工时、预算 |
| **到期提醒** | **证书/域名/服务器/客户续费** 通用到期提醒，按剩余天数分级预警 |
| **客户** | 联系人、电话、微信、来源渠道（闲鱼/小红书/熟人…） |
| **全局搜索** | `按 /` 唤起，跨项目、任务、提醒、客户检索 |

**移动端**：底部 Tab 导航 + 响应式卡片，手机浏览器直接可用，无需 App。

---

## 技术栈

- **后端**：Go 1.27 + Gin + GORM + SQLite（单文件，零运维）
- **前端**：React 19 + Vite 8 + TypeScript + Tailwind CSS 4 + Recharts
- **UI**：自研无头组件（Shadcn 模式），高饱和明亮主题
- **部署**：Docker Compose + Cloudflare Tunnel

---

## 快速开始（本地开发）

```bash
# 后端
cd backend
go run ./cmd/server          # 默认 :8080，数据库 ./data/workbench.db
# 首次启动会创建 admin / admin123

# 前端（另开终端）
cd frontend
pnpm install
pnpm dev                     # http://localhost:5173，已配置 /api 代理
```

---

## 生产部署（Cloudflare Tunnel）

**前提**：一台有 Docker 的服务器，域名已托管在 Cloudflare。

### 1. 创建 Tunnel

Cloudflare Zero Trust → Networks → Tunnels → 创建隧道 → 复制 Token。

添加一条 Public Hostname 映射：

| 字段 | 值 |
|---|---|
| Subdomain | `wb`（或你喜欢的） |
| Domain | `你的域名` |
| Service | `http://workbench:8080` |

> 服务地址用容器名 `workbench`，因为 cloudflared 与 workbench 在同一 Docker 网络内。

### 2. 部署

```bash
cp .env.example .env
# 编辑 .env：填入 ADMIN_PASS（务必修改）、CLOUDFLARE_TUNNEL_TOKEN
docker compose up -d --build
docker compose logs -f workbench
```

访问 `https://wb.你的域名`。

**安全特性**：源站**不开放任何入站端口**，cloudflared 主动外连；SSL 由 Cloudflare 托管，无需 Certbot。

### 3. 备份

数据是单个 SQLite 文件：

```bash
# 每日备份到宿主机
0 3 * * * cp /path/to/personal-workbench/data/workbench.db /backup/workbench-$(date +\%F).db
```

> WAL 模式下建议用 `sqlite3 workbench.db ".backup /backup/x.db"` 保证一致性。

---

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `ADDR` | `:8080` | 监听地址 |
| `DB_PATH` | `./data/workbench.db` | SQLite 路径 |
| `STATIC_DIR` | 空 | 设置后由后端托管前端静态文件 |
| `ADMIN_USER` / `ADMIN_PASS` | `admin` / `admin123` | 仅在库为空时创建 |
| `JWT_SECRET` | 自动生成 | 留空则生成并保存到 `data/.jwt_secret` |
| `TOKEN_TTL_HOURS` | `168` | 登录有效期（小时） |
| `CLOUDFLARE_TUNNEL_TOKEN` | — | Tunnel 令牌 |

---

## API 一览

```
POST   /api/auth/login            登录
GET    /api/auth/me               当前用户
POST   /api/auth/password         修改密码

GET    /api/dashboard             总览统计
GET    /api/search?q=             全局搜索

GET    /api/projects              项目列表（支持 q/kind/status/clientId 筛选）
POST   /api/projects
GET    /api/projects/:id          项目详情（含收款/任务/提醒/客户）
PUT    /api/projects/:id
DELETE /api/projects/:id

GET    /api/payments              收款列表
POST   /api/payments
PUT    /api/payments/:id
DELETE /api/payments/:id

GET    /api/tasks                 任务（sort=due、overdue=1）
POST   /api/tasks
PUT    /api/tasks/:id             部分字段更新（看板拖拽用）
DELETE /api/tasks/:id

GET    /api/reminders             到期提醒
POST   /api/reminders
PUT    /api/reminders/:id
DELETE /api/reminders/:id

GET    /api/clients               客户
POST   /api/clients
PUT    /api/clients/:id
DELETE /api/clients/:id

GET    /api/tags                  标签
POST   /api/tags
DELETE /api/tags/:id
```

除 `/api/auth/login` 与 `/api/health` 外均需 `Authorization: Bearer <token>`。

---

## 安全设计

- bcrypt 存储密码
- JWT 短期有效（默认 7 天）
- **登录失败限流**：同一 IP 连续 5 次失败锁定 10 分钟
- 无注册入口，仅单账号
- Cloudflare Tunnel 隐藏源站 IP
- 可选：在 Cloudflare 侧开启 Access 应用层鉴权做二次保护

---

## 目录结构

```
personal-workbench/
├── backend/
│   ├── cmd/server/main.go          入口与路由
│   └── internal/
│       ├── auth/                   JWT + 限流
│       ├── config/                 配置
│       ├── database/               连接与迁移
│       ├── handler/                HTTP 处理器
│       └── model/                  数据模型
├── frontend/
│   └── src/
│       ├── components/ui/          无头 UI 组件
│       ├── lib/                    API 客户端与工具
│       └── pages/                  各页面
├── Dockerfile                      多阶段构建
├── docker-compose.yml              workbench + cloudflared
└── .env.example
```
