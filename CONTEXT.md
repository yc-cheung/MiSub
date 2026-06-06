# MiSub — Domain Glossary

Canonical terms for MiSub. This file is a glossary, not a spec — no implementation details. When a term here conflicts with how code or conversation uses a word, the conflict gets resolved and this file updated.

## Subscription
An upstream proxy-subscription source (an "airport"/机场 link) that MiSub fetches, caches, and processes. Distinct from a **Manual Node** (a single node entered directly) and from a **Profile**.

## Profile
A named grouping of Subscriptions and Manual Nodes that produces one shareable subscription link. Has its own token, template, and operator settings that can override the global ones.

## Manual Node
A single proxy node entered directly by the user (not fetched from a Subscription).

## Node URL (canonical form)
The single internal representation every node is normalized to, regardless of the source format it arrived in (Clash YAML proxy, base64 line, plain URI). Dedup, the **Operator Chain**, and output generation all operate on this form. A deliberate consequence: any source-format field the Node URL form cannot express is **not** preserved downstream — so a node arriving as a Clash YAML proxy keeps only what survives the round trip into a Node URL. See ADR-0003.

## Target Format
The client config format a subscription request resolves to (clash, sing-box, surge, loon, quanx, egern, base64). Decided jointly by the request **User-Agent** and URL parameters.

## Operator Chain
The current node post-processing pipeline: an ordered list of operators (filter, rename, script, sort, dedup) applied to a node list. Configured via the `defaultOperators` setting. Supersedes the legacy `defaultNodeTransform` config, which still exists for compatibility.

## Protective Node Cache
A per-**Subscription** "last known good" snapshot of that subscription's nodes, kept so a later **fetch failure** never makes those nodes disappear. When enabled for a Subscription and an upstream fetch fails (network error, non-OK HTTP, timeout, or a response that yields zero valid proxy nodes), MiSub serves the last successful snapshot instead. End clients perceive no error and no node loss; the owner's dashboard still serves the cached nodes but signals that they are cached and when the last success was. Distinct from the **Combined-List Cache**.

## Combined-List Cache
A short-lived performance cache of the *fully assembled* node list for one **Profile** or token, used to answer client requests fast and to absorb transient upstream slowness. Time-bounded (fresh / stale / expired). Distinct from the **Protective Node Cache**, which is per-Subscription, durable, and exists to preserve nodes across failures rather than to speed up responses.

## Node Preview
An owner-facing view of the nodes a single **Subscription** ("单点订阅预览") or a whole **Profile** ("订阅组预览") currently resolves to. It is part of the owner's dashboard, so it obeys the **Protective Node Cache** honesty contract: when the live upstream **fetch fails** (or yields no trustworthy nodes) and a snapshot exists, it shows the cached nodes flagged as cached ("已用缓存 · 上次成功于 X") instead of reporting "no nodes" — mirroring what clients actually receive while staying honest that the data is cached. Distinct from client subscription output, which serves the same cached nodes *silently*.

## Fetch Failure
For Protective Node Cache purposes, a pull of a Subscription's upstream is a **failure** when it does not yield trustworthy nodes: a network/transport error, a non-OK HTTP status, a timeout, a response that parses to zero valid proxy nodes (the "airport returns an expiry/blank page" case), or a **suspicious** response — one that succeeds at the HTTP level but returns drastically fewer nodes than the last good snapshot (the "time-limited airport returns a single 已到期 pseudo-node" case). On any failure, the snapshot is preserved and served rather than overwritten. A minor, plausible decrease in node count is **not** a failure and does overwrite the snapshot.

## Subscription Sync
Scheduled, server-initiated **refresh** of the stored node lists / counts / traffic info for Subscriptions, pulling from their upstream sources. Distinct from **Cron Notification**.

## Cron Notification
Scheduled traffic/expiry checks that push **Telegram** messages to the user. Does not itself refresh node data. Distinct from **Subscription Sync** — they are different jobs that currently live in different modules.
