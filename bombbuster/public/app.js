const $app = document.querySelector("#app");
const $toast = document.querySelector("#toast");

const storage = {
  get() {
    try {
      return JSON.parse(localStorage.getItem("bombbuster.session") || "{}");
    } catch {
      return {};
    }
  },
  set(value) {
    localStorage.setItem("bombbuster.session", JSON.stringify(value));
  },
  clear() {
    localStorage.removeItem("bombbuster.session");
  }
};

let session = storage.get();
let room = null;
let eventSource = null;
let selectedWires = [];
let selectedEquipment = null;
let busy = false;
let lastError = "";

boot();

async function boot() {
  if (session.roomCode && session.token) {
    try {
      const data = await api(`/api/state?roomCode=${encodeURIComponent(session.roomCode)}&token=${encodeURIComponent(session.token)}`);
      room = data.room;
      connectEvents();
    } catch {
      storage.clear();
      session = {};
    }
  }
  render();
}

function connectEvents() {
  if (!session.roomCode || !session.token) return;
  if (eventSource) eventSource.close();
  eventSource = new EventSource(`/api/events?roomCode=${encodeURIComponent(session.roomCode)}&token=${encodeURIComponent(session.token)}`);
  eventSource.addEventListener("state", (event) => {
    room = JSON.parse(event.data).room;
    selectedWires = selectedWires.filter((id) => hasWire(id));
    render();
  });
  eventSource.onerror = () => setTimeout(refreshState, 1500);
}

async function refreshState() {
  if (!session.roomCode || !session.token) return;
  try {
    room = (await api(`/api/state?roomCode=${encodeURIComponent(session.roomCode)}&token=${encodeURIComponent(session.token)}`)).room;
    render();
  } catch (error) {
    showToast(error.message);
  }
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "请求失败。");
  return data;
}

async function post(url, body) {
  if (busy) return null;
  busy = true;
  render();
  try {
    const data = await api(url, { method: "POST", body: JSON.stringify(body) });
    if (data.room) room = data.room;
    return data;
  } catch (error) {
    lastError = error.message;
    showToast(error.message);
    return null;
  } finally {
    busy = false;
    render();
  }
}

function showToast(message) {
  $toast.textContent = message;
  $toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => $toast.classList.remove("show"), 3000);
}

function render() {
  if (!room) return renderHome();
  $app.innerHTML = `
    <div class="shell">
      ${renderHeader()}
      ${room.phase === "lobby" ? renderLobby() : renderGame(room.state)}
    </div>
  `;
  bindCommon();
  if (room.phase === "lobby") bindLobby();
  else bindGame();
}

function renderHome() {
  $app.innerHTML = `
    <main class="entry">
      <section class="entry-visual">
        <div class="bomb-core">
          <div class="timer">00:${String(59 - new Date().getSeconds()).padStart(2, "0")}</div>
          <div class="wire-line blue"></div>
          <div class="wire-line red"></div>
          <div class="wire-line yellow"></div>
          <div class="spark s1"></div>
          <div class="spark s2"></div>
        </div>
      </section>
      <section class="entry-panel">
        <div class="brand">Bomb Buster 在线拆弹</div>
        <h1>协作推理，剪对每一根线</h1>
        <form id="create-form" class="join-form">
          <label>你的名字
            <input name="name" maxlength="16" autocomplete="nickname" placeholder="拆弹员" />
          </label>
          <button class="primary" type="submit">创建房间</button>
        </form>
        <form id="join-form" class="join-form inline">
          <label>房间码
            <input name="roomCode" maxlength="8" autocomplete="off" placeholder="ABCD" />
          </label>
          <label>你的名字
            <input name="name" maxlength="16" autocomplete="nickname" placeholder="拆弹员" />
          </label>
          <button type="submit">加入</button>
        </form>
        <p class="entry-note">无需账号。部署在云服务器或局域网后，其他玩家打开同一地址并输入房间码即可。</p>
      </section>
    </main>
  `;
  document.querySelector("#create-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const data = await post("/api/create", { name: fd.get("name") });
    if (data) acceptSession(data);
  });
  document.querySelector("#join-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const data = await post("/api/join", { roomCode: fd.get("roomCode"), name: fd.get("name") });
    if (data) acceptSession(data);
  });
}

function acceptSession(data) {
  session = { roomCode: data.roomCode, token: data.token, playerId: data.playerId };
  storage.set(session);
  room = data.room;
  connectEvents();
  render();
}

