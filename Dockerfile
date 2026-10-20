# 不使用 # syntax 指令：未使用 BuildKit 专有语法，
# 走内置 frontend 可避免构建时额外拉取 docker/dockerfile 镜像（国内网络常被墙）。
# 如需 RUN --mount=type=cache 等特性，再补回该指令。

# ---------- 前端构建 ----------
# 用 BUILDPLATFORM：前端产物与架构无关，只在构建机上跑一次，
# 避免多架构构建时在 QEMU 模拟下重复构建前端。
FROM --platform=$BUILDPLATFORM node:24-alpine AS web
WORKDIR /web
RUN corepack enable
COPY frontend/package.json frontend/pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile || pnpm install
COPY frontend/ ./
RUN pnpm build

# ---------- 后端构建 ----------
FROM --platform=$BUILDPLATFORM golang:1.27-alpine AS api
WORKDIR /src
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
# TARGETOS/TARGETARCH 由 buildx 注入，交叉编译出目标架构的二进制
ARG TARGETOS
ARG TARGETARCH
RUN CGO_ENABLED=0 GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH:-amd64} \
    go build -trimpath -ldflags="-s -w" -o /out/workbench ./cmd/server

# ---------- 运行镜像 ----------
FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata wget \
    && addgroup -S app && adduser -S app -G app
ENV TZ=Asia/Shanghai \
    STATIC_DIR=/app/web \
    DB_PATH=/app/data/workbench.db \
    ADDR=:8080

WORKDIR /app
COPY --from=api /out/workbench /app/workbench
COPY --from=web /web/dist /app/web

RUN mkdir -p /app/data && chown -R app:app /app
USER app

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1

VOLUME ["/app/data"]
ENTRYPOINT ["/app/workbench"]
