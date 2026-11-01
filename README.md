# VETO 房间：无畏契约在线 BP

一方建房，把 6 位房间号发给对手。对方在首页输入房间号进来，选好队伍坐下。双方实时轮流禁图、选图、选边。

- 赛制：BO1、BO3、BO5，地图池可自选（至少 2、3、5 张图）
- 先手：**摇骰子**（默认，双方各摇一颗，点数大的先手，平局重摇）、随机抛硬币，或指定 A 队、B 队
- 每步限时 20 到 90 秒，也可以不限时。超时后服务器随机替这一方选择（摇骰子超时由系统代摇）
- 顶部进度条实时显示每一步禁选了哪张图
- 适配手机：回合提示和倒计时固定在顶部，双击确认时页面不会被放大
- 座位：进房后在空位填上自己的战队名入座（建房时不用填队名），每个位置只能一个人坐，刷新或断线后还是原座位；没坐下的人就是观战
- 房主可以把占错位置的人移出座位
- 房主可以强制开始、**撤销上一步**、重置房间
- 完成后可**生成结果图**（带地图图片、队名和蓝猫 logo，手机长按保存）或复制文字结果
- **直播画面**：`/obs/房间号` 是给 OBS「浏览器」来源用的透明叠加层（1920×1080），实时显示双方禁选、选边、当前回合和倒计时；加 `?pos=top` 放到画面顶部

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

## Render 上保存房间（必做）

Render 免费版每次部署、重启或休眠唤醒，内存和本地文件都会清空，所以要接一个免费的 Key Value：

1. Render 后台 **+ New → Key Value**，Name 随便填（如 `vbp-kv`），Region 选和网站一样的 **Singapore**，Instance Type 选 **Free**，创建
2. 创建好后，在它的页面复制 **Internal Key Value URL**（`redis://` 开头）
3. 打开网站服务 `valorant-bp` → **Environment** → 添加变量 `REDIS_URL`，值粘贴刚才的地址 → 保存，Render 会自动重新部署
4. 部署日志里看到 `[persist] 使用 Redis 保存房间` 就成功了

## 自定义

- **地图池、新地图、新特工**：改 `data.js`。`DEFAULT_POOL` 是建房时默认勾选的地图
- **BP 顺序规则**：在 `server.js` 的 `buildSteps()` 里
- **房间保存**：每次操作都会保存。设置了环境变量 `REDIS_URL` 就存到 Redis（推荐，Render 上用免费的 Key Value）；没设置就存到 `data/rooms.json`。服务器重启、重新部署、休眠唤醒后房间自动恢复，大家的页面会自动重连。房间 12 小时没人使用会自动清理

## 说明

本项目是非官方粉丝工具，与 Riot Games 无关。地图图片和特工头像在浏览器端从 valorant-api.com 加载，加载失败时自动显示文字卡片，不影响使用。
