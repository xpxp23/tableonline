const COLORS = [
  { id: 1, name: "红", glyph: "●" },
  { id: 2, name: "橙", glyph: "◆" },
  { id: 3, name: "黄", glyph: "✤" },
  { id: 4, name: "绿", glyph: "✦" },
  { id: 5, name: "蓝", glyph: "✽" },
  { id: 6, name: "紫", glyph: "✿" }
];

const COLOR_IDS = COLORS.map(color => color.id);
const READY_HAND_SIZE = 5;
const WIN_HAND_SIZE = 6;
const TARGET_POINTS = 10;
const MAX_PLAYERS = 5;

const BASE_PATTERNS = [
  {
    id: "sameColor",
    name: "一色",
    score: 1,
    description: "6 枚手牌的下半色可以全部排成同一种颜色。"
  },
  {
    id: "threeRun",
    name: "三连",
    score: 3,
    description: "6 枚手牌能分成 2 组，每组上半色为连续 3 色、下半色相同。"
  },
  {
    id: "rikka",
    name: "六华",
    score: 6,
    description: "6 枚手牌的上半色为 1-6 各 1 次，下半色全部相同。"
  }
];

const OPTIONAL_PATTERNS = [
  {
    id: "threeColors",
    name: "三色",
    score: 3,
    description: "6 枚手牌的上下两色只使用 3 种颜色。"
  },
  {
    id: "threePairs",
    name: "三对",
    score: 5,
    description: "手牌由 3 组完全相同的牌组成。"
  },
  {
    id: "spark",
    name: "辉光",
    score: 5,
    noGlowBonus: true,
    description: "6 枚手牌全部带有辉光标记。此牌型不再叠加辉光加分。"
  },
  {
    id: "unrivaled",
    name: "无双",
    score: 3,
    description: "手牌为 1/1、2/2、3/3、4/4、5/5、6/6；含辉光加分后通常为 9 分。"
  }
];

const ALL_PATTERNS = [...BASE_PATTERNS, ...OPTIONAL_PATTERNS];

function cloneTile(tile, hidden = false, slotId = "") {
  if (!tile) return null;
  if (hidden) return { id: slotId, hidden: true };
  return {
    id: tile.id,
    top: tile.top,
    bottom: tile.bottom,
    glow: tile.glow
  };
}

function normalizePair(a, b) {
  return a <= b ? `${a}-${b}` : `${b}-${a}`;
}

function tileKey(tile) {
  return `${tile.top}-${tile.bottom}`;
}

function colorsOf(tile) {
  return tile.top === tile.bottom ? [tile.top] : [tile.top, tile.bottom];
}

function makeDeck() {
  const deck = [];
  let serial = 0;
  for (const top of COLOR_IDS) {
    for (let bottom = top; bottom <= 6; bottom += 1) {
      for (let copy = 1; copy <= 2; copy += 1) {
        serial += 1;
        deck.push({
          id: `D${serial}`,
          top,
          bottom,
          glow: top === bottom
        });
      }
    }
  }
  return deck;
}

