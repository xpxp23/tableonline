# Table Online 在线桌游大厅 - 工作记忆

## 部署信息
- GitHub仓库: https://github.com/xpxp23/tableonline.git
- 服务器IP: 113.44.215.170
- 部署路径: /opt/tableonline/
- 进程管理: PM2 (开机自启)

## 端口映射
| 端口 | 项目 | 名称 |
|------|------|------|
| 58880 | ball | 肉鸽弹球自走棋 |
| 58881 | bombbuster | Bomb Buster 在线拆弹 |
| 58882 | CCBS-BKM | 璀璨宝石宝可梦版 |
| 58883 | flip7-online | 七连翻 Online |
| 58884 | GotFive | Got Five 在线版 |
| 58885 | Lovecraft Letter | 洛夫克拉夫特情书 |
| 58886 | RA | RA 太阳神 |
| 58887 | Rikka | 六华 Online |
| 58888 | portal | 在线桌游大厅导航页 |
| 58889 | TheGang | 纸牌帮在线版 |

## 导航页
- URL: http://113.44.215.170:58888/
- 赛博朋克风格，深色背景+霓虹光效+粒子动画
- 卡片式布局，每个游戏一张卡片

## 启动/重启
- 启动所有: `bash /opt/tableonline/start-all.sh`
- 查看状态: `pm2 list`
- 重启单个: `pm2 restart <name>`

## 技术栈
- 所有项目: Node.js server.js + static public/ (index.html, app.js, styles.css)
- 无额外npm依赖
- 端口通过 PORT 环境变量控制
