# Node URL is the lossy canonical node form; build must round-trip everything parse reads

Status: accepted

Every node MiSub handles is normalized to a single **Node URL** line — the canonical internal representation — regardless of the format it arrived in. A **Subscription** that serves Clash YAML is flattened proxy-by-proxy into Node URLs at parse time (`node-parser.js` → `convertClashProxyToUrl` → each protocol adapter's `build()`); base64 and plain-URI sources already are Node URLs. Dedup, the **Operator Chain**, and all output generation operate on this one form.

We keep the Node URL as the *only* canonical form on purpose: dedup is a string-set over URL lines, the Operator Chain processes line-oriented text, and a single representation avoids a second "rich proxy object" model running in parallel. The cost is that the Node URL form is a **lossy bottleneck**: any field a protocol's URL form cannot express, or that its `build()` simply does not serialize, is gone for good — including in the final Clash output, even though the node *started* as a richer Clash YAML proxy.

The non-obvious decisions a future reader will want explained:

1. **The loss is accepted, but it must be the URL format's loss, not the code's.** A field that the URL form *can* carry but `build()` forgets to write is a **bug**, not an accepted limitation. We do not curate a per-field "important enough to keep" list — that invites endless argument about whether `alpn` or `fp` is "key".

2. **Symmetric build/parse invariant.** For every protocol adapter, `build()` must serialize every field its own `parse()` reads, whenever the URL scheme can represent it. Concretely this is the round-trip identity: `parse(build(parse(url))) ≡ parse(url)` for the fields parse extracts. This invariant is the definition of "done" for adapter work — not a subjective field audit.

3. **Genuinely unrepresentable fields are listed as exceptions, not silently dropped.** If a scheme truly cannot carry a field that `parse()` produced (or that only the rich Clash model has), it is recorded here as an accepted-loss exception so the next reader does not "fix" it. (None are recorded yet; populate this list as real cases are found.)

The gaps that motivated this ADR — all confirmed parse-reads-it / build-drops-it asymmetries, all reaching final output for Clash-YAML Subscriptions: VLESS `alpn` + `skip-cert-verify`, VMess `scy` (cipher) + `alpn`, Trojan `client-fingerprint` (`fp`) + `dialer-proxy` (`dp`), and SS plugin-opts (only `mode`/`host`/`enabled`/`padding` survive, so `v2ray-plugin`'s `path`/`tls`/`mux` are lost). `skip-cert-verify`/`alpn` loss breaks TLS for self-signed / ALPN-pinned nodes, so this is a connectivity bug, not cosmetics.

## Considered Options

- **Node URL as lossy canonical form + symmetric build invariant enforced by round-trip fixtures (chosen)** — keeps one representation and one simple, mechanical correctness rule. Cost: every adapter owes a fixture test, and some loss is permanently accepted where the URL form can't carry a field.
- **Curate a "key fields only" allowlist to round-trip** — fix `skip-cert-verify`/`alpn`/`scy`/SS-`path` and accept losing `fp`/`dp`/`mux`. Rejected: the line between "key" and "cosmetic" is a recurring judgment call, can't be expressed as a test, and `fp`/`dp` matter to some users.
- **Introduce a rich proxy object as the canonical form (carry the full Clash proxy through the pipeline)** — lossless, but forces dedup, the Operator Chain, and every output path to understand a second model, and re-opens the question of how non-Clash sources map into it. Rejected as a large architectural change disproportionate to the problem.
- **Status quo (piecemeal field fixes as bugs are reported)** — rejected: without the invariant + fixtures the same class of loss silently reappears with the next protocol or refactor.

## Consequences

- "Fix a protocol round-trip bug" now has a precise, testable meaning: make `build()` emit every field `parse()` reads, then add/extend a round-trip fixture. No severity debate per field.
- Each protocol adapter owes a round-trip fixture (`tests/unit/protocol-adapters-registry.test.js` / `protocol-conversion-fixtures.test.js` are the homes). A new adapter without one is incomplete.
- Some node fidelity is permanently sacrificed for representation simplicity. When that bites a real field the URL form *can't* carry, the answer is to record it in the exceptions list above — not to add a parallel model.
- There is no compiler enforcement of the invariant; only the fixtures. A `build()` that drops a freshly-added parse field will pass type-checking and silently lose data unless a fixture covers it.

## Implementation notes

- Adapters live in `functions/utils/protocol-adapters/index.js` (per-protocol `{ parse, build }`); transport (`ws`/`grpc`/`h2`/`reality`/…) `*-opts` are shared in `shared.js`. The dispatchers `url-to-clash.js` / `clash-to-url.js` are thin and should stay thin.
- Known invariant violations as of this ADR (to be closed): VLESS `alpn`,`skip-cert-verify`; VMess `scy`,`alpn`; Trojan `fp`,`dp`; SS full `plugin-opts` passthrough.
- Watch `shared.js` `parseQueryParams`: it uses `URLSearchParams`, which decodes `+` as space and will corrupt base64-bearing query fields (WireGuard keys, hy2 `obfs-password`) — a related round-trip-fidelity bug in the parse direction.
