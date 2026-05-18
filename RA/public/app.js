const app = document.getElementById('app');
const toastEl = document.getElementById('toast');
const SESSION_KEY = 'ra-online-cn-session';

const TYPE_LABEL = {
  god: '神祇',
  gold: '黄金',
  pharaoh: '法老',
  nile: '尼罗河',
  flood: '洪水',
  civilization: '文明',
  monument: '纪念碑',
  disaster: '灾难',
  ra: 'Ra'
};

const DISASTER_LABEL = {
  funeral: '葬礼',
  drought: '干旱',
  war: '战争',
  earthquake: '地震'
};

let state = null;
let eventSource = null;
let godSelection = [];
let disasterSelection = [];
let toastTimer = null;

app.addEventListener('click', handleClick);
app.addEventListener('submit', handleSubmit);

restoreSession();

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function readSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveSession(data) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(data));
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

async function restoreSession() {
  const session = readSession();
  if (!session.roomCode || !session.playerId) {
    render();
    return;
  }
  app.innerHTML = renderLoading('正在恢复房间');
  try {
    const result = await getJson(`/api/state?roomCode=${encodeURIComponent(session.roomCode)}&playerId=${encodeURIComponent(session.playerId)}`);
    state = result.state;
    connectEvents(session.roomCode, session.playerId);
    render();
  } catch {
    clearSession();
    state = null;
    render();
  }
}

function connectEvents(roomCode, playerId) {
  if (eventSource) eventSource.close();
  eventSource = new EventSource(`/events?roomCode=${encodeURIComponent(roomCode)}&playerId=${encodeURIComponent(playerId)}`);
  eventSource.addEventListener('state', event => {
    state = JSON.parse(event.data);
    syncSelections();
    render();
  });
  eventSource.onerror = () => {
    showToast('连接正在重试');
  };
}

async function getJson(url) {
  const res = await fetch(url, { cache: 'no-store' });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || '请求失败');
  return data;
}

async function postJson(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || '请求失败');
  return data;
}

async function createRoom(name) {
  const result = await postJson('/api/create', { name });
  state = result.state;
  saveSession({ roomCode: result.roomCode, playerId: result.playerId, name });
  connectEvents(result.roomCode, result.playerId);
  render();
}

async function joinRoom(roomCode, name) {
  const result = await postJson('/api/join', { roomCode, name });
  state = result.state;
  saveSession({ roomCode: result.roomCode, playerId: result.playerId, name });
  connectEvents(result.roomCode, result.playerId);
  render();
}

async function sendAction(action, payload = {}) {
  if (!state?.me) return;
  try {
    const result = await postJson('/api/action', {
      roomCode: state.code,
      playerId: state.me.id,
      action,
      ...payload
    });
    state = result.state;
    if (action === 'useGod') godSelection = [];
    if (action === 'resolveDisaster') disasterSelection = [];
    syncSelections();
    render();
  } catch (err) {
    showToast(err.message);
  }
}

function handleSubmit(event) {
  const form = event.target.closest('form');
  if (!form) return;
  event.preventDefault();
  const formData = new FormData(form);
  const name = String(formData.get('name') || '').trim();
  if (form.id === 'createForm') {
    if (!name) return showToast('请输入昵称');
    createRoom(name).catch(err => showToast(err.message));
  }
  if (form.id === 'joinForm') {
    const roomCode = String(formData.get('roomCode') || '').trim().toUpperCase();
    if (!name || !roomCode) return showToast('请输入房号和昵称');
    joinRoom(roomCode, name).catch(err => showToast(err.message));
  }
}

