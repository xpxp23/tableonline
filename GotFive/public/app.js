const app = document.getElementById('app');
const connection = document.getElementById('connection');
const toast = document.getElementById('toast');

let state = null;
let source = null;
let selectedTileId = null;
let clueType = 'category';
let compareIndex = 0;
let responderId = null;
let guessValues = ['', '', '', '', ''];
let notesKey = null;
let manualMarks = {};
let toastTimer = null;

const params = new URLSearchParams(window.location.search);
const initialRoom = (params.get('room') || localStorage.getItem('gotfive.lastRoom') || '').toUpperCase();

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
}

function setConnection(text, good = false) {
  connection.textContent = text;
  connection.classList.toggle('badge', good);
  connection.classList.toggle('good', good);
}

function identityKey(roomCode) {
  return `gotfive.identity.${String(roomCode || '').toUpperCase()}`;
}

function getIdentity(roomCode) {
  try {
    return JSON.parse(localStorage.getItem(identityKey(roomCode)) || 'null');
  } catch {
    return null;
  }
}

function saveIdentity(roomCode, playerId, name) {
  const code = String(roomCode || '').toUpperCase();
  localStorage.setItem(identityKey(code), JSON.stringify({ roomCode: code, playerId, name }));
  localStorage.setItem('gotfive.lastRoom', code);
  localStorage.setItem('gotfive.name', name || '');
}

function noteKey() {
  if (!state?.room?.code || !state?.self?.id) return null;
  return `gotfive.notes.${state.room.code}.${state.self.id}`;
}

function loadNotes() {
  const key = noteKey();
  if (!key || key === notesKey) return;
  notesKey = key;
  try {
    manualMarks = JSON.parse(localStorage.getItem(notesKey) || '{}') || {};
  } catch {
    manualMarks = {};
  }
}

function saveNotes() {
  if (notesKey) localStorage.setItem(notesKey, JSON.stringify(manualMarks));
}

async function api(path, body) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new Error(payload.error || '请求失败。');
  return payload;
}

function connect(roomCode, playerId) {
  if (source) source.close();
  setConnection('连接中...');
  source = new EventSource(`/events?room=${encodeURIComponent(roomCode)}&playerId=${encodeURIComponent(playerId)}`);

  source.addEventListener('state', (event) => {
    state = JSON.parse(event.data);
    loadNotes();
    syncSelections();
    setConnection(`房间 ${state.room.code}`, true);
    render();
  });

  source.onerror = () => {
    setConnection('连接中断');
  };
}

function syncSelections() {
  const publicIds = new Set(state?.game?.publicTiles?.map((tile) => tile.id) || []);
  if (!publicIds.has(selectedTileId)) {
    selectedTileId = state?.game?.lastRevealedId && publicIds.has(state.game.lastRevealedId)
      ? state.game.lastRevealedId
      : state?.game?.publicTiles?.[0]?.id || null;
  }

  const adjacent = getAdjacentPlayers(state?.self?.id);
  if (!adjacent.some((player) => player.id === responderId)) {
    responderId = adjacent[0]?.id || null;
  }
}

function dotsHtml(count) {
  const dots = Array.from({ length: Number(count || 0) }, () => '<span class="dot"></span>').join('');
  return `<span class="dots" aria-label="${count || 0}点">${dots}</span>`;
}

function tileHtml(tile, size = '', options = {}) {
  const hidden = tile.hidden || tile.number == null;
  const classes = ['tile'];
  if (size) classes.push(size);
  if (hidden) classes.push('hidden');
  const label = hidden ? '隐藏牌' : `${tile.number}号${tile.colorShort}${tile.dots}点`;
  const body = hidden
    ? `<div class="tile-num">?</div><div class="tile-meta"><span>${escapeHtml(tile.colorShort)}</span><span>${options.positionLabel || ''}</span></div>`
    : `<div class="tile-num">${tile.number}</div><div class="tile-meta"><span>${escapeHtml(tile.colorShort)}</span>${dotsHtml(tile.dots)}</div>`;
  return `<div class="${classes.join(' ')}" style="--tile-color:${tile.colorHex}" title="${escapeHtml(label)}">${body}</div>`;
}

