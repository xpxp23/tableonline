const http = require('http');
const { promises: fs } = require('fs');
const { extname, join, normalize } = require('path');
const crypto = require('crypto');

const readFile = fs.readFile;

function randomUUID() {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }

  const bytes = crypto.randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = join(process.cwd(), 'public');
const WINNING_SCORE = 200;
const ROOM_TTL_MS = 1000 * 60 * 60 * 6;

const rooms = new Map();
const clients = new Map();

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function createDeck() {
  const deck = [];

  for (let value = 0; value <= 12; value += 1) {
    const copies = value === 0 ? 1 : value;
    for (let i = 0; i < copies; i += 1) {
      deck.push({ id: `n-${value}-${i}`, kind: 'number', value });
    }
  }

  for (const value of [2, 4, 6, 8, 10]) {
    deck.push({ id: `bonus-${value}`, kind: 'modifier', modifier: 'bonus', value });
  }

  deck.push({ id: 'x2-1', kind: 'modifier', modifier: 'x2', value: 2 });

  for (let i = 0; i < 3; i += 1) {
    deck.push({ id: `freeze-${i}`, kind: 'action', action: 'freeze' });
    deck.push({ id: `flip3-${i}`, kind: 'action', action: 'flip3' });
    deck.push({ id: `second-${i}`, kind: 'action', action: 'second' });
  }

  return shuffle(deck);
}

function shuffle(cards) {
  const deck = [...cards];
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function newRoom(hostName) {
  const roomCode = makeRoomCode();
  const hostId = randomUUID();
  const room = {
    code: roomCode,
    hostId,
    phase: 'lobby',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    deck: [],
    discard: [],
    round: 0,
    dealingIndex: null,
    activePlayerId: null,
    players: [
      newPlayer(hostId, hostName || '房主', true),
    ],
    log: ['房间已创建。'],
    pendingAction: null,
    effectSeq: 0,
    lastBustEvent: null,
    lastWinnerIds: [],
  };
  rooms.set(roomCode, room);
  return { room, player: room.players[0] };
}

function newPlayer(id, name, isHost = false) {
  return {
    id,
    name: cleanName(name),
    isHost,
    connected: false,
    totalScore: 0,
    roundScore: 0,
    cards: [],
    stayed: false,
    frozen: false,
    busted: false,
    hasSecondChance: false,
    usedSecondChance: false,
    flip7Bonus: false,
  };
}

function makeRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  do {
    code = Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function cleanName(name) {
  return String(name || '玩家').trim().replace(/\s+/g, ' ').slice(0, 16) || '玩家';
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(payload);
}

function fail(res, status, message) {
  json(res, status, { error: message });
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 100_000) {
      throw new Error('请求体过大');
    }
  }
  return body ? JSON.parse(body) : {};
}

function getRoom(code) {
  return rooms.get(String(code || '').toUpperCase());
}

function getPlayer(room, playerId) {
  return room ? room.players.find((player) => player.id === playerId) : undefined;
}

function requirePlayer(res, data) {
  const room = getRoom(data.roomCode);
  if (!room) {
    fail(res, 404, '房间不存在。');
    return {};
  }
  const player = getPlayer(room, data.playerId);
  if (!player) {
    fail(res, 403, '玩家不在这个房间。');
    return {};
  }
  return { room, player };
}

function snapshot(room, viewerId = null) {
  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    round: room.round,
    activePlayerId: room.activePlayerId,
    activePlayerName: (getPlayer(room, room.activePlayerId) || {}).name || '',
    deckCount: room.deck.length,
    discardCount: room.discard.length,
    winningScore: WINNING_SCORE,
    isDealing: room.dealingIndex !== null,
    pendingAction: room.pendingAction,
    lastBustEvent: room.lastBustEvent,
    lastWinnerIds: room.lastWinnerIds,
    players: room.players.map((player) => ({
      id: player.id,
      name: player.name,
      isHost: player.isHost,
      connected: player.connected,
      totalScore: player.totalScore,
      roundScore: player.roundScore,
      cards: player.cards,
      stayed: player.stayed,
      frozen: player.frozen,
      busted: player.busted,
      hasSecondChance: player.hasSecondChance,
      usedSecondChance: player.usedSecondChance,
      flip7Bonus: player.flip7Bonus,
      isYou: player.id === viewerId,
    })),
    log: room.log.slice(-80),
  };
}

