# Novel Reader

基于 Cloudflare Pages + Workers + D1 + KV 的在线小说阅读器，**爱下电子书 (ixdzs8.com)** 专用壳。

---

## 特性

- 📚 **爱下电子书** 全功能壳 — 热门排行、日榜、月榜、完结榜、最新更新、分类浏览
- 📖 **双模式阅读器** — 滚动模式与翻页模式，键盘/手势支持
- 🔍 **实时搜索** — SSE 流式返回，输入即搜
- 📋 **章节分页** — 每 100 章一页，自动定位到阅读进度所在页，当前章节高亮
- 📑 **章节目录弹窗** — 阅读器中查看全部章节，自动居中当前章节
- ⭐ **书架与阅读历史** — D1 存储，跨设备同步（需登录）
- 🔐 **多用户与管理员后台** — 管理员可创建、管理用户账号
- ⚡ **离线缓存** — Service Worker 预缓存章节，支持离线阅读
- 🌙 **深色主题** — 跟随系统或手动切换
- 🛡️ **防护** — 速率限制、CORS 域限制、JWT 认证
- 🔄 **域名自动切换** — 当主域名不可用时自动尝试备用镜像

---

## 架构

```
浏览器 (Cloudflare Pages, React SPA)
  └─ /api/* → Cloudflare Worker (Hono)
       ├── /auth/*       JWT 认证与用户管理
       ├── /homepage     首页（排行榜/分类/完结/最新）
       ├── /search       搜索（SSE 流式 + 普通）
       ├── /books/*      小说详情与章节（从 ixdzs8 抓取适配）
       ├── /bookshelf    书架（D1）
       ├── /history      阅读历史（D1）
       └── /admin/*      管理端功能
```

---

## 项目结构

```
frontend/            — React + Vite + TailwindCSS（SPA）
├── src/pages/       页面
│   ├── HomePage        首页（排行/分类/分页）
│   ├── BookDetailPage  书籍详情（章节分页/进度定位）
│   ├── ReaderPage      阅读器（滚动/翻页/TOC）
│   ├── BookshelfPage   书架
│   ├── HistoryPage     阅读历史
│   ├── DownloadsPage   离线缓存管理
│   └── LoginPage       登录
├── src/components/  可复用 UI
├── src/hooks/       自定义 Hooks
└── src/lib/         API 客户端 / Cache 工具

workers/             — Cloudflare Worker (Hono)
├── src/
│   ├── api/index.ts    路由与控制器
│   ├── sites/
│   │   ├── registry.ts 书源注册（ixdzs8 专用）
│   │   └── ixdzs8.ts   爱下电子书适配器
│   ├── auth/           JWT + PBKDF2 密码
│   ├── db/             D1 Schema
│   └── middleware/     速率限制
└── wrangler.toml

.github/workflows/   — CI/CD（自动部署 Pages + Workers）
```

---

## 页面功能

| 页面 | 功能 |
|------|------|
| **首页** | 热门/日榜/月榜/完结/最新 切换 + 10 个分类标签 + 全部支持分页 |
| **书籍详情** | 封面/简介/目录（每 100 章分页）、阅读进度自动定位 + 高亮、加入书架、离线缓存 |
| **阅读器** | 滚动/翻页双模式、字号调节、目录弹窗（自动居中）、左右键/手势翻页、预加载 |
| **书架** | 阅读进度同步、继续阅读 |
| **搜索** | SSE 流式实时搜索、URL 直达解析 |

---

## 本地开发

```bash
pnpm install

# 前端（终端 1）
cd frontend && pnpm dev        # → http://localhost:5173

# Worker（终端 2）
cd workers && pnpm dev         # → http://localhost:8787
```

首次运行会自动初始化一个默认管理员账号（仅限本地开发）：

- 用户名：`admin`
- 密码：`admin123`

---

## 部署

推送 `main` 分支自动触发 GitHub Actions 部署到 Cloudflare Pages + Workers。

需要配置的 Secrets：

| Secret | 说明 |
|--------|------|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API Token（Pages + Workers + D1 权限） |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 账号 ID |
| `D1_DATABASE_ID` | D1 数据库 ID |
| `KV_NAMESPACE_ID` | KV 命名空间 ID（章节/搜索缓存） |
| `JWT_SECRET` | 随机密钥（`openssl rand -hex 32`） |

---

## 安全提示

- 部署后请立即修改默认管理员密码
- API Token 设置最小权限范围
- 建议通过组织/团队管理访问

---

## 许可

AGPL-3.0
