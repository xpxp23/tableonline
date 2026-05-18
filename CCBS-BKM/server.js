const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { CARDS, COLORS, COLOR_KEYS, MASTER, emptyCost } = require("./game-data");

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");
const CARD_BY_ID = new Map(CARDS.map((card) => [card.id, card]));
const NORMAL_TIERS = [1, 2, 3];
const MARKET_SLOTS = { 1: 4, 2: 4, 3: 4, rare: 1, legend: 1 };
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const rooms = new Map();
const clients = new Map();

function now() {
  return new Date().toISOString();
}

function uid(prefix = "id") {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function roomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 5; i += 1) {
    code += alphabet[crypto.randomInt(alphabet.length)];
  }
  return code;
}

function cloneCost(value) {
  return { ...emptyCost(), ...(value || {}) };
}

function sumTokens(tokens, includeMaster = true) {
  return COLOR_KEYS.reduce((sum, key) => sum + (tokens[key] || 0), includeMaster ? tokens.master || 0 : 0);
}

function addLog(room, text, level = "info") {
  room.logs.push({ time: now(), text, level });
  if (room.logs.length > 80) room.logs.splice(0, room.logs.length - 80);
}

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function tokenSetup(playerCount) {
  const normalCount = playerCount === 2 ? 4 : playerCount === 3 ? 5 : 7;
  const supply = { master: 5 };
  for (const key of COLOR_KEYS) supply[key] = normalCount;
  return supply;
}

function makeDecks() {
  return {
    1: shuffle(CARDS.filter((card) => card.tier === 1).map((card) => card.id)),
    2: shuffle(CARDS.filter((card) => card.tier === 2).map((card) => card.id)),
    3: shuffle(CARDS.filter((card) => card.tier === 3).map((card) => card.id)),
    rare: shuffle(CARDS.filter((card) => card.tier === "rare").map((card) => card.id)),
    legend: shuffle(CARDS.filter((card) => card.tier === "legend").map((card) => card.id)),
  };
}

function makeEmptyMarket() {
  return { 1: [], 2: [], 3: [], rare: [], legend: [] };
}

function drawToMarket(room, tier) {
  while (room.market[tier].length < MARKET_SLOTS[tier] && room.decks[tier].length > 0) {
    room.market[tier].push(room.decks[tier].pop());
  }
}

function refillMarket(room, tier) {
  drawToMarket(room, tier);
}

function createRoom(hostName) {
  let code = roomCode();
  while (rooms.has(code)) code = roomCode();
  const host = makePlayer(hostName, true);
  const room = {
    code,
    phase: "lobby",
    createdAt: now(),
    players: [host],
    decks: makeDecks(),
    market: makeEmptyMarket(),
    supply: { ...emptyCost(), master: 5 },
    currentPlayerIndex: 0,
    firstPlayerId: host.id,
    pendingEvolutionPlayerId: null,
    pendingMainAction: null,
    endTriggeredBy: null,
    winnerIds: [],
    logs: [],
  };
  rooms.set(code, room);
  addLog(room, `${host.name} 创建了房间。`);
  return { room, player: host };
}

function makePlayer(name, host = false) {
  const trimmed = String(name || "").trim().slice(0, 16);
  return {
    id: uid("p"),
    name: trimmed || "训练家",
    host,
    tokens: { ...emptyCost(), master: 0 },
    hand: [],
    captured: [],
    evolvedUnder: [],
    connected: false,
    lastSeen: now(),
  };
}

function getRoom(code) {
  const normalized = String(code || "").trim().toUpperCase();
  const room = rooms.get(normalized);
  if (!room) throw httpError(404, "找不到这个房间。");
  return room;
}

function getPlayer(room, playerId) {
  const player = room.players.find((item) => item.id === playerId);
  if (!player) throw httpError(403, "这个玩家不在房间内。");
  player.lastSeen = now();
  return player;
}

function currentPlayer(room) {
  return room.players[room.currentPlayerIndex] || null;
}

