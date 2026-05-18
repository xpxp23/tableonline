const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const SAVE_FILE = path.join(DATA_DIR, 'rooms.json');

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_PLAYERS = 5;
const AUCTION_SLOTS = 8;
const RA_TRACK_SLOTS = 10;
const RA_START_INDEX = {
  2: 4,
  3: 2,
  4: 1,
  5: 0
};
const RA_LIMIT = {
  2: 6,
  3: 8,
  4: 9,
  5: 10
};
const STARTING_SUN_GROUPS = {
  2: [
    [9, 6, 5, 2],
    [8, 7, 4, 3]
  ],
  3: [
    [13, 8, 5, 2],
    [12, 9, 6, 3],
    [11, 10, 7, 4]
  ],
  4: [
    [13, 6, 2],
    [12, 7, 3],
    [11, 8, 4],
    [10, 9, 5]
  ],
  5: [
    [16, 7, 2],
    [15, 8, 3],
    [14, 9, 4],
    [13, 10, 5],
    [12, 11, 6]
  ]
};

const MONUMENTS = [
  '阶梯金字塔',
  '方尖碑',
  '神庙',
  '雕像',
  '神龛',
  '祭殿',
  '陵庙',
  '狮身人面像'
];

const CIVILIZATIONS = ['艺术', '农业', '宗教', '天文', '书写'];

const TILE_KIND = {
  ra: 'Ra',
  god: '神祇',
  gold: '黄金',
  nile: '尼罗河',
  flood: '洪水',
  pharaoh: '法老',
  civilization: '文明',
  monument: '纪念碑',
  disaster: '灾难'
};

const DISASTER_NAME = {
  funeral: '葬礼',
  drought: '干旱',
  war: '战争',
  earthquake: '地震'
};

const roomStore = new Map();
const clientBuckets = new Map();
let saveTimer = null;

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });
}

function readJsonFile(file) {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function reviveRoom(snapshot) {
  const room = {
    code: snapshot.code,
    createdAt: snapshot.createdAt || Date.now(),
    updatedAt: snapshot.updatedAt || Date.now(),
    players: snapshot.players || [],
    game: snapshot.game || null
  };
  roomStore.set(room.code, room);
  clientBuckets.set(room.code, new Set());
}

function loadRooms() {
  const snapshot = readJsonFile(SAVE_FILE);
  if (!snapshot || !Array.isArray(snapshot.rooms)) return;
  for (const roomSnapshot of snapshot.rooms) reviveRoom(roomSnapshot);
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      const rooms = [...roomStore.values()].map(room => ({
        code: room.code,
        createdAt: room.createdAt,
        updatedAt: room.updatedAt,
        players: room.players,
        game: room.game
      }));
      const payload = JSON.stringify({ rooms }, null, 2);
      const temp = SAVE_FILE + '.tmp';
      fs.writeFileSync(temp, payload, 'utf8');
      fs.renameSync(temp, SAVE_FILE);
    } catch (err) {
      console.error('保存房间失败:', err);
    }
  }, 150);
}

function makeId(bytes = 8) {
  return crypto.randomBytes(bytes).toString('hex');
}

function makeRoomCode() {
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)];
  }
  return code;
}

function newTile(type, extra = {}) {
  return {
    id: makeId(6),
    type,
    ...extra
  };
}

function createDeck() {
  const deck = [];

  for (let i = 0; i < 30; i++) deck.push(newTile('ra'));
  for (let i = 0; i < 8; i++) deck.push(newTile('god'));
  for (let i = 0; i < 5; i++) deck.push(newTile('gold'));
  for (let i = 0; i < 25; i++) deck.push(newTile('pharaoh'));
  for (let i = 0; i < 25; i++) deck.push(newTile('nile'));
  for (let i = 0; i < 12; i++) deck.push(newTile('flood'));

  for (let i = 0; i < 25; i++) {
    deck.push(newTile('civilization', { name: CIVILIZATIONS[i % CIVILIZATIONS.length] }));
  }

  for (let i = 0; i < 40; i++) {
    deck.push(newTile('monument', { name: MONUMENTS[i % MONUMENTS.length] }));
  }

  for (let i = 0; i < 2; i++) deck.push(newTile('disaster', { kind: 'funeral' }));
  for (let i = 0; i < 2; i++) deck.push(newTile('disaster', { kind: 'drought' }));
  for (let i = 0; i < 4; i++) deck.push(newTile('disaster', { kind: 'war' }));
  for (let i = 0; i < 2; i++) deck.push(newTile('disaster', { kind: 'earthquake' }));

  return shuffle(deck);
}

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function createRoom(hostName) {
  const code = makeRoomCode();
  const room = {
    code,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    players: [
      {
        id: makeId(8),
        name: hostName,
        seat: 0,
        color: pickColor(0)
      }
    ],
    game: {
      phase: 'lobby',
      epoch: 1,
      deck: [],
      bagCount: 0,
      auctionTrack: emptyAuctionTrack(),
      raCount: 0,
      raStartIndex: RA_START_INDEX[2],
      raLimit: RA_LIMIT[2],
      centerSun: null,
      currentPlayerSeat: null,
      auction: null,
      pendingDisaster: null,
      pendingGodQueue: null,
      log: [],
      gameOver: null
    }
  };
  roomStore.set(code, room);
  clientBuckets.set(code, new Set());
  pushLog(room, `房间 ${code} 已创建。`);
  scheduleSave();
  return room;
}

