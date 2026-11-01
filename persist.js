// 持久化：房间（重启后恢复）+ BP 记录（后台查看，保留 RECORD_TTL 后自动删除）
// - 设置了 REDIS_URL（例如 Render Key Value）：存到 Redis，每条一个 key，靠过期时间自动删除
// - 没设置：存到本地文件 data/rooms.json、data/records.json（适合自己的云服务器）

const fs = require('fs');
const path = require('path');

const FIELDS = ['id', 'config', 'tokens', 'steps', 'cursor', 'status', 'dice', 'ready', 'deadline', 'createdAt', 'touchedAt', 'game', 'undos', 'firstDoneAt'];
const serialize = (room) => JSON.stringify(Object.fromEntries(FIELDS.map(k => [k, room[k]])));

function createStore({ ttlMs, recordTtlMs, log = console.log }) {
  const url = process.env.REDIS_URL;
  return url ? redisStore(url, ttlMs, recordTtlMs, log) : fileStore(recordTtlMs, log);
}

function redisStore(url, ttlMs, recordTtlMs, log) {
  const { createClient } = require('redis');
  const client = createClient({ url, socket: { reconnectStrategy: (n) => Math.min(n * 200, 3000) } });
  client.on('error', (e) => log('[redis] ' + e.message));
  const ready = client.connect().then(() => log('[persist] 使用 Redis 保存房间和 BP 记录'));
  const ttl = Math.ceil(ttlMs / 1000);
  const scanAll = async (match) => {
    await ready;
    const out = [];
    for await (const keys of client.scanIterator({ MATCH: match, COUNT: 200 })) {
      const list = [].concat(keys);
      if (!list.length) continue;
      const vals = await client.mGet(list);
      for (const raw of vals) if (raw) try { out.push(JSON.parse(raw)); } catch {}
    }
    return out;
  };
  return {
    kind: 'redis',
    loadAll: () => scanAll('vbp:room:*'),
    save(room) { return client.set('vbp:room:' + room.id, serialize(room), { EX: ttl }).catch(e => log('[redis] 保存失败 ' + e.message)); },
    remove(id) { return client.del('vbp:room:' + id).catch(() => {}); },
    async flush() {},

    // BP 记录：过期时间从首次结束时算起，撤销后重新完成只更新内容、不重置过期时间
    async saveRecord(rec) {
      await ready;
      const left = Math.max(1, Math.ceil((rec.expiresAt - Date.now()) / 1000));
      return client.set('vbp:rec:' + rec.id, JSON.stringify(rec), { EX: left }).catch(e => log('[redis] 记录保存失败 ' + e.message));
    },
    listRecords: () => scanAll('vbp:rec:*'),
    async deleteRecord(id) { await ready; return client.del('vbp:rec:' + id); },
  };
}

function fileStore(recordTtlMs, log) {
  const dir = path.join(__dirname, 'data');
  const roomFile = path.join(dir, 'rooms.json');
  const recFile = path.join(dir, 'records.json');
  let getRooms = () => [];
  let timer = null;
  let records = new Map();
  try { for (const r of JSON.parse(fs.readFileSync(recFile, 'utf8'))) records.set(r.id, r); } catch {}

  const write = (file, text) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file + '.tmp', text); fs.renameSync(file + '.tmp', file); };
  const prune = () => { const now = Date.now(); for (const [id, r] of records) if (r.expiresAt <= now) records.delete(id); };
  const writeNow = () => {
    clearTimeout(timer); timer = null;
    try {
      write(roomFile, '[' + getRooms().map(serialize).join(',') + ']');
      prune();
      write(recFile, JSON.stringify([...records.values()]));
    } catch (e) { log('[persist] 写文件失败 ' + e.message); }
  };
  const later = () => { if (!timer) timer = setTimeout(writeNow, 500); };
  setInterval(() => { const n = records.size; prune(); if (records.size !== n) later(); }, 3600e3).unref();
  log('[persist] 未设置 REDIS_URL，房间和 BP 记录保存到 data/ 目录');
  return {
    kind: 'file',
    bind(fn) { getRooms = fn; },
    async loadAll() { try { return JSON.parse(fs.readFileSync(roomFile, 'utf8')); } catch { return []; } },
    save: later,
    remove: later,
    async flush() { writeNow(); },
    async saveRecord(rec) { records.set(rec.id, rec); later(); },
    async listRecords() { prune(); return [...records.values()]; },
    async deleteRecord(id) { const had = records.delete(id); later(); return had ? 1 : 0; },
  };
}

module.exports = { createStore };
