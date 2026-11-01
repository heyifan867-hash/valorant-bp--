// 地图数据。更新版本（新地图、地图池轮换）时只需改这里。
// id：唯一标识（一般用英文名）；en：卡片上显示的英文名，留空则只显示中文。
// img：放在 public/maps/ 下的地图图片；没有图的地图显示纯文字卡片。
// 加新图：把图片放进 public/maps/，在下面加一行即可。

const MAPS = [
  { id: 'Tianshu',  zh: '天枢云阙', img: '/maps/tianshu.webp' },
  { id: 'Ascent',   zh: '亚海悬城', img: '/maps/ascent.webp' },
  { id: 'Bind',     zh: '源工重镇', img: '/maps/bind.webp' },
  { id: 'Haven',    zh: '隐世修所', img: '/maps/haven.webp' },
  { id: 'Split',    zh: '霓虹町', img: '/maps/split.webp' },
  { id: 'Icebox',   zh: '森寒冬港', img: '/maps/icebox.webp' },
  { id: 'Breeze',   zh: '微风岛屿', img: '/maps/breeze.webp' },
  { id: 'Fracture', zh: '裂变峡谷', img: '/maps/fracture.webp' },
  { id: 'Pearl',    zh: '深海明珠', img: '/maps/pearl.webp' },
  { id: 'Lotus',    zh: '莲华古城', img: '/maps/lotus.webp' },
  { id: 'Sunset',   zh: '日落之城', img: '/maps/sunset.webp' },
  { id: 'Abyss',    zh: '幽邃地窟', img: '/maps/abyss.webp' },
  { id: 'Corrode',  zh: '盐海矿镇', img: '/maps/corrode.webp' },
];

// 创建房间时默认勾选的地图池（7 张）。按当前竞技地图池修改即可。
const DEFAULT_POOL = ['Tianshu', 'Bind', 'Haven', 'Lotus', 'Sunset', 'Abyss', 'Corrode'];


for (const m of MAPS) if (m.en === undefined) m.en = ''; // 只显示中文名；想显示英文名就在上面填 en

module.exports = { MAPS, DEFAULT_POOL };
