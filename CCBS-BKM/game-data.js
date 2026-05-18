const COLOR_KEYS = ["red", "green", "blue", "yellow", "purple"];

const COLORS = [
  { key: "red", name: "红球", short: "红", hex: "#e5484d" },
  { key: "green", name: "绿球", short: "绿", hex: "#2f9e44" },
  { key: "blue", name: "蓝球", short: "蓝", hex: "#1c7ed6" },
  { key: "yellow", name: "黄球", short: "黄", hex: "#f59f00" },
  { key: "purple", name: "紫球", short: "紫", hex: "#8b5cf6" },
];

const MASTER = { key: "master", name: "大师球", short: "师", hex: "#7c3aed" };

const emptyCost = () => ({ red: 0, green: 0, blue: 0, yellow: 0, purple: 0 });

function cost(values = {}) {
  return { ...emptyCost(), ...values };
}

function card(id, name, tier, bonus, points, captureCost, options = {}) {
  return {
    id,
    name,
    tier,
    kind: options.kind || "normal",
    rarity: options.rarity || "普通",
    bonus: Array.isArray(bonus) ? bonus : [bonus],
    points,
    cost: cost(captureCost),
    masterCost: options.masterCost || 0,
    evolvesFrom: options.evolvesFrom || null,
    evolvesTo: options.evolvesTo || null,
    evolveCost: options.evolveCost ? cost(options.evolveCost) : null,
    type: options.type || bonus,
    glyph: options.glyph || name.slice(0, 1),
  };
}

