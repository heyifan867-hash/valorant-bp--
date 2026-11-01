// 地图与特工数据。更新版本（新地图、地图池轮换、新特工）时只需改这里。
// id：唯一标识（一般用英文名）；en：卡片上显示的英文名，留空则只显示中文。
// img：放在 public/maps/ 下的本地图片，优先使用；没有的会尝试从 valorant-api.com 按英文名取图，再取不到就显示纯文字卡片。
// 加新图：把图片放进 public/maps/，在下面加一行即可。

const MAPS = [
  { id: 'Tianshu',  zh: '天枢云阙', img: '/maps/tianshu.webp' },
  { id: 'Ascent',   zh: '亚海悬城', img: '/maps/ascent.webp' },
  { id: 'Bind',     zh: '源工重镇', img: '/maps/bind.webp' },
  { id: 'Haven',    zh: '隐世修所', img: '/maps/haven.webp' },
  { id: 'Split',    zh: '霓虹町', img: '/maps/split.webp' },
  { id: 'Icebox',   zh: '森寒冬港' },
  { id: 'Breeze',   zh: '微风岛屿', img: '/maps/breeze.webp' },
  { id: 'Fracture', zh: '裂变峡谷' },
  { id: 'Pearl',    zh: '深海明珠', img: '/maps/pearl.webp' },
  { id: 'Lotus',    zh: '莲华古城', img: '/maps/lotus.webp' },
  { id: 'Sunset',   zh: '日落之城', img: '/maps/sunset.webp' },
  { id: 'Abyss',    zh: '幽邃地窟', img: '/maps/abyss.webp' },
  { id: 'Corrode',  zh: '盐海矿镇' },
];

// 创建房间时默认勾选的地图池（7 张）。按当前竞技地图池修改即可。
const DEFAULT_POOL = ['Ascent', 'Bind', 'Haven', 'Lotus', 'Sunset', 'Abyss', 'Corrode'];

// role: duelist 决斗 / initiator 先锋 / controller 控场 / sentinel 哨位
const AGENTS = [
  { id: 'Jett',      zh: '捷风',   role: 'duelist' },
  { id: 'Phoenix',   zh: '不死鸟', role: 'duelist' },
  { id: 'Reyna',     zh: '芮娜',   role: 'duelist' },
  { id: 'Raze',      zh: '雷兹',   role: 'duelist' },
  { id: 'Yoru',      zh: '夜露',   role: 'duelist' },
  { id: 'Neon',      zh: '霓虹',   role: 'duelist' },
  { id: 'Iso',       zh: '壹决',   role: 'duelist' },
  { id: 'Waylay',    zh: '幻棱',   role: 'duelist' },
  { id: 'Sova',      zh: '猎枭',   role: 'initiator' },
  { id: 'Breach',    zh: '铁臂',   role: 'initiator' },
  { id: 'Skye',      zh: '斯凯',   role: 'initiator' },
  { id: 'KAY/O',     zh: 'K/O',    role: 'initiator' },
  { id: 'Fade',      zh: '黑梦',   role: 'initiator' },
  { id: 'Gekko',     zh: '盖可',   role: 'initiator' },
  { id: 'Tejo',      zh: '钛狐',   role: 'initiator' },
  { id: 'Brimstone', zh: '炼狱',   role: 'controller' },
  { id: 'Viper',     zh: '蝰蛇',   role: 'controller' },
  { id: 'Omen',      zh: '幽影',   role: 'controller' },
  { id: 'Astra',     zh: '星礈',   role: 'controller' },
  { id: 'Harbor',    zh: '海神',   role: 'controller' },
  { id: 'Clove',     zh: '暮蝶',   role: 'controller' },
  { id: 'Killjoy',   zh: '奇乐',   role: 'sentinel' },
  { id: 'Cypher',    zh: '零',     role: 'sentinel' },
  { id: 'Sage',      zh: '贤者',   role: 'sentinel' },
  { id: 'Chamber',   zh: '尚勃勒', role: 'sentinel' },
  { id: 'Deadlock',  zh: '钢锁',   role: 'sentinel' },
  { id: 'Vyse',      zh: '维斯',   role: 'sentinel' },
  { id: 'Veto',      zh: '禁灭',   role: 'sentinel' },
];

for (const m of MAPS) if (m.en === undefined) m.en = ''; // 只显示中文名；想显示英文名就在上面填 en

module.exports = { MAPS, DEFAULT_POOL, AGENTS };
