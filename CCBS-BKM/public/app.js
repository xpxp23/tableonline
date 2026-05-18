const app = document.getElementById("app");
const toastNode = document.getElementById("toast");

const colorHex = {
  red: "#e5484d",
  green: "#2f9e44",
  blue: "#1c7ed6",
  yellow: "#f59f00",
  purple: "#8b5cf6",
  master: "#7c3aed",
};

const colorNames = {
  red: "红球",
  green: "绿球",
  blue: "蓝球",
  yellow: "黄球",
  purple: "紫球",
  master: "大师球",
};

const colorShort = {
  red: "红",
  green: "绿",
  blue: "蓝",
  yellow: "黄",
  purple: "紫",
  master: "师",
};

const tierNames = {
  1: "1 级宝可梦",
  2: "2 级宝可梦",
  3: "3 级宝可梦",
  rare: "稀有宝可梦",
  legend: "传说/幻之宝可梦",
};

const storage = {
  get roomCode() {
    return localStorage.getItem("ccbs_roomCode") || "";
  },
  set roomCode(value) {
    localStorage.setItem("ccbs_roomCode", value || "");
  },
  get playerId() {
    return localStorage.getItem("ccbs_playerId") || "";
  },
  set playerId(value) {
    localStorage.setItem("ccbs_playerId", value || "");
  },
  get playerName() {
    return localStorage.getItem("ccbs_playerName") || "";
  },
  set playerName(value) {
    localStorage.setItem("ccbs_playerName", value || "");
  },
  clearSession() {
    localStorage.removeItem("ccbs_roomCode");
    localStorage.removeItem("ccbs_playerId");
  },
};

let state = null;
let source = null;
let busy = false;
let entryMode = "create";
let actionMode = "take3";
let selectedTake3 = [];
let selectedTake2 = "";
let pendingAction = null;
let discardDraft = {};

init();

function init() {
  if (storage.roomCode && storage.playerId) {
    loadState(storage.roomCode, storage.playerId).catch(() => {
      storage.clearSession();
      renderEntry();
    });
  } else {
    renderEntry();
  }
}

async function loadState(roomCode, playerId) {
  const data = await requestJson(`/api/state?roomCode=${encodeURIComponent(roomCode)}&playerId=${encodeURIComponent(playerId)}`);
  state = data.state;
  connectEvents();
  render();
}

function connectEvents() {
  if (!state?.code || !state?.viewerId) return;
  if (source) source.close();
  source = new EventSource(`/api/events?roomCode=${encodeURIComponent(state.code)}&playerId=${encodeURIComponent(state.viewerId)}`);
  source.addEventListener("state", (event) => {
    state = JSON.parse(event.data);
    render();
  });
  source.onerror = () => {
    showToast("实时连接暂时中断，正在等待浏览器重连。");
  };
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "请求失败。");
    error.data = data;
    throw error;
  }
  return data;
}

async function postJson(url, body) {
  return requestJson(url, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function showToast(message) {
  toastNode.textContent = message;
  toastNode.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    toastNode.hidden = true;
  }, 2800);
}

