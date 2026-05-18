const storageKey = 'flip7-session';

const elements = {
  entry: document.querySelector('#entry'),
  table: document.querySelector('#table'),
  nameInput: document.querySelector('#nameInput'),
  roomInput: document.querySelector('#roomInput'),
  createBtn: document.querySelector('#createBtn'),
  joinBtn: document.querySelector('#joinBtn'),
  entryError: document.querySelector('#entryError'),
  actionError: document.querySelector('#actionError'),
  copyRoomBtn: document.querySelector('#copyRoomBtn'),
  phaseTitle: document.querySelector('#phaseTitle'),
  connectionBadge: document.querySelector('#connectionBadge'),
  leaveBtn: document.querySelector('#leaveBtn'),
  startBtn: document.querySelector('#startBtn'),
  restartBtn: document.querySelector('#restartBtn'),
  roundText: document.querySelector('#roundText'),
  activeText: document.querySelector('#activeText'),
  deckText: document.querySelector('#deckText'),
  goalText: document.querySelector('#goalText'),
  pendingPanel: document.querySelector('#pendingPanel'),
  pendingTitle: document.querySelector('#pendingTitle'),
  pendingHelp: document.querySelector('#pendingHelp'),
  targetButtons: document.querySelector('#targetButtons'),
  players: document.querySelector('#players'),
  myRoundScore: document.querySelector('#myRoundScore'),
  hitBtn: document.querySelector('#hitBtn'),
  stayBtn: document.querySelector('#stayBtn'),
  logList: document.querySelector('#logList'),
  playerTemplate: document.querySelector('#playerTemplate'),
  bustEffect: document.querySelector('#bustEffect'),
  bustCardLeft: document.querySelector('#bustCardLeft'),
  bustCardRight: document.querySelector('#bustCardRight'),
  bustMessage: document.querySelector('#bustMessage'),
};

let session = loadSession();
let state = null;
let events = null;
let lastSeenBustEventId = null;
let activeBustFlash = null;
let bustEffectTimer = null;
let bustFlashTimer = null;

elements.nameInput.value = session?.name || '';
elements.roomInput.value = session?.roomCode || '';

if (session?.roomCode && session?.playerId) {
  connect();
}

elements.createBtn.addEventListener('click', async () => {
  await createRoom();
});

elements.joinBtn.addEventListener('click', async () => {
  await joinRoom();
});

elements.startBtn.addEventListener('click', () => sendAction('start'));
elements.restartBtn.addEventListener('click', () => sendAction('restart'));
elements.hitBtn.addEventListener('click', () => sendAction('hit'));
elements.stayBtn.addEventListener('click', () => sendAction('stay'));
elements.leaveBtn.addEventListener('click', leaveRoom);
elements.copyRoomBtn.addEventListener('click', async () => {
  if (!state?.code) return;
  try {
    await navigator.clipboard?.writeText(state.code);
    elements.copyRoomBtn.textContent = '已复制';
  } catch {
    elements.copyRoomBtn.textContent = state.code;
  }
  setTimeout(() => {
    elements.copyRoomBtn.textContent = state.code;
  }, 1000);
});

elements.roomInput.addEventListener('input', () => {
  elements.roomInput.value = elements.roomInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
});

async function createRoom() {
  setEntryError('');
  const name = getName();
  const data = await post('/api/create', { name });
  saveSession({ roomCode: data.roomCode, playerId: data.playerId, name });
  connect();
}

async function joinRoom() {
  setEntryError('');
  const name = getName();
  const roomCode = elements.roomInput.value.trim().toUpperCase();
  if (!roomCode) {
    setEntryError('请输入房间码。');
    return;
  }
  const data = await post('/api/join', { roomCode, name });
  saveSession({ roomCode: data.roomCode, playerId: data.playerId, name });
  connect();
}

async function sendAction(action, extra = {}) {
  if (!session) return;
  setActionError('');
  try {
    const data = await post('/api/action', {
      action,
      roomCode: session.roomCode,
      playerId: session.playerId,
      ...extra,
    });
    if (data.state) {
      render(data.state);
    }
  } catch (error) {
    setActionError(error.message);
  }
}

async function post(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || '请求失败。');
  }
  return data;
}

