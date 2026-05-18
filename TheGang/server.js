"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");
const MAX_NAME_LENGTH = 16;
const ROOM_ID_RE = /^[A-Z0-9]{3,12}$/;

const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
const SUITS = ["S", "H", "D", "C"];
const SUIT_LABELS = { S: "黑桃", H: "红桃", D: "方块", C: "梅花" };
const RANK_LABELS = {
  2: "2",
  3: "3",
  4: "4",
  5: "5",
  6: "6",
  7: "7",
  8: "8",
  9: "9",
  10: "10",
  11: "J",
  12: "Q",
  13: "K",
  14: "A"
};

const HAND_CATEGORY_LABELS = [
  "高牌",
  "一对",
  "两对",
  "三条",
  "顺子",
  "同花",
  "葫芦",
  "四条",
  "同花顺",
  "皇家同花顺"
];

const PHASES = {
  LOBBY: "lobby",
  BETTING: "betting",
  COMPLETE: "complete"
};

const STAGES = [
  { key: "preflop", name: "起手牌", communityCards: 0, chipColor: "white" },
  { key: "flop", name: "翻牌", communityCards: 3, chipColor: "yellow" },
  { key: "turn", name: "转牌", communityCards: 4, chipColor: "orange" },
  { key: "river", name: "河牌", communityCards: 5, chipColor: "red" }
];

const GAME_MODES = [
  {
    id: "basic",
    name: "基础模式",
    level: "基础",
    summary: "不使用挑战牌和专家牌。三次成功获胜，三次失误失败。",
    maxFailures: 3
  },
  {
    id: "advanced",
    name: "进阶模式",
    level: "进阶",
    summary: "第一局无特殊牌。成功后下一局启用一张挑战牌；失败后下一局启用一张专家牌。",
    maxFailures: 3
  },
  {
    id: "professional",
    name: "专业模式",
    level: "专业",
    summary: "移除 1 号挑战牌，开局随机一张挑战牌整场生效；从第二局起仍按成败追加一张临时挑战牌或专家牌。",
    maxFailures: 3
  },
  {
    id: "master",
    name: "大盗模式",
    level: "大盗",
    summary: "移除 1 号挑战牌和所有专家牌。每局始终有两张挑战牌，失误上限为两次。",
    maxFailures: 2
  }
];

const CHALLENGE_CARDS = [
  {
    id: "quick-access",
    number: 1,
    name: "快速进入",
    summary: "本局没有白色芯片。发完手牌后立即翻开三张公共牌，进入翻牌阶段。",
    effects: ["skipWhite"]
  },
  {
    id: "noise-sensors",
    number: 2,
    name: "噪音感应器",
    summary: "白、黄、橙三个阶段的 1 号芯片第一次被拿走后不能再换主人。",
    effects: ["lockLow"]
  },
  {
    id: "motion-detector",
    number: 3,
    name: "移动探测器",
    summary: "翻牌中若至少有一张 J/Q/K，持有白色 1 号芯片的玩家弃掉手牌并重抽。",
    effects: ["replaceLowOnFace"]
  },
  {
    id: "retina-scan",
    number: 4,
    name: "视网膜扫描",
    summary: "结算前，最高红芯玩家以外的玩家必须猜其手牌中至少有一个什么点数。",
    effects: ["guessTopRank"]
  },
  {
    id: "hasty-getaway",
    number: 5,
    name: "仓促撤离",
    summary: "本局没有橙色芯片。翻牌阶段结束后直接进入河牌阶段。",
    effects: ["skipOrange"]
  },
  {
    id: "ventilation-shaft",
    number: 6,
    name: "通风管道",
    summary: "白、黄、橙三个阶段的最高号芯片第一次被拿走后不能再换主人。",
    effects: ["lockHigh"]
  },
  {
    id: "laser-tripwires",
    number: 7,
    name: "激光绊线",
    summary: "翻牌中若没有 J/Q/K，持有最高白芯的玩家弃掉手牌并重抽。",
    effects: ["replaceHighWithoutFace"]
  },
  {
    id: "blackout",
    number: 8,
    name: "停电",
    summary: "进入第 2/3/4 阶段时，所有人弃掉上一阶段的芯片。",
    effects: ["discardPreviousChips"]
  },
  {
    id: "fingerprint-scan",
    number: 9,
    name: "指纹扫描",
    summary: "结算前，最高红芯玩家以外的玩家必须猜其最终牌型。",
    effects: ["guessTopCategory"]
  },
  {
    id: "security-cameras",
    number: 10,
    name: "监控摄像头",
    summary: "每名玩家持有三张手牌，并从三张手牌与五张公共牌中组成最佳五张牌。",
    effects: ["threePocketCards"]
  }
];

const SPECIALIST_CARDS = [
  {
    id: "informant",
    number: 1,
    name: "线人",
    summary: "一名玩家秘密向另一名玩家展示自己的一张手牌。"
  },
  {
    id: "getaway-driver",
    number: 2,
    name: "逃亡司机",
    summary: "一名玩家向所有人公布自己当前牌型的类别，不能透露更多细节。"
  },
  {
    id: "investor",
    number: 3,
    name: "投资人",
    summary: "发完手牌后，每名玩家公布自己手牌中 J/Q/K 的数量。"
  },
  {
    id: "mastermind",
    number: 4,
    name: "主谋",
    summary: "选择一个点数，一名玩家公布自己手牌中该点数有几张。"
  },
  {
    id: "hacker",
    number: 5,
    name: "黑客",
    summary: "一名玩家从牌库抽一张额外手牌，然后弃掉自己的一张手牌。"
  },
  {
    id: "coordinator",
    number: 6,
    name: "协调者",
    summary: "发完手牌后，每名玩家同时选择一张手牌传给左手边玩家。"
  },
  {
    id: "jack",
    number: 7,
    name: "杰克",
    summary: "一名玩家获得一张无花色 J，然后弃掉自己原本的一张手牌。"
  },
  {
    id: "math-whiz",
    number: 8,
    name: "数学天才",
    summary: "发完手牌后，每名玩家公布手牌点数总和；J/Q/K 算 10，A 算 11。"
  },
  {
    id: "con-artist",
    number: 9,
    name: "女骗子",
    summary: "所有人看过手牌后，将所有已发手牌洗混并重新分发。"
  },
  {
    id: "muscle",
    number: 10,
    name: "打手",
    summary: "一名玩家结算时击败所有同牌型的玩家，但不会越过更高牌型。"
  }
];

const rooms = new Map();
const sockets = new Set();

function createRoom(id) {
  return {
    id,
    players: [],
    hostId: null,
    phase: PHASES.LOBBY,
    createdAt: Date.now(),
    game: null,
    settings: {
      modeId: "basic"
    },
    score: {
      successes: 0,
      failures: 0,
      history: []
    },
    cardProgress: null,
    log: []
  };
}

function makeId(prefix = "") {
  return prefix + crypto.randomBytes(8).toString("hex");
}

function normalizeRoomId(roomId) {
  return String(roomId || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 12);
}

function sanitizeName(name) {
  const clean = String(name || "").trim().replace(/\s+/g, " ");
  return clean.slice(0, MAX_NAME_LENGTH) || "无名玩家";
}

function nowLabel() {
  return new Date().toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit" });
}

function pushLog(room, text) {
  room.log.unshift({ id: makeId("log_"), time: nowLabel(), text });
  room.log = room.log.slice(0, 100);
}

function getMode(room) {
  return GAME_MODES.find((mode) => mode.id === room.settings.modeId) || GAME_MODES[0];
}

function getChallenge(id) {
  return CHALLENGE_CARDS.find((card) => card.id === id);
}

function getSpecialist(id) {
  return SPECIALIST_CARDS.find((card) => card.id === id);
}

