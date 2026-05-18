const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const SAVE_FILE = path.join(DATA_DIR, "rooms.json");
const ROOM_TTL_MS = 1000 * 60 * 60 * 24;

const rooms = new Map();
const sseClients = new Map();

const BLUE_NUMBERS = Array.from({ length: 12 }, (_, index) => index + 1);

const MISSIONS = [
  {
    id: "training-01",
    name: "训练 01：基础拆弹",
    level: "入门",
    recommendedPlayers: "2-5",
    description: "只使用蓝线与少量红线，先熟悉线架、信息标记、双人剪线和红线揭示。",
    blueTotal: 24,
    yellowCount: 0,
    redCount: 2,
    errorLimit: 4,
    equipmentDeck: [1, 2, 3, 4, 5, 6],
    equipmentInPlay: 2,
    enabledEquipment: true
  },
  {
    id: "training-02",
    name: "训练 02：黄线干扰",
    level: "入门",
    recommendedPlayers: "2-5",
    description: "加入黄线。黄线可以与黄线配对剪断，但任何蓝黄混剪都会失败。",
    blueTotal: 32,
    yellowCount: 4,
    redCount: 2,
    errorLimit: 4,
    equipmentDeck: [1, 2, 3, 4, 5, 6, 7],
    equipmentInPlay: 3,
    enabledEquipment: true
  },
  {
    id: "training-03",
    name: "训练 03：完整蓝线",
    level: "入门",
    recommendedPlayers: "2-5",
    description: "使用全部 48 根蓝线，红线数量较少，适合作为完整局的第一场。",
    blueTotal: 48,
    yellowCount: 0,
    redCount: 3,
    errorLimit: 4,
    equipmentDeck: [1, 2, 3, 4, 5, 6, 8, 9],
    equipmentInPlay: 4,
    enabledEquipment: true
  },
  {
    id: "challenge-01",
    name: "挑战 01：双黄线模块",
    level: "挑战",
    recommendedPlayers: "3-5",
    description: "完整蓝线加更多黄线。团队需要主动管理黄线位置。",
    blueTotal: 48,
    yellowCount: 8,
    redCount: 3,
    errorLimit: 4,
    equipmentDeck: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    equipmentInPlay: 4,
    enabledEquipment: true
  },
  {
    id: "challenge-02",
    name: "挑战 02：少一次容错",
    level: "挑战",
    recommendedPlayers: "2-5",
    description: "完整蓝线、标准黄线和更短引爆盘。每一次剪线都必须有充分理由。",
    blueTotal: 48,
    yellowCount: 4,
    redCount: 4,
    errorLimit: 3,
    equipmentDeck: [1, 2, 3, 4, 5, 6, 8, 9, 10, 11],
    equipmentInPlay: 4,
    enabledEquipment: true
  },
  {
    id: "challenge-03",
    name: "挑战 03：专家套件",
    level: "专家",
    recommendedPlayers: "3-5",
    description: "更多特殊线和更短引爆盘，装备牌库包含全部数字版装备。",
    blueTotal: 48,
    yellowCount: 8,
    redCount: 5,
    errorLimit: 3,
    equipmentDeck: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    equipmentInPlay: 5,
    enabledEquipment: true
  },
  {
    id: "custom",
    name: "自定义 / 实体任务卡",
    level: "自定义",
    recommendedPlayers: "2-5",
    description: "按你手上的任务卡或自定义练习设置参数。此版本不内置官方隐藏任务文本和官方美术。",
    blueTotal: 48,
    yellowCount: 0,
    redCount: 3,
    errorLimit: 4,
    equipmentDeck: [1, 2, 3, 4, 5, 6],
    equipmentInPlay: 4,
    enabledEquipment: true
  }
];

