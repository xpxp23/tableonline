"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");
const MAX_PLAYERS = 6;
const MIN_PLAYERS = 2;

const rooms = new Map();
const streams = new Map();

const CARD_DEFS = {
  investigators: {
    key: "investigators",
    name: "调查员",
    value: 1,
    insanity: false,
    count: 5,
    saneEffect: "guess",
    short: "猜另一名玩家手牌的点数；不能猜 1。猜中则目标出局。",
    saneText: "指定另一名玩家，猜一个非 1 的点数。若目标手牌点数相同，目标出局。"
  },
  deepOnes: {
    key: "deepOnes",
    name: "深潜者",
    value: 1,
    insanity: true,
    count: 1,
    saneEffect: "guess",
    insaneEffect: "deepGuess",
    short: "清醒同调查员。疯狂时先检查目标是否持有 1，若不是，再猜一个非 1 点数。",
    saneText: "同调查员：指定另一名玩家，猜一个非 1 的点数。猜中则目标出局。",
    insaneText: "指定另一名玩家。若目标手牌是 1，目标出局；否则再猜一个非 1 的点数，猜中也会令目标出局。"
  },
  cats: {
    key: "cats",
    name: "乌撒的猫",
    value: 2,
    insanity: false,
    count: 2,
    saneEffect: "peek",
    short: "查看另一名玩家的手牌。",
    saneText: "指定另一名玩家，私下查看其手牌。"
  },
  goldenMead: {
    key: "goldenMead",
    name: "黄金蜜酒",
    value: 2,
    insanity: true,
    count: 1,
    saneEffect: "peek",
    insaneEffect: "peekDrawDiscard",
    short: "清醒同乌撒的猫。疯狂时查看目标手牌，然后抽 1 张并弃 1 张。",
    saneText: "同乌撒的猫：指定另一名玩家，私下查看其手牌。",
    insaneText: "指定另一名玩家并查看其手牌。随后抽 1 张牌，再从手牌中弃掉 1 张并结算。"
  },
  greatRace: {
    key: "greatRace",
    name: "伊斯之伟大种族",
    value: 3,
    insanity: false,
    count: 2,
    saneEffect: "duel",
    short: "与另一名玩家比较手牌点数，较低者出局。",
    saneText: "指定另一名玩家，双方私下比较手牌点数。点数较低者出局；相同则无事发生。"
  },
  hound: {
    key: "hound",
    name: "廷达罗斯猎犬",
    value: 3,
    insanity: true,
    count: 1,
    saneEffect: "duel",
    insaneEffect: "huntSane",
    short: "清醒同伊斯之伟大种族。疯狂时若目标仍清醒，目标出局。",
    saneText: "同伊斯之伟大种族：与另一名玩家比较手牌点数，较低者出局。",
    insaneText: "指定另一名玩家。若目标的弃牌堆中没有疯狂牌，目标出局。"
  },
  elderSign: {
    key: "elderSign",
    name: "旧印",
    value: 4,
    insanity: false,
    count: 2,
    saneEffect: "shield",
    short: "直到你下个回合开始前，其他玩家的卡牌效果不能指定你。",
    saneText: "你获得临时保护。直到你下个回合开始前，其他玩家的卡牌效果不能指定你。"
  },
  liberIvonis: {
    key: "liberIvonis",
    name: "伊波恩之书",
    value: 4,
    insanity: true,
    count: 1,
    saneEffect: "shield",
    insaneEffect: "ward",
    short: "清醒同旧印。疯狂时直到本轮结束，你不会因效果或理智检定出局。",
    saneText: "同旧印：直到你下个回合开始前，其他玩家的卡牌效果不能指定你。",
    insaneText: "直到本轮结束，你不会因卡牌效果或理智检定出局。"
  },
  professor: {
    key: "professor",
    name: "亨利·阿米蒂奇教授",
    value: 5,
    insanity: false,
    count: 2,
    saneEffect: "redraw",
    short: "指定任意仍在本轮中的玩家弃掉手牌并补抽 1 张；死灵之书/克苏鲁仍会触发危险。",
    saneText: "指定任意仍在本轮中的玩家。目标弃掉手牌，通常不结算该牌效果，然后补抽 1 张；若弃掉死灵之书或克苏鲁，则处理危险牌并停止后续补抽。"
  },
  miGo: {
    key: "miGo",
    name: "米·戈",
    value: 5,
    insanity: true,
    count: 1,
    saneEffect: "redraw",
    insaneEffect: "stealBrain",
    short: "清醒同教授。疯狂时拿走目标手牌，目标获得米·戈脑缸，然后你弃 1 张。",
    saneText: "同教授：指定任意仍在本轮中的玩家。目标弃掉手牌并补抽 1 张；死灵之书/克苏鲁仍会触发危险并停止补抽。",
    insaneText: "指定另一名玩家。将目标手牌加入你的手牌，目标获得米·戈脑缸；然后你弃掉 1 张并结算。"
  },
  randolph: {
    key: "randolph",
    name: "伦道夫·卡特",
    value: 6,
    insanity: false,
    count: 1,
    saneEffect: "trade",
    short: "与另一名玩家交换手牌。",
    saneText: "指定另一名玩家，与其交换手牌。"
  },
  nyarlathotep: {
    key: "nyarlathotep",
    name: "奈亚拉托提普",
    value: 6,
    insanity: true,
    count: 1,
    saneEffect: "trade",
    insaneEffect: "redistribute",
    short: "清醒同伦道夫·卡特。疯狂时查看其他人的手牌并重新分配。",
    saneText: "同伦道夫·卡特：指定另一名玩家，与其交换手牌。",
    insaneText: "收集所有其他未受临时保护且仍在本轮中的玩家手牌，查看后给每人重新分配 1 张。"
  },
  silverKey: {
    key: "silverKey",
    name: "银钥匙",
    value: 7,
    insanity: false,
    count: 1,
    saneEffect: "none",
    short: "若你同时持有它和点数大于 4 的另一张牌，必须弃掉银钥匙。",
    saneText: "弃掉时没有即时效果。若你手中同时有银钥匙和另一张点数大于 4 的牌，必须弃掉银钥匙。"
  },
  trapezohedron: {
    key: "trapezohedron",
    name: "闪耀偏方三八面体",
    value: 7,
    insanity: true,
    count: 1,
    saneEffect: "silverLike",
    insaneEffect: "trapWin",
    short: "清醒时类似银钥匙。疯狂时若与另一张点数大于 4 的牌同时在手，你赢得本轮。",
    saneText: "清醒时类似银钥匙：若你同时持有它和另一张点数大于 4 的牌，必须弃掉它。",
    insaneText: "疯狂时若你同时持有它和另一张点数大于 4 的牌，立即赢得本轮。"
  },
  necronomicon: {
    key: "necronomicon",
    name: "死灵之书",
    value: 8,
    insanity: false,
    count: 1,
    saneEffect: "necronomicon",
    short: "只要弃掉它，你就会出局。",
    saneText: "无论因何弃掉死灵之书，你都会出局，除非有伊波恩之书的疯狂保护。"
  },
  cthulhu: {
    key: "cthulhu",
    name: "克苏鲁",
    value: 8,
    insanity: true,
    count: 1,
    saneEffect: "necronomicon",
    insaneEffect: "cthulhu",
    short: "清醒同死灵之书。疯狂时若弃牌堆已有至少 2 张疯狂牌，直接赢得整局；否则出局。",
    saneText: "同死灵之书：弃掉后你会出局，除非受到疯狂保护。",
    insaneText: "若你的弃牌堆中已经有至少 2 张疯狂牌，你立即赢得整局；否则你会出局。"
  },
  braincase: {
    key: "braincase",
    name: "米·戈脑缸",
    value: 0,
    insanity: true,
    count: 1,
    saneEffect: "braincase",
    insaneEffect: "braincase",
    short: "若你在自己的回合弃掉它，你会出局。",
    saneText: "若你在自己的回合弃掉米·戈脑缸，你会出局，除非受到疯狂保护。",
    insaneText: "若你在自己的回合弃掉米·戈脑缸，你会出局，除非受到疯狂保护。"
  }
};

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};

