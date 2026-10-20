# ---------- 前端构建 ----------
FROM node:24-alpine AS web
WORKDIR /web
RUN corepack enable
COPY frontend/package.json frontend/pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile || pnpm install
COPY frontend/ ./
RUN pnpm build

# ---------- 后端构建 ----------
FROM golang:1.27-alpine AS api
WORKDIR /src
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/workbench ./cmd/server

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
