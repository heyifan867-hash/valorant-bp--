// 管理后台：登录、统计、进行中的房间、BP 记录（搜索 / 详情 / 删除 / 导出 CSV）
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k) { try { return localStorage.getItem(k) || ''; } catch { return ''; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };
  const SIDE = { attack: '进攻', defense: '防守' };
  const STATUS = { waiting: '等待中', dice: '摇骰子', running: 'BP 中', done: '已完成' };
  const FIRST = { dice: '摇骰子', random: '抛硬币', A: '指定 A 方', B: '指定 B 方' };

  let DATA = null, timer = null, open = new Set();
  const mapZh = (id) => DATA?.maps.find(m => m.id === id)?.zh || id;
  const mapImg = (id) => DATA?.maps.find(m => m.id === id)?.img || '';
  const pad = (n) => String(n).padStart(2, '0');
  const fmtTime = (t) => { const d = new Date(t); return `${d.getMonth() + 1}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const fmtFull = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const team = (r, t) => `<span class="${t === 'A' ? 'ta' : 'tb'}">${esc(r.teamNames[t])}</span>`;

  function toast(text) { const t = $('toast'); t.textContent = text; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), 2600); }

  async function api(path, opts = {}) {
    const r = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + store.get('vbp-admin-token'), ...(opts.headers || {}) } });
    const body = await r.json().catch(() => ({}));
    if (r.status === 401 && !path.endsWith('/login')) { logout(); throw new Error(body.error || '请重新登录'); }
    if (!r.ok) throw new Error(body.error || '请求失败');
    return body;
  }

  // ---------- 登录 ----------
  function showLogin() { $('login').hidden = false; $('dash').hidden = true; $('logoutBtn').hidden = true; clearInterval(timer); setTimeout(() => $('pwd').focus(), 50); }
  function logout() { store.del('vbp-admin-token'); showLogin(); }
  $('logoutBtn').onclick = logout;
  $('loginForm').onsubmit = async (e) => {
    e.preventDefault();
    const err = $('loginError'); err.hidden = true; $('loginBtn').disabled = true;
    try {
      const { token } = await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: $('pwd').value }) });
      store.set('vbp-admin-token', token); $('pwd').value = '';
      start();
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    finally { $('loginBtn').disabled = false; }
  };

  // ---------- 后台 ----------
  async function load() {
    try {
      DATA = await api('/api/admin/overview');
      render();
      $('updated').textContent = '更新于 ' + fmtTime(Date.now()).slice(-5);
    } catch (e) { if ($('dash').hidden === false) toast(e.message); }
  }
  function start() {
    $('login').hidden = true; $('dash').hidden = false; $('logoutBtn').hidden = false;
    load(); clearInterval(timer); timer = setInterval(load, 20000);
  }

  function stats(records) {
    const s = {};
    for (const m of DATA.maps) s[m.id] = { pick: 0, dec: 0, ban: 0 };
    for (const r of records) {
      for (const m of r.maps) if (s[m.map]) s[m.map][m.by ? 'pick' : 'dec']++;
      for (const b of r.bans) if (s[b.map]) s[b.map].ban++;
    }
    return s;
  }

  function render() {
    const recs = DATA.records;
    $('days').textContent = DATA.retentionDays;
    $('kTotal').textContent = recs.length;
    $('kLive').textContent = DATA.rooms.filter(r => r.status !== 'done').length;
    const s = stats(recs);
    const top = (k) => Object.entries(s).filter(([, v]) => v[k] > 0).sort((a, b) => b[1][k] - a[1][k])[0];
    const tp = Object.entries(s).filter(([, v]) => v.pick + v.dec > 0).sort((a, b) => (b[1].pick + b[1].dec) - (a[1].pick + a[1].dec))[0];
    const tb = top('ban');
    $('kPick').textContent = tp ? mapZh(tp[0]) : '—'; $('kPickN').textContent = tp ? `打了 ${tp[1].pick + tp[1].dec} 次` : '';
    $('kBan').textContent = tb ? mapZh(tb[0]) : '—'; $('kBanN').textContent = tb ? `被禁 ${tb[1].ban} 次` : '';
    $('retention').textContent = `每条记录保留 ${DATA.retentionDays} 天，到期自动删除。` + (DATA.storage === 'file' ? '（当前存在服务器本地文件）' : '');

    // 地图统计
    const rows = Object.entries(s).sort((a, b) => (b[1].pick + b[1].dec + b[1].ban) - (a[1].pick + a[1].dec + a[1].ban));
    const max = Math.max(1, ...rows.map(([, v]) => v.pick + v.dec + v.ban));
    $('mapStats').innerHTML = rows.map(([id, v]) => `<div class="ms-row">
        <span class="ms-thumb" style="background-image:url('${esc(mapImg(id))}')"></span>
        <span class="ms-name">${esc(mapZh(id))}</span>
        <span class="bar" title="选图 ${v.pick} · 决胜 ${v.dec} · 禁用 ${v.ban}"><i class="pick" style="width:${v.pick / max * 100}%"></i><i class="dec" style="width:${v.dec / max * 100}%"></i><i class="ban" style="width:${v.ban / max * 100}%"></i></span>
        <span class="ms-num">选 <b>${v.pick}</b> · 决 <b>${v.dec}</b> · 禁 <b>${v.ban}</b></span></div>`).join('');

    // 进行中的房间
    const live = DATA.rooms;
    $('liveRooms').innerHTML = live.length ? live.slice(0, 12).map(r => `<div class="live">
        <code>${esc(r.id)}</code>
        <div style="min-width:0"><div class="lv-vs"><span class="pill ${r.status}">${STATUS[r.status]}</span>${team(r, 'A')} <span class="x">vs</span> ${team(r, 'B')}</div>
        <div class="meta">${r.format.toUpperCase()} · 进度 ${r.progress[0]}/${r.progress[1]} · 在线 ${r.online.A + r.online.B} 人 + 观战 ${r.online.spec} · ${fmtTime(r.touchedAt)}</div></div>
        <a href="/r/${esc(r.id)}" target="_blank" rel="noopener">观战 ↗</a></div>`).join('')
      : '<p class="empty">现在没有房间</p>';

    renderRecords();
  }

  function filtered() {
    const q = $('q').value.trim().toLowerCase(), f = $('fFormat').value;
    return DATA.records.filter(r => (!f || r.format === f) &&
      (!q || r.roomId.includes(q) || r.teamNames.A.toLowerCase().includes(q) || r.teamNames.B.toLowerCase().includes(q)));
  }

  function renderRecords() {
    const list = filtered();
    if (!DATA.records.length) { $('recList').innerHTML = '<p class="empty">还没有完成的 BP。打完一场 BP 后，记录会自动出现在这里。</p>'; return; }
    if (!list.length) { $('recList').innerHTML = '<p class="empty">没有符合条件的记录</p>'; return; }
    $('recList').innerHTML = list.map(r => {
      const left = Math.max(0, r.expiresAt - DATA.now);
      const leftTxt = left > 864e5 ? `剩 ${Math.ceil(left / 864e5)} 天` : `剩 ${Math.max(1, Math.ceil(left / 3600e3))} 小时`;
      const chips = r.maps.map((m, i) => `<span class="mchip ${m.by || 'D'}" style="background-image:url('${esc(mapImg(m.map))}')" title="${m.by ? '第 ' + (i + 1) + ' 图' : '决胜图'}"><span>${esc(mapZh(m.map))}</span></span>`).join('');
      return `<div class="rec" data-id="${esc(r.id)}">
        <div class="rec-main" data-toggle="${esc(r.id)}">
          <div class="rec-time">${fmtTime(r.finishedAt)}<small>房间 ${esc(r.roomId)}${r.game > 1 ? ' · 第 ' + r.game + ' 场' : ''}</small></div>
          <div class="rec-vs">${team(r, 'A')}<span class="x">vs</span>${team(r, 'B')}</div>
          <div class="rec-fmt">${r.format.toUpperCase()}</div>
          <div class="rec-maps">${chips}</div>
          <div class="rec-left">${leftTxt}</div>
          <div class="rec-act"><button class="btn ghost small" data-toggle="${esc(r.id)}">${open.has(r.id) ? '收起' : '详情'}</button><button class="btn ghost small danger" data-del="${esc(r.id)}">删除</button></div>
        </div>
        ${open.has(r.id) ? detail(r) : ''}
      </div>`;
    }).join('');
  }

  function detail(r) {
    const dice = r.dice ? `${r.dice.A} : ${r.dice.B}${r.dice.ties ? `（平局重摇 ${r.dice.ties} 次）` : ''} → ${esc(r.teamNames[r.dice.winner])} 先手` : `${FIRST[r.firstMode] || r.firstMode} → ${esc(r.teamNames[r.first] || '')} 先手`;
    const maps = r.maps.map((m, i) => `<div class="det-map"><span class="no">${m.by ? '第 ' + (i + 1) + ' 图' : '决胜图'}</span><b>${esc(mapZh(m.map))}</b>
      <span>${m.by ? team(r, m.by) + ' 选图 · ' : ''}${m.sideBy ? team(r, m.sideBy) + ' 选' + SIDE[m.side] + ' → ' + team(r, m.attack) + ' 进攻开局' : '未选边'}${m.auto ? '<span class="flag">超时代选</span>' : ''}</span></div>`).join('');
    const bans = r.bans.map(b => `${esc(mapZh(b.map))}（${team(r, b.team)}${b.auto ? '<span class="flag">超时</span>' : ''}）`).join('、');
    const dur = Math.round((r.finishedAt - r.createdAt) / 60000);
    return `<div class="rec-detail">
      <div class="det-grid">
        <div><span>完成时间</span>${fmtFull(r.finishedAt)}</div>
        <div><span>建房时间</span>${fmtFull(r.createdAt)}（约 ${dur} 分钟）</div>
        <div><span>先手</span>${dice}</div>
        <div><span>赛制 / 限时</span>${r.format.toUpperCase()} · ${r.timer ? r.timer + ' 秒' : '不限时'}</div>
        <div><span>超时代选 / 房主撤销</span>${r.autoSteps} 次 / ${r.undos} 次</div>
        <div><span>地图池</span>${r.pool.map(mapZh).join('、')}</div>
      </div>
      <div class="det-maps">${maps}</div>
      <div class="det-bans">禁用：${bans || '无'}</div>
    </div>`;
  }

  // 交互
  $('recList').addEventListener('click', async (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      e.stopPropagation();
      if (!del.classList.contains('armed')) { del.classList.add('armed'); del.textContent = '确认删除'; setTimeout(() => { del.classList.remove('armed'); del.textContent = '删除'; }, 3000); return; }
      try { await api('/api/admin/records/' + encodeURIComponent(del.dataset.del), { method: 'DELETE' }); toast('已删除'); load(); } catch (ex) { toast(ex.message); }
      return;
    }
    const t = e.target.closest('[data-toggle]');
    if (t) { const id = t.dataset.toggle; open.has(id) ? open.delete(id) : open.add(id); renderRecords(); }
  });
  $('q').oninput = renderRecords;
  $('fFormat').onchange = renderRecords;
  $('clearBtn').onclick = async () => {
    const b = $('clearBtn');
    if (!b.classList.contains('armed')) { b.classList.add('armed'); b.textContent = '再点一次，清空全部'; setTimeout(() => { b.classList.remove('armed'); b.textContent = '清空全部记录'; }, 3000); return; }
    try { await api('/api/admin/records', { method: 'DELETE' }); toast('已清空'); load(); } catch (ex) { toast(ex.message); }
    b.classList.remove('armed'); b.textContent = '清空全部记录';
  };

  // 导出 CSV（带 BOM，Excel 直接打开不乱码）
  $('exportBtn').onclick = () => {
    const list = filtered();
    if (!list.length) return toast('没有可以导出的记录');
    const maxMaps = Math.max(...list.map(r => r.maps.length));
    const head = ['完成时间', '房间号', '第几场', 'A方', 'B方', '赛制', '先手方式', '骰子', '先手方'];
    for (let i = 0; i < maxMaps; i++) head.push(`图${i + 1}`, `图${i + 1}选图方`, `图${i + 1}进攻开局`);
    head.push('禁图', '超时代选次数', '撤销次数');
    const rows = list.map(r => {
      const first = r.dice?.winner || r.first;
      const row = [fmtFull(r.finishedAt), r.roomId, r.game, r.teamNames.A, r.teamNames.B, r.format.toUpperCase(), FIRST[r.firstMode] || r.firstMode, r.dice ? `${r.dice.A}:${r.dice.B}` : '', r.teamNames[first] || ''];
      for (let i = 0; i < maxMaps; i++) { const m = r.maps[i]; row.push(m ? mapZh(m.map) : '', m ? (m.by ? r.teamNames[m.by] : '决胜图') : '', m?.attack ? r.teamNames[m.attack] : ''); }
      row.push(r.bans.map(b => `${mapZh(b.map)}(${r.teamNames[b.team]})`).join(' '), r.autoSteps, r.undos);
      return row;
    });
    const csv = '﻿' + [head, ...rows].map(row => row.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const d = new Date(); a.download = `BP记录_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  store.get('vbp-admin-token') ? start() : showLogin();
})();
