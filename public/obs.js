// OBS 直播画面：以观战身份连进房间，只显示不操作
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const roomId = location.pathname.split('/')[2];
  const params = new URLSearchParams(location.search);
  if (params.get('pos') === 'top') $('ov').classList.add('top');

  let META = { maps: [] }, S = null, skew = 0, retry = 0, clockTimer = null, prevFilled = new Set();
  const mapById = (id) => META.maps.find(m => m.id === id) || { id, zh: id };
  const name = (t) => S.config.teamNames[t];
  const span = (t) => `<span class="${t === 'A' ? 'ta' : 'tb'}">${esc(name(t))}</span>`;
  const LABEL = { ban: '禁', pick: '选' };

  function slots() {
    if (S.steps.length) return S.steps.map((st, i) => ({ st, i })).filter(x => x.st.kind === 'map' || x.st.kind === 'decider');
    const n = S.config.pool.length, picks = { bo1: 0, bo3: 2, bo5: 4 }[S.config.format];
    const bans = n - 1 - picks, lead = S.config.format === 'bo1' ? bans : Math.min(2, bans);
    const order = [...Array(lead).fill('ban'), ...Array(picks).fill('pick'), ...Array(bans - lead).fill('ban')];
    return [...order.map(a => ({ st: { kind: 'map', action: a } })), { st: { kind: 'decider' } }];
  }
  const sideFor = (i) => S.steps.find(x => x.kind === 'side' && x.mapStep === i);

  function render() {
    $('nA').textContent = name('A');
    $('nB').textContent = name('B');
    $('fmt').textContent = S.config.format.toUpperCase();
    const cur = S.steps[S.cursor];
    const turn = S.status === 'running' && cur ? cur.team : null;
    document.querySelector('.team.A').classList.toggle('turn', turn === 'A');
    document.querySelector('.team.B').classList.toggle('turn', turn === 'B');

    // 状态文字
    const st = $('st');
    if (S.status === 'waiting') st.textContent = '等待双方准备';
    else if (S.status === 'dice') {
      const d = S.dice;
      st.innerHTML = d.winner ? `骰子 ${d.A} : ${d.B} · ${span(d.winner)} 先手`
        : `摇骰子 ${d.A ?? '?'} : ${d.B ?? '?'}${d.A != null && d.A === d.B ? ' · 平局重摇' : ''}`;
    } else if (S.status === 'done') st.textContent = 'BP 完成';
    else if (cur.kind === 'side') st.innerHTML = `${span(cur.team)} 选择 ${esc(mapById(S.steps[cur.mapStep].value).zh)} 阵营`;
    else st.innerHTML = `${span(cur.team)} ${cur.action === 'ban' ? '禁用' : '选择'}地图`;

    // 地图卡
    const list = slots();
    const el = $('slots');
    el.style.setProperty('--n', list.length);
    const filledNow = new Set();
    el.innerHTML = list.map(({ st: s, i }) => {
      const t = s.kind === 'decider' ? 'D' : s.team || '';
      const lbl = s.kind === 'decider' ? '决胜' : LABEL[s.action];
      const isNow = S.status === 'running' && (i === S.cursor || (cur?.kind === 'side' && cur.mapStep === i));
      if (s.value) filledNow.add(i);
      const pop = s.value && i !== undefined && !prevFilled.has(i) ? ' pop' : '';
      const m = s.value ? mapById(s.value) : null;
      let sideTxt = '';
      if (s.value && (s.action === 'pick' || s.kind === 'decider')) {
        const sd = sideFor(i);
        if (sd?.value) { const atk = sd.value === 'attack' ? sd.team : (sd.team === 'A' ? 'B' : 'A'); sideTxt = `${esc(name(atk))} 进攻开局`; }
        else sideTxt = '待选边';
      }
      const bg = m?.img ? ` style="background-image:url('${esc(m.img)}')"` : '';
      return `<div class="slot ${t} ${s.action || ''}${s.value ? ' filled' : ' empty'}${isNow ? ' now' : ''}${pop}"${bg}>
        <span class="lbl">${lbl}</span>${s.team ? `<span class="who">${esc(name(s.team))}</span>` : ''}
        <span class="name">${m ? esc(m.zh) : '—'}</span>${sideTxt ? `<span class="side">${sideTxt}</span>` : ''}</div>`;
    }).join('');
    prevFilled = filledNow;

    // 倒计时
    clearInterval(clockTimer);
    const clock = $('clock');
    if ((S.status === 'running' || S.status === 'dice') && S.deadline) {
      clock.hidden = false;
      const tick = () => { const left = Math.max(0, S.deadline - (Date.now() + skew)); clock.textContent = Math.ceil(left / 1000); clock.classList.toggle('low', left < 10000); };
      tick(); clockTimer = setInterval(tick, 250);
    } else clock.hidden = true;
  }

  function connect() {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    ws.onopen = () => { retry = 0; $('ov').classList.remove('off'); ws.send(JSON.stringify({ type: 'join', room: roomId })); };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'state') { S = msg.state; skew = S.serverNow - Date.now(); render(); }
      if (msg.type === 'error' && msg.code === 'no_room') $('st').textContent = `房间 ${roomId} 不存在`;
    };
    ws.onclose = () => { $('ov').classList.add('off'); setTimeout(connect, Math.min(8000, 500 * 2 ** retry++)); };
  }

  fetch('/api/meta').then(r => r.json()).then(m => { META = m; if (S) render(); }).catch(() => {});
  connect();
})();
