// 无畏契约 BP 房间服务器：静态网页 + REST 建房 + WebSocket 实时同步。
// 所有规则在服务端判定（轮到谁、能选什么、超时自动随机），客户端只负责显示和发请求。

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { MAPS, DEFAULT_POOL } = require('./data');
const { createStore } = require('./persist');

const PORT = Number(process.env.PORT) || 3000;
const ROOM_TTL_MS = 12 * 60 * 60 * 1000;   // 房间 12 小时无活动后清理
const MAX_ROOMS = 5000;
const CREATE_LIMIT_PER_HOUR = 60;          // 每个 IP 每小时最多建房数
const PUBLIC_DIR = path.join(__dirname, 'public');

const MAP_IDS = new Set(MAPS.map(m => m.id));
const FORMAT_PICKS = { bo1: 0, bo3: 2, bo5: 4 };

const rooms = new Map();
const store = createStore({ ttlMs: ROOM_TTL_MS });
store.bind?.(() => [...rooms.values()]);
const DEFAULT_NAMES = { A: 'A 方', B: 'B 方' };

// ---------- 工具 ----------
const randId = (bytes) => crypto.randomBytes(bytes).toString('base64url');
const other = (t) => (t === 'A' ? 'B' : 'A');
const pickRandom = (arr) => arr[crypto.randomInt(arr.length)];
const cleanName = (s, fallback) => {
  const v = String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 24);
  return v || fallback;
};

// ---------- BP 流程生成 ----------
// 地图阶段：先 2 禁（BO1 则全部是禁），然后选图（每选一张，对手选边），剩余再禁，最后一张为决胜图。
// 地图操作 A/B 轮流，先手由 first 决定。决胜图由“最后一次禁图方的对手”选边。
function buildSteps(cfg) {
  const n = cfg.pool.length;
  const picks = FORMAT_PICKS[cfg.format];
  const bans = n - 1 - picks;
  const lead = cfg.format === 'bo1' ? bans : Math.min(2, bans);
  const order = [
    ...Array(lead).fill('ban'),
    ...Array(picks).fill('pick'),
    ...Array(bans - lead).fill('ban'),
  ];
  const steps = [];
  let team = cfg.first;
  let lastMapTeam = other(team);
  for (const action of order) {
    steps.push({ kind: 'map', action, team });
    if (action === 'pick') {
      steps.push({ kind: 'side', team: other(team), mapStep: steps.length - 1 });
    }
    lastMapTeam = team;
    team = other(team);
  }
  steps.push({ kind: 'decider' }); // 自动落定，无人操作
  steps.push({ kind: 'side', team: other(lastMapTeam), mapStep: steps.length - 1 });
  return steps.map(s => ({ ...s, value: null, auto: false }));
}

function remainingMaps(room) {
  const used = new Set(room.steps.filter(s => (s.kind === 'map' || s.kind === 'decider') && s.value).map(s => s.value));
  return room.config.pool.filter(id => !used.has(id));
}
function optionsFor(room, step) {
  if (step.kind === 'map') return remainingMaps(room);
  if (step.kind === 'side') return ['attack', 'defense'];
  return [];
}

// ---------- 房间生命周期 ----------
function createRoom(body) {
  const format = FORMAT_PICKS.hasOwnProperty(body.format) ? body.format : 'bo3';
  let pool = Array.isArray(body.pool) ? [...new Set(body.pool.filter(id => MAP_IDS.has(id)))] : DEFAULT_POOL;
  const minPool = FORMAT_PICKS[format] + 1;
  if (pool.length < minPool) throw new Error(`${format.toUpperCase()} 至少需要 ${minPool} 张图`);
  if (pool.length > MAPS.length) pool = pool.slice(0, MAPS.length);
  const timer = [0, 20, 30, 45, 60, 90].includes(Number(body.timer)) ? Number(body.timer) : 30;
  const firstMode = ['A', 'B', 'random', 'dice'].includes(body.first) ? body.first : 'dice';

  const config = {
    format, pool, timer, firstMode,
    first: null,
    teamNames: { ...DEFAULT_NAMES },
  };
  let id;
  do { id = String(crypto.randomInt(100000, 1000000)); } while (rooms.has(id)); // 6 位数字房间号
  const room = {
    id, config,
    tokens: { A: null, B: null, admin: randId(12) }, // 队伍座位进房后认领
    steps: [],
    cursor: 0,
    status: 'waiting',            // waiting | dice | running | done
    dice: null,
    ready: { A: false, B: false },
    deadline: null,
    timerHandle: null,
    clients: new Set(),
    createdAt: Date.now(),
    touchedAt: Date.now(),
  };
  resetRoom(room);
  rooms.set(id, room);
  store.save(room);
  return room;
}

