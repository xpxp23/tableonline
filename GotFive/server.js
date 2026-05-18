const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');

const COLORS = [
  { id: 'green', name: '绿色', short: '绿', hex: '#2fb86e' },
  { id: 'pink', name: '粉色', short: '粉', hex: '#e85c9d' },
  { id: 'blue', name: '蓝色', short: '蓝', hex: '#3788db' },
  { id: 'red', name: '红色', short: '红', hex: '#df4d45' },
  { id: 'orange', name: '橙色', short: '橙', hex: '#f39b20' }
];

const COLOR_BY_ID = new Map(COLORS.map((color) => [color.id, color]));

const CATALOG = Array.from({ length: 60 }, (_, index) => {
  const number = index + 1;
  const color = COLORS[index % COLORS.length];
  const dots = Math.floor(index / 20) + 1;
  return {
    id: number,
    number,
    color: color.id,
    colorName: color.name,
    colorShort: color.short,
    colorHex: color.hex,
    dots
  };
});

const TILE_BY_ID = new Map(CATALOG.map((tile) => [tile.id, tile]));
const rooms = new Map();

function randomId(bytes = 12) {
  return crypto.randomBytes(bytes).toString('hex');
}

function randomInt(max) {
  return crypto.randomInt(0, max);
}

function makeRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 200; attempt += 1) {
    let code = '';
    for (let i = 0; i < 4; i += 1) code += alphabet[randomInt(alphabet.length)];
    if (!rooms.has(code)) return code;
  }
  throw new Error('无法生成房间号，请重试。');
}

function sanitizeName(name) {
  const clean = String(name || '').trim().replace(/\s+/g, ' ');
  return clean.slice(0, 18) || `玩家${randomInt(90) + 10}`;
}