function resetCampaign(room) {
  room.score = { successes: 0, failures: 0, history: [] };
  room.game = null;
  room.phase = PHASES.LOBBY;
  room.cardProgress = createCardProgress(room.settings.modeId);
}

function randomTake(array) {
  if (array.length === 0) return null;
  const index = crypto.randomInt(array.length);
  const [item] = array.splice(index, 1);
  return item;
}

function createCardProgress(modeId) {
  const challengeIds = CHALLENGE_CARDS.map((card) => card.id);
  const specialistIds = SPECIALIST_CARDS.map((card) => card.id);
  const progress = {
    modeId,
    heistCount: 0,
    challengeDeck: challengeIds.slice(),
    specialistDeck: specialistIds.slice(),
    nextSupport: null,
    permanentChallenges: [],
    masterChallenges: []
  };

  if (modeId === "professional") {
    progress.challengeDeck = challengeIds.filter((id) => id !== "quick-access");
    const permanent = randomTake(progress.challengeDeck);
    if (permanent) progress.permanentChallenges.push(permanent);
  }

  if (modeId === "master") {
    progress.challengeDeck = challengeIds.filter((id) => id !== "quick-access");
    const first = randomTake(progress.challengeDeck);
    const second = randomTake(progress.challengeDeck);
    if (first) progress.masterChallenges.push(first);
    if (second) progress.masterChallenges.push(second);
  }

  return progress;
}

function ensureCardProgress(room) {
  if (!room.cardProgress || room.cardProgress.modeId !== room.settings.modeId) {
    room.cardProgress = createCardProgress(room.settings.modeId);
  }
}

function resetChallengeDeckIfNeeded(room) {
  if (room.cardProgress.challengeDeck.length > 0) return;
  const modeId = room.settings.modeId;
  const blocked = new Set();
  if (modeId === "professional" || modeId === "master") blocked.add("quick-access");
  for (const id of room.cardProgress.permanentChallenges) blocked.add(id);
  for (const id of room.cardProgress.masterChallenges) blocked.add(id);
  room.cardProgress.challengeDeck = CHALLENGE_CARDS.map((card) => card.id).filter((id) => !blocked.has(id));
}

function resetSpecialistDeckIfNeeded(room) {
  if (room.cardProgress.specialistDeck.length > 0) return;
  room.cardProgress.specialistDeck = SPECIALIST_CARDS.map((card) => card.id);
}

function drawSupportCard(room, kind) {
  ensureCardProgress(room);
  if (kind === "challenge") {
    resetChallengeDeckIfNeeded(room);
    const id = room.cardProgress.challengeDeck.shift();
    return id ? { kind: "challenge", id } : null;
  }
  resetSpecialistDeckIfNeeded(room);
  const id = room.cardProgress.specialistDeck.shift();
  return id ? { kind: "specialist", id } : null;
}

function returnSupportCard(room, support) {
  if (!support) return;
  if (support.kind === "challenge") {
    room.cardProgress.challengeDeck.push(support.id);
  } else if (support.kind === "specialist") {
    room.cardProgress.specialistDeck.push(support.id);
  }
}

function refreshMasterChallenges(room) {
  const active = room.cardProgress.masterChallenges
    .map((id) => getChallenge(id))
    .filter(Boolean)
    .sort((a, b) => a.number - b.number);
  if (active.length === 0) return;
  const removed = active[0].id;
  room.cardProgress.masterChallenges = room.cardProgress.masterChallenges.filter((id) => id !== removed);
  room.cardProgress.challengeDeck.push(removed);
  resetChallengeDeckIfNeeded(room);
  const next = room.cardProgress.challengeDeck.shift();
  if (next) room.cardProgress.masterChallenges.push(next);
}

function buildDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({
        id: `${suit}${rank}`,
        suit,
        suitLabel: SUIT_LABELS[suit],
        rank,
        rankLabel: RANK_LABELS[rank],
        red: suit === "H" || suit === "D"
      });
    }
  }
  return deck;
}

function createSpecialJack() {
  return {
    id: `SPECIAL_JACK_${makeId()}`,
    suit: null,
    suitLabel: "无花色",
    rank: 11,
    rankLabel: "J",
    red: false,
    specialist: true
  };
}

