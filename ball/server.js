const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");
const TICK_RATE = 30;
const DT = 1 / TICK_RATE;
const BATTLE_SECONDS = 55;
const FIELD = { w: 520, h: 520 };
const BASE_GOLD = 9;

const rooms = new Map();

const UNIT_DEFS = {
  splitter: {
    id: "splitter",
    name: "分裂球",
    icon: "S",
    cost: 3,
    color: "#22c55e",
    hp: 120,
    radius: 13,
    damage: 12,
    speed: 190,
    attackEvery: 1.25,
    tags: ["combo"],
    text: "命中后生成临时小球。升级会提高分裂数量。"
  },
  poison: {
    id: "poison",
    name: "毒球",
    icon: "P",
    cost: 3,
    color: "#a3e635",
    hp: 110,
    radius: 12,
    damage: 8,
    speed: 175,
    attackEvery: 1.05,
    tags: ["dot"],
    text: "攻击附加可叠加中毒。适合拖长战斗。"
  },
  laser: {
    id: "laser",
    name: "激光球",
    icon: "L",
    cost: 4,
    color: "#38bdf8",
    hp: 95,
    radius: 12,
    damage: 18,
    speed: 170,
    attackEvery: 1.45,
    tags: ["burst"],
    text: "穿透激光命中一条线上的敌人。"
  },
  trapper: {
    id: "trapper",
    name: "陷阱球",
    icon: "T",
    cost: 2,
    color: "#f97316",
    hp: 130,
    radius: 13,
    damage: 9,
    speed: 160,
    attackEvery: 1.2,
    tags: ["control"],
    text: "沿途布置地雷，碰撞或靠近时爆炸。"
  },
  ram: {
    id: "ram",
    name: "冲撞球",
    icon: "R",
    cost: 2,
    color: "#ef4444",
    hp: 155,
    radius: 15,
    damage: 14,
    speed: 205,
    attackEvery: 1.4,
    tags: ["tank"],
    text: "高速碰撞造成额外伤害。"
  },
  frost: {
    id: "frost",
    name: "冰霜球",
    icon: "F",
    cost: 3,
    color: "#93c5fd",
    hp: 120,
    radius: 13,
    damage: 10,
    speed: 165,
    attackEvery: 1.15,
    tags: ["control"],
    text: "攻击降低敌人速度和攻速。"
  },
  vampire: {
    id: "vampire",
    name: "吸血球",
    icon: "V",
    cost: 4,
    color: "#e879f9",
    hp: 125,
    radius: 13,
    damage: 13,
    speed: 180,
    attackEvery: 1.05,
    tags: ["sustain"],
    text: "造成伤害时回复自己。"
  },
  orbit: {
    id: "orbit",
    name: "卫星球",
    icon: "O",
    cost: 5,
    color: "#facc15",
    hp: 115,
    radius: 12,
    damage: 11,
    speed: 155,
    attackEvery: 1.0,
    tags: ["combo"],
    text: "拥有环绕卫星，近身持续刮伤。"
  }
};

const UNIT_IDS = Object.keys(UNIT_DEFS);

const RELICS = [
  {
    id: "rapid",
    name: "攻速 +50%",
    text: "所有弹球攻击间隔缩短 33%。",
    apply(unit) {
      unit.attackEvery *= 0.67;
    }
  },
  {
    id: "echo",
    name: "回声打击",
    text: "35% 概率额外攻击一次。",
    apply(unit) {
      unit.extraAttackChance += 0.35;
    }
  },
  {
    id: "heavy",
    name: "重型弹芯",
    text: "生命 +30%，碰撞伤害 +40%。",
    apply(unit) {
      unit.maxHp *= 1.3;
      unit.hp = unit.maxHp;
      unit.collisionDamage *= 1.4;
      unit.radius += 1;
    }
  },
  {
    id: "volatile",
    name: "高爆外壳",
    text: "死亡时爆炸，对附近敌人造成伤害。",
    apply(unit) {
      unit.deathExplosion = true;
    }
  },
  {
    id: "magnet",
    name: "磁力边框",
    text: "攻击射程 +20%，投射物速度 +25%。",
    apply(unit) {
      unit.range *= 1.2;
      unit.projectileSpeed *= 1.25;
    }
  },
  {
    id: "glass",
    name: "玻璃火控",
    text: "伤害 +45%，生命 -18%。",
    apply(unit) {
      unit.damage *= 1.45;
      unit.maxHp *= 0.82;
      unit.hp = unit.maxHp;
    }
  },
  {
    id: "spikes",
    name: "反伤尖刺",
    text: "受到碰撞时反弹固定伤害。",
    apply(unit) {
      unit.thorns += 9;
    }
  },
  {
    id: "regen",
    name: "修复凝胶",
    text: "每秒回复 2.2% 最大生命。",
    apply(unit) {
      unit.regen += 0.022;
    }
  },
  {
    id: "chaos",
    name: "混沌弹道",
    text: "速度 +35%，每次撞墙后下一击伤害提高。",
    apply(unit) {
      unit.speed *= 1.35;
      unit.wallCharge = true;
    }
  },
  {
    id: "bounty",
    name: "赏金袋",
    text: "每回合额外 +2 金币。",
    economy(player) {
      player.bonusGold += 2;
    }
  },
  {
    id: "bench",
    name: "扩编许可",
    text: "上阵上限 +1。",
    economy(player) {
      player.maxBoard += 1;
    }
  },
  {
    id: "interest",
    name: "复利模块",
    text: "回合开始按存款获得利息，最多 +4。",
    economy(player) {
      player.interest = true;
    }
  }
];