function startRoom(room, player) {
  if (room.phase !== "lobby") throw httpError(400, "游戏已经开始。");
  if (!player.host) throw httpError(403, "只有房主可以开始游戏。");
  if (room.players.length < 2) throw httpError(400, "至少需要 2 名玩家。");
  if (room.players.length > 4) throw httpError(400, "最多支持 4 名玩家。");
  room.phase = "playing";
  room.supply = tokenSetup(room.players.length);
  room.currentPlayerIndex = 0;
  room.firstPlayerId = room.players[0].id;
  for (const p of room.players) {
    p.tokens = { ...emptyCost(), master: 0 };
    p.hand = [];
    p.captured = [];
    p.evolvedUnder = [];
  }
  room.decks = makeDecks();
  room.market = makeEmptyMarket();
  for (const tier of [1, 2, 3, "rare", "legend"]) drawToMarket(room, tier);
  room.pendingEvolutionPlayerId = null;
  room.pendingMainAction = null;
  room.endTriggeredBy = null;
  room.winnerIds = [];
  room.logs = [];
  addLog(room, `游戏开始，${room.players[0].name} 先手。`);
}

function cardPublic(cardId) {
  if (!cardId) return null;
  const card = CARD_BY_ID.get(cardId);
  if (!card) return null;
  return {
    id: card.id,
    name: card.name,
    tier: card.tier,
    kind: card.kind,
    rarity: card.rarity,
    bonus: card.bonus,
    points: card.points,
    cost: card.cost,
    masterCost: card.masterCost,
    evolvesFrom: card.evolvesFrom,
    evolvesTo: card.evolvesTo,
    evolveCost: card.evolveCost,
    type: card.type,
    glyph: card.glyph,
  };
}

function playerBonuses(player) {
  const bonuses = emptyCost();
  for (const cardId of player.captured) {
    const card = CARD_BY_ID.get(cardId);
    if (!card) continue;
    for (const color of card.bonus) {
      bonuses[color] = (bonuses[color] || 0) + 1;
    }
  }
  return bonuses;
}

function playerScore(player) {
  return player.captured.reduce((sum, cardId) => sum + (CARD_BY_ID.get(cardId)?.points || 0), 0);
}

function totalCapturedCount(player) {
  return player.captured.length + player.evolvedUnder.length;
}

function sortWinners(players) {
  return [...players].sort((a, b) => {
    const scoreDiff = playerScore(b) - playerScore(a);
    if (scoreDiff) return scoreDiff;
    const underDiff = b.evolvedUnder.length - a.evolvedUnder.length;
    if (underDiff) return underDiff;
    return totalCapturedCount(b) - totalCapturedCount(a);
  });
}

function computeWinners(room) {
  const ranked = sortWinners(room.players);
  const top = ranked[0];
  if (!top) return [];
  return ranked
    .filter((player) => {
      return (
        playerScore(player) === playerScore(top) &&
        player.evolvedUnder.length === top.evolvedUnder.length &&
        totalCapturedCount(player) === totalCapturedCount(top)
      );
    })
    .map((player) => player.id);
}

function marketCards(room, tier) {
  return room.market[tier].map(cardPublic);
}

function sanitizePlayer(player, viewerId) {
  const isViewer = player.id === viewerId;
  return {
    id: player.id,
    name: player.name,
    host: player.host,
    connected: player.connected,
    tokens: player.tokens,
    tokenCount: sumTokens(player.tokens),
    bonuses: playerBonuses(player),
    score: playerScore(player),
    captured: player.captured.map(cardPublic),
    evolvedUnderCount: player.evolvedUnder.length,
    totalCaptured: totalCapturedCount(player),
    hand: isViewer ? player.hand.map(cardPublic) : [],
    handCount: player.hand.length,
    isViewer,
  };
}

function sanitizeState(room, viewerId) {
  const player = room.players.find((item) => item.id === viewerId);
  return {
    code: room.code,
    phase: room.phase,
    viewerId,
    colors: COLORS,
    master: MASTER,
    players: room.players.map((item) => sanitizePlayer(item, viewerId)),
    currentPlayerId: currentPlayer(room)?.id || null,
    currentPlayerName: currentPlayer(room)?.name || "",
    pendingEvolutionPlayerId: room.pendingEvolutionPlayerId,
    supply: room.supply,
    decks: {
      1: room.decks[1].length,
      2: room.decks[2].length,
      3: room.decks[3].length,
      rare: room.decks.rare.length,
      legend: room.decks.legend.length,
    },
    market: {
      1: marketCards(room, 1),
      2: marketCards(room, 2),
      3: marketCards(room, 3),
      rare: marketCards(room, "rare"),
      legend: marketCards(room, "legend"),
    },
    myEvolutionOptions: player ? evolutionOptions(room, player).map(publicEvolutionOption) : [],
    endTriggeredBy: room.endTriggeredBy,
    winnerIds: room.winnerIds,
    logs: room.logs.slice(-50),
  };
}