function renderEntry() {
  app.innerHTML = `
    <main class="entry">
      <section class="title-block">
        <h1>璀璨宝石宝可梦版</h1>
        <p>2-4 名训练家在同一局域网或服务器房间中轮流拿取精灵球、保留宝可梦、捕捉并进化。达到 18 点后完成本轮，按奖杯点数与进化数量决胜。</p>
      </section>
      <div class="entry-grid">
        <section class="panel auth-panel">
          <div class="auth-tabs">
            <button class="tab-button ${entryMode === "create" ? "active" : ""}" data-entry-mode="create">创建房间</button>
            <button class="tab-button ${entryMode === "join" ? "active" : ""}" data-entry-mode="join">加入房间</button>
          </div>
          <form id="entryForm" class="form-stack">
            <label class="field">
              <span>训练家名称</span>
              <input name="name" maxlength="16" value="${escapeHtml(storage.playerName || "")}" placeholder="例如 小智" autocomplete="nickname" />
            </label>
            ${
              entryMode === "join"
                ? `<label class="field">
                    <span>房间代码</span>
                    <input class="room-code" name="roomCode" maxlength="5" placeholder="ABCDE" autocomplete="off" />
                  </label>`
                : ""
            }
            <button class="primary-button" type="submit">${entryMode === "join" ? "进入房间" : "创建房间"}</button>
          </form>
        </section>
        <section class="panel rules-panel">
          <h2>本网页版包含的桌游内容</h2>
          <ol class="rules-list">
            <li>90 张宝可梦卡：1/2/3 级普通宝可梦、稀有宝可梦、传说/幻之宝可梦。</li>
            <li>40 个标记：五色精灵球按人数提供，大师球作为万能球。</li>
            <li>核心动作：拿 3 个不同颜色、拿 2 个同色、保留普通牌、捕捉宝可梦。</li>
            <li>回合末若满足进化条件，可以执行一次进化；稀有和传说/幻之牌不可保留。</li>
            <li>手牌上限 3 张，精灵球上限 10 个。达到 18 点后完成整轮并结算。</li>
          </ol>
        </section>
      </div>
    </main>
  `;
  app.querySelectorAll("[data-entry-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      entryMode = button.dataset.entryMode;
      renderEntry();
    });
  });
  app.querySelector("#entryForm").addEventListener("submit", submitEntry);
}

async function submitEntry(event) {
  event.preventDefault();
  if (busy) return;
  const form = new FormData(event.currentTarget);
  const name = String(form.get("name") || "").trim() || "训练家";
  const roomCode = String(form.get("roomCode") || "").trim().toUpperCase();
  busy = true;
  try {
    const endpoint = entryMode === "join" ? "/api/join" : "/api/create";
    const payload = entryMode === "join" ? { name, roomCode } : { name };
    const data = await postJson(endpoint, payload);
    storage.playerName = name;
    storage.roomCode = data.roomCode;
    storage.playerId = data.playerId;
    state = data.state;
    connectEvents();
    render();
  } catch (error) {
    showToast(error.message);
  } finally {
    busy = false;
  }
}

function render() {
  if (!state) {
    renderEntry();
    return;
  }
  if (state.phase === "lobby") {
    renderLobby();
    return;
  }
  renderGame();
}

function renderLobby() {
  const me = myPlayer();
  app.innerHTML = `
    <main class="lobby">
      <div class="lobby-header">
        <div>
          <div class="game-title">等待训练家加入</div>
          <div class="hint">把房间代码发给同一服务器或局域网中的玩家。</div>
        </div>
        <div class="code-pill">${escapeHtml(state.code)}</div>
      </div>
      <section class="panel auth-panel">
        <div class="player-list">
          ${state.players
            .map(
              (player) => `
              <div class="lobby-player">
                <strong>${escapeHtml(player.name)}</strong>
                <div class="hint">${player.host ? "房主" : "玩家"} · ${player.connected ? "在线" : "离线"}</div>
              </div>`
            )
            .join("")}
        </div>
        <div class="stat-line">
          <button class="primary-button" id="startGame" ${!me?.host || state.players.length < 2 ? "disabled" : ""}>开始游戏</button>
          <button class="small-button" id="leaveRoom">离开本地房间</button>
          <span class="hint">需要 2-4 人，房主开始。</span>
        </div>
      </section>
    </main>
  `;
  app.querySelector("#startGame").addEventListener("click", startGame);
  app.querySelector("#leaveRoom").addEventListener("click", leaveRoom);
}

async function startGame() {
  await sendSimple("/api/start", {});
}

function leaveRoom() {
  if (source) source.close();
  source = null;
  state = null;
  storage.clearSession();
  renderEntry();
}

