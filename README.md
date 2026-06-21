# Novel Reader

多源在线小说阅读器，基于 Cloudflare Pages + Workers + D1 + KV，面向轻量、快速、可部署的个人/小型团队阅读服务。

主要特性

- 聚合多个免费小说源，支持按源直达与并发搜索（SSE 流式返回）。
- 双模式阅读器：滚动与翻页（键盘、手势支持）。
- 书架与阅读历史：使用 D1 存储，可跨设备同步用户数据。
- 多用户与管理员后台：管理员可创建、管理用户账号。
- 缓存与防护：KV 缓存、UA 轮换、CORS 域限制与速率限制。
- PWA 支持与深色主题，提供离线缓存体验。

架构概览

浏览器 (Cloudflare Pages, React SPA)
  └─ /api/* → Cloudflare Worker (Hono)
       ├── /auth/*      JWT 认证与用户管理
       ├── /books/*     小说详情与章节（跨源抓取与适配）
       ├── /bookshelf   书架（D1）
       ├── /history     阅读历史（D1）
       └── /admin/*     管理端功能

项目结构（简要）

- frontend/  — React + Vite + TailwindCSS（SPA）
  - src/pages/      页面：Home、Reader、BookDetail、Search...
  - src/components/ 可复用 UI 组件
  - src/hooks/      useAuth、useSearch 等
  - src/lib/        API 客户端与工具

- workers/   — Cloudflare Worker (Hono)
  - src/api/         路由与控制器
  - src/sites/       各小说源适配器（site driver）
  - src/db/          D1 Schema 与 DB helper
  - src/auth/        JWT、密码哈希（PBKDF2）
  - src/middleware/  速率限制、CORS、缓存策略
  - src/utils/       HTTP、编码（GBK）、章节分割等

- .github/workflows/ — CI/CD（自动部署到 Pages / Workers）

支持的书源（示例）

- biquge345
- biquge5
- ixdzs8
- fsshu

API 快速参考

公开接口

- GET  /api/sources                       — 获取源列表
- GET  /api/homepage                      — 首页推荐数据
- POST /api/search                        — 聚合搜索（可并发多个源）
- POST /api/search/stream                 — SSE 流式搜索
- GET  /api/books/:site/:bookId           — 获取小说详情
- GET  /api/books/:site/:bookId/:chapterId — 获取章节内容
- POST /api/auth/login                    — 用户登录（返回 JWT）

需要认证

- GET    /api/auth/me                     — 验证并返回当前用户信息
- PUT    /api/auth/change-password        — 修改密码
- GET/POST /api/bookshelf                 — 获取/更新书架
- DELETE /api/bookshelf/:site/:bookId     — 从书架移除
- GET/POST /api/history                   — 阅读历史记录
- DELETE /api/history                     — 清空历史
- PUT    /api/progress/:site/:bookId      — 更新阅读进度

缓存与 TTL（默认）

- KV 搜索结果   — 5 分钟
- KV 小说详情   — 10 分钟
- KV 章节内容   — 30 分钟

数据库

使用 Cloudflare D1，自动建表示例：

- users      — 用户（密码使用 PBKDF2 哈希）
- bookshelf  — 用户书架
- history    — 阅读历史

本地开发

1. 安装依赖并运行前端和 Worker：

```bash
pnpm install
# 在两个终端分别运行：
cd frontend && pnpm dev   # 前端： http://localhost:5173
cd workers && pnpm dev    # Worker 本地： http://localhost:8787
```

2. 第一次运行会初始化一个默认管理员账号（仅用于本地开发）：

- 用户名：`admin`  密码：`admin123`

部署说明

推送到默认分支（如 main）会触发 GitHub Actions 自动部署到 Cloudflare Pages/Workers。
需要在仓库 Secrets 中配置：

- CLOUDFLARE_API_TOKEN — 用于 Pages & Workers & D1 的权限（建议设置最小权限）
- CLOUDFLARE_ACCOUNT_ID — Cloudflare 账号 ID
- D1_DATABASE_ID        — D1 实例 ID
- KV_NAMESPACE_ID       — KV 命名空间 ID（小说缓存）
- JWT_SECRET            — 随机密钥（openssl rand -hex 32）

安全提示：

- 本地/初次部署默认管理员请尽快修改密码并删除示例账号。
- 请为 API Token 设置最小权限范围，并通过组织/团队管理访问。

贡献指南

欢迎 Issue 与 PR。请遵循以下基本流程：

1. 提交一个 Issue 描述问题或建议。
2. 新功能或修复请新建分支并提交 PR，CI 会运行测试与构建。
3. 代码风格：TypeScript + ESLint + Prettier（项目配置参见 .eslintrc / .prettierrc）。

许可

本项目采用 AGPL-3.0 许可证。

------

如果你希望我同时把 README 更新到仓库（添加英文版、更多部署示例、或把 README 分成 README.md + CONTRIBUTING.md），告诉我你的偏好，我可以在本仓库为你提交这些更改。