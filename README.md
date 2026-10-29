# 个人工作台 (Personal Workbench)

自托管的个人工作管理系统，把**公司项目、外包私活、个人收入**放在同一个地方管。

设计灵感来自 [ProjectVault](https://mp.weixin.qq.com/s/gfeGCYS9lWqrzZmJ0gEzXw)（项目/任务/证书管理），并强化了它的薄弱环节：**收入台账**与**多端访问**。

---

## 功能

| 模块 | 说明 |
|---|---|
| **总览** | 已收/待收/利润、抽成汇总、近 6 个月收款趋势、收入结构、逾期任务、临期提醒与**里程碑跟进** |
| **项目** | 项目资料 + **资产索引**（源码目录、线上网址、管理后台、Git 仓库、部署位置、技术栈）+ 收入进度 + **中介抽成** + **里程碑进度** |
| **里程碑** | 项目内交付节点（备案、验收、等反馈…），按工作日/自然日推算，临期自动跟进 |
| **收款** | 分期收款节点、待收/已收/逾期状态、一键标记到账 |
| **任务** | 看板拖拽（待办/进行中/已完成）+ 列表视图，支持优先级、截止日、工时、预算 |
| **到期提醒** | **证书/域名/服务器/客户续费** 通用到期提醒，按剩余天数分级预警 |
| **灵感记录** | **收件箱式**收集公众号/开源项目/文章，粘链接即存，之后逐条消化 |
| **内容库** | **Markdown 编写/预览**，固定类型 + 标签，可传图，可从灵感一键整理，生成**可撤销的公开只读链接** |
| **客户** | 联系人、电话、微信、来源渠道（闲鱼/小红书/熟人…） |
| **全局搜索** | `按 /` 唤起，跨项目、任务、灵感、内容、提醒、客户检索 |
| **设置** | 账号信息、修改密码、部署与安全说明 |

**移动端**：底部 Tab 导航 + 响应式卡片，手机浏览器直接可用，无需 App。

### 中介抽成

接的外包有时要经过中介，不同中介抽成比例不同。项目里可以设置：

| 抽成方式 | 填什么 | 例子 |
|---|---|---|
| 不抽成 | — | 自己接的活 |
| 按比例 | 百分比 | 合同 10000，抽 20% → 抽走 2000，到手 8000 |
| 固定金额 | 元 | 合同 6000，固定抽 500，到手 5500 |

- 还可以记**中介/渠道名**（谁介绍的），方便后续复盘哪个渠道划算
- 填合同金额和比例时，弹窗里**实时显示**「抽走多少 / 你到手多少」
- 总览页会汇总抽成总额和占合同额的比例
- 项目的「待收」「进度」都基于**扣完抽成的净额**，不会把抽成算成永远收不到的欠款

> **收款金额怎么记**：记**实际到账**的钱（已经扣掉抽成的）。比如合同 10000 抽 20%，
> 每笔收款填你银行卡实际收到多少，而不是客户付给中介的全款。

### 收款与逾期

「收款节点」不是必须拆很多期，它只是描述**一笔钱的约定和到账**：

| 场景 | 怎么记 |
|---|---|
| 走中介 | 一条「中介结款」，约定日填中介说的时间 |
| 直客分期 | 首款 / 中期款 / 尾款各一条 |
| 一次性结清 | 就一条「全款」 |

**走中介的项目通常只有一笔收款**。客户把钱付给中介，你开发交付、客户确认收货后，
中介再一次性结给你。所以这类项目不用拆首款/尾款，项目详情页会提示你记一条
「中介结款」，金额按净额自动填好，你只需要选中介说的那个日期。
如果中介分几次给，也可以手动添加多笔。

**逾期是自动判断的**：约定日过了还没标记到账，列表里会显示「逾期 N 天」，
不用你手动改状态。这样「中介说下月结、结果忘了」这种情况跑不掉。

### 里程碑与工作日

项目详情页可以添加交付节点，比如「提交域名备案」「客户验收」「等客户反馈」。
每个节点记录预期效果、到期日、提前提醒天数，未完成节点会按到期日排在时间轴前面。

- **两种工期**：工作日（跳过周六周日）或自然日；工作日只跳周末，不含法定节假日
- **推算统一在后端**：保存时由后端计算到期日，表单里的实时预览也调用同一个接口，
  不会出现前端预览一个日期、存进去另一个日期
- **也可以直接指定日期**：不适合按工期算的节点，切到「直接指定日期」即可
- **临期跟进**：未完成节点进入提前提醒窗口后，会出现在总览的「里程碑跟进」里

### 灵感记录

刷公众号、逛 GitHub、看到好文章，先存下来，有空再慢慢消化。是一个**收件箱**，不是待办清单。

- **粘个链接就行**：标题留空时会抓取网页的真实标题，抓不到再从链接/正文生成；来源（公众号/开源/视频/文章）自动识别
- **也可以只写想法**：不填链接，直接记一段随想
- **我的想法**字段最重要：为什么存它、能怎么用——这是以后真正有价值的部分
- **原文摘录**：怕链接失效，可以贴一段关键段落
- **消化流程**：待看 → 在看 → 已消化 → 已归档，一键切换
- **星级**：一般 / 有用 / 很有价值，可以只看「精选」
- 支持标签（AI、前端、副业…）和关联到具体项目
- **整理成内容**：一键把「我的想法 + 原文摘录 + 来源链接」带进内容库，继续写成文章或客户素材

### 内容库与分享链接

灵感负责「收集」，内容库负责「打磨」和「发出去」。开发中踩的坑、整理好的文章、给客户的方案素材，都放在这里。

**四种固定类型**，平台和审核阶段这类细分维度用标签表达（如 `微信小程序,备案`）：

| 类型 | 用途 |
|---|---|
| 经验避坑 | 备案驳回原因、踩坑记录，下次提交前先搜一遍 |
| 文章草稿 | 从灵感整理出来，继续写成可发布的文章 |
| 客户素材 | 发给客户看的需求说明、操作文档、方案 |
| 笔记 | 不属于以上三类的零散记录 |

状态分为草稿 / 待发 / 已发布 / 已归档，只用于个人整理，和是否开启分享互不影响。

- **Markdown 编写**：桌面左写右看，移动端切换「编辑 / 预览」；支持标题、列表、表格、代码块、任务列表
- **从灵感整理**：灵感卡片点「整理成内容」，自动带入想法、摘录和来源链接；同一灵感重复点击打开同一条，不会重复创建
- **图片附件**：拖拽、选择或 `Ctrl+V` 粘贴，复用现有内容寻址上传与去重；上传后可以一键「插入正文」，正文里也能直接粘图或点工具栏图片按钮，Markdown 会写入 `![描述](地址)`
- **点图预览**：正文和附件里的图片点击后在页面内弹窗查看，不跳新标签页；`Esc` 或点空白处关闭
- **标签**：逗号分隔，自动去重，最多 10 个
- **关联**：可以挂到具体项目、客户，并保留来源灵感

#### 公开分享链接

内容编辑页可以生成一条**无需登录的只读链接**（`/share/<token>`）：

- **有效期**：永久 / 7 天 / 30 天，生成后还能改
- **撤销**：撤销后链接立即失效
- **轮换**：换一条新链接，旧链接立刻失效，适合链接被转发后收回
- **默认不分享**：必须手动生成，不会因为保存或发布状态自动公开
- **公开页**：只显示标题、标签、更新时间和正文、图片，不暴露内容 ID、状态、项目/客户、分享 Token
- **安全**：正文不渲染原始 HTML，链接只允许 `http` / `https` / `mailto`；公开接口带 `no-store`、`noindex`、`no-referrer`、`nosniff` 响应头

> 撤销只让分享链接失效，**已经拿到的图片直链仍然可以打开**。图片读取沿用内容哈希不可枚举的设计，需要更严时可以后续改成带分享 Token 校验的图片代理。

---

### 任务步骤（子任务）

一条任务里常有「上传代码 → 域名访问 → 完善信息 → 测支付」这种分步动作。拆成四个独立任务会丢掉「它们是一件事」的语义，看板也会碎成一堆卡片，所以在任务内部做成勾选清单。

- **卡片上看进度**：显示 `2/4` 徽标，不用点开就知道推到哪了
- **批量录入**：点列表图标，整段粘贴多行，每行一步。`1. 2.`、`- `、`• `、`✓ ` 这类前缀会自动去掉
- **就地编辑**：改标题直接点文字改，失焦保存；勾选框单独切换完成
- 删任务时步骤一起清掉，不留孤儿数据

### 图片附件

截图、参考图直接拖进任务、项目或内容里，也可以 `Ctrl+V` 直接粘贴截图。一张图只能归属任务、项目、内容中的一处。点击缩略图在页面内弹窗预览，不跳新标签页。

- **默认存在服务器磁盘**：`data/uploads/<哈希前2位>/<sha256>.<后缀>`；也可在设置页接入 Cloudflare R2，新图片直接写入私有 Bucket
- **按内容哈希命名**：同一张图传两次只占一份空间；同一张图可以挂到多个任务上，各存一条记录、磁盘共用一份文件
- **库里只存元数据**：哈希、类型、尺寸、大小。不存 base64——那会让体积涨 33%，列表查询还得拖着二进制
- **只认真正的图片**：按文件头解码校验，改后缀骗不过去；单张上限 10MB（`MAX_UPLOAD_MB` 可调）
- **删除会清磁盘**：删图片时，如果没有别的记录还引用同一个文件，就把磁盘文件一起删掉（有引用则保留）；删任务、删项目、删内容也会连带清理名下图片
- **读取不鉴权**：`<img src>` 带不上 Authorization 头，所以读图路由放在鉴权外。安全性靠 256 位内容哈希本身不可枚举——等同一条直达链接，和对象存储的预签名 URL 同理

R2 配置在设置页填写，保存时先做一次上传、读取、删除测试。密钥加密后存数据库，读接口只返回脱敏 Access Key。Bucket 使用 EU jurisdiction 时在设置页选择 `EU`。已有 R2 图片时不能更换 Account ID、Bucket 或切换回本地存储；备份包会包含 R2 图片，但不包含 R2 凭据。

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

# 测试
cd backend && go test ./...
cd frontend && pnpm test     # Vitest + Testing Library（jsdom）
```

---

## MCP：让 AI 管理项目和任务

工作台内置 MCP（Model Context Protocol）端点，AI 客户端（Claude、ZCode、Cursor 等）
连上之后就能直接查询/创建/编辑项目和任务。工具经 `internal/mcpbridge` 走 HTTP API 操作数据，
数据库零侵入。

| 工具 | 说明 |
|---|---|
| `list_projects` | 列项目（合同额/已收/抽成汇总），支持按状态、类型、关键词过滤 |
| `get_project` | 项目详情（含收款记录、任务、里程碑） |
| `create_project` | 创建项目 |
| `update_project` | 编辑项目，**只提交的字段会更新**，其他字段不受影响 |
| `list_tasks` | 列任务，支持按项目/状态/优先级/逾期过滤 |
| `create_task` | 创建任务（可关联项目） |
| `update_task` | 编辑任务（改状态、优先级、截止日等）。AI 完成后只允许流转到「待验收」，`done` 由人工设置 |
| `get_task_attachments` | 读取任务上的截图，以图片返回给 AI（处理打回、看现场截图时用） |

没有删除类工具——AI 误操作的代价不可控，删除请在页面里手动做。

### 方式一：远程连接（推荐）

令牌在**工作台设置页 → MCP 连接**里生成和管理（存设置表，可随时重置/清除），
页面上一键复制一段配置文案，粘贴给 AI 即可让它代为配置。兼容老用法：`.env` 里的
`MCP_TOKEN`（生成：`openssl rand -hex 32`）作为兜底，两者都没有时端点返回 401（默认关闭）。

客户端按「远程 MCP / Custom Connector」添加：

- **URL**：`https://<你的域名>/mcp`
- **请求头**：`Authorization: Bearer <令牌>`

以 mcpServers JSON 格式的客户端（Cursor/ZCode 等）为例：

```json
{
  "mcpServers": {
    "personal-workbench": {
      "url": "https://<你的域名>/mcp",
      "headers": { "Authorization": "Bearer <MCP_TOKEN>" }
    }
  }
}
```

Claude Desktop / Claude 用「设置 → Connectors → 添加自定义连接器」，填 URL 和上面的请求头即可。
不设置 `MCP_TOKEN` 时 `/mcp` 路由不注册，端点默认关闭。

### 方式二：本地 stdio（不走公网）

`backend/cmd/mcp` 是一个独立的小程序，工作方式是客户端启动时自动拉起它，通过 `WORKBENCH_URL`
访问工作台（本地或线上都行）：

```bash
cd backend && go build -o bin/mcp ./cmd/mcp   # Windows 得到 bin/mcp.exe
```

```json
{
  "mcpServers": {
    "personal-workbench": {
      "command": "backend/bin/mcp.exe",
      "env": {
        "WORKBENCH_URL": "https://<你的域名>",
        "WORKBENCH_USER": "admin",
        "WORKBENCH_PASS": "你的密码"
      }
    }
  }
}
```

两种方式验证方法一样：问 AI「我有哪些项目进行中」，能列出来说明链路通了。

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

> ⚠️ 如果给整个域名启用了 **Cloudflare Access**，外部客户打开分享链接会被登录页挡住。
> 需要在 Access 应用里为以下路径配置 **Bypass**：
> `/share/*`、`/api/public/*`、`/api/attachments/*/raw`。
> 不加 Access 则无需配置。

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
| `workbench.db` | **SQLite 数据库**：项目、客户、收款、任务、提醒、里程碑、灵感、内容库与分享状态、账号、登录限流记录 |
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

#### 一键备份（推荐）

设置页「备份与迁移」可以在线导出一个 zip 备份包（完整数据库 + 全部图片），
不用停机、不用进容器，恢复时在任意部署的设置页导入即可：

- **导出**：`GET /api/backup/export`，后台用 `VACUUM INTO` 生成 SQLite 一致性快照再打包，
  WAL 模式下在线执行，不阻塞正常读写，软删记录、密码哈希都会原样保留
- **导入**：`POST /api/backup/import`，上传备份包后**整库覆盖**当前数据。
  校验（zip 完整性、SQLite `quick_check`、表结构齐全）全部通过后，
  在单个事务里完成替换，失败自动回滚，现有数据不受影响

> ⚠️ 导入是覆盖式操作，不可恢复，导入前建议先导出一份当前数据。
> 经 Cloudflare Tunnel 访问时受其单请求 100MB 上限约束，更大的备份包请走内网直连。
> JWT 密钥不包含在备份包里：迁移后用备份里的账号重新登录即可。

#### 手工备份（停机）

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

**方式一：备份包导入（推荐）**。旧服务器设置页「导出备份」拿到 zip，新服务器部署好、
登录后进设置页「导入备份」选择该包，完成。

**方式二：整体拷贝 data/ 目录**（备份包之外的等价做法，适合无法登录旧实例时）：

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
| `UPLOAD_DIR` | `./data/uploads` | 图片存放目录（和数据库同在 `data/` 下，一起备份） |
| `MAX_UPLOAD_MB` | `10` | 单张图片大小上限 |
| `MCP_TOKEN` | 空（关闭） | 设置后开启 `/mcp` 端点（Streamable HTTP），AI 客户端用 `Authorization: Bearer <MCP_TOKEN>` 连接 |
| `MAX_BACKUP_UPLOAD_MB` | `2048` | 备份包导入大小上限（导出不受限） |
| `CLOUDFLARE_TUNNEL_TOKEN` | — | Tunnel 令牌 |

---

## API 一览

```
POST   /api/auth/login            登录
GET    /api/auth/me               当前用户
POST   /api/auth/password         修改密码
POST   /api/auth/logout           退出登录（服务端吊销已签发 token）

GET    /api/dashboard             总览统计
GET    /api/search?q=             全局搜索
GET    /api/workdays/preview      推算到期日（start/days/dayType）

GET    /api/projects              项目列表（支持 q/kind/status/clientId 筛选）
POST   /api/projects
GET    /api/projects/:id          项目详情（含收款/任务/提醒/里程碑/客户）
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

GET    /api/tasks/:id/subtasks    任务的步骤清单
POST   /api/tasks/:id/subtasks    加一步
POST   /api/tasks/:id/subtasks/bulk  多行文本一次拆成多步
PUT    /api/subtasks/:id          改标题 / 勾选完成
DELETE /api/subtasks/:id

POST   /api/attachments           上传图片（multipart: file + taskId?/projectId?/contentId?）
GET    /api/attachments           图片列表（按 taskId/projectId/contentId 筛）
GET    /api/attachments/:hash/raw 读取图片（不鉴权，靠哈希不可枚举）
DELETE /api/attachments/:id       删记录（磁盘文件按哈希共享，不在此删）

GET    /api/reminders             到期提醒
POST   /api/reminders
PUT    /api/reminders/:id
DELETE /api/reminders/:id

GET    /api/milestones            里程碑（支持 projectId/status/open=1）
POST   /api/milestones
PUT    /api/milestones/:id
PATCH  /api/milestones/:id/status 快速切换完成状态
DELETE /api/milestones/:id

GET    /api/clients               客户
POST   /api/clients
PUT    /api/clients/:id
DELETE /api/clients/:id

GET    /api/tags                  标签
POST   /api/tags
DELETE /api/tags/:id

GET    /api/ideas                 灵感记录（支持 q/status/source/star/projectId）
GET    /api/ideas/stats           各状态数量
POST   /api/ideas
PUT    /api/ideas/:id
PATCH  /api/ideas/:id/status      快速切换状态 / 星级
DELETE /api/ideas/:id

GET    /api/backup/export         导出备份包（zip：数据库快照 + 全部图片）
POST   /api/backup/import         导入备份包（multipart: file，整库覆盖，不可恢复）

GET    /api/contents              内容列表（支持 q/kind/status/projectId/clientId）
GET    /api/contents/stats        总数、按类型/状态统计、有效分享数
POST   /api/contents
POST   /api/contents/from-idea    从灵感生成（幂等，已存在返回原内容）
GET    /api/contents/:id          详情（含正文、附件数、封面、分享状态）
PUT    /api/contents/:id
DELETE /api/contents/:id          软删除，同时清理附件和分享
POST   /api/contents/:id/share    生成或更新分享链接（expiresInDays: 0/7/30）
POST   /api/contents/:id/share/rotate  轮换 Token（旧链接立即失效）
DELETE /api/contents/:id/share    撤销分享

GET    /api/public/contents/:token  公开只读读取（不鉴权，Token 不可枚举）
```

除以下公开接口外，其余接口均需 `Authorization: Bearer <token>`：

| 公开接口 | 说明 |
|---|---|
| `POST /api/auth/login` | 登录 |
| `GET /api/health` | 健康检查 |
| `GET /api/public/contents/:token` | 公开分享内容，只返回标题、正文、标签、更新时间、图片 |
| `GET /api/attachments/:hash/raw` | 图片直链 |

`/api/public/contents/:token` 的 Token 是 64 位随机十六进制，猜不到就等于拿不到；Token 不存在、已撤销、已过期、内容已删除或已轮换时，统一返回 404 和「分享不存在或已失效」，不区分具体原因。

`GET /api/attachments/:hash/raw` 不鉴权是因为 `<img>` 标签由浏览器自己发起请求，带不上自定义请求头。它靠 256 位内容哈希保证不可枚举——和对象存储预签名 URL 同一思路。若要更严，可改成带时效的签名 URL，或把站点放进 Cloudflare Access 后面（注意给分享路径配 Bypass）。

图片存储可在设置页切换到 Cloudflare R2，无需额外环境变量；切换后新上传图片写入 R2，历史图片按各自记录继续从原存储读取。

---

## 安全设计

- bcrypt 存储密码
- JWT 短期有效（默认 7 天）
- **退出即吊销**：登出或修改密码会让该账号的 token 版本号自增，旧 token 立刻失效，不用等到过期
- **登录失败限流**：同一 IP 连续 5 次失败锁定 10 分钟，前 4 次会提示剩余尝试次数；记录存在 SQLite 里，重启不会清零
- **分享 Token 不进日志**：访问日志里的 `/share/<token>` 与 `/api/public/contents/<token>` 统一打印为 `[redacted]`；Token 字段不直接返回给前端，公开接口只输出内容白名单
- **公开页防收录**：分享页注入 `noindex, nofollow` 与 `no-referrer`，接口响应带 `Cache-Control: no-store`、`X-Robots-Tag`、`X-Content-Type-Options: nosniff`
- **Markdown 安全渲染**：不渲染原始 HTML，经过 `rehype-sanitize`，链接协议限制为 `http` / `https` / `mailto`，外链带 `noopener noreferrer nofollow`
- **撤销不等于删除图片**：撤销分享让页面链接立即 404，但已拿到的图片直链仍可访问（内容哈希不可枚举）
- 无注册入口，仅单账号
- Cloudflare Tunnel 隐藏源站 IP
- 可选：在 Cloudflare 侧开启 Access 应用层鉴权做二次保护（为分享路径配置 Bypass）

---

## 目录结构

```
personal-workbench/
├── backend/
│   ├── cmd/server/main.go          入口与路由（含 /mcp 端点）
│   ├── cmd/mcp/main.go             独立 MCP 服务器（stdio 本地模式）
│   └── internal/
│       ├── auth/                   JWT + 限流
│       ├── config/                 配置
│       ├── database/               连接与迁移
│       ├── handler/                HTTP 处理器
│       ├── mcpbridge/              MCP 工具集（桥接 API 供 AI 调用）
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
