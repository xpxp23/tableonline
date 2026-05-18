"use strict";

const SESSION_KEY = "lovecraft-letter-session-v1";

let session = readSession();
let state = null;
let source = null;
let selectedCardUid = null;
let selectedMode = "sane";
let lastError = "";

const app = document.getElementById("app");

init();

function init() {
  bindEvents();
  if (session) {
    fetchState()
      .then(() => connectEvents())
      .catch((error) => {
        lastError = error.message;
        session = null;
        writeSession(null);
        render();
      });
  } else {
    render();
  }
}

function readSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
  } catch {
    return null;
  }
}

function writeSession(value) {
  if (!value) {
    localStorage.removeItem(SESSION_KEY);
    return;
  }
  localStorage.setItem(SESSION_KEY, JSON.stringify(value));
}

async function api(path, payload) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {})
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    throw new Error(data.error || "请求失败。");
  }
  return data;
}

async function fetchState() {
  if (!session) return;
  state = await api("/api/state", session);
  render();
}

function connectEvents() {
  if (!session) return;
  if (source) source.close();
  const params = new URLSearchParams({
    room: session.roomId,
    player: session.playerId,
    token: session.token
  });
  source = new EventSource(`/events?${params.toString()}`);
  source.addEventListener("state", (event) => {
    state = JSON.parse(event.data);
    lastError = "";
    render();
  });
  source.onerror = () => {
    lastError = "实时连接暂时中断，正在尝试重连。";
    render();
  };
}

function bindEvents() {
  document.addEventListener("submit", async (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    event.preventDefault();
    try {
      if (form.id === "createForm") {
        const name = form.elements.name.value;
        const data = await api("/api/create", { name });
        session = data;
        writeSession(session);
        await fetchState();
        connectEvents();
      }
      if (form.id === "joinForm") {
        const name = form.elements.name.value;
        const roomId = form.elements.roomId.value.trim().toUpperCase();
        const data = await api("/api/join", { name, roomId });
        session = data;
        writeSession(session);
        await fetchState();
        connectEvents();
      }
      if (form.id === "actionForm") {
        await submitCardAction(form);
      }
      if (form.id === "redistributeForm") {
        await submitRedistribute(form);
      }
    } catch (error) {
      lastError = error.message;
      render();
    }
  });

  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action], [data-select-card]");
    if (!button) return;
    try {
      const selectCard = button.getAttribute("data-select-card");
      if (selectCard) {
        selectedCardUid = selectCard;
        selectedMode = "sane";
        render();
        return;
      }

      const action = button.getAttribute("data-action");
      if (action === "start") {
        await api("/api/start", session);
      }
      if (action === "nextRound") {
        await api("/api/next-round", session);
      }
      if (action === "restart") {
        await api("/api/restart", session);
      }
      if (action === "leave") {
        if (source) source.close();
        session = null;
        state = null;
        selectedCardUid = null;
        writeSession(null);
        render();
      }
      if (["start", "nextRound", "restart"].includes(action)) {
        await fetchState();
      }
    } catch (error) {
      lastError = error.message;
      render();
    }
  });

  document.addEventListener("change", (event) => {
    const target = event.target;
    if (target.name === "mode") {
      selectedMode = target.value;
      render();
    }
  });
}

async function submitCardAction(form) {
  const formData = new FormData(form);
  const cardUid = String(formData.get("cardUid") || "");
  const mode = String(formData.get("mode") || "sane");
  const params = {};
  if (formData.get("targetId")) params.targetId = String(formData.get("targetId"));
  if (formData.get("guess")) params.guess = Number(formData.get("guess"));
  await api("/api/action", {
    ...session,
    action: "discard",
    cardUid,
    mode,
    params
  });
  selectedCardUid = null;
  selectedMode = "sane";
}

async function submitRedistribute(form) {
  const assignments = {};
  for (const target of state.pending.targets) {
    const select = form.elements[`target_${target.id}`];
    assignments[target.id] = select.value;
  }
  await api("/api/action", {
    ...session,
    action: "redistribute",
    assignments
  });
}

function render() {
  if (!session || !state) {
    app.innerHTML = renderEntry();
    return;
  }

  normalizeSelection();
  if (state.phase === "lobby") {
    app.innerHTML = renderShell(renderLobby());
    return;
  }

  app.innerHTML = renderShell(renderGame());
}