function renderGame() {
  const me = myPlayer();
  selectedTake3 = selectedTake3.filter((key) => (state.supply[key] || 0) > 0);
  if (selectedTake2 && (state.supply[selectedTake2] || 0) < 4) selectedTake2 = "";
  const isMyMainTurn = isMyTurn() && !isMyEvolutionTurn() && state.phase === "playing";
  const isEnded = state.phase === "ended";
  app.innerHTML = `
    <header class="topbar">
      <div class="top-left">
        <div class="game-title">璀璨宝石宝可梦版</div>
        <span class="turn-pill">房间 ${escapeHtml(state.code)}</span>
        <span class="turn-pill">${isEnded ? "游戏结束" : `当前：${escapeHtml(state.currentPlayerName)}`}</span>
        ${state.endTriggeredBy && !isEnded ? `<span class="status-pill important">已触发终局，本轮结束后结算</span>` : ""}
      </div>
      <div class="top-right">
        <span class="score-pill">我：${escapeHtml(me?.name || "")} · ${me?.score || 0} 点 · ${me?.tokenCount || 0}/10 球</span>
        <button class="small-button" id="leaveRoom">离开本地房间</button>
      </div>
    </header>
    <main class="game-shell">
      <div class="board-area">
        ${renderSupply(isMyMainTurn)}
        ${renderMarketSection(3, isMyMainTurn)}
        ${renderMarketSection(2, isMyMainTurn)}
        ${renderMarketSection(1, isMyMainTurn)}
        ${renderSpecialSection(isMyMainTurn)}
      </div>
      <aside class="side-area">
        ${renderActionPanel()}
        ${renderHandPanel(isMyMainTurn)}
        ${renderPlayersPanel()}
        ${renderLogPanel()}
      </aside>
    </main>
  `;
  wireGameEvents();
}

function renderSupply(interactive) {
  const keys = ["red", "green", "blue", "yellow", "purple", "master"];
  return `
    <section class="supply-panel">
      <div class="market-header">
        <h2>精灵球供应区</h2>
        <span class="hint">${interactive ? "选择拿球动作后点击对应颜色" : "等待当前玩家行动"}</span>
      </div>
      <div class="supply-grid">
        ${keys
          .map((key) => {
            const selected = (actionMode === "take3" && selectedTake3.includes(key)) || (actionMode === "take2" && selectedTake2 === key);
            const disabled =
              key === "master" ||
              !interactive ||
              (actionMode === "take3" && (state.supply[key] || 0) < 1) ||
              (actionMode === "take2" && (state.supply[key] || 0) < 4);
            return `
              <button class="token-button ${selected ? "selected" : ""}" data-token="${key}" ${disabled ? "disabled" : ""}>
                ${ballIcon(key)}
                <span class="token-meta">
                  <span class="token-name">${colorNames[key]}</span>
                  <span class="token-count">剩余 ${state.supply[key] || 0}</span>
                </span>
              </button>
            `;
          })
          .join("")}
      </div>
    </section>
  `;
}

function renderMarketSection(tier, interactive) {
  return `
    <section class="market-section">
      <div class="market-header">
        <h2>${tierNames[tier]}</h2>
        <div class="market-actions">
          <span class="hint">牌堆 ${state.decks[tier]} 张</span>
          <button class="small-button" data-reserve-deck="${tier}" ${!interactive || myPlayer()?.handCount >= 3 ? "disabled" : ""}>盲保留</button>
        </div>
      </div>
      <div class="cards-row">
        ${state.market[tier].map((card) => renderCard(card, { interactive, source: "market" })).join("")}
      </div>
    </section>
  `;
}

function renderSpecialSection(interactive) {
  return `
    <section class="market-section">
      <div class="market-header">
        <h2>稀有与传说/幻之宝可梦</h2>
        <span class="hint">不可保留，捕捉时额外需要 1 个大师球。</span>
      </div>
      <div class="special-row">
        ${["rare", "legend"]
          .map((tier) => {
            const card = state.market[tier][0];
            if (!card) return `<div class="empty">${tierNames[tier]}牌堆已空</div>`;
            return renderCard(card, { interactive, source: "market", special: true });
          })
          .join("")}
      </div>
    </section>
  `;
}