function uid(prefix = "") {
  return prefix + crypto.randomBytes(5).toString("hex");
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function randInt(max) {
  return Math.floor(Math.random() * max);
}

function pick(arr) {
  return arr[randInt(arr.length)];
}

function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function roomCode() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 5; i += 1) code += letters[randInt(letters.length)];
  return code;
}

function sanitizeName(name) {
  const value = String(name || "").trim().slice(0, 14);
  return value || "玩家";
}

function makePlayer(name, seat) {
  return {
    id: uid("p_"),
    name: sanitizeName(name),
    seat,
    hp: 30,
    gold: 10,
    level: 1,
    xp: 0,
    maxBoard: 3,
    bonusGold: 0,
    interest: false,
    locked: false,
    ready: false,
    board: [makeUnit(pick(["splitter", "poison", "trapper", "ram"]))],
    bench: [],
    shop: rollShop(4),
    relics: [],
    relicChoices: [],
    lastSeen: Date.now()
  };
}

function publicPlayer(player, viewerId) {
  const own = player.id === viewerId;
  return {
    id: player.id,
    name: player.name,
    seat: player.seat,
    hp: player.hp,
    gold: own ? player.gold : undefined,
    level: player.level,
    xp: own ? player.xp : undefined,
    maxBoard: player.maxBoard,
    bonusGold: own ? player.bonusGold : undefined,
    interest: own ? player.interest : undefined,
    locked: own ? player.locked : undefined,
    ready: player.ready,
    board: own ? player.board : scrubUnits(player.board),
    bench: own ? player.bench : [],
    shop: own ? player.shop : [],
    relics: own ? player.relics : player.relics.map((r) => ({ id: r.id, name: r.name })),
    relicChoices: own ? player.relicChoices : []
  };
}

function scrubUnits(units) {
  return units.map((u) => ({
    id: u.id,
    type: u.type,
    name: UNIT_DEFS[u.type].name,
    tier: u.tier,
    color: UNIT_DEFS[u.type].color
  }));
}

function rollShop(count) {
  const shop = [];
  for (let i = 0; i < count; i += 1) {
    const type = pick(UNIT_IDS);
    shop.push({
      slot: uid("s_"),
      type,
      frozen: false
    });
  }
  return shop;
}

function makeUnit(type) {
  return {
    id: uid("u_"),
    type,
    tier: 1
  };
}

function unitCost(type) {
  return UNIT_DEFS[type].cost;
}

function tierStatsMultiplier(tier) {
  return tier === 3 ? 2.55 : tier === 2 ? 1.65 : 1;
}

function cloneRelic(relic) {
  return { id: relic.id, name: relic.name, text: relic.text };
}

function makeRoom(hostName) {
  let code = roomCode();
  while (rooms.has(code)) code = roomCode();
  const host = makePlayer(hostName, 0);
  const room = {
    code,
    createdAt: Date.now(),
    phase: "lobby",
    round: 1,
    players: [host],
    battle: null,
    battleTimer: null,
    log: ["房间已创建。等待第二名玩家加入。"]
  };
  rooms.set(code, room);
  return { room, player: host };
}

function getRoom(code) {
  return rooms.get(String(code || "").trim().toUpperCase());
}

function getPlayer(room, playerId) {
  return room.players.find((p) => p.id === playerId);
}

function stateFor(room, viewerId) {
  return {
    code: room.code,
    phase: room.phase,
    round: room.round,
    log: room.log.slice(-12),
    players: room.players.map((p) => publicPlayer(p, viewerId)),
    battle: room.battle ? publicBattle(room.battle) : null,
    defs: {
      units: UNIT_DEFS,
      relics: RELICS.map(cloneRelic),
      field: FIELD
    },
    now: Date.now()
  };
}