function renderEntry() {
  return `
    <main class="entry">
      <section class="entry-panel">
        <div class="entry-visual">
          <div class="entry-copy">
            <h1>洛夫克拉夫特情书</h1>
            <p>中文在线房间版。创建房间后共享房间码即可开始，服务器只保存当前内存中的牌局状态。</p>
          </div>
          <div class="sigil-board"><div class="sigil-core"></div></div>
          <p class="small">非官方网页实现，不含官方美术或说明书原文。</p>
        </div>
        <div class="entry-forms">
          <div class="form-stack">
            <form id="createForm" class="form-box">
              <h2>创建房间</h2>
              <label class="field">
                <span>你的名字</span>
                <input name="name" maxlength="16" required placeholder="例如：阿米蒂奇">
              </label>
              <button class="primary" type="submit">创建</button>
            </form>
            <form id="joinForm" class="form-box">
              <h2>加入房间</h2>
              <label class="field">
                <span>房间码</span>
                <input name="roomId" maxlength="8" required placeholder="ABCDE" autocomplete="off">
              </label>
              <label class="field">
                <span>你的名字</span>
                <input name="name" maxlength="16" required placeholder="例如：卡特">
              </label>
              <button class="secondary" type="submit">加入</button>
            </form>
            ${renderError()}
          </div>
        </div>
      </section>
    </main>
  `;
}

function renderShell(content) {
  return `
    <div class="app-shell">
      <header class="topbar">
        <div>
          <div class="brand">
            <div class="brand-title">诡镇奇谈：洛夫克拉夫特情书</div>
            <div class="room-code">房间 ${escapeHtml(state.roomId)}</div>
            ${phaseBadge()}
          </div>
          <div class="status-row">
            <span>你是 ${escapeHtml(state.me.name)}</span>
            <span>当前：${escapeHtml(state.currentPlayerName || "等待")}</span>
            <span>牌库 ${state.deckCount} 张</span>
            ${state.setAsideAvailable ? "<span>暗置牌可用</span>" : ""}
          </div>
        </div>
        <div class="top-actions">
          ${state.phase === "roundEnd" ? '<button class="secondary" data-action="nextRound">下一轮</button>' : ""}
          ${state.phase === "gameOver" && state.hostId === state.meId ? '<button class="secondary" data-action="restart">重新开局</button>' : ""}
          <button class="ghost" data-action="leave">离开本地会话</button>
        </div>
      </header>
      ${content}
    </div>
  `;
}

function renderLobby() {
  const canStart = state.hostId === state.meId && state.players.length >= 2;
  return `
    <main class="lobby panel">
      <div class="panel-header">
        <h2>等待玩家</h2>
        <button class="primary" data-action="start" ${canStart ? "" : "disabled"}>开始游戏</button>
      </div>
      <div class="panel-body">
        <div class="notice">把房间码 <strong>${escapeHtml(state.roomId)}</strong> 发给其他玩家。支持 2 到 6 人，房主开始游戏。</div>
        <div class="player-list" style="margin-top:14px">
          ${state.players.map(renderLobbyPlayer).join("")}
        </div>
        ${renderError()}
      </div>
    </main>
  `;
}

function renderLobbyPlayer(player) {
  return `
    <div class="player-row">
      <div>
        <strong>${escapeHtml(player.name)}</strong>
        ${player.host ? '<span class="badge warn">房主</span>' : ""}
      </div>
      <span class="small">${player.online ? "在线" : "离线"}</span>
    </div>
  `;
}

