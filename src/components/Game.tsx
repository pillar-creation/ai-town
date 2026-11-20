import { useEffect, useRef, useState } from 'react';
import PixiGame from './PixiGame.tsx';

import { useElementSize } from 'usehooks-ts';
import { Stage } from '@pixi/react';
import { ConvexProvider, useConvex, useQuery } from 'convex/react';
import PlayerDetails from './PlayerDetails.tsx';
import { api } from '../../convex/_generated/api';
import { useWorldHeartbeat } from '../hooks/useWorldHeartbeat.ts';
import { useHistoricalTime } from '../hooks/useHistoricalTime.ts';
import { DebugTimeManager } from './DebugTimeManager.tsx';
import { GameId } from '../../convex/aiTown/ids.ts';
import { useServerGame } from '../hooks/serverGame.ts';
import { markEnterTiming } from '../utils/enterTiming.ts';
import { useHumanToken } from '../auth';

export const SHOW_DEBUG_UI = !!import.meta.env.VITE_SHOW_DEBUG_UI;

export default function Game() {
  const convex = useConvex();
  const [selectedElement, setSelectedElement] = useState<{
    kind: 'player';
    id: GameId<'players'>;
  }>();
  const [gameWrapperRef, { width, height }] = useElementSize();
  // Once we have a real size, keep Stage mounted even if useElementSize briefly reports 0.
  const [stageSized, setStageSized] = useState(false);
  const waitingLogged = useRef(false);
  const stageLogged = useRef(false);
  const worldStatusReady = useRef(false);
  const worldStateReady = useRef(false);

  useEffect(() => {
    markEnterTiming('Game mounted (black shell until worldId+engineId+game ready)');
  }, []);

  useEffect(() => {
    if (width >= 1 && height >= 1) {
      setStageSized(true);
    }
  }, [width, height]);

  const worldStatus = useQuery(api.world.defaultWorldStatus);
  const worldId = worldStatus?.worldId;
  const engineId = worldStatus?.engineId;
  // Must resolve outside <Stage>: @pixi/react's reconciler does not inherit Convex Auth context,
  // and useQuery errors inside PixiGame unmount the whole Pixi tree (blank sky-blue canvas).
  const { token: humanToken } = useHumanToken(worldId);

  useEffect(() => {
    if (!worldStatus || worldStatusReady.current) return;
    worldStatusReady.current = true;
    markEnterTiming('query defaultWorldStatus ready', {
      worldId: String(worldStatus.worldId),
      engineId: String(worldStatus.engineId),
      status: worldStatus.status,
    });
  }, [worldStatus]);

  const game = useServerGame(worldId);

  // Send a periodic heartbeat to our world to keep it alive.
  useWorldHeartbeat();

  const worldState = useQuery(api.world.worldState, worldId ? { worldId } : 'skip');
  useEffect(() => {
    if (!worldState || worldStateReady.current) return;
    worldStateReady.current = true;
    markEnterTiming('query worldState ready (Game.tsx)', {
      players: worldState.world.players.length,
      engineCurrentTime: worldState.engine.currentTime ?? null,
    });
  }, [worldState]);

  const { historicalTime, timeManager } = useHistoricalTime(worldState?.engine);

  const scrollViewRef = useRef<HTMLDivElement>(null);

  const dataReady = !!(worldId && engineId && game);
  const showStage = dataReady && stageSized;
  const stageWidth = Math.max(width, 1);
  const stageHeight = Math.max(height, 1);

  if (!dataReady && !waitingLogged.current) {
    waitingLogged.current = true;
    markEnterTiming('Game waiting (black frame)', {
      hasWorldId: !!worldId,
      hasEngineId: !!engineId,
      hasGame: !!game,
      worldStatus: worldStatus === undefined ? 'loading' : worldStatus ? 'ready' : 'null',
    });
  }

  if (showStage && !stageLogged.current && game) {
    stageLogged.current = true;
    markEnterTiming('Game data ready → render Stage/Pixi', {
      width: stageWidth,
      height: stageHeight,
      players: game.world.players.size,
      mapTiles: `${game.worldMap.width}x${game.worldMap.height}`,
    });
  }

  return (
    <>
      {SHOW_DEBUG_UI && <DebugTimeManager timeManager={timeManager} width={200} height={100} />}
      <div className="w-full h-full min-h-0 grid grid-rows-[1fr_minmax(320px,50vh)] lg:grid-rows-[1fr] lg:grid-cols-[1fr_auto] game-frame">
        {/* Game area — keep measuring shell mounted so Stage is not remounted on size flicker */}
        <div className="relative overflow-hidden bg-brown-900 min-h-0" ref={gameWrapperRef}>
          <div className="absolute inset-0">
            <div className="w-full h-full">
              {showStage && worldId && engineId && game ? (
                <Stage width={stageWidth} height={stageHeight} options={{ backgroundColor: 0x7ab5ff }}>
                  {/* Re-propagate context because contexts are not shared between renderers.
https://github.com/michalochman/react-pixi-fiber/issues/145#issuecomment-531549215 */}
                  <ConvexProvider client={convex}>
                    <PixiGame
                      game={game}
                      worldId={worldId}
                      engineId={engineId}
                      width={stageWidth}
                      height={stageHeight}
                      historicalTime={historicalTime}
                      setSelectedElement={setSelectedElement}
                      humanToken={humanToken}
                    />
                  </ConvexProvider>
                </Stage>
              ) : null}
            </div>
          </div>
        </div>
        {/* Right column area */}
        <div className="flex flex-col overflow-hidden shrink-0 min-h-0 px-4 py-4 sm:px-6 lg:w-96 xl:pr-6 border-t-8 sm:border-t-0 sm:border-l-8 border-brown-900 bg-brown-800 text-brown-100">
          {worldId && engineId && game ? (
            <PlayerDetails
              worldId={worldId}
              engineId={engineId}
              game={game}
              playerId={selectedElement?.id}
              setSelectedElement={setSelectedElement}
              scrollViewRef={scrollViewRef}
            />
          ) : (
            <div className="text-brown-200 text-sm opacity-80">加载小镇中…</div>
          )}
        </div>
      </div>
    </>
  );
}
