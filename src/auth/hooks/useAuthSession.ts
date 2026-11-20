import { useAuthActions } from '@convex-dev/auth/react';
import { useConvexAuth, useMutation, useQuery } from 'convex/react';
import { useEffect } from 'react';
import { api } from '../../../convex/_generated/api';
import { getOrCreateGuestId } from '../guestId';
import type { AuthSessionView } from '../types';

export function useAuthSession() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const { signOut } = useAuthActions();
  const me = useQuery(api.appUsers.me, isAuthenticated ? {} : 'skip');
  const ensureAppUser = useMutation(api.appUsers.ensureAppUser);
  const guestId = getOrCreateGuestId();

  useEffect(() => {
    if (!isAuthenticated) return;
    void ensureAppUser();
  }, [isAuthenticated, ensureAppUser]);

  const session: AuthSessionView | null =
    isAuthenticated && me
      ? {
          email: me.email,
          name: me.name,
          emailVerified: me.emailVerified,
          role: me.role,
        }
      : null;

  return {
    isLoading,
    isAuthenticated,
    session,
    guestId,
    /** Prefer signed-in token via Convex auth; guests use local guestId. */
    humanKey: isAuthenticated ? ('authenticated' as const) : guestId,
    signOut: () => signOut(),
  };
}
