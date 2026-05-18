const storeKey = "rikka-online-session";

const state = {
  code: "",
  playerId: "",
  revision: 0,
  data: null,
  polling: null,
  busy: false
};

const $ = selector => document.querySelector(selector);

const els = {
  entry: $('[data-view="entry"]'),
  game: $('[data-view="game"]'),
  createForm: $("#createForm"),
  joinForm: $("#joinForm"),
  roomCode: $("#roomCode"),
  phaseText: $("#phaseText"),
  turnText: $("#turnText"),
  targetText: $("#targetText"),
  playerCount: $("#playerCount"),
  players: $("#players"),
  lobbyPanel: $("#lobbyPanel"),
  roundEndPanel: $("#roundEndPanel"),
  ronPanel: $("#ronPanel"),
  targetScore: $("#targetScore"),
  optionalPatterns: $("#optionalPatterns"),
  riichiRule: $("#riichiRule"),
  ronRule: $("#ronRule"),
  saveOptionsBtn: $("#saveOptionsBtn"),
  readyBtn: $("#readyBtn"),
  startBtn: $("#startBtn"),
  nextRoundBtn: $("#nextRoundBtn"),
  resetBtn: $("#resetBtn"),
  copyLinkBtn: $("#copyLinkBtn"),
  declareBtn: $("#declareBtn"),
  riichiBtn: $("#riichiBtn"),
  claimRonBtn: $("#claimRonBtn"),
  passRonBtn: $("#passRonBtn"),
  tableTiles: $("#tableTiles"),
  discard: $("#discard"),
  hand: $("#hand"),
  handHint: $("#handHint"),
  patternBadges: $("#patternBadges"),
  rules: $("#rules"),
  log: $("#log"),
  deckInfo: $("#deckInfo"),
  resultTitle: $("#resultTitle"),
  resultDetail: $("#resultDetail"),
  ronTitle: $("#ronTitle"),
  ronDetail: $("#ronDetail"),
  toast: $("#toast")
};

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.remove("hidden");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => els.toast.classList.add("hidden"), 2200);
}

function saveSession() {
  if (!state.code || !state.playerId) return;
  localStorage.setItem(storeKey, JSON.stringify({ code: state.code, playerId: state.playerId }));
}

function clearSession() {
  localStorage.removeItem(storeKey);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "请求失败");
  return body;
}

async function action(type, payload = {}) {
  if (state.busy) return;
  state.busy = true;
  try {
    const body = await api("/api/action", {
      method: "POST",
      body: JSON.stringify({
        code: state.code,
        playerId: state.playerId,
        type,
        payload
      })
    });
    applyState(body);
  } catch (error) {
    toast(error.message);
  } finally {
    state.busy = false;
  }
}

function applyState(payload) {
  state.code = payload.code;
  state.playerId = payload.playerId;
  state.revision = payload.revision;
  state.data = payload.state;
  saveSession();
  render();
}

function phaseName(phase) {
  return {
    lobby: "大厅",
    playing: "进行中",
    ron: "直击确认",
    roundEnd: "本局结束"
  }[phase] || phase;
}

function colorFor(number) {
  return {
    1: "var(--red)",
    2: "#d95f26",
    3: "var(--gold)",
    4: "var(--green)",
    5: "var(--blue)",
    6: "var(--accent-2)"
  }[number] || "var(--accent)";
}

function glyphFor(number) {
  return {
    1: "●",
    2: "◆",
    3: "✤",
    4: "✦",
    5: "✽",
    6: "✿"
  }[number] || "?";
}

function tileHtml(tile, clickable = false, label = "", slotId = "") {
  if (!tile || tile.hidden) {
    const action = clickable ? `<button type="button" aria-label="${escapeHtml(label || "拿取暗牌")}"></button>` : "";
    return `<div class="tile hidden-tile${clickable ? " clickable" : ""}" data-slot-id="${slotId}" aria-label="暗牌">${action}</div>`;
  }
  const action = clickable ? `<button type="button" aria-label="${escapeHtml(label || "选择牌")}"></button>` : "";
  return `
    <div class="tile${clickable ? " clickable" : ""}" data-tile-id="${tile.id}" data-slot-id="${slotId}" style="--tile-color:${colorFor(tile.top)}">
      ${tile.glow ? '<span class="glow">★</span>' : ""}
      <span class="num">${glyphFor(tile.top)}</span>
      <span class="tile-mid"></span>
      <span class="num" style="background:${colorFor(tile.bottom)}">${glyphFor(tile.bottom)}</span>
      ${action}
    </div>
  `;
}

