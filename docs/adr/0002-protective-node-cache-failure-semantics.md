# Protective Node Cache failure & caching semantics

Status: accepted

A **Subscription** (an upstream "机场" link) can be flagged with `enableNodeCache`. When set, MiSub keeps a per-subscription **Protective Node Cache** — a "last known good" snapshot of that subscription's nodes — so that a later upstream **fetch failure** never makes those nodes disappear from a **Profile** or single-subscription output. The goal, in the owner's words: enabling it means *failures become invisible to clients* — no error, no node clearing.

The non-obvious part is what "failure" means and how a failure is allowed to interact with the rest of the caching layer. We made four decisions that will surprise a future reader:

1. **A `200 OK` can count as a failure.** Time-limited airports often respond to an expired/disabled switch with `200` plus a degraded body (e.g. a single "已到期/请续费" pseudo-node) instead of an error status. So beyond network errors, non-OK status, timeouts, and zero-valid-node responses, a **suspicious** response — one that succeeds at the HTTP level but returns *drastically fewer* nodes than the snapshot (drop-guard, ~<50% of a non-trivial snapshot) — is treated as a (soft) failure. On any failure the snapshot is preserved and served, not overwritten. A minor, plausible decrease *does* overwrite.

2. **A failed fetch still refreshes the fast cache.** Serving from the snapshot is treated as a *soft success* for the **Combined-List Cache** (the short-lived per-Profile assembled-output cache). Without this, once that cache ages out (max 12h) every client request would re-hit the dead airport and eat its full fetch timeout before falling back. Background refresh continues to retry the real upstream periodically.

3. **The snapshot never expires.** It is served until a real success overwrites it. "Stale-but-present" always beats "empty." The owner learns the airport is actually down from the dashboard's "已用缓存 · 上次成功于 X" indicator, not from a broken subscription.

4. **External perception is normal; the owner's view is honest.** Client output is silent — no error, cached nodes served as if live. The owner's dashboard serves the same cached nodes but badges them as cached with the last-success time. These are two deliberately different truths for the same state.

To make 1–4 consistent across *every* surface (client pull, dashboard preview, dashboard node-count update, cron sync), snapshot read/write/drop-guard must live behind a **single subscription-fetch entry point**. Today two paths exist — `fetchSingleSubscription` (output) and `fetchSubscriptionNodes` (preview/count) — and only the first touches the cache, which is why the snapshot was cold exactly when it was needed.

The snapshot stores **raw upstream node URLs** (pre per-subscription operators/filters/name-prefix). Both fresh and restored serves run the same downstream transform pipeline, so restored output is byte-identical to live output and later rename/operator edits also apply to cached nodes.

## Considered Options

- **Failures invisible to clients, honest to the owner; snapshot never expires; soft-success keeps the fast cache warm (chosen)** — maximises "对外永不报错" while keeping the owner informed and outages cheap to serve. Cost: the system can knowingly serve dead nodes indefinitely, and a `200` response is sometimes ignored.
- **Only protect the real client-output path (status quo)** — simplest, but the snapshot is never warmed by previews/cron and the dashboard still shows errors, so the feature *looks* unimplemented. Rejected: it is the bug we set out to fix.
- **Treat any `200`/any >0 nodes as success** — no drop-guard. Simpler and "trusts the upstream", but a single expiry pseudo-node poisons the snapshot precisely in the time-limited-airport case the feature targets. Rejected.
- **Expire the snapshot after N days** — avoids serving long-dead nodes, but reintroduces node-clearing/errors after the cutoff, contradicting the feature's intent. Rejected; dashboard transparency covers the "is it really still alive?" concern instead.

## Consequences

- The system can serve nodes from a long-dead airport indefinitely. This is intentional. The dashboard "cached · last-success" indicator is the *only* signal that the upstream is actually down — if that indicator regresses, the outage becomes silent to the owner too.
- The drop-guard uses a heuristic threshold. A legitimate large reduction in an airport's node count (e.g. the provider genuinely cut its fleet in half) will be treated as a suspected failure for one cycle and won't overwrite the snapshot until the count stabilises. Accepted as the safer failure mode.
- "Success" now has two meanings: a *real* upstream success (overwrites the snapshot, refreshes everything) and a *soft* success (snapshot restore — refreshes the Combined-List Cache but never the snapshot). Code and logs must not conflate them. The access log uses `resolveAccessLogStatus(...)` to emit a distinct **`cached`** status (amber stripe in the log UI) when every source produced content but at least one came from the Protective Node Cache — owner-honest, while the client still sees no error.
- All subscription fetching must route through the single entry point. Adding a new fetch caller that bypasses it silently reopens the cold-cache bug — there is no compiler enforcement, only this constraint.
- Snapshot lifecycle is tied to subscription identity, but invalidation uses two mechanisms rather than one save-time delete: **deletion / toggle-off** are handled by the existing combined-cache clear on save (`clearAllNodeCaches` preserves only the snapshots of current `enableNodeCache` subs, so a deleted or disabled sub's snapshot is wiped); **URL change** is handled by a read-time guard — a snapshot whose stored `sourceUrl` no longer matches the sub's URL is ignored and overwritten on the next successful fetch (self-healing, no old-state lookup needed at save time). Snapshots are *not* invalidated on rename/filter/operator edits, because they store raw upstream nodes and re-apply the pipeline on serve.

## Implementation notes

- The snapshot primitives live in `functions/services/protective-node-cache.js` (`readProtectiveNodeCache`, `writeProtectiveNodeCache`, `warmProtectiveNodeCache`, `shouldAcceptSnapshot`, `buildSubscriptionNodeCacheKey`). All warming/restoring routes through these.
- Warming entry points wired: client output (`generateCombinedNodeList`), node-count update (`handleNodeCountRequest`), profile preview (`handleProfileMode`), single-subscription preview (`handleSingleSubscriptionMode`), and cron sync (`_schedule.js performSubscriptionSync`). Any new fetch caller must also route through `warmProtectiveNodeCache` or it reopens the cold-cache bug.
- The owner-facing "已用缓存 · 上次成功于 X" badge renders in `src/components/ui/Card.vue` when a sub has `enableNodeCache` and a `lastError` (i.e. the displayed count is last-good cached data). End-client output stays silent (no badge, no error). The failure path in `useSubscriptions.js` now persists `lastError` (keeping the cached count/traffic) so the badge survives a page reload; success clears it.