function handleClick(event) {
  const godTile = event.target.closest('[data-god-id]');
  if (godTile && !godTile.disabled) {
    toggleGodSelection(godTile.dataset.godId);
    return;
  }
  const disasterTile = event.target.closest('[data-disaster-id]');
  if (disasterTile && !disasterTile.disabled) {
    toggleDisasterSelection(disasterTile.dataset.disasterId);
    return;
  }
  const actionEl = event.target.closest('[data-action]');
  if (!actionEl || actionEl.disabled) return;
  const action = actionEl.dataset.action;

  if (action === 'leave') {
    if (eventSource) eventSource.close();
    eventSource = null;
    clearSession();
    state = null;
    godSelection = [];
    disasterSelection = [];
    render();
    return;
  }
  if (action === 'copy') {
    copyRoomCode();
    return;
  }
  if (action === 'start') {
    sendAction('start');
    return;
  }
  if (action === 'restart') {
    sendAction('restart');
    return;
  }
  if (action === 'draw') {
    sendAction('draw');
    return;
  }
  if (action === 'invokeRa') {
    sendAction('invokeRa');
    return;
  }
  if (action === 'pass') {
    sendAction('pass');
    return;
  }
  if (action === 'bid') {
    sendAction('bid', { value: Number(actionEl.dataset.value) });
    return;
  }
  if (action === 'confirmGod') {
    if (godSelection.length === 0) return showToast('请选择要换取的牌');
    sendAction('useGod', { tileIds: godSelection.slice() });
    return;
  }
  if (action === 'confirmDisaster') {
    const required = Number(actionEl.dataset.required || 0);
    if (disasterSelection.length !== required) return showToast(`请选择 ${required} 块牌`);
    sendAction('resolveDisaster', { tileIds: disasterSelection.slice() });
  }
}

function toggleGodSelection(tileId) {
  const me = myPlayer();
  const godCount = (me?.tiles || []).filter(tile => tile.type === 'god').length;
  if (godSelection.includes(tileId)) {
    godSelection = godSelection.filter(id => id !== tileId);
  } else {
    if (godSelection.length >= godCount) return showToast(`最多选择 ${godCount} 块牌`);
    godSelection.push(tileId);
  }
  render();
}

function toggleDisasterSelection(tileId) {
  const current = state?.game?.pendingDisaster?.current;
  if (!current) return;
  if (disasterSelection.includes(tileId)) {
    disasterSelection = disasterSelection.filter(id => id !== tileId);
  } else {
    if (disasterSelection.length >= current.required) return showToast(`请选择 ${current.required} 块牌`);
    disasterSelection.push(tileId);
  }
  render();
}

function syncSelections() {
  if (!state) {
    godSelection = [];
    disasterSelection = [];
    return;
  }
  const me = myPlayer();
  const godCount = (me?.tiles || []).filter(tile => tile.type === 'god').length;
  const eligibleGodIds = new Set((state.game.auctionTrack || [])
    .filter(tile => tile && tile.type !== 'god')
    .map(tile => tile.id));
  godSelection = godSelection.filter(id => eligibleGodIds.has(id)).slice(0, godCount);

  const pending = state.game.pendingDisaster;
  if (pending?.current) {
    const eligible = new Set(pending.current.eligible.map(item => item.id));
    disasterSelection = disasterSelection.filter(id => eligible.has(id)).slice(0, pending.current.required);
  } else {
    disasterSelection = [];
  }
}

function showToast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
}

async function copyRoomCode() {
  if (!state?.code) return;
  try {
    await navigator.clipboard.writeText(state.code);
    showToast('房号已复制');
  } catch {
    showToast(`房号：${state.code}`);
  }
}

function render() {
  syncSelections();
  if (!state) {
    app.innerHTML = renderHome();
    return;
  }
  if (state.game.phase === 'lobby') {
    app.innerHTML = renderLobby();
    return;
  }
  app.innerHTML = renderGame();
}

function renderLoading(text) {
  return `
    <main class="lobby-wrap">
      <section class="lobby-card">
        <div class="brand">
          <div class="brand-mark">Ra</div>
          <div>
            <h1>RA 太阳神 在线版</h1>
            <p>${escapeHtml(text)}</p>
          </div>
        </div>
      </section>
    </main>
  `;
}

function renderHome() {
  const session = readSession();
  const lastName = escapeHtml(session.name || '');
  return `
    <main class="lobby-wrap">
      <section class="lobby-card">
        <div class="brand">
          <div class="brand-mark">Ra</div>
          <div>
            <h1>RA 太阳神 在线版</h1>
            <p>2 到 5 人，无账号，打开同一个地址即可开局。</p>
          </div>
        </div>
        <div class="lobby-grid">
          <form id="createForm" class="form-card">
            <h2>创建房间</h2>
            <div class="field">
              <label for="createName">昵称</label>
              <input id="createName" name="name" maxlength="20" autocomplete="name" value="${lastName}" required>
            </div>
            <button class="btn primary" type="submit">创建</button>
          </form>
          <form id="joinForm" class="form-card">
            <h2>加入房间</h2>
            <div class="field">
              <label for="joinCode">房号</label>
              <input id="joinCode" name="roomCode" maxlength="8" autocomplete="off" required>
            </div>
            <div class="field">
              <label for="joinName">昵称</label>
              <input id="joinName" name="name" maxlength="20" autocomplete="name" value="${lastName}" required>
            </div>
            <button class="btn primary" type="submit">加入</button>
          </form>
        </div>
      </section>
    </main>
  `;
}

