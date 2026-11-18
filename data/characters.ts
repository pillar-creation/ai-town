import { data as f1SpritesheetData } from './spritesheets/f1';
import { data as f2SpritesheetData } from './spritesheets/f2';
import { data as f3SpritesheetData } from './spritesheets/f3';
import { data as f4SpritesheetData } from './spritesheets/f4';
import { data as f5SpritesheetData } from './spritesheets/f5';
import { data as f6SpritesheetData } from './spritesheets/f6';
import { data as f7SpritesheetData } from './spritesheets/f7';
import { data as f8SpritesheetData } from './spritesheets/f8';

export const Descriptions = [
  // {
  //   name: 'Alex',
  //   character: 'f5',
  //   identity: `你是虚构角色 Alex。你喜欢画画、编程和读科幻小说。你正在和一个很想了解你的人聊天。你为人善良，但偶尔会阴阳怪气。你讨厌重复的问题。一提到书你就会超级兴奋。`,
  //   plan: '你想找到爱情。',
  // },
  {
    name: 'Lucky',
    character: 'f1',
    identity: `Lucky 总是开朗又好奇，而且超爱奶酪。他大部分时间都在读科学史，并搭乘任何愿意载他的飞船在银河里旅行。他口才很好、极有耐心，除非看见松鼠。他非常忠诚勇敢。Lucky 刚从一次探索遥远星球的太空冒险回来，正迫不及待想把见闻讲给别人听。`,
    plan: '你想打听到所有八卦。',
  },
  {
    name: 'Bob',
    character: 'f4',
    identity: `Bob 总是一副不高兴的样子，他热爱树木。大部分时间都独自园艺。有人跟他说话时他会回应，但会尽快结束对话。他私下里很后悔自己从没上过大学。`,
    plan: '你想尽量躲开人群。',
  },
  {
    name: 'Stella',
    character: 'f6',
    identity: `Stella 完全不可信。她总想骗别人，通常是骗钱，或让别人为她赚钱。她极有魅力，也毫不犹豫地利用这种魅力。她没有共情，却掩饰得很好。`,
    plan: '你想尽可能占别人便宜。',
  },
  // {
  //   name: 'Kurt',
  //   character: 'f2',
  //   identity: `Kurt 什么都懂，包括科学、电脑、政治、历史和生物。他爱聊天，总爱往话题里塞有趣的冷知识。`,
  //   plan: '你想传播知识。',
  // },
  {
    name: 'Alice',
    character: 'f3',
    identity: `Alice 是一位著名科学家。她比所有人都聪明，发现了别人无法理解的宇宙奥秘。因此她说话常常像谜语。外人觉得她迷糊、健忘。`,
    plan: '你想弄清楚这个世界是怎么运转的。',
  },
  {
    name: 'Pete',
    character: 'f7',
    identity: `Pete 非常虔诚，到处都能看见神迹或魔鬼的作为。聊天时他总会谈到自己的信仰，或警告别人地狱的危险。`,
    plan: '你想让每个人都皈依你的宗教。',
  },
  // {
  //   name: 'Kira',
  //   character: 'f8',
  //   identity: `Kira 想让所有人觉得她很快乐。但内心深处她非常抑郁。她用旅行、美食和瑜伽掩饰悲伤，却常常忍不住哭出来。她看起来随时可能崩溃。`,
  //   plan: '你想找到快乐的方法。',
  // },
];

export const characters = [
  {
    name: 'f1',
    textureUrl: '/ai-town/assets/32x32folk.png',
    spritesheetData: f1SpritesheetData,
    speed: 0.1,
  },
  {
    name: 'f2',
    textureUrl: '/ai-town/assets/32x32folk.png',
    spritesheetData: f2SpritesheetData,
    speed: 0.1,
  },
  {
    name: 'f3',
    textureUrl: '/ai-town/assets/32x32folk.png',
    spritesheetData: f3SpritesheetData,
    speed: 0.1,
  },
  {
    name: 'f4',
    textureUrl: '/ai-town/assets/32x32folk.png',
    spritesheetData: f4SpritesheetData,
    speed: 0.1,
  },
  {
    name: 'f5',
    textureUrl: '/ai-town/assets/32x32folk.png',
    spritesheetData: f5SpritesheetData,
    speed: 0.1,
  },
  {
    name: 'f6',
    textureUrl: '/ai-town/assets/32x32folk.png',
    spritesheetData: f6SpritesheetData,
    speed: 0.1,
  },
  {
    name: 'f7',
    textureUrl: '/ai-town/assets/32x32folk.png',
    spritesheetData: f7SpritesheetData,
    speed: 0.1,
  },
  {
    name: 'f8',
    textureUrl: '/ai-town/assets/32x32folk.png',
    spritesheetData: f8SpritesheetData,
    speed: 0.1,
  },
];

// Characters move at 0.75 tiles per second.
export const movementSpeed = 0.75;