function renderCard(card, options = {}) {
  if (!card) return "";
  const accent = colorHex[card.bonus[0]] || colorHex.purple;
  const accent2 = colorHex[card.bonus[1] || card.bonus[0]] || colorHex.blue;
  const canCaptureCard = options.interactive && canPay(card, myPlayer());
  const canReserveCard = options.interactive && options.source === "market" && [1, 2, 3].includes(Number(card.tier)) && (myPlayer()?.handCount || 0) < 3;
  const special = options.special || card.kind !== "normal";
  return `
    <article class="card ${special ? "special" : ""}" style="--accent:${accent};--accent-2:${accent2}">
      <div class="card-head">
        <div>
          <div class="card-name">${escapeHtml(card.name)}</div>
          <div class="card-sub">${escapeHtml(card.rarity)} · ${escapeHtml(card.type)} · ${tierLabel(card.tier)}</div>
        </div>
        <div class="points">${card.points}</div>
      </div>
      ${renderPokemonMark(card)}
      <div>
        <div class="bonus-line"><span class="mini-label">奖励</span>${card.bonus.map((key) => ballMini(key)).join("")}</div>
        <div class="cost-line"><span class="mini-label">捕捉</span>${renderCost(card.cost)}${card.masterCost ? `<span class="cost-chip">${ballMini("master")}${card.masterCost}</span>` : ""}</div>
        ${
          card.evolveCost
            ? `<div class="evolve-line"><span class="mini-label">进化</span>${renderCost(card.evolveCost)}${card.evolvesFrom ? `<span class="mini-label">由 ${escapeHtml(card.evolvesFrom)}</span>` : ""}</div>`
            : card.evolvesTo
              ? `<div class="evolve-line"><span class="mini-label">可进化为 ${escapeHtml(card.evolvesTo)}</span></div>`
              : ""
        }
      </div>
      ${
        options.source
          ? `<div class="card-actions ${options.source === "hand" ? "single" : ""}">
              <button class="card-action" data-capture="${card.id}" data-source="${options.source}" ${canCaptureCard ? "" : "disabled"}>捕捉</button>
              ${
                options.source === "market"
                  ? `<button class="card-action secondary" data-reserve="${card.id}" ${canReserveCard ? "" : "disabled"}>保留</button>`
                  : ""
              }
            </div>`
          : ""
      }
    </article>
  `;
}

function renderActionPanel() {
  const me = myPlayer();
  if (state.phase === "ended") {
    const winners = state.players.filter((player) => state.winnerIds.includes(player.id)).map((player) => player.name).join("、");
    return `
      <section class="action-panel">
        <h2 class="panel-title">游戏结束</h2>
        <p class="mode-help">获胜者：${escapeHtml(winners || "无")}</p>
        <button class="primary-button" id="newLocal">返回首页</button>
      </section>
    `;
  }
  if (isMyEvolutionTurn()) {
    return `
      <section class="action-panel">
        <h2 class="panel-title">回合末进化</h2>
        <p class="mode-help">你可以选择一次进化，或跳过并结束回合。</p>
        <div class="evolution-list">
          ${
            state.myEvolutionOptions.length
              ? state.myEvolutionOptions.map(renderEvolutionOption).join("")
              : `<div class="empty">当前没有可执行的进化。</div>`
          }
        </div>
        <button class="danger-button" id="skipEvolution">跳过进化</button>
      </section>
    `;
  }
  if (!isMyTurn()) {
    return `
      <section class="action-panel">
        <h2 class="panel-title">行动面板</h2>
        <p class="mode-help">等待 ${escapeHtml(state.currentPlayerName)} 行动。你可以查看手牌、捕捉成本和其他玩家状态。</p>
      </section>
    `;
  }
  const projected = pendingAction ? projectedTokensFor(pendingAction) : null;
  const over = projected ? Math.max(0, tokenTotal(projected) - 10) : 0;
  return `
    <section class="action-panel">
      <h2 class="panel-title">行动面板</h2>
      <div class="mode-grid">
        <button class="mode-button ${actionMode === "take3" ? "active" : ""}" data-mode="take3">拿 3 色</button>
        <button class="mode-button ${actionMode === "take2" ? "active" : ""}" data-mode="take2">拿 2 同色</button>
      </div>
      <div class="selection-box">
        ${renderMainActionHint()}
        ${pendingAction ? renderPendingAction(pendingAction, projected, over) : ""}
      </div>
      <p class="hint">捕捉和保留可直接点击牌面按钮。保留仅限普通 1/2/3 级宝可梦，且保留区最多 3 张。</p>
      <div class="stat-line">
        <span class="status-pill">我的球：${me?.tokenCount || 0}/10</span>
        <span class="status-pill">手牌：${me?.handCount || 0}/3</span>
      </div>
    </section>
  `;
}