function publicCard(card) {
  if (!card) return null;
  const def = CARD_DEFS[card.key];
  return {
    uid: card.uid,
    key: card.key,
    name: def.name,
    value: def.value,
    insanity: def.insanity,
    saneEffect: def.saneEffect,
    insaneEffect: def.insaneEffect || null,
    short: def.short,
    saneText: def.saneText,
    insaneText: def.insaneText || null
  };
}

function makeId(size = 8) {
  return crypto.randomBytes(size).toString("base64url");
}

function makeRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 5; i += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return rooms.has(code) ? makeRoomCode() : code;
}

function makeCard(key, uid) {
  return { uid, key };
}

function shuffle(cards) {
  for (let i = cards.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

function buildRoundDeck(roundNumber) {
  const deck = [];
  let seq = 1;
  for (const def of Object.values(CARD_DEFS)) {
    if (def.key === "braincase") continue;
    for (let i = 0; i < def.count; i += 1) {
      deck.push(makeCard(def.key, `r${roundNumber}c${seq}`));
      seq += 1;
    }
  }
  return shuffle(deck);
}

function createRoom(hostName) {
  const roomId = makeRoomCode();
  const room = {
    id: roomId,
    phase: "lobby",
    hostId: null,
    players: [],
    roundNumber: 0,
    deck: [],
    setAside: null,
    removedFaceUp: [],
    braincase: null,
    currentPlayerId: null,
    starterId: null,
    pending: null,
    pendingStack: [],
    publicLog: [],
    privateLog: new Map(),
    lastRoundWinnerId: null,
    gameWinnerId: null,
    cthulhuWin: false,
    createdAt: Date.now()
  };
  rooms.set(roomId, room);
  const host = addPlayer(room, hostName);
  room.hostId = host.id;
  logPublic(room, `房间 ${roomId} 已创建。`);
  return { room, player: host };
}

function addPlayer(room, name) {
  if (room.phase !== "lobby") {
    throw new Error("牌局已开始，不能加入该房间。");
  }
  if (room.players.length >= MAX_PLAYERS) {
    throw new Error("房间已满。");
  }
  const cleanName = String(name || "玩家").trim().slice(0, 16) || "玩家";
  const player = {
    id: makeId(6),
    token: makeId(18),
    name: cleanName,
    joinedAt: Date.now(),
    online: false,
    hand: [],
    discard: [],
    active: false,
    eliminated: false,
    shield: false,
    ward: false,
    saneWins: 0,
    insaneWins: 0
  };
  room.players.push(player);
  room.privateLog.set(player.id, []);
  logPublic(room, `${player.name} 加入了房间。`);
  return player;
}

function findRoom(roomId) {
  const room = rooms.get(String(roomId || "").toUpperCase());
  if (!room) throw new Error("找不到房间。");
  return room;
}

function authPlayer(room, playerId, token) {
  const player = room.players.find((p) => p.id === playerId);
  if (!player || player.token !== token) throw new Error("玩家身份无效，请重新加入房间。");
  return player;
}

function activePlayers(room) {
  return room.players.filter((p) => p.active && !p.eliminated);
}

function getPlayer(room, playerId) {
  return room.players.find((p) => p.id === playerId) || null;
}

function cardValue(card) {
  return CARD_DEFS[card.key].value;
}

function isInsanityCard(card) {
  return Boolean(CARD_DEFS[card.key].insanity);
}

function insanityCount(player) {
  return player.discard.filter(isInsanityCard).length;
}

function isInsane(player) {
  return insanityCount(player) > 0;
}

function logPublic(room, message) {
  room.publicLog.push({ at: Date.now(), message });
  if (room.publicLog.length > 120) room.publicLog.splice(0, room.publicLog.length - 120);
}

function logPrivate(room, playerId, message) {
  const list = room.privateLog.get(playerId) || [];
  list.push({ at: Date.now(), message });
  if (list.length > 80) list.splice(0, list.length - 80);
  room.privateLog.set(playerId, list);
}

function startGame(room, starterId = null) {
  if (room.players.length < MIN_PLAYERS) {
    throw new Error("至少需要 2 名玩家。");
  }
  if (room.players.length > MAX_PLAYERS) {
    throw new Error("最多支持 6 名玩家。");
  }
  room.players.forEach((p) => {
    p.saneWins = 0;
    p.insaneWins = 0;
  });
  room.gameWinnerId = null;
  room.cthulhuWin = false;
  startRound(room, starterId || room.players[0].id);
}

function startRound(room, starterId) {
  room.phase = "round";
  room.roundNumber += 1;
  room.deck = buildRoundDeck(room.roundNumber);
  room.setAside = room.deck.shift();
  room.removedFaceUp = [];
  room.braincase = makeCard("braincase", `r${room.roundNumber}braincase`);
  room.pending = null;
  room.pendingStack = [];
  room.gameWinnerId = null;
  room.cthulhuWin = false;

  if (room.players.length === 2) {
    room.removedFaceUp = room.deck.splice(0, 5);
  }

  for (const player of room.players) {
    player.hand = [];
    player.discard = [];
    player.active = true;
    player.eliminated = false;
    player.shield = false;
    player.ward = false;
  }

  for (const player of room.players) {
    drawTo(room, player, "初始手牌");
  }

  room.currentPlayerId = getPlayer(room, starterId)?.id || room.players[0].id;
  room.starterId = room.currentPlayerId;
  room.lastRoundWinnerId = null;
  logPublic(room, `第 ${room.roundNumber} 轮开始，${getPlayer(room, room.currentPlayerId).name} 先手。`);
  beginTurn(room);
}

function drawTo(room, player, reason, allowSetAside = false) {
  let card = null;
  if (room.deck.length > 0) {
    card = room.deck.shift();
  } else if (allowSetAside && room.setAside) {
    card = room.setAside;
    room.setAside = null;
  }
  if (!card) return null;
  player.hand.push(card);
  logPrivate(room, player.id, `${reason}：你获得了 ${CARD_DEFS[card.key].name}（${CARD_DEFS[card.key].value}）。`);
  return card;
}

function beginTurn(room) {
  if (room.phase !== "round") return;
  const player = getPlayer(room, room.currentPlayerId);
  if (!player || !player.active || player.eliminated) {
    room.currentPlayerId = nextActivePlayerId(room, room.currentPlayerId);
    if (room.currentPlayerId) beginTurn(room);
    return;
  }

  if (player.shield) {
    player.shield = false;
    logPublic(room, `${player.name} 的临时保护结束。`);
  }

  logPublic(room, `轮到 ${player.name}。`);

  if (isInsane(player)) {
    const result = runSanityCheck(room, player);
    if (room.phase !== "round") return;
    if (result.eliminated) {
      continueAfterTurnOwnerLost(room, player.id);
      return;
    }
    if (room.deck.length === 0) {
      endRoundByDeck(room, "理智检定耗尽了牌库。");
      return;
    }
  }

  if (room.deck.length === 0) {
    endRoundByDeck(room, "牌库已空，无法抽牌。");
    return;
  }

  drawTo(room, player, "回合抽牌");
  if (applyHandTriggers(room, player, "抽牌后")) return;

  room.pending = {
    type: "turnPlay",
    playerId: player.id,
    choices: player.hand.map((card) => card.uid),
    prompt: "选择 1 张手牌弃掉并结算效果。"
  };
}

function runSanityCheck(room, player) {
  const count = insanityCount(player);
  logPublic(room, `${player.name} 进行理智检定（${count} 张）。`);
  const revealed = [];
  for (let i = 0; i < count; i += 1) {
    if (room.deck.length === 0) break;
    const card = room.deck.shift();
    revealed.push(card);
    player.discard.push(card);
    logPublic(room, `${player.name} 的理智检定翻出 ${CARD_DEFS[card.key].name}（${CARD_DEFS[card.key].value}）。`);

    const insanityHit = isInsanityCard(card);
    const bookHit = card.key === "necronomicon" || card.key === "cthulhu";
    if (insanityHit || bookHit) {
      const reason = insanityHit ? "理智检定翻出疯狂牌" : "理智检定弃掉死灵之书";
      if (player.ward) {
        logPublic(room, `${player.name} 受到伊波恩之书保护，没有出局。`);
        continue;
      }
      knockOutPlayer(room, player, reason);
      return { eliminated: true, revealed };
    }
  }
  if (revealed.length > 0) {
    logPublic(room, `${player.name} 通过了本次理智检定。`);
  }
  return { eliminated: false, revealed };
}

function nextActivePlayerId(room, fromId) {
  const live = activePlayers(room);
  if (live.length === 0) return null;
  const startIndex = Math.max(0, room.players.findIndex((p) => p.id === fromId));
  for (let offset = 1; offset <= room.players.length; offset += 1) {
    const candidate = room.players[(startIndex + offset) % room.players.length];
    if (candidate.active && !candidate.eliminated) return candidate.id;
  }
  return live[0].id;
}

function continueAfterTurnOwnerLost(room, oldPlayerId) {
  if (room.phase !== "round") return;
  const live = activePlayers(room);
  if (live.length <= 1) {
    completeRound(room, live[0]?.id || null, "只剩一名玩家仍在本轮中。");
    return;
  }
  if (room.deck.length === 0) {
    endRoundByDeck(room, "牌库已空。");
    return;
  }
  room.currentPlayerId = nextActivePlayerId(room, oldPlayerId);
  beginTurn(room);
}

function finishTurn(room, oldPlayerId = room.currentPlayerId) {
  if (room.phase !== "round") return;
  room.pending = null;
  flushPendingStack(room);
  if (room.phase !== "round") return;

  const live = activePlayers(room);
  if (live.length <= 1) {
    completeRound(room, live[0]?.id || null, "只剩一名玩家仍在本轮中。");
    return;
  }
  if (room.deck.length === 0) {
    endRoundByDeck(room, "回合结束时牌库已空。");
    return;
  }
  room.currentPlayerId = nextActivePlayerId(room, oldPlayerId);
  beginTurn(room);
}

function flushPendingStack(room) {
  while (room.pendingStack.length > 0) {
    const item = room.pendingStack.pop();
    const owner = getPlayer(room, item.playerId);
    if (owner) owner.discard.push(item.card);
  }
}

function applyHandTriggers(room, player, reason) {
  if (room.phase !== "round") return true;
  if (!player.active || player.eliminated || player.hand.length < 2) return false;

  const highOtherFor = (uid) => player.hand.some((card) => card.uid !== uid && cardValue(card) > 4);
  const shining = player.hand.find((card) => card.key === "trapezohedron" && highOtherFor(card.uid));
  const silver = player.hand.find((card) => card.key === "silverKey" && highOtherFor(card.uid));

  if (shining && isInsane(player)) {
    logPublic(room, `${player.name} 因闪耀偏方三八面体的疯狂效果赢得本轮。`);
    completeRound(room, player.id, "闪耀偏方三八面体");
    return true;
  }

  if (silver) {
    room.pending = {
      type: "discardChoice",
      playerId: player.id,
      choices: [silver.uid],
      forced: true,
      prompt: "你同时持有银钥匙和点数大于 4 的牌，必须弃掉银钥匙。"
    };
    logPublic(room, `${player.name} 必须弃掉银钥匙。`);
    return true;
  }

  if (shining && !isInsane(player)) {
    room.pending = {
      type: "discardChoice",
      playerId: player.id,
      choices: [shining.uid],
      forced: true,
      prompt: "你清醒时同时持有闪耀偏方三八面体和点数大于 4 的牌，必须弃掉它。"
    };
    logPublic(room, `${player.name} 必须弃掉闪耀偏方三八面体。`);
    return true;
  }

  return false;
}

function legalTargets(room, actor, effectKey) {
  const live = activePlayers(room);
  if (effectKey === "redraw") {
    return live.filter((p) => p.id === actor.id || !p.shield).map((p) => p.id);
  }
  if (effectKey === "redistribute") {
    return live.filter((p) => p.id !== actor.id && !p.shield).map((p) => p.id);
  }
  if (["guess", "deepGuess", "peek", "duel", "huntSane", "stealBrain", "trade"].includes(effectKey)) {
    return live.filter((p) => p.id !== actor.id && !p.shield).map((p) => p.id);
  }
  return [];
}

function requireTarget(room, actor, effectKey, targetId) {
  const legal = legalTargets(room, actor, effectKey);
  if (legal.length === 0) return null;
  if (!targetId || !legal.includes(targetId)) {
    throw new Error("请选择一个可被指定的目标。");
  }
  return getPlayer(room, targetId);
}

function resolvedDiscardMode(actor, card, requestedMode) {
  const def = CARD_DEFS[card.key];
  let mode = "sane";
  if (requestedMode === "insane" && def.insanity && isInsane(actor) && def.insaneEffect) {
    mode = "insane";
  }
  return {
    def,
    mode,
    effectKey: mode === "insane" ? def.insaneEffect : def.saneEffect
  };
}

function targetRequiredEffect(effectKey) {
  return ["guess", "deepGuess", "peek", "peekDrawDiscard", "duel", "huntSane", "redraw", "stealBrain", "trade"].includes(effectKey);
}

function validateDiscardParams(room, actor, effectKey, params = {}) {
  if (targetRequiredEffect(effectKey)) {
    const targetEffectKey = effectKey === "peekDrawDiscard" ? "peek" : effectKey;
    const legal = legalTargets(room, actor, targetEffectKey);
    if (legal.length > 0 && (!params.targetId || !legal.includes(params.targetId))) {
      throw new Error("请选择一个可被指定的目标。");
    }
  }

  if ((effectKey === "guess" || effectKey === "deepGuess") && legalTargets(room, actor, effectKey).length > 0) {
    const guess = Number(params.guess);
    if (!Number.isInteger(guess) || guess < 0 || guess > 8 || guess === 1) {
      throw new Error("猜测点数必须是 0、2、3、4、5、6、7、8 之一。");
    }
  }
}

function resolveSubmittedDiscard(room, actor, cardUid, mode, params = {}) {
  if (room.phase !== "round") throw new Error("当前没有正在进行的回合。");
  const pending = room.pending;
  if (!pending || pending.playerId !== actor.id) throw new Error("现在不是你的操作时机。");
  if (!["turnPlay", "discardChoice"].includes(pending.type)) throw new Error("当前操作类型不匹配。");
  if (pending.choices && !pending.choices.includes(cardUid)) throw new Error("这张牌当前不能弃掉。");

  const card = actor.hand.find((item) => item.uid === cardUid);
  if (!card) throw new Error("找不到这张手牌。");
  const { effectKey } = resolvedDiscardMode(actor, card, mode);
  validateDiscardParams(room, actor, effectKey, params);

  const oldPlayerId = room.currentPlayerId;
  room.pending = null;
  discardAndResolve(room, actor, cardUid, mode, params, { duringTurn: true });
  if (room.phase !== "round") return;
  if (!room.pending) finishTurn(room, oldPlayerId);
}

function discardAndResolve(room, actor, cardUid, requestedMode, params = {}, options = {}) {
  const index = actor.hand.findIndex((card) => card.uid === cardUid);
  if (index === -1) throw new Error("找不到这张手牌。");
  const [card] = actor.hand.splice(index, 1);
  const { def, mode, effectKey } = resolvedDiscardMode(actor, card, requestedMode);
  room.pendingStack.push({ playerId: actor.id, card });
  logPublic(room, `${actor.name} 弃掉 ${def.name}（${mode === "insane" ? "疯狂" : "清醒"}）。`);
  resolveEffect(room, actor, card, effectKey, mode, params, options);
}

function resolveEffect(room, actor, card, effectKey, mode, params, options) {
  if (room.phase !== "round") return;
  switch (effectKey) {
    case "guess":
      effectGuess(room, actor, params.targetId, params.guess, false);
      break;
    case "deepGuess":
      effectGuess(room, actor, params.targetId, params.guess, true);
      break;
    case "peek":
      effectPeek(room, actor, params.targetId);
      break;
    case "peekDrawDiscard":
      effectPeekDrawDiscard(room, actor, params.targetId);
      break;
    case "duel":
      effectDuel(room, actor, params.targetId);
      break;
    case "huntSane":
      effectHuntSane(room, actor, params.targetId);
      break;
    case "shield":
      actor.shield = true;
      logPublic(room, `${actor.name} 获得临时保护。`);
      break;
    case "ward":
      actor.ward = true;
      logPublic(room, `${actor.name} 获得本轮疯狂保护。`);
      break;
    case "redraw":
      effectRedraw(room, actor, params.targetId);
      break;
    case "stealBrain":
      effectStealBrain(room, actor, params.targetId);
      break;
    case "trade":
      effectTrade(room, actor, params.targetId);
      break;
    case "redistribute":
      effectRedistributeStart(room, actor);
      break;
    case "necronomicon":
      loseByOwnDiscard(room, actor, "弃掉死灵之书");
      break;
    case "cthulhu":
      effectCthulhu(room, actor);
      break;
    case "braincase":
      loseByOwnDiscard(room, actor, "弃掉米·戈脑缸");
      break;
    case "none":
    case "silverLike":
    case "trapWin":
    default:
      break;
  }
}

function effectGuess(room, actor, targetId, guessRaw, deepMode) {
  const target = requireTarget(room, actor, deepMode ? "deepGuess" : "guess", targetId);
  if (!target) {
    logPublic(room, "没有可指定的目标，效果无事发生。");
    return;
  }
  const targetCard = target.hand[0];
  if (!targetCard) return;
  const targetValue = cardValue(targetCard);

  if (deepMode && targetValue === 1) {
    logPublic(room, `${actor.name} 发现 ${target.name} 持有 1 点牌。`);
    knockOutPlayer(room, target, "被深潜者识破");
    return;
  }

  const guess = Number(guessRaw);
  if (!Number.isInteger(guess) || guess < 0 || guess > 8 || guess === 1) {
    throw new Error("猜测点数必须是 0、2、3、4、5、6、7、8 之一。");
  }
  logPublic(room, `${actor.name} 猜 ${target.name} 的手牌是 ${guess}。`);
  if (targetValue === guess) {
    knockOutPlayer(room, target, "手牌被猜中");
  } else {
    logPublic(room, `${actor.name} 没有猜中。`);
  }
}

function effectPeek(room, actor, targetId) {
  const target = requireTarget(room, actor, "peek", targetId);
  if (!target) {
    logPublic(room, "没有可指定的目标，效果无事发生。");
    return false;
  }
  const card = target.hand[0];
  if (!card) return false;
  logPublic(room, `${actor.name} 查看了 ${target.name} 的手牌。`);
  logPrivate(room, actor.id, `${target.name} 的手牌是 ${CARD_DEFS[card.key].name}（${cardValue(card)}）。`);
  return true;
}

function effectPeekDrawDiscard(room, actor, targetId) {
  if (!effectPeek(room, actor, targetId)) return;
  if (room.phase !== "round") return;
  const drawn = drawTo(room, actor, "黄金蜜酒抽牌");
  if (!drawn) {
    logPublic(room, "牌库已空，黄金蜜酒没有抽到牌。");
    return;
  }
  if (applyHandTriggers(room, actor, "黄金蜜酒抽牌后")) return;
  room.pending = {
    type: "discardChoice",
    playerId: actor.id,
    choices: actor.hand.map((c) => c.uid),
    forced: false,
    prompt: "黄金蜜酒：从你的手牌中选择 1 张弃掉并结算。"
  };
}

function effectDuel(room, actor, targetId) {
  const target = requireTarget(room, actor, "duel", targetId);
  if (!target) {
    logPublic(room, "没有可指定的目标，效果无事发生。");
    return;
  }
  const actorCard = actor.hand[0];
  const targetCard = target.hand[0];
  if (!actorCard || !targetCard) return;
  const actorValue = cardValue(actorCard);
  const targetValue = cardValue(targetCard);
  logPrivate(room, actor.id, `比较结果：你剩余手牌 ${CARD_DEFS[actorCard.key].name}（${actorValue}），${target.name} 是 ${CARD_DEFS[targetCard.key].name}（${targetValue}）。`);
  logPrivate(room, target.id, `比较结果：你手牌 ${CARD_DEFS[targetCard.key].name}（${targetValue}），${actor.name} 是 ${CARD_DEFS[actorCard.key].name}（${actorValue}）。`);
  if (actorValue === targetValue) {
    logPublic(room, `${actor.name} 与 ${target.name} 比较点数，相同，无事发生。`);
  } else if (actorValue < targetValue) {
    logPublic(room, `${actor.name} 与 ${target.name} 比较点数，${actor.name} 较低。`);
    knockOutPlayer(room, actor, "比较点数较低");
  } else {
    logPublic(room, `${actor.name} 与 ${target.name} 比较点数，${target.name} 较低。`);
    knockOutPlayer(room, target, "比较点数较低");
  }
}

function effectHuntSane(room, actor, targetId) {
  const target = requireTarget(room, actor, "huntSane", targetId);
  if (!target) {
    logPublic(room, "没有可指定的目标，效果无事发生。");
    return;
  }
  if (!isInsane(target)) {
    logPublic(room, `${target.name} 仍然清醒。`);
    knockOutPlayer(room, target, "被廷达罗斯猎犬追上");
  } else {
    logPublic(room, `${target.name} 已陷入疯狂，廷达罗斯猎犬没有造成出局。`);
  }
}

function effectRedraw(room, actor, targetId) {
  const target = requireTarget(room, actor, "redraw", targetId);
  if (!target) {
    logPublic(room, "没有可指定的目标，效果无事发生。");
    return;
  }
  const discarded = target.hand.pop();
  if (!discarded) {
    logPublic(room, `${target.name} 没有手牌可弃。`);
    const drawn = drawTo(room, target, "补抽手牌", true);
    if (!drawn) logPublic(room, `${target.name} 没有可补抽的牌。`);
    return;
  }
  const priorInsanity = insanityCount(target);
  target.discard.push(discarded);
  logPublic(room, `${target.name} 弃掉了 ${CARD_DEFS[discarded.key].name}。`);

  if (discarded.key === "cthulhu" && target.id === room.currentPlayerId && priorInsanity >= 2) {
    flushPendingStack(room);
    room.phase = "gameOver";
    room.gameWinnerId = target.id;
    room.cthulhuWin = true;
    room.pending = null;
    logPublic(room, `${target.name} 因弃掉克苏鲁并满足疯狂条件，直接赢得整局。`);
    return;
  }

  if (discarded.key === "necronomicon" || discarded.key === "cthulhu") {
    if (target.ward) {
      logPublic(room, `${target.name} 受到伊波恩之书保护，没有因弃掉危险典籍出局。`);
    } else {
      knockOutPlayer(room, target, discarded.key === "cthulhu" ? "弃掉克苏鲁" : "弃掉死灵之书");
    }
    logPublic(room, "危险典籍中断了补抽效果。");
    return;
  }

  if (target.active && !target.eliminated) {
    const drawn = drawTo(room, target, "补抽手牌", true);
    if (!drawn) logPublic(room, `${target.name} 没有可补抽的牌。`);
  }
}

function effectStealBrain(room, actor, targetId) {
  const target = requireTarget(room, actor, "stealBrain", targetId);
  if (!target) {
    logPublic(room, "没有可指定的目标，效果无事发生。");
    return;
  }
  const stolen = target.hand.pop();
  if (!stolen) return;

  if (stolen.key === "braincase") {
    target.hand.push(stolen);
    logPublic(room, `${actor.name} 尝试夺取 ${target.name} 的米·戈脑缸，但脑缸仍留在目标手中。`);
  } else {
    actor.hand.push(stolen);
    logPrivate(room, actor.id, `你从 ${target.name} 处拿到了 ${CARD_DEFS[stolen.key].name}（${cardValue(stolen)}）。`);
    if (room.braincase) {
      target.hand.push(room.braincase);
      room.braincase = null;
      logPrivate(room, target.id, `你的手牌被米·戈夺走，你获得了米·戈脑缸。`);
      logPublic(room, `${target.name} 获得米·戈脑缸。`);
    } else {
      logPublic(room, "米·戈脑缸已不在场外，目标没有获得新的手牌。");
    }
  }

  if (applyHandTriggers(room, actor, "米·戈效果后")) return;
  if (actor.hand.length > 1) {
    room.pending = {
      type: "discardChoice",
      playerId: actor.id,
      choices: actor.hand.map((c) => c.uid),
      forced: false,
      prompt: "米·戈：从你的手牌中选择 1 张弃掉并结算。"
    };
  }
}

function effectTrade(room, actor, targetId) {
  const target = requireTarget(room, actor, "trade", targetId);
  if (!target) {
    logPublic(room, "没有可指定的目标，效果无事发生。");
    return;
  }
  const actorHand = actor.hand;
  actor.hand = target.hand;
  target.hand = actorHand;
  logPublic(room, `${actor.name} 与 ${target.name} 交换了手牌。`);
  if (actor.hand[0]) logPrivate(room, actor.id, `交换后你的手牌是 ${CARD_DEFS[actor.hand[0].key].name}（${cardValue(actor.hand[0])}）。`);
  if (target.hand[0]) logPrivate(room, target.id, `交换后你的手牌是 ${CARD_DEFS[target.hand[0].key].name}（${cardValue(target.hand[0])}）。`);
}

function effectRedistributeStart(room, actor) {
  const ids = legalTargets(room, actor, "redistribute");
  if (ids.length === 0) {
    logPublic(room, "没有可重新分配手牌的目标，效果无事发生。");
    return;
  }
  const targets = ids.map((id) => getPlayer(room, id)).filter(Boolean);
  const cards = [];
  for (const target of targets) {
    const card = target.hand.pop();
    if (card) cards.push(card);
  }
  if (cards.length === 0) {
    logPublic(room, "没有可重新分配的手牌。");
    return;
  }
  logPublic(room, `${actor.name} 收集了其他玩家的手牌，准备重新分配。`);
  room.pending = {
    type: "redistribute",
    playerId: actor.id,
    targets: targets.map((p) => p.id),
    cards
  };
}

function resolveRedistribute(room, actor, assignments) {
  const pending = room.pending;
  if (!pending || pending.type !== "redistribute" || pending.playerId !== actor.id) {
    throw new Error("当前不能重新分配手牌。");
  }
  const targetIds = pending.targets.slice();
  const cardUids = pending.cards.map((c) => c.uid);
  const used = new Set();
  for (const targetId of targetIds) {
    const uid = assignments?.[targetId];
    if (!uid || !cardUids.includes(uid) || used.has(uid)) {
      throw new Error("每名目标玩家必须且只能分配 1 张收集到的牌。");
    }
    used.add(uid);
  }
  for (const targetId of targetIds) {
    const target = getPlayer(room, targetId);
    const uid = assignments[targetId];
    const index = pending.cards.findIndex((card) => card.uid === uid);
    const [card] = pending.cards.splice(index, 1);
    if (target && card) {
      target.hand.push(card);
      logPrivate(room, target.id, `奈亚拉托提普重新分配给你：${CARD_DEFS[card.key].name}（${cardValue(card)}）。`);
    }
  }
  logPublic(room, `${actor.name} 完成了手牌重新分配。`);
  room.pending = null;
  finishTurn(room, room.currentPlayerId);
}

function effectCthulhu(room, actor) {
  if (insanityCount(actor) >= 2) {
    flushPendingStack(room);
    room.phase = "gameOver";
    room.gameWinnerId = actor.id;
    room.cthulhuWin = true;
    room.pending = null;
    logPublic(room, `${actor.name} 以克苏鲁的疯狂效果直接赢得整局。`);
    return;
  }
  loseByOwnDiscard(room, actor, "克苏鲁的疯狂效果未满足条件");
}

function loseByOwnDiscard(room, actor, reason) {
  if (actor.ward) {
    logPublic(room, `${actor.name} 受到伊波恩之书保护，没有因${reason}出局。`);
    return;
  }
  knockOutPlayer(room, actor, reason);
}

function knockOutPlayer(room, player, reason) {
  if (!player || !player.active || player.eliminated) return false;
  if (player.ward) {
    logPublic(room, `${player.name} 受到伊波恩之书保护，没有出局。`);
    return false;
  }
  player.active = false;
  player.eliminated = true;
  player.shield = false;
  const remaining = player.hand.splice(0);
  for (const card of remaining) {
    player.discard.push(card);
  }
  logPublic(room, `${player.name} 出局：${reason}。`);
  return true;
}

function endRoundByDeck(room, reason) {
  if (room.phase !== "round") return;
  logPublic(room, reason);
  const live = activePlayers(room);
  if (live.length === 0) {
    completeRound(room, null, "没有玩家仍在本轮中。");
    return;
  }

  const groups = new Map();
  for (const player of live) {
    const value = player.hand[0] ? cardValue(player.hand[0]) : -1;
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(player);
    const card = player.hand[0];
    if (card) logPublic(room, `${player.name} 揭示手牌 ${CARD_DEFS[card.key].name}（${value}）。`);
  }

  const tied = new Set();
  for (const players of groups.values()) {
    if (players.length > 1) {
      for (const player of players) tied.add(player.id);
    }
  }
  for (const player of live) {
    if (tied.has(player.id)) {
      player.active = false;
      player.eliminated = true;
      const remaining = player.hand.splice(0);
      for (const card of remaining) player.discard.push(card);
      logPublic(room, `${player.name} 因最高点数比较同点而出局。`);
    }
  }

  const candidates = live.filter((p) => !tied.has(p.id));
  if (candidates.length === 0) {
    completeRound(room, null, "所有剩余玩家同点，本轮无人获胜。");
    return;
  }
  candidates.sort((a, b) => cardValue(b.hand[0]) - cardValue(a.hand[0]));
  completeRound(room, candidates[0].id, "牌库耗尽后点数最高。");
}

function completeRound(room, winnerId, reason) {
  if (room.phase !== "round") return;
  flushPendingStack(room);
  room.pending = null;
  room.pendingStack = [];
  room.phase = "roundEnd";
  room.lastRoundWinnerId = winnerId || null;

  if (!winnerId) {
    logPublic(room, `本轮结束：${reason}`);
    return;
  }

  const winner = getPlayer(room, winnerId);
  const insane = isInsane(winner);
  if (insane) {
    winner.insaneWins += 1;
  } else {
    winner.saneWins += 1;
  }
  logPublic(room, `${winner.name} 赢得本轮（${insane ? "疯狂" : "清醒"}标记）：${reason}`);

  if (winner.saneWins >= 2 || winner.insaneWins >= 3) {
    room.phase = "gameOver";
    room.gameWinnerId = winner.id;
    logPublic(room, `${winner.name} 赢得整局游戏。`);
  }
}

function serializePending(room, viewer) {
  const pending = room.pending;
  if (!pending) return null;
  if (pending.playerId !== viewer.id) {
    return {
      type: "waiting",
      playerId: pending.playerId,
      playerName: getPlayer(room, pending.playerId)?.name || "玩家"
    };
  }
  if (pending.type === "redistribute") {
    return {
      type: "redistribute",
      playerId: pending.playerId,
      targets: pending.targets.map((id) => {
        const player = getPlayer(room, id);
        return { id, name: player?.name || "玩家" };
      }),
      cards: pending.cards.map(publicCard),
      prompt: "把收集到的牌重新分配给每名目标玩家。"
    };
  }
  return {
    type: pending.type,
    playerId: pending.playerId,
    choices: pending.choices || [],
    forced: Boolean(pending.forced),
    prompt: pending.prompt || "请选择操作。"
  };
}

function serializeRoom(room, viewer) {
  const players = room.players.map((player) => ({
    id: player.id,
    name: player.name,
    host: player.id === room.hostId,
    online: player.online,
    active: player.active,
    eliminated: player.eliminated,
    handCount: player.hand.length,
    discard: player.discard.map(publicCard),
    insane: isInsane(player),
    insanityCount: insanityCount(player),
    shield: player.shield,
    ward: player.ward,
    saneWins: player.saneWins,
    insaneWins: player.insaneWins
  }));

  return {
    roomId: room.id,
    phase: room.phase,
    roundNumber: room.roundNumber,
    hostId: room.hostId,
    meId: viewer.id,
    currentPlayerId: room.currentPlayerId,
    currentPlayerName: getPlayer(room, room.currentPlayerId)?.name || "",
    deckCount: room.deck.length,
    setAsideAvailable: Boolean(room.setAside),
    braincaseAvailable: Boolean(room.braincase),
    removedFaceUp: room.removedFaceUp.map(publicCard),
    resolving: room.pendingStack.map((item) => ({
      playerId: item.playerId,
      playerName: getPlayer(room, item.playerId)?.name || "玩家",
      card: publicCard(item.card)
    })),
    players,
    me: {
      id: viewer.id,
      name: viewer.name,
      hand: viewer.hand.map(publicCard),
      discard: viewer.discard.map(publicCard),
      insane: isInsane(viewer),
      insanityCount: insanityCount(viewer),
      shield: viewer.shield,
      ward: viewer.ward,
      saneWins: viewer.saneWins,
      insaneWins: viewer.insaneWins
    },
    pending: serializePending(room, viewer),
    publicLog: room.publicLog.slice(-60),
    privateLog: (room.privateLog.get(viewer.id) || []).slice(-50),
    lastRoundWinnerId: room.lastRoundWinnerId,
    gameWinnerId: room.gameWinnerId,
    cthulhuWin: room.cthulhuWin,
    cardReference: Object.values(CARD_DEFS).map((def) => ({
      key: def.key,
      name: def.name,
      value: def.value,
      insanity: def.insanity,
      short: def.short,
      saneText: def.saneText,
      insaneText: def.insaneText || null
    }))
  };
}

function broadcast(room) {
  const set = streams.get(room.id);
  if (!set) return;
  for (const client of [...set]) {
    const viewer = getPlayer(room, client.playerId);
    if (!viewer) {
      set.delete(client);
      continue;
    }
    sendEvent(client.res, "state", serializeRoom(room, viewer));
  }
}

function sendEvent(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function jsonResponse(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("请求体过大。"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("JSON 格式无效。"));
      }
    });
  });
}