function connect() {
  if (!session) return;
  elements.entry.classList.add('hidden');
  elements.table.classList.remove('hidden');
  elements.connectionBadge.textContent = '连接中';
  elements.connectionBadge.classList.remove('online');

  events?.close();
  const params = new URLSearchParams({ roomCode: session.roomCode, playerId: session.playerId });
  events = new EventSource(`/events?${params}`);

  events.addEventListener('state', (event) => {
    render(JSON.parse(event.data));
    elements.connectionBadge.textContent = '在线';
    elements.connectionBadge.classList.add('online');
  });

  events.onerror = () => {
    elements.connectionBadge.textContent = '重连中';
    elements.connectionBadge.classList.remove('online');
  };
}

function leaveRoom() {
  events?.close();
  events = null;
  state = null;
  lastSeenBustEventId = null;
  activeBustFlash = null;
  hideBustEffect();
  clearTimeout(bustFlashTimer);
  session = null;
  localStorage.removeItem(storageKey);
  elements.table.classList.add('hidden');
  elements.entry.classList.remove('hidden');
}

function render(nextState) {
  const previousState = state;
  state = nextState;
  const me = state.players.find((player) => player.isYou);
  const isHost = me?.id === state.hostId;
  const isMyTurn = state.activePlayerId === me?.id;
  const canAct = state.phase === 'playing' && isMyTurn && !state.pendingAction && !me?.stayed && !me?.frozen && !me?.busted;

  elements.copyRoomBtn.textContent = state.code;
  elements.phaseTitle.textContent = titleForPhase(state);
  elements.roundText.textContent = state.round || '-';
  elements.activeText.textContent = state.activePlayerName || '-';
  elements.deckText.textContent = state.deckCount;
  elements.goalText.textContent = state.winningScore;
  elements.myRoundScore.textContent = me?.roundScore ?? 0;

  elements.startBtn.classList.toggle('hidden', !(isHost && state.phase === 'lobby'));
  elements.restartBtn.classList.toggle('hidden', !(isHost && state.phase === 'finished'));
  elements.hitBtn.disabled = !canAct;
  elements.stayBtn.disabled = !canAct;

  renderPending(me);
  renderPlayers();
  renderLog();
  maybePlayBustEffect(previousState, state);
}

function titleForPhase(nextState) {
  if (nextState.phase === 'lobby') return '等待玩家加入';
  if (nextState.phase === 'finished') {
    const winners = nextState.players.filter((player) => nextState.lastWinnerIds.includes(player.id));
    return `${winners.map((player) => player.name).join('、')} 获胜`;
  }
  if (nextState.pendingAction) return '处理行动牌';
  if (nextState.isDealing) return '起始牌';
  return `${nextState.activePlayerName || '玩家'} 的回合`;
}

function renderPending(me) {
  const pending = state.pendingAction;
  elements.pendingPanel.classList.toggle('hidden', !pending);
  elements.targetButtons.innerHTML = '';
  if (!pending) return;

  const isActor = pending.sourcePlayerId === me?.id;
  elements.pendingTitle.textContent = pendingTitle(pending.type);
  elements.pendingHelp.textContent = isActor ? '选择目标玩家。' : '等待行动牌玩家选择目标。';

  const targets = state.players.filter((player) => isValidTarget(player, pending.type));
  for (const target of targets) {
    const button = document.createElement('button');
    button.textContent = target.name;
    button.disabled = !isActor;
    button.addEventListener('click', () => {
      sendAction(pending.type, { targetId: target.id });
    });
    elements.targetButtons.append(button);
  }
}

function pendingTitle(type) {
  if (type === 'freeze') return '冻结';
  if (type === 'flip3') return '翻三张';
  if (type === 'second') return '第二机会';
  return '行动牌';
}

function isValidTarget(player, type) {
  if (player.stayed || player.frozen || player.busted) return false;
  if (type === 'second') return !player.hasSecondChance && !player.usedSecondChance;
  return true;
}

