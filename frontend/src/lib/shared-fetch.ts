/** Share one in-flight request and a short TTL cache across hooks/pages. */
export function createSharedFetch<T>(load: () => Promise<T>, ttlMs: number) {
  let cache: { data: T; at: number } | null = null;
  let inflight: Promise<T> | null = null;

  const get = (opts?: { force?: boolean }): Promise<T> => {
    const force = opts?.force ?? false;
    if (!force && cache && Date.now() - cache.at < ttlMs) {
      return Promise.resolve(cache.data);
    }
    if (inflight) return inflight;
    inflight = load()
      .then((data) => {
        cache = { data, at: Date.now() };
        return data;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  };

  const invalidate = () => {
    cache = null;
  };

  return { get, invalidate };
}
