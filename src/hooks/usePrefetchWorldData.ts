import { useEffect, useRef } from 'react';
import { useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';

const PREFIX = '[world-prefetch]';

/**
 * Warm Convex subscriptions for the default world while the launch screen is up.
 * Same query keys as Game / useServerGame, so enter can reuse the client cache.
 */
export function usePrefetchWorldData() {
  const startedAt = useRef(performance.now());
  const logged = useRef({
    status: false,
    worldState: false,
    descriptions: false,
    ready: false,
  });

  const worldStatus = useQuery(api.world.defaultWorldStatus);
  const worldId = worldStatus?.worldId;

  const worldState = useQuery(api.world.worldState, worldId ? { worldId } : 'skip');
  const descriptions = useQuery(api.world.gameDescriptions, worldId ? { worldId } : 'skip');

  const ready =
    worldStatus != null && worldState !== undefined && descriptions !== undefined;

  useEffect(() => {
    console.log(`${PREFIX} start (defaultWorldStatus → worldState + gameDescriptions)`);
  }, []);

  useEffect(() => {
    if (worldStatus === undefined || logged.current.status) return;
    logged.current.status = true;
    const ms = Math.round(performance.now() - startedAt.current);
    if (!worldStatus) {
      console.log(`${PREFIX} +${ms}ms defaultWorldStatus=null (no default world)`);
      return;
    }
    console.log(
      `${PREFIX} +${ms}ms defaultWorldStatus ready`,
      JSON.stringify({
        worldId: worldStatus.worldId,
        engineId: worldStatus.engineId,
        status: worldStatus.status,
      }),
    );
  }, [worldStatus]);

  useEffect(() => {
    if (!worldState || logged.current.worldState) return;
    logged.current.worldState = true;
    const ms = Math.round(performance.now() - startedAt.current);
    console.log(
      `${PREFIX} +${ms}ms worldState ready`,
      JSON.stringify({
        players: worldState.world.players.length,
        agents: worldState.world.agents.length,
      }),
    );
  }, [worldState]);

  useEffect(() => {
    if (!descriptions || logged.current.descriptions) return;
    logged.current.descriptions = true;
    const ms = Math.round(performance.now() - startedAt.current);
    console.log(
      `${PREFIX} +${ms}ms gameDescriptions ready`,
      JSON.stringify({
        playerDescriptions: descriptions.playerDescriptions.length,
        mapSize: `${descriptions.worldMap.width}x${descriptions.worldMap.height}`,
        tileSetUrl: descriptions.worldMap.tileSetUrl,
      }),
    );

    // Warm the tileset so Pixi is less likely to flash after Stage mounts.
    const img = new Image();
    img.src = descriptions.worldMap.tileSetUrl;
  }, [descriptions]);

  useEffect(() => {
    if (!ready || logged.current.ready) return;
    logged.current.ready = true;
    const ms = Math.round(performance.now() - startedAt.current);
    console.log(`${PREFIX} +${ms}ms ALL READY (enter can reuse cache)`);
  }, [ready]);

  return {
    ready,
    worldId,
    engineId: worldStatus?.engineId,
  };
}