function renderGame() {
  return `
    <main class="game-layout">
      <aside class="panel players-panel">
        <div class="panel-header"><h2>玩家</h2><span class="small">${state.players.length} 人</span></div>
        <div class="panel-body players-grid">
          ${state.players.map(renderPlayerCard).join("")}
        </div>
      </aside>

      <section class="table-panel">
        ${renderStats()}
        <div class="panel">
          <div class="panel-header"><h2>你的手牌</h2>${renderMeBadges()}</div>
          <div class="panel-body">
            <div class="hand-grid">
              ${state.me.hand.length ? state.me.hand.map(renderHandCard).join("") : '<div class="empty">当前没有手牌。</div>'}
            </div>
          </div>
        </div>
        <div class="panel">
          <div class="panel-header"><h2>行动</h2></div>
          <div class="panel-body">
            ${renderActionPanel()}
            ${renderError()}
          </div>
        </div>
        ${renderRemovedCards()}
      </section>

      <aside class="side-column">
        <section class="panel dark">
          <div class="panel-header"><h3>私密记录</h3></div>
          <div class="panel-body log-list">${renderLogs(state.privateLog, true)}</div>
        </section>
        <section class="panel">
          <div class="panel-header"><h3>公开记录</h3></div>
          <div class="panel-body log-list">${renderLogs(state.publicLog, false)}</div>
        </section>
        <section class="panel">
          <div class="panel-header"><h3>卡牌参考</h3></div>
          <div class="panel-body reference-list">${state.cardReference.map(renderReference).join("")}</div>
        </section>
      </aside>
    </main>
  `;
}

function renderStats() {
  return `
    <div class="table-info">
      <div class="stat-box"><strong>${state.deckCount}</strong><span>牌库</span></div>
      <div class="stat-box"><strong>${state.roundNumber || "-"}</strong><span>轮次</span></div>
      <div class="stat-box"><strong>${state.braincaseAvailable ? "场外" : "已进入"}</strong><span>米·戈脑缸</span></div>
      <div class="stat-box"><strong>${state.currentPlayerName || "-"}</strong><span>当前玩家</span></div>
    </div>
  `;
}

function renderPlayerCard(player) {
  const classes = [
    "player-card",
    player.id === state.currentPlayerId ? "current" : "",
    player.eliminated ? "eliminated" : ""
  ].join(" ");
  return `
    <div class="${classes}">
      <div class="player-main">
        <div>
          <div class="player-name">${escapeHtml(player.name)}</div>
          <div class="score">
            ${scoreTokens(player.saneWins, "sane")}
            ${scoreTokens(player.insaneWins, "mad")}
          </div>
        </div>
        <div>${player.host ? '<span class="badge warn">房主</span>' : ""}</div>
      </div>
      <div class="player-meta">
        手牌 ${player.handCount} 张 · ${player.online ? "在线" : "离线"}
        ${player.insane ? ` · 疯狂 ${player.insanityCount}` : " · 清醒"}
        ${player.shield ? " · 临时保护" : ""}
        ${player.ward ? " · 疯狂保护" : ""}
        ${player.eliminated ? " · 已出局" : ""}
      </div>
      <div class="discard-strip">${player.discard.slice(-12).map(renderMiniCard).join("")}</div>
    </div>
  `;
}

function scoreTokens(count, type) {
  return Array.from({ length: count }, (_, index) => `<span class="score-token ${type}">${type === "sane" ? "清" : "疯"}</span>`).join("");
}

function renderMiniCard(card) {
  if (!card) return "";
  return `<div class="mini-card ${card.insanity ? "mad" : ""}" title="${escapeHtml(card.name)}">${card.value}<br>${escapeHtml(shortName(card.name))}</div>`;
}

function renderHandCard(card) {
  const choices = actionChoices();
  const selectable = choices.includes(card.uid);
  const selected = selectedCardUid === card.uid;
  return `
    <button class="game-card ${card.insanity ? "mad" : ""} ${selectable ? "selectable" : ""} ${selected ? "selected" : ""}" data-select-card="${escapeHtml(card.uid)}" ${selectable ? "" : "disabled"}>
      <div class="card-top">
        <div>
          <h3 class="card-name">${escapeHtml(card.name)}</h3>
          <div class="card-kind">${card.insanity ? "疯狂牌" : "清醒牌"}</div>
        </div>
        <div class="card-value">${card.value}</div>
      </div>
      <div class="card-sigil"></div>
      <div class="card-text">${escapeHtml(card.short)}</div>
    </button>
  `;
}