function renderLobby() {
  const canStart = state.players.length >= 2 && state.me?.seat === 0;
  return `
    <main class="app-shell">
      ${renderTopbar('等待开局')}
      <section class="panel">
        <div class="panel-title">
          <h2>房间 ${escapeHtml(state.code)}</h2>
          <div class="btn-row">
            <button class="btn ghost" type="button" data-action="copy">复制房号</button>
            <button class="btn ghost" type="button" data-action="leave">离开</button>
          </div>
        </div>
        <p class="muted">满 2 人即可开始，最多 5 人。座次按加入顺序排列。</p>
        <div class="room-list">
          ${state.players.map(player => `
            <span class="room-player">
              ${escapeHtml(player.name)}${player.isYou ? '（你）' : ''}
            </span>
          `).join('')}
        </div>
        <div class="btn-row" style="margin-top:16px">
          <button class="btn primary" type="button" data-action="start" ${canStart ? '' : 'disabled'}>开始游戏</button>
          ${state.me?.seat === 0 ? '<span class="muted">由房主开始</span>' : '<span class="muted">等待房主开始</span>'}
        </div>
      </section>
    </main>
  `;
}

function renderGame() {
  return `
    <main class="app-shell">
      ${renderTopbar(phaseText())}
      <div class="layout">
        <div class="board">
          ${renderBoard()}
          ${renderActionPanel()}
          ${renderPlayers()}
        </div>
        <aside class="side-stack">
          ${renderRules()}
          ${renderLog()}
        </aside>
      </div>
    </main>
  `;
}

function renderTopbar(status) {
  const game = state?.game || {};
  return `
    <header class="topbar">
      <div class="brand">
        <div class="brand-mark">Ra</div>
        <div>
          <h1>RA 太阳神</h1>
          <p>${escapeHtml(status)}</p>
        </div>
      </div>
      <div class="status-strip">
        <span class="pill">房号 <strong>${escapeHtml(state?.code || '-')}</strong></span>
        ${game.phase && game.phase !== 'lobby' ? `
          <span class="pill">纪元 <strong>${game.epoch}</strong></span>
          <span class="pill">牌袋 <strong>${game.bagCount}</strong></span>
          <span class="pill">Ra <strong>${game.raCount}/${game.raLimit}</strong></span>
        ` : ''}
        <button class="btn ghost" type="button" data-action="copy">复制房号</button>
        <button class="btn ghost" type="button" data-action="leave">离开</button>
      </div>
    </header>
  `;
}

function phaseText() {
  const game = state.game;
  if (game.phase === 'main') {
    const player = playerBySeat(game.currentPlayerSeat);
    return `${player?.name || '玩家'} 行动`;
  }
  if (game.phase === 'auction') {
    const bidder = currentBidder();
    return bidder ? `${bidder.name} 出价` : '拍卖结算';
  }
  if (game.phase === 'disaster') {
    const player = playerBySeat(game.pendingDisaster?.seat);
    return `${player?.name || '玩家'} 结算灾难`;
  }
  if (game.phase === 'gameover') return '游戏结束';
  return '对局中';
}

function renderBoard() {
  const game = state.game;
  return `
    <section class="panel">
      <div class="panel-title">
        <h2>场面</h2>
        <div class="center-sun" title="中央太阳盘">${game.centerSun ?? '-'}</div>
      </div>
      <div class="ra-board">
        <div class="panel-title">
          <h3>Ra 轨</h3>
          <span>${game.raCount}/${game.raLimit}</span>
        </div>
        <div class="ra-track">
          ${renderRaTrack()}
        </div>
      </div>
    </section>
    <section class="panel">
      <div class="panel-title">
        <h2>拍卖轨道</h2>
        <span class="muted">8 格</span>
      </div>
      <div class="auction-area">
        ${state.game.auctionTrack.map((tile, index) => `
          <div class="auction-slot ${tile ? '' : 'empty'}" title="第 ${index + 1} 格">
            ${tile ? renderTile(tile, {
              selectable: canSelectGodTile(tile),
              selected: godSelection.includes(tile.id),
              attr: canSelectGodTile(tile) ? `data-god-id="${escapeHtml(tile.id)}"` : ''
            }) : ''}
          </div>
        `).join('')}
      </div>
    </section>
  `;
}