// 先手：固定 / 随机硬币时建房即确定；摇骰子模式在双方准备后才确定
function decideFirstUpfront(room) {
  const m = room.config.firstMode;
  room.config.first = m === 'A' || m === 'B' ? m : m === 'random' ? pickRandom(['A', 'B']) : null;
  room.steps = room.config.first ? buildSteps(room.config) : [];
}

function startMatch(room) {
  if (room.config.firstMode === 'dice' && !room.config.first) {
    room.status = 'dice';
    room.dice = { A: null, B: null, round: 1, ties: [], winner: null };
    armDiceTimer(room);
  } else {
    room.status = 'running';
    advance(room);
  }
}

function armDiceTimer(room, remainingMs) {
  clearTimeout(room.timerHandle);
  room.deadline = null;
  if (room.config.timer <= 0) return;
  const ms = remainingMs ?? room.config.timer * 1000;
  room.deadline = Date.now() + ms;
  const round = room.dice.round;
  room.timerHandle = setTimeout(() => {
    if (room.status !== 'dice' || room.dice.round !== round || room.dice.winner) return;
    for (const t of ['A', 'B']) if (room.dice[t] == null) rollDice(room, t, true);
    broadcast(room);
  }, ms + 300);
}

function rollDice(room, team, auto = false) {
  const d = room.dice;
  if (room.status !== 'dice' || d.winner) return '现在不能摇骰子';
  if (d[team] != null) return '你已经摇过了';
  d[team] = crypto.randomInt(1, 7);
  d[team + 'auto'] = auto;
  room.touchedAt = Date.now();
  if (d.A == null || d.B == null) return null;
  if (d.A === d.B) {
    // 平局：留出动画时间后清空重摇
    d.ties.push([d.A, d.B]);
    const round = d.round;
    clearTimeout(room.timerHandle); room.deadline = null;
    room.timerHandle = setTimeout(() => {
      if (room.status !== 'dice' || d.round !== round) return;
      nextDiceRound(room); broadcast(room);
    }, 2600);
    return null;
  }
  d.winner = d.A > d.B ? 'A' : 'B';
  room.config.first = d.winner;
  room.steps = buildSteps(room.config);
  clearTimeout(room.timerHandle); room.deadline = null;
  room.timerHandle = setTimeout(() => {
    if (room.status !== 'dice') return;
    room.status = 'running';
    advance(room); broadcast(room);
  }, 3200);
  return null;
}

function nextDiceRound(room) {
  const d = room.dice;
  d.A = d.B = null; d.Aauto = d.Bauto = false; d.round++;
  armDiceTimer(room);
}

function resetRoom(room) {
  clearTimeout(room.timerHandle);
  decideFirstUpfront(room);
  room.dice = null;
  room.cursor = 0;
  room.status = 'waiting';
  room.ready = { A: false, B: false };
  room.deadline = null;
}

// 跳过自动步骤，推进到下一个需要人操作的步骤
function advance(room) {
  while (room.cursor < room.steps.length && room.steps[room.cursor].kind === 'decider') {
    room.steps[room.cursor].value = remainingMaps(room)[0];
    room.cursor++;
  }
  clearTimeout(room.timerHandle);
  room.deadline = null;
  if (room.cursor >= room.steps.length) {
    room.status = 'done';
    return;
  }
  if (room.config.timer > 0) armStepTimer(room, room.config.timer * 1000);
}

function armStepTimer(room, ms) {
  clearTimeout(room.timerHandle);
  room.deadline = Date.now() + ms;
  const at = room.cursor;
  room.timerHandle = setTimeout(() => {
    if (room.status !== 'running' || room.cursor !== at) return;
    const step = room.steps[at];
    applyAction(room, step.team, pickRandom(optionsFor(room, step)), true);
    broadcast(room);
  }, ms + 300);
}

// 房主撤销：退回到最近一次有人操作的步骤（顺带清掉之后自动落定的决胜图）
function undoLast(room) {
  if (room.status !== 'running' && room.status !== 'done') return false;
  let i = room.cursor - 1;
  while (i >= 0 && room.steps[i].kind === 'decider') i--;
  if (i < 0) return false;
  for (let k = i; k < room.steps.length; k++) { room.steps[k].value = null; room.steps[k].auto = false; }
  room.cursor = i;
  room.status = 'running';
  room.touchedAt = Date.now();
  clearTimeout(room.timerHandle); room.deadline = null;
  if (room.config.timer > 0) armStepTimer(room, room.config.timer * 1000);
  return true;
}

