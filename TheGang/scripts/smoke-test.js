"use strict";

const http = require("http");
const crypto = require("crypto");
const net = require("net");
const { spawn } = require("child_process");

const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT || 3000);
const ROOM = `T${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
let ownedServer = null;

function get(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: HOST, port: PORT, path }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode));
    }).on("error", reject);
  });
}

function encodeFrame(text) {
  const payload = Buffer.from(text);
  if (payload.length >= 126) throw new Error("Smoke test frame too large.");
  const mask = crypto.randomBytes(4);
  const header = Buffer.from([0x81, 0x80 | payload.length]);
  const masked = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i += 1) masked[i] = payload[i] ^ mask[i % 4];
  return Buffer.concat([header, mask, masked]);
}

function decodeFrames(client) {
  let offset = 0;
  while (client.buffer.length - offset >= 2) {
    const first = client.buffer[offset];
    const second = client.buffer[offset + 1];
    const opcode = first & 0x0f;
    let length = second & 0x7f;
    let headerLength = 2;
    if (length === 126) {
      if (client.buffer.length - offset < 4) break;
      length = client.buffer.readUInt16BE(offset + 2);
      headerLength = 4;
    }
    if (client.buffer.length - offset < headerLength + length) break;
    const payload = client.buffer.slice(offset + headerLength, offset + headerLength + length);
    offset += headerLength + length;
    if (opcode === 1) client.messages.push(JSON.parse(payload.toString("utf8")));
  }
  client.buffer = client.buffer.slice(offset);
}

function connectClient(name) {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString("base64");
    const socket = net.connect(PORT, HOST, () => {
      socket.write(
        [
          "GET / HTTP/1.1",
          `Host: ${HOST}:${PORT}`,
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Key: ${key}`,
          "Sec-WebSocket-Version: 13",
          "",
          ""
        ].join("\r\n")
      );
    });

    const client = {
      name,
      socket,
      buffer: Buffer.alloc(0),
      messages: [],
      state: null,
      send(payload) {
        socket.write(encodeFrame(JSON.stringify(payload)));
      },
      waitFor(predicate, timeout = 2000) {
        return new Promise((resolveWait, rejectWait) => {
          const deadline = Date.now() + timeout;
          const tick = () => {
            const found = client.messages.find(predicate);
            if (found) return resolveWait(found);
            if (Date.now() > deadline) return rejectWait(new Error(`Timeout waiting for ${name}`));
            setTimeout(tick, 20);
          };
          tick();
        });
      },
      close() {
        socket.end();
      }
    };

    let handshake = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      if (!client.ready) {
        handshake = Buffer.concat([handshake, chunk]);
        const marker = handshake.indexOf("\r\n\r\n");
        if (marker >= 0) {
          client.ready = true;
          const rest = handshake.slice(marker + 4);
          if (rest.length) {
            client.buffer = Buffer.concat([client.buffer, rest]);
            decodeFrames(client);
            const latestState = client.messages.filter((msg) => msg.type === "state").at(-1);
            if (latestState) client.state = latestState;
          }
          resolve(client);
        }
      } else {
        client.buffer = Buffer.concat([client.buffer, chunk]);
        decodeFrames(client);
        const latestState = client.messages.filter((msg) => msg.type === "state").at(-1);
        if (latestState) client.state = latestState;
      }
    });
    socket.on("error", reject);
  });
}

async function waitAllState(clients, predicate, timeout = 2500) {
  await Promise.all(
    clients.map((client) =>
      new Promise((resolve, reject) => {
        const deadline = Date.now() + timeout;
        const tick = () => {
          if (client.state && predicate(client.state)) return resolve(client.state);
          if (Date.now() > deadline) return reject(new Error(`Timeout waiting for ${client.name}`));
          setTimeout(tick, 20);
        };
        tick();
      })
    )
  );
}

function latestState(client) {
  return client.state;
}

async function createRoom(names, roomId) {
  const clients = await Promise.all(names.map(connectClient));
  clients.forEach((client) => client.send({ type: "join", roomId, name: client.name }));
  await waitAllState(clients, (msg) => msg.room.players.filter((p) => !p.left).length === names.length);
  return clients;
}

async function playRound(clients, chipPicker) {
  clients[0].send({ type: "start" });
  await waitAllState(clients, (msg) => msg.room.phase === "betting" && msg.game);

  while (latestState(clients[0]).room.phase === "betting") {
    const stageIndex = latestState(clients[0]).game.stageIndex;
    await waitAllState(clients, (msg) => msg.game && msg.game.stageIndex === stageIndex && !msg.game.pending);

    const assignments = chipPicker(clients.map(latestState), stageIndex);
    assignments.forEach((chip, playerIndex) => {
      clients[playerIndex].send({ type: "moveChip", chip });
    });
    await waitAllState(clients, (msg) => msg.game && Object.keys(msg.game.currentColorAssignments).length === clients.length);
    clients[0].send({ type: "advance" });
    await new Promise((resolve) => setTimeout(resolve, 60));
  }

  await waitAllState(clients, (msg) => msg.room.phase === "complete");
  return latestState(clients[0]).game.result;
}

function closeClients(clients) {
  clients.forEach((client) => client.close());
}

async function main() {
  if (process.env.START_SERVER === "1") {
    ownedServer = spawn(process.execPath, ["server.js"], {
      cwd: process.cwd(),
      env: { ...process.env, PORT: String(PORT) },
      stdio: "ignore",
      windowsHide: true
    });
    await new Promise((resolve) => setTimeout(resolve, 800));
  }

  const status = await get("/");
  if (status !== 200) throw new Error(`HTTP status ${status}`);

  const clients = await createRoom(["甲", "乙", "丙"], ROOM);
  const basicResult = await playRound(clients, () => [1, 2, 3]);
  if (typeof basicResult.success !== "boolean") throw new Error("Basic round did not produce a result.");
  closeClients(clients);

  const failRoom = `${ROOM}F`;
  const failClients = await createRoom(["丁", "戊", "己"], failRoom);
  const failResult = await playRound(failClients, () => [3, 2, 1]);
  if (failResult.success !== false) throw new Error("Intentionally reversed chips should fail.");
  closeClients(failClients);

  const advancedRoom = `${ROOM}A`;
  const advancedClients = await createRoom(["庚", "辛", "壬"], advancedRoom);
  advancedClients[0].send({ type: "settings", modeId: "advanced" });
  await waitAllState(advancedClients, (msg) => msg.room.settings.modeId === "advanced");
  await playRound(advancedClients, () => [3, 2, 1]);
  if (!latestState(advancedClients[0]).room.upcomingSupport) {
    throw new Error("Advanced mode should schedule a support card after a result.");
  }
  closeClients(advancedClients);

  console.log(`smoke ok room=${ROOM}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
}).finally(() => {
  if (ownedServer) ownedServer.kill();
});
