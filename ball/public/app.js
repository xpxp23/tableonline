const els = {
  joinPanel: document.getElementById("joinPanel"),
  gamePanel: document.getElementById("gamePanel"),
  nameInput: document.getElementById("nameInput"),
  roomInput: document.getElementById("roomInput"),
  createBtn: document.getElementById("createBtn"),
  joinBtn: document.getElementById("joinBtn"),
  roomCode: document.getElementById("roomCode"),
  phaseTitle: document.getElementById("phaseTitle"),
  players: document.getElementById("players"),
  resources: document.getElementById("resources"),
  board: document.getElementById("board"),
  bench: document.getElementById("bench"),
  shop: document.getElementById("shop"),
  relicChoices: document.getElementById("relicChoices"),
  relics: document.getElementById("relics"),
  rerollBtn: document.getElementById("rerollBtn"),
  xpBtn: document.getElementById("xpBtn"),
  lockBtn: document.getElementById("lockBtn"),
  readyBtn: document.getElementById("readyBtn"),
  arena: document.getElementById("arena"),
  battleFeed: document.getElementById("battleFeed"),
  toast: document.getElementById("toast")
};

const ctx = els.arena.getContext("2d");
const local = {
  roomCode: window.localStorage.getItem("pinball_room") || "",
  playerId: window.localStorage.getItem("pinball_player") || "",
  name: window.localStorage.getItem("pinball_name") || "",
  state: null,
  lastPoll: 0,
  toastTimer: null
};

els.nameInput.value = local.name;
els.roomInput.value = local.roomCode;

function saveSession(roomCode, playerId) {
  local.roomCode = roomCode;
  local.playerId = playerId;
  window.localStorage.setItem("pinball_room", roomCode);
  window.localStorage.setItem("pinball_player", playerId);
  window.localStorage.setItem("pinball_name", els.nameInput.value.trim());
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.remove("hidden");
  clearTimeout(local.toastTimer);
  local.toastTimer = setTimeout(() => els.toast.classList.add("hidden"), 2400);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "请求失败");
  return data;
}

async function createRoom() {
  try {
    const data = await api("/api/create", {
      method: "POST",
      body: JSON.stringify({ name: els.nameInput.value })
    });
    saveSession(data.roomCode, data.playerId);
    setState(data.state);
  } catch (err) {
    showToast(err.message);
  }
}

async function joinRoom() {
  try {
    const data = await api("/api/join", {
      method: "POST",
      body: JSON.stringify({ name: els.nameInput.value, roomCode: els.roomInput.value })
    });
    saveSession(data.roomCode, data.playerId);
    setState(data.state);
  } catch (err) {
    showToast(err.message);
  }
}

async function poll() {
  if (!local.roomCode || !local.playerId) return;
  try {
    const data = await api(`/api/state?roomCode=${encodeURIComponent(local.roomCode)}&playerId=${encodeURIComponent(local.playerId)}`);
    setState(data.state);
  } catch (err) {
    if (!local.state) return;
    showToast(err.message);
  }
}

async function action(name, payload = {}) {
  if (!local.state) return;
  try {
    const data = await api("/api/action", {
      method: "POST",
      body: JSON.stringify({
        roomCode: local.roomCode,
        playerId: local.playerId,
        action: name,
        ...payload
      })
    });
    setState(data.state);
  } catch (err) {
    showToast(err.message);
  }
}

function setState(state) {
  local.state = state;
  els.joinPanel.classList.add("hidden");
  els.gamePanel.classList.remove("hidden");
  render();
}

function me() {
  return local.state?.players.find((p) => p.id === local.playerId);
}

function opponent() {
  return local.state?.players.find((p) => p.id !== local.playerId);
}

function phaseName(phase) {
  return {
    lobby: "等待玩家",
    prep: "准备阶段",
    battle: "自动战斗",
    gameover: "对局结束"
  }[phase] || phase;
}

