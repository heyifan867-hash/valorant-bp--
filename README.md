# VETO 房间：无畏契约在线 BP

建一个房间，把队伍链接发给两队队长。双方实时轮流禁图、选图、选边，可选禁用特工。

- 赛制：BO1、BO3、BO5，地图池可自选（至少 2、3、5 张图）
- 先手：**摇骰子**（默认，双方各摇一颗，点数大的先手，平局重摇）、随机抛硬币，或指定 A 队、B 队
- 每步限时 20 到 90 秒，也可以不限时。超时后服务器随机替这一方选择（摇骰子超时由系统代摇）
- 顶部进度条实时显示每一步禁选了哪张图
- 适配手机：回合提示和倒计时固定在顶部，双击确认时页面不会被放大
- 禁用特工：每队 0 到 4 个，双方轮流
- 权限：每个队伍链接带独立密钥，只有拿到链接的人能操作；观战链接只能看
- 房主可以强制开始、重置房间
- 完成后可一键复制结果，直接发群

## 本地运行

需要 Node.js 18 或更高版本。

```bash
npm install
npm start
```

然后打开 http://localhost:3000

## 部署到服务器（推荐）

### 方式一：云服务器（国内玩家首选）

买一台轻量服务器，建议选香港节点。香港节点不需要备案，国内访问也快。

如果选内地节点并绑定域名，需要先做 ICP 备案，否则 80 和 443 端口无法访问。

```bash
# 在服务器上（Ubuntu 示例）
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
git clone <你的仓库地址> valorant-bp && cd valorant-bp
npm install --omit=dev
sudo npm i -g pm2
PORT=3000 pm2 start server.js --name valorant-bp
pm2 save && pm2 startup
```

记得在云服务器控制台的防火墙或安全组里，放行 3000 端口。之后访问 `http://服务器IP:3000` 即可。

想用域名加 HTTPS，可以在前面加一层 Nginx 或 Caddy 反向代理。WebSocket 路径是 `/ws`，反代时要支持协议升级。Caddy 最简单，写一行就行：

```
bp.你的域名.com {
    reverse_proxy localhost:3000
}
```

### 方式二：Docker

```bash
docker build -t valorant-bp .
docker run -d --restart=always -p 3000:3000 --name valorant-bp valorant-bp
```

### 方式三：海外免费平台（Render、Railway、Fly.io）

把代码推到 GitHub，在平台上新建 Web Service，构建命令填 `npm install`，启动命令填 `npm start`。

缺点：国内访问可能慢或不稳定；Render 免费版闲置后会休眠，第一次打开要等几十秒。

## 自定义

- **地图池、新地图、新特工**：改 `data.js`。`DEFAULT_POOL` 是建房时默认勾选的地图
- **BP 顺序规则**：在 `server.js` 的 `buildSteps()` 里
- **房间保存在内存里**：服务器重启后房间会清空。房间 12 小时没人使用也会自动清理

## 说明

本项目是非官方粉丝工具，与 Riot Games 无关。地图图片和特工头像在浏览器端从 valorant-api.com 加载，加载失败时自动显示文字卡片，不影响使用。
