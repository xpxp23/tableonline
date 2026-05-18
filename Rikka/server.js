const http = require("http");
const fs = require("fs");
const path = require("path");
const { Game } = require("./src/game");

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");
const rooms = new Map();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

function now() {
  return Date.now();
}

function roomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let tries = 0; tries < 100; tries += 1) {
    let code = "";
    for (let i = 0; i < 4; i += 1) code += alphabet[Math.floor(Math.random() * alphabet.length)];
    if (!rooms.has(code)) return code;
  }
  return String(Math.floor(100000 + Math.random() * 900000));
}

function playerId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function json(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(text)
  });
  res.end(text);
}

function notFound(res) {
  json(res, 404, { error: "未找到资源" });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("请求体过大"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error("JSON 格式错误"));
      }
    });
    req.on("error", reject);
  });
}

function cleanName(name) {
  const fallback = "玩家";
  if (typeof name !== "string") return fallback;
  const value = name.trim().slice(0, 16);
  return value || fallback;
}

function normalizeCode(code) {
  return String(code || "").trim().toUpperCase();
}

function getRoom(code) {
  return rooms.get(normalizeCode(code));
}

function makeRoom(name) {
  const code = roomCode();
  const id = playerId();
  const game = new Game();
  game.addPlayer(id, cleanName(name));
  rooms.set(code, {
    code,
    game,
    createdAt: now(),
    touchedAt: now(),
    revision: 1
  });
  return { room: rooms.get(code), playerId: id };
}

function touch(room) {
  room.touchedAt = now();
  room.revision += 1;
}

function asClientState(room, id) {
  return {
    code: room.code,
    playerId: id,
    revision: room.revision,
    state: room.game.viewFor(id)
  };
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const rawPath = decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(PUBLIC_DIR, rawPath === "/" ? "index.html" : rawPath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    notFound(res);
    return;
  }
  fs.stat(filePath, (statError, stat) => {
    if (statError || !stat.isFile()) {
      notFound(res);
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": ext === ".html" ? "no-store" : "public, max-age=3600"
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === "POST" && url.pathname === "/api/create") {
      const body = await readBody(req);
      const { room, playerId: id } = makeRoom(body.name);
      json(res, 200, asClientState(room, id));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/join") {
      const body = await readBody(req);
      const room = getRoom(body.code);
      if (!room) {
        json(res, 404, { error: "房间不存在" });
        return;
      }
      const id = playerId();
      room.game.addPlayer(id, cleanName(body.name));
      touch(room);
      json(res, 200, asClientState(room, id));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/state") {
      const code = url.searchParams.get("code");
      const id = url.searchParams.get("playerId");
      const room = getRoom(code);
      if (!room || !id) {
        json(res, 404, { error: "房间不存在或身份已失效" });
        return;
      }
      room.game.markSeen(id);
      room.touchedAt = now();
      json(res, 200, asClientState(room, id));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/action") {
      const body = await readBody(req);
      const room = getRoom(body.code);
      if (!room || !body.playerId) {
        json(res, 404, { error: "房间不存在或身份已失效" });
        return;
      }
      const result = room.game.action(body.playerId, body.type, body.payload || {});
      touch(room);
      json(res, 200, {
        ...asClientState(room, body.playerId),
        result
      });
      return;
    }

    notFound(res);
  } catch (error) {
    json(res, 400, { error: error.message || "请求失败" });
  }
}

function cleanupRooms() {
  const cutoff = now() - 12 * 60 * 60 * 1000;
  for (const [code, room] of rooms.entries()) {
    if (room.touchedAt < cutoff) rooms.delete(code);
  }
}

setInterval(cleanupRooms, 30 * 60 * 1000).unref();

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/")) {
    handleApi(req, res);
    return;
  }
  serveStatic(req, res);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`六华网页版已启动：http://127.0.0.1:${PORT}`);
});
