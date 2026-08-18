import { vi } from 'vitest';
import type { SaveDependencies } from '@/src/store/remote-save-state';

/** Records the save egress in place of a network round-trip. */
export const savePost = () =>
  vi.fn<typeof fetch>(async () => new Response(null, { status: 200 }));

/**
 * A save that skips the real zip: the archive's content is the serializer's
 * contract, not this one's.
 */
export const saveDependencies = (
  post: ReturnType<typeof savePost>
): SaveDependencies => ({
  serializeSession: async () => new Blob(['x'], { type: 'application/zip' }),
  post,
});
