import { QueryCtx, MutationCtx } from '../_generated/server';

export function isGuestId(value: string): boolean {
  return /^guest:[0-9a-f-]{36}$/i.test(value);
}

export async function resolveHumanToken(
  ctx: QueryCtx | MutationCtx,
  guestId?: string,
): Promise<{ tokenIdentifier: string; name: string; kind: 'authenticated' | 'guest' } | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (identity) {
    return {
      tokenIdentifier: identity.tokenIdentifier,
      name: identity.name ?? identity.email?.split('@')[0] ?? '访客',
      kind: 'authenticated',
    };
  }
  if (guestId && isGuestId(guestId)) {
    return {
      tokenIdentifier: guestId,
      name: '游客',
      kind: 'guest',
    };
  }
  return null;
}
