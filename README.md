# 微聊 WeiLiao

一个仿微信的即时通讯应用，包含完整后端与 Web / Android / Windows 三端客户端。

后端刻意保持**极简依赖**（Express + socket.io + `node:sqlite`），不引入 ORM、不依赖原生编译模块，单机 `node server/index.js` 即可跑起来；前端为 Vite + React + Tailwind，同一套代码通过 Capacitor / Electron 复用到移动端与桌面端。

> 本项目用于学习即时通讯系统的完整实现：WebSocket 实时同步、WebRTC 音视频、分片上传、本地语音识别、多端打包与增量更新。

**下载安装包** → [Releases](https://github.com/s1van7/weiliao/releases/latest)：Android APK · Windows 安装包 · iOS Xcode 工程包

## 功能特性

### 账号与会话

| 功能 | 说明 |
|---|---|
| 注册 / 登录 | 用户名或手机号登录，JWT 鉴权，可选邀请码注册 |
| 个人资料 | 昵称、头像色、签名、性别、地区 |
| 用户名修改 | 微聊号一年仅可修改一次（服务端 365 天冷却强校验） |
| 密码修改 | 旧密码校验 + 强度校核 |

### 通讯录与好友

| 功能 | 说明 |
|---|---|
| A-Z 分组 | 按拼音首字母分组，右侧字母索引条跳转，生僻字归 `#` |
| 星标朋友 | 通讯录置顶独立分组，可随时开关 |
| 好友备注 | 备注名 + 备注手机号 |
| 朋友权限 | 朋友圈 / 仅聊天 / 加入黑名单 |
| 好友信息 | 添加日期、共同群聊、名片推送、二维码 |
| 新的朋友 | 申请列表，展示添加日期 |

### 消息与聊天

| 功能 | 说明 |
|---|---|
| 消息类型 | 文本、表情、图片、视频、语音、文件、名片、合并转发 |
| 实时同步 | socket.io 双向推送，多端消息一致 |
| 语音消息 | 录制波形动画、点击播放、**语音转文字**（本地 whisper.cpp） |
| 转发 | 逐条转发、多选合并转发（合并消息展开可看详情） |
| 群聊 | 建群（面对面数字码 / 从已有群建群 / 邀请入群）、群公告、@提醒、群权限、群二维码与链接邀请 |
| 会话管理 | 置顶、消息免打扰、隐藏、标记未读、清空聊天记录、删除会话 |
| 搜索 | 首页全局聊天记录搜索、会话内搜索、聊天记录只读查看 |
| 草稿与已读 | 会话草稿、未读计数、进入即已读 |

### 其他

| 功能 | 说明 |
|---|---|
| 朋友圈 | 发布图文 / 视频，点赞与评论 |
| 音视频通话 | WebRTC 点对点 + coturn TURN 中继兜底，支持多人会议 |
| 收藏 | 消息收藏与查看 |
| 表情包 | 表情商店、我的表情管理 |
| 扫一扫 | 扫码加好友 / 进群 |
| 面对面 | 相同数字配对建群、面对面传文件 |
| 文件传输 | 5MB 分片、秒传、断点续传，单文件上限 2GB |
| 检查更新 | 三端设置页内检查版本并下载安装包（Android 走原生 DownloadManager 直装） |

## 技术栈

**后端**：Node.js ≥ 24（ESM）· Express 4 · `node:sqlite`（内置 DatabaseSync，无原生模块）· socket.io 4 · multer · JWT · bcryptjs

**前端**：Vite 5 · React 18 · Tailwind CSS 3 · zustand · hash 路由

**客户端**：Capacitor 6（Android / iOS）· Electron（Windows）

**可选服务**：whisper.cpp server（语音转文字）· coturn（TURN 中继）

## 项目结构

```
weiliao/
├── server/                 # 后端
│   ├── index.js            # 入口：静态托管 + 路由挂载
│   ├── db.js               # SQLite 连接与幂等列迁移
│   ├── schema.sql          # 全量建表语句
│   ├── auth.js             # JWT 签发 / 校验中间件
│   ├── socket.js           # socket.io 事件注册
│   ├── lib/                # 业务库（消息、会话、权限、RTC、ASR…）
│   └── routes/             # REST 路由
├── web/                    # 前端
│   ├── src/
│   │   ├── pages/          # 页面
│   │   ├── components/     # 组件
│   │   ├── store/          # zustand 状态
│   │   └── lib/            # 工具（拼音、分片上传、更新检查…）
│   └── vite.config.js      # 构建配置（注入版本号）
├── packaging/              # 三端打包
│   ├── main.js             # Electron 主进程
│   ├── preload.js          # contextBridge 能力暴露
│   ├── capacitor.config.json
│   ├── AndroidManifest.xml
│   └── Info.plist
└── deploy/                 # 部署样例
    ├── nginx-wechat-lite.conf
    ├── wechat-lite.service
    ├── wechat-lite.env.example
    ├── coturn/turnserver.conf
    ├── systemd/whisper-asr.service
    └── whisper/setup-whisper.sh
```

## 快速开始

### 前置要求

- Node.js **≥ 24**（后端使用内置 `node:sqlite`，低于 24 会启动失败）
- npm

### 本地开发

```bash
# 1) 后端
npm install
npm run dev            # http://127.0.0.1:3000（--watch 自动重启）

# 2) 前端（另开一个终端）
cd web
npm install
npm run dev            # http://127.0.0.1:5173，已配置 /api 与 /socket.io 代理
```

默认数据库为 `data/app.db`（首次启动自动建库建表）。注册账号即可使用；如需关闭开放注册，配置 `INVITE_CODE`。

### 生产构建（同源部署）

```bash
cd web && npm run build          # 产物在 web/dist
cd .. && npm start               # 后端直接托管 web/dist
```

若前端与后端不同源（三端打包场景），构建时指定后端地址：

```bash
cd web
VITE_SERVER_URL=https://your-domain.com npm run build
```

## 环境变量

复制 `deploy/wechat-lite.env.example` 后按需填写（也可直接用进程环境变量）：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `3000` | 后端监听端口 |
| `INVITE_CODE` | 空 | 注册邀请码；为空表示开放注册 |
| `TURN_SECRET` | 空 | coturn 的 `static-auth-secret`，为空则前端只拿到 STUN |
| `TURN_HOST` | 空 | TURN 服务公网地址（UDP 无法走 CDN，需直连） |
| `TURN_PORT` | `3478` | TURN 端口 |
| `WHISPER_ENDPOINT` | `http://127.0.0.1:9000` | whisper.cpp server 地址，为空则语音转文字返回 503 |
| `WHISPER_TIMEOUT_MS` | `60000` | 转写超时 |
| `UPLOAD_FILE_MAX_BYTES` | `2147483648` | 单文件上传上限（2GB） |

> 注意：`TURN_SECRET`、`INVITE_CODE` 属于密钥，请勿提交到仓库。仓库中的 `deploy/wechat-lite.env.example` 只含占位值。

## 生产部署

`deploy/` 目录提供了可直接改造的配置样例：

1. **systemd**：`deploy/wechat-lite.service`（`WorkingDirectory` 指向项目根，`EnvironmentFile` 指向你的 env 文件）
2. **nginx**：`deploy/nginx-wechat-lite.conf`（静态托管 `web/dist`，反代 `/api`、`/socket.io`、`/uploads`）
3. **TURN**：`deploy/coturn/turnserver.conf`（HMAC 临时凭证，需与后端 `TURN_SECRET` 一致）
4. **语音转文字**：`deploy/whisper/setup-whisper.sh` + `deploy/systemd/whisper-asr.service`

详细步骤见 [`deploy/README-deploy.md`](deploy/README-deploy.md)。

> TURN 的 UDP 端口无法经 Cloudflare 等 CDN 转发，必须为服务器配置直连的 A 记录并放行安全组端口。

## 三端打包

```bash
# 1) 构建前端（指定远端后端地址）
cd web && VITE_SERVER_URL=https://your-domain.com npm run build

# 2) Android（Capacitor）
#    将 web/dist 拷入 Capacitor 工程的 www，再同步并编译
npx cap copy android
cd android && ./gradlew assembleRelease

# 3) Windows（Electron）
#    将 web/dist 拷入 Electron 工程后
npm run dist        # 输出 NSIS 安装包到 release/
```

应用内「检查更新」依赖后端 `GET /api/app/latest`，它按 `data/downloads/` 下的安装包文件名自动生成下载地址，发版只需上传新包并升版本号。

## 数据库

- 引擎：SQLite（Node 内置 `node:sqlite`），单文件 `data/app.db`
- 建表：`server/schema.sql`（幂等 `CREATE TABLE IF NOT EXISTS`）
- 迁移：`server/db.js` 的 `COLUMN_MIGRATIONS` 列表，启动时逐列比对 `PRAGMA table_info` 自动补齐，无需迁移脚本

新增字段只需往 `COLUMN_MIGRATIONS` 追加一条 `[表名, 列名, 定义]`，重启即生效。

## 已知限制

- 语音转文字依赖自建 whisper.cpp 服务，未配置时该功能不可用（返回 503）
- 应用内通知为页内提示音 + 未读红点，未接入 APNs / FCM 系统推送
- iOS 端提供 Xcode 工程包，需自行在 macOS 上编译签名，不提供现成 ipa
- 单机 SQLite 架构，未做水平扩展与读写分离

## License

MIT
