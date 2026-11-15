// Shared upstream fetch: bounded timeout, one retry on transport failure,
// and error formatting that preserves the network cause instead of hiding it.

export const UPSTREAM_TIMEOUT_MS = 45000;

export async function fetchWithTimeout(url, opts = {}) {
  const {
    tries = 2,
    delayMs = 1500,
    timeoutMs = UPSTREAM_TIMEOUT_MS,
    fetchImpl = fetch,
  } = opts;
  let lastErr;
  for (let i = 0; i < tries; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      return await fetchImpl(url, { signal: ctrl.signal });
    } catch (e) {
      lastErr = e;
      if (i + 1 < tries) await new Promise((r) => setTimeout(r, delayMs));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

// "fetch failed" alone hides why; undici carries the real reason in e.cause.
export function formatUpstreamError(e) {
  const cause = e?.cause?.code ?? e?.cause?.message ?? null;
  return `${String(e?.message ?? e)}${cause ? ` (upstream: ${cause})` : ""}`;
}

// Try the same request path against each mirror host in order.
// Fails over on transport errors and non-2xx responses; returns the URL
// that actually served so provenance stays exact.
export async function fetchFromHosts(hosts, path, opts = {}) {
  // failover replaces per-host retry: one 15s attempt per host bounds the
  // total wait (2 hosts -> at most ~30s) instead of retrying a dead network
  const { tries = 1, timeoutMs = 15000, ...rest } = opts;
  let lastErr = null;
  for (const host of hosts) {
    const url = host + path;
    try {
      const r = await fetchWithTimeout(url, { ...rest, tries, timeoutMs });
      if (!r.ok) {
        lastErr = new Error(`upstream ${r.status} from ${host}`);
        continue;
      }
      return { res: r, url, host };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}