function shuffle(deck) {
  const copy = deck.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function compareArraysDesc(a, b) {
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const av = a[i] || 0;
    const bv = b[i] || 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

function handCategoryLabel(category) {
  return HAND_CATEGORY_LABELS[category] || "未知";
}

function describeRanks(ranks) {
  return ranks.map((rank) => RANK_LABELS[rank] || String(rank)).join("、");
}

function straightHigh(uniqueRanks) {
  const ranks = Array.from(new Set(uniqueRanks)).sort((a, b) => b - a);
  if (ranks.includes(14)) ranks.push(1);
  for (let i = 0; i <= ranks.length - 5; i += 1) {
    const window = ranks.slice(i, i + 5);
    let ok = true;
    for (let j = 1; j < window.length; j += 1) {
      if (window[j - 1] - window[j] !== 1) {
        ok = false;
        break;
      }
    }
    if (ok) return window[0] === 1 ? 5 : window[0];
  }
  return 0;
}

function evaluateFive(cards) {
  const ranks = cards.map((card) => card.rank).sort((a, b) => b - a);
  const counts = new Map();
  for (const rank of ranks) counts.set(rank, (counts.get(rank) || 0) + 1);
  const groups = Array.from(counts.entries())
    .map(([rank, count]) => ({ rank, count }))
    .sort((a, b) => b.count - a.count || b.rank - a.rank);
  const isFlush = Boolean(cards[0].suit) && cards.every((card) => card.suit && card.suit === cards[0].suit);
  const straight = straightHigh(ranks);

  if (isFlush && straight === 14) {
    return { category: 9, tiebreakers: [14], label: "皇家同花顺" };
  }
  if (isFlush && straight) {
    return { category: 8, tiebreakers: [straight], label: `同花顺（${RANK_LABELS[straight]} 高）` };
  }
  if (groups[0].count >= 4) {
    const quad = groups[0].rank;
    const kickerGroup = groups.find((group) => group.rank !== quad);
    const kicker = kickerGroup ? kickerGroup.rank : quad;
    return { category: 7, tiebreakers: [quad, kicker], label: `四条（${RANK_LABELS[quad]}）` };
  }
  if (groups[0].count === 3 && groups[1]?.count >= 2) {
    return { category: 6, tiebreakers: [groups[0].rank, groups[1].rank], label: `葫芦（${RANK_LABELS[groups[0].rank]} 带 ${RANK_LABELS[groups[1].rank]}）` };
  }
  if (isFlush) {
    return { category: 5, tiebreakers: ranks, label: `同花（${describeRanks(ranks)}）` };
  }
  if (straight) {
    return { category: 4, tiebreakers: [straight], label: `顺子（${RANK_LABELS[straight]} 高）` };
  }
  if (groups[0].count === 3) {
    const trips = groups[0].rank;
    const kickers = groups.filter((group) => group.rank !== trips).map((group) => group.rank).sort((a, b) => b - a);
    return { category: 3, tiebreakers: [trips, ...kickers], label: `三条（${RANK_LABELS[trips]}）` };
  }
  if (groups[0].count === 2 && groups[1]?.count === 2) {
    const pairs = groups.filter((group) => group.count === 2).map((group) => group.rank).sort((a, b) => b - a);
    const kicker = groups.find((group) => group.count === 1)?.rank || 0;
    return { category: 2, tiebreakers: [...pairs, kicker], label: `两对（${describeRanks(pairs)}）` };
  }
  if (groups[0].count === 2) {
    const pair = groups[0].rank;
    const kickers = groups.filter((group) => group.rank !== pair).map((group) => group.rank).sort((a, b) => b - a);
    return { category: 1, tiebreakers: [pair, ...kickers], label: `一对（${RANK_LABELS[pair]}）` };
  }
  return { category: 0, tiebreakers: ranks, label: `高牌（${describeRanks(ranks)}）` };
}

function compareEval(a, b) {
  if (a.category !== b.category) return a.category - b.category;
  return compareArraysDesc(a.tiebreakers, b.tiebreakers);
}

function combinations(cards, size) {
  const result = [];
  const combo = [];
  function walk(start) {
    if (combo.length === size) {
      result.push(combo.slice());
      return;
    }
    for (let i = start; i <= cards.length - (size - combo.length); i += 1) {
      combo.push(cards[i]);
      walk(i + 1);
      combo.pop();
    }
  }
  walk(0);
  return result;
}

function evaluateBest(cards) {
  let best = null;
  let bestCards = [];
  for (const five of combinations(cards, 5)) {
    const value = evaluateFive(five);
    if (!best || compareEval(value, best) > 0) {
      best = value;
      bestCards = five.slice();
    }
  }
  return {
    ...best,
    categoryLabel: handCategoryLabel(best.category),
    bestCards: bestCards.map((card) => card.id),
    strengthKey: [best.category, ...best.tiebreakers].join(".")
  };
}

function evaluateCurrentCategory(cards) {
  if (cards.length >= 5) return evaluateBest(cards);
  const counts = new Map();
  for (const card of cards) counts.set(card.rank, (counts.get(card.rank) || 0) + 1);
  const groups = Array.from(counts.entries())
    .map(([rank, count]) => ({ rank, count }))
    .sort((a, b) => b.count - a.count || b.rank - a.rank);
  let category = 0;
  if (groups[0]?.count >= 4) category = 7;
  else if (groups[0]?.count === 3) category = 3;
  else if (groups[0]?.count === 2 && groups[1]?.count === 2) category = 2;
  else if (groups[0]?.count === 2) category = 1;
  return {
    category,
    categoryLabel: handCategoryLabel(category),
    label: handCategoryLabel(category),
    tiebreakers: groups.map((group) => group.rank)
  };
}

function activePlayers(room) {
  return room.players.filter((player) => !player.left);
}

function playerById(room, playerId) {
  return room.players.find((player) => player.id === playerId);
}

function activePlayerIds(room) {
  return activePlayers(room).map((player) => player.id);
}

function maxFailures(room) {
  return getMode(room).maxFailures;
}

function targetSuccesses() {
  return 3;
}

function currentStage(room) {
  return STAGES[room.game.stageIndex];
}

function activeChallengeCards(room) {
  return room.game?.activeChallenges || [];
}

function hasChallenge(room, effect) {
  return activeChallengeCards(room).some((card) => card.effects.includes(effect));
}

function hasSpecialist(room, id) {
  return room.game?.activeSpecialist?.id === id;
}

function isSpecialistUsed(room, id) {
  return Boolean(room.game?.usedSpecialists?.[id]);
}

function comparePlayerRows(room, a, b) {
  if (a.handValue.category !== b.handValue.category) {
    return a.handValue.category - b.handValue.category;
  }
  const muscleHolder = room.game?.specialistState?.muscleHolder;
  if (muscleHolder) {
    if (a.playerId === muscleHolder && b.playerId !== muscleHolder) return 1;
    if (b.playerId === muscleHolder && a.playerId !== muscleHolder) return -1;
  }
  return compareArraysDesc(a.handValue.tiebreakers, b.handValue.tiebreakers);
}

function recalculateRankings(room) {
  const game = room.game;
  if (!game) return;
  const rows = activePlayers(room).map((player) => ({
    playerId: player.id,
    handValue: evaluateBest([...game.hands[player.id], ...game.community])
  }));
  rows.sort((a, b) => comparePlayerRows(room, a, b));
  game.rankings = rows.map((row, index) => ({ ...row, rank: index + 1 }));
}

function chipNumbers(room) {
  return activePlayers(room).map((_, index) => index + 1);
}

function emptyChipAssignments() {
  return { white: {}, yellow: {}, orange: {}, red: {} };
}

function emptyLockedChips() {
  return { white: {}, yellow: {}, orange: {}, red: {} };
}

function colorName(color) {
  return {
    white: "白色",
    yellow: "黄色",
    orange: "橙色",
    red: "红色",
    green: "绿色"
  }[color] || color;
}

function createGame(room, supportCard) {
  const mode = getMode(room);
  const players = activePlayers(room);
  const deck = shuffle(buildDeck());
  const activeChallenges = [];
  let activeSpecialist = null;

  if (mode.id === "advanced" || mode.id === "professional") {
    if (supportCard?.kind === "challenge") activeChallenges.push(getChallenge(supportCard.id));
    if (supportCard?.kind === "specialist") activeSpecialist = getSpecialist(supportCard.id);
  }
  if (mode.id === "professional") {
    for (const id of room.cardProgress.permanentChallenges) activeChallenges.unshift(getChallenge(id));
  }
  if (mode.id === "master") {
    for (const id of room.cardProgress.masterChallenges) activeChallenges.push(getChallenge(id));
  }

  const pocketCount = activeChallenges.some((card) => card.effects.includes("threePocketCards")) ? 3 : 2;
  const hands = {};
  for (const player of players) {
    hands[player.id] = [];
    for (let i = 0; i < pocketCount; i += 1) hands[player.id].push(deck.pop());
  }
  const community = [deck.pop(), deck.pop(), deck.pop(), deck.pop(), deck.pop()];
  const stageIndex = activeChallenges.some((card) => card.effects.includes("skipWhite")) ? 1 : 0;

  const game = {
    roundId: makeId("round_"),
    stageIndex,
    deck,
    discard: [],
    hands,
    community,
    rankings: [],
    chipAssignments: emptyChipAssignments(),
    lockedChips: emptyLockedChips(),
    moveCounts: {},
    playerMoveCounts: {},
    stageMoves: {},
    activeChallenges: activeChallenges.filter(Boolean),
    activeSpecialist,
    activeSupport: supportCard,
    usedSpecialists: {},
    specialistState: {},
    challengeGuesses: {},
    publicInfo: [],
    privateInfoByPlayer: {},
    pending: null,
    result: null,
    startedAt: Date.now()
  };
  room.game = game;
  recalculateRankings(room);
  applyStageEntryEffects(room, stageIndex);
  applyAutomaticSpecialist(room);
  return game;
}

function addPublicInfo(room, text) {
  room.game.publicInfo.unshift({ id: makeId("info_"), time: nowLabel(), text });
  room.game.publicInfo = room.game.publicInfo.slice(0, 80);
  pushLog(room, text);
}

function addPrivateInfo(room, playerId, text, card = null) {
  room.game.privateInfoByPlayer[playerId] = room.game.privateInfoByPlayer[playerId] || [];
  room.game.privateInfoByPlayer[playerId].unshift({ id: makeId("priv_"), time: nowLabel(), text, card: card ? publicCard(card) : null });
  room.game.privateInfoByPlayer[playerId] = room.game.privateInfoByPlayer[playerId].slice(0, 30);
}

function applyAutomaticSpecialist(room) {
  const game = room.game;
  const specialist = game.activeSpecialist;
  if (!specialist) return;

  if (specialist.id === "investor") {
    for (const player of activePlayers(room)) {
      const count = game.hands[player.id].filter((card) => [11, 12, 13].includes(card.rank)).length;
      addPublicInfo(room, `${player.name} 的手牌中有 ${count} 张人头牌（J/Q/K）。`);
    }
    game.usedSpecialists[specialist.id] = true;
  }

  if (specialist.id === "math-whiz") {
    for (const player of activePlayers(room)) {
      const sum = game.hands[player.id].reduce((total, card) => total + (card.rank === 14 ? 11 : Math.min(card.rank, 10)), 0);
      addPublicInfo(room, `${player.name} 的手牌点数总和是 ${sum}。`);
    }
    game.usedSpecialists[specialist.id] = true;
  }

  if (specialist.id === "con-artist") {
    game.pending = { type: "conArtistConfirm", confirmed: {} };
    addPublicInfo(room, "女骗子生效：所有玩家先记住当前手牌，然后确认洗混重发。");
  }

  if (specialist.id === "coordinator") {
    game.pending = { type: "coordinatorPass", choices: {} };
    addPublicInfo(room, "协调者生效：每名玩家选择一张手牌，确认后同时传给左手边玩家。");
  }
}

function applyStageEntryEffects(room, newStageIndex) {
  const game = room.game;
  if (!game) return;
  if (hasChallenge(room, "discardPreviousChips")) {
    if (newStageIndex === 1) game.chipAssignments.white = {};
    if (newStageIndex === 2) game.chipAssignments.yellow = {};
    if (newStageIndex === 3) game.chipAssignments.orange = {};
  }
  if (newStageIndex === 1) {
    applyFlopReplacementChallenges(room);
  }
}

function replacePocketCards(room, playerId, reason) {
  const game = room.game;
  const hand = game.hands[playerId];
  if (!hand) return false;
  const count = hand.length;
  game.discard.push(...hand);
  game.hands[playerId] = [];
  for (let i = 0; i < count; i += 1) {
    if (game.deck.length > 0) game.hands[playerId].push(game.deck.pop());
  }
  const player = playerById(room, playerId);
  addPublicInfo(room, `${player?.name || "一名玩家"} 触发${reason}，弃掉手牌并重抽 ${count} 张。`);
  recalculateRankings(room);
  return true;
}

function communityHasFaceInFlop(room) {
  return room.game.community.slice(0, 3).some((card) => [11, 12, 13].includes(card.rank));
}

function applyFlopReplacementChallenges(room) {
  const game = room.game;
  const hasFace = communityHasFaceInFlop(room);
  if (hasChallenge(room, "replaceLowOnFace") && hasFace) {
    const owner = game.chipAssignments.white["1"];
    if (owner) replacePocketCards(room, owner, "移动探测器");
  }
  if (hasChallenge(room, "replaceHighWithoutFace") && !hasFace) {
    const max = String(activePlayers(room).length);
    const owner = game.chipAssignments.white[max];
    if (owner) replacePocketCards(room, owner, "激光绊线");
  }
}

function currentChipColor(room) {
  return currentStage(room).chipColor;
}

function currentStageKey(room) {
  return currentStage(room).key;
}

function isCurrentStageSkipped(room) {
  return hasChallenge(room, "skipOrange") && currentStage(room).key === "turn";
}

function isBlockingPending(room) {
  const type = room.game?.pending?.type;
  return ["conArtistConfirm", "coordinatorPass", "discard", "retinaGuess", "fingerprintGuess"].includes(type);
}

function allChipsAssignedForStage(room) {
  if (isCurrentStageSkipped(room)) return true;
  const color = currentChipColor(room);
  const assignments = room.game.chipAssignments[color];
  const players = activePlayerIds(room);
  const assignedPlayers = new Set(Object.values(assignments));
  return Object.keys(assignments).length === players.length && players.every((id) => assignedPlayers.has(id));
}

function chipLockedBy(room, color, chip) {
  return room.game.lockedChips[color]?.[String(chip)] || null;
}

function shouldLockChip(room, color, chip) {
  if (!["white", "yellow", "orange"].includes(color)) return false;
  const num = Number(chip);
  if (hasChallenge(room, "lockLow") && num === 1) return true;
  if (hasChallenge(room, "lockHigh") && num === activePlayers(room).length) return true;
  return false;
}

function playerChipForColor(room, playerId, color) {
  const assignments = room.game.chipAssignments[color];
  return Object.keys(assignments).find((chip) => assignments[chip] === playerId) || null;
}

function canMoveChip(room, actorId, targetPlayerId, chip) {
  if (!room.game || room.phase !== PHASES.BETTING) return { ok: false, error: "当前不能移动芯片。" };
  if (isBlockingPending(room)) return { ok: false, error: "先完成当前特殊牌效果。" };
  if (isCurrentStageSkipped(room)) return { ok: false, error: "当前阶段没有需要拿取的芯片。" };
  if (targetPlayerId !== actorId) return { ok: false, error: "规则限制：只能把排名芯片拿到自己面前。" };
  const color = currentChipColor(room);
  const current = playerChipForColor(room, targetPlayerId, color);
  if (current && current !== String(chip) && chipLockedBy(room, color, current) === targetPlayerId) {
    return { ok: false, error: "目标玩家当前持有的深色芯片不能更换主人。" };
  }
  const owner = room.game.chipAssignments[color][String(chip)];
  const lockedOwner = chipLockedBy(room, color, chip);
  if (lockedOwner && lockedOwner !== targetPlayerId) {
    return { ok: false, error: "这枚深色芯片第一次被拿走后不能再换主人。" };
  }
  if (owner === targetPlayerId) return { ok: false, error: "这枚芯片已经在目标玩家面前。" };
  if (!actorId) return { ok: false, error: "移动玩家无效。" };
  return { ok: true };
}

function recordMove(room, playerId) {
  const stageKey = currentStageKey(room);
  room.game.moveCounts[stageKey] = (room.game.moveCounts[stageKey] || 0) + 1;
  room.game.playerMoveCounts[stageKey] = room.game.playerMoveCounts[stageKey] || {};
  room.game.playerMoveCounts[stageKey][playerId] = (room.game.playerMoveCounts[stageKey][playerId] || 0) + 1;
  room.game.stageMoves[stageKey] = room.game.stageMoves[stageKey] || {};
  room.game.stageMoves[stageKey][playerId] = true;
}

function nextStageRequirement(room) {
  if (!room.game) return { ok: false, text: "未开始。" };
  if (isBlockingPending(room)) return { ok: false, text: "先完成当前特殊牌效果。" };
  if (!allChipsAssignedForStage(room)) return { ok: false, text: "每名玩家都拿到当前颜色的一枚排名芯片后，才能继续。" };
  return { ok: true, text: "可以继续。" };
}

function highestRedChipPlayerId(room) {
  const assignments = room.game.chipAssignments.red;
  const max = String(activePlayers(room).length);
  return assignments[max] || null;
}

function nextFinalGuess(room) {
  if (!room.game || room.game.stageIndex !== 3) return null;
  const topPlayerId = highestRedChipPlayerId(room);
  if (!topPlayerId) return null;
  const retina = activeChallengeCards(room).find((card) => card.effects.includes("guessTopRank"));
  if (retina && !room.game.challengeGuesses[retina.id]) {
    return { type: "retinaGuess", challengeId: retina.id, topPlayerId };
  }
  const fingerprint = activeChallengeCards(room).find((card) => card.effects.includes("guessTopCategory"));
  if (fingerprint && !room.game.challengeGuesses[fingerprint.id]) {
    return { type: "fingerprintGuess", challengeId: fingerprint.id, topPlayerId };
  }
  return null;
}

function advanceToStage(room, nextIndex) {
  room.game.stageIndex = nextIndex;
  applyStageEntryEffects(room, nextIndex);
  const stage = currentStage(room);
  pushLog(room, `进入${stage.name}阶段，请拿取${colorName(stage.chipColor)}排名芯片。`);
}

function validateFinalOrder(room) {
  const assignments = room.game.chipAssignments.red;
  const players = activePlayers(room);
  const guessed = players
    .map((_, index) => {
      const chip = String(index + 1);
      return { chip: index + 1, playerId: assignments[chip] || null };
    })
    .filter((row) => row.playerId);

  if (guessed.length !== players.length) {
    return { success: false, mistakes: [{ chip: null, reason: "红色排名芯片没有全部分配。" }] };
  }

  const byPlayer = new Map(room.game.rankings.map((row) => [row.playerId, row]));
  const mistakes = [];
  for (let i = 0; i < guessed.length; i += 1) {
    for (let j = i + 1; j < guessed.length; j += 1) {
      const left = byPlayer.get(guessed[i].playerId);
      const right = byPlayer.get(guessed[j].playerId);
      const compare = comparePlayerRows(room, left, right);
      if (compare > 0) {
        mistakes.push({
          chipA: guessed[i].chip,
          chipB: guessed[j].chip,
          playerA: guessed[i].playerId,
          playerB: guessed[j].playerId,
          reason: "强牌被放在弱牌前面。"
        });
      }
    }
  }
  return { success: mistakes.length === 0, mistakes };
}

function validateChallengeGuesses(room) {
  const failures = [];
  const topPlayerId = highestRedChipPlayerId(room);
  if (!topPlayerId) return failures;
  const topHand = room.game.hands[topPlayerId] || [];
  const topRow = room.game.rankings.find((row) => row.playerId === topPlayerId);

  for (const card of activeChallengeCards(room)) {
    if (card.effects.includes("guessTopRank")) {
      const guess = room.game.challengeGuesses[card.id];
      if (!guess || !topHand.some((handCard) => handCard.rank === Number(guess.value))) {
        failures.push({ challengeId: card.id, reason: "视网膜扫描猜错了最高红芯玩家的手牌点数。" });
      }
    }
    if (card.effects.includes("guessTopCategory")) {
      const guess = room.game.challengeGuesses[card.id];
      if (!guess || topRow?.handValue?.category !== Number(guess.value)) {
        failures.push({ challengeId: card.id, reason: "指纹扫描猜错了最高红芯玩家的最终牌型。" });
      }
    }
  }
  return failures;
}

function finishRound(room) {
  recalculateRankings(room);
  const orderResult = validateFinalOrder(room);
  const challengeFailures = validateChallengeGuesses(room);
  const success = orderResult.success && challengeFailures.length === 0;

  if (success) room.score.successes += 1;
  else room.score.failures += 1;

  if (room.game.activeSupport) returnSupportCard(room, room.game.activeSupport);

  const mode = getMode(room);
  if (mode.id === "advanced" || mode.id === "professional") {
    room.cardProgress.nextSupport = drawSupportCard(room, success ? "challenge" : "specialist");
  }

  const historyRow = {
    id: makeId("hist_"),
    round: room.score.history.length + 1,
    success,
    penalty: success ? 0 : 1,
    modeId: mode.id,
    modeName: mode.name,
    activeChallenges: room.game.activeChallenges.map((card) => card.name),
    activeSpecialist: room.game.activeSpecialist?.name || null,
    at: nowLabel()
  };
  room.score.history.unshift(historyRow);
  room.game.result = {
    success,
    orderSuccess: orderResult.success,
    mistakes: orderResult.mistakes,
    challengeFailures,
    historyRow,
    gameOver: room.score.successes >= targetSuccesses() || room.score.failures >= maxFailures(room)
  };
  room.phase = PHASES.COMPLETE;

  const upcoming = room.cardProgress?.nextSupport
    ? room.cardProgress.nextSupport.kind === "challenge"
      ? getChallenge(room.cardProgress.nextSupport.id)?.name
      : getSpecialist(room.cardProgress.nextSupport.id)?.name
    : "";
  pushLog(room, success ? `本局成功。当前 ${room.score.successes} 成功 / ${room.score.failures} 失误。` : `本局失败。当前 ${room.score.successes} 成功 / ${room.score.failures} 失误。`);
  if (upcoming) pushLog(room, `下一局将启用：${upcoming}。`);
}

function publicCard(card) {
  return {
    id: card.id,
    suit: card.suit,
    suitLabel: card.suitLabel,
    rank: card.rank,
    rankLabel: card.rankLabel,
    red: card.red,
    specialist: Boolean(card.specialist)
  };
}

function flattenAssignments(game) {
  const result = {};
  for (const color of Object.keys(game.chipAssignments)) {
    for (const [chip, playerId] of Object.entries(game.chipAssignments[color])) {
      result[`${color}:${chip}`] = { color, chip: Number(chip), playerId };
    }
  }
  return result;
}

function currentColorAssignments(game) {
  const color = STAGES[game.stageIndex].chipColor;
  return Object.fromEntries(Object.entries(game.chipAssignments[color]).map(([chip, playerId]) => [chip, playerId]));
}

function publicCardDescriptor(card) {
  const challenge = card.kind === "challenge" ? getChallenge(card.id) : null;
  const specialist = card.kind === "specialist" ? getSpecialist(card.id) : null;
  const source = challenge || specialist;
  return source ? { kind: card.kind, id: source.id, number: source.number, name: source.name, summary: source.summary } : null;
}

function playerView(room, viewerId) {
  const viewer = playerById(room, viewerId);
  const game = room.game;
  const stage = game ? STAGES[game.stageIndex] : null;
  const visibleCommunity = game ? game.community.slice(0, stage.communityCards).map(publicCard) : [];
  const players = room.players.map((player) => {
    const self = player.id === viewerId;
    const hand = game && (self || room.phase === PHASES.COMPLETE) ? game.hands[player.id].map(publicCard) : [];
    const finalRow = game ? game.rankings.find((row) => row.playerId === player.id) : null;
    return {
      id: player.id,
      name: player.name,
      host: player.id === room.hostId,
      connected: Boolean(player.ws && player.ws._wsOpen),
      left: player.left,
      self,
      hand,
      cardCount: game?.hands[player.id]?.length || 0,
      hasCards: Boolean(game && game.hands[player.id]),
      handValue: room.phase === PHASES.COMPLETE && finalRow ? finalRow.handValue : null,
      finalRank: room.phase === PHASES.COMPLETE && finalRow ? finalRow.rank : null
    };
  });

  return {
    type: "state",
    self: viewer ? { id: viewer.id, name: viewer.name, host: viewer.id === room.hostId } : null,
    room: {
      id: room.id,
      phase: room.phase,
      settings: room.settings,
      score: room.score,
      players,
      log: room.log,
      minPlayers: 3,
      maxPlayers: 6,
      targetSuccesses: targetSuccesses(),
      maxFailures: maxFailures(room),
      upcomingSupport: room.cardProgress?.nextSupport ? publicCardDescriptor(room.cardProgress.nextSupport) : null
    },
    modes: GAME_MODES,
    challenges: CHALLENGE_CARDS,
    specialists: SPECIALIST_CARDS,
    handCategories: HAND_CATEGORY_LABELS.map((label, value) => ({ value, label })),
    ranks: RANKS.map((rank) => ({ value: rank, label: RANK_LABELS[rank] })),
    game: game
      ? {
          roundId: game.roundId,
          stage,
          stageIndex: game.stageIndex,
          stages: STAGES,
          visibleCommunity,
          hiddenCommunityCount: Math.max(0, 5 - visibleCommunity.length),
          chips: chipNumbers(room),
          chipAssignments: flattenAssignments(game),
          currentColorAssignments: currentColorAssignments(game),
          currentChipColor: currentChipColor(room),
          lockedChips: game.lockedChips,
          moveCounts: game.moveCounts,
          playerMoveCounts: game.playerMoveCounts,
          stageMoves: game.stageMoves,
          activeChallenges: game.activeChallenges,
          activeSpecialist: game.activeSpecialist,
          usedSpecialists: game.usedSpecialists,
          specialistState: game.specialistState,
          challengeGuesses: game.challengeGuesses,
          publicInfo: game.publicInfo,
          privateInfo: game.privateInfoByPlayer[viewerId] || [],
          pending: sanitizePendingForViewer(room, game.pending, viewerId),
          nextRequirement: room.phase === PHASES.BETTING ? nextStageRequirement(room) : null,
          result: game.result
        }
      : null
  };
}

function sanitizePendingForViewer(room, pending, viewerId) {
  if (!pending) return null;
  if (pending.type === "discard") {
    return {
      type: pending.type,
      playerId: pending.playerId,
      reason: pending.reason,
      yourTurn: pending.playerId === viewerId,
      cannotDiscardIds: pending.playerId === viewerId ? pending.cannotDiscardIds : []
    };
  }
  if (pending.type === "coordinatorPass") {
    return {
      type: pending.type,
      chosenCount: Object.keys(pending.choices).length,
      total: activePlayers(room).length,
      yourChoice: pending.choices[viewerId] || null
    };
  }
  if (pending.type === "conArtistConfirm") {
    return {
      type: pending.type,
      confirmedCount: Object.keys(pending.confirmed).length,
      total: activePlayers(room).length,
      confirmed: Boolean(pending.confirmed[viewerId])
    };
  }
  if (pending.type === "retinaGuess" || pending.type === "fingerprintGuess") {
    return {
      type: pending.type,
      challengeId: pending.challengeId,
      topPlayerId: pending.topPlayerId,
      topPlayerName: playerById(room, pending.topPlayerId)?.name || "",
      canSubmit: pending.topPlayerId !== viewerId
    };
  }
  return pending;
}

function send(ws, payload) {
  if (ws._wsOpen) ws.send(JSON.stringify(payload));
}

function sendError(ws, message) {
  send(ws, { type: "error", message });
}

function broadcastRoom(room) {
  for (const player of room.players) {
    if (player.ws && player.ws._wsOpen) {
      send(player.ws, playerView(room, player.id));
    }
  }
}

function leaveSocket(ws) {
  if (!ws.playerId || !ws.roomId) return;
  const room = rooms.get(ws.roomId);
  if (!room) return;
  const player = playerById(room, ws.playerId);
  if (!player) return;
  if (player.ws === ws) player.ws = null;
  if (room.phase === PHASES.LOBBY) {
    player.left = true;
    pushLog(room, `${player.name} 离开了房间。`);
    const remaining = activePlayers(room);
    if (remaining.length === 0) {
      rooms.delete(room.id);
      return;
    }
    if (room.hostId === player.id) room.hostId = remaining[0].id;
  } else {
    pushLog(room, `${player.name} 断开连接，可用同名或同浏览器重连。`);
  }
  broadcastRoom(room);
}

function joinRoom(ws, data) {
  const requested = normalizeRoomId(data.roomId);
  const roomId = requested || crypto.randomBytes(3).toString("hex").toUpperCase();
  if (!ROOM_ID_RE.test(roomId)) {
    sendError(ws, "房间号只能包含 3-12 位字母或数字。");
    return;
  }
  let room = rooms.get(roomId);
  if (!room) {
    room = createRoom(roomId);
    room.cardProgress = createCardProgress(room.settings.modeId);
    rooms.set(roomId, room);
  }
  const name = sanitizeName(data.name);
  let player = room.players.find((item) => !item.left && item.name === name && !item.ws);
  if (!player && room.phase !== PHASES.LOBBY) {
    const reconnectId = String(data.playerId || "");
    player = room.players.find((item) => item.id === reconnectId && !item.left);
  }
  if (!player) {
    if (room.phase !== PHASES.LOBBY) {
      sendError(ws, "本局已经开始，只允许原玩家重连。");
      return;
    }
    if (activePlayers(room).length >= 6) {
      sendError(ws, "房间已满，最多 6 人。");
      return;
    }
    player = {
      id: makeId("p_"),
      name,
      ws,
      joinedAt: Date.now(),
      left: false
    };
    room.players.push(player);
    if (!room.hostId) room.hostId = player.id;
    pushLog(room, `${player.name} 加入了房间。`);
  } else {
    player.ws = ws;
    pushLog(room, `${player.name} 已重连。`);
  }

  ws.playerId = player.id;
  ws.roomId = room.id;
  send(ws, { type: "joined", roomId: room.id, playerId: player.id, name: player.name });
  broadcastRoom(room);
}

function requirePlayerRoom(ws) {
  if (!ws.roomId || !ws.playerId) {
    sendError(ws, "请先加入房间。");
    return null;
  }
  const room = rooms.get(ws.roomId);
  if (!room) {
    sendError(ws, "房间不存在。");
    return null;
  }
  const player = playerById(room, ws.playerId);
  if (!player || player.left) {
    sendError(ws, "玩家不在房间内。");
    return null;
  }
  return { room, player };
}

function requireHost(ws) {
  const context = requirePlayerRoom(ws);
  if (!context) return null;
  if (context.room.hostId !== context.player.id) {
    sendError(ws, "只有房主可以执行此操作。");
    return null;
  }
  return context;
}

function updateSettings(ws, data) {
  const context = requireHost(ws);
  if (!context) return;
  const { room } = context;
  if (room.phase !== PHASES.LOBBY && room.phase !== PHASES.COMPLETE) {
    sendError(ws, "本局进行中不能修改设置。");
    return;
  }
  const mode = GAME_MODES.find((item) => item.id === data.modeId);
  if (!mode) return;
  room.settings.modeId = mode.id;
  resetCampaign(room);
  pushLog(room, `房主切换为${mode.name}，战役计分已重置。`);
  broadcastRoom(room);
}

function startRound(ws) {
  const context = requireHost(ws);
  if (!context) return;
  const { room } = context;
  const players = activePlayers(room);
  if (players.length < 3 || players.length > 6) {
    sendError(ws, "需要 3-6 名玩家才能开始。");
    return;
  }
  ensureCardProgress(room);
  if (room.settings.modeId === "master" && room.cardProgress.heistCount > 0) {
    refreshMasterChallenges(room);
  }
  const supportCard = room.cardProgress.nextSupport;
  room.cardProgress.nextSupport = null;
  createGame(room, supportCard);
  room.cardProgress.heistCount += 1;
  room.phase = PHASES.BETTING;

  const activeNames = [
    ...room.game.activeChallenges.map((card) => `挑战：${card.name}`),
    room.game.activeSpecialist ? `专家：${room.game.activeSpecialist.name}` : null
  ].filter(Boolean);
  pushLog(room, `新一局开始：${getMode(room).name}${activeNames.length ? `（${activeNames.join("，")}）` : ""}。`);
  broadcastRoom(room);
}

function moveChip(ws, data) {
  const context = requirePlayerRoom(ws);
  if (!context) return;
  const { room, player } = context;
  const chip = Number(data.chip);
  if (!Number.isInteger(chip) || chip < 1 || chip > activePlayers(room).length) {
    sendError(ws, "排名芯片无效。");
    return;
  }
  const target = player;
  const canMove = canMoveChip(room, player.id, target.id, chip);
  if (!canMove.ok) {
    sendError(ws, canMove.error);
    return;
  }
  const color = currentChipColor(room);
  const assignments = room.game.chipAssignments[color];
  const current = playerChipForColor(room, target.id, color);
  if (current) delete assignments[current];
  assignments[String(chip)] = target.id;
  if (shouldLockChip(room, color, chip) && !room.game.lockedChips[color][String(chip)]) {
    room.game.lockedChips[color][String(chip)] = target.id;
  }
  recordMove(room, player.id);
  const suffix = target.id === player.id ? "自己" : target.name;
  pushLog(room, `${player.name} 将${colorName(color)} ${chip} 号排名芯片放到${suffix}面前。`);
  broadcastRoom(room);
}

function returnChip(ws) {
  const context = requirePlayerRoom(ws);
  if (!context) return;
  const { room, player } = context;
  if (!room.game || room.phase !== PHASES.BETTING) {
    sendError(ws, "当前没有可归还的芯片。");
    return;
  }
  if (isBlockingPending(room)) {
    sendError(ws, "先完成当前特殊牌效果。");
    return;
  }
  const color = currentChipColor(room);
  const current = playerChipForColor(room, player.id, color);
  if (!current) {
    sendError(ws, "你面前没有当前颜色的芯片。");
    return;
  }
  if (chipLockedBy(room, color, current) === player.id) {
    sendError(ws, "这枚深色芯片不能再换主人或归还。");
    return;
  }
  delete room.game.chipAssignments[color][current];
  recordMove(room, player.id);
  pushLog(room, `${player.name} 将${colorName(color)} ${current} 号排名芯片放回中央。`);
  broadcastRoom(room);
}

function advanceStage(ws) {
  const context = requireHost(ws);
  if (!context) return;
  const { room } = context;
  if (!room.game || room.phase !== PHASES.BETTING) {
    sendError(ws, "当前不能推进阶段。");
    return;
  }
  const requirement = nextStageRequirement(room);
  if (!requirement.ok) {
    sendError(ws, requirement.text);
    return;
  }
  if (room.game.stageIndex >= STAGES.length - 1) {
    const guess = nextFinalGuess(room);
    if (guess) {
      room.game.pending = guess;
      broadcastRoom(room);
      return;
    }
    finishRound(room);
    broadcastRoom(room);
    return;
  }

  let nextIndex = room.game.stageIndex + 1;
  if (hasChallenge(room, "skipOrange") && nextIndex === 2) nextIndex = 3;
  advanceToStage(room, nextIndex);
  broadcastRoom(room);
}

function handleConArtistConfirm(ws) {
  const context = requirePlayerRoom(ws);
  if (!context) return;
  const { room, player } = context;
  const pending = room.game?.pending;
  if (pending?.type !== "conArtistConfirm") {
    sendError(ws, "当前不需要确认洗混重发。");
    return;
  }
  pending.confirmed[player.id] = true;
  if (Object.keys(pending.confirmed).length === activePlayers(room).length) {
    const cards = [];
    const players = activePlayers(room);
    for (const item of players) cards.push(...room.game.hands[item.id]);
    const mixed = shuffle(cards);
    const count = room.game.hands[players[0].id].length;
    for (const item of players) {
      room.game.hands[item.id] = mixed.splice(0, count);
    }
    room.game.pending = null;
    room.game.usedSpecialists["con-artist"] = true;
    recalculateRankings(room);
    addPublicInfo(room, "女骗子完成：所有已发手牌已洗混并重新分发。");
  }
  broadcastRoom(room);
}

function choosePassCard(ws, data) {
  const context = requirePlayerRoom(ws);
  if (!context) return;
  const { room, player } = context;
  const pending = room.game?.pending;
  if (pending?.type !== "coordinatorPass") {
    sendError(ws, "当前不需要传牌。");
    return;
  }
  const cardId = String(data.cardId || "");
  const hand = room.game.hands[player.id] || [];
  if (!hand.some((card) => card.id === cardId)) {
    sendError(ws, "你没有这张手牌。");
    return;
  }
  pending.choices[player.id] = cardId;
  const players = activePlayers(room);
  if (Object.keys(pending.choices).length === players.length) {
    const outgoing = new Map();
    for (const item of players) {
      const selectedId = pending.choices[item.id];
      const index = room.game.hands[item.id].findIndex((card) => card.id === selectedId);
      outgoing.set(item.id, room.game.hands[item.id].splice(index, 1)[0]);
    }
    for (let i = 0; i < players.length; i += 1) {
      const from = players[i];
      const to = players[(i - 1 + players.length) % players.length];
      room.game.hands[to.id].push(outgoing.get(from.id));
    }
    room.game.pending = null;
    room.game.usedSpecialists["coordinator"] = true;
    recalculateRankings(room);
    addPublicInfo(room, "协调者完成：所有玩家已同时向左手边传出一张手牌。");
  }
  broadcastRoom(room);
}

function discardCard(ws, data) {
  const context = requirePlayerRoom(ws);
  if (!context) return;
  const { room, player } = context;
  const pending = room.game?.pending;
  if (pending?.type !== "discard" || pending.playerId !== player.id) {
    sendError(ws, "当前不需要你弃牌。");
    return;
  }
  const cardId = String(data.cardId || "");
  if (pending.cannotDiscardIds.includes(cardId)) {
    sendError(ws, "这张专家牌不能作为弃牌。");
    return;
  }
  const hand = room.game.hands[player.id] || [];
  const index = hand.findIndex((card) => card.id === cardId);
  if (index < 0) {
    sendError(ws, "你没有这张手牌。");
    return;
  }
  const [discarded] = hand.splice(index, 1);
  room.game.discard.push(discarded);
  room.game.pending = null;
  room.game.usedSpecialists[pending.specialistId] = true;
  recalculateRankings(room);
  addPublicInfo(room, `${player.name} 已完成${pending.reason}的弃牌。`);
  broadcastRoom(room);
}

function useSpecialist(ws, data) {
  const context = requirePlayerRoom(ws);
  if (!context) return;
  const { room, player } = context;
  const game = room.game;
  if (!game || room.phase !== PHASES.BETTING) {
    sendError(ws, "当前没有可用专家牌。");
    return;
  }
  const specialist = game.activeSpecialist;
  if (!specialist || specialist.id !== data.specialistId) {
    sendError(ws, "这张专家牌当前未生效。");
    return;
  }
  if (isSpecialistUsed(room, specialist.id)) {
    sendError(ws, "这张专家牌已经使用过。");
    return;
  }
  if (game.pending) {
    sendError(ws, "先完成当前特殊牌效果。");
    return;
  }

  if (specialist.id === "informant") {
    const cardId = String(data.cardId || "");
    const targetId = String(data.targetId || "");
    const target = playerById(room, targetId);
    const card = game.hands[player.id]?.find((item) => item.id === cardId);
    if (!target || target.left || target.id === player.id) {
      sendError(ws, "请选择另一名玩家。");
      return;
    }
    if (!card) {
      sendError(ws, "你没有这张手牌。");
      return;
    }
    addPrivateInfo(room, target.id, `${player.name} 向你展示了一张手牌：${card.suitLabel}${card.rankLabel}。`, card);
    addPrivateInfo(room, player.id, `你向 ${target.name} 展示了一张手牌：${card.suitLabel}${card.rankLabel}。`, card);
    game.usedSpecialists[specialist.id] = true;
    pushLog(room, `${player.name} 使用线人，秘密展示了一张手牌给 ${target.name}。`);
  } else if (specialist.id === "getaway-driver") {
    const cards = [...game.hands[player.id], ...game.community.slice(0, currentStage(room).communityCards)];
    const category = evaluateCurrentCategory(cards);
    game.usedSpecialists[specialist.id] = true;
    addPublicInfo(room, `${player.name} 公布当前牌型类别：${category.categoryLabel}。`);
  } else if (specialist.id === "mastermind") {
    const rank = Number(data.rank);
    if (!RANKS.includes(rank)) {
      sendError(ws, "请选择有效点数。");
      return;
    }
    const count = game.hands[player.id].filter((card) => card.rank === rank).length;
    game.usedSpecialists[specialist.id] = true;
    addPublicInfo(room, `${player.name} 公布自己的手牌中有 ${count} 张 ${RANK_LABELS[rank]}。`);
  } else if (specialist.id === "hacker") {
    const drawn = game.deck.pop();
    if (!drawn) {
      sendError(ws, "牌库已空。");
      return;
    }
    game.hands[player.id].push(drawn);
    game.pending = { type: "discard", playerId: player.id, specialistId: specialist.id, reason: "黑客", cannotDiscardIds: [] };
    addPrivateInfo(room, player.id, `你用黑客抽到：${drawn.suitLabel}${drawn.rankLabel}。请选择一张手牌弃掉。`, drawn);
    pushLog(room, `${player.name} 使用黑客抽取了一张额外手牌。`);
  } else if (specialist.id === "jack") {
    const jack = createSpecialJack();
    game.hands[player.id].push(jack);
    game.pending = { type: "discard", playerId: player.id, specialistId: specialist.id, reason: "杰克", cannotDiscardIds: [jack.id] };
    addPrivateInfo(room, player.id, "你获得一张无花色 J。请选择一张原本的手牌弃掉。", jack);
    pushLog(room, `${player.name} 使用杰克，获得了一张无花色 J。`);
  } else if (specialist.id === "muscle") {
    game.specialistState.muscleHolder = player.id;
    game.usedSpecialists[specialist.id] = true;
    recalculateRankings(room);
    addPublicInfo(room, `${player.name} 获得打手能力：结算时击败所有同牌型玩家。`);
  } else {
    sendError(ws, "这张专家牌已自动执行或没有手动操作。");
    return;
  }
  broadcastRoom(room);
}

function submitChallengeGuess(ws, data) {
  const context = requirePlayerRoom(ws);
  if (!context) return;
  const { room, player } = context;
  const game = room.game;
  const pending = game?.pending;
  if (!pending || (pending.type !== "retinaGuess" && pending.type !== "fingerprintGuess")) {
    sendError(ws, "当前不需要提交挑战猜测。");
    return;
  }
  if (pending.topPlayerId === player.id) {
    sendError(ws, "最高红芯玩家不能参与这次猜测。");
    return;
  }
  const challenge = getChallenge(pending.challengeId);
  if (!challenge) {
    sendError(ws, "挑战牌无效。");
    return;
  }
  const value = Number(data.value);
  if (pending.type === "retinaGuess" && !RANKS.includes(value)) {
    sendError(ws, "请选择有效点数。");
    return;
  }
  if (pending.type === "fingerprintGuess" && !HAND_CATEGORY_LABELS[value]) {
    sendError(ws, "请选择有效牌型。");
    return;
  }
  game.challengeGuesses[challenge.id] = { value, by: player.id };
  const label = pending.type === "retinaGuess" ? RANK_LABELS[value] : HAND_CATEGORY_LABELS[value];
  addPublicInfo(room, `${player.name} 代表团队提交${challenge.name}猜测：${label}。`);
  const next = nextFinalGuess(room);
  if (next) {
    game.pending = next;
  } else {
    game.pending = null;
    finishRound(room);
  }
  broadcastRoom(room);
}

function backToLobby(ws) {
  const context = requireHost(ws);
  if (!context) return;
  const { room } = context;
  room.game = null;
  room.phase = PHASES.LOBBY;
  pushLog(room, "房主返回了房间准备状态。");
  broadcastRoom(room);
}

function resetCampaignAction(ws) {
  const context = requireHost(ws);
  if (!context) return;
  resetCampaign(context.room);
  pushLog(context.room, "房主重置了战役计分。");
  broadcastRoom(context.room);
}

function handleMessage(ws, message) {
  let data;
  try {
    data = JSON.parse(message);
  } catch {
    sendError(ws, "消息格式错误。");
    return;
  }
  switch (data.type) {
    case "join":
      joinRoom(ws, data);
      break;
    case "settings":
      updateSettings(ws, data);
      break;
    case "start":
      startRound(ws);
      break;
    case "moveChip":
    case "takeChip":
      moveChip(ws, data);
      break;
    case "returnChip":
      returnChip(ws);
      break;
    case "advance":
      advanceStage(ws);
      break;
    case "confirmConArtist":
      handleConArtistConfirm(ws);
      break;
    case "choosePassCard":
      choosePassCard(ws, data);
      break;
    case "discardCard":
      discardCard(ws, data);
      break;
    case "useSpecialist":
      useSpecialist(ws, data);
      break;
    case "challengeGuess":
      submitChallengeGuess(ws, data);
      break;
    case "resetCampaign":
      resetCampaignAction(ws);
      break;
    case "backToLobby":
      backToLobby(ws);
      break;
    case "ping":
      send(ws, { type: "pong", at: Date.now() });
      break;
    default:
      sendError(ws, "未知操作。");
  }
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".ico": "image/x-icon"
  }[ext] || "application/octet-stream";
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not Found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": contentType(filePath),
      "Cache-Control": "no-store"
    });
    res.end(data);
  });
});