function playerName(playerId) {
  return state?.players?.find((player) => player.id === playerId)?.name || '未知玩家';
}

function getHand(playerId) {
  return state?.game?.hands?.find((hand) => hand.playerId === playerId)?.tiles || [];
}

function getAdjacentPlayers(playerId) {
  if (!state?.players?.length || !playerId) return [];
  const index = state.players.findIndex((player) => player.id === playerId);
  if (index < 0) return [];
  if (state.players.length === 2) return [state.players[(index + 1) % 2]];
  const left = state.players[(index - 1 + state.players.length) % state.players.length];
  const right = state.players[(index + 1) % state.players.length];
  return left.id === right.id ? [left] : [left, right];
}

function roomLink() {
  const url = new URL(window.location.href);
  url.searchParams.set('room', state.room.code);
  return url.toString();
}

function renderWelcome() {
  const savedName = localStorage.getItem('gotfive.name') || '';
  app.innerHTML = `
    <section class="welcome">
      <div class="panel">
        <div class="panel-head">
          <div>
            <h2>创建房间</h2>
            <p>房主创建房间后，把链接或房间号发给同伴。</p>
          </div>
        </div>
        <div class="panel-body">
          <form class="form-grid" data-form="create">
            <label>
              你的昵称
              <input name="name" maxlength="18" autocomplete="name" value="${escapeHtml(savedName)}" placeholder="例如：阿明" />
            </label>
            <button class="primary" type="submit">创建 2-4 人房间</button>
          </form>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head">
          <div>
            <h2>加入房间</h2>
            <p>不需要账号，同一浏览器会自动保存你的席位。</p>
          </div>
        </div>
        <div class="panel-body">
          <form class="form-grid" data-form="join">
            <div class="form-row">
              <label>
                房间号
                <input name="roomCode" maxlength="4" value="${escapeHtml(initialRoom)}" placeholder="ABCD" />
              </label>
              <label>
                你的昵称
                <input name="name" maxlength="18" autocomplete="name" value="${escapeHtml(savedName)}" placeholder="例如：小周" />
              </label>
            </div>
            <button class="primary" type="submit">加入房间</button>
          </form>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>游戏内容</h2></div>
        <div class="panel-body rules">
          <div><strong>人数：</strong>2-4 人。每人一组 5 张隐藏数字牌，一张来自每种颜色。</div>
          <div><strong>目标：</strong>先准确猜出自己 5 张隐藏牌的数字，按从小到大提交。</div>
          <div><strong>回合：</strong>先选一个颜色翻开一张牌，再用公共明牌获得“分类”或“比较”线索。</div>
          <div><strong>淘汰：</strong>任何时候都可以宣告 Got Five，猜错立即淘汰。</div>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>部署方式</h2></div>
        <div class="panel-body rules">
          <div>本版本只需要 Node.js，运行 <strong>node server.js</strong> 即可。</div>
          <div>同一局的玩家访问同一个服务器地址即可一起玩，局域网和云服务器均可。</div>
        </div>
      </div>
    </section>
  `;
}

function renderLobby() {
  const canStart = state.self.isHost && state.players.length >= 2 && state.players.length <= 4;
  app.innerHTML = `
    <section class="lobby">
      <div class="panel">
        <div class="panel-body lobby-top">
          <div>
            <div class="muted">房间号</div>
            <div class="code">${escapeHtml(state.room.code)}</div>
          </div>
          <div class="badge-row">
            <button data-action="copy-link">复制邀请链接</button>
            ${state.self.isHost ? `<button class="primary" data-action="start" ${canStart ? '' : 'disabled'}>开始游戏</button>` : ''}
          </div>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head">
          <div>
            <h2>玩家席位</h2>
            <p>Got Five 支持 2-4 人。房主开始后不能再加入新玩家。</p>
          </div>
        </div>
        <div class="panel-body">
          <div class="players-list">
            ${state.players.map(renderPlayerChip).join('')}
          </div>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>规则速览</h2></div>
        <div class="panel-body rules">
          <div><strong>开局：</strong>每名玩家各抽 1 张五色牌，不能看自己的数字，其他玩家把它们按升序摆好；公共区每种颜色翻开 1 张。</div>
          <div><strong>分类：</strong>选择一张公共明牌，询问相邻玩家这张牌应插入你 5 张隐藏牌的哪个位置。</div>
          <div><strong>比较：</strong>选择一张公共明牌和自己某一张隐藏牌比较，得到“点数相同”或“点数不同”。</div>
          <div><strong>宣告：</strong>提交自己的 5 个数字。正确立刻获胜，错误立刻淘汰。</div>
        </div>
      </div>
    </section>
  `;
}