const EQUIPMENT_DEFS = {
  1: { id: 1, name: "双重探测器", type: "detect", text: "选择一根隐藏线，公开它的真实内容。" },
  2: { id: 2, name: "三重探测器", type: "detect", text: "选择一根隐藏线，公开它的真实内容。" },
  3: { id: 3, name: "超级探测器", type: "detect", text: "选择一根隐藏线，公开它的真实内容。" },
  4: { id: 4, name: "X 光扫描", type: "scanNumber", text: "选择一个数字，公开所有未剪断的该数字蓝线。" },
  5: { id: 5, name: "Y 光扫描", type: "scanSpecial", text: "公开所有未剪断的黄线与红线。" },
  6: { id: 6, name: "无线电", type: "handoff", text: "把行动权交给另一名仍有未解除线的玩家。" },
  7: { id: 7, name: "防爆盾", type: "shield", text: "自动抵消下一次普通剪线错误造成的引爆盘推进。" },
  8: { id: 8, name: "时间钳", type: "extraTurn", text: "使用后，本次行动结束时仍由你继续行动。" },
  9: { id: 9, name: "稳定器", type: "stabilizer", text: "自动在引爆盘到达终点时后退一格。" },
  10: { id: 10, name: "排雷图纸", type: "markOne", text: "给任意一根线添加公开文字标记。" },
  11: { id: 11, name: "备用电池", type: "unlock", text: "立即从装备牌库补充 1 件装备进入待解锁区。" },
  12: { id: 12, name: "紧急照明", type: "revealOwn", text: "公开自己线架上的 1 根非红线。" }
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadRooms() {
  try {
    const payload = JSON.parse(fs.readFileSync(SAVE_FILE, "utf8"));
    const now = Date.now();
    for (const room of payload.rooms || []) {
      if (now - (room.updatedAt || 0) < ROOM_TTL_MS) rooms.set(room.code, room);
    }
  } catch {
    // No saved rooms yet.
  }
}

function saveRooms() {
  ensureDataDir();
  fs.writeFileSync(SAVE_FILE, JSON.stringify({ rooms: Array.from(rooms.values()) }, null, 2), "utf8");
}

function uid(prefix = "") {
  return `${prefix}${crypto.randomBytes(5).toString("hex")}`;
}

function makeRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let attempt = 0; attempt < 100; attempt += 1) {
    let code = "";
    for (let i = 0; i < 4; i += 1) code += chars[Math.floor(Math.random() * chars.length)];
    if (!rooms.has(code)) return code;
  }
  return crypto.randomBytes(3).toString("hex").toUpperCase();
}

function makePlayer(name, host = false) {
  return {
    id: uid("p_"),
    token: uid("t_"),
    name: normalizeName(name),
    host,
    connectedAt: Date.now()
  };
}

function normalizeName(name) {
  return String(name || "").trim().slice(0, 16) || "拆弹员";
}