function renderHeader() {
  const state = room.state;
  const active = state?.phase === "playing" ? ` · 当前行动：${escapeHtml(state.activePlayerName)}` : "";
  return `
    <header class="topbar">
      <div>
        <div class="brand compact">Bomb Buster</div>
        <div class="room-code">房间 ${room.code}${active}</div>
      </div>
      <div class="top-actions">
        <button class="ghost" data-copy="${room.code}">复制房间码</button>
        <button class="ghost danger" data-leave>离开本地会话</button>
      </div>
    </header>
  `;
}

function renderLobby() {
  const mission = room.mission;
  const custom = room.customConfig || {};
  return `
    <main class="lobby-grid">
      <section class="panel">
        <div class="section-title">队伍</div>
        <div class="players">
          ${room.players.map((player) => `
            <div class="player-chip ${player.id === room.you?.id ? "self" : ""}">
              <span>${escapeHtml(player.name)}</span>
              ${player.host ? "<small>房主</small>" : ""}
            </div>
          `).join("")}
        </div>
        <div class="hint-line">支持 2-5 人。其他玩家输入房间码 ${room.code} 加入。</div>
        <div class="actions">
          ${room.you?.host ? `<button class="primary" data-start ${room.players.length < 2 ? "disabled" : ""}>开始任务</button>` : `<button disabled>等待房主开始</button>`}
        </div>
      </section>

      <section class="panel">
        <div class="section-title">任务</div>
        <div class="mission-list">
          ${room.missions.map((item) => `
            <label class="mission-item ${room.missionId === item.id ? "active" : ""}">
              <input type="radio" name="missionId" value="${item.id}" ${room.missionId === item.id ? "checked" : ""} ${!room.you?.host ? "disabled" : ""} />
              <span>
                <b>${escapeHtml(item.name)}</b>
                <small>${escapeHtml(item.level)} · ${escapeHtml(item.recommendedPlayers)}</small>
              </span>
            </label>
          `).join("")}
        </div>
      </section>

      <section class="panel mission-panel">
        <div class="section-title">当前配置</div>
        <p>${escapeHtml(mission.description || "")}</p>
        <div class="stats-grid">
          <div><b>${mission.blueTotal}</b><span>蓝线</span></div>
          <div><b>${mission.yellowCount}</b><span>黄线</span></div>
          <div><b>${mission.redCount}</b><span>红线</span></div>
          <div><b>${mission.errorLimit}</b><span>错误上限</span></div>
        </div>
        ${room.missionId === "custom" ? renderCustomForm(custom, mission) : ""}
        <div class="equipment-help">
          ${Object.values(room.equipmentDefs).map((eq) => `<span title="${escapeAttr(eq.text)}">${eq.id}. ${escapeHtml(eq.name)}</span>`).join("")}
        </div>
      </section>
    </main>
  `;
}

function renderCustomForm(custom, mission) {
  const disabled = !room.you?.host ? "disabled" : "";
  return `
    <form id="custom-form" class="custom-form">
      <label>任务名称 <input name="name" value="${escapeAttr(custom.name || mission.name)}" ${disabled} /></label>
      <label>蓝线总数 <input name="blueTotal" type="number" min="8" max="48" step="4" value="${custom.blueTotal ?? mission.blueTotal}" ${disabled} /></label>
      <label>黄线数量 <input name="yellowCount" type="number" min="0" max="12" step="2" value="${custom.yellowCount ?? mission.yellowCount}" ${disabled} /></label>
      <label>红线数量 <input name="redCount" type="number" min="0" max="11" value="${custom.redCount ?? mission.redCount}" ${disabled} /></label>
      <label>错误上限 <input name="errorLimit" type="number" min="2" max="6" value="${custom.errorLimit ?? mission.errorLimit}" ${disabled} /></label>
      <label>装备数量 <input name="equipmentInPlay" type="number" min="0" max="8" value="${custom.equipmentInPlay ?? mission.equipmentInPlay}" ${disabled} /></label>
      <label class="wide">装备牌库编号 <input name="equipmentDeck" value="${escapeAttr((custom.equipmentDeck || []).join(","))}" ${disabled} /></label>
      ${room.you?.host ? `<button type="submit">保存自定义配置</button>` : ""}
    </form>
  `;
}

