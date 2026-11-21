# personal-workbench

## 线上部署

- 线上服务器：张璠阿里云1030-个人工作台（motty 会话 `w1:2`，root@39.107.50.150），部署目录 `/opt/workbench`。
- 构建：推送到 `main` 后由 GitHub Actions（`.github/workflows/docker.yml`）跑后端 `go vet`/`go test`、前端 `pnpm test`/`pnpm build`，再构建多架构镜像推送到 GHCR。
- 服务器上的 `docker-compose.yml` 使用镜像 `ghcr.dockerproxy.net/weihebai/personal-workbench:latest`，容器名 `workbench`，映射 `127.0.0.1:8899 -> 8080`，数据目录 `/opt/workbench/data`（挂载到容器 `/app/data`）。
- 公网入口：宿主机 nginx 监听 `9096`，反代到 `127.0.0.1:8899`，访问地址形如 `http://39.107.50.150:9096`。
- 更新流程：
  1. 本地提交并推送 `main`；
  2. 等 Actions 构建完成，确认 GHCR 上的 `latest` 已包含这次提交；
  3. 在服务器的 `/opt/workbench` 执行 `docker compose pull && docker compose up -d`；
  4. 用 `docker compose logs --tail=50 workbench` 确认新容器启动正常。
- 数据都在宿主机 `/opt/workbench/data`，换镜像不丢数据；涉及表结构变更时，先备份该目录。

## 前端 / 后端验证

- 前端：`cd frontend && pnpm run typecheck && pnpm test`。
- 后端：`cd backend && go vet ./... && go test ./...`。
