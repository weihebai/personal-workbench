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

### 0. 拉取预构建镜像（推荐）

GitHub Actions 会在推送到 `main` 或打 `v*` 标签时自动构建多架构镜像并推送到 GHCR：

```bash
# 镜像地址（小写）
docker pull ghcr.io/weihebai/personal-workbench:latest
```

支持的标签：

| 标签 | 触发条件 |
|---|---|
| `latest` | 推送到 `main` |
| `main` | 推送到 `main` |
| `1.2.3` / `1.2` | 打 `v1.2.3` 标签 |

> 首次拉取私有包需登录：`echo $GITHUB_TOKEN \| docker login ghcr.io -u <用户名> --password-stdin`

用预构建镜像部署时，把 `docker-compose.yml` 里的 `build: .` 删掉、
改为 `image: ghcr.io/weihebai/personal-workbench:latest` 即可，其余不变。

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

### 3. 数据持久化（重要）

**所有数据都存放在宿主机上，不在容器内部。** 容器是无状态的，删掉容器、拉新镜像都不会丢数据。

`docker-compose.yml` 里的挂载：

```yaml
volumes:
  - ./data:/app/data     # 宿主机 ./data  ←→  容器 /app/data
```

容器内 `/app/data` 目录的内容：

| 文件 | 说明 |
|---|---|
| `workbench.db` | **SQLite 数据库**：项目、客户、收款、任务、提醒、里程碑、账号 |
| `workbench.db-wal` | 预写日志，运行期间新数据先写这里 |
| `workbench.db-shm` | WAL 共享内存索引 |
| `.jwt_secret` | JWT 签名密钥（删了会导致所有登录失效） |

对应宿主机路径就是 `./data/`，直接 `ls data/` 能看到这些文件。

**用预构建镜像时也要挂载**：

```bash
docker run -d --name workbench \
  -p 8080:8080 \
  -v /你的/数据目录:/app/data \
  -e ADMIN_PASS='强密码' \
  --restart unless-stopped \
  ghcr.io/weihebai/personal-workbench:latest
```

> ⚠️ 不挂载 `-v` 的话，数据会随容器删除而消失；`:ro` 只读挂载会导致无法写入、启动失败。

**换成绝对路径**（推荐生产环境，避免在哪个目录执行 compose 就建到哪）：

```yaml
volumes:
  - /opt/workbench/data:/app/data
```

### 4. 备份与恢复

#### 备份

程序**正常停止时会自动把 WAL 合并回主库**，所以最稳妥的方式是停止容器后复制：

```bash
# 停止 → 复制 → 启动
docker compose stop workbench
cp data/workbench.db /backup/workbench-$(date +%F).db
docker compose start workbench
```

如果不想停服务，可以对 WAL 文件做主库+日志的完整快照（两步之间可能有新写入，一致性弱于停机备份）：

```bash
# 同时复制三个文件才算完整
cp data/workbench.db      /backup/wb-$(date +%F).db
cp data/workbench.db-wal  /backup/wb-$(date +%F).db-wal
cp data/workbench.db-shm  /backup/wb-$(date +%F).db-shm
```

> ⚠️ **绝对不能只 `cp workbench.db`**：WAL 模式下运行中的数据大部分还在 `workbench.db-wal` 里，
> 单独复制主库文件只会得到一个几乎空白的数据库。这是 SQLite WAL 模式的固有问题。
>
> 实测对比：只 cp 主库 → 恢复后数据为空；停机后 cp → 恢复后数据完整。

#### 恢复

```bash
docker compose down
cp /backup/workbench-2026-10-20.db data/workbench.db
rm -f data/workbench.db-wal data/workbench.db-shm   # 必须清掉旧的 WAL
docker compose up -d
```

#### 定时备份（systemd timer 或 cron）

```bash
# 每天 3 点：先停服务再备份，保证一致性
0 3 * * * cd /opt/workbench && docker compose stop workbench && \
  cp data/workbench.db /backup/workbench-$(date +\%F).db && \
  docker compose start workbench
```

### 5. 迁移到新服务器

```bash
# 旧机器：停止并打包
docker compose stop workbench
tar czf wb-data.tar.gz data/

# 新机器：还原
tar xzf wb-data.tar.gz
docker compose up -d
```

`data/` 目录就是全部状态，拷过去即可。

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