server.on("upgrade", (req, socket) => {
  if (req.headers.upgrade?.toLowerCase() !== "websocket") {
    socket.destroy();
    return;
  }
  const key = req.headers["sec-websocket-key"];
  if (!key) {
    socket.destroy();
    return;
  }
  const accept = crypto
    .createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");
  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "",
      ""
    ].join("\r\n")
  );
  wrapSocket(socket);
});

function wrapSocket(socket) {
  const ws = socket;
  ws._wsOpen = true;
  ws._buffer = Buffer.alloc(0);
  ws.send = (text) => {
    if (!ws._wsOpen) return;
    const payload = Buffer.from(text);
    let header;
    if (payload.length < 126) {
      header = Buffer.from([0x81, payload.length]);
    } else if (payload.length < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x81;
      header[1] = 126;
      header.writeUInt16BE(payload.length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x81;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(payload.length), 2);
    }
    ws.write(Buffer.concat([header, payload]));
  };

  sockets.add(ws);
  ws.on("data", (chunk) => {
    ws._buffer = Buffer.concat([ws._buffer, chunk]);
    parseFrames(ws);
  });
  ws.on("close", () => {
    ws._wsOpen = false;
    sockets.delete(ws);
    leaveSocket(ws);
  });
  ws.on("error", () => {
    ws._wsOpen = false;
    sockets.delete(ws);
    leaveSocket(ws);
  });
}