async function handleApi(req, res, pathname) {
  try {
    if (req.method !== "POST" && pathname !== "/api/state") {
      jsonResponse(res, 405, { error: "Method not allowed" });
      return;
    }

    if (pathname === "/api/create") {
      const body = await parseBody(req);
      const { room, player } = createRoom(body.name);
      broadcast(room);
      jsonResponse(res, 200, { roomId: room.id, playerId: player.id, token: player.token });
      return;
    }

    if (pathname === "/api/join") {
      const body = await parseBody(req);
      const room = findRoom(body.roomId || body.room);
      const player = addPlayer(room, body.name);
      broadcast(room);
      jsonResponse(res, 200, { roomId: room.id, playerId: player.id, token: player.token });
      return;
    }

    const body = req.method === "POST" ? await parseBody(req) : {};
    const room = findRoom(body.roomId || body.room || new URL(req.url, `http://${req.headers.host}`).searchParams.get("room"));
    const player = authPlayer(room, body.playerId || body.player, body.token);

    if (pathname === "/api/state") {
      jsonResponse(res, 200, serializeRoom(room, player));
      return;
    }

    if (pathname === "/api/start") {
      if (player.id !== room.hostId) throw new Error("只有房主可以开始游戏。");
      if (room.phase !== "lobby" && room.phase !== "gameOver") throw new Error("当前不能开始新游戏。");
      startGame(room, player.id);
      broadcast(room);
      jsonResponse(res, 200, { ok: true });
      return;
    }

    if (pathname === "/api/next-round") {
      if (room.phase !== "roundEnd") throw new Error("当前不能开始下一轮。");
      const starter = room.lastRoundWinnerId || room.starterId || player.id;
      startRound(room, starter);
      broadcast(room);
      jsonResponse(res, 200, { ok: true });
      return;
    }

    if (pathname === "/api/restart") {
      if (player.id !== room.hostId) throw new Error("只有房主可以重新开局。");
      startGame(room, player.id);
      broadcast(room);
      jsonResponse(res, 200, { ok: true });
      return;
    }

    if (pathname === "/api/action") {
      if (body.action === "discard") {
        resolveSubmittedDiscard(room, player, body.cardUid, body.mode, body.params || {});
      } else if (body.action === "redistribute") {
        resolveRedistribute(room, player, body.assignments || {});
      } else {
        throw new Error("未知操作。");
      }
      broadcast(room);
      jsonResponse(res, 200, { ok: true });
      return;
    }

    jsonResponse(res, 404, { error: "Not found" });
  } catch (error) {
    jsonResponse(res, 400, { error: error.message || "请求失败。" });
  }
}

