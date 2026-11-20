import { PixiComponent, applyDefaultProps } from '@pixi/react';
import * as PIXI from 'pixi.js';
import { AnimatedSprite, WorldMap } from '../../convex/aiTown/worldMap';
import * as campfire from '../../data/animations/campfire.json';
import * as gentlesparkle from '../../data/animations/gentlesparkle.json';
import * as gentlewaterfall from '../../data/animations/gentlewaterfall.json';
import * as gentlesplash from '../../data/animations/gentlesplash.json';
import * as windmill from '../../data/animations/windmill.json';
import * as temple from '../../data/animations/temple.json';
import * as church from '../../data/animations/church.json';
import * as university from '../../data/animations/university.json';
import { markEnterTiming } from '../utils/enterTiming.ts';

const animations = {
  'campfire.json': { spritesheet: campfire, url: '/ai-town/assets/spritesheets/campfire.png' },
  'gentlesparkle.json': {
    spritesheet: gentlesparkle,
    url: '/ai-town/assets/spritesheets/gentlesparkle32.png',
  },
  'gentlewaterfall.json': {
    spritesheet: gentlewaterfall,
    url: '/ai-town/assets/spritesheets/gentlewaterfall32.png',
  },
  'windmill.json': { spritesheet: windmill, url: '/ai-town/assets/spritesheets/windmill.png' },
  'temple.json': { spritesheet: temple, url: '/ai-town/assets/spritesheets/temple.png' },
  'church.json': { spritesheet: church, url: '/ai-town/assets/spritesheets/church.png' },
  'university.json': {
    spritesheet: university,
    url: '/ai-town/assets/spritesheets/university.png',
  },
  'gentlesplash.json': { spritesheet: gentlesplash,
    url: '/ai-town/assets/spritesheets/gentlewaterfall32.png',},
};

export const PixiStaticMap = PixiComponent('StaticMap', {
  create: (props: { map: WorldMap; [k: string]: any }) => {
    const createStarted = performance.now();
    markEnterTiming('PixiStaticMap create start', {
      tileSetUrl: props.map.tileSetUrl,
      mapSize: `${props.map.width}x${props.map.height}`,
      animatedSprites: props.map.animatedSprites.length,
    });
    const map = props.map;
    const numxtiles = Math.floor(map.tileSetDimX / map.tileDim);
    const numytiles = Math.floor(map.tileSetDimY / map.tileDim);
    const bt = PIXI.BaseTexture.from(map.tileSetUrl, {
      scaleMode: PIXI.SCALE_MODES.NEAREST,
    });

    const tiles = [];
    for (let x = 0; x < numxtiles; x++) {
      for (let y = 0; y < numytiles; y++) {
        tiles[x + y * numxtiles] = new PIXI.Texture(
          bt,
          new PIXI.Rectangle(x * map.tileDim, y * map.tileDim, map.tileDim, map.tileDim),
        );
      }
    }
    const screenxtiles = map.bgTiles[0].length;
    const screenytiles = map.bgTiles[0][0].length;

    const container = new PIXI.Container();
    const allLayers = [...map.bgTiles, ...map.objectTiles];

    // blit bg & object layers of map onto canvas
    let spriteCount = 0;
    for (let i = 0; i < screenxtiles * screenytiles; i++) {
      const x = i % screenxtiles;
      const y = Math.floor(i / screenxtiles);
      const xPx = x * map.tileDim;
      const yPx = y * map.tileDim;

      // Add all layers of backgrounds.
      for (const layer of allLayers) {
        const tileIndex = layer[x][y];
        // Some layers may not have tiles at this location.
        if (tileIndex === -1) continue;
        const ctile = new PIXI.Sprite(tiles[tileIndex]);
        ctile.x = xPx;
        ctile.y = yPx;
        container.addChild(ctile);
        spriteCount += 1;
      }
    }
    markEnterTiming('PixiStaticMap tiles built', {
      tileSprites: spriteCount,
      layers: allLayers.length,
      buildMs: Math.round(performance.now() - createStarted),
    });

    // TODO: Add layers.
    const spritesBySheet = new Map<string, AnimatedSprite[]>();
    for (const sprite of map.animatedSprites) {
      const sheet = sprite.sheet;
      if (!spritesBySheet.has(sheet)) {
        spritesBySheet.set(sheet, []);
      }
      spritesBySheet.get(sheet)!.push(sprite);
    }
    for (const [sheet, sprites] of spritesBySheet.entries()) {
      const animation = (animations as any)[sheet];
      if (!animation) {
        console.error('Could not find animation', sheet);
        continue;
      }
      const { spritesheet, url } = animation;
      const texture = PIXI.BaseTexture.from(url, {
        scaleMode: PIXI.SCALE_MODES.NEAREST,
      });
      const spriteSheet = new PIXI.Spritesheet(texture, spritesheet);
      spriteSheet.parse().then(() => {
        for (const sprite of sprites) {
          const pixiAnimation = spriteSheet.animations[sprite.animation];
          if (!pixiAnimation) {
            console.error('Failed to load animation', sprite);
            continue;
          }
          const pixiSprite = new PIXI.AnimatedSprite(pixiAnimation);
          pixiSprite.animationSpeed = 0.1;
          pixiSprite.autoUpdate = true;
          pixiSprite.x = sprite.x;
          pixiSprite.y = sprite.y;
          pixiSprite.width = sprite.w;
          pixiSprite.height = sprite.h;
          container.addChild(pixiSprite);
          pixiSprite.play();
        }
      });
    }

    container.x = 0;
    container.y = 0;

    // Set the hit area manually to ensure `pointerdown` events are delivered to this container.
    container.interactive = true;
    container.hitArea = new PIXI.Rectangle(
      0,
      0,
      screenxtiles * map.tileDim,
      screenytiles * map.tileDim,
    );

    markEnterTiming('PixiStaticMap create return', {
      totalMs: Math.round(performance.now() - createStarted),
      children: container.children.length,
    });

    // Texture may still be decoding; first paint can lag until BaseTexture loads.
    if (!bt.valid) {
      const textureWaitStarted = performance.now();
      bt.once('loaded', () => {
        markEnterTiming('PixiStaticMap tileSet texture loaded', {
          waitMs: Math.round(performance.now() - textureWaitStarted),
          tileSetUrl: map.tileSetUrl,
        });
      });
      bt.once('error', () => {
        markEnterTiming('PixiStaticMap tileSet texture ERROR', {
          tileSetUrl: map.tileSetUrl,
        });
      });
    } else {
      markEnterTiming('PixiStaticMap tileSet texture already valid');
    }

    return container;
  },

  applyProps: (instance, oldProps, newProps) => {
    applyDefaultProps(instance, oldProps, newProps);
  },
});