// 服务器重启后恢复房间：按剩余时间重新挂上倒计时
function restoreRoom(data) {
  const room = { ...data, clients: new Set(), timerHandle: null };
  const left = room.deadline ? Math.max(3000, room.deadline - Date.now()) : null;
  if (room.status === 'running' && left) armStepTimer(room, left);
  if (room.status === 'dice' && room.dice) {
    const d = room.dice;
    if (d.winner) room.timerHandle = setTimeout(() => { room.status = 'running'; advance(room); broadcast(room); }, 1500);
    else if (d.A != null && d.B != null) room.timerHandle = setTimeout(() => { nextDiceRound(room); broadcast(room); }, 1500);
    else armDiceTimer(room, left ?? undefined);
  }
  rooms.set(room.id, room);
}

function applyAction(room, team, value, auto = false) {
  if (room.status !== 'running') return '还没开始';
  const step = room.steps[room.cursor];
  if (!step || step.team !== team) return '还没轮到你';
  if (!optionsFor(room, step).includes(value)) return '这个选项不可用';
  step.value = value;
  step.auto = auto;
  step.at = Date.now();
  room.cursor++;
  room.touchedAt = Date.now();
  advance(room);
  return null;
}

// ---------- 对外状态 ----------
function publicState(room) {
  const online = { A: 0, B: 0, admin: 0, spec: 0 };
  for (const c of room.clients) online[c.role]++;
  return {
    id: room.id,
    config: room.config,
    steps: room.steps.map(({ kind, action, team, mapStep, value, auto }) => ({ kind, action, team, mapStep, value, auto })),
    cursor: room.cursor,
    status: room.status,
    dice: room.dice,
    ready: room.ready,
    deadline: room.deadline,
    serverNow: Date.now(),
    online,
    seats: { A: !!room.tokens.A, B: !!room.tokens.B },
  };
}

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}
function broadcast(room) {
  // 每次状态变化都存一次（同一轮事件里合并成一次写入）
  if (!room.saveQueued) {
    room.saveQueued = true;
    setImmediate(() => { room.saveQueued = false; if (rooms.has(room.id)) store.save(room); });
  }
  const state = publicState(room);
  for (const c of room.clients) send(c.ws, { type: 'state', state });
}

// ---------- HTTP ----------
const createLog = new Map(); // ip -> [timestamps]
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.ico': 'image/x-icon' };

function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
}
function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function serveFile(res, file) {
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(file);
    const cache = ext === '.webp' || ext === '.png' || ext === '.jpg' ? 'public, max-age=604800' : 'no-cache';
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': cache });
    res.end(buf);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');

  if (req.method === 'GET' && url.pathname === '/api/meta') {
    return json(res, 200, { maps: MAPS, defaultPool: DEFAULT_POOL });
  }

  if (req.method === 'POST' && url.pathname === '/api/rooms') {
    const ip = clientIp(req);
    const now = Date.now();
    const log = (createLog.get(ip) || []).filter(t => now - t < 3600e3);
    if (log.length >= CREATE_LIMIT_PER_HOUR) return json(res, 429, { error: '建房太频繁了，请稍后再试' });
    if (rooms.size >= MAX_ROOMS) return json(res, 503, { error: '服务器房间已满，请稍后再试' });
    let raw = '';
    req.on('data', c => { raw += c; if (raw.length > 10000) req.destroy(); });
    req.on('end', () => {
      try {
        const room = createRoom(JSON.parse(raw || '{}'));
        log.push(now); createLog.set(ip, log);
        json(res, 200, { id: room.id, adminToken: room.tokens.admin });
      } catch (e) {
        json(res, 400, { error: e.message || '参数错误' });
      }
    });
    return;
  }

  const m = url.pathname.match(/^\/api\/rooms\/(\d{6})$/);
  if (req.method === 'GET' && m) {
    return rooms.has(m[1]) ? json(res, 200, { ok: true }) : json(res, 404, { error: '房间不存在或已过期' });
  }

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname.startsWith('/r/'))) {
    return serveFile(res, path.join(PUBLIC_DIR, 'index.html'));
  }
  if (req.method === 'GET' && /^\/obs\/\d{6}$/.test(url.pathname)) {
    return serveFile(res, path.join(PUBLIC_DIR, 'obs.html'));
  }
  if (req.method === 'GET') {
    const file = path.normalize(path.join(PUBLIC_DIR, url.pathname));
    if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end(); }
    return serveFile(res, file);
  }
  res.writeHead(405); res.end();
});