function render() {
  const state = local.state;
  if (!state) return;
  const self = me();
  els.roomCode.textContent = state.code;
  els.phaseTitle.textContent = `第 ${state.round} 回合 · ${phaseName(state.phase)}`;
  renderPlayers(state);
  renderResources(self);
  renderUnits(self);
  renderShop(self);
  renderRelics(self);
  renderFeed(state);
  const disabled = state.phase !== "prep";
  for (const btn of [els.rerollBtn, els.xpBtn, els.lockBtn, els.readyBtn]) btn.disabled = disabled || state.phase === "gameover";
  els.lockBtn.textContent = self?.locked ? "已锁定" : "锁定";
  els.readyBtn.textContent = self?.ready ? "取消准备" : "准备";
}

function renderPlayers(state) {
  els.players.innerHTML = "";
  for (const p of state.players) {
    const div = document.createElement("div");
    div.className = "player-pill";
    const hpPct = Math.max(0, Math.min(100, (p.hp / 30) * 100));
    div.innerHTML = `
      <div class="player-line"><span>${escapeHtml(p.name)}${p.id === local.playerId ? " · 你" : ""}</span><span>${p.hp} HP</span></div>
      <div class="hpbar"><span style="width:${hpPct}%"></span></div>
      <div class="desc">等级 ${p.level} · 上阵 ${p.board.length}/${p.maxBoard}${p.ready ? " · 已准备" : ""}</div>
    `;
    els.players.appendChild(div);
  }
  if (state.players.length < 2) {
    const div = document.createElement("div");
    div.className = "player-pill";
    div.innerHTML = `<div class="player-line"><span>等待对手</span><span>${state.code}</span></div><div class="desc">把房间码发给另一名玩家。</div>`;
    els.players.appendChild(div);
  }
}

function renderResources(self) {
  if (!self) return;
  els.resources.textContent = `金币 ${self.gold} · 等级 ${self.level} · 经验 ${self.xp}`;
}

function renderUnits(self) {
  els.board.innerHTML = "";
  els.bench.innerHTML = "";
  if (!self) return;
  for (const unit of self.board) els.board.appendChild(unitCard(unit, "board"));
  for (const unit of self.bench) els.bench.appendChild(unitCard(unit, "bench"));
  if (!self.board.length) els.board.appendChild(emptyLine(`上阵弹球会自动战斗，当前上限 ${self.maxBoard}`));
  if (!self.bench.length) els.bench.appendChild(emptyLine("购买后先进入备战区"));
}

function unitCard(unit, zone) {
  const def = local.state.defs.units[unit.type];
  const div = document.createElement("div");
  div.className = "unit-card";
  div.innerHTML = `
    <div class="ball-icon" style="background:${def.color}">${def.icon || def.name[0]}</div>
    <div>
      <div class="unit-name"><span>${def.name}</span><span>${"★".repeat(unit.tier)}</span></div>
      <div class="desc">${def.tags.join(" / ")}</div>
      <div class="unit-actions">
        <button data-act="move">${zone === "board" ? "下阵" : "上阵"}</button>
        <button data-act="sell">出售</button>
      </div>
    </div>
  `;
  div.querySelector('[data-act="move"]').addEventListener("click", () => action("move", { unitId: unit.id, target: zone === "board" ? "bench" : "board" }));
  div.querySelector('[data-act="sell"]').addEventListener("click", () => action("sell", { unitId: unit.id }));
  return div;
}

function emptyLine(text) {
  const div = document.createElement("div");
  div.className = "desc";
  div.textContent = text;
  return div;
}

function renderShop(self) {
  els.shop.innerHTML = "";
  if (!self) return;
  for (const item of self.shop) {
    const def = local.state.defs.units[item.type];
    const div = document.createElement("div");
    div.className = "shop-card";
    div.innerHTML = `
      <div class="ball-icon" style="background:${def.color}">${def.icon}</div>
      <div class="card-title"><span>${def.name}</span><span class="cost">${def.cost}</span></div>
      <div class="desc">${def.text}</div>
      <button ${self.gold < def.cost ? "disabled" : ""}>购买</button>
    `;
    div.querySelector("button").addEventListener("click", () => action("buy", { slot: item.slot }));
    els.shop.appendChild(div);
  }
}