function renderPlayerChip(player) {
  return `
    <div class="player-chip">
      <strong>${escapeHtml(player.name)}${player.id === state.self.id ? '（你）' : ''}</strong>
      <div class="badge-row">
        ${player.isHost ? '<span class="badge">房主</span>' : ''}
        <span class="badge ${player.connected ? 'good' : ''}">${player.connected ? '在线' : '离线'}</span>
      </div>
    </div>
  `;
}

function renderGame() {
  const game = state.game;
  const selfTurn = game.turnPlayerId === state.self.id && !state.self.eliminated && state.room.status === 'playing';
  const winner = game.winnerId ? playerName(game.winnerId) : null;
  const phaseText = state.room.status === 'ended'
    ? (winner ? `${winner} 获胜。${game.endedReason || ''}` : game.endedReason || '游戏结束。')
    : game.phase === 'reveal'
      ? `${playerName(game.turnPlayerId)} 选择一个颜色翻开一张牌。`
      : `${playerName(game.turnPlayerId)} 选择公共明牌并获得线索。`;

  app.innerHTML = `
    <section class="game-shell">
      <div class="status-band">
        <div>
          <p class="status-title">${state.room.status === 'ended' ? '游戏结束' : selfTurn ? '轮到你行动' : '等待其他玩家'}</p>
          <p class="status-text">${escapeHtml(phaseText)}</p>
        </div>
        <div class="badge-row">
          <span class="code">${escapeHtml(state.room.code)}</span>
          <button data-action="copy-link">邀请链接</button>
          ${state.self.isHost ? '<button class="ghost" data-action="reset">返回大厅</button>' : ''}
        </div>
      </div>
      <div class="game-grid">
        <div class="stack">
          ${state.players.map(renderPlayerPanel).join('')}
        </div>
        <div class="stack">
          ${renderPublicAndActions()}
          ${renderLog()}
          ${renderRulesPanel()}
        </div>
        <div class="stack notes-col">
          ${renderNotesPanel()}
        </div>
      </div>
    </section>
  `;
}

function renderPlayerPanel(player) {
  const game = state.game;
  const hand = getHand(player.id);
  const clues = game.clues[player.id] || [];
  const category = clues.filter((clue) => clue.type === 'category');
  const compare = clues.filter((clue) => clue.type === 'compare');
  const isTurn = game.turnPlayerId === player.id && state.room.status === 'playing';

  return `
    <article class="player-panel ${isTurn ? 'is-turn' : ''} ${player.eliminated ? 'eliminated' : ''}">
      <div class="player-title">
        <strong>${escapeHtml(player.name)}${player.id === state.self.id ? '（你）' : ''}</strong>
        <div class="badge-row">
          ${isTurn ? '<span class="badge good">当前回合</span>' : ''}
          ${player.eliminated ? '<span class="badge bad">已淘汰</span>' : ''}
          ${player.connected ? '<span class="badge good">在线</span>' : '<span class="badge">离线</span>'}
        </div>
      </div>
      <div class="rack">
        ${hand.map((tile, index) => tileHtml(tile, '', { positionLabel: `第${index + 1}张` })).join('')}
      </div>
      <div class="clues">
        <div>
          <div class="section-title">分类线索</div>
          ${renderCategoryClues(category)}
        </div>
        <div>
          <div class="section-title">比较线索</div>
          ${compare.length ? `<div class="compare-list">${compare.map(renderCompareClue).join('')}</div>` : '<div class="empty">暂无比较线索</div>'}
        </div>
      </div>
    </article>
  `;
}