function renderRaTrack() {
  const game = state.game;
  const boat = Math.min(9, game.raStartIndex + game.raCount);
  return Array.from({ length: 10 }, (_, index) => {
    const classes = ['ra-space'];
    if (index < game.raStartIndex) classes.push('unused');
    if (index > game.raStartIndex && index <= boat) classes.push('passed');
    if (index === boat && game.phase !== 'gameover') classes.push('boat');
    return `<div class="${classes.join(' ')}" title="Ra 轨第 ${index + 1} 格"></div>`;
  }).join('');
}

function renderActionPanel() {
  const game = state.game;
  if (game.phase === 'gameover') return renderGameOver();
  if (game.phase === 'main') return renderMainActions();
  if (game.phase === 'auction') return renderAuctionActions();
  if (game.phase === 'disaster') return renderDisasterActions();
  return '';
}

function renderMainActions() {
  const me = myPlayer();
  const yourTurn = state.game.currentPlayerSeat === state.me?.seat;
  const current = playerBySeat(state.game.currentPlayerSeat);
  const fullTrack = state.game.auctionTrack.every(Boolean);
  const godCount = (me?.tiles || []).filter(tile => tile.type === 'god').length;
  const eligibleGodTiles = state.game.auctionTrack.filter(tile => tile && tile.type !== 'god');

  if (!yourTurn) {
    return `
      <section class="panel action-panel">
        <div class="notice">等待 ${escapeHtml(current?.name || '玩家')} 行动。</div>
      </section>
    `;
  }

  return `
    <section class="panel action-panel">
      <div class="panel-title">
        <h2>你的行动</h2>
        ${fullTrack ? '<span class="pill">轨道已满</span>' : ''}
      </div>
      <div class="btn-row">
        <button class="btn primary" type="button" data-action="draw" ${fullTrack ? 'disabled' : ''}>抽一块牌</button>
        <button class="btn warn" type="button" data-action="invokeRa">召唤 Ra</button>
      </div>
      ${godCount > 0 && eligibleGodTiles.length > 0 ? `
        <div class="notice">
          神祇可用：${godCount} 枚。已选择 ${godSelection.length} 块。
        </div>
        <div class="btn-row">
          <button class="btn primary" type="button" data-action="confirmGod" ${godSelection.length ? '' : 'disabled'}>使用神祇换牌</button>
        </div>
      ` : godCount > 0 ? '<div class="notice">拍卖轨道没有可用神祇换取的牌。</div>' : ''}
    </section>
  `;
}

function renderAuctionActions() {
  const auction = state.game.auction;
  const bidderSeat = auction.order[auction.index];
  const bidder = playerBySeat(bidderSeat);
  const me = myPlayer();
  const high = auction.highBid?.value || 0;
  const yourBid = bidderSeat === state.me?.seat;
  const legalSuns = (me?.suns || []).filter(sun => sun.faceUp && sun.value > high).sort((a, b) => a.value - b.value);
  const mandatory = auction.trigger === 'ra' && !auction.highBid && auction.raPlayerSeat === state.me?.seat;

  if (!yourBid) {
    return `
      <section class="panel action-panel">
        <div class="notice">
          拍卖中，等待 ${escapeHtml(bidder?.name || '玩家')}。
          当前最高价：${auction.highBid ? `${escapeHtml(playerBySeat(auction.highBid.seat)?.name || '')} ${auction.highBid.value}` : '无'}
        </div>
      </section>
    `;
  }

  return `
    <section class="panel action-panel">
      <div class="panel-title">
        <h2>拍卖出价</h2>
        <span class="pill">最高价 <strong>${high || '无'}</strong></span>
      </div>
      <div class="bid-grid">
        ${legalSuns.map(sun => `
          <button class="sun sun-bid" type="button" data-action="bid" data-value="${sun.value}" title="出价 ${sun.value}">${sun.value}</button>
        `).join('')}
      </div>
      <div class="btn-row">
        <button class="btn ghost" type="button" data-action="pass" ${mandatory ? 'disabled' : ''}>放弃</button>
        ${mandatory ? '<span class="muted">无人出价时，召唤者必须出价。</span>' : ''}
      </div>
    </section>
  `;
}

