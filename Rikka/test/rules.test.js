const assert = require("assert");
const { Game, makeDeck, evaluatePatterns, bestPattern } = require("../src/game");

function tile(id, top, bottom, glow = false) {
  return { id, top, bottom, glow };
}

function names(patterns) {
  return patterns.map(pattern => pattern.id);
}

assert.strictEqual(makeDeck().length, 42, "六华应有 21 种牌，每种 2 枚");

assert(names(evaluatePatterns([
  tile("a", 1, 1, true),
  tile("b", 1, 2),
  tile("c", 1, 3),
  tile("d", 1, 4),
  tile("e", 1, 5),
  tile("f", 1, 6)
], { optionalPatterns: true })).includes("sameColor"), "一色识别失败");

assert(names(evaluatePatterns([
  tile("a", 1, 6),
  tile("b", 2, 6),
  tile("c", 3, 6),
  tile("d", 3, 5),
  tile("e", 4, 5),
  tile("f", 5, 5, true)
], { optionalPatterns: true })).includes("threeRun"), "三连识别失败");

assert(names(evaluatePatterns([
  tile("a", 1, 6),
  tile("b", 2, 6),
  tile("c", 3, 6),
  tile("d", 4, 6),
  tile("e", 5, 6),
  tile("f", 6, 6, true)
], { optionalPatterns: true })).includes("rikka"), "六华识别失败");

assert(names(evaluatePatterns([
  tile("a1", 1, 2),
  tile("a2", 1, 2),
  tile("b1", 3, 4),
  tile("b2", 3, 4),
  tile("c1", 5, 6),
  tile("c2", 5, 6)
], { optionalPatterns: true })).includes("threePairs"), "三对识别失败");

assert(names(evaluatePatterns([
  tile("a1", 1, 2),
  tile("a2", 1, 2),
  tile("b1", 2, 3),
  tile("b2", 2, 3),
  tile("c1", 1, 3),
  tile("c2", 1, 3)
], { optionalPatterns: true })).includes("threeColors"), "三色识别失败");

assert(names(evaluatePatterns([
  tile("a", 1, 1, true),
  tile("b", 2, 2, true),
  tile("c", 3, 3, true),
  tile("d", 4, 4, true),
  tile("e", 5, 5, true),
  tile("f", 6, 6, true)
], { optionalPatterns: true })).includes("unrivaled"), "无双识别失败");

assert.strictEqual(bestPattern([
  tile("a", 1, 1, true),
  tile("b", 2, 2, true),
  tile("c", 3, 3, true),
  tile("d", 4, 4, true),
  tile("e", 5, 5, true),
  tile("f", 6, 6, true)
], { optionalPatterns: true }).score, 9, "无双应含辉光加分后为 9 分");

assert(names(evaluatePatterns([
  tile("a", 1, 1, true),
  tile("b", 2, 2, true),
  tile("c", 3, 3, true),
  tile("d", 4, 4, true),
  tile("e", 5, 5, true),
  tile("f", 1, 1, true)
], { optionalPatterns: true })).includes("spark"), "辉光识别失败");

const game = new Game(() => 0.5);
game.addPlayer("p1", "甲");
game.addPlayer("p2", "乙");
game.players.forEach(player => { player.ready = true; });
game.startGame(game.players[0]);
assert.strictEqual(game.phase, "playing", "应能开始对局");
assert.strictEqual(game.players[0].hand.length, 5, "起手应为 5 张");
assert.strictEqual(game.table.length, 32, "2 人局场上应剩余 32 张牌");

game.players[0].hand = [
  tile("h1", 1, 6),
  tile("h2", 2, 6),
  tile("h3", 3, 6),
  tile("h4", 4, 6),
  tile("h5", 5, 6)
];
game.table[0] = { id: "slot-win", tile: tile("win", 6, 6, true), faceUp: true };
game.drawTable(game.players[0], "slot-win");
game.declareWin(game.players[0], "rikka");
assert.strictEqual(game.phase, "roundEnd", "完成后应结束本局");
assert.strictEqual(game.players[0].score, 7, "六华应叠加辉光加分");

console.log("规则测试通过");