function renderCategoryClues(clues) {
  const labels = ['小于第1张', '第1-2张', '第2-3张', '第3-4张', '第4-5张', '大于第5张'];
  return `
    <div class="category-row">
      ${labels
        .map((label, slot) => {
          const tiles = clues.filter((clue) => clue.slot === slot).map((clue) => tileHtml(clue.tile, 'tiny')).join('');
          return `<div class="cat-bin"><span class="cat-label">${label}</span><div class="cat-tiles">${tiles}</div></div>`;
        })
        .join('')}
    </div>
  `;
}

function renderCompareClue(clue) {
  return `
    <div class="compare-item ${clue.same ? 'same' : 'diff'}">
      ${tileHtml(clue.tile, 'tiny')}
      <div>
        <strong>第${clue.targetIndex + 1}张</strong>
        <span class="muted">（${escapeHtml(clue.targetColorName)}）</span>
        <span>${clue.same ? '点数相同' : '点数不同'}</span>
      </div>
    </div>
  `;
}

function renderPublicAndActions() {
  const game = state.game;
  const selfTurn = game.turnPlayerId === state.self.id && !state.self.eliminated && state.room.status === 'playing';
  const revealMode = selfTurn && game.phase === 'reveal';
  const clueMode = selfTurn && game.phase === 'clue';

  return `
    <section class="panel">
      <div class="panel-head">
        <div>
          <h2>公共区与行动</h2>
          <p>公共明牌被用作线索后会移到对应玩家的线索区。</p>
        </div>
      </div>
      <div class="panel-body stack">
        <div>
          <div class="section-title">颜色牌堆</div>
          <div class="piles">
            ${state.colors
              .map((color) => {
                const count = game.piles[color.id] || 0;
                const disabled = !revealMode || count <= 0;
                return `<button class="color-button" style="--tile-color:${color.hex}" data-action="reveal" data-color="${color.id}" ${disabled ? 'disabled' : ''}>${escapeHtml(color.short)}<span>${count} 张</span></button>`;
              })
              .join('')}
          </div>
        </div>
        <div>
          <div class="section-title">公共明牌</div>
          ${game.publicTiles.length
            ? `<div class="public-grid">${game.publicTiles.map((tile) => renderPublicTile(tile, clueMode)).join('')}</div>`
            : '<div class="empty">公共区暂无明牌</div>'}
        </div>
        ${renderActionBox(selfTurn)}
        ${renderGuessPanel()}
      </div>
    </section>
  `;
}

function renderPublicTile(tile, selectable) {
  const selected = tile.id === selectedTileId;
  return `
    <button class="tile-button ${selected ? 'selected' : ''}" data-action="select-public" data-tile="${tile.id}" ${selectable ? '' : 'disabled'}>
      ${tileHtml(tile, 'small')}
    </button>
  `;
}

function renderActionBox(selfTurn) {
  const game = state.game;
  if (state.room.status === 'ended') return '<div class="action-box"><strong>本局已结束。</strong></div>';
  if (state.self.eliminated) return '<div class="action-box"><strong>你已淘汰。</strong><span class="muted">仍可旁观其他玩家。</span></div>';
  if (!selfTurn) return '<div class="action-box"><strong>等待当前玩家行动。</strong><span class="muted">你仍然可以整理推理板或直接宣告 Got Five。</span></div>';
  if (game.phase === 'reveal') {
    return '<div class="action-box"><strong>第 1 步：揭牌</strong><span class="muted">选择一个仍有牌的颜色牌堆，翻开一张加入公共区。</span></div>';
  }

  const adjacent = getAdjacentPlayers(state.self.id);
  const selectedTile = game.publicTiles.find((tile) => tile.id === selectedTileId);
  return `
    <div class="action-box">
      <strong>第 2 步：获取线索</strong>
      <span class="muted">选择一张公共明牌，再选择分类或比较。</span>
      <label>
        询问相邻玩家
        <select id="responderSelect">
          ${adjacent.map((player) => `<option value="${player.id}" ${player.id === responderId ? 'selected' : ''}>${escapeHtml(player.name)}</option>`).join('')}
        </select>
      </label>
      <div class="segmented">
        <button data-action="set-clue-type" data-type="category" class="${clueType === 'category' ? 'active' : ''}">分类</button>
        <button data-action="set-clue-type" data-type="compare" class="${clueType === 'compare' ? 'active' : ''}">比较</button>
      </div>
      ${clueType === 'compare' ? renderComparePick() : '<span class="muted">分类会显示这张明牌应放在你五张隐藏牌的哪个区间。</span>'}
      <button class="primary" data-action="submit-clue" ${selectedTile ? '' : 'disabled'}>使用${selectedTile ? ` ${selectedTile.number}号` : ''}明牌获取线索</button>
    </div>
  `;
}