function renderGame(state) {
  return `
    <main class="game-grid">
      <section class="status-strip ${state.failure ? "failed" : ""} ${state.winner ? "won" : ""}">
        <div>
          <span>任务</span>
          <b>${escapeHtml(state.mission.name)}</b>
        </div>
        <div>
          <span>阶段</span>
          <b>${state.phase === "setup" ? "信息标记" : state.phase === "finished" ? "结束" : `第 ${state.turn} 回合`}</b>
        </div>
        <div>
          <span>蓝线</span>
          <b>${state.cutBlue} / ${state.totalBlue}</b>
        </div>
        <div>
          <span>未解除</span>
          <b>${state.totalUncut}</b>
        </div>
        <div>
          <span>引爆盘</span>
          <b>${state.errorCount} / ${state.errorLimit}</b>
        </div>
      </section>

      ${state.winner || state.failure ? `
        <section class="result-banner ${state.winner ? "won" : "failed"}">
          <b>${state.winner ? "任务成功" : "任务失败"}</b>
          <span>${state.winner ? "所有线都已解除。" : "任务已结束，所有线已公开。"}</span>
          ${room.you?.host ? `<button data-reset>回到大厅</button><button class="primary" data-start>再来一局</button>` : ""}
        </section>
      ` : ""}

      <section class="board">
        <div class="hands-zone">
          ${state.hands.map(renderHand).join("")}
        </div>
      </section>

      <aside class="side">
        ${renderActionPanel(state)}
        ${renderEquipmentPanel(state)}
        ${renderHintPanel(state)}
        ${renderLog(state)}
      </aside>
    </main>
  `;
}