function renderActionPanel() {
  if (state.phase === "roundEnd") {
    const winner = state.players.find((p) => p.id === state.lastRoundWinnerId);
    return `<div class="notice">本轮结束。${winner ? `${escapeHtml(winner.name)} 获得标记。` : "本轮无人获得标记。"} 可以开始下一轮。</div>`;
  }
  if (state.phase === "gameOver") {
    const winner = state.players.find((p) => p.id === state.gameWinnerId);
    return `<div class="notice">${winner ? `${escapeHtml(winner.name)} 赢得整局。` : "整局结束。"}${state.cthulhuWin ? " 胜利来自克苏鲁的疯狂效果。" : ""}</div>`;
  }
  const pending = state.pending;
  if (!pending) return '<div class="notice">正在等待服务器推进牌局。</div>';
  if (pending.type === "waiting") {
    return `<div class="notice">等待 ${escapeHtml(pending.playerName)} 操作。</div>`;
  }
  if (pending.type === "redistribute") {
    return renderRedistribute(pending);
  }

  const card = state.me.hand.find((item) => item.uid === selectedCardUid);
  if (!card) return '<div class="notice">请选择一张可弃掉的手牌。</div>';
  const modes = availableModes(card);
  if (!modes.includes(selectedMode)) selectedMode = modes[0] || "sane";
  const effectKey = selectedMode === "insane" ? card.insaneEffect : card.saneEffect;
  const targets = legalTargets(effectKey);
  const needsTarget = targetEffects().includes(effectKey);
  const needsGuess = effectKey === "guess" || effectKey === "deepGuess";
  const effectText = selectedMode === "insane" ? card.insaneText : card.saneText;

  return `
    <form id="actionForm" class="action-box">
      <input type="hidden" name="cardUid" value="${escapeHtml(card.uid)}">
      <div class="notice">${escapeHtml(state.pending.prompt || "")}</div>
      <div>
        <strong>${escapeHtml(card.name)} · ${selectedMode === "insane" ? "疯狂效果" : "清醒效果"}</strong>
        <p class="small">${escapeHtml(effectText || card.short)}</p>
      </div>
      ${renderModeOptions(card, modes)}
      ${needsTarget ? renderTargetSelect(targets) : ""}
      ${needsGuess ? renderGuessSelect() : ""}
      <button class="primary" type="submit">${needsTarget && targets.length === 0 ? "无目标，结算" : "确认弃牌"}</button>
    </form>
  `;
}

function renderModeOptions(card, modes) {
  if (modes.length <= 1) {
    return `<input type="hidden" name="mode" value="${modes[0] || "sane"}">`;
  }
  return `
    <div class="mode-row">
      ${modes.map((mode) => `
        <label class="mode-option">
          <input type="radio" name="mode" value="${mode}" ${selectedMode === mode ? "checked" : ""}>
          <span>${mode === "insane" ? "疯狂效果" : "清醒效果"}</span>
        </label>
      `).join("")}
    </div>
  `;
}

function renderTargetSelect(targets) {
  if (targets.length === 0) {
    return '<div class="notice">当前没有可指定目标。</div>';
  }
  return `
    <label class="field">
      <span>目标</span>
      <select name="targetId" required>
        ${targets.map((player) => `<option value="${escapeHtml(player.id)}">${escapeHtml(player.name)}</option>`).join("")}
      </select>
    </label>
  `;
}

function renderGuessSelect() {
  const values = [0, 2, 3, 4, 5, 6, 7, 8];
  return `
    <label class="field">
      <span>猜测点数</span>
      <select name="guess" required>
        ${values.map((value) => `<option value="${value}">${value}</option>`).join("")}
      </select>
    </label>
  `;
}

function renderRedistribute(pending) {
  return `
    <form id="redistributeForm" class="action-box">
      <div class="notice">${escapeHtml(pending.prompt)}</div>
      <div class="removed-row">
        ${pending.cards.map(renderMiniCard).join("")}
      </div>
      <div class="assign-grid">
        ${pending.targets.map((target, index) => `
          <label class="field">
            <span>${escapeHtml(target.name)}</span>
            <select name="target_${escapeHtml(target.id)}" required>
              ${pending.cards.map((card, cardIndex) => `
                <option value="${escapeHtml(card.uid)}" ${index === cardIndex ? "selected" : ""}>${card.value} · ${escapeHtml(card.name)}</option>
              `).join("")}
            </select>
          </label>
        `).join("")}
      </div>
      <button class="primary" type="submit">完成分配</button>
    </form>
  `;
}