function renderRelics(self) {
  els.relicChoices.innerHTML = "";
  els.relics.innerHTML = "";
  if (!self) return;
  if (self.relicChoices.length) {
    for (const relic of self.relicChoices) {
      const card = relicCard(relic, true);
      card.addEventListener("click", () => action("relic", { relicId: relic.id }));
      els.relicChoices.appendChild(card);
    }
  } else {
    const p = emptyLine("第 1 回合后以及每 3 回合获得一次三选一强化。");
    els.relicChoices.appendChild(p);
  }
  for (const relic of self.relics) els.relics.appendChild(relicCard(relic, false));
}

function relicCard(relic, choice) {
  const div = document.createElement("div");
  div.className = "relic-card";
  div.innerHTML = `<strong>${escapeHtml(relic.name)}${choice ? " · 选择" : ""}</strong><p>${escapeHtml(relic.text || "")}</p>`;
  return div;
}

function renderFeed(state) {
  els.battleFeed.innerHTML = "";
  const lines = state.battle?.events?.slice(-4).map((e) => e.text) || state.log.slice(-4);
  for (const line of lines) {
    const div = document.createElement("div");
    div.textContent = line;
    els.battleFeed.appendChild(div);
  }
}

function draw() {
  const state = local.state;
  const w = els.arena.width;
  const h = els.arena.height;
  ctx.clearRect(0, 0, w, h);
  drawBackdrop(w, h);
  if (state?.phase === "battle" && state.battle) {
    drawBattle(state.battle, state.defs.field, w, h);
  } else {
    drawPreview(state, w, h);
  }
  requestAnimationFrame(draw);
}

function fieldTransform(field, w, h) {
  const size = Math.min(w - 56, h - 56);
  const ox = (w - size) / 2;
  const oy = (h - size) / 2;
  return { s: size / field.w, ox, oy, size };
}

function drawBackdrop(w, h) {
  ctx.fillStyle = "#0b0e11";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  ctx.lineWidth = 1;
  for (let x = 0; x < w; x += 34) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y < h; y += 34) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
}

function drawBattle(battle, field, w, h) {
  const t = fieldTransform(field, w, h);
  drawField(t);
  for (const hazard of battle.hazards) drawHazard(hazard, t);
  for (const beam of battle.beams) drawBeam(beam, t);
  for (const projectile of battle.projectiles) drawProjectile(projectile, t);
  for (const unit of battle.units) drawUnit(unit, t);
  drawBattleHud(battle, t);
}

function drawField(t) {
  ctx.save();
  ctx.translate(t.ox, t.oy);
  ctx.fillStyle = "#11171c";
  ctx.fillRect(0, 0, t.size, t.size);
  ctx.strokeStyle = "#4b5563";
  ctx.lineWidth = 5;
  ctx.strokeRect(0, 0, t.size, t.size);
  ctx.strokeStyle = "rgba(61,220,132,0.16)";
  ctx.lineWidth = 1;
  for (let i = 1; i < 8; i += 1) {
    const p = (t.size / 8) * i;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, t.size);
    ctx.moveTo(0, p);
    ctx.lineTo(t.size, p);
    ctx.stroke();
  }
  ctx.restore();
}

function drawUnit(unit, t) {
  const x = t.ox + unit.x * t.s;
  const y = t.oy + unit.y * t.s;
  const r = Math.max(5, unit.radius * t.s);
  ctx.save();
  ctx.globalAlpha = unit.alive ? 1 : 0.28;
  ctx.beginPath();
  ctx.arc(x, y, r + 4, 0, Math.PI * 2);
  ctx.fillStyle = unit.ownerSeat === 0 ? "rgba(61,220,132,0.18)" : "rgba(251,93,93,0.18)";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = unit.color;
  ctx.fill();
  ctx.strokeStyle = unit.ownerSeat === 0 ? "#7bf0ad" : "#ff9b9b";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = "#081015";
  ctx.font = `${Math.max(11, r)}px Segoe UI`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(unit.name[0], x, y + 0.5);
  const hpw = r * 2.3;
  const pct = Math.max(0, unit.hp / unit.maxHp);
  ctx.fillStyle = "#2b1114";
  ctx.fillRect(x - hpw / 2, y - r - 12, hpw, 5);
  ctx.fillStyle = pct > 0.5 ? "#3ddc84" : pct > 0.25 ? "#f5c542" : "#fb5d5d";
  ctx.fillRect(x - hpw / 2, y - r - 12, hpw * pct, 5);
  ctx.restore();
}