function renderMainActionHint() {
  if (actionMode === "take3") {
    return `
      <div class="mode-help">选择 3 种不同颜色的精灵球。</div>
      <div class="stat-line">${selectedTake3.map((key) => ballChip(key, state.supply[key])).join("") || `<span class="hint">尚未选择</span>`}</div>
      <button class="primary-button" id="confirmTake3" ${selectedTake3.length === 3 ? "" : "disabled"}>确认拿取</button>
    `;
  }
  return `
    <div class="mode-help">选择 1 种颜色。该颜色供应区至少剩 4 个时，才能拿 2 个同色。</div>
    <div class="stat-line">${selectedTake2 ? ballChip(selectedTake2, state.supply[selectedTake2]) : `<span class="hint">尚未选择</span>`}</div>
    <button class="primary-button" id="confirmTake2" ${selectedTake2 && state.supply[selectedTake2] >= 4 ? "" : "disabled"}>确认拿取</button>
  `;
}

function renderPendingAction(action, projected, over) {
  return `
    <div class="mode-help">${escapeHtml(action.label)}</div>
    ${
      over > 0
        ? `<div class="error-text">本次操作后会有 ${tokenTotal(projected)} 个球，需要至少归还 ${over} 个。</div>${renderDiscardInputs(projected)}`
        : `<div class="hint">本次操作后不会超过 10 个球。</div>`
    }
    <div class="stat-line">
      <button class="primary-button" id="submitPending">${over > 0 ? "归还并提交" : "提交操作"}</button>
      <button class="small-button" id="cancelPending">取消</button>
    </div>
  `;
}

function renderDiscardInputs(projected) {
  const keys = ["red", "green", "blue", "yellow", "purple", "master"];
  return `
    <div class="discard-grid">
      ${keys
        .map(
          (key) => `
          <label class="discard-cell">
            <span class="mini-label">${colorNames[key]}（有 ${projected[key] || 0}）</span>
            <input type="number" min="0" max="${projected[key] || 0}" value="${discardDraft[key] || 0}" data-discard="${key}" />
          </label>`
        )
        .join("")}
    </div>
  `;
}

function renderEvolutionOption(option) {
  return `
    <div class="evolution-option">
      <div>
        <strong>${escapeHtml(option.base.name)}</strong>
        <div class="hint">${option.base.points} 点 · ${option.base.bonus.map((key) => colorNames[key]).join("/")}</div>
      </div>
      <div class="arrow">→</div>
      <div>
        <strong>${escapeHtml(option.target.name)}</strong>
        <div class="hint">${option.target.points} 点 · ${option.target.bonus.map((key) => colorNames[key]).join("/")}</div>
      </div>
      <button class="primary-button" data-evolve-base="${option.base.id}" data-evolve-target="${option.target.id}" data-evolve-source="${option.source}">进化</button>
    </div>
  `;
}

function renderHandPanel(interactive) {
  const me = myPlayer();
  return `
    <section class="hand-panel">
      <div class="market-header">
        <h2>我的保留区</h2>
        <span class="hint">${me?.handCount || 0}/3</span>
      </div>
      <div class="hand-cards">
        ${
          me?.hand?.length
            ? me.hand.map((card) => renderMiniHandCard(card, interactive)).join("")
            : `<div class="empty">还没有保留的宝可梦。</div>`
        }
      </div>
    </section>
  `;
}

