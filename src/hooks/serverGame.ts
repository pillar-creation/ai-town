import { GameId } from '../../convex/aiTown/ids.ts';
import { AgentDescription } from '../../convex/aiTown/agentDescription.ts';
import { PlayerDescription } from '../../convex/aiTown/playerDescription.ts';
import { World } from '../../convex/aiTown/world.ts';
import { WorldMap } from '../../convex/aiTown/worldMap.ts';
import { Id } from '../../convex/_generated/dataModel';
import { useEffect, useMemo, useRef } from 'react';
import { useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { parseMap } from '../../convex/util/object.ts';
import { markEnterTiming } from '../utils/enterTiming.ts';

export type ServerGame = {
  world: World;
  playerDescriptions: Map<GameId<'players'>, PlayerDescription>;
  agentDescriptions: Map<GameId<'agents'>, AgentDescription>;
  worldMap: WorldMap;
};

// TODO: This hook reparses the game state (even if we're not rerunning the query)
// when used in multiple components. Move this to a context to only parse it once.
export function useServerGame(worldId: Id<'worlds'> | undefined): ServerGame | undefined {
  const worldStateReady = useRef(false);
  const descriptionsReady = useRef(false);
  const parseLogged = useRef(false);

  const worldState = useQuery(api.world.worldState, worldId ? { worldId } : 'skip');
  const descriptions = useQuery(api.world.gameDescriptions, worldId ? { worldId } : 'skip');

  useEffect(() => {
    if (!worldId) {
      worldStateReady.current = false;
      descriptionsReady.current = false;
      parseLogged.current = false;
      return;
    }
    markEnterTiming('useServerGame start queries', { worldId: String(worldId) });
  }, [worldId]);

  useEffect(() => {
    if (!worldState || worldStateReady.current) return;
    worldStateReady.current = true;
    markEnterTiming('query worldState ready (useServerGame)', {
      players: worldState.world.players.length,
      agents: worldState.world.agents.length,
      conversations: worldState.world.conversations.length,
    });
  }, [worldState]);

  useEffect(() => {
    if (!descriptions || descriptionsReady.current) return;
    descriptionsReady.current = true;
    markEnterTiming('query gameDescriptions ready', {
      playerDescriptions: descriptions.playerDescriptions.length,
      agentDescriptions: descriptions.agentDescriptions.length,
      mapSize: `${descriptions.worldMap.width}x${descriptions.worldMap.height}`,
      tileSetUrl: descriptions.worldMap.tileSetUrl,
    });
  }, [descriptions]);

  const game = useMemo(() => {
    if (!worldState || !descriptions) {
      return undefined;
    }
    const parseStarted = performance.now();
    const parsed = {
      world: new World(worldState.world),
      agentDescriptions: parseMap(
        descriptions.agentDescriptions,
        AgentDescription,
        (p) => p.agentId,
      ),
      playerDescriptions: parseMap(
        descriptions.playerDescriptions,
        PlayerDescription,
        (p) => p.playerId,
      ),
      worldMap: new WorldMap(descriptions.worldMap),
    };
    if (!parseLogged.current) {
      parseLogged.current = true;
      markEnterTiming('parse ServerGame done', {
        parseMs: Math.round(performance.now() - parseStarted),
        players: parsed.world.players.size,
      });
    }
    return parsed;
  }, [worldState, descriptions]);
  return game;
}
