# Novel Reader

多源在线小说阅读器，基于 Cloudflare Pages + Workers + D1 + KV。

## 架构

```
浏览器 → Cloudflare Pages (SPA)
  └─ /api/* → Worker (Hono)
       ├── /auth/*      JWT 认证
       ├── /comics/*    小说详情 + 章节
       ├── /bookshelf   书架 (D1)
       ├── /history     阅读历史 (D1)
       └── /admin/*     用户管理
```

## 书源

| 源 |
|---|
| biquge345 |
| biquge5 |
| ixdzs8 |
| fsshu |

## 项目结构

```
├── frontend/          React SPA (Vite + TailwindCSS + React Router)
│   └── src/
│       ├── pages/     HomePage, ReaderPage, BookDetailPage, ...
│       ├── components/ Navbar, Modal, BookCard, UserMenu
│       ├── hooks/     useAuth, useSearch
│       └── lib/       API 客户端
├── workers/           Cloudflare Worker (Hono)
│   └── src/
│       ├── index.ts   入口 (CORS + DB 初始化)
│       ├── api/       API 路由
│       ├── sites/     小说源适配器 (6 个)
│       ├── auth/      JWT + 密码哈希
│       ├── db/        D1 Schema
│       ├── middleware/ 速率限制
│       └── utils/     HTTP / GBK 解码 / 章节分割
└── .github/workflows/ CI/CD 自动部署
```

## API

### 公开

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/sources` | 源列表 |
| GET | `/api/homepage` | 首页推荐 |
| POST | `/api/search` | 聚合搜索 |
| POST | `/api/search/stream` | SSE 流式搜索 |
| GET | `/api/books/:site/:bookId` | 小说详情 |
| GET | `/api/books/:site/:bookId/:chapterId` | 章节内容 |
| POST | `/api/auth/login` | 登录 |

### 需认证

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/auth/me` | 验证 token |
| PUT | `/api/auth/change-password` | 修改密码 |
| GET/POST | `/api/bookshelf` | 书架 |
| DELETE | `/api/bookshelf/:site/:bookId` | 移出书架 |
| GET/POST | `/api/history` | 阅读历史 |
| DELETE | `/api/history` | 清空历史 |
| PUT | `/api/progress/:site/:bookId` | 阅读进度 |

## 功能

- 6 源聚合搜索（SSE 流式 + URL 直达）
- 双模式阅读器（滚动 + 翻页，键盘方向键 + 手势翻页）
- 个人书架 + 阅读历史（D1 跨设备同步）
- 多用户（管理员创建/管理账号）
- 反追踪（UA 轮换、CORS 域名限制）
- 速率限制（搜索/首页 60次/分钟）
- 深色主题 + PWA 可安装
- 离线缓存

## 数据库

D1 自动建表：

| 表 | 说明 |
|---|---|
| `users` | 用户（PBKDF2 密码哈希） |
| `bookshelf` | 书架 |
| `history` | 阅读历史 |

## 缓存

| 层级 | TTL |
|---|---|
| KV 搜索结果 | 5 分钟 |
| KV 小说详情 | 10 分钟 |
| KV 章节内容 | 30 分钟 |

## 本地开发

```bash
pnpm install
cd frontend && pnpm dev   # http://localhost:5173
cd workers && pnpm dev    # http://localhost:8787
```

首次启动自动创建管理员 `admin / admin123`，**部署后请立即修改密码**。

## 部署

推 `main` 自动部署。需配置 GitHub Secrets：

| Secret | 说明 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Workers + Pages + D1 权限 |
| `CLOUDFLARE_ACCOUNT_ID` | 账号 ID |
| `D1_DATABASE_ID` | `wrangler d1 create novel-reader-db` |
| `KV_NAMESPACE_ID` | `wrangler kv:namespace create NOVEL_CACHE` |
| `JWT_SECRET` | `openssl rand -hex 32` |

## License

AGPL-3.0
