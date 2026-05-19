class MemoryCache {
  constructor() {
    this.store = new Map();
  }

  async getOrRefresh(key, ttlMs, loader) {
    const now = Date.now();
    const entry = this.store.get(key);

    if (entry && entry.value && now - entry.fetchedAt < ttlMs) {
      return {
        value: entry.value,
        fetchedAt: entry.fetchedAt,
        stale: false,
        cacheStatus: "fresh"
      };
    }

    if (entry && entry.promise) {
      return entry.promise;
    }

    const pending = (async () => {
      try {
        const value = await loader(entry ? entry.value : null);
        const nextEntry = {
          value,
          fetchedAt: Date.now(),
          error: null
        };

        this.store.set(key, nextEntry);

        return {
          value,
          fetchedAt: nextEntry.fetchedAt,
          stale: false,
          cacheStatus: entry && entry.value ? "refreshed" : "miss"
        };
      } catch (error) {
        if (entry && entry.value) {
          this.store.set(key, {
            value: entry.value,
            fetchedAt: entry.fetchedAt,
            error
          });

          return {
            value: entry.value,
            fetchedAt: entry.fetchedAt,
            stale: true,
            cacheStatus: "stale",
            error
          };
        }

        throw error;
      }
    })();

    this.store.set(key, {
      ...(entry || {}),
      promise: pending
    });

    try {
      return await pending;
    } finally {
      const current = this.store.get(key);
      if (current && current.promise) {
        delete current.promise;
        this.store.set(key, current);
      }
    }
  }

  peek(key) {
    const entry = this.store.get(key);
    if (!entry || !entry.value) {
      return null;
    }

    return {
      fetchedAt: entry.fetchedAt,
      hasError: Boolean(entry.error)
    };
  }
}

module.exports = {
  MemoryCache
};