function renderComparePick() {
  const hand = getHand(state.self.id);
  return `
    <div>
      <div class="muted">选择自己的隐藏牌位置</div>
      <div class="index-pick">
        ${hand
          .map(
            (tile, index) => `
              <button data-action="set-compare-index" data-index="${index}" class="${compareIndex === index ? 'active' : ''}">
                第${index + 1}张<br /><span style="color:${tile.colorHex}">${escapeHtml(tile.colorShort)}</span>
              </button>
            `
          )
          .join('')}
      </div>
    </div>
  `;
}

function renderGuessPanel() {
  if (state.room.status !== 'playing' || state.self.eliminated) return '';
  return `
    <div class="action-box">
      <strong>宣告 Got Five</strong>
      <div class="guess-row">
        ${guessValues.map((value, index) => `<input data-guess-index="${index}" inputmode="numeric" type="number" min="1" max="60" value="${escapeHtml(value)}" placeholder="${index + 1}" />`).join('')}
        <button class="danger" data-action="guess">提交</button>
      </div>
      <span class="muted">系统会按升序判定。猜错会立即淘汰。</span>
    </div>
  `;
}

function renderLog() {
  const log = state.game.log || [];
  return `
    <section class="panel">
      <div class="panel-head"><h2>记录</h2></div>
      <div class="panel-body">
        ${log.length
          ? `<div class="log-list">${log
              .map((item) => `<div class="log-item ${item.level || ''}"><span class="log-time">${escapeHtml(item.time)}</span>${escapeHtml(item.text)}</div>`)
              .join('')}</div>`
          : '<div class="empty">暂无记录</div>'}
      </div>
    </section>
  `;
}

function renderRulesPanel() {
  return `
    <section class="panel">
      <div class="panel-head"><h2>规则</h2></div>
      <div class="panel-body rules">
        <div><strong>分类：</strong>被询问的相邻玩家告诉你公共明牌相对你五张隐藏牌的位置。</div>
        <div><strong>比较：</strong>被询问的相邻玩家告诉你公共明牌与指定隐藏牌的点数是否相同。</div>
        <div><strong>可见性：</strong>你看不到自己的数字和点数，但能看到颜色；其他玩家的隐藏牌数字对你可见。</div>
        <div><strong>宣告：</strong>你可以在任何时刻提交答案，正确获胜，错误淘汰。</div>
      </div>
    </section>
  `;
}

function renderNotesPanel() {
  const analysis = computeCandidates();
  return `
    <section class="panel">
      <div class="panel-head">
        <div>
          <h2>我的推理板</h2>
          <p>自动排除可见牌，并按你的线索计算候选。</p>
        </div>
      </div>
      <div class="panel-body">
        ${renderCandidateSummary(analysis)}
        <div class="sheet-tools">
          <div class="legend">
            <span class="legend-item"><span class="legend-box candidate"></span>候选</span>
            <span class="legend-item"><span class="legend-box visible"></span>已可见</span>
            <span class="legend-item"><span class="legend-box logic-out"></span>线索排除</span>
            <span class="legend-item">点击格子手动标记 ×</span>
          </div>
          <button class="ghost" data-action="clear-notes">清除手动标记</button>
        </div>
        <div class="sheet-grid">
          ${state.catalog.map((tile) => renderSheetCell(tile, analysis)).join('')}
        </div>
      </div>
    </section>
  `;
}

