"use strict";

const STORAGE_KEY = "theGangOnlineIdentity";
const CHIP_COLORS = {
  white: "白色",
  yellow: "黄色",
  orange: "橙色",
  red: "红色",
  green: "绿色"
};
const SUITS = {
  S: "♠",
  H: "♥",
  D: "♦",
  C: "♣",
  null: "★"
};

const state = {
  ws: null,
  connected: false,
  identity: readIdentity(),
  view: "table",
  room: null,
  self: null,
  game: null,
  modes: [],
  challenges: [],
  specialists: [],
  handCategories: [],
  ranks: [],
  selectedChip: null,
  selectedCard: null,
  specialistTarget: "",
  selectedRank: 14,
  selectedCategory: 0,
  toast: "",
  toastTimer: null,
  reconnectTimer: null
};

const app = document.querySelector("#app");

function readIdentity() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveIdentity(next) {
  state.identity = { ...state.identity, ...next };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.identity));
}

function connect() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${protocol}//${location.host}`);
  state.ws = ws;
  ws.addEventListener("open", () => {
    state.connected = true;
    render();
    if (state.identity.roomId && state.identity.playerId && state.identity.name) {
      send({
        type: "join",
        roomId: state.identity.roomId,
        playerId: state.identity.playerId,
        name: state.identity.name
      });
    }
  });
  ws.addEventListener("message", (event) => {
    const data = JSON.parse(event.data);
    if (data.type === "joined") {
      saveIdentity({ roomId: data.roomId, playerId: data.playerId, name: data.name });
      return;
    }
    if (data.type === "state") {
      state.self = data.self;
      state.room = data.room;
      state.game = data.game;
      state.modes = data.modes;
      state.challenges = data.challenges;
      state.specialists = data.specialists;
      state.handCategories = data.handCategories;
      state.ranks = data.ranks;
      if (!state.selectedChip || !data.game?.chips.includes(state.selectedChip)) {
        state.selectedChip = data.game?.chips[0] || null;
      }
      render();
      return;
    }
    if (data.type === "error") showToast(data.message);
  });
  ws.addEventListener("close", () => {
    state.connected = false;
    render();
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = setTimeout(connect, 1200);
  });
  ws.addEventListener("error", () => {
    state.connected = false;
    render();
  });
}

function send(payload) {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
    showToast("连接尚未建立。");
    return;
  }
  state.ws.send(JSON.stringify(payload));
}

function showToast(message) {
  state.toast = message;
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => {
    state.toast = "";
    render();
  }, 3200);
  render();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function cardHtml(card, small = false, selectable = false) {
  const suit = SUITS[String(card.suit)] || SUITS[card.suit] || "★";
  const red = card.red ? " red" : "";
  const selected = selectable && state.selectedCard === card.id ? " selected" : "";
  const attrs = selectable ? ` role="button" data-card="${card.id}" title="选择 ${card.suitLabel}${card.rankLabel}"` : ` title="${card.suitLabel}${card.rankLabel}"`;
  if (small) {
    return `<div class="mini-card${red}${selected}"${attrs}>${card.rankLabel}${suit}</div>`;
  }
  return `
    <div class="card${red}${selected}"${attrs}>
      <div class="rank">${card.rankLabel}</div>
      <div class="suit">${suit}</div>
      <div class="suit-name">${card.suitLabel}</div>
    </div>
  `;
}

function backCardHtml(small = false) {
  if (small) return `<div class="mini-card back">?</div>`;
  return `<div class="card back"><div></div><div class="suit">纸牌帮</div><div></div></div>`;
}

function chipHtml(number, color, extra = "") {
  return `<span class="chip ${color}" ${extra}>${number}</span>`;
}

function playerInitial(name) {
  return escapeHtml((name || "?").slice(0, 1).toUpperCase());
}

function phaseLabel(phase) {
  return {
    lobby: "准备中",
    betting: "行动中",
    complete: "本局结算"
  }[phase] || "未知";
}

function currentMode() {
  return state.modes.find((mode) => mode.id === state.room?.settings?.modeId) || state.modes[0];
}