function createRoom(name) {
  const host = makePlayer(name, true);
  const room = {
    code: makeRoomCode(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    hostId: host.id,
    players: [host],
    phase: "lobby",
    missionId: "training-01",
    customConfig: { ...getMission("custom") },
    state: null,
    log: [{ at: Date.now(), text: `${host.name} 创建房间。` }]
  };
  rooms.set(room.code, room);
  persist(room);
  return { room, player: host };
}

function getMission(id) {
  return MISSIONS.find((mission) => mission.id === id) || MISSIONS[0];
}

function currentConfig(room) {
  if (room.missionId === "custom") return normalizeCustomConfig(room.customConfig);
  return getMission(room.missionId);
}

function normalizeCustomConfig(input = {}) {
  const base = getMission("custom");
  return {
    ...base,
    name: String(input.name || base.name).trim().slice(0, 40) || base.name,
    description: String(input.description || base.description).trim().slice(0, 180) || base.description,
    blueTotal: roundToFour(clamp(input.blueTotal ?? input.moduleBlue ?? base.blueTotal, 8, 48)),
    yellowCount: roundToTwo(clamp(input.yellowCount ?? input.yellowPairs * 2 ?? base.yellowCount, 0, 12)),
    redCount: clamp(input.redCount ?? base.redCount, 0, 11),
    errorLimit: clamp(input.errorLimit ?? base.errorLimit, 2, 6),
    equipmentInPlay: clamp(input.equipmentInPlay ?? base.equipmentInPlay, 0, 8),
    enabledEquipment: input.enabledEquipment !== false,
    equipmentDeck: parseEquipmentList(input.equipmentDeck, base.equipmentDeck)
  };
}

function parseEquipmentList(value, fallback) {
  const list = Array.isArray(value)
    ? value
    : String(value || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  const ids = [];
  for (const item of list) {
    const id = Number(item);
    if (EQUIPMENT_DEFS[id] && !ids.includes(id)) ids.push(id);
  }
  return ids.length ? ids : fallback.slice();
}

function clamp(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.max(min, Math.min(max, Math.round(numeric)));
}

function roundToFour(value) {
  return Math.max(4, Math.round(value / 4) * 4);
}

function roundToTwo(value) {
  return Math.round(value / 2) * 2;
}

function requireRoom(code) {
  const room = rooms.get(String(code || "").trim().toUpperCase());
  if (!room) throw httpError(404, "房间不存在或已过期。");
  room.updatedAt = Date.now();
  return room;
}

function requirePlayer(room, token) {
  const player = room.players.find((candidate) => candidate.token === token || candidate.id === token);
  if (!player) throw httpError(403, "玩家身份无效，请重新加入房间。");
  return player;
}

function requireHost(room, player) {
  if (room.hostId !== player.id) throw httpError(403, "只有房主可以执行该操作。");
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function persist(room) {
  room.updatedAt = Date.now();
  if (room.state) room.state.log = room.log.slice(-100);
  saveRooms();
  broadcast(room);
}

function log(room, text, detail = null) {
  room.log.push({ at: Date.now(), text, detail });
  if (room.log.length > 150) room.log = room.log.slice(-150);
  if (room.state) room.state.log = room.log.slice(-100);
}

function shuffle(items) {
  const array = items.slice();
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function makeWire(kind, value = null) {
  return {
    id: uid("w_"),
    kind,
    value,
    owner: null,
    standId: null,
    slot: 0,
    cut: false,
    revealed: false,
    marked: ""
  };
}

function makeBlueDeck(total) {
  const deck = [];
  const fullNumbers = Math.floor(total / 4);
  for (const value of BLUE_NUMBERS.slice(0, fullNumbers)) {
    for (let copy = 0; copy < 4; copy += 1) deck.push(makeWire("blue", value));
  }
  return deck;
}

function makeWireDeck(config) {
  const deck = makeBlueDeck(config.blueTotal);
  for (let i = 0; i < config.yellowCount; i += 1) deck.push(makeWire("yellow"));
  for (let i = 0; i < config.redCount; i += 1) deck.push(makeWire("red"));
  return shuffle(deck);
}

function standPlan(players) {
  if (players.length === 2) return [2, 2];
  if (players.length === 3) return [2, 1, 1];
  return players.map(() => 1);
}

function dealToStands(room, config) {
  const plan = standPlan(room.players);
  const hands = room.players.map((player, playerIndex) => ({
    playerId: player.id,
    stands: Array.from({ length: plan[playerIndex] }, (_, standIndex) => ({
      id: uid("s_"),
      index: standIndex,
      wires: []
    }))
  }));

  const standRefs = hands.flatMap((hand) => hand.stands.map((stand) => ({ hand, stand })));
  const deck = makeWireDeck(config);
  deck.forEach((wire, index) => {
    const { hand, stand } = standRefs[index % standRefs.length];
    wire.owner = hand.playerId;
    wire.standId = stand.id;
    stand.wires.push(wire);
  });

  for (const hand of hands) {
    for (const stand of hand.stands) {
      stand.wires = sortStand(stand.wires);
      stand.wires.forEach((wire, slot) => {
        wire.slot = slot;
        wire.standId = stand.id;
      });
    }
  }
  return hands;
}

function sortStand(wires) {
  return wires.slice().sort((a, b) => {
    const ak = wireSortKey(a);
    const bk = wireSortKey(b);
    if (ak !== bk) return ak - bk;
    return a.id.localeCompare(b.id);
  });
}

function wireSortKey(wire) {
  if (wire.kind === "blue") return wire.value * 10;
  if (wire.kind === "yellow") return 130;
  return 140;
}

function makeEquipment(id) {
  const def = EQUIPMENT_DEFS[id];
  if (!def) return null;
  return {
    instanceId: uid("e_"),
    id,
    name: def.name,
    type: def.type,
    text: def.text,
    used: false
  };
}

function startGame(room) {
  if (room.players.length < 2 || room.players.length > 5) throw httpError(400, "需要 2-5 名玩家才能开始。");
  const config = currentConfig(room);
  const hands = dealToStands(room, config);
  const equipmentPool = shuffle(config.equipmentDeck || []);
  const equipmentCount = config.enabledEquipment ? Math.min(config.equipmentInPlay || room.players.length, equipmentPool.length) : 0;
  const lockedEquipment = equipmentPool.slice(0, equipmentCount).map(makeEquipment).filter(Boolean);
  room.phase = "playing";
  room.log = [];
  room.state = {
    phase: "setup",
    mission: config,
    hands,
    activePlayerId: room.players[0].id,
    turn: 1,
    errorCount: 0,
    errorLimit: config.errorLimit,
    cutCountByValue: {},
    initialHintsByPlayer: {},
    lockedEquipment,
    unlockedEquipment: [],
    usedEquipment: [],
    equipmentDeck: equipmentPool.slice(equipmentCount),
    pendingExtraTurnPlayerId: null,
    winner: false,
    failure: false,
    log: []
  };
  log(room, `任务开始：${config.name}。每名玩家先在自己的蓝线上放置 1 个公开信息标记。`);
  persist(room);
}

function allWires(state) {
  return (state.hands || []).flatMap((hand) => hand.stands.flatMap((stand) => stand.wires));
}

function findWire(state, wireId) {
  return allWires(state).find((wire) => wire.id === wireId);
}

function findHand(state, playerId) {
  return state.hands.find((hand) => hand.playerId === playerId);
}

function findPlayerName(room, playerId) {
  return room.players.find((player) => player.id === playerId)?.name || "未知玩家";
}

function placeInitialHint(room, playerId, wireId) {
  assertPlaying(room);
  if (room.state.phase !== "setup") throw httpError(400, "当前不是信息标记阶段。");
  if (room.state.initialHintsByPlayer[playerId]) throw httpError(400, "你已经放置过初始信息标记。");
  const wire = findWire(room.state, wireId);
  if (!wire || wire.owner !== playerId) throw httpError(400, "只能选择自己线架上的线。");
  if (wire.kind !== "blue") throw httpError(400, "初始信息标记必须放在蓝线上。");
  wire.revealed = true;
  room.state.initialHintsByPlayer[playerId] = wire.id;
  log(room, `${findPlayerName(room, playerId)} 放置了初始信息标记。`);
  if (room.players.every((player) => room.state.initialHintsByPlayer[player.id])) {
    room.state.phase = "playing";
    log(room, `行动权交给 ${findPlayerName(room, room.state.activePlayerId)}。`);
  }
  persist(room);
}

function assertPlaying(room) {
  if (!room.state || (room.state.phase !== "setup" && room.state.phase !== "playing")) {
    throw httpError(400, "当前没有进行中的游戏。");
  }
  if (room.state.winner || room.state.failure) throw httpError(400, "本局已经结束。");
}

function assertTurn(room, playerId) {
  assertPlaying(room);
  if (room.state.phase !== "playing") throw httpError(400, "请等待所有玩家放置初始信息标记。");
  if (room.state.activePlayerId !== playerId) throw httpError(403, "还没有轮到你行动。");
}

function cutPair(room, actorId, firstWireId, secondWireId) {
  assertTurn(room, actorId);
  const first = findWire(room.state, firstWireId);
  const second = findWire(room.state, secondWireId);
  if (!first || !second) throw httpError(400, "找不到选择的线。");
  if (first.id === second.id) throw httpError(400, "请选择两根不同的线。");
  if (first.cut || second.cut) throw httpError(400, "不能选择已经解除的线。");
  const own = first.owner === actorId ? first : second.owner === actorId ? second : null;
  const target = first.owner === actorId ? second : second.owner === actorId ? first : null;
  if (!own || !target) throw httpError(400, "双人剪线必须选择自己 1 根线和另一名玩家 1 根线。");
  if (target.owner === actorId) throw httpError(400, "双人剪线不能选择自己两根线。");
  if (own.kind === "red") throw httpError(400, "红线不能参与剪线。");

  if (target.kind === "red") {
    own.revealed = true;
    target.revealed = true;
    room.state.failure = true;
    room.state.phase = "finished";
    room.phase = "finished";
    revealAll(room.state);
    log(room, `${findPlayerName(room, actorId)} 错剪红线，任务失败。`);
    persist(room);
    return;
  }

  if (sameCuttable(own, target)) {
    own.cut = true;
    target.cut = true;
    own.revealed = true;
    target.revealed = true;
    registerCut(room, own);
    log(room, `${findPlayerName(room, actorId)} 成功剪断 ${wireLabel(own)} 与 ${findPlayerName(room, target.owner)} 的匹配线。`);
    unlockEquipment(room);
    finishAction(room);
  } else {
    target.revealed = true;
    log(room, `${findPlayerName(room, actorId)} 双人剪线失败：目标线公开为 ${wireLabel(target)}。`);
    registerError(room);
    if (!room.state.failure) finishAction(room);
  }
  persist(room);
}

function sameCuttable(a, b) {
  if (a.kind === "blue" && b.kind === "blue") return a.value === b.value;
  if (a.kind === "yellow" && b.kind === "yellow") return true;
  return false;
}

function soloCut(room, actorId, wireIds) {
  assertTurn(room, actorId);
  const uniqueIds = Array.from(new Set(Array.isArray(wireIds) ? wireIds : [wireIds]).values()).filter(Boolean);
  const wires = uniqueIds.map((id) => findWire(room.state, id));
  if (![2, 4].includes(wires.length)) throw httpError(400, "单人剪线必须选择 2 根或 4 根线。");
  if (wires.some((wire) => !wire)) throw httpError(400, "找不到选择的线。");
  if (wires.some((wire) => wire.owner !== actorId)) throw httpError(400, "单人剪线只能选择自己线架上的线。");
  if (wires.some((wire) => wire.cut)) throw httpError(400, "不能选择已经解除的线。");
  if (wires.some((wire) => wire.kind === "red")) throw httpError(400, "红线不能参与剪线。");

  const key = canonicalKey(wires[0]);
  if (!wires.every((wire) => canonicalKey(wire) === key)) {
    throw httpError(400, "单人剪线选择的线必须完全相同。");
  }

  const remaining = allWires(room.state).filter((wire) => !wire.cut && canonicalKey(wire) === key);
  const remainingOwnedByActor = remaining.every((wire) => wire.owner === actorId);
  const selectedSet = new Set(uniqueIds);
  const selectedAllRemaining = remaining.length === wires.length && remaining.every((wire) => selectedSet.has(wire.id));
  if (!remainingOwnedByActor || !selectedAllRemaining) {
    throw httpError(400, "只有当该类型剩余所有线都在你手上时，才能单人剪线。");
  }

  for (const wire of wires) {
    wire.cut = true;
    wire.revealed = true;
  }
  registerCut(room, wires[0], wires.length);
  log(room, `${findPlayerName(room, actorId)} 单人剪断 ${wires.length} 根 ${wireLabel(wires[0])}。`);
  unlockEquipment(room);
  finishAction(room);
  persist(room);
}

function canonicalKey(wire) {
  if (!wire) return "";
  if (wire.kind === "blue") return `blue:${wire.value}`;
  if (wire.kind === "yellow") return "yellow";
  if (wire.kind === "red") return "red";
  return "";
}

function registerCut(room, wire, amount = 2) {
  if (wire.kind === "blue") {
    room.state.cutCountByValue[wire.value] = (room.state.cutCountByValue[wire.value] || 0) + amount;
  }
}

function revealRed(room, actorId) {
  assertTurn(room, actorId);
  const ownRemaining = allWires(room.state).filter((wire) => wire.owner === actorId && !wire.cut);
  if (!ownRemaining.length) throw httpError(400, "你没有需要揭示的线。");
  if (!ownRemaining.every((wire) => wire.kind === "red")) {
    throw httpError(400, "只有当你未解除的线全是红线时，才能执行红线揭示。");
  }
  for (const wire of ownRemaining) {
    wire.revealed = true;
    wire.cut = true;
  }
  log(room, `${findPlayerName(room, actorId)} 揭示并移除了自己的红线。`);
  finishAction(room);
  persist(room);
}

function passTurn(room, actorId) {
  assertTurn(room, actorId);
  log(room, `${findPlayerName(room, actorId)} 跳过行动。`);
  finishAction(room);
  persist(room);
}

function registerError(room) {
  const shield = room.state.unlockedEquipment.find((eq) => eq.type === "shield" && !eq.used);
  if (shield) {
    consumeEquipment(room, shield.instanceId);
    log(room, "防爆盾抵消了这次错误。");
    return;
  }
  room.state.errorCount += 1;
  if (room.state.errorCount >= room.state.errorLimit) {
    const stabilizer = room.state.unlockedEquipment.find((eq) => eq.type === "stabilizer" && !eq.used);
    if (stabilizer) {
      consumeEquipment(room, stabilizer.instanceId);
      room.state.errorCount = Math.max(0, room.state.errorLimit - 1);
      log(room, "稳定器启动，引爆盘后退 1 格。");
      return;
    }
    room.state.failure = true;
    room.state.phase = "finished";
    room.phase = "finished";
    revealAll(room.state);
    log(room, "任务失败：引爆盘到达终点。");
  }
}

function finishAction(room) {
  if (checkWin(room)) return;
  if (room.state.failure) return;
  if (room.state.pendingExtraTurnPlayerId) {
    room.state.activePlayerId = room.state.pendingExtraTurnPlayerId;
    room.state.pendingExtraTurnPlayerId = null;
  } else {
    room.state.activePlayerId = nextActivePlayer(room);
    room.state.turn += 1;
  }
  if (room.state.activePlayerId) log(room, `行动权交给 ${findPlayerName(room, room.state.activePlayerId)}。`);
}

function nextActivePlayer(room) {
  const current = room.players.findIndex((player) => player.id === room.state.activePlayerId);
  for (let offset = 1; offset <= room.players.length; offset += 1) {
    const player = room.players[(current + offset + room.players.length) % room.players.length];
    if (player && hasUnresolvedWires(room.state, player.id)) return player.id;
  }
  return room.state.activePlayerId;
}

function hasUnresolvedWires(state, playerId) {
  return allWires(state).some((wire) => wire.owner === playerId && !wire.cut);
}

function checkWin(room) {
  const remaining = allWires(room.state).filter((wire) => !wire.cut);
  if (!remaining.length) {
    room.state.winner = true;
    room.state.phase = "finished";
    room.phase = "finished";
    log(room, "任务成功：所有线都已解除。");
    return true;
  }
  return false;
}

function unlockEquipment(room) {
  if (!room.state.mission.enabledEquipment) return;
  const locked = room.state.lockedEquipment.slice();
  for (const equipment of locked) {
    if ((room.state.cutCountByValue[equipment.id] || 0) >= 2) {
      const index = room.state.lockedEquipment.findIndex((item) => item.instanceId === equipment.instanceId);
      if (index >= 0) {
        const [unlocked] = room.state.lockedEquipment.splice(index, 1);
        room.state.unlockedEquipment.push(unlocked);
        log(room, `装备解锁：${unlocked.name}。`);
      }
    }
  }
}

function useEquipment(room, actorId, body) {
  assertTurn(room, actorId);
  const equipment = room.state.unlockedEquipment.find((eq) => eq.instanceId === body.equipmentInstanceId && !eq.used);
  if (!equipment) throw httpError(400, "装备不存在或已经使用。");
  const actorName = findPlayerName(room, actorId);

  if (equipment.type === "detect") {
    const wire = findWire(room.state, body.wireId);
    if (!wire || wire.cut) throw httpError(400, "请选择一根未解除的线。");
    wire.revealed = true;
    consumeEquipment(room, equipment.instanceId);
    log(room, `${actorName} 使用${equipment.name}，公开一根线：${wireLabel(wire)}。`);
    finishAction(room);
  } else if (equipment.type === "scanNumber") {
    const value = clamp(body.value, 1, 12);
    for (const wire of allWires(room.state)) {
      if (!wire.cut && wire.kind === "blue" && wire.value === value) wire.revealed = true;
    }
    consumeEquipment(room, equipment.instanceId);
    log(room, `${actorName} 使用${equipment.name}，公开所有 ${value} 号蓝线。`);
    finishAction(room);
  } else if (equipment.type === "scanSpecial") {
    for (const wire of allWires(room.state)) {
      if (!wire.cut && (wire.kind === "yellow" || wire.kind === "red")) wire.revealed = true;
    }
    consumeEquipment(room, equipment.instanceId);
    log(room, `${actorName} 使用${equipment.name}，公开所有黄线与红线。`);
    finishAction(room);
  } else if (equipment.type === "handoff") {
    const targetId = String(body.targetPlayerId || "");
    if (!room.players.some((player) => player.id === targetId)) throw httpError(400, "请选择有效玩家。");
    if (!hasUnresolvedWires(room.state, targetId)) throw httpError(400, "该玩家没有未解除的线。");
    consumeEquipment(room, equipment.instanceId);
    room.state.activePlayerId = targetId;
    log(room, `${actorName} 使用${equipment.name}，行动权交给 ${findPlayerName(room, targetId)}。`);
  } else if (equipment.type === "extraTurn") {
    consumeEquipment(room, equipment.instanceId);
    room.state.pendingExtraTurnPlayerId = actorId;
    log(room, `${actorName} 使用${equipment.name}，本次行动后继续行动。`);
  } else if (equipment.type === "markOne") {
    const wire = findWire(room.state, body.wireId);
    if (!wire || wire.cut) throw httpError(400, "请选择一根未解除的线。");
    wire.marked = String(body.mark || "重点").trim().slice(0, 10) || "重点";
    consumeEquipment(room, equipment.instanceId);
    log(room, `${actorName} 使用${equipment.name}，添加了公开标记。`);
    finishAction(room);
  } else if (equipment.type === "unlock") {
    if (!room.state.equipmentDeck.length) throw httpError(400, "装备牌库已经为空。");
    const next = makeEquipment(room.state.equipmentDeck.shift());
    if (next) room.state.lockedEquipment.push(next);
    consumeEquipment(room, equipment.instanceId);
    log(room, `${actorName} 使用${equipment.name}，补充了 1 件待解锁装备。`);
    finishAction(room);
  } else if (equipment.type === "revealOwn") {
    const wire = findWire(room.state, body.wireId);
    if (!wire || wire.owner !== actorId || wire.cut) throw httpError(400, "请选择自己未解除的线。");
    if (wire.kind === "red") throw httpError(400, "该装备不能公开红线。");
    wire.revealed = true;
    consumeEquipment(room, equipment.instanceId);
    log(room, `${actorName} 使用${equipment.name}，公开自己的一根 ${wireLabel(wire)}。`);
    finishAction(room);
  } else {
    throw httpError(400, "未知装备效果。");
  }
  persist(room);
}

function consumeEquipment(room, instanceId) {
  const index = room.state.unlockedEquipment.findIndex((item) => item.instanceId === instanceId);
  if (index >= 0) {
    const [equipment] = room.state.unlockedEquipment.splice(index, 1);
    equipment.used = true;
    room.state.usedEquipment.push(equipment);
  }
}

function revealAll(state) {
  for (const wire of allWires(state)) wire.revealed = true;
}

function wireLabel(wire) {
  if (wire.kind === "blue") return `${wire.value} 号蓝线`;
  if (wire.kind === "yellow") return "黄线";
  if (wire.kind === "red") return "红线";
  return "未知线";
}

function serializeRoom(room, viewerToken) {
  const viewer = room.players.find((player) => player.token === viewerToken || player.id === viewerToken);
  return {
    code: room.code,
    hostId: room.hostId,
    you: viewer ? { id: viewer.id, name: viewer.name, host: viewer.id === room.hostId, token: viewer.token } : null,
    players: room.players.map((player) => ({ id: player.id, name: player.name, host: player.id === room.hostId })),
    phase: room.phase,
    missionId: room.missionId,
    mission: currentConfig(room),
    missions: MISSIONS,
    equipmentDefs: EQUIPMENT_DEFS,
    customConfig: room.customConfig,
    state: room.state ? serializeState(room, viewer?.id) : null,
    log: room.log.slice(-100),
    serverTime: Date.now()
  };
}

function serializeState(room, viewerId) {
  const state = room.state;
  const visibleAll = Boolean(state.winner || state.failure);
  const totalUncut = allWires(state).filter((wire) => !wire.cut).length;
  const totalWires = allWires(state).length;
  const totalBlue = allWires(state).filter((wire) => wire.kind === "blue").length;
  const cutBlue = allWires(state).filter((wire) => wire.kind === "blue" && wire.cut).length;
  return {
    phase: state.phase,
    mission: state.mission,
    activePlayerId: state.activePlayerId,
    activePlayerName: findPlayerName(room, state.activePlayerId),
    turn: state.turn,
    errorCount: state.errorCount,
    errorLimit: state.errorLimit,
    totalWires,
    totalUncut,
    totalBlue,
    cutBlue,
    initialHintsByPlayer: state.initialHintsByPlayer,
    lockedEquipment: state.lockedEquipment,
    unlockedEquipment: state.unlockedEquipment,
    usedEquipment: state.usedEquipment,
    equipmentDeckCount: state.equipmentDeck.length,
    winner: state.winner,
    failure: state.failure,
    hands: state.hands.map((hand) => ({
      playerId: hand.playerId,
      playerName: findPlayerName(room, hand.playerId),
      self: hand.playerId === viewerId,
      hintPlaced: Boolean(state.initialHintsByPlayer[hand.playerId]),
      stands: hand.stands.map((stand) => ({
        id: stand.id,
        index: stand.index,
        wires: stand.wires.map((wire) => serializeWire(wire, viewerId, visibleAll))
      }))
    })),
    log: state.log || room.log.slice(-100)
  };
}

function serializeWire(wire, viewerId, visibleAll) {
  const canSee = visibleAll || wire.revealed || wire.owner === viewerId;
  return {
    id: wire.id,
    owner: wire.owner,
    standId: wire.standId,
    slot: wire.slot,
    kind: canSee ? wire.kind : "unknown",
    value: canSee ? wire.value : null,
    cut: wire.cut,
    revealed: wire.revealed,
    marked: wire.marked,
    visible: canSee,
    own: wire.owner === viewerId
  };
}

async function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(httpError(413, "请求过大。"));
        request.destroy();
      }
    });
    request.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(httpError(400, "JSON 格式错误。"));
      }
    });
    request.on("error", reject);
  });
}