function renderPlayers() {
  elements.players.innerHTML = '';
  for (const player of state.players) {
    const node = elements.playerTemplate.content.firstElementChild.cloneNode(true);
    node.dataset.playerId = player.id;
    node.classList.toggle('active', state.activePlayerId === player.id);
    node.classList.toggle('you', player.isYou);
    node.classList.toggle('done', player.stayed || player.frozen || player.busted);
    node.classList.toggle('busted', player.busted);
    node.classList.toggle('bust-flash', activeBustFlash?.eventId === state.lastBustEvent?.id && activeBustFlash?.playerId === player.id);

    node.querySelector('h3').textContent = `${player.name}${player.isYou ? '（你）' : ''}`;
    node.querySelector('p').textContent = playerStatus(player);
    node.querySelector('strong').textContent = player.totalScore;

    const cards = node.querySelector('.cards');
    for (const card of player.cards) {
      cards.append(renderCard(card));
    }
    if (!player.cards.length) {
      const empty = document.createElement('span');
      empty.className = 'empty-cards';
      empty.textContent = player.busted ? '爆掉，本轮 0 分' : '暂无牌';
      cards.append(empty);
    }

    elements.players.append(node);
  }
}

function renderCard(card) {
  const node = document.createElement('div');
  node.className = `card ${cardClass(card)}`;
  node.textContent = cardLabel(card);
  return node;
}

function cardClass(card) {
  if (card.kind === 'number') return 'number';
  if (card.modifier === 'bonus') return 'bonus';
  if (card.modifier === 'x2') return 'x2';
  if (card.action === 'second') return 'second';
  return '';
}

function cardLabel(card) {
  if (card.kind === 'number') return String(card.value);
  if (card.modifier === 'bonus') return `+${card.value}`;
  if (card.modifier === 'x2') return 'x2';
  if (card.action === 'second') return '第二机会';
  return '?';
}

function playerStatus(player) {
  const parts = [`本轮 ${player.roundScore}`];
  if (player.connected) parts.push('在线');
  if (player.isHost) parts.push('房主');
  if (player.stayed) parts.push('已停牌');
  if (player.frozen) parts.push('被冻结');
  if (player.busted) parts.push('爆掉');
  if (player.hasSecondChance) parts.push('第二机会');
  return parts.join(' · ');
}

function maybePlayBustEffect(previousState, nextState) {
  const event = nextState.lastBustEvent;
  if (!event || event.id === lastSeenBustEventId) return;
  lastSeenBustEventId = event.id;
  if (!previousState) return;

  const nextPlayer = nextState.players.find((player) => player.id === event.playerId);
  triggerBustFlash(event);
  showBustEffect(event, nextPlayer?.isYou);
}

function triggerBustFlash(event) {
  activeBustFlash = { eventId: event.id, playerId: event.playerId };
  clearTimeout(bustFlashTimer);
  const node = [...elements.players.children].find((child) => child.dataset.playerId === event.playerId);
  node?.classList.add('bust-flash');

  bustFlashTimer = setTimeout(() => {
    activeBustFlash = null;
    node?.classList.remove('bust-flash');
  }, 2600);
}

function showBustEffect(event, isYou) {
  clearTimeout(bustEffectTimer);
  elements.bustCardLeft.textContent = event.value;
  elements.bustCardRight.textContent = event.value;
  elements.bustMessage.textContent = `${isYou ? '你' : event.playerName} 抽到重复的 ${event.value}，本轮 0 分`;

  elements.bustEffect.classList.add('hidden');
  elements.bustEffect.classList.remove('playing', 'leaving');
  void elements.bustEffect.offsetWidth;
  elements.bustEffect.classList.remove('hidden');
  elements.bustEffect.classList.add('playing');

  bustEffectTimer = setTimeout(() => {
    elements.bustEffect.classList.add('leaving');
    bustEffectTimer = setTimeout(hideBustEffect, 380);
  }, 2200);
}

function hideBustEffect() {
  clearTimeout(bustEffectTimer);
  elements.bustEffect.classList.add('hidden');
  elements.bustEffect.classList.remove('playing', 'leaving');
}

function renderLog() {
  elements.logList.innerHTML = '';
  for (const item of [...state.log].reverse()) {
    const node = document.createElement('li');
    node.textContent = item;
    elements.logList.append(node);
  }
}

function getName() {
  return elements.nameInput.value.trim() || '玩家';
}

function setEntryError(message) {
  elements.entryError.textContent = message;
}

function setActionError(message) {
  elements.actionError.textContent = message;
}

function saveSession(nextSession) {
  session = nextSession;
  localStorage.setItem(storageKey, JSON.stringify(session));
}

function loadSession() {
  try {
    return JSON.parse(localStorage.getItem(storageKey));
  } catch {
    return null;
  }
}
