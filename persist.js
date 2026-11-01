// 房间持久化：服务器重启 / 重新部署 / 休眠唤醒后，房间还能恢复。
// - 设置了 REDIS_URL（例如 Render Key Value）：存到 Redis，每个房间一个 key，自动过期
// - 没设置：存到本地文件 data/rooms.json（适合自己的云服务器；Render 免费版重启会清空本地文件）

const fs = require('fs');
const path = require('path');

const FIELDS = ['id', 'config', 'tokens', 'steps', 'cursor', 'status', 'dice', 'ready', 'deadline', 'createdAt', 'touchedAt'];
const serialize = (room) => JSON.stringify(Object.fromEntries(FIELDS.map(k => [k, room[k]])));

function createStore({ ttlMs, log = console.log }) {
  const url = process.env.REDIS_URL;
  return url ? redisStore(url, ttlMs, log) : fileStore(log);
}

function redisStore(url, ttlMs, log) {
  const { createClient } = require('redis');
  const client = createClient({ url, socket: { reconnectStrategy: (n) => Math.min(n * 200, 3000) } });
  client.on('error', (e) => log('[redis] ' + e.message));
  const ready = client.connect().then(() => log('[persist] 使用 Redis 保存房间'));
  const ttl = Math.ceil(ttlMs / 1000);
  return {
    kind: 'redis',
    async loadAll() {
      await ready;
      const rooms = [];
      for await (const keys of client.scanIterator({ MATCH: 'vbp:room:*', COUNT: 200 })) {
        for (const key of [].concat(keys)) {
          const raw = await client.get(key);
          if (raw) try { rooms.push(JSON.parse(raw)); } catch {}
        }
      }
      return rooms;
    },
    save(room) { return client.set('vbp:room:' + room.id, serialize(room), { EX: ttl }).catch(e => log('[redis] 保存失败 ' + e.message)); },
    remove(id) { return client.del('vbp:room:' + id).catch(() => {}); },
    async flush() {},
  };
}

function fileStore(log) {
  const dir = path.join(__dirname, 'data');
  const file = path.join(dir, 'rooms.json');
  let getRooms = () => [];
  let timer = null;
  const writeNow = () => {
    clearTimeout(timer); timer = null;
    try {
      fs.mkdirSync(dir, { recursive: true });
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, '[' + getRooms().map(serialize).join(',') + ']');
      fs.renameSync(tmp, file);
    } catch (e) { log('[persist] 写文件失败 ' + e.message); }
  };
  log('[persist] 未设置 REDIS_URL，房间保存到 data/rooms.json');
  return {
    kind: 'file',
    bind(fn) { getRooms = fn; },
    async loadAll() {
      try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; }
    },
    save() { if (!timer) timer = setTimeout(writeNow, 500); },
    remove() { if (!timer) timer = setTimeout(writeNow, 500); },
    async flush() { writeNow(); },
  };
}

module.exports = { createStore };