function publicEvolutionOption(option) {
  return {
    base: cardPublic(option.baseId),
    target: cardPublic(option.targetId),
    source: option.source,
    tier: option.tier,
  };
}

function broadcast(room) {
  const roomClients = clients.get(room.code);
  if (!roomClients) return;
  for (const client of roomClients) {
    sendEvent(client.response, "state", sanitizeState(room, client.playerId));
  }
}

function sendEvent(response, event, data) {
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(data)}\n\n`);
}

function httpError(status, message, extra = {}) {
  const error = new Error(message);
  error.status = status;
  error.extra = extra;
  return error;
}

function ensureTurn(room, player) {
  if (room.phase !== "playing") throw httpError(400, "游戏不在进行中。");
  if (room.pendingEvolutionPlayerId) {
    if (room.pendingEvolutionPlayerId !== player.id) {
      throw httpError(403, "当前玩家正在处理进化。");
    }
    return;
  }
  if (currentPlayer(room)?.id !== player.id) throw httpError(403, "还没轮到你。");
}

function ensureMainTurn(room, player) {
  ensureTurn(room, player);
  if (room.pendingEvolutionPlayerId) throw httpError(400, "请先完成或跳过回合末进化。");
}

function ensureEvolutionTurn(room, player) {
  if (room.phase !== "playing" || room.pendingEvolutionPlayerId !== player.id) {
    throw httpError(400, "现在不能执行进化。");
  }
}

function validateColor(color) {
  if (!COLOR_KEYS.includes(color)) throw httpError(400, "无效的精灵球颜色。");
}

function validateDiscard(player, discard, required) {
  const clean = { ...emptyCost(), master: 0 };
  if (!discard) {
    if (required > 0) throw httpError(409, `精灵球超过上限，需要归还 ${required} 个。`, { needsDiscard: required });
    return clean;
  }
  let total = 0;
  for (const key of [...COLOR_KEYS, "master"]) {
    const value = Number(discard[key] || 0);
    if (!Number.isInteger(value) || value < 0) throw httpError(400, "归还数量必须是非负整数。");
    if (value > (player.tokens[key] || 0)) throw httpError(400, "归还数量超过你拥有的数量。");
    clean[key] = value;
    total += value;
  }
  if (sumTokens(player.tokens) - total > 10) {
    throw httpError(409, `精灵球超过上限，需要至少归还 ${required} 个。`, { needsDiscard: required });
  }
  return clean;
}

function applyDiscard(room, player, discard) {
  const over = Math.max(0, sumTokens(player.tokens) - 10);
  const clean = validateDiscard(player, discard, over);
  let returned = 0;
  for (const key of [...COLOR_KEYS, "master"]) {
    if (!clean[key]) continue;
    player.tokens[key] -= clean[key];
    room.supply[key] += clean[key];
    returned += clean[key];
  }
  if (returned > 0) addLog(room, `${player.name} 归还了 ${returned} 个精灵球。`);
}

function takeThree(room, player, colors, discard) {
  ensureMainTurn(room, player);
  if (!Array.isArray(colors) || colors.length !== 3) throw httpError(400, "必须选择 3 种不同颜色。");
  const unique = [...new Set(colors)];
  if (unique.length !== 3) throw httpError(400, "拿 3 个时颜色不能重复。");
  for (const color of unique) {
    validateColor(color);
    if (room.supply[color] < 1) throw httpError(400, "供应区没有足够的该颜色精灵球。");
  }
  for (const color of unique) {
    room.supply[color] -= 1;
    player.tokens[color] += 1;
  }
  applyDiscard(room, player, discard);
  addLog(room, `${player.name} 拿取了 3 个不同颜色的精灵球。`);
  finishMainAction(room, player);
}

function takeTwo(room, player, color, discard) {
  ensureMainTurn(room, player);
  validateColor(color);
  if (room.supply[color] < 4) throw httpError(400, "该颜色供应不足 4 个，不能拿 2 个同色。");
  room.supply[color] -= 2;
  player.tokens[color] += 2;
  applyDiscard(room, player, discard);
  addLog(room, `${player.name} 拿取了 2 个${colorName(color)}。`);
  finishMainAction(room, player);
}

function reserveCard(room, player, data, discard) {
  ensureMainTurn(room, player);
  if (player.hand.length >= 3) throw httpError(400, "最多只能保留 3 张宝可梦卡。");
  let cardId;
  let tier;
  let fromDeck = false;
  if (data.cardId) {
    const found = findMarketCard(room, data.cardId);
    if (!found) throw httpError(404, "中央区域没有这张卡。");
    const card = CARD_BY_ID.get(found.cardId);
    if (!NORMAL_TIERS.includes(card.tier)) throw httpError(400, "稀有和传说/幻之宝可梦不能保留。");
    room.market[found.tier].splice(found.index, 1);
    cardId = found.cardId;
    tier = found.tier;
    refillMarket(room, tier);
  } else {
    tier = Number(data.tier);
    if (!NORMAL_TIERS.includes(tier)) throw httpError(400, "只能从普通宝可梦牌堆保留。");
    if (room.decks[tier].length < 1) throw httpError(400, "该等级牌堆已经没有牌。");
    cardId = room.decks[tier].pop();
    fromDeck = true;
  }
  player.hand.push(cardId);
  if (room.supply.master > 0) {
    room.supply.master -= 1;
    player.tokens.master += 1;
  }
  applyDiscard(room, player, discard);
  addLog(room, `${player.name} 保留了${fromDeck ? `${tier} 级牌堆顶部` : CARD_BY_ID.get(cardId).name}，并拿取大师球。`);
  finishMainAction(room, player);
}

function findMarketCard(room, cardId) {
  for (const tier of [1, 2, 3, "rare", "legend"]) {
    const index = room.market[tier].indexOf(cardId);
    if (index !== -1) return { tier, index, cardId };
  }
  return null;
}

function paymentForCard(player, card) {
  const bonuses = playerBonuses(player);
  const normalSpend = emptyCost();
  let missing = 0;
  for (const color of COLOR_KEYS) {
    const need = Math.max(0, (card.cost[color] || 0) - (bonuses[color] || 0));
    const spend = Math.min(player.tokens[color] || 0, need);
    normalSpend[color] = spend;
    missing += need - spend;
  }
  const masterSpend = (card.masterCost || 0) + missing;
  const canPay = (player.tokens.master || 0) >= masterSpend;
  return { canPay, normalSpend, masterSpend, missing, bonuses };
}

function captureCard(room, player, data) {
  ensureMainTurn(room, player);
  const source = data.source === "hand" ? "hand" : "market";
  let cardId;
  let tier = null;
  let index = -1;
  if (source === "hand") {
    index = player.hand.indexOf(data.cardId);
    if (index === -1) throw httpError(404, "你的保留区没有这张卡。");
    cardId = data.cardId;
  } else {
    const found = findMarketCard(room, data.cardId);
    if (!found) throw httpError(404, "中央区域没有这张卡。");
    cardId = found.cardId;
    tier = found.tier;
    index = found.index;
  }
  const card = CARD_BY_ID.get(cardId);
  const payment = paymentForCard(player, card);
  if (!payment.canPay) throw httpError(400, "精灵球不足，无法捕捉这只宝可梦。");
  for (const color of COLOR_KEYS) {
    const spend = payment.normalSpend[color] || 0;
    player.tokens[color] -= spend;
    room.supply[color] += spend;
  }
  player.tokens.master -= payment.masterSpend;
  room.supply.master += payment.masterSpend;
  if (source === "hand") {
    player.hand.splice(index, 1);
  } else {
    room.market[tier].splice(index, 1);
    refillMarket(room, tier);
  }
  player.captured.push(cardId);
  addLog(room, `${player.name} 捕捉了 ${card.name}，获得 ${card.points} 点奖杯。`);
  finishMainAction(room, player);
}

function canMeetBonusCost(player, cost) {
  if (!cost) return true;
  const bonuses = playerBonuses(player);
  return COLOR_KEYS.every((color) => (bonuses[color] || 0) >= (cost[color] || 0));
}

function evolutionOptions(room, player) {
  if (!player) return [];
  const options = [];
  for (const baseId of player.captured) {
    const base = CARD_BY_ID.get(baseId);
    if (!base?.evolvesTo) continue;
    const possibleTargets = [];
    for (const tier of [1, 2, 3, "rare", "legend"]) {
      for (const marketCardId of room.market[tier]) {
        const card = CARD_BY_ID.get(marketCardId);
        if (card?.name === base.evolvesTo && card.evolvesFrom === base.name) {
          possibleTargets.push({ targetId: marketCardId, source: "market", tier });
        }
      }
    }
    for (const handCardId of player.hand) {
      const card = CARD_BY_ID.get(handCardId);
      if (card?.name === base.evolvesTo && card.evolvesFrom === base.name) {
        possibleTargets.push({ targetId: handCardId, source: "hand", tier: card.tier });
      }
    }
    for (const target of possibleTargets) {
      const targetCard = CARD_BY_ID.get(target.targetId);
      if (canMeetBonusCost(player, targetCard.evolveCost)) {
        options.push({ baseId, ...target });
      }
    }
  }
  return options;
}

function evolve(room, player, data) {
  ensureEvolutionTurn(room, player);
  const options = evolutionOptions(room, player);
  const option = options.find((item) => {
    return item.baseId === data.baseId && item.targetId === data.targetId && item.source === data.source;
  });
  if (!option) throw httpError(400, "不满足这次进化的条件。");
  const baseIndex = player.captured.indexOf(option.baseId);
  if (baseIndex === -1) throw httpError(400, "找不到要进化的宝可梦。");
  const targetCard = CARD_BY_ID.get(option.targetId);
  if (option.source === "hand") {
    const handIndex = player.hand.indexOf(option.targetId);
    if (handIndex === -1) throw httpError(400, "保留区没有进化目标。");
    player.hand.splice(handIndex, 1);
  } else {
    const market = findMarketCard(room, option.targetId);
    if (!market) throw httpError(400, "中央区域没有进化目标。");
    room.market[market.tier].splice(market.index, 1);
    refillMarket(room, market.tier);
  }
  const baseCard = CARD_BY_ID.get(option.baseId);
  player.captured.splice(baseIndex, 1, option.targetId);
  player.evolvedUnder.push(option.baseId);
  addLog(room, `${player.name} 将 ${baseCard.name} 进化为 ${targetCard.name}。`);
  room.pendingEvolutionPlayerId = null;
  completeTurn(room, player);
}

function skipEvolution(room, player) {
  ensureEvolutionTurn(room, player);
  room.pendingEvolutionPlayerId = null;
  addLog(room, `${player.name} 跳过了回合末进化。`);
  completeTurn(room, player);
}

function finishMainAction(room, player) {
  const options = evolutionOptions(room, player);
  if (options.length > 0) {
    room.pendingEvolutionPlayerId = player.id;
    addLog(room, `${player.name} 可以选择一次回合末进化。`);
    return;
  }
  completeTurn(room, player);
}

function completeTurn(room, player) {
  if (!room.endTriggeredBy && playerScore(player) >= 18) {
    room.endTriggeredBy = player.id;
    addLog(room, `${player.name} 达到 18 点，触发游戏结束。`, "important");
  }
  const nextIndex = (room.currentPlayerIndex + 1) % room.players.length;
  if (room.endTriggeredBy && nextIndex === 0) {
    room.phase = "ended";
    room.currentPlayerIndex = -1;
    room.winnerIds = computeWinners(room);
    const winnerNames = room.players.filter((p) => room.winnerIds.includes(p.id)).map((p) => p.name).join("、");
    addLog(room, `游戏结束，获胜者：${winnerNames}。`, "important");
    return;
  }
  room.currentPlayerIndex = nextIndex;
}

function colorName(color) {
  return COLORS.find((item) => item.key === color)?.name || color;
}

function handleAction(room, player, body) {
  const type = body.type;
  switch (type) {
    case "take3":
      takeThree(room, player, body.colors, body.discard);
      break;
    case "take2":
      takeTwo(room, player, body.color, body.discard);
      break;
    case "reserve":
      reserveCard(room, player, body, body.discard);
      break;
    case "capture":
      captureCard(room, player, body);
      break;
    case "evolve":
      evolve(room, player, body);
      break;
    case "skipEvolution":
      skipEvolution(room, player);
      break;
    default:
      throw httpError(400, "未知操作。");
  }
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(httpError(413, "请求体过大。"));
        request.destroy();
      }
    });
    request.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(httpError(400, "JSON 格式不正确。"));
      }
    });
    request.on("error", reject);
  });
}

function writeJson(response, data, status = 200) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(data));
}

async function handleApi(request, response, url) {
  if (request.method === "POST" && url.pathname === "/api/create") {
    const body = await readJson(request);
    const { room, player } = createRoom(body.name);
    player.connected = true;
    writeJson(response, { roomCode: room.code, playerId: player.id, state: sanitizeState(room, player.id) });
    broadcast(room);
    return true;
  }
  if (request.method === "POST" && url.pathname === "/api/join") {
    const body = await readJson(request);
    const room = getRoom(body.roomCode);
    if (room.phase !== "lobby") throw httpError(400, "游戏已开始，不能加入。");
    if (room.players.length >= 4) throw httpError(400, "房间人数已满。");
    const player = makePlayer(body.name);
    player.connected = true;
    room.players.push(player);
    addLog(room, `${player.name} 加入了房间。`);
    writeJson(response, { roomCode: room.code, playerId: player.id, state: sanitizeState(room, player.id) });
    broadcast(room);
    return true;
  }
  if (request.method === "POST" && url.pathname === "/api/start") {
    const body = await readJson(request);
    const room = getRoom(body.roomCode);
    const player = getPlayer(room, body.playerId);
    startRoom(room, player);
    writeJson(response, { ok: true, state: sanitizeState(room, player.id) });
    broadcast(room);
    return true;
  }
  if (request.method === "POST" && url.pathname === "/api/action") {
    const body = await readJson(request);
    const room = getRoom(body.roomCode);
    const player = getPlayer(room, body.playerId);
    handleAction(room, player, body);
    writeJson(response, { ok: true, state: sanitizeState(room, player.id) });
    broadcast(room);
    return true;
  }
  if (request.method === "GET" && url.pathname === "/api/state") {
    const room = getRoom(url.searchParams.get("roomCode"));
    const player = getPlayer(room, url.searchParams.get("playerId"));
    writeJson(response, { state: sanitizeState(room, player.id) });
    return true;
  }
  if (request.method === "GET" && url.pathname === "/api/events") {
    const room = getRoom(url.searchParams.get("roomCode"));
    const player = getPlayer(room, url.searchParams.get("playerId"));
    player.connected = true;
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const client = { playerId: player.id, response };
    if (!clients.has(room.code)) clients.set(room.code, new Set());
    clients.get(room.code).add(client);
    sendEvent(response, "state", sanitizeState(room, player.id));
    const heartbeat = setInterval(() => sendEvent(response, "ping", { time: now() }), 25000);
    request.on("close", () => {
      clearInterval(heartbeat);
      const roomClients = clients.get(room.code);
      if (roomClients) roomClients.delete(client);
      if (![...(roomClients || [])].some((item) => item.playerId === player.id)) {
        player.connected = false;
        broadcast(room);
      }
    });
    return true;
  }
  return false;
}

function safeStaticPath(urlPath) {
  const decoded = decodeURIComponent(urlPath);
  const cleanPath = decoded === "/" ? "/index.html" : decoded;
  const fullPath = path.normalize(path.join(PUBLIC_DIR, cleanPath));
  const relative = path.relative(PUBLIC_DIR, fullPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return fullPath;
}

function serveStatic(request, response, url) {
  const fullPath = safeStaticPath(url.pathname);
  if (!fullPath) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }
  fs.stat(fullPath, (statError, stats) => {
    if (statError || !stats.isFile()) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not Found");
      return;
    }
    const ext = path.extname(fullPath).toLowerCase();
    response.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": ext === ".html" ? "no-store" : "public, max-age=600",
    });
    fs.createReadStream(fullPath).pipe(response);
  });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      const handled = await handleApi(request, response, url);
      if (!handled) writeJson(response, { error: "接口不存在。" }, 404);
      return;
    }
    serveStatic(request, response, url);
  } catch (error) {
    const status = error.status || 500;
    writeJson(response, { error: error.message || "服务器错误。", ...(error.extra || {}) }, status);
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`璀璨宝石宝可梦网页版已启动：http://127.0.0.1:${PORT}`);
});
