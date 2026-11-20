import { useConvexAuth, useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import { Id } from '../../../convex/_generated/dataModel';
import { getOrCreateGuestId } from '../guestId';

/**
 * Current human tokenIdentifier for matching `player.human`.
 * Authenticated users get JWT tokenIdentifier; guests use localStorage guest id.
 */
export function useHumanToken(worldId: Id<'worlds'> | undefined) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const guestId = getOrCreateGuestId();
  const token = useQuery(
    api.world.userStatus,
    worldId
      ? {
          worldId,
          guestId: isAuthenticated ? undefined : guestId,
        }
      : 'skip',
  );

  return {
    token: token ?? null,
    guestId,
    isAuthenticated,
    isLoading: isLoading || (worldId !== undefined && token === undefined),
  };
}
