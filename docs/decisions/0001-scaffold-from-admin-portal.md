# 0001 — Scaffold from the bt-servant-admin-portal shape

**Status:** Accepted · **Date:** 2026-08-22

## Context

There was no PWA scaffold anywhere in the workspace — a search for
`manifest` / `service-worker` / `vite-plugin-pwa` / `workbox` across every
sibling project returned nothing. The choice was between `npm create vite` and
copying the shape of an existing uW repo.

## Decision

Copy the structure of `bt-servant-admin-portal`: Vite + React 19 + TypeScript
strict + Tailwind 4 + vitest + husky + Prettier, with the onion architecture
(`types → lib → hooks → components → app`) enforced by ESLint
`no-restricted-imports`.

Deviations from that source, and why:

- **No Cloudflare Worker BFF.** The admin portal proxies an API; Phase 1 of tC
  Mobile is entirely offline and has no backend. `wrangler.jsonc` is an
  assets-only deployment.
- **No Font Awesome Pro.** The portal's CI needs a licensed npm token, and
  avoiding it keeps CI secret-free. This originally named `lucide-react` as the
  replacement. That dependency has since been removed — knip found nothing
  importing it — and the handful of icons the app uses are hand-rolled SVG in
  `src/components/icon.tsx`. The decision that stands is the no-licensed-font
  one; the library it named does not.
- **`hooks/` is the browser boundary.** Everything below it is free of DOM and
  Web Audio APIs, which is what makes the audio core testable in Node.

## Consequences

Lint, format, typecheck, and test commands match the rest of the org, so the
repo is familiar to anyone who has worked in `bt-servant-*`. The onion rule is
mechanically enforced rather than documented-and-hoped-for.