function handleEvents(req, res, url) {
  try {
    const room = findRoom(url.searchParams.get("room"));
    const player = authPlayer(room, url.searchParams.get("player"), url.searchParams.get("token"));
    player.online = true;
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });
    const client = { res, playerId: player.id };
    if (!streams.has(room.id)) streams.set(room.id, new Set());
    streams.get(room.id).add(client);
    sendEvent(res, "state", serializeRoom(room, player));
    broadcast(room);
    req.on("close", () => {
      streams.get(room.id)?.delete(client);
      const stillOnline = [...(streams.get(room.id) || [])].some((c) => c.playerId === player.id);
      player.online = stillOnline;
      broadcast(room);
    });
  } catch (error) {
    jsonResponse(res, 400, { error: error.message || "无法连接事件流。" });
  }
}

function serveStatic(req, res, pathname) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const normalized = path.normalize(safePath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, normalized);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === "/events") {
    handleEvents(req, res, url);
    return;
  }
  if (url.pathname.startsWith("/api/")) {
    handleApi(req, res, url.pathname);
    return;
  }
  serveStatic(req, res, url.pathname);
});

setInterval(() => {
  for (const set of streams.values()) {
    for (const client of set) {
      client.res.write(": ping\n\n");
    }
  }
}, 25000).unref();

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Lovecraft Letter server listening on http://0.0.0.0:${PORT}`);
});
