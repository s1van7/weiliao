# 微聊 · 部署运维说明

服务器：`203.0.113.10`（Ubuntu 24.04 / Node 24.22 / nginx）
部署目录：`/opt/wechat-lite`
进程管理：systemd 服务 `wechat-lite`，监听 `127.0.0.1:3000`，nginx 反代 `80` 端口。

## 目录结构

```
/opt/wechat-lite/
├── server/            后端（Express + socket.io + node:sqlite）
├── web/dist/          前端构建产物（由 Express 托管）
├── data/app.db        SQLite 数据库（WAL 模式）
├── data/uploads/      聊天图片
├── data/.secret       JWT 签名密钥（自动生成，勿删，删了所有人要重新登录）
└── package.json
```

## 常用命令

```bash
systemctl status wechat-lite     # 查看状态
systemctl restart wechat-lite    # 重启（改代码后）
journalctl -u wechat-lite -f     # 实时日志
journalctl -u wechat-lite -n 200 # 最近 200 行

curl http://127.0.0.1:3000/api/health   # 健康检查
nginx -t && systemctl reload nginx      # 改 nginx 后
```

## 备份

```bash
# 数据（数据库 + 图片）
tar czf /root/weiliao-backup-$(date +%F).tar.gz /opt/wechat-lite/data
```

SQLite 处于 WAL 模式，热备份建议用：
```bash
sqlite3 /opt/wechat-lite/data/app.db ".backup '/root/app-$(date +%F).db'"
```

## 升级（本地改完代码后）

```bash
# 本地
cd web && npm run build                 # 产物进 web/dist
tar czf update.tar.gz server web/dist package.json
scp update.tar.gz root@203.0.113.10:/tmp/

# 服务器
cd /opt/wechat-lite && tar xzf /tmp/update.tar.gz && systemctl restart wechat-lite
```

## nginx 配置位置

`/etc/nginx/conf.d/wechat-lite.conf`（只监听 `server_name 203.0.113.10`，不影响机器上已有的 8443 业务）

要点：
- `/socket.io/` 必须保留 `Upgrade` / `Connection` 头，否则实时消息会退化成轮询甚至连不上
- `/uploads/` 直接 alias 到磁盘，绕开 Node
- `client_max_body_size 20m`（图片上限 10MB）

## 安全建议（按需）

1. **换 HTTPS**：现在 443 被其他服务占用，只能走 `http://IP`。若后续腾出端口/域名，用 certbot 签证书后把前端 `VITE_SERVER_URL` 与 nginx 一起切到 https，同时可移除 Android 的 `usesCleartextTraffic` 与 iOS 的 `NSAllowsArbitraryLoads`。
2. **改 JWT 密钥**：`/opt/wechat-lite/data/.secret` 删掉后重启会自动生成新密钥（所有人需重新登录），或设置环境变量 `JWT_SECRET`。
3. **关闭公开注册**：如需邀请制，在 `server/routes/auth.js` 的注册接口加白名单校验。
4. **限制上传目录执行权限**：`chmod -R 755 /opt/wechat-lite/data/uploads`（nginx 已加 `X-Content-Type-Options: nosniff`）。
5. **定时备份**：`crontab -e` 加 `0 3 * * * tar czf /root/weiliao-$(date +\%F).tar.gz /opt/wechat-lite/data`。
