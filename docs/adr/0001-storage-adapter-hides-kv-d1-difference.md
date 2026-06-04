# Storage adapter fully hides the KV/D1 difference

Status: accepted

MiSub supports two storage backends (Cloudflare KV and D1) behind `StorageFactory`. We decided the adapter interface must **fully hide** which backend is in use: callers never branch on `adapter.type`, and capability differences (atomic row-level writes, TTL expiry) are handled *inside* the adapter rather than exposed. KV continues to emulate row-level operations by load-all → modify → write-all (O(n)); `withTTL` is native on KV and implemented on D1 via an expiry column with lazy cleanup-on-read.

## Considered Options

- **Full encapsulation (chosen)** — one interface, no `.type` on the public surface. Maximises caller simplicity and restores cron-status/TTL features on D1-only deployments (previously these bypassed the adapter and silently no-op'd on D1).
- **Named capability interface (rejected)** — keep one honest `supportsRowLevel()` query instead of scattered `.type === KV` checks. More truthful, but still leaks the backend distinction into every caller that does anything non-trivial.

## Consequences

- KV's "row" methods are a deliberate illusion: they rewrite the whole blob on every mutation. This is acceptable for MiSub's data volumes but is **not** O(1) — do not assume cheap per-row writes on KV.
- D1 gains an expiry column for TTL-style keys; entries are cleaned lazily on read, so expired-but-unread rows can linger.