function json(response, status, data) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(data));
}

async function handleApi(request, response, url) {
  try {
    if (request.method === "GET" && url.pathname === "/api/missions") {
      return json(response, 200, { missions: MISSIONS, equipmentDefs: EQUIPMENT_DEFS });
    }

    if (request.method === "POST" && url.pathname === "/api/create") {
      const body = await readBody(request);
      const { room, player } = createRoom(body.name);
      return json(response, 200, { roomCode: room.code, playerId: player.id, token: player.token, room: serializeRoom(room, player.token) });
    }

    if (request.method === "POST" && url.pathname === "/api/join") {
      const body = await readBody(request);
      const room = requireRoom(body.roomCode);
      if (room.phase !== "lobby") throw httpError(400, "游戏已经开始，不能加入。");
      if (room.players.length >= 5) throw httpError(400, "房间已满，最多 5 人。");
      const player = makePlayer(body.name);
      room.players.push(player);
      log(room, `${player.name} 加入房间。`);
      persist(room);
      return json(response, 200, { roomCode: room.code, playerId: player.id, token: player.token, room: serializeRoom(room, player.token) });
    }

    if (request.method === "GET" && url.pathname === "/api/state") {
      const room = requireRoom(url.searchParams.get("roomCode"));
      return json(response, 200, { room: serializeRoom(room, url.searchParams.get("token")) });
    }

    if (request.method === "GET" && url.pathname === "/api/events") {
      return handleEvents(request, response, url);
    }

    if (request.method === "POST" && url.pathname === "/api/config") {
      const body = await readBody(request);
      const room = requireRoom(body.roomCode);
      const player = requirePlayer(room, body.token);
      requireHost(room, player);
      if (room.phase !== "lobby") throw httpError(400, "只能在大厅调整任务。");
      room.missionId = String(body.missionId || room.missionId);
      if (!MISSIONS.some((mission) => mission.id === room.missionId)) room.missionId = "training-01";
      if (body.customConfig) room.customConfig = normalizeCustomConfig(body.customConfig);
      log(room, `${player.name} 调整了任务设置。`);
      persist(room);
      return json(response, 200, { room: serializeRoom(room, player.token) });
    }

    if (request.method === "POST" && url.pathname === "/api/start") {
      const body = await readBody(request);
      const room = requireRoom(body.roomCode);
      const player = requirePlayer(room, body.token);
      requireHost(room, player);
      if (room.phase !== "lobby" && room.phase !== "finished") throw httpError(400, "当前不能开始新游戏。");
      startGame(room);
      return json(response, 200, { room: serializeRoom(room, player.token) });
    }

    if (request.method === "POST" && url.pathname === "/api/reset") {
      const body = await readBody(request);
      const room = requireRoom(body.roomCode);
      const player = requirePlayer(room, body.token);
      requireHost(room, player);
      room.phase = "lobby";
      room.state = null;
      room.log = [{ at: Date.now(), text: `${player.name} 将房间重置到大厅。` }];
      persist(room);
      return json(response, 200, { room: serializeRoom(room, player.token) });
    }

    if (request.method === "POST" && url.pathname === "/api/action") {
      const body = await readBody(request);
      const room = requireRoom(body.roomCode);
      const player = requirePlayer(room, body.token);
      const action = String(body.action || "");
      if (action === "placeHint") placeInitialHint(room, player.id, body.wireId);
      else if (action === "cutPair") cutPair(room, player.id, body.firstWireId, body.secondWireId);
      else if (action === "soloCut") soloCut(room, player.id, body.wireIds || body.wireId);
      else if (action === "revealRed") revealRed(room, player.id);
      else if (action === "useEquipment") useEquipment(room, player.id, body);
      else if (action === "pass") passTurn(room, player.id);
      else throw httpError(400, "未知行动。");
      return json(response, 200, { room: serializeRoom(room, player.token) });
    }

    throw httpError(404, "接口不存在。");
  } catch (error) {
    return json(response, error.status || 500, { error: error.message || "服务器错误。" });
  }
}