function renderHand(hand) {
  return `
    <div class="hand ${hand.self ? "mine" : ""} ${hand.hintPlaced ? "hinted" : ""}">
      <div class="hand-title">
        <span>${escapeHtml(hand.playerName)}</span>
        <small>${hand.self ? "你的线架" : hand.hintPlaced ? "已放置信息" : "等待信息"}</small>
      </div>
      <div class="stand-list">
        ${hand.stands.map((stand) => `
          <div class="stand">
            <div class="stand-label">线架 ${stand.index + 1}</div>
            <div class="wire-rack">${stand.wires.map(renderWire).join("")}</div>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function renderWire(wire) {
  const selected = selectedWires.includes(wire.id);
  const hidden = !wire.visible;
  return `
    <button class="wire ${wire.kind} ${wire.cut ? "cut" : ""} ${selected ? "selected" : ""} ${hidden ? "hidden" : ""} ${wire.own ? "own" : ""}"
      data-wire-id="${wire.id}" ${wire.cut ? "disabled" : ""}
      title="${escapeAttr(wireTooltip(wire))}">
      <span class="wire-core"></span>
      <span class="wire-label">${escapeHtml(wire.cut ? "已剪" : wireText(wire))}</span>
      ${wire.marked ? `<span class="mark">${escapeHtml(wire.marked)}</span>` : ""}
    </button>
  `;
}

function renderActionPanel(state) {
  if (state.phase === "setup") return renderSetupPanel(state);
  const isTurn = state.activePlayerId === room.you?.id && !state.winner && !state.failure;
  return `
    <section class="panel action-panel">
      <div class="section-title">行动</div>
      <div class="turn-card ${isTurn ? "active" : ""}">
        <b>${isTurn ? "轮到你行动" : `等待 ${escapeHtml(state.activePlayerName)}`}</b>
        <span>${selectedWires.length ? `已选择 ${selectedWires.length} 根线` : "双剪选 2 根；单剪选自己 2 或 4 根相同线"}</span>
      </div>
      <div class="action-buttons">
        <button data-action="cutPair" ${!isTurn || selectedWires.length !== 2 ? "disabled" : ""}>双人剪线</button>
        <button data-action="soloCut" ${!isTurn || ![2, 4].includes(selectedWires.length) ? "disabled" : ""}>单人剪线</button>
        <button data-action="revealRed" ${!isTurn ? "disabled" : ""}>揭示红线</button>
        <button data-action="pass" ${!isTurn ? "disabled" : ""}>跳过</button>
        <button data-clear ${selectedWires.length ? "" : "disabled"}>清除选择</button>
      </div>
      ${lastError ? `<div class="error-line">${escapeHtml(lastError)}</div>` : ""}
    </section>
  `;
}

function renderSetupPanel(state) {
  const ownHand = state.hands.find((hand) => hand.playerId === room.you?.id);
  const placed = Boolean(ownHand?.hintPlaced);
  return `
    <section class="panel action-panel">
      <div class="section-title">初始信息</div>
      <div class="turn-card ${!placed ? "active" : ""}">
        <b>${placed ? "你已放置信息标记" : "选择自己 1 根蓝线"}</b>
        <span>每名玩家要公开自己线架上的 1 根蓝线。全部完成后开始回合。</span>
      </div>
      <div class="action-buttons">
        <button data-action="placeHint" ${placed || selectedWires.length !== 1 ? "disabled" : ""}>放置信息标记</button>
        <button data-clear ${selectedWires.length ? "" : "disabled"}>清除选择</button>
      </div>
      ${lastError ? `<div class="error-line">${escapeHtml(lastError)}</div>` : ""}
    </section>
  `;
}

function renderEquipmentPanel(state) {
  const isTurn = state.phase === "playing" && state.activePlayerId === room.you?.id && !state.winner && !state.failure;
  return `
    <section class="panel">
      <div class="section-title">装备</div>
      <div class="locked-list">
        ${state.lockedEquipment.length ? state.lockedEquipment.map((eq) => `<span title="剪断两根 ${eq.id} 号蓝线后解锁">${eq.id}. ${escapeHtml(eq.name)}</span>`).join("") : ""}
      </div>
      <div class="equipment-list">
        ${state.unlockedEquipment.length ? state.unlockedEquipment.map((eq) => `
          <button class="equipment ${selectedEquipment === eq.instanceId ? "selected" : ""}" data-equipment="${eq.instanceId}" ${!isTurn ? "disabled" : ""}>
            <b>${escapeHtml(eq.name)}</b>
            <span>${escapeHtml(eq.text)}</span>
          </button>
        `).join("") : `<div class="empty">还没有可用装备。剪断对应数字的两根蓝线会解锁。</div>`}
      </div>
      ${selectedEquipment ? renderEquipmentControls(state, selectedEquipment, isTurn) : ""}
      <div class="deck-note">装备牌库剩余 ${state.equipmentDeckCount}</div>
    </section>
  `;
}

function renderEquipmentControls(state, instanceId, isTurn) {
  const eq = state.unlockedEquipment.find((item) => item.instanceId === instanceId);
  if (!eq) return "";
  if (["detect", "markOne", "revealOwn"].includes(eq.type)) {
    return `
      <div class="equipment-controls">
        ${eq.type === "markOne" ? `<input id="equip-mark" maxlength="10" placeholder="标记文字" value="重点" />` : ""}
        <button data-use-equipment="${eq.instanceId}" ${!isTurn || selectedWires.length !== 1 ? "disabled" : ""}>使用${escapeHtml(eq.name)}</button>
      </div>
    `;
  }
  if (eq.type === "scanNumber") {
    return `
      <div class="equipment-controls row">
        <select id="equip-value">${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join("")}</select>
        <button data-use-equipment="${eq.instanceId}" ${!isTurn ? "disabled" : ""}>扫描数字</button>
      </div>
    `;
  }
  if (eq.type === "handoff") {
    return `
      <div class="equipment-controls row">
        <select id="equip-target">${room.players.map((player) => `<option value="${player.id}">${escapeHtml(player.name)}</option>`).join("")}</select>
        <button data-use-equipment="${eq.instanceId}" ${!isTurn ? "disabled" : ""}>交接行动</button>
      </div>
    `;
  }
  return `<div class="equipment-controls"><button data-use-equipment="${eq.instanceId}" ${!isTurn ? "disabled" : ""}>使用${escapeHtml(eq.name)}</button></div>`;
}

function renderHintPanel(state) {
  return `
    <section class="panel hints">
      <div class="section-title">公开信息</div>
      <div class="hint-grid player-hints">
        ${state.hands.map((hand) => `
          <div class="hint-token ${hand.hintPlaced ? "done" : ""}">
            <b>${escapeHtml(hand.playerName.slice(0, 2))}</b>
            <span>${hand.hintPlaced ? "已放置" : "等待中"}</span>
          </div>
        `).join("")}
      </div>
    </section>
  `;
}

function renderLog(state) {
  const logs = (state.log || room.log || []).slice(-24).reverse();
  return `
    <section class="panel log-panel">
      <div class="section-title">记录</div>
      <div class="logs">
        ${logs.map((item) => `<div><time>${formatTime(item.at)}</time><span>${escapeHtml(item.text)}</span></div>`).join("")}
      </div>
    </section>
  `;
}

function bindCommon() {
  document.querySelectorAll("[data-copy]").forEach((button) => {
    button.addEventListener("click", async () => {
      await navigator.clipboard?.writeText(button.dataset.copy).catch(() => {});
      showToast("房间码已复制。");
    });
  });
  document.querySelectorAll("[data-leave]").forEach((button) => {
    button.addEventListener("click", () => {
      storage.clear();
      session = {};
      room = null;
      selectedWires = [];
      if (eventSource) eventSource.close();
      renderHome();
    });
  });
}

function bindLobby() {
  document.querySelectorAll("input[name='missionId']").forEach((input) => {
    input.addEventListener("change", () => post("/api/config", { roomCode: room.code, token: session.token, missionId: input.value }));
  });
  document.querySelector("[data-start]")?.addEventListener("click", () => {
    selectedWires = [];
    post("/api/start", { roomCode: room.code, token: session.token });
  });
  document.querySelector("#custom-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    post("/api/config", {
      roomCode: room.code,
      token: session.token,
      missionId: "custom",
      customConfig: Object.fromEntries(fd.entries())
    });
  });
}