function parseFrames(ws) {
  let offset = 0;
  while (ws._buffer.length - offset >= 2) {
    const first = ws._buffer[offset];
    const second = ws._buffer[offset + 1];
    const opcode = first & 0x0f;
    const masked = Boolean(second & 0x80);
    let length = second & 0x7f;
    let headerLength = 2;
    if (length === 126) {
      if (ws._buffer.length - offset < 4) break;
      length = ws._buffer.readUInt16BE(offset + 2);
      headerLength = 4;
    } else if (length === 127) {
      if (ws._buffer.length - offset < 10) break;
      const bigLength = ws._buffer.readBigUInt64BE(offset + 2);
      if (bigLength > BigInt(1024 * 1024)) {
        ws.destroy();
        return;
      }
      length = Number(bigLength);
      headerLength = 10;
    }
    const maskLength = masked ? 4 : 0;
    const frameLength = headerLength + maskLength + length;
    if (ws._buffer.length - offset < frameLength) break;
    let payload = ws._buffer.slice(offset + headerLength + maskLength, offset + frameLength);
    if (masked) {
      const mask = ws._buffer.slice(offset + headerLength, offset + headerLength + 4);
      const unmasked = Buffer.alloc(payload.length);
      for (let i = 0; i < payload.length; i += 1) unmasked[i] = payload[i] ^ mask[i % 4];
      payload = unmasked;
    }
    offset += frameLength;

    if (opcode === 0x8) {
      ws.end();
      return;
    }
    if (opcode === 0x9) {
      ws.write(Buffer.from([0x8a, 0x00]));
      continue;
    }
    if (opcode === 0x1) {
      handleMessage(ws, payload.toString("utf8"));
    }
  }
  ws._buffer = ws._buffer.slice(offset);
}

server.listen(PORT, "0.0.0.0", () => {
  console.log(`The Gang Online running at http://127.0.0.1:${PORT}/`);
});

process.on("SIGINT", () => {
  for (const ws of sockets) {
    try {
      ws.end();
    } catch {
      // Ignore shutdown errors.
    }
  }
  server.close(() => process.exit(0));
});