function shuffle(list) {
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

function nowStamp() {
  return new Date().toISOString();
}

function createRoom(hostName) {
  const code = makeRoomCode();
  const host = {
    id: randomId(),
    name: sanitizeName(hostName),
    connected: false,
    connectionCount: 0,
    eliminated: false,
    joinedAt: nowStamp()
  };

  const room = {
    code,
    hostId: host.id,
    status: 'lobby',
    players: [host],
    game: null,
    clients: new Set(),
    createdAt: nowStamp()
  };
  rooms.set(code, room);
  return { room, player: host };
}

function getRoom(code) {
  const room = rooms.get(String(code || '').trim().toUpperCase());
  if (!room) throw new Error('房间不存在或服务器已重启。');
  return room;
}

function getPlayer(room, playerId) {
  const player = room.players.find((item) => item.id === playerId);
  if (!player) throw new Error('你不在这个房间中，请重新加入。');
  return player;
}

function addLog(room, text, level = 'info') {
  if (!room.game) return;
  room.game.log.unshift({
    id: randomId(6),
    text,
    level,
    time: new Date().toLocaleTimeString('zh-CN', { hour12: false })
  });
  room.game.log = room.game.log.slice(0, 80);
}

function tileLabel(tile) {
  return `${tile.number}号${tile.colorShort}${tile.dots}点`;
}

function buildPiles() {
  const piles = {};
  for (const color of COLORS) {
    piles[color.id] = shuffle(CATALOG.filter((tile) => tile.color === color.id).slice());
  }
  return piles;
}

function startGame(room, playerId) {
  if (room.hostId !== playerId) throw new Error('只有房主可以开始游戏。');
  if (room.players.length < 2 || room.players.length > 4) throw new Error('Got Five 需要 2-4 名玩家。');

  const piles = buildPiles();
  const hands = {};
  const clues = {};

  for (const player of room.players) {
    player.eliminated = false;
    hands[player.id] = COLORS.map((color) => {
      const tile = piles[color.id].pop();
      if (!tile) throw new Error('牌堆不足，无法发牌。');
      return tile;
    }).sort((a, b) => a.number - b.number);
    clues[player.id] = [];
  }

  const publicTiles = COLORS.map((color) => piles[color.id].pop()).filter(Boolean);

  room.status = 'playing';
  room.game = {
    piles,
    hands,
    clues,
    publicTiles,
    phase: 'reveal',
    turnPlayerId: room.players[0].id,
    lastRevealedId: null,
    winnerId: null,
    endedReason: null,
    log: []
  };

  addLog(room, '游戏开始：每名玩家获得一张每种颜色的隐藏牌，并已按数字升序摆放。');
  addLog(room, `公共区初始翻开：${publicTiles.map(tileLabel).join('、')}。`);
}

function alivePlayers(room) {
  return room.players.filter((player) => !player.eliminated);
}

function canReveal(game) {
  return Object.values(game.piles).some((pile) => pile.length > 0);
}

function ensureGame(room) {
  if (room.status !== 'playing' || !room.game) throw new Error('游戏尚未开始。');
  return room.game;
}

function isPlayersTurn(room, playerId) {
  return ensureGame(room).turnPlayerId === playerId;
}

function nextTurn(room, fromPlayerId) {
  const game = ensureGame(room);
  const alive = alivePlayers(room);
  if (alive.length <= 1) {
    endGame(room, alive[0]?.id || null, alive[0] ? '其他玩家均已淘汰。' : '所有玩家均已淘汰。');
    return;
  }

  const startIndex = Math.max(0, room.players.findIndex((player) => player.id === fromPlayerId));
  for (let offset = 1; offset <= room.players.length; offset += 1) {
    const candidate = room.players[(startIndex + offset) % room.players.length];
    if (!candidate.eliminated) {
      game.turnPlayerId = candidate.id;
      game.phase = canReveal(game) ? 'reveal' : 'clue';
      game.lastRevealedId = null;
      addLog(room, `轮到 ${candidate.name}。`);
      return;
    }
  }
}

function endGame(room, winnerId, reason) {
  if (!room.game) return;
  room.status = 'ended';
  room.game.phase = 'ended';
  room.game.winnerId = winnerId;
  room.game.endedReason = reason;
  const winner = winnerId ? room.players.find((player) => player.id === winnerId) : null;
  addLog(room, winner ? `${winner.name} 获胜：${reason}` : `游戏结束：${reason}`, 'success');
}

function revealTile(room, playerId, colorId) {
  const game = ensureGame(room);
  const player = getPlayer(room, playerId);
  if (player.eliminated) throw new Error('你已被淘汰，不能继续行动。');
  if (!isPlayersTurn(room, playerId)) throw new Error('还没有轮到你。');
  if (game.phase !== 'reveal') throw new Error('当前不是揭牌阶段。');
  if (!COLOR_BY_ID.has(colorId)) throw new Error('颜色无效。');

  const pile = game.piles[colorId];
  if (!pile || pile.length === 0) throw new Error('这个颜色的牌堆已经没有牌了。');
  const tile = pile.pop();
  game.publicTiles.push(tile);
  game.phase = 'clue';
  game.lastRevealedId = tile.id;
  addLog(room, `${player.name} 翻开了 ${tileLabel(tile)}。`);
}

function adjacentPlayers(room, playerId) {
  const index = room.players.findIndex((player) => player.id === playerId);
  if (index < 0) return [];
  if (room.players.length === 2) return [room.players[(index + 1) % 2]];

  const left = room.players[(index - 1 + room.players.length) % room.players.length];
  const right = room.players[(index + 1) % room.players.length];
  return left.id === right.id ? [left] : [left, right];
}

function normalizeResponder(room, playerId, responderId) {
  const options = adjacentPlayers(room, playerId);
  if (options.length === 0) throw new Error('没有可回答线索的相邻玩家。');
  if (!responderId) return options[0];
  const responder = options.find((player) => player.id === responderId);
  if (!responder) throw new Error('只能询问你左右相邻的玩家。');
  return responder;
}

function categorySlot(tile, hand) {
  let slot = 0;
  while (slot < hand.length && hand[slot].number < tile.number) slot += 1;
  return slot;
}

function slotLabel(slot) {
  if (slot === 0) return '小于第1张';
  if (slot === 5) return '大于第5张';
  return `位于第${slot}张和第${slot + 1}张之间`;
}

function useClue(room, playerId, body) {
  const game = ensureGame(room);
  const player = getPlayer(room, playerId);
  if (player.eliminated) throw new Error('你已被淘汰，不能继续行动。');
  if (!isPlayersTurn(room, playerId)) throw new Error('还没有轮到你。');
  if (game.phase !== 'clue') throw new Error('当前不是获取线索阶段。');

  const tileId = Number(body.tileId);
  const tileIndex = game.publicTiles.findIndex((tile) => tile.id === tileId);
  if (tileIndex < 0) throw new Error('请选择公共区中尚未使用的明牌。');
  const tile = game.publicTiles[tileIndex];
  const responder = normalizeResponder(room, playerId, body.responderId);
  const type = body.type === 'compare' ? 'compare' : 'category';
  const hand = game.hands[playerId];

  game.publicTiles.splice(tileIndex, 1);

  if (type === 'category') {
    const slot = categorySlot(tile, hand);
    game.clues[playerId].push({
      id: randomId(6),
      type,
      tile,
      slot,
      responderId: responder.id,
      responderName: responder.name,
      createdAt: nowStamp()
    });
    addLog(room, `${player.name} 询问 ${responder.name}，用 ${tileLabel(tile)} 得到分类线索：${slotLabel(slot)}。`);
  } else {
    const targetIndex = Number(body.targetIndex);
    if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex > 4) throw new Error('比较目标必须是你的第 1-5 张隐藏牌。');
    const targetTile = hand[targetIndex];
    const same = targetTile.dots === tile.dots;
    game.clues[playerId].push({
      id: randomId(6),
      type,
      tile,
      targetIndex,
      targetColor: targetTile.color,
      targetColorName: targetTile.colorName,
      targetColorHex: targetTile.colorHex,
      same,
      responderId: responder.id,
      responderName: responder.name,
      createdAt: nowStamp()
    });
    addLog(room, `${player.name} 询问 ${responder.name}，用 ${tileLabel(tile)} 与自己的第${targetIndex + 1}张（${targetTile.colorShort}）比较：点数${same ? '相同' : '不同'}。`);
  }

  if (game.publicTiles.length === 0 && !canReveal(game)) {
    endGame(room, null, '公共明牌和牌堆均已用尽。');
    return;
  }
  nextTurn(room, playerId);
}