function renderCandidateSummary(analysis) {
  const hand = getHand(state.self.id);
  return `
    <div class="candidate-summary">
      ${hand
        .map((tile, index) => {
          const values = analysis.possibles[index] || [];
          return `
            <div class="candidate-line">
              <div class="candidate-label"><span class="swatch" style="--tile-color:${tile.colorHex}"></span>第${index + 1}张</div>
              <div class="candidate-values">
                ${values.length
                  ? values.map((candidate) => `<button class="number-pill" data-action="fill-guess" data-number="${candidate.number}">${candidate.number}</button>`).join('')
                  : '<span class="number-pill warn">无候选</span>'}
              </div>
            </div>
          `;
        })
        .join('')}
      <div class="muted">可行组合：${analysis.assignmentCount} 组</div>
    </div>
  `;
}

function renderSheetCell(tile, analysis) {
  const visible = analysis.visibleNumbers.has(tile.number);
  const candidatePositions = analysis.candidateByNumber.get(tile.number) || [];
  const hasCandidate = candidatePositions.length > 0;
  const logicOut = !visible && !hasCandidate;
  const manual = Boolean(manualMarks[tile.number]);
  const classes = ['sheet-cell'];
  if (visible) classes.push('visible');
  if (hasCandidate) classes.push('candidate');
  if (logicOut) classes.push('logic-out');
  if (manual) classes.push('manual');
  const title = visible
    ? '已可见，不能是你的隐藏牌'
    : hasCandidate
      ? `可能是第${candidatePositions.map((index) => index + 1).join('或')}张`
      : '已被线索或顺序排除';

  return `
    <button class="${classes.join(' ')}" style="--tile-color:${tile.colorHex}" data-action="toggle-note" data-number="${tile.number}" title="${escapeHtml(title)}">
      <span class="sheet-num">${tile.number}</span>
      <span class="sheet-meta"><span>${escapeHtml(tile.colorShort)}</span>${dotsHtml(tile.dots)}</span>
    </button>
  `;
}

function computeCandidates() {
  const game = state.game;
  const selfId = state.self.id;
  const ownHand = getHand(selfId);
  const ownClues = game.clues[selfId] || [];
  const visibleNumbers = new Set();

  for (const tile of game.publicTiles) visibleNumbers.add(tile.number);
  for (const clues of Object.values(game.clues)) {
    for (const clue of clues) visibleNumbers.add(clue.tile.number);
  }
  for (const hand of game.hands) {
    if (hand.playerId === selfId) continue;
    for (const tile of hand.tiles) {
      if (tile.number != null) visibleNumbers.add(tile.number);
    }
  }

  const tileByNumber = new Map(state.catalog.map((tile) => [tile.number, tile]));
  const domains = ownHand.map((secret, index) => {
    if (secret.number != null) return [tileByNumber.get(secret.number)];
    return state.catalog
      .filter((tile) => tile.color === secret.color)
      .filter((tile) => !visibleNumbers.has(tile.number))
      .filter((tile) => passesOwnClues(tile, index, ownClues))
      .sort((a, b) => a.number - b.number);
  });

  const possibleMaps = Array.from({ length: 5 }, () => new Map());
  let assignmentCount = 0;
  const picked = [];

  function backtrack(index) {
    if (index === domains.length) {
      assignmentCount += 1;
      for (let i = 0; i < picked.length; i += 1) possibleMaps[i].set(picked[i].number, picked[i]);
      return;
    }
    for (const tile of domains[index]) {
      if (!tile) continue;
      if (index > 0 && picked[index - 1].number >= tile.number) continue;
      picked[index] = tile;
      backtrack(index + 1);
    }
  }

  backtrack(0);

  const possibles = possibleMaps.map((map) => Array.from(map.values()).sort((a, b) => a.number - b.number));
  const candidateByNumber = new Map();
  possibles.forEach((tiles, index) => {
    for (const tile of tiles) {
      if (!candidateByNumber.has(tile.number)) candidateByNumber.set(tile.number, []);
      candidateByNumber.get(tile.number).push(index);
    }
  });

  return { visibleNumbers, possibles, candidateByNumber, assignmentCount };
}

