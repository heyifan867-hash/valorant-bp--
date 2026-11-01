// 无畏契约 BP 前端：建房表单 + 房间实时视图（全部状态以服务器为准）
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const ROLE_ZH = { duelist: '决斗', initiator: '先锋', controller: '控场', sentinel: '哨位' };
  const ROLE_ORDER = ['duelist', 'initiator', 'controller', 'sentinel'];
  const SIDE_ZH = { attack: '进攻', defense: '防守' };
  const FORMAT_HINT = {
    bo1: '双方轮流禁图，剩下最后一张开打，另一方选边。',
    bo3: '禁 · 禁 · 选 · 选 · 禁 · 禁 · 决胜图。每选一张图，由对手选边。',
    bo5: '禁 · 禁 · 选 · 选 · 选 · 选 · 决胜图。每选一张图，由对手选边。',
  };
  const NEED = { bo1: 2, bo3: 3, bo5: 5 };

  let META = null;
  let IMG = { maps: {}, agents: {} };
  const mapById = (id) => META.maps.find(m => m.id === id) || { id, zh: id };
  const agentById = (id) => META.agents.find(a => a.id === id) || { id, zh: id };

  function toast(text) {
    const t = $('toast');
    t.textContent = text; t.hidden = false;
    clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), 2600);
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast('已复制'); }
    catch { window.prompt('复制下面的内容', text); }
  }

  // ---------- 图片（可选增强，国内访问不到也不影响使用） ----------
  async function loadImages() {
    const KEY = 'vbp-img-v1';
    try {
      const cached = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (cached && Date.now() - cached.t < 7 * 864e5) { IMG = cached; return true; }
    } catch {}
    const get = async (u) => {
      const ctl = new AbortController(); const h = setTimeout(() => ctl.abort(), 5000);
      try { const r = await fetch(u, { signal: ctl.signal }); return (await r.json()).data || []; }
      finally { clearTimeout(h); }
    };
    try {
      const [maps, agents] = await Promise.all([
        get('https://valorant-api.com/v1/maps'),
        get('https://valorant-api.com/v1/agents?isPlayableCharacter=true'),
      ]);
      const next = { t: Date.now(), maps: {}, agents: {} };
      for (const m of maps) if (m.displayName) next.maps[m.displayName.toLowerCase()] = m.splash || m.listViewIcon;
      for (const a of agents) if (a.displayName) next.agents[a.displayName.toLowerCase()] = a.displayIcon;
      IMG = next;
      try { localStorage.setItem(KEY, JSON.stringify(next)); } catch {}
      return true;
    } catch { return false; }
  }
  const mapImg = (id) => IMG.maps[id.toLowerCase()];
  const agentImg = (id) => IMG.agents[id.toLowerCase()];
  const bgStyle = (url) => (url ? ` style="background-image:url('${esc(url)}')"` : '');

  // ---------- 建房页 ----------
  function initHome() {
    $('home').hidden = false;
    let format = 'bo3';
    const pool = new Set(META.defaultPool);

    const renderPool = () => {
      $('poolChips').innerHTML = META.maps.map(m =>
        `<button type="button" class="chip${pool.has(m.id) ? ' on' : ''}" data-id="${esc(m.id)}" aria-pressed="${pool.has(m.id)}">${esc(m.zh)}<small>${esc(m.id)}</small></button>`
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

    $('createForm').onsubmit = async (e) => {
      e.preventDefault();
      const err = $('createError'); err.hidden = true;
      if (pool.size < NEED[format]) { err.textContent = `${format.toUpperCase()} 至少要选 ${NEED[format]} 张图`; err.hidden = false; return; }
      $('createBtn').disabled = true;
      try {
        const r = await fetch('/api/rooms', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            teamA: $('teamA').value, teamB: $('teamB').value, format,
            pool: META.maps.map(m => m.id).filter(id => pool.has(id)),
            first: $('first').value, timer: $('timer').value, agentBans: $('agentBans').value,
          }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || '创建失败');
        location.href = `/r/${data.id}?k=${data.tokens.admin}`;
      } catch (ex) {
        err.textContent = ex.message || '网络错误，请重试'; err.hidden = false;
        $('createBtn').disabled = false;
      }
    };
  }

  // ---------- 房间页 ----------
  let ws, role = 'spec', tokens = null, S = null, clockTimer = null, skew = 0, retry = 0, prevCursor = -1;
  const roomId = location.pathname.split('/')[2];
  const token = new URLSearchParams(location.search).get('k') || '';

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => { retry = 0; setConn(true); ws.send(JSON.stringify({ type: 'join', room: roomId, token })); };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'joined') { role = msg.role; tokens = msg.tokens || null; }
      else if (msg.type === 'state') { S = msg.state; skew = S.serverNow - Date.now(); render(); }
      else if (msg.type === 'error') {
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
    if (st.kind === 'agent') return '禁用特工';
    return '';
  }
  function stepValue(st) {
    if (!st.value) return '';
    if (st.kind === 'side') return `${SIDE_ZH[st.value]}开局 · ${mapById(S.steps[st.mapStep].value).zh}`;
    if (st.kind === 'agent') return agentById(st.value).zh;
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
    rb.textContent = isPlayer() ? `你是 ${teamName(role)}` : role === 'admin' ? '房主' : `观战 · ${S.online.spec + S.online.admin} 人`;
    document.title = `${teamName('A')} vs ${teamName('B')} · VETO 房间`;

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
        el.className = 'ready-card' + (S.ready[t] ? ' ok' : '');
        el.innerHTML = `<span>${teamSpan(t)}</span><span class="st">${S.ready[t] ? '已准备' : S.online[t] ? '在线，未准备' : '还没进房间'}</span>`;
      }
      const rbtn = $('readyBtn');
      rbtn.hidden = !isPlayer();
      if (isPlayer()) {
        rbtn.textContent = S.ready[role] ? '取消准备' : '准备';
        rbtn.onclick = () => ws.send(JSON.stringify({ type: 'ready', value: !S.ready[role] }));
      }
      $('forceStart').hidden = role !== 'admin';
      $('shareBox').hidden = role !== 'admin' || !tokens;
      if (tokens) {
        const base = `${location.origin}/r/${S.id}`;
        const rows = [
          [teamName('A') + ' 队长', `${base}?k=${tokens.A}`],
          [teamName('B') + ' 队长', `${base}?k=${tokens.B}`],
          ['观战', base],
          ['房主（你）', `${base}?k=${tokens.admin}`],
        ];
        $('links').innerHTML = rows.map(([n, u]) =>
          `<div class="link-row"><b>${esc(n)}</b><code>${esc(u)}</code><button class="btn ghost small" data-copy="${esc(u)}">复制</button></div>`).join('');
      }
    }
    $('adminBox').hidden = role !== 'admin';

    renderStrip(cur);
    renderDice();
    renderStage(cur, myTurn);
    renderTimeline();
    renderClock();
  }

  function renderStage(cur, myTurn) {
    const states = mapStates();
    $('mapGrid').closest('.board').hidden = S.status === 'dice';
    const inAgent = S.status === 'running' && cur.kind === 'agent';
    const inSide = S.status === 'running' && cur.kind === 'side';
    const done = S.status === 'done';

    // 地图
    const grid = $('mapGrid');
    grid.hidden = inAgent || inSide || done;
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
        return `<button class="${cls}" data-map="${esc(id)}" ${label}${bgStyle(mapImg(id))}>${tag}<span class="nm"><b>${esc(m.id)}</b><span>${esc(m.zh)}</span></span></button>`;
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
        <div class="map map-wide"${bgStyle(mapImg(mid))}><span class="tag D">${picker}</span><span class="nm"><b>${esc(m.id)}</b><span>${esc(m.zh)}</span></span></div>
        <div class="side-btns">
          <button class="side-btn" data-side="attack" ${myTurn ? '' : 'disabled'}><b>进攻</b><span>上半场进攻方</span></button>
          <button class="side-btn" data-side="defense" ${myTurn ? '' : 'disabled'}><b>防守</b><span>上半场防守方</span></button>
        </div>`;
      side.onclick = (e) => {
        const b = e.target.closest('.side-btn:not(:disabled)'); if (!b) return;
        confirmAct(b, b.dataset.side, `${SIDE_ZH[b.dataset.side]}开局`);
      };
    }

    // 特工
    const ag = $('agentGrid');
    ag.hidden = !inAgent;
    if (inAgent) {
      const bans = {};
      for (const st of S.steps) if (st.kind === 'agent' && st.value) bans[st.value] = st.team;
      const canPick = myTurn;
      ag.innerHTML = ROLE_ORDER.map(r => `<div class="role"><h4>${ROLE_ZH[r]}</h4><div class="agents">${
        META.agents.filter(a => a.role === r).map(a => {
          const b = bans[a.id];
          const cls = 'agent' + (b ? ` banned ban-${b}` : canPick ? ' clickable' : '');
          const img = agentImg(a.id);
          return `<button class="${cls}" data-agent="${esc(a.id)}" ${b || !canPick ? 'tabindex="-1"' : ''}><span class="face"${bgStyle(img)}>${img ? '' : esc(a.zh[0])}</span><span>${esc(a.zh)}</span></button>`;
        }).join('')}</div></div>`).join('');
      ag.onclick = (e) => {
        const b = e.target.closest('.agent.clickable'); if (!b) return;
        confirmAct(b, b.dataset.agent, `禁用 ${agentById(b.dataset.agent).zh}`);
      };
    }

    // 结果
    const sum = $('summary');
    sum.hidden = !done;
    if (done) {
      const list = matchMaps();
      const agentBans = S.steps.filter(s => s.kind === 'agent');
      sum.innerHTML = `
        <div class="sum-head"><h3>比赛地图</h3><button class="btn primary small" id="copyResult">复制结果</button></div>
        <div class="sum-maps">${list.map((x, i) => {
          const m = mapById(x.map);
          const sideTeam = x.side.team;
          const sideTxt = `${teamSpan(sideTeam)} 选择 <b style="font-size:inherit">${SIDE_ZH[x.side.value]}</b> 开局，${teamSpan(sideTeam === 'A' ? 'B' : 'A')} ${x.side.value === 'attack' ? '防守' : '进攻'}`;
          return `<div class="sum-map"><span class="no">${i + 1}</span><div class="body"${bgStyle(mapImg(x.map))}>
            <b>${esc(m.zh)} <small style="font-size:14px;opacity:.7">${esc(m.id)}</small></b>
            <p>${x.by ? `${teamSpan(x.by)} 选图` : '决胜图'} · ${sideTxt}</p></div></div>`;
        }).join('')}</div>
        ${agentBans.length ? `<p class="sum-bans">禁用特工：${agentBans.map(s => `${esc(agentById(s.value).zh)}（${teamSpan(s.team)}）`).join('、')}</p>` : ''}`;
      $('copyResult').onclick = () => copy(resultText());
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
    const ab = S.steps.filter(s => s.kind === 'agent');
    if (ab.length) lines.push(`禁用特工：${ab.map(s => `${agentById(s.value).zh}(${teamName(s.team)})`).join('、')}`);
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
      const now = S.status === 'running' && i === S.cursor;
      const cls = `slot ${t} ${st.action || ''}${st.value ? ' filled' : ''}${now ? ' now' : ''}`;
      return `<div class="${cls}"${st.value ? bgStyle(mapImg(st.value)) : ''}><span class="lbl">${lbl}</span><span class="val">${st.value ? esc(mapById(st.value).zh) : ''}</span></div>`;
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
    $('forceStart').onclick = () => ws.send(JSON.stringify({ type: 'start' }));
    let resetArmed = false;
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
    const imgs = loadImages().then(ok => { if (ok && S) render(); });
    if (location.pathname.startsWith('/r/') && roomId) initRoom();
    else initHome();
    await imgs;
  })();
})();