function renderMiniHandCard(card, interactive) {
  const accent = colorHex[card.bonus[0]] || colorHex.purple;
  return `
    <div class="mini-card" style="--accent:${accent};--accent-2:${accent}">
      ${renderPokemonMark(card, true)}
      <div>
        <strong>${escapeHtml(card.name)}</strong>
        <div class="hint">${card.points} 点 · 捕捉 ${plainCost(card.cost)}${card.masterCost ? ` + 大师球 ${card.masterCost}` : ""}</div>
      </div>
      <button class="small-button" data-capture="${card.id}" data-source="hand" ${interactive && canPay(card, myPlayer()) ? "" : "disabled"}>捕捉</button>
    </div>
  `;
}

function renderPlayersPanel() {
  return `
    <section class="players-panel">
      <h2 class="panel-title">训练家</h2>
      <div class="hand-cards">
        ${state.players.map(renderPlayerCard).join("")}
      </div>
    </section>
  `;
}

function renderPlayerCard(player) {
  const active = player.id === state.currentPlayerId;
  const winner = state.winnerIds.includes(player.id);
  return `
    <div class="player-card ${active ? "active" : ""} ${winner ? "winner" : ""}">
      <div class="player-head">
        <span class="player-name">${escapeHtml(player.name)}${player.isViewer ? "（我）" : ""}</span>
        <span class="status-pill">${player.score} 点</span>
      </div>
      <div class="stat-line">
        <span class="hint">球 ${player.tokenCount}/10</span>
        <span class="hint">保留 ${player.handCount}/3</span>
        <span class="hint">进化垫牌 ${player.evolvedUnderCount}</span>
        <span class="hint">${player.connected ? "在线" : "离线"}</span>
      </div>
      <div class="stat-line">${["red", "green", "blue", "yellow", "purple"].map((key) => ballChip(key, player.bonuses[key] || 0)).join("")}</div>
      <div class="captured-list">
        ${player.captured.length ? player.captured.map(renderCapturedCard).join("") : `<span class="hint">尚未捕捉</span>`}
      </div>
    </div>
  `;
}

function renderPokemonMark(card, compact = false) {
  const tierText = card.kind === "normal" ? `${card.tier} 级` : card.rarity;
  return `
    <div class="pokemon-mark ${compact ? "compact" : ""}">
      <div class="pokemon-mark-top">
        <span>${escapeHtml(card.type)}属性</span>
        <span>${escapeHtml(tierText)}</span>
      </div>
      <div class="pokemon-mark-name">${escapeHtml(card.name)}</div>
      <div class="pokemon-mark-chain">${escapeHtml(evolutionText(card))}</div>
    </div>
  `;
}

function renderCapturedCard(card) {
  const accent = colorHex[card.bonus[0]] || colorHex.purple;
  return `
    <div class="captured-card" style="--accent:${accent}">
      <div class="captured-main">
        <strong>${escapeHtml(card.name)}</strong>
        <span class="status-pill">${card.points} 点</span>
      </div>
      <div class="captured-meta">${escapeHtml(card.rarity)} · ${escapeHtml(card.type)}属性 · ${tierLabel(card.tier)}</div>
      <div class="captured-row"><span class="mini-label">奖励</span>${card.bonus.map((key) => ballMini(key)).join("")}</div>
      <div class="captured-evolution">${escapeHtml(evolutionText(card))}</div>
    </div>
  `;
}

function evolutionText(card) {
  if (card.evolvesFrom && card.evolvesTo) return `${card.evolvesFrom} → ${card.name} → ${card.evolvesTo}`;
  if (card.evolvesFrom) return `由 ${card.evolvesFrom} 进化`;
  if (card.evolvesTo) return `可进化为 ${card.evolvesTo}`;
  return "无进化";
}

