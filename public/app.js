// 无畏契约 BP 前端：建房表单 + 房间实时视图（全部状态以服务器为准）
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const SIDE_ZH = { attack: '进攻', defense: '防守' };
  const FORMAT_HINT = {
    bo1: '双方轮流禁图，剩下最后一张开打，另一方选边。',
    bo3: '禁 · 禁 · 选 · 选 · 禁 · 禁 · 决胜图。每选一张图，由对手选边。',
    bo5: '禁 · 禁 · 选 · 选 · 选 · 选 · 决胜图。每选一张图，由对手选边。',
  };
  const NEED = { bo1: 2, bo3: 3, bo5: 5 };

  const store = {
    get(k) { try { return localStorage.getItem(k) || ''; } catch { return ''; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };
  let META = null;
  const mapById = (id) => META.maps.find(m => m.id === id) || { id, zh: id };

  function toast(text) {
    const t = $('toast');
    t.textContent = text; t.hidden = false;
    clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), 2600);
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast('已复制'); }
    catch { window.prompt('复制下面的内容', text); }
  }

  const mapImg = (id) => mapById(id).img;
  const nameHtml = (m) => m.en ? `<span class="nm"><b>${esc(m.en)}</b><span>${esc(m.zh)}</span></span>` : `<span class="nm zh"><b>${esc(m.zh)}</b></span>`;
  const bgStyle = (url) => (url ? ` style="background-image:url('${esc(url)}')"` : '');

  // ---------- 建房页 ----------
  function initHome() {
    $('home').hidden = false;
    let format = 'bo3';
    const pool = new Set(META.defaultPool);

    const renderPool = () => {
      $('poolChips').innerHTML = META.maps.map(m =>
        `<button type="button" class="chip pool-card${pool.has(m.id) ? ' on' : ''}" data-id="${esc(m.id)}" aria-pressed="${pool.has(m.id)}"${bgStyle(mapImg(m.id))}><span class="pc-name">${esc(m.zh)}</span></button>`
      ).join('');
      $('poolCount').textContent = `已选 ${pool.size} 张`;
      $('formatHint').textContent = FORMAT_HINT[format] + (pool.size !== 7 ? `（当前 ${pool.size} 张图，禁图次数会自动调整）` : '');
    };
    $('poolChips').onclick = (e) => {
      const b = e.target.closest('.chip'); if (!b) return;
      pool.has(b.dataset.id) ? pool.delete(b.dataset.id) : pool.add(b.dataset.id);
      renderPool();
    };
    $('formatSeg').onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      format = b.dataset.v;
      for (const x of $('formatSeg').children) x.classList.toggle('on', x === b);
      renderPool();
    };
    renderPool();

    const code = $('joinCode');
    code.oninput = () => { code.value = code.value.replace(/\D/g, '').slice(0, 6); $('joinError').hidden = true; };
    $('joinForm').onsubmit = async (e) => {
      e.preventDefault();
      const err = $('joinError'); err.hidden = true;
      const v = code.value;
      if (v.length !== 6) { err.textContent = '房间号是 6 位数字'; err.hidden = false; return; }
      $('joinBtn').disabled = true;
      try {
        const r = await fetch('/api/rooms/' + v);
        if (!r.ok) throw new Error((await r.json()).error || '房间不存在');
        location.href = '/r/' + v;
      } catch (ex) {
        err.textContent = ex.message || '网络错误，请重试'; err.hidden = false; $('joinBtn').disabled = false;
      }
    };

    $('createForm').onsubmit = async (e) => {
      e.preventDefault();
      const err = $('createError'); err.hidden = true;
      if (pool.size < NEED[format]) { err.textContent = `${format.toUpperCase()} 至少要选 ${NEED[format]} 张图`; err.hidden = false; return; }
      $('createBtn').disabled = true;
      try {
        const r = await fetch('/api/rooms', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            format,
            pool: META.maps.map(m => m.id).filter(id => pool.has(id)),
            first: $('first').value, timer: $('timer').value,
          }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || '创建失败');
        store.set('vbp-admin-' + data.id, data.adminToken);
        location.href = `/r/${data.id}`;
      } catch (ex) {
        err.textContent = ex.message || '网络错误，请重试'; err.hidden = false;
        $('createBtn').disabled = false;
      }
    };
  }

  // ---------- 房间页 ----------
  const claimDraft = {};
  let noRoomRetries = 0;
  let ws, role = 'spec', isAdmin = false, S = null, clockTimer = null, skew = 0, retry = 0, prevCursor = -1;
  const roomId = location.pathname.split('/')[2];
  const seatKey = 'vbp-seat-' + roomId, adminKey = 'vbp-admin-' + roomId;

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => { retry = 0; setConn(true); ws.send(JSON.stringify({ type: 'join', room: roomId, token: store.get(seatKey), adminToken: store.get(adminKey) })); };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'joined') {
        role = msg.role; isAdmin = !!msg.admin;
        if (msg.token) store.set(seatKey, msg.token);
        if (msg.released) { store.del(seatKey); toast('你已离开座位'); }
        if (S) render();
      }
      else if (msg.type === 'state') { S = msg.state; skew = S.serverNow - Date.now(); render(); }
      else if (msg.type === 'error') {
        if (msg.code === 'no_room' && noRoomRetries++ < 2) { setTimeout(() => ws.send(JSON.stringify({ type: 'join', room: roomId, token: store.get(seatKey), adminToken: store.get(adminKey) })), 1500); return; }
        if (msg.code === 'no_room') { $('room').hidden = true; $('missing').hidden = false; ws.onclose = null; ws.close(); setConn(null); }
        else toast(msg.message);
      }
    };
    ws.onclose = () => { setConn(false); setTimeout(connect, Math.min(8000, 500 * 2 ** retry++)); };
  }
  function setConn(on) {
    const c = $('conn'); c.hidden = on === null;
    c.classList.toggle('off', !on);
    $('connText').textContent = on ? '已连接' : '重连中…';
  }
  const act = (value) => ws?.readyState === 1 && ws.send(JSON.stringify({ type: 'act', value }));

  const teamName = (t) => S.config.teamNames[t];
  const teamSpan = (t) => `<span class="${t === 'A' ? 'ta' : 'tb'}">${esc(teamName(t))}</span>`;
  const isPlayer = () => role === 'A' || role === 'B';

  function stepLabel(st) {
    if (st.kind === 'map') return st.action === 'ban' ? '禁用地图' : '选择地图';
    if (st.kind === 'side') return '选择阵营';
    if (st.kind === 'decider') return '决胜图';
    return '';
  }
  function stepValue(st) {
    if (!st.value) return '';
    if (st.kind === 'side') return `${SIDE_ZH[st.value]}开局 · ${mapById(S.steps[st.mapStep].value).zh}`;
    return mapById(st.value).zh;
  }

  // 地图状态：banned / picked / decider
  function mapStates() {
    const res = {};
    for (const st of S.steps) {
      if (!st.value) continue;
      if (st.kind === 'map') res[st.value] = { type: st.action === 'ban' ? 'banned' : 'picked', team: st.team };
      if (st.kind === 'decider') res[st.value] = { type: 'decider' };
    }
    return res;
  }
  // 比赛地图顺序（选图顺序 + 决胜图），带选边信息
  function matchMaps() {
    const list = [];
    S.steps.forEach((st, i) => {
      if ((st.kind === 'map' && st.action === 'pick') || st.kind === 'decider') {
        const side = S.steps.find(x => x.kind === 'side' && x.mapStep === i);
        list.push({ map: st.value, by: st.kind === 'decider' ? null : st.team, side });
      }
    });
    return list;
  }

  function render() {
    const cur = S.steps[S.cursor];
    const myTurn = S.status === 'running' && cur && cur.team === role;
    if (S.cursor !== prevCursor && myTurn && prevCursor !== -1) navigator.vibrate?.(80);
    prevCursor = S.cursor;

    // 比分条
    $('nameA').textContent = teamName('A');
    $('nameB').textContent = teamName('B');
    $('statA').textContent = S.online.A ? '在线' : '离线';
    $('statB').textContent = S.online.B ? '在线' : '离线';
    $('fmt').textContent = `${S.config.format.toUpperCase()} · ${S.config.pool.length} 图`;
    const rb = $('roleBadge');
    rb.className = 'badge ' + (isPlayer() ? role : '');
    rb.textContent = isPlayer() ? `你是 ${teamName(role)}${isAdmin ? ' · 房主' : ''}` : isAdmin ? '房主 · 未入座' : `观战 · ${S.online.spec} 人在看`;
    document.title = `${teamName('A')} vs ${teamName('B')} · 蓝猫电竞 BP`;

    // 回合条
    const turn = $('turn');
    turn.className = 'turn' + (cur && S.status === 'running' ? ' ' + cur.team : '') + (myTurn ? ' mine' : '');
    if (S.status === 'waiting') {
      $('turnTitle').textContent = '等待双方准备';
      const m = S.config.firstMode;
      $('turnSub').textContent = m === 'dice' ? '双方准备后摇骰子，点数大的先手'
        : m === 'random' ? `硬币结果：${teamName(S.config.first)} 先手` : `${teamName(S.config.first)} 先手`;
    } else if (S.status === 'dice') {
      const d = S.dice;
      $('turnTitle').textContent = d.winner ? `${teamName(d.winner)} 先手` : '摇骰子决定 BP 顺序';
      $('turnSub').textContent = d.winner ? '马上开始禁图…' : isPlayer() ? (d[role] == null ? '点下方按钮摇骰子' : '等待对手摇骰子') : '等待双方摇骰子';
    } else if (S.status === 'done') {
      $('turnTitle').textContent = 'BP 完成';
      $('turnSub').textContent = '结果可以复制发群。';
    } else {
      $('turnTitle').innerHTML = myTurn ? `轮到你：${stepLabel(cur)}` : `${teamSpan(cur.team)} 正在${stepLabel(cur)}`;
      $('turnSub').textContent = myTurn
        ? (cur.kind === 'side' ? `为 ${mapById(S.steps[cur.mapStep].value).zh} 选择开局阵营` : '点击下方卡片确认')
        : (isPlayer() ? '等待对手操作' : '观战中');
    }

    // 准备区
    const lobby = $('lobby');
    lobby.hidden = S.status !== 'waiting';
    if (!lobby.hidden) {
      for (const t of ['A', 'B']) {
        const el = $('ready' + t);
        const mine = role === t, taken = S.seats[t];
        el.className = 'ready-card' + (S.ready[t] ? ' ok' : '') + (mine ? ' mine' : '');
        let st, act = '';
        if (!taken) {
          st = role === 'spec' ? '空位，填上你的战队名入座' : '空位，等待对手加入';
          if (role === 'spec') act = `<form class="claim-form" data-claim-form="${t}"><input id="claimName${t}" maxlength="24" placeholder="你的战队名" aria-label="${t} 方战队名" value="${esc(claimDraft[t] ?? store.get('vbp-team-name'))}"><button class="btn primary small" type="submit">入座</button></form>`;
        } else {
          st = (mine ? '你 · ' : '') + (S.ready[t] ? '已准备' : S.online[t] ? '已入座，未准备' : '已入座，暂时离线');
          if (mine) act = `<button class="btn ghost small" data-release="${t}">离开座位</button>`;
          else if (isAdmin) act = `<button class="btn ghost small" data-release="${t}">移出</button>`;
        }
        const typing = !taken && role === 'spec' && el.contains(document.activeElement);
        if (!typing) el.innerHTML = `<div class="rc-main"><span>${teamSpan(t)}</span><span class="st">${st}</span></div>${act}`;
      }
      const rbtn = $('readyBtn');
      rbtn.hidden = !isPlayer();
      if (isPlayer()) {
        rbtn.textContent = S.ready[role] ? '取消准备' : '准备';
        rbtn.onclick = () => ws.send(JSON.stringify({ type: 'ready', value: !S.ready[role] }));
      }
      $('forceStart').hidden = !isAdmin;
      $('roomCode').textContent = S.id.replace(/(\d{3})(\d{3})/, '$1 $2');
      $('codeHint').textContent = role === 'spec'
        ? '选一个队伍坐下，或者留在这里观战。'
        : `把房间号发给对手，让对方打开 ${location.host} 输入房间号加入。`;
    }
    $('adminBox').hidden = !isAdmin;
    if (isAdmin) {
      $('obsUrl').textContent = `${location.origin}/obs/${S.id}`;
      $('undoBtn').disabled = !(S.status === 'running' || S.status === 'done') || !S.steps.slice(0, S.cursor).some(st => st.kind !== 'decider' && st.value);
    }

    renderStrip(cur);
    renderDice();
    renderStage(cur, myTurn);
    renderTimeline();
    renderClock();
  }

  function renderStage(cur, myTurn) {
    const states = mapStates();
    $('mapGrid').closest('.board').hidden = S.status === 'dice';
    const inSide = S.status === 'running' && cur.kind === 'side';
    const done = S.status === 'done';

    // 地图
    const grid = $('mapGrid');
    grid.hidden = inSide || done;
    if (!grid.hidden) {
      const canPick = myTurn && cur.kind === 'map';
      grid.innerHTML = S.config.pool.map(id => {
        const m = mapById(id); const st = states[id];
        let cls = 'map', tag = '';
        if (st?.type === 'banned') { cls += ' banned'; tag = `<span class="tag ${st.team}">${esc(teamName(st.team))} 禁</span>`; }
        else if (st?.type === 'picked') { cls += ' picked-' + st.team; tag = `<span class="tag ${st.team}">${esc(teamName(st.team))} 选</span>`; }
        else if (st?.type === 'decider') { cls += ' decider'; tag = `<span class="tag D">决胜图</span>`; }
        else if (canPick) cls += ' clickable';
        const label = !st && canPick ? `aria-label="${cur.action === 'ban' ? '禁用' : '选择'} ${esc(m.zh)}"` : 'tabindex="-1"';
        return `<button class="${cls}" data-map="${esc(id)}" ${label}${bgStyle(mapImg(id))}>${tag}${nameHtml(m)}</button>`;
      }).join('');
      grid.onclick = (e) => {
        const b = e.target.closest('.map.clickable'); if (!b) return;
        confirmAct(b, b.dataset.map, `${cur.action === 'ban' ? '禁用' : '选择'} ${mapById(b.dataset.map).zh}`);
      };
    }

    // 选边
    const side = $('sidePick');
    side.hidden = !inSide;
    if (inSide) {
      const mid = S.steps[cur.mapStep].value; const m = mapById(mid);
      const picker = S.steps[cur.mapStep].kind === 'decider' ? '决胜图' : `${esc(teamName(S.steps[cur.mapStep].team))} 选的图`;
      side.innerHTML = `
        <div class="map map-wide"${bgStyle(mapImg(mid))}><span class="tag D">${picker}</span>${nameHtml(m)}</div>
        <div class="side-btns">
          <button class="side-btn" data-side="attack" ${myTurn ? '' : 'disabled'}><b>进攻</b><span>上半场进攻方</span></button>
          <button class="side-btn" data-side="defense" ${myTurn ? '' : 'disabled'}><b>防守</b><span>上半场防守方</span></button>
        </div>`;
      side.onclick = (e) => {
        const b = e.target.closest('.side-btn:not(:disabled)'); if (!b) return;
        confirmAct(b, b.dataset.side, `${SIDE_ZH[b.dataset.side]}开局`);
      };
    }

    // 结果
    const sum = $('summary');
    sum.hidden = !done;
    if (done) {
      const list = matchMaps();
      sum.innerHTML = `
        <div class="sum-head"><h3>比赛地图</h3><div class="sum-actions"><button class="btn ghost small" id="copyResult">复制文字</button><button class="btn primary small" id="makeImage">生成结果图</button></div></div>
        <div class="sum-maps">${list.map((x, i) => {
          const m = mapById(x.map);
          const sideTeam = x.side.team;
          const sideTxt = `${teamSpan(sideTeam)} 选择 <b style="font-size:inherit">${SIDE_ZH[x.side.value]}</b> 开局，${teamSpan(sideTeam === 'A' ? 'B' : 'A')} ${x.side.value === 'attack' ? '防守' : '进攻'}`;
          return `<div class="sum-map"><span class="no">${i + 1}</span><div class="body"${bgStyle(mapImg(x.map))}>
            <b>${esc(m.zh)}</b>
            <p>${x.by ? `${teamSpan(x.by)} 选图` : '决胜图'} · ${sideTxt}</p></div></div>`;
        }).join('')}</div>`;
      $('copyResult').onclick = () => copy(resultText());
      $('makeImage').onclick = () => showResultImage();
    }
  }

  function resultText() {
    const lines = [`【${teamName('A')} vs ${teamName('B')}】${S.config.format.toUpperCase()} BP 结果`];
    if (S.dice?.winner) lines.push(`摇骰子：${teamName('A')} ${S.dice.A} : ${S.dice.B} ${teamName('B')}，${teamName(S.dice.winner)} 先手`);
    matchMaps().forEach((x, i) => {
      const m = mapById(x.map);
      const atk = x.side.value === 'attack' ? x.side.team : (x.side.team === 'A' ? 'B' : 'A');
      lines.push(`图${i + 1}：${m.zh}（${x.by ? teamName(x.by) + ' 选' : '决胜图'}）— ${teamName(atk)} 进攻开局`);
    });
    const bans = S.steps.filter(s => s.kind === 'map' && s.action === 'ban').map(s => `${mapById(s.value).zh}(${teamName(s.team)})`);
    lines.push(`禁图：${bans.join('、')}`);
    return lines.join('\n');
  }

  function renderTimeline() {
    if (!S.steps.length) { $('steps').innerHTML = '<li class="todo" style="display:block">摇完骰子后生成 BP 顺序</li>'; return; }
    $('steps').innerHTML = S.steps.map((st, i) => {
      const t = st.kind === 'decider' ? 'D' : st.team;
      const state = i < S.cursor ? 'done' : (i === S.cursor && S.status === 'running') ? 'now' : 'todo';
      const who = st.kind === 'decider' ? '<i>自</i><em>自动</em>' : `<i>${st.team}</i><em>${esc(teamName(st.team))}</em>`;
      const val = st.value ? `<b>${esc(stepValue(st))}</b>${st.auto ? ' <span class="auto">超时随机</span>' : ''}` : esc(stepLabel(st));
      const lbl = st.value ? `${stepLabel(st).replace('选择地图', '选').replace('禁用地图', '禁').replace('禁用特工', '禁').replace('选择阵营', '')} ` : '';
      return `<li class="${t} ${state}"><span class="who">${who}</span><span>${st.value ? esc(lbl) : ''}${val}</span></li>`;
    }).join('');
  }

  // ---------- 结果图 ----------
  const loadImg = (src) => new Promise((res) => {
    if (!src) return res(null);
    const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src;
  });
  const FONT = '"PingFang SC","Microsoft YaHei","Noto Sans SC",system-ui,sans-serif';
  function coverDraw(ctx, im, x, y, w, h) {
    const r = Math.max(w / im.width, h / im.height), sw = w / r, sh = h / r;
    ctx.drawImage(im, (im.width - sw) / 2, (im.height - sh) / 2, sw, sh, x, y, w, h);
  }
  function rrect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h); }
  function fitText(ctx, text, maxW, size, weight) {
    let s = size; do { ctx.font = `${weight} ${s}px ${FONT}`; s -= 2; } while (ctx.measureText(text).width > maxW && s > 20);
  }

  async function showResultImage() {
    const btn = $('makeImage'); btn.disabled = true; btn.textContent = '生成中…';
    try {
      const list = matchMaps();
      const bans = S.steps.filter(s => s.kind === 'map' && s.action === 'ban');
      const W = 1080, P = 48, cardH = 300, gap = 22;
      const banRowH = bans.length ? 250 : 0;
      const H = 360 + list.length * (cardH + gap) + banRowH + 110;
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const ctx = cv.getContext('2d');
      const C = { bg: '#0f1923', panel: '#16222e', fg: '#ece8e1', muted: '#8b978f', A: '#3fd0b4', B: '#ff4655', gold: '#e8c46a' };
      const [logo, ...imgs] = await Promise.all([loadImg('/logo-mark-v2.png'), ...list.map(x => loadImg(mapImg(x.map))), ...bans.map(b => loadImg(mapImg(b.value)))]);
      const mapImgs = imgs.slice(0, list.length), banImgs = imgs.slice(list.length);

      // 背景
      ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(255,70,85,.06)'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(W * .55, 0); ctx.lineTo(0, H * .35); ctx.fill();

      // 页眉
      ctx.fillStyle = '#fff'; rrect(ctx, P, P, 84, 84, 14); ctx.fill();
      if (logo) { const s = 64; ctx.drawImage(logo, P + 10, P + 10, s, s); }
      ctx.fillStyle = C.fg; ctx.font = `800 40px ${FONT}`; ctx.textBaseline = 'alphabetic';
      ctx.fillText('蓝猫电竞', P + 108, P + 44);
      ctx.fillStyle = C.muted; ctx.font = `500 24px ${FONT}`;
      const d = new Date();
      ctx.fillText(`无畏契约 BP 结果 · ${S.config.format.toUpperCase()} · ${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, P + 108, P + 80);

      // 对阵
      const vy = 230;
      ctx.textAlign = 'center';
      ctx.fillStyle = C.muted; ctx.font = `800 36px ${FONT}`; ctx.fillText('VS', W / 2, vy);
      ctx.textAlign = 'right'; fitText(ctx, teamName('A'), 400, 52, 800); ctx.fillStyle = C.A; ctx.fillText(teamName('A'), W / 2 - 50, vy + 2);
      ctx.textAlign = 'left'; fitText(ctx, teamName('B'), 400, 52, 800); ctx.fillStyle = C.B; ctx.fillText(teamName('B'), W / 2 + 50, vy + 2);
      ctx.textAlign = 'center'; ctx.fillStyle = C.muted; ctx.font = `500 24px ${FONT}`;
      if (S.dice?.winner) ctx.fillText(`摇骰子 ${S.dice.A} : ${S.dice.B} · ${teamName(S.dice.winner)} 先手`, W / 2, vy + 52);
      ctx.textAlign = 'left';

      // 比赛地图
      let y = 330;
      list.forEach((x, i) => {
        const m = mapById(x.map), im = mapImgs[i];
        ctx.save(); rrect(ctx, P, y, W - 2 * P, cardH, 16); ctx.clip();
        if (im) coverDraw(ctx, im, P, y, W - 2 * P, cardH); else { ctx.fillStyle = C.panel; ctx.fillRect(P, y, W - 2 * P, cardH); }
        const g = ctx.createLinearGradient(0, y, 0, y + cardH); g.addColorStop(0, 'rgba(15,25,35,.1)'); g.addColorStop(.55, 'rgba(15,25,35,.45)'); g.addColorStop(1, 'rgba(15,25,35,.95)');
        ctx.fillStyle = g; ctx.fillRect(P, y, W - 2 * P, cardH);
        ctx.restore();
        const tagC = x.by ? C[x.by] : C.gold;
        ctx.fillStyle = tagC; rrect(ctx, P + 24, y + 22, 132, 46, 6); ctx.fill();
        ctx.fillStyle = C.bg; ctx.font = `800 26px ${FONT}`; ctx.fillText(x.by ? `第 ${i + 1} 图` : '决胜图', P + 40, y + 55);
        ctx.fillStyle = '#fff'; ctx.font = `900 64px ${FONT}`; ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 12;
        ctx.fillText(m.zh, P + 28, y + cardH - 76); ctx.shadowBlur = 0;
        const atk = x.side.value === 'attack' ? x.side.team : (x.side.team === 'A' ? 'B' : 'A');
        const parts = [[x.by ? teamName(x.by) : '决胜图', x.by ? C[x.by] : C.gold], [x.by ? ' 选图 · ' : ' · ', '#d6dbd8'], [teamName(atk), C[atk]], [' 进攻开局', '#d6dbd8']];
        ctx.font = `600 28px ${FONT}`; let px = P + 30;
        for (const [t, c] of parts) { ctx.fillStyle = c; ctx.fillText(t, px, y + cardH - 30); px += ctx.measureText(t).width; }
        y += cardH + gap;
      });

      // 禁用地图
      if (bans.length) {
        y += 18;
        ctx.fillStyle = C.muted; ctx.font = `700 26px ${FONT}`; ctx.fillText('禁用地图', P, y + 10);
        y += 34;
        const n = bans.length, bw = (W - 2 * P - (n - 1) * 14) / n, bh = Math.min(150, bw * .75);
        bans.forEach((b, i) => {
          const bx = P + i * (bw + 14), im = banImgs[i];
          ctx.save(); rrect(ctx, bx, y, bw, bh, 10); ctx.clip();
          if (im) { ctx.filter = 'grayscale(1) brightness(.55)'; coverDraw(ctx, im, bx, y, bw, bh); ctx.filter = 'none'; } else { ctx.fillStyle = C.panel; ctx.fillRect(bx, y, bw, bh); }
          ctx.restore();
          ctx.fillStyle = C[b.team]; ctx.fillRect(bx, y, bw, 6);
          ctx.textAlign = 'center';
          fitText(ctx, mapById(b.value).zh, bw - 16, 26, 800); ctx.fillStyle = '#fff'; ctx.fillText(mapById(b.value).zh, bx + bw / 2, y + bh / 2 + 6);
          fitText(ctx, teamName(b.team) + ' 禁', bw - 8, 22, 600); ctx.fillStyle = C[b.team]; ctx.fillText(teamName(b.team) + ' 禁', bx + bw / 2, y + bh + 32);
          ctx.textAlign = 'left';
        });
        y += bh + 50;
      }

      // 页脚
      ctx.fillStyle = 'rgba(139,151,143,.35)'; ctx.fillRect(P, H - 80, W - 2 * P, 1);
      ctx.fillStyle = C.muted; ctx.font = `500 22px ${FONT}`;
      ctx.fillText(`房间号 ${S.id}`, P, H - 40);
      ctx.textAlign = 'right'; ctx.fillText(location.host, W - P, H - 40); ctx.textAlign = 'left';

      const url = cv.toDataURL('image/png');
      $('resultImg').src = url;
      $('dlImg').href = url;
      $('dlImg').download = `BP结果_${teamName('A')}_vs_${teamName('B')}.png`;
      $('imgModal').hidden = false;
    } catch (e) {
      toast('生成图片失败，请重试');
    } finally {
      btn.disabled = false; btn.textContent = '生成结果图';
    }
  }

  // ---------- 顶部地图进度条 ----------
  function planSlots() {
    // 骰子还没摇时，步骤未生成：按赛制推出 BAN/PICK 顺序（队伍未知）
    if (S.steps.length) return S.steps.map((st, i) => ({ st, i })).filter(x => x.st.kind === 'map' || x.st.kind === 'decider');
    const n = S.config.pool.length, picks = { bo1: 0, bo3: 2, bo5: 4 }[S.config.format];
    const bans = n - 1 - picks, lead = S.config.format === 'bo1' ? bans : Math.min(2, bans);
    const order = [...Array(lead).fill('ban'), ...Array(picks).fill('pick'), ...Array(bans - lead).fill('ban')];
    return [...order.map(a => ({ st: { kind: 'map', action: a } })), { st: { kind: 'decider' } }];
  }
  function renderStrip(cur) {
    const slots = planSlots();
    const el = $('strip');
    el.style.setProperty('--n', slots.length);
    el.innerHTML = slots.map(({ st, i }) => {
      const t = st.kind === 'decider' ? 'D' : st.team || '';
      const lbl = st.kind === 'decider' ? 'DECIDER' : st.action === 'ban' ? 'BAN' : 'PICK';
      const lblZh = st.kind === 'decider' ? '决胜' : st.action === 'ban' ? '禁' : '选';
      const now = S.status === 'running' && i === S.cursor;
      const cls = `slot ${t} ${st.action || ''}${st.value ? ' filled' : ''}${now ? ' now' : ''}`;
      return `<div class="${cls}"${st.value ? bgStyle(mapImg(st.value)) : ''}><span class="lbl"><span class="en">${lbl}</span><span class="cn">${lblZh}</span></span><span class="val">${st.value ? esc(mapById(st.value).zh) : ''}</span></div>`;
    }).join('');
  }

  // ---------- 摇骰子 ----------
  const PIPS = { 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };
  const FACE_ROT = { 1: [0, 0], 2: [90, 0], 3: [0, -90], 4: [0, 90], 5: [-90, 0], 6: [0, -180] };
  let spins = 0, prevDice = null, cubeBuilt = false;
  function buildCube() {
    if (cubeBuilt) return; cubeBuilt = true;
    $('cube').innerHTML = [1, 2, 3, 4, 5, 6].map(n => `<div class="face f${n}">${PIPS[n].map(k =>
      `<i style="grid-row:${Math.ceil(k / 3)};grid-column:${(k - 1) % 3 + 1}"></i>`).join('')}</div>`).join('');
  }
  function rollCube(v) {
    spins += 2;
    const [fx, fy] = FACE_ROT[v];
    $('cube').parentElement.classList.remove('idle');
    $('cube').style.transform = `rotateX(-25deg) rotateY(35deg) rotateX(${fx + spins * 360}deg) rotateY(${fy + spins * 360}deg)`;
  }
  const animating = { A: false, B: false }, flickH = {};
  function flicker(t, v) {
    const el = $('ds' + t); let n = 0;
    animating[t] = true;
    clearInterval(flickH[t]);
    flickH[t] = setInterval(() => {
      if (++n > 12) { clearInterval(flickH[t]); animating[t] = false; renderDice(); return; }
      el.textContent = 1 + Math.floor(Math.random() * 6);
    }, 80);
  }
  function renderDice() {
    const panel = $('dicePanel');
    panel.hidden = S.status !== 'dice';
    const d = S.dice;
    if (panel.hidden || !d) { prevDice = d ? { ...d } : null; return; }
    buildCube();
    $('dsNameA').textContent = teamName('A');
    $('dsNameB').textContent = teamName('B');
    const newRound = !prevDice || prevDice.round !== d.round;
    for (const t of ['A', 'B']) {
      const was = newRound ? null : prevDice[t];
      if (d[t] != null && was == null) {
        flicker(t, d[t]);
        if (t === role || !isPlayer()) rollCube(d[t]);
      }
      if (d[t] == null) { clearInterval(flickH[t]); animating[t] = false; }
      if (!animating[t]) $('ds' + t).textContent = d[t] == null ? '?' : d[t];
    }
    if (newRound && (!isPlayer() ? d.A == null && d.B == null : d[role] == null)) $('cube').parentElement.classList.add('idle');
    prevDice = { ...d };

    const bothShown = d.A != null && d.B != null && !animating.A && !animating.B;
    $('dsA').parentElement.classList.toggle('win', bothShown && d.winner === 'A');
    $('dsB').parentElement.classList.toggle('win', bothShown && d.winner === 'B');
    const msg = $('diceMsg');
    if (bothShown && d.winner) msg.innerHTML = `${teamSpan(d.winner)} 点数大，先手！`;
    else if (bothShown && d.A === d.B) msg.textContent = `平局 ${d.A} : ${d.B}，马上重摇`;
    else if (d.ties.length && d.A == null && d.B == null) msg.textContent = `第 ${d.round} 轮（前面平局了）`;
    else msg.textContent = (d.Aauto || d.Bauto) && bothShown ? '超时的一方由系统代摇' : '';

    const btn = $('rollBtn');
    btn.hidden = !isPlayer() || !!d.winner;
    btn.disabled = d[role] != null;
    btn.textContent = d[role] == null ? '摇骰子' : '等待对手…';
  }

  // 倒计时
  function renderClock() {
    clearInterval(clockTimer);
    const clock = $('clock'), bar = $('bar');
    if ((S.status !== 'running' && S.status !== 'dice') || !S.deadline) { clock.hidden = true; bar.style.width = '0'; return; }
    clock.hidden = false;
    const total = S.config.timer * 1000;
    const tick = () => {
      const left = Math.max(0, S.deadline - (Date.now() + skew));
      clock.textContent = Math.ceil(left / 1000);
      clock.classList.toggle('low', left < 10000);
      bar.style.width = (left / total * 100) + '%';
    };
    tick(); clockTimer = setInterval(tick, 250);
  }

  // 二次确认：第一次点击高亮，再点一次才提交（防误触）
  let armed = null;
  function confirmAct(el, value, label) {
    if (armed && armed.value === value) { armed = null; $('toast').hidden = true; act(value); return; }
    document.querySelectorAll('.armed').forEach(x => x.classList.remove('armed'));
    armed = { value };
    el.classList.add('armed');
    toast(`再点一次确认：${label}`);
    clearTimeout(confirmAct.h); confirmAct.h = setTimeout(() => { armed = null; el.classList.remove('armed'); }, 3000);
  }

  function initRoom() {
    $('room').hidden = false;
    $('readyBtn').hidden = true;
    $('room').addEventListener('click', (e) => {
      const c = e.target.closest('[data-copy]'); if (c) copy(c.dataset.copy);
    });
    $('rollBtn').onclick = () => ws?.readyState === 1 && ws.send(JSON.stringify({ type: 'roll' }));
    $('copyCode').onclick = () => copy(S ? S.id : roomId);
    $('lobby').addEventListener('click', (e) => {
      const r = e.target.closest('[data-release]');
      if (r) ws?.send(JSON.stringify({ type: 'release', team: r.dataset.release }));
    });
    $('lobby').addEventListener('input', (e) => {
      const f = e.target.closest('[data-claim-form]'); if (f) claimDraft[f.dataset.claimForm] = e.target.value;
    });
    $('lobby').addEventListener('submit', (e) => {
      const f = e.target.closest('[data-claim-form]'); if (!f) return;
      e.preventDefault();
      const t = f.dataset.claimForm, name = $('claimName' + t).value.trim();
      if (!name) { toast('先填上战队名'); $('claimName' + t).focus(); return; }
      store.set('vbp-team-name', name);
      ws?.send(JSON.stringify({ type: 'claim', team: t, name }));
    });
    $('forceStart').onclick = () => ws.send(JSON.stringify({ type: 'start' }));
    let resetArmed = false;
    $('undoBtn').onclick = () => ws?.send(JSON.stringify({ type: 'undo' }));
    $('copyObs').onclick = () => copy($('obsUrl').textContent);
    $('closeImg').onclick = () => { $('imgModal').hidden = true; };
    $('imgModal').onclick = (e) => { if (e.target.id === 'imgModal') $('imgModal').hidden = true; };
    $('resetBtn').onclick = () => {
      if (!resetArmed) { resetArmed = true; $('resetHint').textContent = '再点一次确认清空所有操作'; setTimeout(() => { resetArmed = false; $('resetHint').textContent = ''; }, 3000); return; }
      resetArmed = false; $('resetHint').textContent = '';
      ws.send(JSON.stringify({ type: 'reset' }));
    };
    connect();
  }

  // ---------- 启动 ----------
  (async () => {
    META = await (await fetch('/api/meta')).json();
    if (location.pathname.startsWith('/r/') && roomId) initRoom();
    else initHome();
  })();
})();