function publicBattle(battle) {
  return {
    id: battle.id,
    status: battle.status,
    round: battle.round,
    elapsed: battle.elapsed,
    winnerSeat: battle.winnerSeat,
    events: battle.events.slice(-45),
    units: battle.units
      .filter((u) => !u.tempExpired)
      .map((u) => ({
        id: u.id,
        type: u.type,
        tier: u.tier,
        ownerSeat: u.ownerSeat,
        name: u.name,
        color: u.color,
        x: u.x,
        y: u.y,
        vx: u.vx,
        vy: u.vy,
        hp: Math.max(0, u.hp),
        maxHp: u.maxHp,
        radius: u.radius,
        alive: u.alive,
        shield: u.shield || 0
      })),
    projectiles: battle.projectiles.map((p) => ({
      id: p.id,
      ownerSeat: p.ownerSeat,
      kind: p.kind,
      x: p.x,
      y: p.y,
      tx: p.tx,
      ty: p.ty,
      radius: p.radius,
      color: p.color,
      ttl: p.ttl,
      maxTtl: p.maxTtl
    })),
    hazards: battle.hazards.map((h) => ({
      id: h.id,
      ownerSeat: h.ownerSeat,
      kind: h.kind,
      x: h.x,
      y: h.y,
      radius: h.radius,
      ttl: h.ttl,
      color: h.color
    })),
    beams: battle.beams.slice(-16)
  };
}

