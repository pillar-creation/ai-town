const GUEST_STORAGE_KEY = 'ai-town-guest-id';

function createGuestId(): string {
  return `guest:${crypto.randomUUID()}`;
}

/** Stable anonymous identity for guests who enter without signing in. */
export function getOrCreateGuestId(): string {
  try {
    const existing = localStorage.getItem(GUEST_STORAGE_KEY);
    if (existing && /^guest:[0-9a-f-]{36}$/i.test(existing)) {
      return existing;
    }
    const next = createGuestId();
    localStorage.setItem(GUEST_STORAGE_KEY, next);
    return next;
  } catch {
    // SSR / private mode fallback — ephemeral for this page load.
    return createGuestId();
  }
}