function passesOwnClues(tile, index, clues) {
  for (const clue of clues) {
    if (clue.type === 'category') {
      if (index < clue.slot && !(tile.number < clue.tile.number)) return false;
      if (index >= clue.slot && !(tile.number > clue.tile.number)) return false;
    } else if (clue.type === 'compare' && clue.targetIndex === index) {
      if (clue.same && tile.dots !== clue.tile.dots) return false;
      if (!clue.same && tile.dots === clue.tile.dots) return false;
    }
  }
  return true;
}

function render() {
  if (!state) {
    renderWelcome();
    return;
  }
  if (state.room.status === 'lobby') {
    renderLobby();
    return;
  }
  renderGame();
}

document.addEventListener('submit', async (event) => {
  const form = event.target.closest('[data-form]');
  if (!form) return;
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form).entries());
  try {
    if (form.dataset.form === 'create') {
      const payload = await api('/api/create', { name: data.name });
      saveIdentity(payload.roomCode, payload.playerId, data.name);
      history.replaceState(null, '', `?room=${payload.roomCode}`);
      connect(payload.roomCode, payload.playerId);
    } else if (form.dataset.form === 'join') {
      const roomCode = String(data.roomCode || '').trim().toUpperCase();
      const saved = getIdentity(roomCode);
      const payload = await api('/api/join', {
        roomCode,
        name: data.name,
        playerId: saved?.playerId || null
      });
      saveIdentity(payload.roomCode, payload.playerId, data.name);
      history.replaceState(null, '', `?room=${payload.roomCode}`);
      connect(payload.roomCode, payload.playerId);
    }
  } catch (error) {
    showToast(error.message);
  }
});

document.addEventListener('click', async (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;

  try {
    if (action === 'copy-link') {
      await navigator.clipboard.writeText(roomLink());
      showToast('邀请链接已复制。');
      return;
    }
    if (action === 'start') {
      await api('/api/start', { roomCode: state.room.code, playerId: state.self.id });
      return;
    }
    if (action === 'reset') {
      await api('/api/reset', { roomCode: state.room.code, playerId: state.self.id });
      return;
    }
    if (action === 'reveal') {
      await api('/api/reveal', { roomCode: state.room.code, playerId: state.self.id, color: target.dataset.color });
      return;
    }
    if (action === 'select-public') {
      selectedTileId = Number(target.dataset.tile);
      render();
      return;
    }
    if (action === 'set-clue-type') {
      clueType = target.dataset.type === 'compare' ? 'compare' : 'category';
      render();
      return;
    }
    if (action === 'set-compare-index') {
      compareIndex = Number(target.dataset.index);
      render();
      return;
    }
    if (action === 'submit-clue') {
      const select = document.getElementById('responderSelect');
      responderId = select?.value || responderId;
      await api('/api/clue', {
        roomCode: state.room.code,
        playerId: state.self.id,
        tileId: selectedTileId,
        type: clueType,
        targetIndex: compareIndex,
        responderId
      });
      return;
    }
    if (action === 'guess') {
      await api('/api/guess', { roomCode: state.room.code, playerId: state.self.id, guess: guessValues });
      return;
    }
    if (action === 'toggle-note') {
      const number = target.dataset.number;
      manualMarks[number] = !manualMarks[number];
      if (!manualMarks[number]) delete manualMarks[number];
      saveNotes();
      render();
      return;
    }
    if (action === 'clear-notes') {
      manualMarks = {};
      saveNotes();
      render();
      return;
    }
    if (action === 'fill-guess') {
      const firstEmpty = guessValues.findIndex((value) => !String(value).trim());
      const index = firstEmpty >= 0 ? firstEmpty : 0;
      guessValues[index] = target.dataset.number;
      render();
    }
  } catch (error) {
    showToast(error.message);
  }
});

document.addEventListener('input', (event) => {
  const input = event.target.closest('[data-guess-index]');
  if (!input) return;
  guessValues[Number(input.dataset.guessIndex)] = input.value;
});

window.addEventListener('beforeunload', () => {
  if (source) source.close();
});

const resumeIdentity = initialRoom ? getIdentity(initialRoom) : null;
if (initialRoom && resumeIdentity?.playerId) {
  connect(initialRoom, resumeIdentity.playerId);
} else {
  setConnection('未连接');
  renderWelcome();
}