function renderRemovedCards() {
  const resolving = state.resolving || [];
  const removed = state.removedFaceUp || [];
  if (!resolving.length && !removed.length) return "";
  return `
    <div class="panel">
      <div class="panel-header"><h2>场上信息</h2></div>
      <div class="panel-body">
        ${resolving.length ? `
          <div class="small" style="margin-bottom:8px">正在结算</div>
          <div class="resolving-row">${resolving.map((item) => `<div class="mini-card ${item.card.insanity ? "mad" : ""}">${item.card.value}<br>${escapeHtml(shortName(item.card.name))}</div>`).join("")}</div>
        ` : ""}
        ${removed.length ? `
          <div class="small" style="margin:12px 0 8px">双人局明置移除</div>
          <div class="removed-row">${removed.map(renderMiniCard).join("")}</div>
        ` : ""}
      </div>
    </div>
  `;
}

function renderMeBadges() {
  return `
    <div class="status-row">
      <span class="badge ${state.me.insane ? "mad" : "sane"}">${state.me.insane ? `疯狂 ${state.me.insanityCount}` : "清醒"}</span>
      ${state.me.shield ? '<span class="badge warn">临时保护</span>' : ""}
      ${state.me.ward ? '<span class="badge mad">疯狂保护</span>' : ""}
    </div>
  `;
}

function renderLogs(logs, privateLog) {
  if (!logs || logs.length === 0) {
    return `<div class="empty">${privateLog ? "暂无私密记录。" : "暂无公开记录。"}</div>`;
  }
  return logs.slice().reverse().map((item) => `
    <div class="log-item">
      <span class="log-time">${formatTime(item.at)}</span>${escapeHtml(item.message)}
    </div>
  `).join("");
}

function renderReference(card) {
  return `
    <div class="reference-item">
      <div class="reference-title">
        <span>${card.value} · ${escapeHtml(card.name)}</span>
        <span class="badge ${card.insanity ? "mad" : "sane"}">${card.insanity ? "疯狂" : "清醒"}</span>
      </div>
      <div class="reference-text">${escapeHtml(card.short)}</div>
    </div>
  `;
}

function renderError() {
  if (!lastError) return "";
  return `<div class="error">${escapeHtml(lastError)}</div>`;
}

function phaseBadge() {
  const label = {
    lobby: "大厅",
    round: "牌局中",
    roundEnd: "本轮结束",
    gameOver: "整局结束"
  }[state.phase] || state.phase;
  return `<span class="badge">${label}</span>`;
}

function normalizeSelection() {
  const choices = actionChoices();
  if (!choices.length) {
    selectedCardUid = null;
    selectedMode = "sane";
    return;
  }
  if (!selectedCardUid || !choices.includes(selectedCardUid)) {
    selectedCardUid = choices[0];
    selectedMode = "sane";
  }
  const card = state.me.hand.find((item) => item.uid === selectedCardUid);
  const modes = card ? availableModes(card) : ["sane"];
  if (!modes.includes(selectedMode)) selectedMode = modes[0] || "sane";
}

function actionChoices() {
  if (!state || !state.pending) return [];
  if (!["turnPlay", "discardChoice"].includes(state.pending.type)) return [];
  return state.pending.choices || [];
}

function availableModes(card) {
  if (card.insanity && state.me.insane && card.insaneEffect && card.insaneEffect !== card.saneEffect) {
    return ["sane", "insane"];
  }
  return ["sane"];
}

function targetEffects() {
  return ["guess", "deepGuess", "peek", "peekDrawDiscard", "duel", "huntSane", "redraw", "stealBrain", "trade"];
}

function legalTargets(effectKey) {
  const live = state.players.filter((player) => player.active && !player.eliminated);
  if (effectKey === "redraw") {
    return live.filter((player) => player.id === state.meId || !player.shield);
  }
  if (effectKey === "peekDrawDiscard") {
    return live.filter((player) => player.id !== state.meId && !player.shield);
  }
  if (targetEffects().includes(effectKey)) {
    return live.filter((player) => player.id !== state.meId && !player.shield);
  }
  return [];
}

function shortName(name) {
  if (name.length <= 4) return name;
  return name.slice(0, 4);
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
