import fs from 'fs';
import * as m from '../data/gentle.js';

// Top-center empty grass above town.
const TX = 39;
const TY = 4;
const TW = 7;
const TH = 7;
const GRASS = 271;
const PATH = 226;
const COLLISION = 367;

const bg0 = m.bgtiles[0].map((col) => col.slice());
const bg1 = m.bgtiles[1].map((col) => col.slice());
const obj0 = m.objmap[0].map((col) => col.slice());
const obj1 = m.objmap[1].map((col) => col.slice());

for (let dx = 0; dx < TW; dx++) {
  for (let dy = 0; dy < TH; dy++) {
    const x = TX + dx;
    const y = TY + dy;
    const front = dy >= TH - 2;
    if (front) {
      bg0[x][y] = dx >= 2 && dx <= 4 ? PATH : GRASS;
      if (y > 2 && y < m.mapheight - 3) obj0[x][y] = -1;
      bg1[x][y] = -1;
      obj1[x][y] = -1;
    } else {
      bg0[x][y] = GRASS;
      bg1[x][y] = -1;
      obj0[x][y] = COLLISION;
      obj1[x][y] = -1;
    }
  }
}

const universitySprite = {
  x: TX * m.tiledim,
  y: TY * m.tiledim,
  w: 208,
  h: 208,
  layer: 1,
  sheet: 'university.json',
  animation: 'pixels_large',
};
const sprites = m.animatedsprites.filter((s) => s.sheet !== 'university.json');
sprites.push(universitySprite);

function emitLayer(layer) {
  let out = '[\n';
  for (let x = 0; x < layer.length; x++) {
    out +=
      '[ ' +
      layer[x].map((v) => String(v).padStart(3, ' ')).join(' , ') +
      ' , ],\n';
  }
  out += ']';
  return out;
}

function emitSprites(list) {
  return list
    .map(
      (s) =>
        `{ x: ${s.x}, y: ${s.y}, w: ${s.w}, h: ${s.h}, layer: ${s.layer}, sheet: "${s.sheet}", animation: "${s.animation}" },`,
    )
    .join('\n');
}

const header = fs.readFileSync('data/gentle.js', 'utf8').split('export const bgtiles')[0];
const body =
  header +
  'export const bgtiles = [\n' +
  emitLayer(bg0) +
  ',\n' +
  emitLayer(bg1) +
  '\n];\n\n' +
  'export const objmap = [\n' +
  emitLayer(obj0) +
  ',\n' +
  emitLayer(obj1) +
  '\n];\n\n' +
  'export const animatedsprites = [\n' +
  emitSprites(sprites) +
  '\n];\n\n' +
  'export const mapwidth = bgtiles[0].length;\n' +
  'export const mapheight = bgtiles[0][0].length;\n';

fs.writeFileSync('data/gentle.js', body);
console.log(
  'university at tiles',
  TX,
  TY,
  'px',
  universitySprite.x,
  universitySprite.y,
  'sprites',
  sprites.length,
);