function selfPlayer() {
  return state.room?.players.find((player) => player.self);
}

function render() {
  app.innerHTML = `
    <div class="app-shell">
      ${renderTopbar()}
      <main class="page">${state.room ? renderGame() : renderJoin()}</main>
      ${state.toast ? `<div class="toast">${escapeHtml(state.toast)}</div>` : ""}
    </div>
  `;
  bindEvents();
}

function renderTopbar() {
  return `
    <header class="topbar">
      <div class="brand">
        <div class="mark">帮</div>
        <div>
          <h1>纸牌帮在线版</h1>
          <small>The Gang cooperative poker</small>
        </div>
      </div>
      <div class="connection">
        <span class="dot ${state.connected ? "ok" : ""}"></span>
        <span>${state.connected ? "已连接" : "连接中"}</span>
        ${state.room ? `<span>房间 ${escapeHtml(state.room.id)}</span>` : ""}
      </div>
    </header>
  `;
}

function renderJoin() {
  const rememberedRoom = state.identity.roomId || "";
  const rememberedName = state.identity.name || "";
  return `
    <section class="join-layout">
      <form class="join-panel" id="joinForm">
        <h2>加入一桌合作扑克</h2>
        <p class="subtle">输入昵称和房间号即可开始。留空房间号会自动创建一个新房间。</p>
        <label class="field">
          <span>昵称</span>
          <input name="name" maxlength="16" autocomplete="nickname" value="${escapeHtml(rememberedName)}" placeholder="例如：阿杰" required />
        </label>
        <label class="field">
          <span>房间号</span>
          <input name="roomId" maxlength="12" value="${escapeHtml(rememberedRoom)}" placeholder="留空创建新房" />
        </label>
        <div class="actions">
          <button class="btn primary" type="submit">进入房间</button>
          <button class="btn ghost" type="button" data-action="clearIdentity">清除重连信息</button>
        </div>
      </form>
      <div class="intro-board" aria-hidden="true">
        <div class="table-preview">
          <div class="preview-card c1" data-rank="A" data-suit="♥"></div>
          <div class="preview-card c2" data-rank="K" data-suit="♣"></div>
          <div class="preview-card c3" data-rank="7" data-suit="♦"></div>
          <div class="preview-chip p1">1</div>
          <div class="preview-chip p2">3</div>
          <div class="preview-chip p3">2</div>
        </div>
      </div>
    </section>
  `;
}

function renderGame() {
  return `
    <section class="game-layout">
      <aside class="left-col">
        ${renderRoomPanel()}
        ${renderPlayersPanel()}
        ${renderSettingsPanel()}
      </aside>
      <section class="table-area">
        ${renderTabs()}
        ${state.view === "rules" ? renderRules() : renderTable()}
      </section>
      <aside class="right-col">
        ${renderActionPanel()}
        ${renderInfoPanel()}
        ${renderLogPanel()}
      </aside>
    </section>
  `;
}

function renderTabs() {
  return `
    <div class="tabs">
      <button class="tab ${state.view === "table" ? "active" : ""}" data-view="table">牌桌</button>
      <button class="tab ${state.view === "rules" ? "active" : ""}" data-view="rules">规则</button>
    </div>
  `;
}

function renderRoomPanel() {
  const score = state.room.score;
  const gameOver = score.successes >= state.room.targetSuccesses || score.failures >= state.room.maxFailures;
  return `
    <section class="panel">
      <div class="panel-head">
        <div>
          <h2>房间</h2>
          <div class="room-code">${escapeHtml(state.room.id)}</div>
        </div>
        <span class="badge">${phaseLabel(state.room.phase)}</span>
      </div>
      <div class="score-row">
        <div class="score-box">
          <span>成功</span>
          <strong>${score.successes}/${state.room.targetSuccesses}</strong>
        </div>
        <div class="score-box">
          <span>失误</span>
          <strong>${score.failures}/${state.room.maxFailures}</strong>
        </div>
      </div>
      ${state.room.upcomingSupport ? `<p class="subtle">下一局特殊牌：${escapeHtml(state.room.upcomingSupport.name)}。</p>` : ""}
      ${gameOver ? `<p class="subtle">${score.successes >= state.room.targetSuccesses ? "战役达成。" : "失误已满，战役结束。"}</p>` : ""}
      <div class="actions">
        ${state.self?.host && (state.room.phase === "lobby" || state.room.phase === "complete") ? `<button class="btn primary" data-action="start">开始一局</button>` : ""}
        ${state.self?.host && state.room.phase === "complete" ? `<button class="btn" data-action="backToLobby">返回准备</button>` : ""}
        ${state.self?.host ? `<button class="btn danger" data-action="resetCampaign">重置计分</button>` : ""}
      </div>
    </section>
  `;
}

