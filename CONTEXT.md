# MiSub — Domain Glossary

Canonical terms for MiSub. This file is a glossary, not a spec — no implementation details. When a term here conflicts with how code or conversation uses a word, the conflict gets resolved and this file updated.

## Subscription
An upstream proxy-subscription source (an "airport"/机场 link) that MiSub fetches, caches, and processes. Distinct from a **Manual Node** (a single node entered directly) and from a **Profile**.

## Profile
A named grouping of Subscriptions and Manual Nodes that produces one shareable subscription link. Has its own token, template, and operator settings that can override the global ones.

## Manual Node
A single proxy node entered directly by the user (not fetched from a Subscription).

## Target Format
The client config format a subscription request resolves to (clash, sing-box, surge, loon, quanx, egern, base64). Decided jointly by the request **User-Agent** and URL parameters.

## Operator Chain
The current node post-processing pipeline: an ordered list of operators (filter, rename, script, sort, dedup) applied to a node list. Configured via the `defaultOperators` setting. Supersedes the legacy `defaultNodeTransform` config, which still exists for compatibility.

## Subscription Sync
Scheduled, server-initiated **refresh** of the stored node lists / counts / traffic info for Subscriptions, pulling from their upstream sources. Distinct from **Cron Notification**.

## Cron Notification
Scheduled traffic/expiry checks that push **Telegram** messages to the user. Does not itself refresh node data. Distinct from **Subscription Sync** — they are different jobs that currently live in different modules.