function sendRoom(room) {
  room.updatedAt = Date.now();
  const roomClients = clients.get(room.code);
  if (!roomClients) return;

  for (const [clientId, client] of roomClients) {
    client.res.write(`event: state\n`);
    client.res.write(`data: ${JSON.stringify(snapshot(room, client.playerId))}\n\n`);
  }
}

function addLog(room, text) {
  room.log.push(text);
  if (room.log.length > 120) {
    room.log.splice(0, room.log.length - 120);
  }
}

function resetRoundState(player) {
  player.roundScore = 0;
  player.cards = [];
  player.stayed = false;
  player.frozen = false;
  player.busted = false;
  player.hasSecondChance = false;
  player.usedSecondChance = false;
  player.flip7Bonus = false;
}

function startGame(room) {
  room.phase = 'playing';
  room.round = 0;
  room.lastBustEvent = null;
  room.lastWinnerIds = [];
  room.players.forEach((player) => {
    player.totalScore = 0;
    resetRoundState(player);
  });
  addLog(room, '新游戏开始，目标分数 200。');
  startRound(room);
}

function startRound(room) {
  room.round += 1;
  room.deck = createDeck();
  room.discard = [];
  room.pendingAction = null;
  room.players.forEach(resetRoundState);
  room.dealingIndex = 0;
  room.activePlayerId = null;
  addLog(room, `第 ${room.round} 轮开始，先给每名玩家发 1 张起始牌。`);
  continueInitialDeal(room);
}

function nextPlayerId(room, fromId) {
  const available = room.players.filter((player) => isAliveInRound(player));
  if (!available.length) return null;
  if (!fromId) return available[0].id;

  const startIndex = room.players.findIndex((player) => player.id === fromId);
  for (let offset = 1; offset <= room.players.length; offset += 1) {
    const candidate = room.players[(startIndex + offset + room.players.length) % room.players.length];
    if (isAliveInRound(candidate)) return candidate.id;
  }
  return null;
}

function isAliveInRound(player) {
  return !player.stayed && !player.frozen && !player.busted;
}

function continueInitialDeal(room) {
  if (room.phase !== 'playing' || room.pendingAction || room.dealingIndex === null) return;

  while (room.dealingIndex < room.players.length) {
    const player = room.players[room.dealingIndex];
    room.dealingIndex += 1;
    if (isAliveInRound(player)) {
      revealForPlayer(room, player, { initialDeal: true });
      if (room.pendingAction) return;
    }
  }

  room.dealingIndex = null;
  room.activePlayerId = nextPlayerId(room, null);
  addLog(room, `${(getPlayer(room, room.activePlayerId) || {}).name || '玩家'} 开始行动。`);
  resolveRoundIfNeeded(room);
}

function advanceTurn(room) {
  continueInitialDeal(room);
  if (room.dealingIndex !== null) return;
  resolveRoundIfNeeded(room);
  if (room.phase !== 'playing') return;
  room.activePlayerId = nextPlayerId(room, room.activePlayerId);
  resolveRoundIfNeeded(room);
}