function drawProjectile(p, t) {
  const x = t.ox + p.x * t.s;
  const y = t.oy + p.y * t.s;
  ctx.save();
  ctx.globalAlpha = Math.max(0.25, p.ttl / p.maxTtl);
  ctx.beginPath();
  ctx.arc(x, y, Math.max(3, p.radius * t.s), 0, Math.PI * 2);
  ctx.fillStyle = p.color;
  ctx.fill();
  ctx.restore();
}

function drawHazard(h, t) {
  const x = t.ox + h.x * t.s;
  const y = t.oy + h.y * t.s;
  const r = h.radius * t.s;
  ctx.save();
  ctx.globalAlpha = 0.25 + Math.sin(performance.now() / 160) * 0.08;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = h.color;
  ctx.fill();
  ctx.globalAlpha = 0.85;
  ctx.strokeStyle = h.color;
  ctx.setLineDash([5, 5]);
  ctx.stroke();
  ctx.restore();
}

function drawBeam(b, t) {
  ctx.save();
  ctx.globalAlpha = Math.max(0, b.ttl / 0.28);
  ctx.strokeStyle = b.color;
  ctx.lineWidth = b.width * t.s;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(t.ox + b.x1 * t.s, t.oy + b.y1 * t.s);
  ctx.lineTo(t.ox + b.x2 * t.s, t.oy + b.y2 * t.s);
  ctx.stroke();
  ctx.restore();
}

function drawBattleHud(battle, t) {
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fillRect(t.ox, t.oy + t.size - 30, t.size, 30);
  ctx.fillStyle = "#d9e4ec";
  ctx.font = "14px Segoe UI";
  ctx.textAlign = "center";
  const seconds = Math.max(0, 55 - battle.elapsed).toFixed(1);
  const status = battle.status === "finished" ? resultText(battle.winnerSeat) : `剩余 ${seconds}s`;
  ctx.fillText(status, t.ox + t.size / 2, t.oy + t.size - 11);
}

function resultText(winnerSeat) {
  if (winnerSeat == null) return "平局";
  const player = local.state.players.find((p) => p.seat === winnerSeat);
  return `${player?.name || "玩家"} 获胜`;
}

function drawPreview(state, w, h) {
  const field = state?.defs?.field || { w: 520, h: 520 };
  const t = fieldTransform(field, w, h);
  drawField(t);
  const self = me();
  const other = opponent();
  drawPreviewSide(self, 0, t);
  drawPreviewSide(other, 1, t);
  ctx.fillStyle = "#d9e4ec";
  ctx.font = "16px Segoe UI";
  ctx.textAlign = "center";
  const text = state?.phase === "lobby" ? "等待第二名玩家加入" : "准备阵容后点击准备";
  ctx.fillText(text, t.ox + t.size / 2, t.oy + t.size / 2);
}

function drawPreviewSide(player, seat, t) {
  if (!player) return;
  const units = player.board || [];
  units.forEach((unit, i) => {
    const def = local.state.defs.units[unit.type];
    const x = seat === 0 ? 95 + (i % 2) * 24 : 520 - 95 - (i % 2) * 24;
    const y = 260 + (i - (units.length - 1) / 2) * 62;
    drawUnit({
      name: def.name,
      ownerSeat: seat,
      color: def.color,
      x,
      y,
      hp: 1,
      maxHp: 1,
      radius: def.radius + (unit.tier - 1) * 1.5,
      alive: true
    }, t);
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

els.createBtn.addEventListener("click", createRoom);
els.joinBtn.addEventListener("click", joinRoom);
els.rerollBtn.addEventListener("click", () => action("reroll"));
els.xpBtn.addEventListener("click", () => action("xp"));
els.lockBtn.addEventListener("click", () => action("lock"));
els.readyBtn.addEventListener("click", () => action("ready"));

window.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !local.state) {
    if (els.roomInput.value.trim()) joinRoom();
    else createRoom();
  }
});

setInterval(poll, 350);
requestAnimationFrame(draw);
if (local.roomCode && local.playerId) poll();
