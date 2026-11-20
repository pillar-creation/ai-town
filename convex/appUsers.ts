import { getAuthUserId } from '@convex-dev/auth/server';
import { mutation, query } from './_generated/server';

/** Ensure the signed-in auth user has an appUsers row (verified visitor). */
export const ensureAppUser = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return null;
    }
    const authUser = await ctx.db.get(userId);
    if (!authUser) {
      return null;
    }
    const existing = await ctx.db
      .query('appUsers')
      .withIndex('by_authUserId', (q) => q.eq('authUserId', userId))
      .unique();
    const now = Date.now();
    const email = authUser.email ?? '';
    if (existing) {
      await ctx.db.patch(existing._id, {
        email,
        emailVerified: true,
        lastSeenAt: now,
      });
      return existing._id;
    }
    return await ctx.db.insert('appUsers', {
      authUserId: userId,
      email,
      emailVerified: true,
      displayName: authUser.name,
      role: 'visitor',
      createdAt: now,
      lastSeenAt: now,
    });
  },
});

export const me = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return null;
    }
    const authUser = await ctx.db.get(userId);
    const appUser = await ctx.db
      .query('appUsers')
      .withIndex('by_authUserId', (q) => q.eq('authUserId', userId))
      .unique();
    return {
      authUserId: userId,
      email: authUser?.email ?? appUser?.email ?? null,
      name: authUser?.name ?? appUser?.displayName ?? null,
      emailVerified: appUser?.emailVerified ?? !!authUser?.emailVerificationTime,
      role: appUser?.role ?? 'visitor',
    };
  },
});