function resolveRoundIfNeeded(room) {
  if (room.phase !== 'playing') return;
  if (room.dealingIndex !== null) return;
  if (room.pendingAction) return;
  if (room.players.some(isAliveInRound)) return;

  for (const player of room.players) {
    if (!player.busted) {
      player.totalScore += player.roundScore;
      addLog(room, `${player.name} 本轮获得 ${player.roundScore} 分，总分 ${player.totalScore}。`);
    }
  }

  const winners = room.players.filter((player) => player.totalScore >= WINNING_SCORE);
  if (winners.length) {
    const maxScore = Math.max(...winners.map((player) => player.totalScore));
    const leaderIds = room.players.filter((player) => player.totalScore === maxScore).map((player) => player.id);
    if (leaderIds.length === 1) {
      room.lastWinnerIds = leaderIds;
      room.phase = 'finished';
      room.activePlayerId = null;
      addLog(room, `游戏结束：${(getPlayer(room, leaderIds[0]) || {}).name} 获胜。`);
      return;
    }
    addLog(room, `最高分 ${maxScore} 出现平局，继续加赛一轮。`);
    startRound(room);
    return;
  }

  startRound(room);
}

function ensureDeck(room) {
  if (room.deck.length) return;
  const recycled = shuffle(room.discard);
  room.deck = recycled;
  room.discard = [];
  addLog(room, '牌库已洗入弃牌堆。');
}

function drawCard(room) {
  ensureDeck(room);
  return room.deck.pop();
}

function revealForPlayer(room, player, options = {}) {
  const card = drawCard(room);
  if (!card) {
    addLog(room, '没有可翻的牌，本轮结束。');
    player.stayed = true;
    return;
  }

  if (card.kind === 'number') {
    handleNumberCard(room, player, card);
    return;
  }

  if (card.kind === 'modifier') {
    player.cards.push(card);
    recalculateRoundScore(player);
    addLog(room, `${player.name} 翻到 ${labelCard(card)}，当前 ${player.roundScore} 分。`);
    return;
  }

  if (card.action === 'second') {
    if (!player.hasSecondChance && !player.usedSecondChance) {
      player.hasSecondChance = true;
      player.cards.push(card);
      addLog(room, `${player.name} 获得第二机会。`);
      return;
    }

    const targets = eligibleSecondChanceTargets(room);
    if (!targets.length) {
      room.discard.push(card);
      addLog(room, `${player.name} 翻到第二机会，但没有可接收的玩家，弃掉这张牌。`);
      return;
    }
    room.pendingAction = makePendingAction('second', player.id, options, card);
    addLog(room, `${player.name} 翻到第二机会，选择一名玩家接收。`);
    return;
  }

  if (card.action === 'freeze') {
    room.discard.push(card);
    room.pendingAction = makePendingAction('freeze', player.id, options);
    addLog(room, `${player.name} 翻到冻结，选择一名玩家立刻停牌。`);
    return;
  }

  if (card.action === 'flip3') {
    room.discard.push(card);
    room.pendingAction = makePendingAction('flip3', player.id, options);
    addLog(room, `${player.name} 翻到翻三张，选择一名玩家连续翻 3 张。`);
  }
}

function makePendingAction(type, sourcePlayerId, options = {}, card = null) {
  return {
    type,
    sourcePlayerId,
    card,
    resume: makeResumeFromOptions(options),
  };
}

function makeResumeFromOptions(options = {}) {
  if (options.initialDeal) {
    return { mode: 'deal', after: 'none', parent: null };
  }
  if (options.flip3) {
    return {
      mode: 'flip3',
      targetPlayerId: options.flip3.targetPlayerId,
      remaining: options.flip3.remaining,
      after: options.flip3.after,
      parent: options.flip3.parent,
    };
  }
  return null;
}

function eligibleSecondChanceTargets(room) {
  return room.players.filter((player) => isAliveInRound(player) && !player.hasSecondChance && !player.usedSecondChance);
}