function ensureSetup(room) {
  if (room.players.length < 2) throw httpError(400, "需要两名玩家。");
  if (room.phase === "lobby") {
    room.phase = "prep";
    room.log.push("对局开始。购买弹球，准备迎战。");
  }
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function buyUnit(player, slot) {
  const itemIndex = player.shop.findIndex((s) => s.slot === slot);
  if (itemIndex < 0) throw httpError(400, "商店槽位不存在。");
  const item = player.shop[itemIndex];
  const cost = unitCost(item.type);
  if (player.gold < cost) throw httpError(400, "金币不足。");
  if (player.bench.length >= 8) throw httpError(400, "备战区已满。");
  player.gold -= cost;
  player.bench.push(makeUnit(item.type));
  player.shop.splice(itemIndex, 1, ...rollShop(1));
  combineUnits(player);
}

function sellUnit(player, unitId) {
  let list = player.bench;
  let index = list.findIndex((u) => u.id === unitId);
  if (index < 0) {
    list = player.board;
    index = list.findIndex((u) => u.id === unitId);
  }
  if (index < 0) throw httpError(400, "弹球不存在。");
  const [unit] = list.splice(index, 1);
  player.gold += Math.max(1, Math.floor(unitCost(unit.type) * (unit.tier === 3 ? 5 : unit.tier === 2 ? 2 : 0.7)));
}

function combineUnits(player) {
  let changed = true;
  while (changed) {
    changed = false;
    for (const tier of [1, 2]) {
      for (const type of UNIT_IDS) {
        const all = [...player.board, ...player.bench].filter((u) => u.type === type && u.tier === tier);
        if (all.length >= 3) {
          const keep = all[0];
          keep.tier += 1;
          removeUnitEverywhere(player, all[1].id);
          removeUnitEverywhere(player, all[2].id);
          changed = true;
          break;
        }
      }
      if (changed) break;
    }
  }
}

function removeUnitEverywhere(player, id) {
  player.board = player.board.filter((u) => u.id !== id);
  player.bench = player.bench.filter((u) => u.id !== id);
}

function moveUnit(player, unitId, target) {
  const fromBoard = player.board.findIndex((u) => u.id === unitId);
  const fromBench = player.bench.findIndex((u) => u.id === unitId);
  if (fromBoard < 0 && fromBench < 0) throw httpError(400, "弹球不存在。");
  const source = fromBoard >= 0 ? player.board : player.bench;
  const unit = source.splice(fromBoard >= 0 ? fromBoard : fromBench, 1)[0];
  if (target === "board") {
    if (player.board.length >= player.maxBoard) {
      source.push(unit);
      throw httpError(400, "上阵数量已达上限。");
    }
    player.board.push(unit);
  } else if (target === "bench") {
    if (player.bench.length >= 8) {
      source.push(unit);
      throw httpError(400, "备战区已满。");
    }
    player.bench.push(unit);
  } else {
    source.push(unit);
    throw httpError(400, "未知目标。");
  }
}

function reroll(player) {
  if (player.gold < 2) throw httpError(400, "金币不足。");
  player.gold -= 2;
  player.shop = rollShop(4);
  player.locked = false;
}

function buyXp(player) {
  if (player.gold < 4) throw httpError(400, "金币不足。");
  player.gold -= 4;
  player.xp += 4;
  while (player.xp >= xpToLevel(player.level) && player.level < 6) {
    player.xp -= xpToLevel(player.level);
    player.level += 1;
    player.maxBoard += 1;
  }
}

function xpToLevel(level) {
  return [0, 4, 7, 10, 14, 999][level] || 999;
}

function chooseRelic(player, relicId) {
  if (!player.relicChoices.length) throw httpError(400, "当前没有可选奖励。");
  const relic = player.relicChoices.find((r) => r.id === relicId);
  if (!relic) throw httpError(400, "奖励不存在。");
  const full = RELICS.find((r) => r.id === relic.id);
  player.relics.push(cloneRelic(full));
  if (full.economy) full.economy(player);
  player.relicChoices = [];
}

function offerRelics(player) {
  if (player.relicChoices.length) return;
  const owned = new Set(player.relics.map((r) => r.id));
  const pool = RELICS.filter((r) => !owned.has(r.id));
  const choices = [];
  while (choices.length < 3 && pool.length) {
    const idx = randInt(pool.length);
    choices.push(cloneRelic(pool.splice(idx, 1)[0]));
  }
  player.relicChoices = choices;
}

function startBattle(room) {
  ensureSetup(room);
  if (room.phase === "battle") throw httpError(400, "战斗已经开始。");
  for (const p of room.players) p.ready = false;
  const battle = makeBattle(room);
  room.phase = "battle";
  room.battle = battle;
  room.log.push(`第 ${room.round} 回合战斗开始。`);
  runBattle(room, battle);
}

function makeBattle(room) {
  const battle = {
    id: uid("b_"),
    round: room.round,
    status: "running",
    elapsed: 0,
    winnerSeat: null,
    units: [],
    projectiles: [],
    hazards: [],
    beams: [],
    events: [],
    pairCooldowns: new Map()
  };
  for (const player of room.players) {
    const lineup = player.board.length ? player.board : player.bench.slice(0, Math.min(1, player.bench.length));
    lineup.forEach((unit, i) => {
      battle.units.push(buildCombatUnit(player, unit, i, lineup.length));
    });
  }
  if (!battle.units.some((u) => u.ownerSeat === 0) || !battle.units.some((u) => u.ownerSeat === 1)) {
    battle.status = "finished";
    battle.winnerSeat = battle.units.some((u) => u.ownerSeat === 0) ? 0 : battle.units.some((u) => u.ownerSeat === 1) ? 1 : null;
  }
  return battle;
}

function buildCombatUnit(player, unit, index, count) {
  const def = UNIT_DEFS[unit.type];
  const mult = tierStatsMultiplier(unit.tier);
  const side = player.seat === 0 ? 1 : -1;
  const row = index - (count - 1) / 2;
  const x = player.seat === 0 ? 95 + (index % 2) * 24 : FIELD.w - 95 - (index % 2) * 24;
  const y = FIELD.h / 2 + row * 62;
  const angle = player.seat === 0 ? (-0.45 + index * 0.3) : (Math.PI + 0.45 - index * 0.3);
  const combat = {
    id: uid("c_"),
    baseId: unit.id,
    type: unit.type,
    name: def.name,
    tier: unit.tier,
    ownerSeat: player.seat,
    color: def.color,
    x,
    y: clamp(y, 65, FIELD.h - 65),
    vx: Math.cos(angle) * def.speed,
    vy: Math.sin(angle) * def.speed,
    speed: def.speed,
    radius: def.radius + (unit.tier - 1) * 1.5,
    hp: def.hp * mult,
    maxHp: def.hp * mult,
    damage: def.damage * mult,
    collisionDamage: (5 + def.damage * 0.45) * mult,
    attackEvery: def.attackEvery,
    attackTimer: Math.random() * 0.7,
    range: 235,
    projectileSpeed: 390,
    extraAttackChance: 0,
    regen: 0,
    thorns: 0,
    poisonPower: 0,
    slow: 0,
    wallStacks: 0,
    wallCharge: false,
    deathExplosion: false,
    alive: true,
    temp: false,
    ttl: 999,
    dots: [],
    slows: []
  };
  for (const relic of player.relics) {
    const full = RELICS.find((r) => r.id === relic.id);
    if (full && full.apply) full.apply(combat);
  }
  combat.hp = combat.maxHp;
  return combat;
}

function runBattle(room, battle) {
  if (room.battleTimer) {
    clearInterval(room.battleTimer);
    room.battleTimer = null;
  }
  if (battle.status !== "running") {
    applyBattleResult(room, battle);
    return;
  }
  room.battleTimer = setInterval(() => {
    stepBattle(battle);
    if (battle.elapsed >= BATTLE_SECONDS && battle.status === "running") finishBattleByHp(battle);
    if (battle.status !== "running") {
      clearInterval(room.battleTimer);
      room.battleTimer = null;
      applyBattleResult(room, battle);
    }
  }, 1000 / TICK_RATE);
  room.battleTimer.unref?.();
}

function livingUnits(battle, seat = null) {
  return battle.units.filter((u) => u.alive && (seat == null || u.ownerSeat === seat));
}

function enemiesOf(battle, unit) {
  return livingUnits(battle).filter((u) => u.ownerSeat !== unit.ownerSeat);
}

function nearestEnemy(battle, unit, range = Infinity) {
  let best = null;
  let bestD = range;
  for (const enemy of enemiesOf(battle, unit)) {
    const d = dist(unit, enemy);
    if (d < bestD) {
      best = enemy;
      bestD = d;
    }
  }
  return best;
}

function stepBattle(battle) {
  battle.elapsed += DT;
  updatePairCooldowns(battle);
  battle.beams = battle.beams.filter((b) => b.ttl > 0).map((b) => ({ ...b, ttl: b.ttl - DT }));
  updateUnits(battle);
  handleCollisions(battle);
  updateHazards(battle);
  updateProjectiles(battle);
  cleanupDead(battle);
  checkBattleEnd(battle);
}

function updatePairCooldowns(battle) {
  for (const [key, value] of battle.pairCooldowns) {
    const next = value - DT;
    if (next <= 0) battle.pairCooldowns.delete(key);
    else battle.pairCooldowns.set(key, next);
  }
}

function updateUnits(battle) {
  for (const unit of battle.units) {
    if (!unit.alive) continue;
    unit.ttl -= DT;
    if (unit.temp && unit.ttl <= 0) {
      unit.alive = false;
      unit.tempExpired = true;
      continue;
    }
    applyStatuses(unit);
    const slowFactor = unit.slows.length ? Math.max(0.45, 1 - Math.max(...unit.slows.map((s) => s.amount))) : 1;
    unit.x += unit.vx * DT * slowFactor;
    unit.y += unit.vy * DT * slowFactor;
    let bounced = false;
    if (unit.x < unit.radius) {
      unit.x = unit.radius;
      unit.vx = Math.abs(unit.vx);
      bounced = true;
    } else if (unit.x > FIELD.w - unit.radius) {
      unit.x = FIELD.w - unit.radius;
      unit.vx = -Math.abs(unit.vx);
      bounced = true;
    }
    if (unit.y < unit.radius) {
      unit.y = unit.radius;
      unit.vy = Math.abs(unit.vy);
      bounced = true;
    } else if (unit.y > FIELD.h - unit.radius) {
      unit.y = FIELD.h - unit.radius;
      unit.vy = -Math.abs(unit.vy);
      bounced = true;
    }
    if (bounced && unit.wallCharge) unit.wallStacks = Math.min(8, unit.wallStacks + 1);
    if (unit.regen) unit.hp = Math.min(unit.maxHp, unit.hp + unit.maxHp * unit.regen * DT);
    unit.attackTimer -= DT * (unit.slows.length ? 0.82 : 1);
    if (unit.attackTimer <= 0) {
      unit.attackTimer += unit.attackEvery;
      performAttack(battle, unit);
      if (Math.random() < unit.extraAttackChance) performAttack(battle, unit, true);
    }
    if (unit.type === "trapper" && Math.random() < 0.055) spawnMine(battle, unit);
    if (unit.type === "orbit") orbitDamage(battle, unit);
  }
}

function applyStatuses(unit) {
  if (unit.dots.length) {
    for (const dot of unit.dots) {
      unit.hp -= dot.dps * DT;
      dot.ttl -= DT;
    }
    unit.dots = unit.dots.filter((d) => d.ttl > 0);
  }
  if (unit.slows.length) {
    for (const slow of unit.slows) slow.ttl -= DT;
    unit.slows = unit.slows.filter((s) => s.ttl > 0);
  }
  if (unit.hp <= 0) unit.alive = false;
}

function performAttack(battle, unit, echo = false) {
  if (!unit.alive) return;
  const target = nearestEnemy(battle, unit, unit.range);
  if (!target) return;
  const damage = unit.damage * (echo ? 0.65 : 1) * (1 + unit.wallStacks * 0.13);
  unit.wallStacks = 0;
  if (unit.type === "laser") {
    fireLaser(battle, unit, target, damage);
  } else if (unit.type === "poison") {
    fireProjectile(battle, unit, target, damage, "poison");
  } else if (unit.type === "frost") {
    fireProjectile(battle, unit, target, damage, "frost");
  } else if (unit.type === "splitter") {
    fireProjectile(battle, unit, target, damage, "split");
  } else if (unit.type === "vampire") {
    fireProjectile(battle, unit, target, damage, "vampire");
  } else {
    fireProjectile(battle, unit, target, damage, "basic");
  }
}

function fireProjectile(battle, unit, target, damage, kind) {
  const dx = target.x - unit.x;
  const dy = target.y - unit.y;
  const len = Math.max(1, Math.sqrt(dx * dx + dy * dy));
  battle.projectiles.push({
    id: uid("pr_"),
    ownerSeat: unit.ownerSeat,
    sourceId: unit.id,
    kind,
    x: unit.x,
    y: unit.y,
    vx: (dx / len) * unit.projectileSpeed,
    vy: (dy / len) * unit.projectileSpeed,
    tx: target.x,
    ty: target.y,
    radius: kind === "split" ? 5 : 4,
    damage,
    ttl: 1.65,
    maxTtl: 1.65,
    color: unit.color
  });
}

function fireLaser(battle, unit, target, damage) {
  const dx = target.x - unit.x;
  const dy = target.y - unit.y;
  const len = Math.max(1, Math.sqrt(dx * dx + dy * dy));
  const nx = dx / len;
  const ny = dy / len;
  const end = { x: unit.x + nx * FIELD.w * 1.3, y: unit.y + ny * FIELD.h * 1.3 };
  let hits = 0;
  for (const enemy of enemiesOf(battle, unit)) {
    const px = enemy.x - unit.x;
    const py = enemy.y - unit.y;
    const along = px * nx + py * ny;
    if (along < -10 || along > FIELD.w * 1.4) continue;
    const perp = Math.abs(px * ny - py * nx);
    if (perp <= enemy.radius + 14) {
      dealDamage(battle, enemy, damage * (hits ? 0.72 : 1), unit);
      hits += 1;
    }
  }
  battle.beams.push({
    id: uid("bm_"),
    ownerSeat: unit.ownerSeat,
    x1: unit.x,
    y1: unit.y,
    x2: end.x,
    y2: end.y,
    color: unit.color,
    ttl: 0.16,
    width: 4 + unit.tier
  });
}

function spawnMine(battle, unit) {
  battle.hazards.push({
    id: uid("hz_"),
    ownerSeat: unit.ownerSeat,
    sourceId: unit.id,
    kind: "mine",
    x: unit.x,
    y: unit.y,
    radius: 21 + unit.tier * 2,
    damage: unit.damage * 1.4,
    ttl: 8,
    color: unit.color
  });
}

function orbitDamage(battle, unit) {
  for (const enemy of enemiesOf(battle, unit)) {
    const d = dist(unit, enemy);
    if (d < 58 + unit.tier * 8) {
      dealDamage(battle, enemy, unit.damage * 0.26 * DT, unit);
    }
  }
}

function handleCollisions(battle) {
  const units = livingUnits(battle);
  for (let i = 0; i < units.length; i += 1) {
    for (let j = i + 1; j < units.length; j += 1) {
      const a = units[i];
      const b = units[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.max(0.1, Math.sqrt(dx * dx + dy * dy));
      const minD = a.radius + b.radius;
      if (d >= minD) continue;
      const nx = dx / d;
      const ny = dy / d;
      const overlap = (minD - d) / 2;
      a.x -= nx * overlap;
      a.y -= ny * overlap;
      b.x += nx * overlap;
      b.y += ny * overlap;
      const avn = a.vx * nx + a.vy * ny;
      const bvn = b.vx * nx + b.vy * ny;
      const impulse = bvn - avn;
      a.vx += impulse * nx;
      a.vy += impulse * ny;
      b.vx -= impulse * nx;
      b.vy -= impulse * ny;
      if (a.ownerSeat !== b.ownerSeat) {
        const key = a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`;
        if (!battle.pairCooldowns.has(key)) {
          const rel = Math.abs(impulse);
          dealDamage(battle, b, a.collisionDamage + rel * 0.025, a);
          dealDamage(battle, a, b.collisionDamage + rel * 0.025, b);
          if (a.thorns) dealDamage(battle, b, a.thorns, a);
          if (b.thorns) dealDamage(battle, a, b.thorns, b);
          if (a.type === "ram") dealDamage(battle, b, a.damage * 0.55, a);
          if (b.type === "ram") dealDamage(battle, a, b.damage * 0.55, b);
          battle.pairCooldowns.set(key, 0.22);
        }
      }
    }
  }
}

function updateProjectiles(battle) {
  const remaining = [];
  for (const p of battle.projectiles) {
    p.ttl -= DT;
    p.x += p.vx * DT;
    p.y += p.vy * DT;
    let hit = false;
    if (p.x < -20 || p.x > FIELD.w + 20 || p.y < -20 || p.y > FIELD.h + 20 || p.ttl <= 0) {
      hit = true;
    } else {
      for (const enemy of livingUnits(battle).filter((u) => u.ownerSeat !== p.ownerSeat)) {
        if (dist(p, enemy) <= enemy.radius + p.radius) {
          applyProjectileHit(battle, p, enemy);
          hit = true;
          break;
        }
      }
    }
    if (!hit) remaining.push(p);
  }
  battle.projectiles = remaining;
}

function applyProjectileHit(battle, p, enemy) {
  const source = battle.units.find((u) => u.id === p.sourceId);
  dealDamage(battle, enemy, p.damage, source);
  if (p.kind === "poison") {
    enemy.dots.push({ dps: p.damage * 0.24, ttl: 4.5 });
  } else if (p.kind === "frost") {
    enemy.slows.push({ amount: 0.33, ttl: 2.8 });
  } else if (p.kind === "split" && source && source.alive) {
    const count = source.tier + 1;
    for (let i = 0; i < count; i += 1) spawnShard(battle, source, enemy, i, count);
  } else if (p.kind === "vampire" && source && source.alive) {
    source.hp = Math.min(source.maxHp, source.hp + p.damage * 0.55);
  }
}

function spawnShard(battle, source, origin, i, count) {
  const angle = (Math.PI * 2 * i) / count + Math.random() * 0.35;
  battle.units.push({
    ...source,
    id: uid("tmp_"),
    name: "裂片",
    type: "shard",
    x: origin.x,
    y: origin.y,
    vx: Math.cos(angle) * (source.speed * 1.2),
    vy: Math.sin(angle) * (source.speed * 1.2),
    radius: Math.max(6, source.radius * 0.55),
    hp: source.maxHp * 0.13,
    maxHp: source.maxHp * 0.13,
    damage: source.damage * 0.34,
    collisionDamage: source.collisionDamage * 0.55,
    attackEvery: 999,
    temp: true,
    ttl: 5.5,
    alive: true,
    dots: [],
    slows: [],
    color: "#86efac"
  });
}

function updateHazards(battle) {
  const remaining = [];
  for (const h of battle.hazards) {
    h.ttl -= DT;
    let triggered = h.ttl <= 0;
    for (const enemy of livingUnits(battle).filter((u) => u.ownerSeat !== h.ownerSeat)) {
      if (dist(h, enemy) <= h.radius + enemy.radius * 0.6) {
        triggered = true;
        break;
      }
    }
    if (triggered) {
      explodeHazard(battle, h);
    } else {
      remaining.push(h);
    }
  }
  battle.hazards = remaining;
}

function explodeHazard(battle, h) {
  const source = battle.units.find((u) => u.id === h.sourceId);
  for (const enemy of livingUnits(battle).filter((u) => u.ownerSeat !== h.ownerSeat)) {
    const d = dist(h, enemy);
    if (d <= h.radius + enemy.radius + 18) {
      dealDamage(battle, enemy, h.damage * (1 - Math.min(0.55, d / (h.radius + 80))), source);
    }
  }
  battle.beams.push({
    id: uid("ex_"),
    ownerSeat: h.ownerSeat,
    x1: h.x - h.radius,
    y1: h.y,
    x2: h.x + h.radius,
    y2: h.y,
    color: h.color,
    ttl: 0.22,
    width: h.radius
  });
}

function dealDamage(battle, target, amount, source) {
  if (!target || !target.alive || amount <= 0) return;
  target.hp -= amount;
  if (target.hp <= 0 && target.alive) {
    target.alive = false;
    battle.events.push({
      t: battle.elapsed,
      kind: "death",
      seat: target.ownerSeat,
      text: `${target.name} 被击毁`
    });
    if (target.deathExplosion) deathExplosion(battle, target, source);
  }
}

function deathExplosion(battle, unit, source) {
  for (const enemy of livingUnits(battle).filter((u) => u.ownerSeat !== unit.ownerSeat)) {
    const d = dist(unit, enemy);
    if (d < 95) dealDamage(battle, enemy, unit.maxHp * 0.16 * (1 - d / 125), source || unit);
  }
  battle.beams.push({
    id: uid("dx_"),
    ownerSeat: unit.ownerSeat,
    x1: unit.x - 55,
    y1: unit.y,
    x2: unit.x + 55,
    y2: unit.y,
    color: "#fb7185",
    ttl: 0.28,
    width: 46
  });
}

function cleanupDead(battle) {
  battle.units = battle.units.filter((u) => u.alive || !u.tempExpired);
}

function checkBattleEnd(battle) {
  const alive0 = livingUnits(battle, 0).length;
  const alive1 = livingUnits(battle, 1).length;
  if (!alive0 || !alive1) {
    battle.status = "finished";
    battle.winnerSeat = alive0 && !alive1 ? 0 : alive1 && !alive0 ? 1 : null;
  }
}

function finishBattleByHp(battle) {
  const hp0 = livingUnits(battle, 0).reduce((sum, u) => sum + u.hp, 0);
  const hp1 = livingUnits(battle, 1).reduce((sum, u) => sum + u.hp, 0);
  battle.status = "finished";
  battle.winnerSeat = Math.abs(hp0 - hp1) < 1 ? null : hp0 > hp1 ? 0 : 1;
}

function applyBattleResult(room, battle) {
  const [a, b] = room.players;
  const loser = battle.winnerSeat === 0 ? b : battle.winnerSeat === 1 ? a : null;
  if (loser) {
    const winner = battle.winnerSeat === 0 ? a : b;
    const damage = 2 + room.round + livingUnits(battle, battle.winnerSeat).length;
    loser.hp = Math.max(0, loser.hp - damage);
    room.log.push(`${winner.name} 赢下第 ${room.round} 回合，${loser.name} 受到 ${damage} 点伤害。`);
  } else {
    room.log.push(`第 ${room.round} 回合平局。`);
  }
  for (const p of room.players) {
    if (p.hp <= 0) continue;
    p.gold += BASE_GOLD + p.bonusGold + Math.min(4, Math.floor(room.round / 3));
    if (p.interest) p.gold += Math.min(4, Math.floor(p.gold / 10));
    p.xp += 2;
    while (p.xp >= xpToLevel(p.level) && p.level < 6) {
      p.xp -= xpToLevel(p.level);
      p.level += 1;
      p.maxBoard += 1;
    }
    if (!p.locked) p.shop = rollShop(4);
    p.locked = false;
    if (room.round === 1 || room.round % 3 === 0) offerRelics(p);
  }
  const defeated = room.players.filter((p) => p.hp <= 0);
  if (defeated.length) {
    room.phase = "gameover";
    const winner = room.players.find((p) => p.hp > 0);
    room.log.push(winner ? `${winner.name} 获得最终胜利。` : "双方同归于尽。");
  } else {
    room.round += 1;
    room.phase = "prep";
  }
}

async function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1e6) {
        req.destroy();
        reject(httpError(413, "请求体过大。"));
      }
    });
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(httpError(400, "JSON 格式错误。"));
      }
    });
  });
}

function sendJson(res, value, status = 200) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(body);
}

function sendStatic(req, res) {
  const url = new URL(req.url, "http://localhost");
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  const file = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(file).toLowerCase();
    const type = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".png": "image/png",
      ".svg": "image/svg+xml"
    }[ext] || "application/octet-stream";
    res.writeHead(200, { "content-type": type });
    res.end(data);
  });
}

async function handleApi(req, res) {
  const url = new URL(req.url, "http://localhost");
  const body = req.method === "POST" ? await parseBody(req) : {};
  if (url.pathname === "/api/create" && req.method === "POST") {
    const { room, player } = makeRoom(body.name);
    sendJson(res, { roomCode: room.code, playerId: player.id, state: stateFor(room, player.id) });
    return;
  }
  if (url.pathname === "/api/join" && req.method === "POST") {
    const room = getRoom(body.roomCode);
    if (!room) throw httpError(404, "房间不存在。");
    if (room.players.length >= 2) throw httpError(400, "房间已满。");
    const player = makePlayer(body.name, room.players.length);
    room.players.push(player);
    ensureSetup(room);
    sendJson(res, { roomCode: room.code, playerId: player.id, state: stateFor(room, player.id) });
    return;
  }
  if (url.pathname === "/api/state" && req.method === "GET") {
    const room = getRoom(url.searchParams.get("roomCode"));
    if (!room) throw httpError(404, "房间不存在。");
    const playerId = url.searchParams.get("playerId");
    const player = getPlayer(room, playerId);
    if (player) player.lastSeen = Date.now();
    sendJson(res, { state: stateFor(room, playerId) });
    return;
  }
  if (url.pathname === "/api/action" && req.method === "POST") {
    const room = getRoom(body.roomCode);
    if (!room) throw httpError(404, "房间不存在。");
    const player = getPlayer(room, body.playerId);
    if (!player) throw httpError(403, "玩家身份无效。");
    player.lastSeen = Date.now();
    if (room.phase === "battle" && body.action !== "state") throw httpError(400, "战斗中不能操作。");
    switch (body.action) {
      case "buy":
        buyUnit(player, body.slot);
        break;
      case "sell":
        sellUnit(player, body.unitId);
        break;
      case "move":
        moveUnit(player, body.unitId, body.target);
        break;
      case "reroll":
        reroll(player);
        break;
      case "xp":
        buyXp(player);
        break;
      case "lock":
        player.locked = !player.locked;
        break;
      case "relic":
        chooseRelic(player, body.relicId);
        break;
      case "ready":
        player.ready = !player.ready;
        if (room.players.length === 2 && room.players.every((p) => p.ready || p.hp <= 0)) startBattle(room);
        break;
      case "start":
        if (player.seat !== 0) throw httpError(403, "只有房主可以强制开始。");
        startBattle(room);
        break;
      default:
        throw httpError(400, "未知操作。");
    }
    sendJson(res, { state: stateFor(room, player.id) });
    return;
  }
  throw httpError(404, "接口不存在。");
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url.startsWith("/api/")) {
      await handleApi(req, res);
    } else {
      sendStatic(req, res);
    }
  } catch (err) {
    sendJson(res, { error: err.message || "服务器错误。" }, err.status || 500);
  }
});

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (now - room.createdAt > 1000 * 60 * 60 * 8) rooms.delete(code);
  }
}, 1000 * 60 * 10).unref();

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Rogue Pinball Autobattler running at http://localhost:${PORT}`);
});