// ---------- WebSocket ----------
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });

wss.on('connection', (ws) => {
  let client = null;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }

    if (msg.type === 'join') {
      const room = rooms.get(String(msg.room));
      if (!room) return send(ws, { type: 'error', code: 'no_room', message: '房间不存在或已过期' });
      let role = 'spec';
      for (const r of ['A', 'B']) if (msg.token && msg.token === room.tokens[r]) role = r;
      const admin = !!msg.adminToken && msg.adminToken === room.tokens.admin;
      if (client) client.room.clients.delete(client);
      client = { ws, room, role, admin };
      room.clients.add(client);
      room.touchedAt = Date.now();
      send(ws, { type: 'joined', role, admin });
      return broadcast(room);
    }
    if (!client) return;
    const { room, role } = client;

    // 认领座位：空位才能坐，一个人只能坐一个位置
    if (msg.type === 'claim' && (msg.team === 'A' || msg.team === 'B')) {
      if (role !== 'spec') return send(ws, { type: 'error', code: 'bad_action', message: '你已经在队伍里了' });
      if (room.tokens[msg.team]) return send(ws, { type: 'error', code: 'bad_action', message: '这个位置已经有人了' });
      const token = randId(12);
      room.tokens[msg.team] = token;
      room.config.teamNames[msg.team] = cleanName(msg.name, DEFAULT_NAMES[msg.team]);
      client.role = msg.team;
      send(ws, { type: 'joined', role: msg.team, admin: client.admin, token });
      return broadcast(room);
    }
    // 离开座位（本人）或移出座位（房主）
    if (msg.type === 'release' && (msg.team === 'A' || msg.team === 'B')) {
      if (!(client.admin || role === msg.team)) return;
      if (room.status !== 'waiting' && !client.admin) return send(ws, { type: 'error', code: 'bad_action', message: '已经开始了，不能离开座位' });
      room.tokens[msg.team] = null;
      room.ready[msg.team] = false;
      if (room.status === 'waiting') room.config.teamNames[msg.team] = DEFAULT_NAMES[msg.team];
      for (const c of room.clients) if (c.role === msg.team) { c.role = 'spec'; send(c.ws, { type: 'joined', role: 'spec', admin: c.admin, released: true }); }
      return broadcast(room);
    }

    if (msg.type === 'ready' && (role === 'A' || role === 'B')) {
      if (room.status !== 'waiting') return;
      room.ready[role] = msg.value !== false;
      if (room.ready.A && room.ready.B) startMatch(room);
      return broadcast(room);
    }
    if (msg.type === 'act' && (role === 'A' || role === 'B')) {
      const err = applyAction(room, role, String(msg.value));
      if (err) return send(ws, { type: 'error', code: 'bad_action', message: err });
      return broadcast(room);
    }
    if (msg.type === 'roll' && (role === 'A' || role === 'B')) {
      const err = rollDice(room, role);
      if (err) return send(ws, { type: 'error', code: 'bad_action', message: err });
      return broadcast(room);
    }
    if (msg.type === 'undo' && client.admin) {
      if (!undoLast(room)) return send(ws, { type: 'error', code: 'bad_action', message: '没有可以撤销的操作' });
      return broadcast(room);
    }
    if (msg.type === 'reset' && client.admin) {
      resetRoom(room);
      return broadcast(room);
    }
    if (msg.type === 'start' && client.admin && room.status === 'waiting') {
      room.ready = { A: true, B: true };
      startMatch(room);
      return broadcast(room);
    }
  });

  ws.on('close', () => {
    if (client) { client.room.clients.delete(client); broadcast(client.room); }
  });
});

// 心跳 + 过期清理
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false; ws.ping();
  }
  const now = Date.now();
  for (const [id, room] of rooms) {
    if (room.clients.size === 0 && now - room.touchedAt > ROOM_TTL_MS) {
      clearTimeout(room.timerHandle);
      rooms.delete(id);
      store.remove(id);
    }
  }
}, 30e3).unref();

async function main() {
  try {
    const saved = await store.loadAll();
    const now = Date.now();
    for (const r of saved) if (r && r.id && now - (r.touchedAt || 0) < ROOM_TTL_MS) restoreRoom(r);
    console.log(`[persist] 恢复了 ${rooms.size} 个房间`);
  } catch (e) {
    console.log('[persist] 读取失败，从空白开始：' + e.message);
  }
  server.listen(PORT, () => console.log(`Valorant BP 已启动: http://localhost:${PORT}`));
}
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, async () => { await store.flush(); process.exit(0); });
}
if (require.main === module) main();
module.exports = { server, buildSteps };
