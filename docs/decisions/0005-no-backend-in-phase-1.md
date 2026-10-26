# 0005 — No backend in Phase 1

**Status:** Accepted · **Date:** 2026-08-22

**Revisited 2026-10-19 by [ADR 0011](0011-v2-storage-and-export.md)** — the
decision stands; on Android, v2 records straight onto the microSD card
(decided, not built), so IndexedDB will not be the only system of record.

## Context

The inception notes say "standalone, mobile (Android + iOS), **offline**, oral."
The sibling repo this scaffold copies (`bt-servant-admin-portal`) carries a
Cloudflare Worker BFF, auth, and KV bindings.

## Decision

Ship no Worker script, no auth, no API, and no KV. `wrangler.jsonc` deploys
`dist/` as static assets with SPA fallback. All state lives in IndexedDB on the
device.

## Rationale

Every backend dependency is a thing that can be unavailable in a field setting,
which is precisely where this has to work. A static deployment is also the
fastest route to the thing the requirements owner actually asked for: an HTTPS
URL that opens on a phone.

## Consequences

- **IndexedDB is the system of record, not a cache.** Losing it loses a
  translator's work. That is why `tests/storage.test.ts` exercises the
  repository against `fake-indexeddb` rather than trusting on-device spot
  checks, and why `putClip` writes metadata and samples in one transaction.
- Sharing audio off the device **will be** via the Web Share API / file
  download, not an upload — phone-to-phone matters more than cloud here. That
  decision stands; the path does not exist yet (#18), and no code calls
  `navigator.share` or writes a file today.
- Phase 2 sync (versioning, republishing, comments) will need this decision
  revisited. Worth reading first: Shema's typed `.shema` bundles, tC4's
  `BURRITO-SPEC.md` §8, and the uW Scripture Burrito prototype's HLC event
  journal _draft_ — read-only,
  and not reusable: one operation, no export, no fold, no merge, no licence
  (docs/research/prior-art.md §1, §3).
  Amended 2026-10-19: any such revisit starts from the consent principle in
  [ADR 0012](0012-recordings-belong-to-the-community.md) (Accepted).
