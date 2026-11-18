// Based on https://codepen.io/inlet/pen/yLVmPWv.
// Copyright (c) 2018 Patrick Brouwer, distributed under the MIT license.

import { PixiComponent } from '@pixi/react';
import { Viewport } from 'pixi-viewport';
import { Application } from 'pixi.js';
import { MutableRefObject, ReactNode } from 'react';

export type ViewportProps = {
  app: Application;
  viewportRef?: MutableRefObject<Viewport | undefined>;

  screenWidth: number;
  screenHeight: number;
  worldWidth: number;
  worldHeight: number;
  children?: ReactNode;
};

function fitWorldScale(screenWidth: number, screenHeight: number, worldWidth: number, worldHeight: number) {
  if (worldWidth <= 0 || worldHeight <= 0 || screenWidth <= 0 || screenHeight <= 0) {
    return 1;
  }
  // Scale at which the entire world fits inside the screen (letterboxed if needed).
  return Math.min(screenWidth / worldWidth, screenHeight / worldHeight);
}

function zoomLimits(props: ViewportProps) {
  return {
    minScale: fitWorldScale(props.screenWidth, props.screenHeight, props.worldWidth, props.worldHeight),
    maxScale: 3.0,
  };
}

/** Stub so destroy() can call removeEventListener after Stage already tore down the canvas. */
function stubDomElement(): EventTarget {
  return {
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return false;
    },
  };
}

function ensureDestroyableEvents(viewport: Viewport) {
  const events = viewport.options?.events as { domElement?: EventTarget | null } | undefined;
  if (events && !events.domElement) {
    events.domElement = stubDomElement();
  }
}

// https://davidfig.github.io/pixi-viewport/jsdoc/Viewport.html
export default PixiComponent('Viewport', {
  create(props: ViewportProps) {
    const { app, children, viewportRef, ...viewportProps } = props;
    const viewport = new Viewport({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      events: app.renderer.events,
      passiveWheel: false,
      ...viewportProps,
    }) as Viewport & { __viewportRef?: MutableRefObject<Viewport | undefined> };
    if (viewportRef) {
      viewportRef.current = viewport;
      // willUnmount only receives (instance, parent); stash ref for cleanup.
      viewport.__viewportRef = viewportRef;
    }
    const limits = zoomLimits(props);
    // Activate plugins
    viewport
      .drag()
      .pinch({})
      .wheel()
      .decelerate()
      .clamp({ direction: 'all', underflow: 'center' })
      .clampZoom(limits)
      .setZoom(limits.minScale);
    return viewport;
  },
  applyProps(viewport: Viewport & { __viewportRef?: MutableRefObject<Viewport | undefined> }, oldProps: any, newProps: any) {
    if (newProps.viewportRef && newProps.viewportRef !== oldProps.viewportRef) {
      newProps.viewportRef.current = viewport;
      viewport.__viewportRef = newProps.viewportRef;
    }
    Object.keys(newProps).forEach((p) => {
      if (p !== 'app' && p !== 'viewportRef' && p !== 'children' && oldProps[p] !== newProps[p]) {
        // @ts-expect-error Ignoring TypeScript here
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        viewport[p] = newProps[p];
      }
    });
    if (
      oldProps.screenWidth !== newProps.screenWidth ||
      oldProps.screenHeight !== newProps.screenHeight ||
      oldProps.worldWidth !== newProps.worldWidth ||
      oldProps.worldHeight !== newProps.worldHeight
    ) {
      viewport.clampZoom(zoomLimits(newProps));
    }
  },
  willUnmount(viewport: Viewport & { __viewportRef?: MutableRefObject<Viewport | undefined> }) {
    if (viewport.__viewportRef?.current === viewport) {
      viewport.__viewportRef.current = undefined;
    }
    // Stage may already have cleared events.domElement; patch before @pixi/react
    // calls Viewport.destroy(), which otherwise throws and blanks the React tree.
    ensureDestroyableEvents(viewport);
  },
});