function pickColor(index) {
  const colors = ['#b45309', '#0f766e', '#2563eb', '#be123c', '#7c3aed'];
  return colors[index % colors.length];
}

function emptyAuctionTrack() {
  return Array.from({ length: AUCTION_SLOTS }, () => null);
}

function emptyRaTrack() {
  return Array.from({ length: RA_TRACK_SLOTS }, () => null);
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function getRoom(code) {
  return roomStore.get(String(code || '').toUpperCase()) || null;
}

function getPlayer(room, playerId) {
  return room.players.find(p => p.id === playerId) || null;
}

function activePlayers(room) {
  if (!room.game || room.game.phase === 'lobby') return room.players;
  return room.players.filter(p => p.suns && p.suns.some(s => s.faceUp));
}

function seatOrder(room) {
  return room.players
    .slice()
    .sort((a, b) => a.seat - b.seat)
    .map(p => p.seat);
}

function getPlayerBySeat(room, seat) {
  return room.players.find(p => p.seat === seat) || null;
}

function highestSunValue(player) {
  return Math.max(...player.suns.map(s => s.value));
}

function hasFaceUpSunGreaterThan(player, bid) {
  return player.suns.some(s => s.faceUp && s.value > bid);
}

function chooseSunByValue(player, value) {
  return player.suns.find(s => s.faceUp && s.value === value) || null;
}

function nextActiveSeat(room, fromSeat) {
  const seats = seatOrder(room);
  const currentIndex = seats.indexOf(fromSeat);
  if (currentIndex < 0) return null;
  for (let offset = 1; offset <= seats.length; offset++) {
    const seat = seats[(currentIndex + offset) % seats.length];
    const player = getPlayerBySeat(room, seat);
    if (player && player.suns.some(s => s.faceUp)) return seat;
  }
  return null;
}

function currentActivePlayer(room) {
  return getPlayerBySeat(room, room.game.currentPlayerSeat);
}

function allSunsDown(room) {
  return room.players.every(player => !player.suns || !player.suns.some(s => s.faceUp));
}

function bidValues(player) {
  return player.suns.filter(s => s.faceUp).map(s => s.value).sort((a, b) => a - b);
}

function refillLobbyState(room) {
  room.game = {
    phase: 'lobby',
    epoch: 1,
    deck: [],
    bagCount: 0,
    auctionTrack: emptyAuctionTrack(),
    raCount: 0,
    raStartIndex: RA_START_INDEX[2],
    raLimit: RA_LIMIT[2],
    centerSun: null,
    currentPlayerSeat: null,
    auction: null,
    pendingDisaster: null,
    pendingGodQueue: null,
    log: room.game?.log || [],
    gameOver: null
  };
}

function startGame(room) {
  const count = room.players.length;
  if (count < 2 || count > 5) throw new Error('人数必须是 2 到 5 人。');
  const groups = shuffle(STARTING_SUN_GROUPS[count].map(g => g.slice()));
  room.players.forEach((player, index) => {
    const suns = groups[index].map(value => ({
      value,
      faceUp: true
    }));
    player.score = 10;
    player.tiles = [];
    player.suns = suns;
    player.discarded = [];
  });
  room.game = {
    phase: 'main',
    epoch: 1,
    deck: createDeck(),
    bagCount: 180,
    auctionTrack: emptyAuctionTrack(),
    raCount: 0,
    raStartIndex: RA_START_INDEX[count],
    raLimit: RA_LIMIT[count],
    centerSun: 1,
    currentPlayerSeat: highestSeatBySun(room),
    auction: null,
    pendingDisaster: null,
    pendingGodQueue: null,
    log: [],
    gameOver: null
  };
  pushLog(room, `游戏开始。${count} 人局，当前纪元 1。`);
}

function resetToLobby(room) {
  room.players.forEach(player => {
    delete player.score;
    delete player.tiles;
    delete player.suns;
    delete player.discarded;
  });
  room.game = {
    phase: 'lobby',
    epoch: 1,
    deck: [],
    bagCount: 0,
    auctionTrack: emptyAuctionTrack(),
    raCount: 0,
    raStartIndex: RA_START_INDEX[Math.max(2, Math.min(5, room.players.length))] || RA_START_INDEX[2],
    raLimit: RA_LIMIT[Math.max(2, Math.min(5, room.players.length))] || RA_LIMIT[2],
    centerSun: null,
    currentPlayerSeat: null,
    auction: null,
    pendingDisaster: null,
    pendingGodQueue: null,
    log: [],
    gameOver: null
  };
  pushLog(room, '房间已重置，等待重新开始。');
}

function highestSeatBySun(room) {
  let winner = null;
  let best = -Infinity;
  for (const player of room.players) {
    const v = highestSunValue(player);
    if (v > best) {
      best = v;
      winner = player.seat;
    }
  }
  return winner;
}

function pushLog(room, text) {
  room.game.log.push({
    id: makeId(4),
    at: Date.now(),
    text
  });
  if (room.game.log.length > 80) room.game.log.shift();
  room.updatedAt = Date.now();
}

function setPhase(room, phase) {
  room.game.phase = phase;
  room.updatedAt = Date.now();
}

function clearAuction(room) {
  room.game.auction = null;
}

function logTileName(tile) {
  if (!tile) return '';
  if (tile.type === 'disaster') return `灾难-${DISASTER_NAME[tile.kind] || tile.kind}`;
  if (tile.type === 'monument') return tile.name;
  if (tile.type === 'civilization') return tile.name;
  return TILE_KIND[tile.type] || tile.type;
}

function tileMatchesDisaster(tile, kind) {
  if (!tile) return false;
  if (kind === 'funeral') return tile.type === 'pharaoh';
  if (kind === 'drought') return tile.type === 'nile' || tile.type === 'flood';
  if (kind === 'war') return tile.type === 'civilization';
  if (kind === 'earthquake') return tile.type === 'monument';
  return false;
}

function getEligibleDisasterTiles(player, kind) {
  return player.tiles.filter(tile => tileMatchesDisaster(tile, kind));
}

function removePlayerTiles(player, ids) {
  const removed = [];
  for (const id of ids) {
    const index = player.tiles.findIndex(tile => tile.id === id);
    if (index >= 0) {
      removed.push(player.tiles.splice(index, 1)[0]);
    }
  }
  return removed;
}

function takeTileFromAuctionTrack(room, tileId) {
  const index = room.game.auctionTrack.findIndex(tile => tile && tile.id === tileId);
  if (index < 0) return null;
  const tile = room.game.auctionTrack[index];
  room.game.auctionTrack[index] = null;
  return tile;
}

function addTilesToPlayer(room, seat, tiles) {
  const player = getPlayerBySeat(room, seat);
  if (!player) throw new Error('玩家不存在。');
  const normal = [];
  const disasters = [];
  for (const tile of tiles) {
    if (tile.type === 'disaster') disasters.push(tile);
    else normal.push(tile);
  }
  if (normal.length) {
    player.tiles.push(...normal);
    pushLog(room, `${player.name} 获得了 ${normal.map(logTileName).join('、')}。`);
  }
  return disasters;
}

function startAuction(room, trigger, raPlayerSeat) {
  room.game.auction = {
    trigger,
    raPlayerSeat,
    order: buildAuctionOrder(room, raPlayerSeat),
    index: 0,
    highBid: null,
    bids: [],
    passed: [],
    winnerSeat: null
  };
  setPhase(room, 'auction');
  pushLog(room, `${getPlayerBySeat(room, raPlayerSeat)?.name || '未知玩家'} 触发了拍卖。`);
  advanceAuction(room);
}

function buildAuctionOrder(room, raPlayerSeat) {
  const seats = seatOrder(room);
  const start = seats.indexOf(raPlayerSeat);
  if (start < 0) return seats;
  const order = [];
  for (let i = 1; i <= seats.length; i++) {
    order.push(seats[(start + i) % seats.length]);
  }
  return order;
}

function advanceAuction(room) {
  const auction = room.game.auction;
  if (!auction) return;
  while (auction.index < auction.order.length) {
    const seat = auction.order[auction.index];
    const player = getPlayerBySeat(room, seat);
    if (!player || !player.suns.some(s => s.faceUp)) {
      auction.passed.push(seat);
      auction.index += 1;
      continue;
    }
    const currentHigh = auction.highBid ? auction.highBid.value : 0;
    if (!hasFaceUpSunGreaterThan(player, currentHigh)) {
      auction.passed.push(seat);
      auction.index += 1;
      continue;
    }
    return;
  }
  finalizeAuction(room);
}

function finalizeAuction(room) {
  const auction = room.game.auction;
  if (!auction) return;
  const raPlayer = getPlayerBySeat(room, auction.raPlayerSeat);
  const highBid = auction.highBid;
  const wonTiles = room.game.auctionTrack.filter(Boolean);

  if (!highBid) {
    if (auction.trigger === 'trackFull') {
      room.game.auctionTrack = emptyAuctionTrack();
      pushLog(room, '拍卖无人出价，场面牌全部弃置。');
    } else {
      pushLog(room, '拍卖无人出价，场面牌保留。');
    }
    clearAuction(room);
    finishAfterAuction(room, auction.raPlayerSeat);
    return;
  }

  const winner = getPlayerBySeat(room, highBid.seat);
  const usedSun = chooseSunByValue(winner, highBid.value);
  if (!usedSun) throw new Error('出价太阳盘不存在。');
  const oldCenter = room.game.centerSun;
  usedSun.value = oldCenter;
  usedSun.faceUp = false;
  room.game.centerSun = highBid.value;
  room.game.auctionTrack = emptyAuctionTrack();
  auction.winnerSeat = winner.seat;
  pushLog(room, `${winner.name} 以 ${highBid.value} 赢得拍卖，拿走了 ${wonTiles.length} 块牌。`);
  clearAuction(room);
  const disasters = addTilesToPlayer(room, winner.seat, wonTiles);
  if (disasters.length) {
    startDisasterResolution(room, winner.seat, disasters, {
      kind: 'auction',
      raPlayerSeat: auction.raPlayerSeat
    });
    return;
  }
  finishAfterAuction(room, auction.raPlayerSeat);
}

function finishAfterAuction(room, raPlayerSeat) {
  if (allSunsDown(room)) {
    endEpoch(room, '最后一枚太阳盘被用尽');
    return;
  }
  room.game.currentPlayerSeat = nextActiveSeat(room, raPlayerSeat);
  if (room.game.currentPlayerSeat == null) {
    endEpoch(room, '没有可行动的太阳盘');
    return;
  }
  setPhase(room, 'main');
}

function endEpoch(room, reason) {
  scoreEpoch(room);
  room.game.auctionTrack = emptyAuctionTrack();
  room.game.auction = null;
  room.game.pendingDisaster = null;
  room.game.pendingGodQueue = null;

  if (room.game.epoch >= 3) {
    const maxScore = Math.max(...room.players.map(p => p.score));
    const candidates = room.players.filter(p => p.score === maxScore);
    let winner = candidates[0];
    for (const player of candidates) {
      if (highestSunValue(player) > highestSunValue(winner)) winner = player;
    }
    room.game.gameOver = {
      winners: candidates
        .filter(p => highestSunValue(p) === highestSunValue(winner))
        .map(p => p.seat),
      reason
    };
    room.game.phase = 'gameover';
    room.game.currentPlayerSeat = null;
    pushLog(room, `游戏结束。${reason}。`);
    return;
  }

  room.players.forEach(player => {
    player.tiles = player.tiles.filter(tile => {
      return !['god', 'gold', 'civilization', 'flood'].includes(tile.type);
    });
    player.suns.forEach(sun => {
      sun.faceUp = true;
    });
  });
  room.game.raCount = 0;
  room.game.epoch += 1;
  room.game.currentPlayerSeat = highestSeatBySun(room);
  room.game.phase = 'main';
  pushLog(room, `进入第 ${room.game.epoch} 纪元。`);
}

function scoreEpoch(room) {
  const epoch = room.game.epoch;
  const deltas = new Map(room.players.map(p => [p.seat, 0]));

  const pharaohCounts = room.players.map(p => ({
    seat: p.seat,
    count: p.tiles.filter(t => t.type === 'pharaoh').length
  }));
  const pharaohMax = Math.max(...pharaohCounts.map(x => x.count));
  const pharaohMin = Math.min(...pharaohCounts.map(x => x.count));
  if (pharaohMax !== pharaohMin) {
    pharaohCounts.forEach(item => {
      if (item.count === pharaohMax) deltas.set(item.seat, deltas.get(item.seat) + 5);
      if (item.count === pharaohMin) deltas.set(item.seat, deltas.get(item.seat) - 2);
    });
  }

  room.players.forEach(player => {
    const flood = player.tiles.filter(t => t.type === 'flood').length;
    const nile = player.tiles.filter(t => t.type === 'nile').length;
    let delta = deltas.get(player.seat);
    delta += flood;
    if (flood > 0) delta += nile;

    const gold = player.tiles.filter(t => t.type === 'gold').length;
    delta += gold * 3;

    const god = player.tiles.filter(t => t.type === 'god').length;
    delta += god * 2;

    const civTypes = new Set(player.tiles.filter(t => t.type === 'civilization').map(t => t.name));
    if (civTypes.size === 0) {
      delta -= 5;
    } else if (civTypes.size >= 3) {
      delta += [0, 0, 0, 5, 10, 15][civTypes.size] || 15;
    }

    if (epoch === 3) {
      const monumentTypes = new Set(player.tiles.filter(t => t.type === 'monument').map(t => t.name));
      const diversity = monumentTypes.size;
      if (diversity >= 8) delta += 15;
      else if (diversity >= 7) delta += 10;
      else delta += diversity;

      const counts = {};
      for (const tile of player.tiles.filter(t => t.type === 'monument')) {
        counts[tile.name] = (counts[tile.name] || 0) + 1;
      }
      for (const count of Object.values(counts)) {
        if (count >= 5) delta += 15;
        else if (count === 4) delta += 10;
        else if (count === 3) delta += 5;
      }

      const suns = player.suns.map(s => s.value);
      const maxSun = Math.max(...suns);
      const minSun = Math.min(...suns);
      const allSame = maxSun === minSun;
      if (!allSame) {
        if (player.seat === room.game.currentPlayerSeat) {
          // no-op, kept for clarity
        }
        const maxSeats = room.players.filter(p => Math.max(...p.suns.map(s => s.value)) === maxSun);
        const minSeats = room.players.filter(p => Math.min(...p.suns.map(s => s.value)) === minSun);
        if (maxSeats.some(p => p.seat === player.seat)) delta += 5;
        if (minSeats.some(p => p.seat === player.seat)) delta -= 5;
      }
    }

    deltas.set(player.seat, delta);
  });

  for (const player of room.players) {
    const next = Math.max(0, player.score + (deltas.get(player.seat) || 0));
    player.score = next;
  }

  room.game.lastScoreDelta = Object.fromEntries([...deltas.entries()]);
  pushLog(room, `第 ${epoch} 纪元结算完成。`);
}

function startDisasterResolution(room, seat, disasters, resume) {
  room.game.pendingDisaster = {
    seat,
    queue: disasters.map(tile => ({
      kind: tile.kind,
      name: DISASTER_NAME[tile.kind] || tile.kind
    })),
    current: null,
    resume
  };
  setPhase(room, 'disaster');
  processNextDisaster(room);
}

function processNextDisaster(room) {
  const pending = room.game.pendingDisaster;
  if (!pending) return;
  while (pending.queue.length > 0) {
    const next = pending.queue.shift();
    const player = getPlayerBySeat(room, pending.seat);
    const eligible = getEligibleDisasterTiles(player, next.kind);
    if (eligible.length === 0) {
      pushLog(room, `${player.name} 的 ${next.name} 没有造成影响。`);
      continue;
    }
    const removeCount = Math.min(2, eligible.length);
    const requiresChoice = (next.kind === 'war' || next.kind === 'earthquake') && eligible.length > removeCount;
    if (!requiresChoice) {
      const removed = removePlayerTiles(player, eligible.slice(0, removeCount).map(t => t.id));
      pushLog(room, `${player.name} 因 ${next.name} 弃置了 ${removed.map(logTileName).join('、')}。`);
      continue;
    }
    pending.current = {
      kind: next.kind,
      name: next.name,
      required: removeCount,
      eligible: eligible.map(tile => ({
        id: tile.id,
        label: logTileName(tile)
      }))
    };
    return;
  }
  const resume = pending.resume;
  room.game.pendingDisaster = null;
  if (resume?.kind === 'auction') {
    finishAfterAuction(room, resume.raPlayerSeat);
    return;
  }
  if (resume?.kind === 'god') {
    continueGodQueue(room);
  }
}

function continueGodQueue(room) {
  const queue = room.game.pendingGodQueue;
  if (!queue) return;
  const player = getPlayerBySeat(room, queue.seat);
  while (queue.tileIds.length > 0) {
    const godIndex = player.tiles.findIndex(tile => tile.type === 'god');
    if (godIndex < 0) {
      room.game.pendingGodQueue = null;
      throw new Error('神祇牌不足。');
    }
    const tileId = queue.tileIds.shift();
    const trackTile = takeTileFromAuctionTrack(room, tileId);
    if (!trackTile) continue;
    const spent = player.tiles.splice(godIndex, 1)[0];
    pushLog(room, `${player.name} 施放了 1 枚神祇，换得 ${logTileName(trackTile)}。`);
    if (trackTile.type === 'disaster') {
      room.game.pendingGodQueue = queue;
      startDisasterResolution(room, queue.seat, [trackTile], {
        kind: 'god'
      });
      return;
    }
    player.tiles.push(trackTile);
    if (spent) player.discarded = player.discarded || [];
    if (queue.tileIds.length === 0) {
      room.game.pendingGodQueue = null;
      finishGodAction(room, queue.seat);
      return;
    }
  }
  room.game.pendingGodQueue = null;
  finishGodAction(room, queue.seat);
}

function finishGodAction(room, seat) {
  if (allSunsDown(room)) {
    endEpoch(room, '最后一枚太阳盘被用尽');
    return;
  }
  const nextSeat = nextActiveSeat(room, seat);
  room.game.currentPlayerSeat = nextSeat;
  room.game.phase = 'main';
}

function drawTile(room, seat) {
  const player = getPlayerBySeat(room, seat);
  const tile = room.game.deck.shift();
  if (!tile) throw new Error('牌袋已经为空。');
  room.game.bagCount = room.game.deck.length;
  if (tile.type === 'ra') {
    room.game.raCount += 1;
    pushLog(room, `${player.name} 抽到了 Ra 牌。`);
    if (room.game.raCount >= room.game.raLimit) {
      pushLog(room, 'Ra 轨已满，立即结算。');
      endEpoch(room, 'Ra 轨已满');
      return;
    }
    startAuction(room, 'ra', seat);
    return;
  }

  const slot = room.game.auctionTrack.findIndex(x => x == null);
  if (slot < 0) throw new Error('拍卖轨道已满，不能再抽牌。');
  room.game.auctionTrack[slot] = tile;
  pushLog(room, `${player.name} 将 ${logTileName(tile)} 放入拍卖轨道。`);
  if (room.game.auctionTrack.every(Boolean)) {
    pushLog(room, '拍卖轨道已满。');
  }
  if (allSunsDown(room)) {
    endEpoch(room, '最后一枚太阳盘被用尽');
    return;
  }
  room.game.currentPlayerSeat = nextActiveSeat(room, seat);
  room.game.phase = 'main';
}

function invokeRa(room, seat) {
  if (room.game.auctionTrack.every(Boolean) && room.game.auctionTrack.some(Boolean)) {
    startAuction(room, 'trackFull', seat);
    return;
  }
  startAuction(room, 'ra', seat);
}

function useGod(room, seat, tileIds) {
  const player = getPlayerBySeat(room, seat);
  if (!Array.isArray(tileIds) || tileIds.length < 1) throw new Error('至少选择 1 块牌。');
  if (new Set(tileIds).size !== tileIds.length) throw new Error('所选牌不能重复。');
  const godCount = player.tiles.filter(tile => tile.type === 'god').length;
  if (godCount < tileIds.length) throw new Error('神祇牌数量不足。');
  for (const id of tileIds) {
    if (!room.game.auctionTrack.some(tile => tile && tile.id === id)) {
      throw new Error('所选牌不在拍卖轨道上。');
    }
    const tile = room.game.auctionTrack.find(t => t && t.id === id);
    if (tile.type === 'god') throw new Error('神祇牌不能直接换神祇牌。');
  }
  room.game.pendingGodQueue = {
    seat,
    tileIds: tileIds.slice()
  };
  continueGodQueue(room);
}

function bid(room, seat, value) {
  const auction = room.game.auction;
  if (!auction) throw new Error('当前没有拍卖。');
  const player = getPlayerBySeat(room, seat);
  if (!player) throw new Error('玩家不存在。');
  if (!Number.isInteger(value)) throw new Error('出价无效。');
  if (!player.suns.some(s => s.faceUp && s.value === value)) {
    throw new Error('你没有这枚可出价的太阳盘。');
  }
  const high = auction.highBid ? auction.highBid.value : 0;
  if (value <= high) throw new Error('出价必须高于当前最高价。');
  auction.highBid = { seat, value };
  auction.bids.push({ seat, value });
  auction.index += 1;
  pushLog(room, `${player.name} 出价 ${value}。`);
  advanceAuction(room);
}

function passAuction(room, seat) {
  const auction = room.game.auction;
  if (!auction) throw new Error('当前没有拍卖。');
  const player = getPlayerBySeat(room, seat);
  if (!player) throw new Error('玩家不存在。');
  if (auction.trigger === 'ra' && auction.highBid == null && seat === auction.raPlayerSeat) {
    throw new Error('发起者在无人出价前不能放弃。');
  }
  auction.passed.push(seat);
  auction.index += 1;
  pushLog(room, `${player.name} 选择了放弃。`);
  advanceAuction(room);
}

function resolveDisaster(room, seat, tileIds) {
  const pending = room.game.pendingDisaster;
  if (!pending) throw new Error('当前没有灾难结算。');
  if (pending.seat !== seat) throw new Error('只有受影响的玩家可以结算灾难。');
  if (!pending.current) throw new Error('当前灾难无需手动选择。');
  if (!Array.isArray(tileIds) || tileIds.length !== pending.current.required) {
    throw new Error(`请选择 ${pending.current.required} 块牌。`);
  }
  if (new Set(tileIds).size !== tileIds.length) throw new Error('所选牌不能重复。');
  const player = getPlayerBySeat(room, seat);
  const eligibleIds = new Set(pending.current.eligible.map(item => item.id));
  for (const id of tileIds) {
    if (!eligibleIds.has(id)) throw new Error('所选牌不符合当前灾难。');
  }
  const removed = removePlayerTiles(player, tileIds);
  pushLog(room, `${player.name} 因 ${pending.current.name} 弃置了 ${removed.map(logTileName).join('、')}。`);
  pending.current = null;
  processNextDisaster(room);
}

function finalizeRoomStateForClient(room, viewerId) {
  const viewer = getPlayer(room, viewerId);
  const game = room.game || {};
  const seatToViewer = viewer ? viewer.seat : null;

  const players = room.players
    .slice()
    .sort((a, b) => a.seat - b.seat)
    .map(player => {
      const isYou = player.id === viewerId;
      const hiddenScore = game.phase === 'gameover' || isYou;
      return {
        id: player.id,
        name: player.name,
        seat: player.seat,
        color: player.color || pickColor(player.seat),
        isYou,
        score: hiddenScore ? (player.score ?? 0) : null,
        suns: (player.suns || []).map(sun => ({ value: sun.value, faceUp: sun.faceUp })),
        tiles: (player.tiles || []).map(tile => ({
          id: tile.id,
          type: tile.type,
          kind: tile.kind || null,
          name: tile.name || null
        }))
      };
    });

  const auction = game.auction ? {
    trigger: game.auction.trigger,
    raPlayerSeat: game.auction.raPlayerSeat,
    order: game.auction.order.slice(),
    index: game.auction.index,
    highBid: game.auction.highBid ? { ...game.auction.highBid } : null,
    bids: game.auction.bids.map(b => ({ ...b })),
    passed: game.auction.passed.slice(),
    winnerSeat: game.auction.winnerSeat
  } : null;

  const pendingDisaster = game.pendingDisaster ? {
    seat: game.pendingDisaster.seat,
    current: game.pendingDisaster.current ? {
      kind: game.pendingDisaster.current.kind,
      name: game.pendingDisaster.current.name,
      required: game.pendingDisaster.current.required,
      eligible: game.pendingDisaster.current.eligible.map(item => ({ ...item }))
    } : null
  } : null;

  return {
    code: room.code,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
    me: viewer ? {
      id: viewer.id,
      seat: viewer.seat,
      name: viewer.name
    } : null,
    players,
    game: {
      phase: game.phase,
      epoch: game.epoch,
      bagCount: game.bagCount ?? 0,
      raCount: game.raCount ?? 0,
      raStartIndex: game.raStartIndex ?? 0,
      raLimit: game.raLimit ?? 0,
      centerSun: game.centerSun ?? null,
      currentPlayerSeat: game.currentPlayerSeat ?? null,
      auctionTrack: (game.auctionTrack || emptyAuctionTrack()).map(tile => tile ? {
        id: tile.id,
        type: tile.type,
        kind: tile.kind || null,
        name: tile.name || null
      } : null),
      auction,
      pendingDisaster,
      log: (game.log || []).slice(-40),
      gameOver: game.gameOver ? {
        winners: game.gameOver.winners.slice(),
        reason: game.gameOver.reason
      } : null,
      lastScoreDelta: game.lastScoreDelta || null
    }
  };
}

function broadcast(room) {
  room.updatedAt = Date.now();
  const bucket = clientBuckets.get(room.code);
  if (!bucket) return;
  for (const client of bucket) {
    const payload = JSON.stringify(finalizeRoomStateForClient(room, client.playerId));
    client.res.write(`event: state\ndata: ${payload}\n\n`);
  }
  scheduleSave();
}

function addClient(room, playerId, res) {
  const bucket = clientBuckets.get(room.code) || new Set();
  clientBuckets.set(room.code, bucket);
  const client = { playerId, res };
  bucket.add(client);
  res.on('close', () => {
    bucket.delete(client);
  });
  return client;
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1e6) {
        reject(new Error('请求体过大'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('JSON 解析失败'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(data));
}

function sendText(res, status, text, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store'
  });
  res.end(text);
}

function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
  rel = decodeURIComponent(rel);
  const abs = path.resolve(PUBLIC_DIR, rel);
  if (!abs.startsWith(PUBLIC_DIR)) {
    sendText(res, 403, 'Forbidden');
    return;
  }
  fs.stat(abs, (err, stat) => {
    if (err || !stat.isFile()) {
      sendText(res, 404, 'Not Found');
      return;
    }
    const ext = path.extname(abs).toLowerCase();
    const map = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.ico': 'image/x-icon'
    };
    res.writeHead(200, {
      'Content-Type': map[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    fs.createReadStream(abs).pipe(res);
  });
}

function createPlayerPayload(name, seat, id) {
  return {
    id,
    name,
    seat,
    color: pickColor(seat)
  };
}

function handleCreate(req, res) {
  parseBody(req).then(body => {
    const name = String(body.name || '').trim().slice(0, 20);
    if (!name) return sendJson(res, 400, { error: '请输入昵称。' });
    const room = createRoom(name);
    const player = room.players[0];
    sendJson(res, 200, {
      ok: true,
      roomCode: room.code,
      playerId: player.id,
      state: finalizeRoomStateForClient(room, player.id)
    });
    broadcast(room);
  }).catch(err => sendJson(res, 400, { error: err.message }));
}

function handleJoin(req, res) {
  parseBody(req).then(body => {
    const roomCode = String(body.roomCode || '').trim().toUpperCase();
    const name = String(body.name || '').trim().slice(0, 20);
    if (!roomCode) return sendJson(res, 400, { error: '请输入房号。' });
    if (!name) return sendJson(res, 400, { error: '请输入昵称。' });
    const room = getRoom(roomCode);
    if (!room) return sendJson(res, 404, { error: '房间不存在。' });
    if (room.game?.phase !== 'lobby') return sendJson(res, 400, { error: '游戏已经开始，不能再加入。' });
    if (room.players.length >= MAX_PLAYERS) return sendJson(res, 400, { error: '房间已满。' });
    const player = createPlayerPayload(name, room.players.length, makeId(8));
    room.players.push(player);
    pushLog(room, `${name} 加入了房间。`);
    sendJson(res, 200, {
      ok: true,
      roomCode,
      playerId: player.id,
      state: finalizeRoomStateForClient(room, player.id)
    });
    broadcast(room);
  }).catch(err => sendJson(res, 400, { error: err.message }));
}

function handleState(req, res, url) {
  const roomCode = String(url.searchParams.get('roomCode') || '').trim().toUpperCase();
  const playerId = String(url.searchParams.get('playerId') || '').trim();
  const room = getRoom(roomCode);
  if (!room) return sendJson(res, 404, { error: '房间不存在。' });
  const player = getPlayer(room, playerId);
  if (!player) return sendJson(res, 404, { error: '玩家不存在。' });
  sendJson(res, 200, { ok: true, state: finalizeRoomStateForClient(room, playerId) });
}

function ensureActionAllowed(room, playerId) {
  const player = getPlayer(room, playerId);
  if (!player) throw new Error('玩家不存在。');
  return player;
}

function handleAction(req, res) {
  parseBody(req).then(body => {
    const roomCode = String(body.roomCode || '').trim().toUpperCase();
    const playerId = String(body.playerId || '').trim();
    const action = String(body.action || '').trim();
    const room = getRoom(roomCode);
    if (!room) return sendJson(res, 404, { error: '房间不存在。' });
    const player = ensureActionAllowed(room, playerId);
    let changed = false;

    if (action === 'start') {
      if (room.game.phase !== 'lobby') throw new Error('游戏已经开始。');
      if (player.seat !== 0) throw new Error('只有房主可以开始游戏。');
      startGame(room);
      changed = true;
    } else if (action === 'restart') {
      if (room.game.phase !== 'gameover') throw new Error('当前不能重新开局。');
      if (player.seat !== 0) throw new Error('只有房主可以重新开局。');
      resetToLobby(room);
      changed = true;
    } else if (action === 'draw') {
      if (room.game.phase !== 'main') throw new Error('当前不能抽牌。');
      if (room.game.currentPlayerSeat !== player.seat) throw new Error('还没轮到你。');
      if (room.game.auctionTrack.every(Boolean)) throw new Error('拍卖轨道已满，不能抽牌。');
      drawTile(room, player.seat);
      changed = true;
    } else if (action === 'invokeRa') {
      if (room.game.phase !== 'main') throw new Error('当前不能唤起 Ra。');
      if (room.game.currentPlayerSeat !== player.seat) throw new Error('还没轮到你。');
      invokeRa(room, player.seat);
      changed = true;
    } else if (action === 'bid') {
      if (room.game.phase !== 'auction') throw new Error('当前没有拍卖。');
      if (room.game.auction.order[room.game.auction.index] !== player.seat) throw new Error('还没轮到你出价。');
      bid(room, player.seat, Number(body.value));
      changed = true;
    } else if (action === 'pass') {
      if (room.game.phase !== 'auction') throw new Error('当前没有拍卖。');
      if (room.game.auction.order[room.game.auction.index] !== player.seat) throw new Error('还没轮到你操作。');
      passAuction(room, player.seat);
      changed = true;
    } else if (action === 'useGod') {
      if (room.game.phase !== 'main') throw new Error('当前不能使用神祇。');
      if (room.game.currentPlayerSeat !== player.seat) throw new Error('还没轮到你。');
      useGod(room, player.seat, Array.isArray(body.tileIds) ? body.tileIds.map(String) : []);
      changed = true;
    } else if (action === 'resolveDisaster') {
      resolveDisaster(room, player.seat, Array.isArray(body.tileIds) ? body.tileIds.map(String) : []);
      changed = true;
    } else {
      throw new Error('未知操作。');
    }

    if (changed) {
      room.updatedAt = Date.now();
      broadcast(room);
    }
    sendJson(res, 200, { ok: true, state: finalizeRoomStateForClient(room, playerId) });
  }).catch(err => sendJson(res, 400, { error: err.message }));
}

function handleEvents(req, res, url) {
  const roomCode = String(url.searchParams.get('roomCode') || '').trim().toUpperCase();
  const playerId = String(url.searchParams.get('playerId') || '').trim();
  const room = getRoom(roomCode);
  if (!room) return sendText(res, 404, 'Room not found');
  const player = getPlayer(room, playerId);
  if (!player) return sendText(res, 404, 'Player not found');
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    Connection: 'keep-alive'
  });
  res.write(`event: state\ndata: ${JSON.stringify(finalizeRoomStateForClient(room, playerId))}\n\n`);
  const bucket = clientBuckets.get(room.code) || new Set();
  clientBuckets.set(room.code, bucket);
  const client = { playerId, res };
  bucket.add(client);
  const ping = setInterval(() => {
    if (!res.writableEnded) res.write(': ping\n\n');
  }, 25000);
  req.on('close', () => {
    clearInterval(ping);
    bucket.delete(client);
  });
}

ensureDirs();
loadRooms();

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (req.method === 'GET' && url.pathname === '/events') return handleEvents(req, res, url);
    if (req.method === 'GET' && url.pathname === '/api/state') return handleState(req, res, url);
    if (req.method === 'POST' && url.pathname === '/api/create') return handleCreate(req, res);
    if (req.method === 'POST' && url.pathname === '/api/join') return handleJoin(req, res);
    if (req.method === 'POST' && url.pathname === '/api/action') return handleAction(req, res);
    if (req.method === 'GET' && url.pathname.startsWith('/api/')) return sendJson(res, 404, { error: '未找到接口。' });
    if (req.method === 'GET') return serveStatic(req, res, url.pathname);
    return sendText(res, 405, 'Method Not Allowed');
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { error: err.message || '服务器错误' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`RA online server running at http://${HOST === '0.0.0.0' ? '127.0.0.1' : HOST}:${PORT}`);
});
