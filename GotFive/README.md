# Got Five 在线版

这是一个无运行依赖的中文网页在线版 Got Five。服务端使用 Node.js 内置模块，前端使用原生 HTML/CSS/JavaScript，适合部署在云服务器或局域网内一起玩。

## 运行

```bash
node server.js
```

默认监听 `0.0.0.0:3000`。需要修改端口时：

```bash
PORT=8080 node server.js
```

Windows PowerShell：

```powershell
$env:PORT=8080; node server.js
```

## 玩法实现

- 支持 2-4 人房间，无账号。
- 每名玩家获得 5 张隐藏牌，每种颜色各 1 张，按数字升序显示。
- 公共区开局每种颜色翻开 1 张。
- 回合流程为先翻开一个颜色牌堆，再用一张公共明牌获取线索。
- 线索支持“分类”和“比较”。
- 玩家可随时宣告 Got Five，猜对获胜，猜错淘汰。
- 服务器负责隐藏自己的数字和点数，其他玩家的牌对你可见。
- 前端提供自动候选推理板和手动标记。

## 部署

把整个目录放到服务器，安装 Node.js 后运行 `node server.js`。局域网玩家访问服务器 IP 加端口即可，例如：

```text
http://192.168.1.20:3000/
```

如使用 Nginx 反向代理，需要保留 Server-Sent Events 的长连接能力，建议关闭该路径的响应缓冲。