function handleNumberCard(room, player, card) {
  const duplicate = player.cards.some((owned) => owned.kind === 'number' && owned.value === card.value);
  if (!duplicate) {
    player.cards.push(card);
    recalculateRoundScore(player);
    addLog(room, `${player.name} 翻到 ${card.value}，当前 ${player.roundScore} 分。`);
    if (uniqueNumberCount(player) >= 7) {
      player.flip7Bonus = true;
      recalculateRoundScore(player);
      player.stayed = true;
      addLog(room, `${player.name} 集齐 7 张不同数字，七连翻奖励 +15 并自动停牌。`);
    }
    return;
  }

  if (player.hasSecondChance && !player.usedSecondChance) {
    player.hasSecondChance = false;
    player.usedSecondChance = true;
    room.discard.push(card);
    const secondChanceCard = player.cards.find((owned) => owned.action === 'second');
    if (secondChanceCard) {
      player.cards = player.cards.filter((owned) => owned !== secondChanceCard);
      room.discard.push(secondChanceCard);
    }
    recalculateRoundScore(player);
    addLog(room, `${player.name} 翻到重复的 ${card.value}，消耗第二机会并继续留在本轮。`);
    return;
  }

  room.discard.push(card);
  player.cards.forEach((owned) => room.discard.push(owned));
  player.cards = [];
  player.roundScore = 0;
  player.busted = true;
  player.stayed = false;
  player.frozen = false;
  player.hasSecondChance = false;
  player.usedSecondChance = true;
  recordBustEvent(room, player, card.value);
  addLog(room, `${player.name} 翻到重复的 ${card.value}，爆掉，本轮 0 分。`);
}

function recordBustEvent(room, player, value) {
  room.effectSeq += 1;
  room.lastBustEvent = {
    id: room.effectSeq,
    playerId: player.id,
    playerName: player.name,
    value,
    round: room.round,
  };
}

function uniqueNumberCount(player) {
  return new Set(player.cards.filter((card) => card.kind === 'number').map((card) => card.value)).size;
}

function recalculateRoundScore(player) {
  const numberScore = player.cards
    .filter((card) => card.kind === 'number')
    .reduce((sum, card) => sum + card.value, 0);
  const bonusScore = player.cards
    .filter((card) => card.kind === 'modifier' && card.modifier === 'bonus')
    .reduce((sum, card) => sum + card.value, 0);
  const multiplier = player.cards.some((card) => card.kind === 'modifier' && card.modifier === 'x2') ? 2 : 1;
  const flip7Score = player.flip7Bonus ? 15 : 0;
  player.roundScore = numberScore * multiplier + bonusScore + flip7Score;
}

function labelCard(card) {
  if (card.kind === 'number') return `${card.value}`;
  if (card.modifier === 'bonus') return `+${card.value}`;
  if (card.modifier === 'x2') return 'x2';
  if (card.action === 'freeze') return '冻结';
  if (card.action === 'flip3') return '翻三张';
  if (card.action === 'second') return '第二机会';
  return '未知牌';
}

function stay(room, player) {
  player.stayed = true;
  addLog(room, `${player.name} 停牌，锁定本轮 ${player.roundScore} 分。`);
  advanceTurn(room);
}

function continueResume(room, resume) {
  if (!resume || room.pendingAction || room.phase !== 'playing') return;

  let current = resume;
  while (current && !room.pendingAction && room.phase === 'playing') {
    if (current.mode === 'deal') {
      continueInitialDeal(room);
      current = room.pendingAction ? null : current.parent;
    } else if (current.mode === 'flip3') {
      current = continueFlip3(room, current);
    } else {
      current = current.parent || null;
    }
  }
}

function continueFlip3(room, resume) {
  const target = getPlayer(room, resume.targetPlayerId);
  if (!target) return resume.parent || null;

  let remaining = resume.remaining;
  while (remaining > 0 && isAliveInRound(target) && !room.pendingAction) {
    remaining -= 1;
    revealForPlayer(room, target, {
      flip3: {
        targetPlayerId: target.id,
        remaining,
        after: resume.after || 'advance',
        parent: resume.parent || null,
      },
    });
  }

  if (room.pendingAction) return null;
  if (room.phase === 'playing' && (resume.after || 'advance') === 'advance') {
    advanceTurn(room);
  }
  return resume.parent || null;
}

function afterActionResolved(room, pending) {
  if (pending.resume) {
    continueResume(room, pending.resume);
    return;
  }
  advanceTurn(room);
}

