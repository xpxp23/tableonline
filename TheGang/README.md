# 纸牌帮在线版

一个低依赖的《纸牌帮 / The Gang》网页在线版。服务端使用 Node.js 内置 HTTP 模块和原生 WebSocket 握手，不需要安装 npm 依赖，适合部署在云服务器或局域网内多人游玩。

## 运行

```powershell
npm start
```

默认地址：

```text
http://127.0.0.1:3000/
```

局域网游玩时，把服务器机器的局域网 IP 和端口发给其他玩家即可。

可用环境变量：

```powershell
$env:PORT=3000
npm start
```

如果 3000 端口已被占用，可以改用其他端口：

```powershell
$env:PORT=3105
npm start
```

Linux/macOS：

```bash
PORT=3000 npm start
```

## 局域网或云服务器部署

1. 确认服务器已安装 Node.js 18 或更高版本。
2. 把本目录上传到服务器。
3. 执行 `npm start`。
4. 打开防火墙端口，例如 `3000`。
5. 玩家访问 `http://服务器IP:3000/`，输入同一个房间号加入。

反向代理时需要保留 WebSocket 升级头；Nginx 常用配置：

```nginx
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
}
```

## 说明

- 支持 3-6 人房间，无账号系统，玩家输入昵称和房间号即可。
- 包含基础、进阶、专业、大盗模式。
- 包含 10 张挑战牌和 10 张专家牌的网页化流程。
- 核心规则由服务端判定：发牌、牌型强弱、排名芯片、阶段推进、特殊牌、成功/失败条件。
- 前端只显示当前玩家自己的手牌；公共牌、公开信息和结算结果所有人可见。

## 验证

```powershell
node --check server.js
node --check public/app.js
$env:PORT=3110; $env:START_SERVER='1'; node scripts/smoke-test.js
```
