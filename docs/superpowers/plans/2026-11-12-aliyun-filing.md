# 阿里云备案定时监控 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 在现有备案监控页面接入阿里云订单查询、每小时检查、状态变化及会话失效通知。

**Architecture:** 复用现有备案监控模型和任务。新增阿里云 HTTP 客户端、会话导入接口和平台选择；凭据沿用本地加密机制。

**Tech Stack:** Go、Gin 1.10、GORM 1.25、React 19、TanStack Query 5。

**Spec:** 用户本轮要求与本计划的全局约束。

## Global Constraints

- 保持现有微信接口调用兼容；新增 provider 默认 wechat。
- 阿里云仅查询订单进度，不调用审核操作，不自动修改项目节点和到期提醒。
- 会话仅加密存储，不返回、不记录 Cookie；不使用 AccessKey。
- 前端只运行静态类型检查，不执行构建。
- 继续在当前工作区最小修改，不提交已有未提交工作。

## Review Focus

- 同一 status 数值但审核节点变化时仍须通知。
- 进度中的工作日文本变化不触发重复通知。
- NeedLogin 清除失效凭据，保留上次审核状态；网络、权限及格式错误不冒充登录失效。
- 错误订单、缺少当前节点、多个当前节点不能覆盖已知状态。
- 旧备份和既有微信记录使用默认平台，不泄露会话。

### Task 1: 阿里云进度客户端

**Files:** 新建 `backend/internal/aliyun/filing.go`、`backend/internal/aliyun/filing_test.go`。

**Interfaces:** `ImportCookie(string) (*Client, error)`、`Restore(Credentials) (*Client, error)`、`(*Client).Credentials() Credentials`、`(*Client).Progress(context.Context, string) (ProgressNode, error)`；原样保留 nodeId、title、status、statusText、progressInfo。

- [x] 先写 httptest 测试，覆盖会话必需字段、刷新 Cookie、当前节点选择、NeedLogin、权限失败、格式异常、订单不符、重定向和凭据不泄露。
- [x] 执行 `.tmp-go/go/bin/go.exe test ./internal/aliyun`，确认新功能缺失导致失败。
- [x] 实现固定阿里云域名、请求超时、响应大小限制和严格结果校验。
- [x] 执行同一测试，确认通过。

### Task 2: 模型与监控任务

**Files:** 修改 `backend/internal/model/filing.go`、`backend/internal/handler/wechat_filing.go`、`backend/cmd/server/main.go`；新建 `backend/internal/handler/aliyun_filing.go` 和对应测试。

**Interfaces:** 创建监控新增 provider、baOrderId；`POST /api/wechat-filing/:id/session` 接收 `{cookie}`；响应保持隐藏 credentials。新增模型字段 nodeId、title、progressInfo。

- [x] 写测试并确认失败：创建校验、平台隔离、加密保存、导入失败不覆盖原会话、后台查询、状态变化、暂停、失效、旧记录默认值。
- [x] 实现会话导入和阿里云任务分支，复用通知队列与锁。
- [x] 运行后端测试，验证微信、备份和阿里云行为。

### Task 3: 备案页面

**Files:** 修改 `frontend/src/lib/api.ts`、`frontend/src/pages/WechatFilingPage.tsx`。

**Interfaces:** 使用新增原始字段展示平台、订单和当前审核节点；阿里云提供会话导入窗口，微信保留扫码。

- [x] 增加平台选择、订单号、导入步骤和会话更新入口。
- [x] 执行 `pnpm typecheck`、后端 `go test ./... -count=1`、`git diff --check`。
- [x] 更新计划验证记录，不提交代码，不自动完成业务节点。

## 验证记录

- 后端完整测试通过，包含会话、节点通知、失效、旧备份与迁移。
- 前端 pnpm typecheck 和 git diff --check 通过，未执行前端构建或界面自动测试。
- 本地后端已重启，健康检查通过，会话导入路由要求身份认证。
- 本轮未向运行数据库导入客户会话；已完成、退回等终态订单尚缺真实响应样本。
