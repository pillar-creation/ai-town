# 本机运行（Windows + Docker + Ollama）

默认走自托管 Convex 和本机 Ollama，不需要 Convex 云账号或 OpenAI。

## 前置

- **WSL2**（Docker Desktop 依赖它）。管理员 PowerShell：`wsl --install -d Ubuntu`，装完重启。
- Node 18+（本机已验证 Node 20 可用）
- Docker Desktop 已启动（`docker info` 能通）
- [Ollama for Windows](https://ollama.com/download)（安装包约 1–2GB，用浏览器下更快）

```powershell
ollama pull qwen2.5
ollama pull mxbai-embed-large
npm install
```

## 端口

`docker-compose.yml` 里 backend 不要再映射 `11434`，否则会和宿主机 Ollama 冲突。保留：

- `3210` Convex
- `3211` Convex HTTP API
- `5173` 前端
- `6791` Dashboard
- `8791` 人机聊天服务（直连 Ollama，不经 Convex；勿用 8787，本机常被其它助手占用）
- 宿主机 `11434` 只给 Ollama

## 启动

Docker Hub 拉 `ubuntu` 前端镜像经常超时。本机推荐只起 Convex，前端用本机 Vite：

```powershell
docker compose up -d backend dashboard
docker compose exec backend ./generate_admin_key.sh
```

把输出的 admin key 写入项目根目录 `.env.local`（不要提交）：

```
CONVEX_SELF_HOSTED_ADMIN_KEY="<admin-key>"
CONVEX_SELF_HOSTED_URL="http://127.0.0.1:3210"
VITE_CONVEX_URL="http://127.0.0.1:3210"
```

然后：

```powershell
npx convex env set OLLAMA_HOST http://host.docker.internal:11434
npx convex env set OLLAMA_MODEL qwen2.5
npm run predev
npm run dev
```

`npm run dev` 会并行跑 Convex 同步、本机 Vite，以及人机聊天服务（`dev:chat` → `:8791`）。

人机聊天**不再走 Convex LLM**：前端点「聊天」立刻开对话框，发消息经 Vite 代理 `/chat-api` 直连聊天服务调 Ollama；会话/消息只异步写回 Convex 做历史。NPC↔NPC 模拟仍用 Convex。

也可单独启动聊天服务：

```powershell
npm run dev:chat
```

浏览器打开：

**http://localhost:5173/ai-town**

（Vite `base` 是 `/ai-town`，不要只开根路径。）

Dashboard：http://localhost:6791（用 admin key 登录）

## 自检

```powershell
docker compose exec backend curl http://host.docker.internal:11434
```

应看到 `Ollama is running`。

### 避免 chat/embedding 换模卡顿（推荐）

NPC 每条消息会先打 `mxbai-embed-large` 再打 `qwen2.5`。Ollama 默认常只留 1 个模型在显存里，就会反复换模（每次约 1–3s）。RTX 16GB 足够双模常驻：

```powershell
# 用户环境变量（改完后重启「Ollama」托盘应用）
[System.Environment]::SetEnvironmentVariable('OLLAMA_MAX_LOADED_MODELS', '2', 'User')
[System.Environment]::SetEnvironmentVariable('OLLAMA_KEEP_ALIVE', '-1', 'User')

# 预热双模（keep_alive=-1 = Forever）
ollama run qwen2.5 "ping"
# 另开一个请求加载 embedding（或等第一次对话自动加载）
curl http://127.0.0.1:11434/api/embeddings -d '{"model":"mxbai-embed-large","prompt":"ping","keep_alive":-1}'
ollama ps   # 应同时看到 qwen2.5 与 mxbai-embed-large，UNTIL=Forever
```

项目里的 Ollama 请求也会带 `keep_alive: -1`，避免空闲后被卸掉。

页面空闲约 5 分钟会暂停模拟，刷新页面或点 UI 里的 unfreeze。

对话慢或显存不够时：

```powershell
npx convex env set OLLAMA_MODEL qwen2.5:3b
npx convex env set NUM_MEMORIES_TO_SEARCH 1
```

## 常用调试

```powershell
npx convex run testing:stop
npx convex run testing:resume
npx convex run testing:kick
npx convex run testing:archive
npx convex run init
```

清空重来（会删数据）：`npx convex run testing:wipeAllTables`，再 `npm run predev`。