function handleEvents(request, response, url) {
  const room = requireRoom(url.searchParams.get("roomCode"));
  const token = url.searchParams.get("token");
  requirePlayer(room, token);
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "keep-alive"
  });
  response.write(`event: state\ndata: ${JSON.stringify({ room: serializeRoom(room, token) })}\n\n`);
  if (!sseClients.has(room.code)) sseClients.set(room.code, new Set());
  const client = { response, token };
  sseClients.get(room.code).add(client);
  request.on("close", () => sseClients.get(room.code)?.delete(client));
}

function broadcast(room) {
  const clients = sseClients.get(room.code);
  if (!clients) return;
  for (const client of Array.from(clients)) {
    try {
      client.response.write(`event: state\ndata: ${JSON.stringify({ room: serializeRoom(room, client.token) })}\n\n`);
    } catch {
      clients.delete(client);
    }
  }
}

function serveStatic(request, response, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    response.writeHead(403);
    return response.end("Forbidden");
  }
  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const type = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".svg": "image/svg+xml; charset=utf-8",
      ".png": "image/png",
      ".jpg": "image/jpeg"
    }[ext] || "application/octet-stream";
    response.writeHead(200, { "Content-Type": type });
    response.end(content);
  });
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  if (url.pathname.startsWith("/api/")) return handleApi(request, response, url);
  return serveStatic(request, response, url);
});

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms.entries()) {
    if (now - (room.updatedAt || 0) > ROOM_TTL_MS) rooms.delete(code);
  }
  saveRooms();
}, 1000 * 60 * 30).unref();

loadRooms();
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Bomb Buster web game listening on http://0.0.0.0:${PORT}`);
});