function renderLogPanel() {
  return `
    <section class="log-panel">
      <h2 class="panel-title">记录</h2>
      <div class="log-list">
        ${state.logs.length ? state.logs.slice().reverse().map((item) => `<div class="log-item ${item.level === "important" ? "important" : ""}">${escapeHtml(item.text)}</div>`).join("") : `<div class="empty">暂无记录</div>`}
      </div>
    </section>
  `;
}

function wireGameEvents() {
  app.querySelector("#leaveRoom")?.addEventListener("click", leaveRoom);
  app.querySelector("#newLocal")?.addEventListener("click", leaveRoom);
  app.querySelectorAll("[data-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      actionMode = button.dataset.mode;
      pendingAction = null;
      discardDraft = {};
      render();
    });
  });
  app.querySelectorAll("[data-token]").forEach((button) => {
    button.addEventListener("click", () => selectToken(button.dataset.token));
  });
  app.querySelector("#confirmTake3")?.addEventListener("click", () => {
    queueAction({
      type: "take3",
      colors: [...selectedTake3],
      label: `拿取 ${selectedTake3.map((key) => colorNames[key]).join("、")}`,
    });
  });
  app.querySelector("#confirmTake2")?.addEventListener("click", () => {
    queueAction({
      type: "take2",
      color: selectedTake2,
      label: `拿取 2 个${colorNames[selectedTake2]}`,
    });
  });
  app.querySelectorAll("[data-capture]").forEach((button) => {
    button.addEventListener("click", () => submitAction({ type: "capture", cardId: button.dataset.capture, source: button.dataset.source }));
  });
  app.querySelectorAll("[data-reserve]").forEach((button) => {
    button.addEventListener("click", () => {
      const card = findCard(button.dataset.reserve);
      queueAction({ type: "reserve", cardId: button.dataset.reserve, label: `保留 ${card?.name || "这张宝可梦"}` });
    });
  });
  app.querySelectorAll("[data-reserve-deck]").forEach((button) => {
    button.addEventListener("click", () => {
      queueAction({ type: "reserve", tier: Number(button.dataset.reserveDeck), label: `盲保留 ${button.dataset.reserveDeck} 级牌堆顶部` });
    });
  });
  app.querySelectorAll("[data-discard]").forEach((input) => {
    input.addEventListener("input", () => {
      discardDraft[input.dataset.discard] = Math.max(0, Number(input.value || 0));
    });
  });
  app.querySelector("#submitPending")?.addEventListener("click", () => submitPendingAction());
  app.querySelector("#cancelPending")?.addEventListener("click", () => {
    pendingAction = null;
    discardDraft = {};
    render();
  });
  app.querySelectorAll("[data-evolve-base]").forEach((button) => {
    button.addEventListener("click", () => {
      submitAction({
        type: "evolve",
        baseId: button.dataset.evolveBase,
        targetId: button.dataset.evolveTarget,
        source: button.dataset.evolveSource,
      });
    });
  });
  app.querySelector("#skipEvolution")?.addEventListener("click", () => submitAction({ type: "skipEvolution" }));
}

function selectToken(key) {
  if (!isMyTurn() || isMyEvolutionTurn()) return;
  if (actionMode === "take3") {
    if (selectedTake3.includes(key)) {
      selectedTake3 = selectedTake3.filter((item) => item !== key);
    } else if (selectedTake3.length < 3) {
      selectedTake3.push(key);
    } else {
      selectedTake3 = [...selectedTake3.slice(1), key];
    }
  } else {
    selectedTake2 = selectedTake2 === key ? "" : key;
  }
  pendingAction = null;
  discardDraft = {};
  render();
}

function queueAction(action) {
  pendingAction = action;
  discardDraft = {};
  const projected = projectedTokensFor(action);
  if (tokenTotal(projected) <= 10) {
    submitAction(action);
    return;
  }
  render();
}

function submitPendingAction() {
  if (!pendingAction) return;
  submitAction({ ...pendingAction, discard: normalizeDiscard(discardDraft) });
}