function renderPlayers(data) {
  els.playerCount.textContent = `${data.players.length}/5`;
  els.players.innerHTML = data.players
    .map(player => `
      <div class="player${player.isCurrent ? " current" : ""}">
        <div class="player-name">${escapeHtml(player.name)}${player.isMe ? "（你）" : ""}</div>
        <div class="player-score">${player.score}</div>
        <div class="player-meta">
          <span>${player.handCount} 张手牌</span>
          <span>${player.online ? "在线" : "离线"}${player.ready ? " · 已准备" : ""}${player.riichi ? " · 立直" : ""}</span>
        </div>
      </div>
    `)
    .join("");
}

function renderRules(data) {
  const enabled = data.options.optionalPatterns
    ? data.patterns
    : data.basePatterns;
  const baseRules = `
    <article class="rule">
      <strong><span>流程</span><span>5→6→5</span></strong>
      <p>每人 5 张手牌。轮到你时从场上拿 1 张，若 6 张成型可完成，否则弃 1 张回到场上成为明牌。</p>
    </article>
    <article class="rule">
      <strong><span>计分</span><span>10 分</span></strong>
      <p>完成时按牌型分数得分，辉光牌通常额外 +1；直击从弃牌者处取得分数。达到目标分或每人起始 2 局后结束。</p>
    </article>
  `;
  els.rules.innerHTML = baseRules + enabled
    .map(pattern => `
      <article class="rule">
        <strong><span>${pattern.name}</span><span>${pattern.score} 分</span></strong>
        <p>${pattern.description}</p>
      </article>
    `)
    .join("");
}

function renderTable(data) {
  const canDraw = data.me && data.me.canDraw;
  els.deckInfo.textContent = `暗牌 ${data.deckCount} · 明牌 ${data.discardCount}`;
  els.tableTiles.innerHTML = data.table
    .map(slot => slot.empty ? '<div class="tile hidden-tile"></div>' : tileHtml(slot.tile, canDraw, slot.faceUp ? "拿取这张明牌" : "拿取这张暗牌", slot.slotId))
    .join("");
  els.tableTiles.querySelectorAll(".tile.clickable").forEach(node => {
    node.addEventListener("click", () => action("drawTable", { slotId: node.dataset.slotId }));
  });
  els.discard.innerHTML = data.discard.length
    ? data.discard.map(tile => tileHtml(tile)).join("")
    : '<span class="eyebrow">暂无弃牌</span>';
}

function renderHand(data) {
  const me = data.me;
  if (!me) return;
  els.handHint.textContent = me.canDraw
    ? "从场上任意选择一张牌"
    : me.canDeclare
      ? "已成型，可以完成"
      : me.canDiscard
        ? "选择一张牌弃出"
        : "等待其他玩家";
  els.hand.innerHTML = me.hand
    .map(tile => tileHtml(tile, me.canDiscard, "弃出这张牌"))
    .join("");
  els.hand.querySelectorAll(".tile.clickable").forEach(node => {
    node.addEventListener("click", () => action("discard", { tileId: node.dataset.tileId }));
  });
  els.patternBadges.innerHTML = me.winningPatterns.length
    ? me.winningPatterns.map(pattern => `<span class="badge">${pattern.name} ${pattern.score}分</span>`).join("")
    : "";
  els.declareBtn.disabled = !me.canDeclare;
  els.riichiBtn.disabled = !me.canRiichi;
}

function renderPanels(data) {
  els.lobbyPanel.classList.toggle("hidden", data.phase !== "lobby");
  els.roundEndPanel.classList.toggle("hidden", data.phase !== "roundEnd");
  els.ronPanel.classList.toggle("hidden", data.phase !== "ron");

  if (data.phase === "lobby") {
    els.targetScore.value = data.options.targetScore;
    els.optionalPatterns.checked = data.options.optionalPatterns;
    els.riichiRule.checked = data.options.riichi;
    els.ronRule.checked = data.options.ron;
    const me = data.players.find(player => player.isMe);
    els.readyBtn.textContent = me && me.ready ? "取消准备" : "准备";
    els.saveOptionsBtn.disabled = !data.isHost;
    els.startBtn.disabled = !data.isHost || data.players.length < 2;
  }

  if (data.phase === "roundEnd" && data.roundWinner) {
    const result = data.roundWinner;
    els.resultTitle.textContent = result.playerId ? `${result.playerName} 完成` : "流局";
    const incidental = result.incidental && result.incidental.length
      ? ` 顺带完成：${result.incidental.map(item => `${item.playerName}「${item.pattern.name}」+${item.pattern.score}`).join("，")}。`
      : "";
    els.resultDetail.textContent = result.playerId
      ? `${result.loserName ? `直击 ${result.loserName}，` : ""}${result.pattern.name}，获得 ${result.total} 分。${incidental}${result.matchOver ? ` ${result.leaderName} 获胜，整场结束。` : ""}`
      : `无人完成。${result.matchOver ? ` ${result.leaderName} 获胜，整场结束。` : ""}`;
    els.nextRoundBtn.disabled = !data.isHost || result.matchOver;
    els.resetBtn.disabled = !data.isHost;
  }

  if (data.phase === "ron") {
    const last = data.lastDiscard;
    const pattern = data.me && data.me.ronPattern;
    els.ronTitle.textContent = last ? `${last.fromName} 弃出了一张牌` : "直击确认";
    els.ronDetail.textContent = pattern
      ? `你可以用这张牌组成「${pattern.name}」。直击会从弃牌者处取得该牌型分数。`
      : "等待其他玩家决定是否直击。";
    els.claimRonBtn.disabled = !pattern;
    els.passRonBtn.disabled = data.me && data.me.hasPassedRon;
  }
}