function bindGame() {
  document.querySelectorAll("[data-reset]").forEach((button) => {
    button.addEventListener("click", () => post("/api/reset", { roomCode: room.code, token: session.token }));
  });
  document.querySelectorAll("[data-start]").forEach((button) => {
    button.addEventListener("click", () => post("/api/start", { roomCode: room.code, token: session.token }));
  });
  document.querySelectorAll("[data-wire-id]").forEach((button) => {
    button.addEventListener("click", () => toggleWire(button.dataset.wireId));
  });
  document.querySelector("[data-clear]")?.addEventListener("click", () => {
    selectedWires = [];
    render();
  });
  document.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => runAction(button.dataset.action));
  });
  document.querySelectorAll("[data-equipment]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedEquipment = selectedEquipment === button.dataset.equipment ? null : button.dataset.equipment;
      render();
    });
  });
  document.querySelectorAll("[data-use-equipment]").forEach((button) => {
    button.addEventListener("click", () => useEquipment(button.dataset.useEquipment));
  });
}

function toggleWire(id) {
  if (selectedWires.includes(id)) selectedWires = selectedWires.filter((item) => item !== id);
  else {
    selectedWires.push(id);
    if (selectedWires.length > 4) selectedWires = selectedWires.slice(-4);
  }
  render();
}

async function runAction(action) {
  lastError = "";
  if (action === "placeHint") {
    await post("/api/action", { roomCode: room.code, token: session.token, action, wireId: selectedWires[0] });
  } else if (action === "cutPair") {
    await post("/api/action", { roomCode: room.code, token: session.token, action, firstWireId: selectedWires[0], secondWireId: selectedWires[1] });
  } else if (action === "soloCut") {
    await post("/api/action", { roomCode: room.code, token: session.token, action, wireIds: selectedWires });
  } else if (action === "revealRed" || action === "pass") {
    await post("/api/action", { roomCode: room.code, token: session.token, action });
  }
  selectedWires = [];
}

async function useEquipment(instanceId) {
  const eq = room.state.unlockedEquipment.find((item) => item.instanceId === instanceId);
  if (!eq) return;
  const body = { roomCode: room.code, token: session.token, action: "useEquipment", equipmentInstanceId: instanceId };
  if (["detect", "markOne", "revealOwn"].includes(eq.type)) body.wireId = selectedWires[0];
  if (eq.type === "markOne") body.mark = document.querySelector("#equip-mark")?.value || "重点";
  if (eq.type === "scanNumber") body.value = document.querySelector("#equip-value")?.value || 1;
  if (eq.type === "handoff") body.targetPlayerId = document.querySelector("#equip-target")?.value;
  await post("/api/action", body);
  selectedEquipment = null;
  selectedWires = [];
}

function hasWire(id) {
  if (!room?.state) return false;
  return room.state.hands
    .flatMap((hand) => hand.stands.flatMap((stand) => stand.wires))
    .some((wire) => wire.id === id && !wire.cut);
}

function wireText(wire) {
  if (wire.kind === "blue") return String(wire.value);
  if (wire.kind === "yellow") return "黄";
  if (wire.kind === "red") return "红";
  return "?";
}

function wireTooltip(wire) {
  if (wire.kind === "blue") return `${wire.value} 号蓝线`;
  if (wire.kind === "yellow") return "黄线";
  if (wire.kind === "red") return "红线";
  return wire.own ? "你的线：隐藏" : "队友的线：隐藏";
}

function formatTime(time) {
  const date = new Date(time);
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

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}