function renderDisasterActions() {
  const pending = state.game.pendingDisaster;
  const player = playerBySeat(pending?.seat);
  if (!pending?.current) {
    return `
      <section class="panel action-panel">
        <div class="notice">正在结算 ${escapeHtml(player?.name || '玩家')} 的灾难。</div>
      </section>
    `;
  }
  if (pending.seat !== state.me?.seat) {
    return `
      <section class="panel action-panel">
        <div class="notice">等待 ${escapeHtml(player?.name || '玩家')} 为 ${escapeHtml(pending.current.name)} 弃牌。</div>
      </section>
    `;
  }
  return `
    <section class="panel action-panel">
      <div class="panel-title">
        <h2>${escapeHtml(pending.current.name)} 弃牌</h2>
        <span class="pill">需选 <strong>${pending.current.required}</strong></span>
      </div>
      <div class="tile-list">
        ${pending.current.eligible.map(item => {
          const tile = findTileById(item.id);
          return renderTile(tile || { id: item.id, type: 'disaster', name: item.label }, {
            small: false,
            selectable: true,
            selected: disasterSelection.includes(item.id),
            attr: `data-disaster-id="${escapeHtml(item.id)}"`
          });
        }).join('')}
      </div>
      <div class="btn-row">
        <button class="btn primary" type="button" data-action="confirmDisaster" data-required="${pending.current.required}" ${disasterSelection.length === pending.current.required ? '' : 'disabled'}>确认弃牌</button>
      </div>
    </section>
  `;
}

function renderGameOver() {
  const winners = (state.game.gameOver?.winners || []).map(seat => playerBySeat(seat)?.name).filter(Boolean);
  return `
    <section class="panel action-panel">
      <div class="panel-title">
        <h2>游戏结束</h2>
        <span class="pill">胜者 <strong>${escapeHtml(winners.join('、') || '-')}</strong></span>
      </div>
      <div class="notice">${escapeHtml(state.game.gameOver?.reason || '三纪元结束')}。</div>
      ${state.me?.seat === 0 ? `
        <div class="btn-row">
          <button class="btn primary" type="button" data-action="restart">重新开局</button>
        </div>
      ` : ''}
    </section>
  `;
}

function renderPlayers() {
  return `
    <section class="panel">
      <div class="panel-title">
        <h2>玩家区域</h2>
        <span class="muted">分数按实体规则隐藏，自己和终局可见。</span>
      </div>
      <div class="players-grid">
        ${state.players.map(renderPlayer).join('')}
      </div>
    </section>
  `;
}

function renderPlayer(player) {
  const active = state.game.currentPlayerSeat === player.seat || currentBidder()?.seat === player.seat || state.game.pendingDisaster?.seat === player.seat;
  const score = player.score == null ? '隐藏' : player.score;
  const color = escapeHtml(player.color || '#0f766e');
  return `
    <article class="player-card ${active ? 'active' : ''}">
      <div class="player-head">
        <div class="player-name">
          <span class="seat-dot" style="background:${color}"></span>
          <span>${escapeHtml(player.name)}${player.isYou ? '（你）' : ''}</span>
        </div>
        <span class="score">声望 ${escapeHtml(score)}</span>
      </div>
      <div class="sun-row">
        ${player.suns.map(sun => `<span class="sun ${sun.faceUp ? '' : 'down'}" title="${sun.faceUp ? '可用' : '已用'}">${sun.value}</span>`).join('')}
      </div>
      <div class="tile-groups">
        ${renderTileGroup(player, '王权与河流', ['pharaoh', 'nile', 'flood'])}
        ${renderTileGroup(player, '神祇、黄金、文明', ['god', 'gold', 'civilization'])}
        ${renderTileGroup(player, '纪念碑', ['monument'])}
      </div>
    </article>
  `;
}

function renderTileGroup(player, title, types) {
  const tiles = player.tiles.filter(tile => types.includes(tile.type));
  return `
    <div class="tile-group">
      <div class="tile-group-title">
        <span>${escapeHtml(title)}</span>
        <span>${tiles.length}</span>
      </div>
      <div class="tile-list">
        ${tiles.length ? tiles.map(tile => {
          const selectable = canSelectDisasterTile(player, tile);
          return renderTile(tile, {
            small: true,
            selectable,
            selected: disasterSelection.includes(tile.id),
            attr: selectable ? `data-disaster-id="${escapeHtml(tile.id)}"` : ''
          });
        }).join('') : '<span class="muted">无</span>'}
      </div>
    </div>
  `;
}