function renderPlayersPanel() {
  return `
    <section class="panel">
      <div class="panel-head">
        <h2>玩家</h2>
        <span class="badge">${state.room.players.filter((p) => !p.left).length}/6</span>
      </div>
      <div class="player-list">
        ${state.room.players
          .filter((player) => !player.left)
          .map(
            (player) => `
              <div class="player-pill">
                <div class="player-name">
                  <span class="avatar">${playerInitial(player.name)}</span>
                  <span>${escapeHtml(player.name)}</span>
                </div>
                <div>
                  ${player.host ? `<span class="badge gold">房主</span>` : ""}
                  ${player.self ? `<span class="badge green">你</span>` : ""}
                  ${!player.connected ? `<span class="badge red">断线</span>` : ""}
                </div>
              </div>
            `
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderSettingsPanel() {
  const mode = currentMode();
  return `
    <section class="panel">
      <div class="panel-head">
        <h2>模式</h2>
        <span class="badge">${escapeHtml(mode?.level || "基础")}</span>
      </div>
      <div class="mode-card">
        <div class="mode-title">
          <span>${escapeHtml(mode?.name || "")}</span>
          <span>${state.room.targetSuccesses} 成功 / ${state.room.maxFailures} 失误</span>
        </div>
        <p class="subtle">${escapeHtml(mode?.summary || "")}</p>
      </div>
      ${
        state.self?.host && (state.room.phase === "lobby" || state.room.phase === "complete")
          ? `
            <div class="settings-grid">
              <label class="field">
                <span>游戏模式</span>
                <select data-setting="modeId">
                  ${state.modes
                    .map((item) => `<option value="${item.id}" ${item.id === state.room.settings.modeId ? "selected" : ""}>${escapeHtml(item.name)}｜${escapeHtml(item.summary)}</option>`)
                    .join("")}
                </select>
              </label>
            </div>
          `
          : ""
      }
    </section>
  `;
}

function renderTable() {
  if (!state.game) {
    return `
      <div class="felt">
        <div class="community">
          ${backCardHtml()}${backCardHtml()}${backCardHtml()}${backCardHtml()}${backCardHtml()}
        </div>
        <div class="table-status">
          <div class="status-text">等待房主开始。需要 3-6 名玩家。</div>
        </div>
      </div>
      ${renderPlayerCards()}
    `;
  }
  return `
    ${renderStageStrip()}
    ${renderSpecialCardsStrip()}
    ${renderPendingBanner()}
    <div class="felt">
      <div class="community">
        ${state.game.visibleCommunity.map((card) => cardHtml(card)).join("")}
        ${Array.from({ length: state.game.hiddenCommunityCount }, () => backCardHtml()).join("")}
      </div>
      <div class="table-status">
        <div class="status-text">
          <strong>${escapeHtml(state.game.stage.name)}</strong>
          <div>${escapeHtml(statusText())}</div>
        </div>
        ${state.self?.host && state.room.phase === "betting" ? `<button class="btn primary" data-action="advance" ${state.game.nextRequirement?.ok ? "" : "disabled"}>${state.game.stageIndex >= 3 ? "结算" : "进入下一阶段"}</button>` : ""}
      </div>
    </div>
    ${state.room.phase === "complete" ? renderResultPanel() : ""}
    ${renderPlayerCards()}
  `;
}

function renderStageStrip() {
  return `
    <div class="stage-strip">
      ${state.game.stages
        .map(
          (stage, index) => `
            <div class="stage-item ${index === state.game.stageIndex ? "active" : ""} ${index < state.game.stageIndex || state.room.phase === "complete" ? "done" : ""}">
              <strong>${stage.name}</strong>
              <span>${CHIP_COLORS[stage.chipColor]}排名芯片</span>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function renderSpecialCardsStrip() {
  const cards = [
    ...state.game.activeChallenges.map((card) => ({ ...card, kind: "挑战" })),
    state.game.activeSpecialist ? { ...state.game.activeSpecialist, kind: "专家" } : null
  ].filter(Boolean);
  if (!cards.length) return "";
  return `
    <div class="special-strip">
      ${cards
        .map(
          (card) => `
            <article class="special-card">
              <div class="mode-title">
                <span>${card.kind} ${card.number}：${escapeHtml(card.name)}</span>
                ${card.kind === "专家" && state.game.usedSpecialists?.[card.id] ? `<span class="badge green">已用</span>` : ""}
              </div>
              <p>${escapeHtml(card.summary)}</p>
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

function renderPendingBanner() {
  const pending = state.game.pending;
  if (!pending) return "";
  const text = {
    conArtistConfirm: `女骗子：等待所有玩家确认洗混重发（${pending.confirmedCount}/${pending.total}）。`,
    coordinatorPass: `协调者：等待所有玩家选择传出的手牌（${pending.chosenCount}/${pending.total}）。`,
    discard: pending.yourTurn ? "请选择一张手牌弃掉。" : "等待指定玩家弃牌。",
    retinaGuess: `视网膜扫描：除 ${escapeHtml(pending.topPlayerName)} 外，任一玩家提交其手牌点数猜测。`,
    fingerprintGuess: `指纹扫描：除 ${escapeHtml(pending.topPlayerName)} 外，任一玩家提交其最终牌型猜测。`
  }[pending.type];
  return `<div class="pending-banner">${text || "请先完成当前特殊牌效果。"}</div>`;
}

function statusText() {
  if (state.room.phase === "complete") {
    const result = state.game.result;
    if (!result) return "本局已结算。";
    if (result.success) return "成功。红色排名芯片顺序与特殊牌要求均正确。";
    if (!result.orderSuccess) return "失败。红色排名芯片顺序与实际牌力不一致。";
    return "失败。特殊挑战牌猜测没有达成。";
  }
  return state.game.nextRequirement?.text || "请根据当前信息调整排名芯片。";
}

function renderPlayerCards() {
  return `
    <div class="players-grid">
      ${state.room.players
        .filter((player) => !player.left)
        .map((player) => renderPlayerCard(player))
        .join("")}
    </div>
  `;
}

function renderPlayerCard(player) {
  const assigned = assignedChipsForPlayer(player.id);
  return `
    <article class="player-card ${player.self ? "self" : ""}">
      <div class="player-card-header">
        <div class="player-name">
          <span class="avatar">${playerInitial(player.name)}</span>
          <span>${escapeHtml(player.name)}</span>
        </div>
        <div>
          ${player.self ? `<span class="badge green">你</span>` : ""}
          ${player.finalRank ? `<span class="badge gold">第 ${player.finalRank} 名</span>` : ""}
        </div>
      </div>
      <div class="chip-row">${assigned.length ? assigned.map((item) => chipHtml(item.chip, item.color)).join("") : `<span class="subtle">暂无排名芯片</span>`}</div>
      <div class="hand-row">
        ${
          player.hand?.length
            ? player.hand.map((card) => cardHtml(card, true, player.self && canSelectHandCard())).join("")
            : player.hasCards
              ? Array.from({ length: player.cardCount || 2 }, () => backCardHtml(true)).join("")
              : `<span class="subtle">未发牌</span>`
        }
      </div>
      ${player.handValue ? `<div class="hand-label">${escapeHtml(player.handValue.label)}</div>` : ""}
    </article>
  `;
}

function canSelectHandCard() {
  const pending = state.game?.pending;
  const specialist = state.game?.activeSpecialist;
  if (!state.game || state.room.phase !== "betting") return false;
  if (pending?.type === "discard" && pending.yourTurn) return true;
  if (pending?.type === "coordinatorPass") return true;
  if (specialist && !state.game.usedSpecialists?.[specialist.id] && ["informant"].includes(specialist.id)) return true;
  return false;
}

function assignedChipsForPlayer(playerId) {
  if (!state.game) return [];
  return Object.values(state.game.chipAssignments)
    .filter((assignment) => assignment.playerId === playerId)
    .map((assignment) => ({ chip: assignment.chip, color: assignment.color }))
    .sort((a, b) => colorOrder(a.color) - colorOrder(b.color) || a.chip - b.chip);
}

function colorOrder(color) {
  return { white: 1, yellow: 2, orange: 3, red: 4 }[color] || 9;
}

function currentPlayerChip() {
  const player = selfPlayer();
  if (!player || !state.game) return null;
  const color = state.game.currentChipColor;
  return Object.values(state.game.chipAssignments).find((assignment) => assignment.playerId === player.id && assignment.color === color);
}

function renderActionPanel() {
  if (!state.game || state.room.phase !== "betting") {
    return `
      <section class="panel">
        <div class="panel-head"><h2>操作</h2></div>
        <p class="subtle">牌局开始后，在这里拿取排名芯片和处理特殊牌。</p>
      </section>
    `;
  }
  return `
    <section class="panel">
      <div class="panel-head">
        <h2>操作</h2>
        <span class="badge">${CHIP_COLORS[state.game.currentChipColor]}</span>
      </div>
      ${renderPendingControls()}
      ${renderChipControls()}
      ${renderSpecialistControls()}
    </section>
  `;
}

function renderPendingControls() {
  const pending = state.game.pending;
  if (!pending) return "";
  const me = selfPlayer();
  if (pending.type === "conArtistConfirm") {
    return `
      <div class="action-block">
        <h3>女骗子</h3>
        <p class="subtle">确认后，所有已发手牌会洗混并重新分发。</p>
        <button class="btn primary" data-action="confirmConArtist" ${pending.confirmed ? "disabled" : ""}>确认洗混重发</button>
      </div>
    `;
  }
  if (pending.type === "coordinatorPass") {
    return `
      <div class="action-block">
        <h3>协调者</h3>
        <p class="subtle">选择一张手牌传给左手边玩家。所有人选完后同时执行。</p>
        <button class="btn primary" data-action="choosePassCard" ${!state.selectedCard || pending.yourChoice ? "disabled" : ""}>传出所选手牌</button>
      </div>
    `;
  }
  if (pending.type === "discard") {
    return `
      <div class="action-block">
        <h3>${escapeHtml(pending.reason)}</h3>
        <p class="subtle">${pending.yourTurn ? "选择一张手牌弃掉。" : "等待指定玩家弃牌。"}</p>
        <button class="btn primary" data-action="discardCard" ${!pending.yourTurn || !state.selectedCard ? "disabled" : ""}>弃掉所选手牌</button>
      </div>
    `;
  }
  if (pending.type === "retinaGuess") {
    return `
      <div class="action-block">
        <h3>视网膜扫描</h3>
        <p class="subtle">猜最高红芯玩家 ${escapeHtml(pending.topPlayerName)} 的手牌中至少包含哪个点数。</p>
        <label class="field compact">
          <span>点数</span>
          <select data-local="selectedRank">
            ${state.ranks.map((rank) => `<option value="${rank.value}" ${rank.value === state.selectedRank ? "selected" : ""}>${rank.label}</option>`).join("")}
          </select>
        </label>
        <button class="btn primary" data-action="challengeGuessRank" ${!pending.canSubmit ? "disabled" : ""}>提交猜测</button>
      </div>
    `;
  }
  if (pending.type === "fingerprintGuess") {
    return `
      <div class="action-block">
        <h3>指纹扫描</h3>
        <p class="subtle">猜最高红芯玩家 ${escapeHtml(pending.topPlayerName)} 的最终牌型。</p>
        <label class="field compact">
          <span>牌型</span>
          <select data-local="selectedCategory">
            ${state.handCategories.map((cat) => `<option value="${cat.value}" ${cat.value === state.selectedCategory ? "selected" : ""}>${cat.label}</option>`).join("")}
          </select>
        </label>
        <button class="btn primary" data-action="challengeGuessCategory" ${!pending.canSubmit ? "disabled" : ""}>提交猜测</button>
      </div>
    `;
  }
  return `<div class="action-block"><p class="subtle">请先完成当前特殊牌效果。</p></div>`;
}

function renderChipControls() {
  if (state.game.pending) return "";
  const color = state.game.currentChipColor;
  const mine = currentPlayerChip();
  return `
    <div class="action-block">
      <h3>排名芯片</h3>
      <p class="subtle">选择一枚当前颜色芯片并拿到自己面前；你也可以把自己当前颜色芯片放回中央。</p>
      <div class="chip-bank">
        ${state.game.chips
          .map((chip) => {
            const assignment = state.game.currentColorAssignments[String(chip)];
            const owner = assignment ? state.room.players.find((player) => player.id === assignment) : null;
            const locked = state.game.lockedChips[color]?.[String(chip)];
            return `
              <button class="chip-btn ${state.selectedChip === chip ? "selected" : ""}" data-chip="${chip}" title="${owner ? `当前在 ${owner.name} 面前` : "在中央"}${locked ? "，已锁定" : ""}">
                ${chipHtml(chip, color)}
                <span>${owner ? escapeHtml(owner.name) : "中央"}${locked ? " 锁" : ""}</span>
              </button>
            `;
          })
          .join("")}
      </div>
      <div class="actions">
        <button class="btn primary" data-action="moveChipSelf" ${!state.selectedChip ? "disabled" : ""}>拿取所选芯片</button>
        <button class="btn" data-action="returnChip" ${mine ? "" : "disabled"}>归还我的${CHIP_COLORS[color]}芯片</button>
      </div>
    </div>
  `;
}

function renderSpecialistControls() {
  const specialist = state.game.activeSpecialist;
  if (!specialist || state.game.usedSpecialists?.[specialist.id] || state.game.pending) return "";
  const manualIds = ["informant", "getaway-driver", "mastermind", "hacker", "jack", "muscle"];
  if (!manualIds.includes(specialist.id)) return "";
  const otherPlayers = state.room.players.filter((player) => !player.left && !player.self);
  return `
    <div class="action-block">
      <h3>专家：${escapeHtml(specialist.name)}</h3>
      <p class="subtle">${escapeHtml(specialist.summary)}</p>
      ${
        specialist.id === "informant"
          ? `
            <label class="field compact">
              <span>展示给</span>
              <select data-local="specialistTarget">
                <option value="">选择玩家</option>
                ${otherPlayers.map((player) => `<option value="${player.id}" ${player.id === state.specialistTarget ? "selected" : ""}>${escapeHtml(player.name)}</option>`).join("")}
              </select>
            </label>
            <button class="btn primary" data-action="useInformant" ${!state.selectedCard || !state.specialistTarget ? "disabled" : ""}>展示所选手牌</button>
          `
          : ""
      }
      ${
        specialist.id === "mastermind"
          ? `
            <label class="field compact">
              <span>点数</span>
              <select data-local="selectedRank">
                ${state.ranks.map((rank) => `<option value="${rank.value}" ${rank.value === state.selectedRank ? "selected" : ""}>${rank.label}</option>`).join("")}
              </select>
            </label>
            <button class="btn primary" data-action="useMastermind">公布该点数数量</button>
          `
          : ""
      }
      ${specialist.id === "getaway-driver" ? `<button class="btn primary" data-action="useSpecialistSimple" data-specialist="${specialist.id}">公布当前牌型类别</button>` : ""}
      ${specialist.id === "hacker" ? `<button class="btn primary" data-action="useSpecialistSimple" data-specialist="${specialist.id}">抽一张再弃一张</button>` : ""}
      ${specialist.id === "jack" ? `<button class="btn primary" data-action="useSpecialistSimple" data-specialist="${specialist.id}">获得无花色 J</button>` : ""}
      ${specialist.id === "muscle" ? `<button class="btn primary" data-action="useSpecialistSimple" data-specialist="${specialist.id}">获得打手能力</button>` : ""}
    </div>
  `;
}

function renderInfoPanel() {
  if (!state.game) return "";
  const privateRows = state.game.privateInfo || [];
  const publicRows = state.game.publicInfo || [];
  if (!privateRows.length && !publicRows.length) {
    return `
      <section class="panel">
        <div class="panel-head"><h2>信息</h2></div>
        <p class="subtle">特殊牌产生的公开或私密信息会显示在这里。</p>
      </section>
    `;
  }
  return `
    <section class="panel">
      <div class="panel-head"><h2>信息</h2></div>
      <div class="log-list">
        ${privateRows.map((row) => `<div class="log-item private"><time>${escapeHtml(row.time)} 私密</time><span>${escapeHtml(row.text)}</span>${row.card ? `<div>${cardHtml(row.card, true)}</div>` : ""}</div>`).join("")}
        ${publicRows.map((row) => `<div class="log-item"><time>${escapeHtml(row.time)} 公开</time><span>${escapeHtml(row.text)}</span></div>`).join("")}
      </div>
    </section>
  `;
}

function renderResultPanel() {
  const result = state.game.result;
  return `
    <section class="panel">
      <div class="panel-head">
        <h2>${result.success ? "本局成功" : "本局失败"}</h2>
        <span class="badge ${result.success ? "green" : "red"}">${result.success ? "成功" : `+${result.historyRow.penalty} 失误`}</span>
      </div>
      ${!result.orderSuccess ? `<p class="subtle">红色排名芯片顺序错误。</p>` : ""}
      ${result.challengeFailures?.length ? `<p class="subtle">${escapeHtml(result.challengeFailures.map((item) => item.reason).join("；"))}</p>` : ""}
      <div class="result-list">
        ${state.room.players
          .filter((player) => !player.left)
          .slice()
          .sort((a, b) => (a.finalRank || 0) - (b.finalRank || 0))
          .map(
            (player) => `
              <div class="result-row">
                <div>
                  <strong>第 ${player.finalRank} 名：${escapeHtml(player.name)}</strong>
                  <div class="hand-label">${escapeHtml(player.handValue?.label || "")}</div>
                </div>
                <div class="hand-row">${player.hand.map((card) => cardHtml(card, true)).join("")}</div>
              </div>
            `
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderLogPanel() {
  return `
    <section class="panel">
      <div class="panel-head"><h2>记录</h2></div>
      <div class="log-list">
        ${
          state.room.log.length
            ? state.room.log.map((row) => `<div class="log-item"><time>${escapeHtml(row.time)}</time><span>${escapeHtml(row.text)}</span></div>`).join("")
            : `<p class="subtle">暂无记录。</p>`
        }
      </div>
    </section>
  `;
}

function renderRules() {
  return `
    <section class="rule-panel rules">
      <h2>规则摘要</h2>
      <p>《纸牌帮》是合作式德州扑克排序游戏。玩家不能谈论自己的具体手牌、牌力、胜率或想要的排名，只能通过拿取和归还排名芯片表达判断。</p>
      <div>
        <h3>一局流程</h3>
        <ol>
          <li>每名玩家得到 2 张私人手牌；监控摄像头挑战下得到 3 张。</li>
          <li>起手牌阶段拿取白色排名芯片。</li>
          <li>翻开 3 张公共牌后，拿取黄色排名芯片。</li>
          <li>翻开第 4 张公共牌后，拿取橙色排名芯片。</li>
          <li>翻开第 5 张公共牌后，拿取红色排名芯片并结算。</li>
        </ol>
      </div>
      <div>
        <h3>排名芯片</h3>
        <p>每个阶段都有 1 到玩家人数的排名芯片。1 代表最弱，最大数字代表最强。轮到任意玩家操作时，可以从中央或其他玩家面前拿一枚当前颜色的芯片到自己面前；也可以把自己面前当前颜色芯片放回中央。每名玩家同一颜色最多持有一枚芯片。</p>
      </div>
      <div>
        <h3>模式</h3>
        <ul>
          <li>基础模式：不使用特殊牌。</li>
          <li>进阶模式：成功后下一局加入一张挑战牌；失败后下一局加入一张专家牌。</li>
          <li>专业模式：开局固定一张挑战牌，之后仍按成败追加临时挑战牌或专家牌。</li>
          <li>大盗模式：每局两张挑战牌，失败上限为两次，没有专家牌。</li>
        </ul>
      </div>
      <div>
        <h3>结算</h3>
        <p>只检查红色排名芯片。红色芯片从 1 到最大数字必须对应最终德州扑克牌力从弱到强的顺序。若两名玩家最终牌力完全相同，他们之间的顺序不算错。</p>
      </div>
      <div>
        <h3>沟通限制</h3>
        <ul>
          <li>不能说出或暗示自己的具体手牌、牌型、大小、胜率或想要哪个排名。</li>
          <li>可以提醒流程、说明规则、指出某个芯片是否还没摆完。</li>
          <li>特殊牌要求公开的信息由系统显示；私密展示只显示给对应玩家。</li>
        </ul>
      </div>
      <div>
        <h3>牌型大小</h3>
        <p>从弱到强：高牌、一对、两对、三条、顺子、同花、葫芦、四条、同花顺、皇家同花顺。比较方式按标准德州扑克规则。</p>
      </div>
    </section>
  `;
}

function bindEvents() {
  const joinForm = document.querySelector("#joinForm");
  if (joinForm) {
    joinForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const form = new FormData(joinForm);
      const roomId = String(form.get("roomId") || "").trim().toUpperCase();
      const name = String(form.get("name") || "").trim();
      if (!name) {
        showToast("请输入昵称。");
        return;
      }
      send({ type: "join", roomId, name });
    });
  }

  document.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => handleAction(button));
  });

  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      state.view = button.dataset.view;
      render();
    });
  });

  document.querySelectorAll("[data-setting]").forEach((input) => {
    input.addEventListener("change", () => {
      const key = input.dataset.setting;
      send({ type: "settings", [key]: input.value });
    });
  });

  document.querySelectorAll("[data-local]").forEach((input) => {
    input.addEventListener("change", () => {
      const key = input.dataset.local;
      state[key] = ["selectedRank", "selectedCategory"].includes(key) ? Number(input.value) : input.value;
      render();
    });
  });

  document.querySelectorAll("[data-chip]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedChip = Number(button.dataset.chip);
      render();
    });
  });

  document.querySelectorAll("[data-card]").forEach((card) => {
    card.addEventListener("click", () => {
      state.selectedCard = card.dataset.card;
      render();
    });
  });
}