function submitGuess(room, playerId, guess) {
  const game = ensureGame(room);
  const player = getPlayer(room, playerId);
  if (player.eliminated) throw new Error('你已被淘汰，不能再次猜测。');

  const numbers = Array.isArray(guess) ? guess.map(Number) : [];
  if (numbers.length !== 5 || numbers.some((value) => !Number.isInteger(value) || value < 1 || value > 60)) {
    throw new Error('请输入 5 个 1-60 的整数。');
  }
  const unique = new Set(numbers);
  if (unique.size !== 5) throw new Error('5 个数字不能重复。');

  const expected = game.hands[playerId].map((tile) => tile.number);
  const sortedGuess = numbers.slice().sort((a, b) => a - b);
  const correct = expected.every((number, index) => number === sortedGuess[index]);
  if (correct) {
    addLog(room, `${player.name} 宣告 Got Five：${sortedGuess.join('、')}，完全正确！`, 'success');
    endGame(room, playerId, '成功猜出自己的五张隐藏牌。');
    return;
  }

  player.eliminated = true;
  addLog(room, `${player.name} 宣告 Got Five：${sortedGuess.join('、')}，答案错误，已淘汰。`, 'danger');

  const alive = alivePlayers(room);
  if (alive.length <= 1) {
    endGame(room, alive[0]?.id || null, alive[0] ? '其他玩家均已淘汰。' : '无人猜中正确答案。');
    return;
  }

  if (game.turnPlayerId === playerId) nextTurn(room, playerId);
}

function resetRoom(room, playerId) {
  if (room.hostId !== playerId) throw new Error('只有房主可以重开房间。');
  room.status = 'lobby';
  room.game = null;
  for (const player of room.players) player.eliminated = false;
}

function serializeTile(tile) {
  return {
    id: tile.id,
    number: tile.number,
    color: tile.color,
    colorName: tile.colorName,
    colorShort: tile.colorShort,
    colorHex: tile.colorHex,
    dots: tile.dots
  };
}

function serializeClue(clue) {
  const base = {
    id: clue.id,
    type: clue.type,
    tile: serializeTile(clue.tile),
    responderId: clue.responderId,
    responderName: clue.responderName,
    createdAt: clue.createdAt
  };
  if (clue.type === 'category') {
    base.slot = clue.slot;
    base.slotText = slotLabel(clue.slot);
  } else {
    base.targetIndex = clue.targetIndex;
    base.targetColor = clue.targetColor;
    base.targetColorName = clue.targetColorName;
    base.targetColorHex = clue.targetColorHex;
    base.same = clue.same;
  }
  return base;
}

function serializeRoom(room, viewerId) {
  const viewer = room.players.find((player) => player.id === viewerId) || null;
  const revealOwn = room.status === 'ended' || Boolean(viewer?.eliminated);
  const game = room.game;

  return {
    room: {
      code: room.code,
      status: room.status,
      hostId: room.hostId,
      createdAt: room.createdAt
    },
    self: viewer
      ? {
          id: viewer.id,
          name: viewer.name,
          isHost: viewer.id === room.hostId,
          eliminated: viewer.eliminated
        }
      : null,
    players: room.players.map((player) => ({
      id: player.id,
      name: player.name,
      connected: player.connected,
      eliminated: player.eliminated,
      isHost: player.id === room.hostId
    })),
    colors: COLORS,
    catalog: CATALOG,
    game: game
      ? {
          phase: game.phase,
          turnPlayerId: game.turnPlayerId,
          lastRevealedId: game.lastRevealedId,
          winnerId: game.winnerId,
          endedReason: game.endedReason,
          piles: Object.fromEntries(Object.entries(game.piles).map(([color, pile]) => [color, pile.length])),
          publicTiles: game.publicTiles.map(serializeTile),
          hands: room.players.map((player) => ({
            playerId: player.id,
            tiles: game.hands[player.id].map((tile, index) => {
              const hiddenFromViewer = player.id === viewerId && !revealOwn;
              if (!hiddenFromViewer) return serializeTile(tile);
              return {
                id: null,
                number: null,
                color: tile.color,
                colorName: tile.colorName,
                colorShort: tile.colorShort,
                colorHex: tile.colorHex,
                dots: null,
                hidden: true,
                position: index
              };
            })
          })),
          clues: Object.fromEntries(
            Object.entries(game.clues).map(([playerId, clues]) => [playerId, clues.map(serializeClue)])
          ),
          log: game.log
        }
      : null
  };
}

function writeJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        req.destroy();
        reject(new Error('请求过大。'));
      }
    });
    req.on('end', () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('请求 JSON 格式无效。'));
      }
    });
    req.on('error', reject);
  });
}

function sendSse(client, payload) {
  client.res.write(`event: state\ndata: ${JSON.stringify(payload)}\n\n`);
}

function broadcast(room) {
  for (const client of room.clients) {
    sendSse(client, serializeRoom(room, client.playerId));
  }
}

function handleEvents(req, res, url) {
  const code = url.searchParams.get('room');
  const playerId = url.searchParams.get('playerId');
  const room = getRoom(code);
  const player = getPlayer(room, playerId);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write('retry: 1000\n\n');

  const client = { playerId, res };
  room.clients.add(client);
  player.connectionCount += 1;
  player.connected = true;
  sendSse(client, serializeRoom(room, playerId));
  broadcast(room);

  const heartbeat = setInterval(() => {
    res.write(': keep-alive\n\n');
  }, 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    room.clients.delete(client);
    player.connectionCount = Math.max(0, player.connectionCount - 1);
    player.connected = player.connectionCount > 0;
    broadcast(room);
  });
}

async function handleApi(req, res, url) {
  const body = await readJson(req);
  let room;
  let player;

  switch (url.pathname) {
    case '/api/create':
      ({ room, player } = createRoom(body.name));
      writeJson(res, 200, { ok: true, roomCode: room.code, playerId: player.id });
      broadcast(room);
      return;
    case '/api/join':
      room = getRoom(body.roomCode);
      if (body.playerId) {
        const existing = room.players.find((item) => item.id === body.playerId);
        if (existing) {
          existing.name = sanitizeName(body.name || existing.name);
          writeJson(res, 200, { ok: true, roomCode: room.code, playerId: existing.id });
          broadcast(room);
          return;
        }
      }
      if (room.status !== 'lobby') throw new Error('游戏已经开始，只有原玩家可以重连。');
      if (room.players.length >= 4) throw new Error('房间已满，最多 4 人。');
      player = {
        id: randomId(),
        name: sanitizeName(body.name),
        connected: false,
        connectionCount: 0,
        eliminated: false,
        joinedAt: nowStamp()
      };
      room.players.push(player);
      writeJson(res, 200, { ok: true, roomCode: room.code, playerId: player.id });
      broadcast(room);
      return;
    case '/api/start':
      room = getRoom(body.roomCode);
      startGame(room, body.playerId);
      writeJson(res, 200, { ok: true });
      broadcast(room);
      return;
    case '/api/reveal':
      room = getRoom(body.roomCode);
      revealTile(room, body.playerId, body.color);
      writeJson(res, 200, { ok: true });
      broadcast(room);
      return;
    case '/api/clue':
      room = getRoom(body.roomCode);
      useClue(room, body.playerId, body);
      writeJson(res, 200, { ok: true });
      broadcast(room);
      return;
    case '/api/guess':
      room = getRoom(body.roomCode);
      submitGuess(room, body.playerId, body.guess);
      writeJson(res, 200, { ok: true });
      broadcast(room);
      return;
    case '/api/reset':
      room = getRoom(body.roomCode);
      resetRoom(room, body.playerId);
      writeJson(res, 200, { ok: true });
      broadcast(room);
      return;
    default:
      writeJson(res, 404, { ok: false, error: '接口不存在。' });
  }
}

function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    writeJson(res, 403, { ok: false, error: '禁止访问。' });
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const type =
      {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.svg': 'image/svg+xml; charset=utf-8'
      }[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=3600'
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method === 'GET' && url.pathname === '/events') {
      handleEvents(req, res, url);
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      if (req.method !== 'POST') {
        writeJson(res, 405, { ok: false, error: '请使用 POST 请求。' });
        return;
      }
      await handleApi(req, res, url);
      return;
    }
    if (req.method === 'GET') {
      serveStatic(req, res, url);
      return;
    }
    writeJson(res, 405, { ok: false, error: '方法不支持。' });
  } catch (error) {
    writeJson(res, 400, { ok: false, error: error.message || '请求失败。' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Got Five 在线版已启动：http://127.0.0.1:${PORT}`);
});
