# Promotion plan: `staging → main`, v0.3.0 — the East Africa training build

**Status: plan for DRI review. No version bump, no promotion PR, and no merge
have been made from this document.** It is the checklist for the first
`staging → main` promotion since the 22 Aug 2026 pivot, which bumps the minor
to `0.3.0` and tags `main` `v0.2.0` → `v0.3.0` (AGENTS.md → _Versions and
milestones_).

**Snapshot at authoring time (2026-09-17), evidence-first — verify before
acting on any of it, it will be stale by morning:**

| Ref                      | Commit    | Confirmed as                                                                                                                                                 |
| ------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `main`                   | `7c560ce` | tag `v0.2.0` (`git log -1 --format=%H v0.2.0`)                                                                                                               |
| `staging`                | `88683c4` | v0.2.3 per `docs/progress_tracker.md`, 2026-09-16 entry ("#407 → #408 (`88683c4`)"); not independently re-verified against the served bundle in this session |
| `develop`                | `54c73f5` | HEAD at fetch time                                                                                                                                           |
| `package.json` `version` | `0.2.3`   | read directly, confirms the tracker's staging entry                                                                                                          |

---

## 1. Preconditions — what must be true on `staging` before promoting

**Evidence source for the live count:**
`gh issue list --repo unfoldingWord/tc-mobile --milestone "v0.3.0 — Oct: training" --state open --limit 100 --json number,title,labels`,
run 2026-09-17. **75 open issues in the v0.3.0 milestone; 15 carry
`v1-required`.** `v1-required` means "must ship in the v0.3.0 October training
build" (AGENTS.md → Conventions, confirmed by the requirements owner on issue
#243). This is a live query, not the `docs/progress_tracker.md` count from the
2026-09-16 evening entry ("v1-required open: 9, and none of them is code
except #317") — five tester-filed recorder-editor bugs (#414–#418) and #413
landed since that entry, so **the 9-item snapshot is stale; use the live query
before promoting.**

### 1.1 The 15 open `v1-required` issues (2026-09-17)

| #    | Title                                                                                               | Kind                                                                                                                                                                                                              |
| ---- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #418 | Recorder editor: hide the centerline in edit mode (no playback role there)                          | code, tester-filed                                                                                                                                                                                                |
| #417 | Recorder editor: allow playback while zoomed in                                                     | code, tester-filed                                                                                                                                                                                                |
| #416 | Recorder editor: pausing zoomed-out playback snaps view to the end                                  | code, tester-filed                                                                                                                                                                                                |
| #415 | Recorder editor: zoomed-out playback should scroll waveform under a fixed playhead                  | code, tester-filed                                                                                                                                                                                                |
| #414 | Recorder editor: paste icon hides the sample under the centerline                                   | code, tester-filed                                                                                                                                                                                                |
| #413 | iOS Capacitor 0.2.3: edit-mode audition is silent (record-mode playback is audible)                 | code, tester-filed, device-only repro                                                                                                                                                                             |
| #336 | Capacitor Android: `navigator.share` missing in System WebView — Share Chapter/Book fail in the APK | code                                                                                                                                                                                                              |
| #317 | Recorder: scroll the waveform under the centerline for play/insert/paste                            | code — **requirements owner answered the D4 gesture 2026-09-16 14:00 UTC** (pan-then-resume); tracker calls this "the last v1-required code item," but confirm it is actually merged before treating it as closed |
| #269 | Android: stored-segment playback silent (playhead moves, no audio)                                  | code                                                                                                                                                                                                              |
| #262 | Native packaging (Capacitor): installable iOS + Android                                             | mostly done — see §1.3                                                                                                                                                                                            |
| #245 | Android first on-device pass: protocol + evidence sheet                                             | **device evidence — no run sheet posted yet**                                                                                                                                                                     |
| #243 | Decisions register                                                                                  | **process — see §1.2, register not closed**                                                                                                                                                                       |
| #108 | `AudioContext` interrupted-resume latency — measure on device                                       | device evidence                                                                                                                                                                                                   |
| #59  | P1: mid-take mic interruption drops recording, deadlocks sheet                                      | iOS-verified (AGENTS.md Testing); **Android untested**                                                                                                                                                            |
| #58  | pagehide/background cancels an in-progress take                                                     | **Android untested**; iOS not explicitly re-confirmed either                                                                                                                                                      |

Inference: I have not read the code or tests behind #317, #336, #269, #413 in
this session — the table states issue status as GitHub reports it, not a
re-verification of the underlying bug.

### 1.2 The #243 decisions register — contradictory state, read the thread yourself

Issue #243 is **still open**, milestone v0.3.0. Reading all 8 comments
(2026-09-12 through 2026-09-16) surfaces a real inconsistency, not just a
stale count:

- **2026-09-15**, timjore (requirements owner) answers **Q1** (Share Segment:
  no for v1), **Q5** (edit-after-Finished: yes), **Q7** (spoken prompts: defer
  past October), **#250** (public flip: post-training) — all in one comment.
- **2026-09-16**, sethstoll's two follow-up comments each restate **"Still
  open on this register: Q1, Q2, Q5, Q7, #13"** — i.e. re-listing Q1/Q5/Q7 as
  open a day after the requirements owner answered them in-thread.

**This is either a bookkeeping error in the 2026-09-16 comments (most likely
— they read as a copy-forward of an earlier line that wasn't updated) or a
sign the answers weren't actually written back to `docs/design/pivot-plan.md`
and the affected issues as timjore's comment asked.** I do not have evidence
to tell which. **Confidence: low pending a DRI check of
`docs/design/pivot-plan.md`'s open-questions register against the #243
thread.**

What the thread does support without contradiction:

- **Q2** (template: content pack vs. structure generator): accept-the-default, recorded 2026-09-12/15.
- **Q6** (archive/manifest): flat zip sufficient for v1, warn on missing chapters; recorded on #115, 2026-09-15/16.
- **#116** (partial-chapter warning): yes, recorded 2026-09-15.
- **#134** (record-then-edit shape): closed via #268, 2026-09-09.
- **Native packaging**: Capacitor, decided; scope in #262.
- **#317 D4 gesture**: answered 2026-09-16 14:00 UTC (§1.1).

**Precondition:** before treating #243 as satisfied, the DRI (or requirements
owner) confirms in writing on #243 that Q1/Q2/Q5/Q7/#13 are genuinely closed
(or explicitly deferred to v1.0.0 per AGENTS.md's "moved explicitly, never
silently" rule), and #243 itself is closed. **Do not promote on the assumption
that the register is closed just because most of its rows have answers
somewhere in the thread.**

### 1.3 Device evidence still owed (#245, #405, #413)

- **#245 — Android has never run this app**, full stop. AGENTS.md's Testing
  section says so in as many words, and no run-sheet comment exists on #245
  as of this session. The issue specifies a 16-step protocol (install, mic
  permission states, record/play, sub-timeslice take, background mid-take,
  background-right-after-Stop, incoming call, system Back gesture, Finished
  transcode, edit-after-Finished, Share Chapter, Share Book, storage
  persistence, lock-during-encode, kill-and-relaunch) with a PASS/FAIL/NOT RUN
  line per step. **None of it is recorded.** This blocks closing #58, #59,
  #108, #269, #336 for Android, all of which are `v1-required`.
- **#405 item 2 — WebKit heartbeat for the MP3 encoder is unverified.** The
  15 s dead-worker heartbeat is proven only in Chromium
  (`e2e/browser-boundary-smoke.spec.ts`, 10-minute encode, longest silence
  501 ms). If WKWebView holds a busy worker's `postMessage` calls until the
  loop returns, a real multi-minute iOS Share would be killed at 15 s. The
  issue proposes two fixes: a CI WebKit Playwright project (WebKit cannot run
  in this dev container — host libraries missing, per #405), or one iPhone
  Share of a multi-minute chapter on the next TestFlight build. **Neither has
  happened as of this session.**
- **#413 — iOS Capacitor edit-mode audition is silent**, tester-reported
  (Tim, TestFlight 0.2.3) 2026-09-16/17, `v1-required`, unresolved, still has
  an open question to the reporter (is it every playback, or only stored
  segments — which would line it up with #269's Android symptom). Distinct
  from the already-fixed #106 (iOS Safari). **Playback in the editor is how a
  translator checks their own work — this is a training-blocking symptom
  until narrowed.**

**Precondition, stated plainly: an Android run sheet on #245 covering at
minimum steps 3, 4, 6, 7, 8, 9, 12, 13, 14 (mic, record/play, background,
interruption, system Back, Share, storage) should exist and be clean (or have
every FAIL triaged and either fixed or explicitly accepted as a residual)
before promoting. #413 should be narrowed at minimum, and fixed if it turns
out to be a regression rather than a WKWebView-specific gap.** This is
inference/recommendation on my part, not a decision anyone has recorded — the
DRI may accept a lesser bar; if so, that acceptance should be written on #244's
successor issue (§6) the way #244 recorded its own accepted gaps for v0.2.0.

### 1.4 Native packaging status (#262)

Mostly built, not fully closed:

- iOS TestFlight lane and Android APK lane are both **proven behind the
  `release-signing` environment gate**, per `docs/progress_tracker.md`
  2026-09-16 evening entry: iOS run `35151445350` from `staging` `88683c4`
  uploaded to TestFlight; Android run `35151461247`, same ref, produced the
  `android-release-v0.2.3` pre-release (tag confirmed present:
  `git tag --list` shows `android-release-v0.2.3`).
- **Open in #262:** "Version stamped and short install instructions for
  testers" is the one unchecked box. `docs/tester-install.md` line 39 still
  has a literal `<placeholder: download URL>` for the Android link — read
  directly, not inferred.
- `versionName` on the APK is hardcoded `"1.0"` (Capacitor template default;
  `docs/native/README.md` §1, confirmed again in the 2026-09-16 tracker entry)
  — tracked as #410, a one-line `build.gradle` fix, open as of the last
  tracker entry.

---

## 2. The mechanics — `chore(release)` → `staging` → `main`

Per AGENTS.md → _Versions and milestones_ and _Cloudflare Workers Builds_:

1. **`chore(release): v0.3.0` PR into `develop`.** Bumps `package.json`
   `version` from `0.2.3` to `0.3.0` — this is the **minor** bump, because
   this promotion is `staging → main` (the milestone-named one), not another
   daily patch. Body lists every PR the promotion carries since `main`'s last
   promotion (`v0.2.0`, `7c560ce`) — that is every `develop`/`staging` PR
   merged since, which is a long list (`docs/progress_tracker.md`'s 2026-09-16
   entries alone list 20+). **Inference:** AGENTS.md's example shape (#131) is
   for a `develop → staging` patch bump; nothing in AGENTS.md describes the
   `staging → main` PR's body shape beyond "lists the carried PRs" — #244 (the
   v0.2.0 gate template, closed) is the closest precedent and is worth
   re-reading structurally, not copying verbatim since its content is
   v0.2.0-specific.
2. **`develop → staging` PR**, ordinary daily patch promotion, carries the
   `chore(release)` commit and anything else merged to `develop` since
   `staging` last moved. Verify the served bundle on
   `https://tc-mobile-staging.unfoldingword.workers.dev` stamps `0.3.0` and the
   merge SHA before treating this step as done (§2.4 — same verification
   method as the next step, just against staging).
3. **`staging → main` PR, merged with `--merge` (a merge commit), not
   squash.** AGENTS.md does not say this explicitly in so many words for this
   specific PR type, but it is the only reading consistent with "promoted to,
   not worked on" (Conventions) and with tagging a specific commit that
   preserves `staging`'s history on `main` — **labeled as inference from the
   branch model, not a quoted rule; confirm with the DRI before merging any
   other way.** The instructions for this task state `--merge` explicitly, so
   treat that as settled unless the DRI overrides it.
4. **Tag `main`:** `git tag v0.3.0` on the merge commit, push the tag. This is
   the **second** tag this repo will have created (`v0.2.0` is the first,
   confirmed via `git tag --list`).
5. **Workers Builds deploys `tc-mobile`** (production branch `main`,
   `npx wrangler deploy`, per AGENTS.md's Workers table). Non-production
   builds are **off** on this Worker, so only the `main` push triggers a
   build — no double-deploy risk here (that risk lives on `tc-mobile-staging`,
   already flagged in AGENTS.md).

### 2.4 Verifying the deploy — the #143 caveat

**A merged promotion PR is not a deployed build.** AGENTS.md, DRI section:
the GitHub→Cloudflare connection broke on the 2026-09-02 org transfer (#143),
and the first post-transfer promotion (#142, staging v0.1.11) merged green
without ever deploying. **Confirm the served bundle's version string on the
production URL, not the merge**, exactly as AGENTS.md instructs for staging.

**The production URL is not documented anywhere in this repository.**
Checked: `AGENTS.md`, `README.md`, `CONTRIBUTING.md`, `docs/progress_tracker.md`
are the only files mentioning `unfoldingword.workers.dev`, and every one of
them names only the **staging** URL,
`https://tc-mobile-staging.unfoldingword.workers.dev`. `wrangler.jsonc` sets
the production Worker's `name` to `"tc-mobile"` with `workers_dev: true` (no
`env` wrapper — it is the top-level config), which — **by the same naming
pattern as staging, as inference, not confirmed** — would put the production
URL at `https://tc-mobile.unfoldingword.workers.dev`. **This has not been
observed to resolve or to serve the app; get the Cloudflare dashboard's actual
URL for the `tc-mobile` Worker before relying on this guess**, and record the
confirmed URL back into this doc or into AGENTS.md once known.

Verification method once the URL is confirmed, mirroring #215's (still-open,
unmerged) `check-deploy.mjs` approach or a plain check:

```
curl -s https://<production-url>/version.json
# or, if #215 has not merged by promotion time:
curl -s https://<production-url>/ | grep -o 'v[0-9]*\.[0-9]*\.[0-9]*.\{0,10\}'
```

compare against `0.3.0` and the `main` merge SHA. **#215 (`feat(release): emit
version.json...`) is still an open PR, not merged** (confirmed:
`gh pr list --search 215` shows state OPEN) — if it lands before this
promotion, `version.json` is the clean check; if not, fall back to grepping
the served HTML for the footer build-stamp string
(`src/components/build-stamp.tsx`, referenced in
`docs/training/facilitator-runbook.md` as `v0.2.1 · a1b2c3d`-shaped text).

---

## 3. Native builds — dispatch from `main` becomes possible only after this promotion

Both native lanes are `workflow_dispatch`-only and **each dispatch runs the
`.yml` and `Fastfile`/Gradle config _committed on the ref being dispatched_**,
not whatever is on `develop` (this is the "ref gotcha" recorded independently
in this session's memory and consistent with `docs/native/README.md` §4a/§5a's
description of the ref guard). Concretely:

- **Before this promotion, `main` has no `release-signing`-gated workflow on
  it at all** (the gate was built and proven on `staging` per the 2026-09-16
  evening tracker entry) — so **`main` is not yet dispatchable**, and the
  promotion is what makes it dispatchable, by carrying the current
  `ios-testflight.yml` / `android-apk.yml` onto `main`.
- **The `release-signing` environment** (`docs/native/README.md` §4a step 4)
  gates both lanes' signing jobs behind one required-reviewer approval. Before
  approving a dispatch from `main`, open `.github/workflows/<lane>.yml` **on
  the ref the run shows** and confirm it matches the committed lane — this is
  the explicit anti-#321 instruction in the README, not optional caution.
- **TestFlight**: `docs/native/README.md` §4a — build number is the run's
  unix timestamp (`CFBundleVersion`), independent of `package.json`; marketing
  version (`MARKETING_VERSION`) is a separate native-project field, currently
  `1.0`, bumped manually in the Xcode project, not by this promotion. A green
  run means uploaded, not that a tester received it — confirm the internal
  tester group has "Automatically distribute new builds" on, or assign by
  hand.
- **Signed APK pre-release**: `docs/native/README.md` §5a — `versionCode` is
  also a unix timestamp; `versionName` is hardcoded `"1.0"` (#410, open, not
  fixed by this promotion). The APK is a **workflow run artifact**, not a
  GitHub Release — §5a says explicitly "nothing creates a GitHub release or
  pre-release today," so despite the git tag `android-release-v0.2.3` existing
  in this repo (confirmed via `git tag --list`), that tag is **not** the same
  thing as the artifact-attached pre-release the README describes as a
  "follow-up once a release step exists" — do not conflate the two. Recommend
  a fresh dispatch from `main` after the promotion, once the DRI wants a
  `v0.3.0`-labeled build for the training rather than relying on the last
  staging-built one.
- Both lanes were **already proven from `staging`** at `88683c4` (§1.4) — the
  open work here is re-dispatching from `main` once `main` carries the gated
  workflow, to get training-distributable builds actually built off the
  tagged production ref rather than off staging.

---

## 4. Rollback

- **No merged rollback runbook exists.** PR #215
  (`feat(release): emit version.json, add a post-promotion check and a
rollback runbook (#176)`) drafts exactly this — a `version.json` check
  script and an AGENTS.md subsection "Confirming a deploy and rolling one
  back" covering `npx wrangler rollback` — but is **confirmed still OPEN**,
  10 comments, not merged, as of this session (`gh pr list --search 215`).
  **Do not cite it as an existing procedure; it is a proposal.**
- **What does exist, as fallback:** Cloudflare's own rollback (dashboard, or
  `npx wrangler rollback --env staging` for the staging Worker — the
  production equivalent per #215's draft would be `npx wrangler rollback`
  with no `--env` flag, unverified against a live rollback in this session)
  reverts the **deployed asset version**, not the git branch. AGENTS.md and
  #215's PR body agree rollback does **not** move `main`, and an
  already-installed PWA keeps its old service worker until it next checks —
  so a rollback does not retroactively fix a device that already updated.
- **Git-level fallback, if the Cloudflare rollback path is not trusted or not
  available:** re-promote `staging` at its **previous** known-good tag/commit
  through a new `staging → main` PR (a revert-and-repromote, not a force-push
  to `main` — AGENTS.md's "never work directly on `main`" applies equally to
  fixing it). Concretely: identify the last good `staging` SHA (before the
  v0.3.0 promotion — `88683c4` is that point as of this plan), branch from it,
  and run the same PR mechanics in §2 again. This is slower than a Cloudflare
  rollback but does not depend on #215 landing first.
- **Recommendation, labeled as inference:** merge #215 before or alongside
  this promotion if the DRI has the review cycles — a `version.json`-based
  automated check materially de-risks the #143 failure mode this promotion is
  most exposed to (a green merge with no actual deploy). Not a hard blocker;
  the manual `curl`+grep check in §2.4 covers the same ground by hand.

---

## 5. Milestone hygiene

Per AGENTS.md → _Versions and milestones_: "Every open issue carries a
milestone. ... A milestone closes when its promotion PR merges, and anything
still open in it moves to the next one explicitly, never silently."

- **When the `staging → main` v0.3.0 PR merges:** close the `v0.3.0 — Oct:
training` milestone.
- **Before closing it**, every one of the (at minimum) 75 currently-open
  issues in it (§1) must be either closed or moved to `v1.0.0 — Post-training`
  **explicitly**, each with a comment saying so (the pattern #244 and #243
  already use — e.g. "#38, #361, #246, #253, #272 demoted to v1.0.0," recorded
  in `docs/progress_tracker.md` 2026-09-16). **A milestone closing with open
  issues silently attached is exactly what AGENTS.md forbids.**
- The `v1.0.0 — Post-training` milestone already exists and already holds
  open issues (confirmed: #353, #355, #357, #359, #361 among others) — moving
  more into it is additive, not a new setup step.
- **Precedent to reuse:** #244 (closed) was the equivalent gate-checklist
  issue for `v0.2.0`. Filing a `v0.3.0` sibling issue (not drafted here — that
  is execution, out of scope for this planning doc) mirroring #244's
  structure — code-that-must-be-on-staging / evidence-that-must-exist /
  process-that-must-be-true, each line owned — is the natural mechanism for
  tracking the "explicitly moved, not silently" requirement at promotion time.

---

## 6. One-page checklist for the DRI

Copy into the `staging → main` PR body or a tracking issue; tick nothing here.

**Before opening the `chore(release)` PR**

- [ ] Re-run the live `v1-required` query (§1) — do not trust this doc's count, it will be stale.
- [ ] #243 register: get an explicit DRI/requirements-owner statement resolving the Q1/Q2/Q5/Q7 contradiction in the thread (§1.2), and close #243.
- [ ] #245: an Android run sheet exists, posted as a comment, with every FAIL triaged (fixed or accepted-and-recorded).
- [ ] #405 item 2: WebKit heartbeat verified on-device (multi-minute iPhone Share) or via a CI WebKit job.
- [ ] #413: narrowed at minimum (every-playback vs. stored-segment-only); fixed if it's a regression.
- [ ] #262: install instructions written (replace the `<placeholder: download URL>` in `docs/tester-install.md`).
- [ ] Every other open `v1-required` issue (§1.1) explicitly triaged: fixed, or accepted as a residual with the acceptance recorded on the issue.
- [ ] Decide whether #215 lands first (recommended, not required).

**The promotion itself**

- [ ] `chore(release): v0.3.0` PR → `develop`, version bump only, lists carried PRs.
- [ ] `develop → staging`; confirm staging serves `0.3.0` at the correct SHA (curl/grep or `check-deploy.mjs` if #215 landed).
- [ ] `staging → main`, merged with `--merge` (not squash).
- [ ] `git tag v0.3.0` on the merge commit; push the tag.
- [ ] Confirm the production Worker's actual URL in the Cloudflare dashboard (not documented in-repo as of this plan) and record it in AGENTS.md/README.
- [ ] Confirm the production URL serves `0.3.0` at the merge SHA — do not treat the green merge as the deploy (#143).

**Native**

- [ ] Dispatch `ios-testflight.yml` from `main` once it carries the gated workflow; approve only after reading the `.yml` on the dispatched ref.
- [ ] Dispatch `android-apk.yml` from `main` the same way.
- [ ] Confirm `versionName`/`MARKETING_VERSION` reflect a v0.3.0-era build if the DRI wants that distinct from the last staging-built artifacts.

**Rollback readiness**

- [ ] Know the pre-promotion `staging` SHA (this plan's snapshot: `88683c4`) as the fallback re-promotion point.
- [ ] Confirm which rollback path is available (`wrangler rollback` vs. re-promotion) before merging, not after something breaks.

**Milestone**

- [ ] Every remaining open v0.3.0 issue closed or explicitly moved to v1.0.0, each with a comment.
- [ ] Close the `v0.3.0 — Oct: training` milestone once the PR merges.

---

_Evidence for every claim above is cited inline (file path, issue/PR number,
or the exact command run). Where no direct evidence exists, the claim is
marked inference or recommendation. Nothing in this document has been acted
on — no version bump, no promotion PR, no merge._