function renderLog(data) {
  els.log.innerHTML = data.log
    .slice(0, 18)
    .map(item => `<span>${escapeHtml(item.text)}</span>`)
    .join("");
}

function render() {
  const data = state.data;
  if (!data) return;
  els.entry.classList.add("hidden");
  els.game.classList.remove("hidden");
  els.roomCode.textContent = state.code;
  els.phaseText.textContent = phaseName(data.phase);
  els.turnText.textContent = data.currentPlayerName || "等待开始";
  els.targetText.textContent = `${data.options.targetScore}分`;
  renderPlayers(data);
  renderRules(data);
  renderPanels(data);
  renderTable(data);
  renderHand(data);
  renderLog(data);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function bind() {
  els.createForm.addEventListener("submit", async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const payload = await api("/api/create", {
        method: "POST",
        body: JSON.stringify({ name: form.get("name") })
      });
      applyState(payload);
      startPolling();
    } catch (error) {
      toast(error.message);
    }
  });

  els.joinForm.addEventListener("submit", async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const payload = await api("/api/join", {
        method: "POST",
        body: JSON.stringify({ code: form.get("code"), name: form.get("name") })
      });
      applyState(payload);
      startPolling();
    } catch (error) {
      toast(error.message);
    }
  });

  els.saveOptionsBtn.addEventListener("click", () => action("setOptions", {
    targetScore: els.targetScore.value,
    optionalPatterns: els.optionalPatterns.checked,
    riichi: els.riichiRule.checked,
    ron: els.ronRule.checked
  }));
  els.readyBtn.addEventListener("click", () => {
    const me = state.data.players.find(player => player.isMe);
    action(me && me.ready ? "unready" : "ready");
  });
  els.startBtn.addEventListener("click", () => action("start"));
  els.declareBtn.addEventListener("click", () => {
    const pattern = state.data.me.winningPatterns[0];
    action("declareWin", { patternId: pattern && pattern.id });
  });
  els.riichiBtn.addEventListener("click", () => action("declareRiichi"));
  els.claimRonBtn.addEventListener("click", () => action("claimRon"));
  els.passRonBtn.addEventListener("click", () => action("passRon"));
  els.nextRoundBtn.addEventListener("click", () => action("nextRound"));
  els.resetBtn.addEventListener("click", () => action("reset"));
  els.copyLinkBtn.addEventListener("click", async () => {
    const url = `${location.origin}${location.pathname}?room=${state.code}`;
    await navigator.clipboard.writeText(`六华房间 ${state.code}：${url}`);
    toast("邀请信息已复制");
  });
}

async function poll() {
  if (!state.code || !state.playerId) return;
  try {
    const payload = await api(`/api/state?code=${encodeURIComponent(state.code)}&playerId=${encodeURIComponent(state.playerId)}`);
    applyState(payload);
  } catch (error) {
    clearSession();
    toast(error.message);
    stopPolling();
  }
}

function startPolling() {
  stopPolling();
  state.polling = setInterval(poll, 1200);
}

function stopPolling() {
  if (state.polling) clearInterval(state.polling);
  state.polling = null;
}

async function restore() {
  const roomFromUrl = new URLSearchParams(location.search).get("room");
  if (roomFromUrl) {
    els.joinForm.elements.code.value = roomFromUrl.toUpperCase();
  }
  const raw = localStorage.getItem(storeKey);
  if (!raw) return;
  try {
    const saved = JSON.parse(raw);
    if (!saved.code || !saved.playerId) return;
    state.code = saved.code;
    state.playerId = saved.playerId;
    await poll();
    startPolling();
  } catch {
    clearSession();
  }
}

bind();
restore();