function renderRules() {
  return `
    <details class="rules-panel" open>
      <summary>规则速览</summary>
      <ul>
        <li>每回合执行一项：抽牌、召唤 Ra、或弃神祇从拍卖轨道换非神祇牌。</li>
        <li>抽到 Ra 牌推进 Ra 轨并立即拍卖；Ra 轨满则本纪元立刻结算。</li>
        <li>拍卖从召唤者左手边开始，每人最多一次机会；高价必须超过当前最高价。</li>
        <li>自愿召唤 Ra 时，若无人出价，召唤者必须出价；满轨召唤时可以全部放弃并弃置场面牌。</li>
        <li>灾难立即结算：葬礼弃法老，干旱先弃洪水再弃尼罗河，战争弃文明，地震弃纪念碑，每次最多两块。</li>
        <li>每纪元计分：法老最多 +5、最少 -2；洪水每块 +1，并让尼罗河每块 +1；神祇 +2，黄金 +3；文明 0 种 -5，3/4/5 种得 5/10/15。</li>
        <li>第三纪元额外计分：纪念碑不同种类 1-6 种得同数分、7 种 10、8 种 15；同种 3/4/5 块得 5/10/15；太阳盘总值最高 +5、最低 -5。</li>
      </ul>
    </details>
  `;
}

function renderLog() {
  return `
    <section class="log-panel">
      <div class="panel-title">
        <h2>记录</h2>
      </div>
      <div class="log-list">
        ${(state.game.log || []).slice().reverse().map(item => `
          <div class="log-item">${escapeHtml(item.text)}</div>
        `).join('')}
      </div>
    </section>
  `;
}

function renderTile(tile, options = {}) {
  if (!tile) return '';
  const small = options.small ? 'small' : '';
  const selectable = options.selectable ? 'selectable' : '';
  const selected = options.selected ? 'selected' : '';
  const classes = `tile tile-${escapeHtml(tile.type)} ${small} ${selectable} ${selected}`.trim();
  const label = tileName(tile);
  const type = tileTypeName(tile);
  const attr = options.attr || '';
  const tag = options.selectable ? 'button type="button"' : 'div';
  const close = options.selectable ? 'button' : 'div';
  return `
    <${tag} class="${classes}" ${attr} title="${escapeHtml(type)}：${escapeHtml(label)}">
      <span>
        <span class="tile-name">${escapeHtml(label)}</span>
        <span class="tile-type">${escapeHtml(type)}</span>
      </span>
    </${close}>
  `;
}

function tileName(tile) {
  if (!tile) return '';
  if (tile.type === 'disaster') return DISASTER_LABEL[tile.kind] || tile.name || '灾难';
  if (tile.type === 'civilization' || tile.type === 'monument') return tile.name || TYPE_LABEL[tile.type];
  return TYPE_LABEL[tile.type] || tile.type;
}

function tileTypeName(tile) {
  if (!tile) return '';
  if (tile.type === 'civilization') return '文明';
  if (tile.type === 'monument') return '纪念碑';
  return TYPE_LABEL[tile.type] || tile.type;
}

function myPlayer() {
  return state?.players.find(player => player.isYou) || null;
}

function playerBySeat(seat) {
  return state?.players.find(player => player.seat === seat) || null;
}

function currentBidder() {
  const auction = state?.game?.auction;
  if (!auction) return null;
  return playerBySeat(auction.order[auction.index]);
}

function findTileById(tileId) {
  for (const tile of state.game.auctionTrack) {
    if (tile?.id === tileId) return tile;
  }
  for (const player of state.players) {
    for (const tile of player.tiles) {
      if (tile.id === tileId) return tile;
    }
  }
  return null;
}

function canSelectGodTile(tile) {
  if (!tile || tile.type === 'god') return false;
  if (state.game.phase !== 'main') return false;
  if (state.game.currentPlayerSeat !== state.me?.seat) return false;
  const me = myPlayer();
  return (me?.tiles || []).some(t => t.type === 'god');
}

function canSelectDisasterTile(player, tile) {
  const pending = state.game.pendingDisaster;
  if (!pending?.current) return false;
  if (pending.seat !== state.me?.seat) return false;
  if (player.seat !== pending.seat) return false;
  return pending.current.eligible.some(item => item.id === tile.id);
}