const CARDS = [
  card("t1-bulbasaur", "妙蛙种子", 1, "green", 0, { blue: 1, yellow: 1 }, { evolvesTo: "妙蛙草", type: "草", glyph: "芽" }),
  card("t1-charmander", "小火龙", 1, "red", 0, { green: 1, yellow: 1 }, { evolvesTo: "火恐龙", type: "火", glyph: "火" }),
  card("t1-squirtle", "杰尼龟", 1, "blue", 0, { red: 1, purple: 1 }, { evolvesTo: "卡咪龟", type: "水", glyph: "水" }),
  card("t1-abra", "凯西", 1, "yellow", 0, { blue: 1, purple: 1 }, { evolvesTo: "勇基拉", type: "超", glyph: "念" }),
  card("t1-machop", "腕力", 1, "red", 0, { green: 1, blue: 1 }, { evolvesTo: "豪力", type: "斗", glyph: "拳" }),
  card("t1-gastly", "鬼斯", 1, "purple", 0, { red: 1, yellow: 1 }, { evolvesTo: "鬼斯通", type: "幽", glyph: "幽" }),
  card("t1-dratini", "迷你龙", 1, "blue", 0, { red: 1, green: 1, purple: 1 }, { evolvesTo: "哈克龙", type: "龙", glyph: "龙" }),
  card("t1-ralts", "拉鲁拉丝", 1, "yellow", 0, { green: 1, purple: 1 }, { evolvesTo: "奇鲁莉安", type: "超", glyph: "心" }),
  card("t1-beldum", "铁哑铃", 1, "purple", 0, { red: 1, blue: 1 }, { evolvesTo: "金属怪", type: "钢", glyph: "钢" }),
  card("t1-gible", "圆陆鲨", 1, "red", 0, { blue: 1, yellow: 1, purple: 1 }, { evolvesTo: "尖牙陆鲨", type: "龙", glyph: "牙" }),
  card("t1-pikachu", "皮卡丘", 1, "yellow", 0, { red: 2 }, { evolvesTo: "雷丘", type: "电", glyph: "电" }),
  card("t1-eevee", "伊布", 1, "green", 0, { blue: 1, red: 1 }, { evolvesTo: "水伊布", type: "普", glyph: "伊" }),
  card("t1-magikarp", "鲤鱼王", 1, "blue", 0, { red: 1, green: 1 }, { evolvesTo: "暴鲤龙", type: "水", glyph: "鲤" }),
  card("t1-vulpix", "六尾", 1, "red", 0, { yellow: 2 }, { evolvesTo: "九尾", type: "火", glyph: "焰" }),
  card("t1-sandshrew", "穿山鼠", 1, "yellow", 0, { green: 2 }, { evolvesTo: "穿山王", type: "地", glyph: "地" }),
  card("t1-ekans", "阿柏蛇", 1, "purple", 0, { blue: 2 }, { evolvesTo: "阿柏怪", type: "毒", glyph: "毒" }),
  card("t1-paras", "派拉斯", 1, "green", 0, { purple: 1, yellow: 1 }, { evolvesTo: "派拉斯特", type: "虫", glyph: "菇" }),
  card("t1-mankey", "猴怪", 1, "purple", 0, { red: 1, green: 1 }, { evolvesTo: "火暴猴", type: "斗", glyph: "怒" }),
  card("t1-grimer", "臭泥", 1, "purple", 0, { blue: 1, green: 1 }, { evolvesTo: "臭臭泥", type: "毒", glyph: "泥" }),
  card("t1-psyduck", "可达鸭", 1, "blue", 0, { yellow: 1, green: 1 }, { evolvesTo: "哥达鸭", type: "水", glyph: "鸭" }),
  card("t1-shellder", "大舌贝", 1, "blue", 0, { purple: 2 }, { evolvesTo: "刺甲贝", type: "水", glyph: "贝" }),
  card("t1-growlithe", "卡蒂狗", 1, "red", 0, { green: 1, yellow: 1 }, { evolvesTo: "风速狗", type: "火", glyph: "犬" }),
  card("t1-voltorb", "霹雳电球", 1, "yellow", 0, { blue: 1, red: 1 }, { evolvesTo: "顽皮雷弹", type: "电", glyph: "雷" }),
  card("t1-exeggcute", "蛋蛋", 1, "green", 0, { red: 1, purple: 1 }, { evolvesTo: "椰蛋树", type: "草", glyph: "椰" }),
  card("t1-onix", "大岩蛇", 1, "purple", 0, { yellow: 1, blue: 1 }, { evolvesTo: "大钢蛇", type: "岩", glyph: "岩" }),
  card("t1-meowth", "喵喵", 1, "yellow", 0, { green: 1 }, { type: "普", glyph: "爪" }),
  card("t1-jigglypuff", "胖丁", 1, "purple", 0, { red: 1 }, { type: "妖", glyph: "歌" }),
  card("t1-cubone", "可拉可拉", 1, "red", 0, { blue: 1 }, { type: "地", glyph: "骨" }),
  card("t1-magnemite", "小磁怪", 1, "blue", 0, { yellow: 1 }, { type: "电", glyph: "磁" }),
  card("t1-pidgey", "波波", 1, "green", 0, { purple: 1 }, { type: "飞", glyph: "羽" }),
  card("t1-slowpoke", "呆呆兽", 1, "blue", 0, { green: 1 }, { type: "水", glyph: "呆" }),
  card("t1-horsea", "墨海马", 1, "blue", 0, { red: 1 }, { type: "水", glyph: "潮" }),
  card("t1-venonat", "毛球", 1, "purple", 0, { yellow: 1 }, { type: "虫", glyph: "目" }),
  card("t1-scyther", "飞天螳螂", 1, "green", 1, { blue: 2 }, { type: "虫", glyph: "刃" }),
  card("t1-kangaskhan", "袋兽", 1, "red", 1, { purple: 2 }, { type: "普", glyph: "袋" }),
  card("t1-tauros", "肯泰罗", 1, "yellow", 1, { red: 1, blue: 1 }, { type: "普", glyph: "角" }),
  card("t1-farfetchd", "大葱鸭", 1, "green", 1, { yellow: 1 }, { type: "飞", glyph: "葱" }),
  card("t1-chansey", "吉利蛋", 1, "purple", 1, { green: 1, blue: 1 }, { type: "普", glyph: "蛋" }),
  card("t1-ditto", "百变怪", 1, "purple", 0, { red: 1, green: 1 }, { type: "普", glyph: "变" }),
  card("t1-kabuto", "化石盔", 1, "blue", 1, { purple: 1, green: 1 }, { type: "岩", glyph: "化" }),

  card("t2-ivysaur", "妙蛙草", 2, "green", 1, { red: 2, blue: 2 }, { evolvesFrom: "妙蛙种子", evolvesTo: "妙蛙花", evolveCost: { green: 2 }, type: "草", glyph: "藤" }),
  card("t2-charmeleon", "火恐龙", 2, "red", 1, { green: 2, yellow: 2 }, { evolvesFrom: "小火龙", evolvesTo: "喷火龙", evolveCost: { red: 2 }, type: "火", glyph: "炎" }),
  card("t2-wartortle", "卡咪龟", 2, "blue", 1, { red: 2, purple: 2 }, { evolvesFrom: "杰尼龟", evolvesTo: "水箭龟", evolveCost: { blue: 2 }, type: "水", glyph: "浪" }),
  card("t2-kadabra", "勇基拉", 2, "yellow", 1, { blue: 2, purple: 2 }, { evolvesFrom: "凯西", evolvesTo: "胡地", evolveCost: { yellow: 2 }, type: "超", glyph: "幻" }),
  card("t2-machoke", "豪力", 2, "red", 1, { green: 3, blue: 1 }, { evolvesFrom: "腕力", evolvesTo: "怪力", evolveCost: { red: 2 }, type: "斗", glyph: "力" }),
  card("t2-haunter", "鬼斯通", 2, "purple", 1, { red: 2, yellow: 2 }, { evolvesFrom: "鬼斯", evolvesTo: "耿鬼", evolveCost: { purple: 2 }, type: "幽", glyph: "影" }),
  card("t2-dragonair", "哈克龙", 2, "blue", 2, { red: 2, green: 2, purple: 1 }, { evolvesFrom: "迷你龙", evolvesTo: "快龙", evolveCost: { blue: 2, yellow: 1 }, type: "龙", glyph: "云" }),
  card("t2-kirlia", "奇鲁莉安", 2, "yellow", 2, { green: 2, purple: 2, red: 1 }, { evolvesFrom: "拉鲁拉丝", evolvesTo: "沙奈朵", evolveCost: { yellow: 2, green: 1 }, type: "超", glyph: "舞" }),
  card("t2-metang", "金属怪", 2, "purple", 2, { red: 2, blue: 2, green: 1 }, { evolvesFrom: "铁哑铃", evolvesTo: "巨金怪", evolveCost: { purple: 2, blue: 1 }, type: "钢", glyph: "铠" }),
  card("t2-gabite", "尖牙陆鲨", 2, "red", 2, { blue: 2, yellow: 2, purple: 1 }, { evolvesFrom: "圆陆鲨", evolvesTo: "烈咬陆鲨", evolveCost: { red: 2, green: 1 }, type: "龙", glyph: "鳍" }),
  card("t2-raichu", "雷丘", 2, "yellow", 2, { red: 3, blue: 2 }, { evolvesFrom: "皮卡丘", evolveCost: { yellow: 3 }, type: "电", glyph: "闪" }),
  card("t2-vaporeon", "水伊布", 2, "blue", 2, { green: 2, purple: 2, yellow: 1 }, { evolvesFrom: "伊布", evolveCost: { green: 2, blue: 1 }, type: "水", glyph: "澜" }),
  card("t2-gyarados", "暴鲤龙", 2, "blue", 3, { red: 3, green: 2, purple: 1 }, { evolvesFrom: "鲤鱼王", evolveCost: { blue: 3 }, type: "水", glyph: "怒" }),
  card("t2-ninetales", "九尾", 2, "red", 2, { yellow: 3, purple: 2 }, { evolvesFrom: "六尾", evolveCost: { red: 2, yellow: 1 }, type: "火", glyph: "狐" }),
  card("t2-sandslash", "穿山王", 2, "yellow", 2, { green: 3, red: 2 }, { evolvesFrom: "穿山鼠", evolveCost: { yellow: 2, purple: 1 }, type: "地", glyph: "爪" }),
  card("t2-arbok", "阿柏怪", 2, "purple", 2, { blue: 3, yellow: 2 }, { evolvesFrom: "阿柏蛇", evolveCost: { purple: 2, red: 1 }, type: "毒", glyph: "蛇" }),
  card("t2-parasect", "派拉斯特", 2, "green", 2, { purple: 2, yellow: 2, red: 1 }, { evolvesFrom: "派拉斯", evolveCost: { green: 2 }, type: "虫", glyph: "菌" }),
  card("t2-primeape", "火暴猴", 2, "red", 2, { red: 1, green: 3, blue: 1 }, { evolvesFrom: "猴怪", evolveCost: { purple: 2, red: 1 }, type: "斗", glyph: "暴" }),
  card("t2-muk", "臭臭泥", 2, "purple", 2, { blue: 2, green: 2, red: 1 }, { evolvesFrom: "臭泥", evolveCost: { purple: 2 }, type: "毒", glyph: "污" }),
  card("t2-golduck", "哥达鸭", 2, "blue", 2, { yellow: 2, green: 3 }, { evolvesFrom: "可达鸭", evolveCost: { blue: 2, yellow: 1 }, type: "水", glyph: "念" }),
  card("t2-cloyster", "刺甲贝", 2, "blue", 2, { purple: 3, green: 1, red: 1 }, { evolvesFrom: "大舌贝", evolveCost: { blue: 2, purple: 1 }, type: "水", glyph: "刺" }),
  card("t2-arcanine", "风速狗", 2, "red", 3, { green: 3, yellow: 2, blue: 1 }, { evolvesFrom: "卡蒂狗", evolveCost: { red: 3 }, type: "火", glyph: "风" }),
  card("t2-electrode", "顽皮雷弹", 2, "yellow", 2, { blue: 2, red: 2, green: 1 }, { evolvesFrom: "霹雳电球", evolveCost: { yellow: 2 }, type: "电", glyph: "爆" }),
  card("t2-exeggutor", "椰蛋树", 2, "green", 3, { red: 2, purple: 3, yellow: 1 }, { evolvesFrom: "蛋蛋", evolveCost: { green: 3 }, type: "草", glyph: "树" }),
  card("t2-steelix", "大钢蛇", 2, "purple", 3, { yellow: 2, blue: 2, green: 2 }, { evolvesFrom: "大岩蛇", evolveCost: { purple: 3 }, type: "钢", glyph: "钢" }),
  card("t2-aerodactyl", "化石翼龙", 2, "purple", 3, { green: 3, red: 2 }, { type: "岩", glyph: "翼" }),
  card("t2-pinsir", "大甲", 2, "green", 2, { red: 2, yellow: 2, purple: 1 }, { type: "虫", glyph: "夹" }),
  card("t2-skarmory", "盔甲鸟", 2, "blue", 2, { red: 3, purple: 2 }, { type: "钢", glyph: "甲" }),
  card("t2-heracross", "赫拉克罗斯", 2, "green", 2, { blue: 2, yellow: 2 }, { type: "虫", glyph: "赫" }),
  card("t2-azumarill", "玛力露丽", 2, "blue", 2, { green: 2, purple: 2 }, { type: "水", glyph: "泡" }),

  card("t3-venusaur", "妙蛙花", 3, "green", 4, { green: 3, red: 3, blue: 3 }, { evolvesFrom: "妙蛙草", evolveCost: { green: 4, red: 1 }, type: "草", glyph: "花" }),
  card("t3-charizard", "喷火龙", 3, "red", 5, { red: 3, green: 3, yellow: 3 }, { evolvesFrom: "火恐龙", evolveCost: { red: 4, yellow: 1 }, type: "火", glyph: "龙" }),
  card("t3-blastoise", "水箭龟", 3, "blue", 4, { blue: 3, red: 3, purple: 3 }, { evolvesFrom: "卡咪龟", evolveCost: { blue: 4, purple: 1 }, type: "水", glyph: "炮" }),
  card("t3-alakazam", "胡地", 3, "yellow", 4, { yellow: 4, blue: 2, purple: 2 }, { evolvesFrom: "勇基拉", evolveCost: { yellow: 4 }, type: "超", glyph: "匙" }),
  card("t3-machamp", "怪力", 3, "red", 4, { red: 4, green: 2, blue: 2 }, { evolvesFrom: "豪力", evolveCost: { red: 4 }, type: "斗", glyph: "腕" }),
  card("t3-gengar", "耿鬼", 3, "purple", 4, { purple: 4, red: 2, yellow: 2 }, { evolvesFrom: "鬼斯通", evolveCost: { purple: 4 }, type: "幽", glyph: "笑" }),
  card("t3-dragonite", "快龙", 3, "blue", 5, { blue: 4, red: 2, green: 2, purple: 1 }, { evolvesFrom: "哈克龙", evolveCost: { blue: 4, yellow: 2 }, type: "龙", glyph: "翔" }),
  card("t3-gardevoir", "沙奈朵", 3, "yellow", 5, { yellow: 4, green: 2, purple: 2, red: 1 }, { evolvesFrom: "奇鲁莉安", evolveCost: { yellow: 4, green: 2 }, type: "超", glyph: "纱" }),
  card("t3-metagross", "巨金怪", 3, "purple", 5, { purple: 4, red: 2, blue: 2, green: 1 }, { evolvesFrom: "金属怪", evolveCost: { purple: 4, blue: 2 }, type: "钢", glyph: "核" }),
  card("t3-garchomp", "烈咬陆鲨", 3, "red", 5, { red: 4, blue: 2, yellow: 2, purple: 1 }, { evolvesFrom: "尖牙陆鲨", evolveCost: { red: 4, green: 2 }, type: "龙", glyph: "鲨" }),

  card("rare-lucario", "路卡利欧", "rare", ["red", "yellow"], 4, { blue: 2, green: 2, purple: 2 }, { kind: "rare", rarity: "稀有", masterCost: 1, type: "斗", glyph: "波" }),
  card("rare-snorlax", "卡比兽", "rare", ["green", "purple"], 4, { red: 2, blue: 2, yellow: 2 }, { kind: "rare", rarity: "稀有", masterCost: 1, type: "普", glyph: "眠" }),
  card("rare-lapras", "拉普拉斯", "rare", ["blue", "green"], 4, { red: 2, yellow: 2, purple: 2 }, { kind: "rare", rarity: "稀有", masterCost: 1, type: "水", glyph: "航" }),
  card("rare-volcarona", "火神蛾", "rare", ["red", "green"], 5, { blue: 3, yellow: 2, purple: 2 }, { kind: "rare", rarity: "稀有", masterCost: 1, type: "火", glyph: "日" }),
  card("rare-absol", "阿勃梭鲁", "rare", ["purple", "yellow"], 4, { red: 2, green: 2, blue: 2 }, { kind: "rare", rarity: "稀有", masterCost: 1, type: "恶", glyph: "月" }),

  card("legend-mewtwo", "超梦", "legend", ["purple", "yellow"], 5, { red: 2, green: 2, blue: 2, yellow: 1 }, { kind: "legend", rarity: "传说/幻之", masterCost: 1, type: "超", glyph: "超" }),
  card("legend-mew", "梦幻", "legend", ["green", "yellow"], 5, { red: 2, blue: 2, purple: 2, green: 1 }, { kind: "legend", rarity: "传说/幻之", masterCost: 1, type: "幻", glyph: "梦" }),
  card("legend-lugia", "洛奇亚", "legend", ["blue", "purple"], 5, { red: 3, green: 2, yellow: 2 }, { kind: "legend", rarity: "传说/幻之", masterCost: 1, type: "超", glyph: "海" }),
  card("legend-hooh", "凤王", "legend", ["red", "green"], 5, { blue: 3, yellow: 2, purple: 2 }, { kind: "legend", rarity: "传说/幻之", masterCost: 1, type: "火", glyph: "凤" }),
  card("legend-rayquaza", "烈空坐", "legend", ["red", "blue"], 6, { green: 3, yellow: 2, purple: 2 }, { kind: "legend", rarity: "传说/幻之", masterCost: 1, type: "龙", glyph: "空" }),
];

function validateCards() {
  const counts = { 1: 0, 2: 0, 3: 0, rare: 0, legend: 0 };
  const ids = new Set();
  for (const c of CARDS) {
    if (ids.has(c.id)) throw new Error(`Duplicate card id: ${c.id}`);
    ids.add(c.id);
    counts[c.tier] = (counts[c.tier] || 0) + 1;
  }
  const expected = { 1: 40, 2: 30, 3: 10, rare: 5, legend: 5 };
  for (const key of Object.keys(expected)) {
    if (counts[key] !== expected[key]) {
      throw new Error(`Card count mismatch for ${key}: ${counts[key]} != ${expected[key]}`);
    }
  }
}

validateCards();

module.exports = {
  COLOR_KEYS,
  COLORS,
  MASTER,
  CARDS,
  cost,
  emptyCost,
};