function shuffle(list, random = Math.random) {
  const result = list.slice();
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function orientationsForHand(hand) {
  const result = [];
  function walk(index, acc) {
    if (index === hand.length) {
      result.push(acc);
      return;
    }
    const tile = hand[index];
    walk(index + 1, [...acc, { tile, top: tile.top, bottom: tile.bottom }]);
    if (tile.top !== tile.bottom) {
      walk(index + 1, [...acc, { tile, top: tile.bottom, bottom: tile.top }]);
    }
  }
  walk(0, []);
  return result;
}

function countMap(values) {
  const map = new Map();
  for (const value of values) map.set(value, (map.get(value) || 0) + 1);
  return map;
}

function combinations(values, size) {
  const result = [];
  function walk(start, acc) {
    if (acc.length === size) {
      result.push(acc);
      return;
    }
    for (let i = start; i < values.length; i += 1) {
      walk(i + 1, [...acc, values[i]]);
    }
  }
  walk(0, []);
  return result;
}

function hasSameColor(hand) {
  return orientationsForHand(hand).some(oriented => new Set(oriented.map(item => item.bottom)).size === 1)
    || COLOR_IDS.some(color => countMap(hand.flatMap(colorsOf)).get(color) === WIN_HAND_SIZE);
}

function hasRikka(hand) {
  return orientationsForHand(hand).some(oriented => {
    const top = oriented.map(item => item.top).sort((a, b) => a - b).join(",");
    const bottom = new Set(oriented.map(item => item.bottom));
    return top === "1,2,3,4,5,6" && bottom.size === 1;
  });
}

function isRunGroup(group) {
  const top = group.map(item => item.top).sort((a, b) => a - b);
  const bottom = new Set(group.map(item => item.bottom));
  return bottom.size === 1 && top[1] === top[0] + 1 && top[2] === top[1] + 1;
}

function hasThreeRun(hand) {
  return orientationsForHand(hand).some(oriented => {
    const indexes = [0, 1, 2, 3, 4, 5];
    for (const first of combinations(indexes, 3)) {
      const firstSet = new Set(first);
      const second = indexes.filter(index => !firstSet.has(index));
      if (isRunGroup(first.map(index => oriented[index])) && isRunGroup(second.map(index => oriented[index]))) {
        return true;
      }
    }
    return false;
  });
}

function hasThreeColors(hand) {
  const colors = new Set(hand.flatMap(colorsOf));
  return colors.size === 3;
}

function hasThreePairs(hand) {
  const counts = countMap(hand.map(tileKey));
  return counts.size === 3 && [...counts.values()].every(count => count === 2);
}

function hasSpark(hand) {
  return hand.every(tile => tile.glow);
}

function hasUnrivaled(hand) {
  const keys = hand.map(tileKey).sort().join(",");
  return keys === "1-1,2-2,3-3,4-4,5-5,6-6";
}

function scorePattern(pattern, hand, riichi = false) {
  const glowBonus = pattern.noGlowBonus ? 0 : hand.filter(tile => tile.glow).length;
  const riichiBonus = riichi ? 1 : 0;
  return {
    ...pattern,
    baseScore: pattern.score,
    glowBonus,
    riichiBonus,
    score: pattern.score + glowBonus + riichiBonus
  };
}

function evaluatePatterns(hand, options = {}, riichi = false) {
  if (!Array.isArray(hand) || hand.length !== WIN_HAND_SIZE) return [];
  const checks = [
    ["sameColor", hasSameColor],
    ["threeRun", hasThreeRun],
    ["rikka", hasRikka]
  ];
  if (options.optionalPatterns) {
    checks.push(
      ["threeColors", hasThreeColors],
      ["threePairs", hasThreePairs],
      ["spark", hasSpark],
      ["unrivaled", hasUnrivaled]
    );
  }
  const meta = new Map(ALL_PATTERNS.map(pattern => [pattern.id, pattern]));
  return checks
    .filter(([, test]) => test(hand))
    .map(([id]) => scorePattern(meta.get(id), hand, riichi));
}

function bestPattern(hand, options, riichi = false) {
  const patterns = evaluatePatterns(hand, options, riichi);
  if (!patterns.length) return null;
  return patterns.reduce((best, pattern) => (pattern.score > best.score ? pattern : best), patterns[0]);
}

function bestCompletionWithField(hand, fieldTiles, options, riichi = false) {
  let best = null;
  for (const tile of fieldTiles) {
    const pattern = bestPattern([...hand, tile], options, riichi);
    if (pattern && (!best || pattern.score > best.pattern.score)) {
      best = { tile, pattern };
    }
  }
  return best;
}

function createPlayer(id, name) {
  return {
    id,
    name,
    hand: [],
    score: 0,
    ready: false,
    riichi: false,
    drawnTileId: null,
    startCount: 0,
    connectedAt: Date.now(),
    seenAt: Date.now()
  };
}

class Game {
  constructor(random = Math.random) {
    this.random = random;
    this.players = [];
    this.phase = "lobby";
    this.options = {
      targetScore: TARGET_POINTS,
      optionalPatterns: true,
      riichi: true,
      ron: true
    };
    this.turnIndex = 0;
    this.startPlayerIndex = 0;
    this.table = [];
    this.round = 0;
    this.roundWinner = null;
    this.lastDiscard = null;
    this.slotSerial = 0;
    this.log = [];
  }

  addPlayer(id, name) {
    if (this.players.length >= MAX_PLAYERS) throw new Error("房间最多 5 人");
    if (this.phase !== "lobby") throw new Error("对局已经开始，不能加入");
    this.players.push(createPlayer(id, name));
    this.addLog(`${name} 加入房间。`);
  }

  markSeen(id) {
    const player = this.getPlayer(id, false);
    if (player) player.seenAt = Date.now();
  }

  getPlayer(id, required = true) {
    const player = this.players.find(item => item.id === id);
    if (!player && required) throw new Error("玩家不存在");
    return player;
  }

  currentPlayer() {
    return this.players[this.turnIndex] || null;
  }

  addLog(text) {
    this.log.unshift({ id: `${Date.now()}-${Math.random()}`, text, time: Date.now() });
    this.log = this.log.slice(0, 100);
  }

  action(id, type, payload = {}) {
    const player = this.getPlayer(id);
    switch (type) {
      case "setName":
        return this.setName(player, payload);
      case "setOptions":
        return this.setOptions(player, payload);
      case "ready":
        return this.setReady(player, true);
      case "unready":
        return this.setReady(player, false);
      case "start":
        return this.startGame(player);
      case "drawTable":
        return this.drawTable(player, payload.slotId || payload.tileId);
      case "discard":
        return this.discardTile(player, payload.tileId);
      case "declareRiichi":
        return this.declareRiichi(player);
      case "claimRon":
        return this.claimRon(player);
      case "passRon":
        return this.passRon(player);
      case "declareWin":
        return this.declareWin(player, payload.patternId);
      case "nextRound":
        return this.nextRound(player);
      case "reset":
        return this.reset(player);
      default:
        throw new Error("未知操作");
    }
  }

  setName(player, payload) {
    const name = String(payload.name || "").trim().slice(0, 16);
    if (!name) throw new Error("请输入玩家名");
    this.addLog(`${player.name} 改名为 ${name}。`);
    player.name = name;
    return { ok: true };
  }

  setOptions(player, payload) {
    this.requireLobby();
    this.requireHost(player);
    const targetScore = Number(payload.targetScore || this.options.targetScore);
    this.options = {
      targetScore: Math.max(6, Math.min(30, Math.round(targetScore))),
      optionalPatterns: Boolean(payload.optionalPatterns),
      riichi: Boolean(payload.riichi),
      ron: Boolean(payload.ron)
    };
    this.addLog(`${player.name} 更新了规则设置。`);
    return { ok: true };
  }

  setReady(player, ready) {
    this.requireLobby();
    player.ready = ready;
    this.addLog(`${player.name}${ready ? "已准备" : "取消准备"}。`);
    return { ok: true };
  }

  startGame(player) {
    this.requireLobby();
    this.requireHost(player);
    if (this.players.length < 2) throw new Error("至少需要 2 名玩家");
    if (!this.players.every(item => item.ready || item.id === player.id)) throw new Error("还有玩家未准备");
    this.round = 0;
    this.startPlayerIndex = 0;
    for (const item of this.players) {
      item.score = 0;
      item.startCount = 0;
    }
    this.beginRound();
    this.addLog(`${player.name} 开始对局。`);
    return { ok: true };
  }

  beginRound() {
    this.round += 1;
    this.phase = "playing";
    this.roundWinner = null;
    this.lastDiscard = null;
    this.table = [];
    this.slotSerial = 0;
    const deck = shuffle(makeDeck(), this.random);
    for (const player of this.players) {
      player.hand = [];
      player.ready = false;
      player.riichi = false;
      player.drawnTileId = null;
      for (let i = 0; i < READY_HAND_SIZE; i += 1) player.hand.push(deck.pop());
    }
    while (deck.length) this.table.push(this.newSlot(deck.pop(), false));
    this.turnIndex = this.startPlayerIndex % this.players.length;
    this.currentPlayer().startCount += 1;
    this.addLog(`第 ${this.round} 局开始，${this.currentPlayer().name} 是起始玩家。`);
  }

  newSlot(tile, faceUp) {
    this.slotSerial += 1;
    return { id: `S${this.round}-${this.slotSerial}`, tile, faceUp };
  }

  drawTable(player, slotId) {
    this.requirePlayingTurn(player);
    this.requireHandSize(player, READY_HAND_SIZE, "请先弃到 5 张牌");
    const index = this.table.findIndex(slot => slot.id === slotId);
    if (index < 0) throw new Error("场上没有这张牌");
    const [slot] = this.table.splice(index, 1);
    player.hand.push(slot.tile);
    player.drawnTileId = slot.tile.id;
    this.addLog(`${player.name} 从场上拿取了一张${slot.faceUp ? "明牌" : "暗牌"}。`);
    return { ok: true };
  }

  discardTile(player, tileId) {
    this.requirePlayingTurn(player);
    this.requireHandSize(player, WIN_HAND_SIZE, "请先拿一张牌");
    const currentPattern = bestPattern(player.hand, this.options, player.riichi);
    if (player.riichi && !currentPattern && tileId !== player.drawnTileId) {
      throw new Error("立直后若未完成，必须弃出本回合拿到的牌");
    }
    const index = player.hand.findIndex(tile => tile.id === tileId);
    if (index < 0) throw new Error("手牌中没有这张牌");
    const [tile] = player.hand.splice(index, 1);
    player.drawnTileId = null;
    const slot = this.newSlot(tile, true);
    this.table.unshift(slot);
    this.lastDiscard = {
      slotId: slot.id,
      tile,
      fromPlayerId: player.id,
      fromName: player.name,
      passed: new Set([player.id])
    };
    if (this.options.ron && this.players.some(item => item.id !== player.id && bestPattern([...item.hand, tile], this.options, item.riichi))) {
      this.phase = "ron";
      this.addLog(`${player.name} 弃出一张牌，其他玩家可以直击。`);
      return { ok: true };
    }
    this.advanceTurn();
    this.addLog(`${player.name} 弃出一张牌。`);
    this.checkTableExhausted();
    return { ok: true };
  }

  declareRiichi(player) {
    this.requirePlayingTurn(player);
    if (!this.options.riichi) throw new Error("本局未启用立直");
    this.requireHandSize(player, READY_HAND_SIZE, "立直需要保留 5 张手牌");
    if (player.riichi) throw new Error("你已经立直");
    const visibleTiles = this.visibleFieldTiles();
    if (!bestCompletionWithField(player.hand, visibleTiles, this.options, true)) {
      throw new Error("当前明牌中没有能让你成型的牌，不能立直");
    }
    player.riichi = true;
    this.addLog(`${player.name} 宣告立直。`);
    return { ok: true };
  }

  claimRon(player) {
    if (this.phase !== "ron" || !this.lastDiscard) throw new Error("当前不能直击");
    if (player.id === this.lastDiscard.fromPlayerId) throw new Error("不能直击自己的弃牌");
    const hand = [...player.hand, this.lastDiscard.tile];
    const pattern = bestPattern(hand, this.options, player.riichi);
    if (!pattern) throw new Error("这张弃牌不能组成牌型");
    this.removeSlot(this.lastDiscard.slotId);
    this.finishRound(player, pattern, "ron", this.getPlayer(this.lastDiscard.fromPlayerId));
    return { ok: true };
  }

  passRon(player) {
    if (this.phase !== "ron" || !this.lastDiscard) throw new Error("当前不能跳过直击");
    this.lastDiscard.passed.add(player.id);
    const everyonePassed = this.players
      .filter(item => item.id !== this.lastDiscard.fromPlayerId)
      .every(item => this.lastDiscard.passed.has(item.id));
    if (everyonePassed) {
      const discarder = this.getPlayer(this.lastDiscard.fromPlayerId);
      this.phase = "playing";
      this.advanceTurnFrom(discarder.id);
      this.addLog("无人直击，继续下一位。");
      this.checkTableExhausted();
    }
    return { ok: true };
  }

  declareWin(player, patternId) {
    this.requirePlayingTurn(player);
    this.requireHandSize(player, WIN_HAND_SIZE, "请先拿一张牌");
    const patterns = evaluatePatterns(player.hand, this.options, player.riichi);
    if (!patterns.length) throw new Error("当前手牌尚未成型");
    const selected = patterns.find(pattern => pattern.id === patternId) || bestPattern(player.hand, this.options, player.riichi);
    this.finishRound(player, selected, "self", null);
    return { ok: true };
  }

  nextRound(player) {
    if (this.phase !== "roundEnd") throw new Error("当前不能进入下一局");
    if (this.roundWinner && this.roundWinner.matchOver) throw new Error("整场已经结束");
    this.requireHost(player);
    this.startPlayerIndex = (this.startPlayerIndex + 1) % this.players.length;
    this.beginRound();
    return { ok: true };
  }

  reset(player) {
    this.requireHost(player);
    this.phase = "lobby";
    this.turnIndex = 0;
    this.startPlayerIndex = 0;
    this.round = 0;
    this.table = [];
    this.roundWinner = null;
    this.lastDiscard = null;
    for (const item of this.players) {
      item.hand = [];
      item.ready = item.id === player.id;
      item.riichi = false;
      item.drawnTileId = null;
      item.startCount = 0;
      item.score = 0;
    }
    this.addLog(`${player.name} 重置了房间。`);
    return { ok: true };
  }

  finishRound(winner, pattern, winType, loser) {
    const incidental = [];
    if (winType === "ron") {
      const paid = Math.min(loser.score, pattern.score);
      loser.score -= paid;
      winner.score += paid;
      pattern = { ...pattern, paidScore: paid };
    } else {
      winner.score += pattern.score;
    }

    const faceUpTiles = this.visibleFieldTiles();
    for (const player of this.players) {
      if (player.id === winner.id || player.hand.length !== READY_HAND_SIZE) continue;
      const completion = bestCompletionWithField(player.hand, faceUpTiles, this.options, player.riichi);
      if (!completion) continue;
      player.score += completion.pattern.score;
      incidental.push({
        playerId: player.id,
        playerName: player.name,
        pattern: completion.pattern,
        tile: cloneTile(completion.tile)
      });
    }

    const leader = this.players.reduce((best, item) => (item.score > best.score ? item : best), this.players[0]);
    const matchOver = leader.score >= this.options.targetScore || this.players.every(player => player.startCount >= 2);
    this.roundWinner = {
      playerId: winner.id,
      playerName: winner.name,
      loserId: loser ? loser.id : null,
      loserName: loser ? loser.name : null,
      pattern,
      winType,
      total: winType === "ron" ? pattern.paidScore : pattern.score,
      incidental,
      matchOver,
      leaderId: leader.id,
      leaderName: leader.name
    };
    this.phase = "roundEnd";
    this.addLog(
      winType === "ron"
        ? `${winner.name} 直击 ${loser.name}，以「${pattern.name}」取得 ${pattern.paidScore} 分。`
        : `${winner.name} 以「${pattern.name}」完成，获得 ${pattern.score} 分。`
    );
    for (const item of incidental) {
      this.addLog(`${item.playerName} 顺带完成「${item.pattern.name}」，获得 ${item.pattern.score} 分。`);
    }
    if (matchOver) this.addLog(`${leader.name} 获胜，整场结束。`);
  }

  visibleFieldTiles() {
    return this.table.filter(slot => slot.faceUp).map(slot => slot.tile);
  }

  removeSlot(slotId) {
    const index = this.table.findIndex(slot => slot.id === slotId);
    if (index >= 0) this.table.splice(index, 1);
  }

  advanceTurn() {
    this.turnIndex = (this.turnIndex + 1) % this.players.length;
  }

  advanceTurnFrom(playerId) {
    const index = this.players.findIndex(player => player.id === playerId);
    this.turnIndex = (index + 1) % this.players.length;
  }

  checkTableExhausted() {
    if (this.table.length) return;
    const leader = this.players.reduce((best, item) => (item.score > best.score ? item : best), this.players[0]);
    this.roundWinner = {
      playerId: null,
      playerName: "无人",
      pattern: { name: "流局", score: 0 },
      winType: "draw",
      total: 0,
      incidental: [],
      matchOver: leader.score >= this.options.targetScore || this.players.every(player => player.startCount >= 2),
      leaderId: leader.id,
      leaderName: leader.name
    };
    this.phase = "roundEnd";
    this.addLog("场上没有可拿取的牌，本局流局。");
  }

  requireLobby() {
    if (this.phase !== "lobby") throw new Error("只有大厅阶段可以执行该操作");
  }

  requireHost(player) {
    if (this.players[0] && this.players[0].id !== player.id) throw new Error("只有房主可以操作");
  }

  requirePlayingTurn(player) {
    if (this.phase !== "playing") throw new Error("当前不是行动阶段");
    const current = this.currentPlayer();
    if (!current || current.id !== player.id) throw new Error("还没轮到你");
  }

  requireHandSize(player, size, message) {
    if (player.hand.length !== size) throw new Error(message);
  }

  viewFor(playerId) {
    const me = this.getPlayer(playerId, false);
    const current = this.currentPlayer();
    const winningPatterns = me ? evaluatePatterns(me.hand, this.options, me.riichi) : [];
    const visibleTiles = this.visibleFieldTiles();
    const riichiReady = me
      ? this.options.riichi && this.phase === "playing" && current && current.id === me.id && me.hand.length === READY_HAND_SIZE && !me.riichi && Boolean(bestCompletionWithField(me.hand, visibleTiles, this.options, true))
      : false;
    const ronPattern = me && this.phase === "ron" && this.lastDiscard && this.lastDiscard.fromPlayerId !== me.id
      ? bestPattern([...me.hand, this.lastDiscard.tile], this.options, me.riichi)
      : null;
    return {
      phase: this.phase,
      options: this.options,
      round: this.round,
      roundsLimit: this.players.length * 2,
      isHost: Boolean(this.players[0] && this.players[0].id === playerId),
      currentPlayerId: current ? current.id : null,
      currentPlayerName: current ? current.name : "",
      deckCount: this.table.filter(slot => !slot.faceUp).length,
      discardCount: this.table.filter(slot => slot.faceUp).length,
      table: this.table.map(slot => ({
        slotId: slot.id,
        tile: cloneTile(slot.tile, !slot.faceUp, slot.id),
        faceUp: slot.faceUp,
        empty: false
      })),
      lastDiscard: this.lastDiscard
        ? {
            tile: cloneTile(this.lastDiscard.tile),
            fromPlayerId: this.lastDiscard.fromPlayerId,
            fromName: this.lastDiscard.fromName
          }
        : null,
      players: this.players.map(player => ({
        id: player.id,
        name: player.name,
        score: player.score,
        ready: player.ready,
        riichi: player.riichi,
        startCount: player.startCount,
        handCount: player.hand.length,
        isMe: player.id === playerId,
        isCurrent: current && current.id === player.id,
        online: Date.now() - player.seenAt < 15000
      })),
      me: me
        ? {
            id: me.id,
            name: me.name,
            hand: me.hand.map(tile => cloneTile(tile)),
            winningPatterns,
            ronPattern,
            canDraw: this.phase === "playing" && current && current.id === me.id && me.hand.length === READY_HAND_SIZE,
            canDiscard: this.phase === "playing" && current && current.id === me.id && me.hand.length === WIN_HAND_SIZE,
            canDeclare: this.phase === "playing" && current && current.id === me.id && winningPatterns.length > 0,
            canRiichi: riichiReady,
            riichi: me.riichi,
            drawnTileId: me.drawnTileId,
            canClaimRon: Boolean(ronPattern),
            hasPassedRon: Boolean(this.lastDiscard && this.lastDiscard.passed && this.lastDiscard.passed.has(me.id))
          }
        : null,
      discard: this.table.filter(slot => slot.faceUp).slice(0, 12).map(slot => cloneTile(slot.tile)),
      roundWinner: this.roundWinner,
      patterns: ALL_PATTERNS,
      basePatterns: BASE_PATTERNS,
      optionalPatterns: OPTIONAL_PATTERNS,
      colors: COLORS,
      log: this.log
    };
  }
}

module.exports = {
  Game,
  makeDeck,
  evaluatePatterns,
  bestPattern,
  COLORS,
  BASE_PATTERNS,
  OPTIONAL_PATTERNS
};