function hit(room, player) {
  if (room.pendingAction) throw new Error('请先处理行动牌。');
  if (room.dealingIndex !== null) throw new Error('请先完成起始牌处理。');
  if (room.activePlayerId !== player.id) throw new Error('还没轮到你。');
  if (!isAliveInRound(player)) throw new Error('你本轮已经结束。');
  revealForPlayer(room, player);
  if (!room.pendingAction && isAliveInRound(player)) {
    advanceTurn(room);
  } else if (!room.pendingAction) {
    advanceTurn(room);
  }
}

function resolveFreeze(room, actor, targetId) {
  const pending = room.pendingAction;
  if (!pending || pending.type !== 'freeze') throw new Error('当前没有冻结行动。');
  if (pending.sourcePlayerId !== actor.id) throw new Error('只有翻到行动牌的玩家可以选择目标。');
  const target = getPlayer(room, targetId);
  if (!target) throw new Error('目标玩家不存在。');
  if (target.busted || target.stayed || target.frozen) throw new Error('目标本轮已经结束。');

  target.frozen = true;
  addLog(room, `${actor.name} 冻结了 ${target.name}，${target.name} 锁定 ${target.roundScore} 分。`);
  room.pendingAction = null;

  afterActionResolved(room, pending);
}

function resolveFlip3(room, actor, targetId) {
  const pending = room.pendingAction;
  if (!pending || pending.type !== 'flip3') throw new Error('当前没有翻三张行动。');
  if (pending.sourcePlayerId !== actor.id) throw new Error('只有翻到行动牌的玩家可以选择目标。');
  const target = getPlayer(room, targetId);
  if (!target) throw new Error('目标玩家不存在。');
  if (!isAliveInRound(target)) throw new Error('目标本轮已经结束。');

  addLog(room, `${actor.name} 指定 ${target.name} 连续翻 3 张。`);
  room.pendingAction = null;
  continueResume(room, {
    mode: 'flip3',
    targetPlayerId: target.id,
    remaining: 3,
    after: pending.resume ? 'none' : 'advance',
    parent: pending.resume,
  });
}