function handleAction(button) {
  const action = button.dataset.action;
  if (action === "clearIdentity") {
    localStorage.removeItem(STORAGE_KEY);
    state.identity = {};
    showToast("已清除本机重连信息。");
    return;
  }
  if (action === "start") send({ type: "start" });
  if (action === "advance") send({ type: "advance" });
  if (action === "resetCampaign") send({ type: "resetCampaign" });
  if (action === "backToLobby") send({ type: "backToLobby" });
  if (action === "moveChipSelf") send({ type: "moveChip", chip: state.selectedChip });
  if (action === "returnChip") send({ type: "returnChip" });
  if (action === "confirmConArtist") send({ type: "confirmConArtist" });
  if (action === "choosePassCard") send({ type: "choosePassCard", cardId: state.selectedCard });
  if (action === "discardCard") send({ type: "discardCard", cardId: state.selectedCard });
  if (action === "useInformant") send({ type: "useSpecialist", specialistId: "informant", cardId: state.selectedCard, targetId: state.specialistTarget });
  if (action === "useMastermind") send({ type: "useSpecialist", specialistId: "mastermind", rank: state.selectedRank });
  if (action === "useSpecialistSimple") send({ type: "useSpecialist", specialistId: button.dataset.specialist });
  if (action === "challengeGuessRank") send({ type: "challengeGuess", value: state.selectedRank });
  if (action === "challengeGuessCategory") send({ type: "challengeGuess", value: state.selectedCategory });
}

connect();
render();