async function submitAction(action) {
  if (busy) return;
  busy = true;
  try {
    const payload = {
      roomCode: state.code,
      playerId: state.viewerId,
      ...action,
    };
    delete payload.label;
    const data = await postJson("/api/action", payload);
    state = data.state;
    pendingAction = null;
    discardDraft = {};
    if (action.type === "take3") selectedTake3 = [];
    if (action.type === "take2") selectedTake2 = "";
    render();
  } catch (error) {
    showToast(error.message);
    if (error.data?.needsDiscard) render();
  } finally {
    busy = false;
  }
}

async function sendSimple(url, body) {
  if (busy) return;
  busy = true;
  try {
    const data = await postJson(url, { roomCode: state.code, playerId: state.viewerId, ...body });
    state = data.state;
    render();
  } catch (error) {
    showToast(error.message);
  } finally {
    busy = false;
  }
}

function projectedTokensFor(action) {
  const tokens = { ...myPlayer().tokens };
  if (action.type === "take3") {
    for (const key of action.colors || []) tokens[key] += 1;
  } else if (action.type === "take2") {
    tokens[action.color] += 2;
  } else if (action.type === "reserve" && (state.supply.master || 0) > 0) {
    tokens.master += 1;
  }
  return tokens;
}

function normalizeDiscard(draft) {
  const discard = {};
  for (const key of ["red", "green", "blue", "yellow", "purple", "master"]) {
    const value = Math.max(0, Number(draft[key] || 0));
    if (value) discard[key] = value;
  }
  return discard;
}

function canPay(card, player) {
  if (!card || !player) return false;
  let missing = 0;
  for (const key of ["red", "green", "blue", "yellow", "purple"]) {
    const need = Math.max(0, (card.cost[key] || 0) - (player.bonuses[key] || 0));
    const spend = Math.min(player.tokens[key] || 0, need);
    missing += need - spend;
  }
  const masterNeed = (card.masterCost || 0) + missing;
  return (player.tokens.master || 0) >= masterNeed;
}

function myPlayer() {
  return state?.players.find((player) => player.id === state.viewerId) || null;
}

function isMyTurn() {
  return state?.currentPlayerId === state?.viewerId && state.phase === "playing";
}

function isMyEvolutionTurn() {
  return state?.pendingEvolutionPlayerId === state?.viewerId && state.phase === "playing";
}

function tokenTotal(tokens) {
  return ["red", "green", "blue", "yellow", "purple", "master"].reduce((sum, key) => sum + (tokens[key] || 0), 0);
}

function renderCost(cost) {
  const html = ["red", "green", "blue", "yellow", "purple"]
    .filter((key) => cost[key] > 0)
    .map((key) => `<span class="cost-chip">${ballMini(key)}${cost[key]}</span>`)
    .join("");
  return html || `<span class="hint">免费</span>`;
}

function plainCost(cost) {
  const items = ["red", "green", "blue", "yellow", "purple"]
    .filter((key) => cost[key] > 0)
    .map((key) => `${colorShort[key]}${cost[key]}`);
  return items.length ? items.join(" ") : "免费";
}

function tierLabel(tier) {
  return tierNames[tier] || `${tier} 级`;
}

function ballIcon(key) {
  return `<span class="token-icon" style="background:${colorHex[key]}">${colorShort[key]}</span>`;
}

function ballMini(key) {
  return `<span class="mini-ball" style="background:${colorHex[key]}">${colorShort[key]}</span>`;
}

function ballChip(key, count) {
  return `<span class="cost-chip">${ballMini(key)}${count}</span>`;
}

function findCard(cardId) {
  const pools = [
    ...(state?.market?.[1] || []),
    ...(state?.market?.[2] || []),
    ...(state?.market?.[3] || []),
    ...(state?.market?.rare || []),
    ...(state?.market?.legend || []),
    ...(myPlayer()?.hand || []),
  ];
  return pools.find((card) => card.id === cardId) || null;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}