function resolveSecondChance(room, actor, targetId) {
  const pending = room.pendingAction;
  if (!pending || pending.type !== 'second') throw new Error('当前没有第二机会行动。');
  if (pending.sourcePlayerId !== actor.id) throw new Error('只有翻到行动牌的玩家可以选择目标。');
  const target = getPlayer(room, targetId);
  if (!target) throw new Error('目标玩家不存在。');
  if (!isAliveInRound(target)) throw new Error('目标本轮已经结束。');
  if (target.hasSecondChance || target.usedSecondChance) throw new Error('目标不能再接收第二机会。');

  target.hasSecondChance = true;
  target.cards.push(pending.card);
  addLog(room, `${actor.name} 把第二机会给了 ${target.name}。`);
  room.pendingAction = null;
  afterActionResolved(room, pending);
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requestPath = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const safePath = normalize(requestPath).replace(/^(\.\.[/\\])+/, '');
  const filePath = join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    fail(res, 403, '禁止访问。');
    return;
  }

  try {
    const data = await readFile(filePath);
    res.writeHead(200, {
      'content-type': mimeTypes[extname(filePath)] || 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(data);
  } catch {
    fail(res, 404, '文件不存在。');
  }
}

async function handleApi(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'POST' && url.pathname === '/api/create') {
      const data = await readJson(req);
      const { room, player } = newRoom(data.name);
      json(res, 200, { roomCode: room.code, playerId: player.id, state: snapshot(room, player.id) });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/join') {
      const data = await readJson(req);
      const room = getRoom(data.roomCode);
      if (!room) return fail(res, 404, '房间不存在。');
      if (room.phase !== 'lobby') return fail(res, 409, '游戏已经开始，不能加入。');
      if (room.players.length >= 8) return fail(res, 409, '房间最多 8 人。');
      const player = newPlayer(randomUUID(), data.name);
      room.players.push(player);
      addLog(room, `${player.name} 加入房间。`);
      sendRoom(room);
      json(res, 200, { roomCode: room.code, playerId: player.id, state: snapshot(room, player.id) });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/action') {
      const data = await readJson(req);
      const { room, player } = requirePlayer(res, data);
      if (!room || !player) return;

      if (data.action === 'start') {
        if (room.hostId !== player.id) throw new Error('只有房主可以开始。');
        if (room.phase !== 'lobby' && room.phase !== 'finished') throw new Error('游戏已经开始。');
        startGame(room);
      } else if (data.action === 'hit') {
        if (room.phase !== 'playing') throw new Error('游戏还没开始。');
        hit(room, player);
      } else if (data.action === 'stay') {
        if (room.phase !== 'playing') throw new Error('游戏还没开始。');
        if (room.pendingAction) throw new Error('请先处理行动牌。');
        if (room.activePlayerId !== player.id) throw new Error('还没轮到你。');
        if (!isAliveInRound(player)) throw new Error('你本轮已经结束。');
        stay(room, player);
      } else if (data.action === 'freeze') {
        if (room.phase !== 'playing') throw new Error('游戏还没开始。');
        resolveFreeze(room, player, data.targetId);
      } else if (data.action === 'flip3') {
        if (room.phase !== 'playing') throw new Error('游戏还没开始。');
        resolveFlip3(room, player, data.targetId);
      } else if (data.action === 'second') {
        if (room.phase !== 'playing') throw new Error('游戏还没开始。');
        resolveSecondChance(room, player, data.targetId);
      } else if (data.action === 'restart') {
        if (room.hostId !== player.id) throw new Error('只有房主可以重开。');
        startGame(room);
      } else {
        throw new Error('未知操作。');
      }

      sendRoom(room);
      json(res, 200, { ok: true, state: snapshot(room, player.id) });
      return;
    }

    fail(res, 404, '接口不存在。');
  } catch (error) {
    fail(res, 400, error.message || '请求失败。');
  }
}

function handleEvents(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const room = getRoom(url.searchParams.get('roomCode'));
  const playerId = url.searchParams.get('playerId');
  const player = getPlayer(room, playerId);
  if (!room || !player) {
    fail(res, 404, '房间或玩家不存在。');
    return;
  }

  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });

  player.connected = true;
  const clientId = randomUUID();
  if (!clients.has(room.code)) {
    clients.set(room.code, new Map());
  }
  clients.get(room.code).set(clientId, { res, playerId });
  res.write(`event: state\n`);
  res.write(`data: ${JSON.stringify(snapshot(room, playerId))}\n\n`);
  sendRoom(room);

  const keepalive = setInterval(() => {
    res.write(`event: ping\n`);
    res.write(`data: {}\n\n`);
  }, 20_000);

  req.on('close', () => {
    clearInterval(keepalive);
    const roomClients = clients.get(room.code);
    if (roomClients) {
      roomClients.delete(clientId);
    }
    player.connected = Array.from((clients.get(room.code) || new Map()).values()).some((client) => client.playerId === player.id);
    sendRoom(room);
  });
}

function sweepRooms() {
  const now = Date.now();
  for (const [code, room] of rooms) {
    const roomClients = clients.get(code);
    if (now - room.updatedAt > ROOM_TTL_MS && !(roomClients && roomClients.size)) {
      rooms.delete(code);
      clients.delete(code);
    }
  }
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) {
    handleApi(req, res);
    return;
  }
  if (req.url.startsWith('/events')) {
    handleEvents(req, res);
    return;
  }
  serveStatic(req, res);
});

setInterval(sweepRooms, 1000 * 60 * 20).unref();

server.listen(PORT, HOST, () => {
  console.log(`七连翻服务器已启动：http://localhost:${PORT}`);
  console.log(`局域网访问：在同一网络中打开 http://服务器IP:${PORT}`);
});
