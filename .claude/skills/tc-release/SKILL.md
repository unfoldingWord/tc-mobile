---
name: tc-release
description: Step-by-step checklist for cutting a tC Mobile tester release (a 1.0.0-rc.N candidate) or the final v1.0.0 promotion. It covers scope picks, the version bump, the pinned release branch, the promotion PR, the release red team, the DRI go/no-go, check:deploy, all channels from one commit, APK checks, the tester-build pre-release with QR, TestFlight group assignment and records. Use whenever cutting, promoting or publishing a tc-mobile release.
---

# tc-release

This is a checklist, not authority. Every merge, publish and scope choice is
the DRI's, asked in a picker and quoted verbatim on the PR it concerns. The
reference is `docs/release/promotion-v1.0.0.md` §3a (release candidates) and
§6 (the final promotion). Read them before starting. Where this skill and the
runbook disagree, the runbook wins, and fix this file.

Work through the list in order and don't skip a step. If a step can't be
done, stop and say which one and why.

## 0. Before anything

- [ ] Read the open-PR list and the handoff note. Know the staging commit,
      the last RC tag and the freeze state (memory `tc-mobile-v1-release-freeze`).
- [ ] Scope: the DRI picks which fixes ship. Each fix is its own PR and
      issue, clean from both uwreview lenses, merged with
      `--match-head-commit <reviewed sha>`.

**Two commits name every step below.** Write both down when they exist and
use no other:

- **`CUT_SHA`**: the squash commit of the bump PR on `develop`. The bump
  merges **last**, after every picked fix, so `CUT_SHA` is the exact tree
  being promoted. If anything merges to `develop` after it, stop and cut a
  new bump.
- **`PROMO_SHA`**: the promotion PR's merge commit on `staging`. Every
  channel (web, Play, APK, TestFlight) must be built from it.

**Merges are the DRI's, run from their own terminal.** An agent following
this checklist never merges the bump or the promotion, and never passes
`--admin`. It asks in a picker and hands over the PR number and the head to
pin, then waits.

## 1. Bump

- [ ] Every picked fix is merged. Branch from the `origin/develop` tip, then run
      `npm version 1.0.0-rc.N --no-git-tag-version` (or `1.0.0` for the final).
      Only `package.json` and `package-lock.json` change.
- [ ] Body: every PR carried, what a tester will see, not in this build,
      not run, and the DRI's cut pick (verbatim).
- [ ] Storage: `git diff <last RC's CUT_SHA> HEAD -- src/lib/storage` is empty, or
      the migration is named. State `DB_VERSION`.
- [ ] `closingIssuesReferences` is `[]` (and grep the title too).
- [ ] Human-only: the DRI merges it by squash after review. Its squash
      commit is `CUT_SHA`. Check that `origin/develop` equals `CUT_SHA`.

## 2. Promotion

- [ ] If `release/v1.0.0-rc.N` already exists
      (`gh api repos/unfoldingWord/tc-mobile/git/ref/heads/release/v1.0.0-rc.N`),
      stop and ask. Never move or reuse it.
- [ ] Create it at `CUT_SHA`:
      `gh api repos/unfoldingWord/tc-mobile/git/refs -f ref=refs/heads/release/v1.0.0-rc.N -f sha=<CUT_SHA>`.
- [ ] Open the PR `release/v1.0.0-rc.N → staging` with a **hold** line at the
      top ("release red team first"). `closingIssuesReferences` is `[]`.

## 3. Release red team (every cut; the DRI requires it)

Run read-only agents and write their reports to the job tmp:

- [ ] **Risk register** over `git log --first-parent origin/staging..<CUT_SHA>`:
      BLOCK / FIX-BEFORE-PUBLISH / NOTE, with file:line, labelled observed or
      inferred. It covers data safety, each PR, interactions between PRs
      merged in parallel, bench deferrals and unanswered inline review
      comments (a P2 left unanswered is a finding).
- [ ] **Announcement claim check** of the tester announcement and the bump
      body: TRUE / FALSE / OVERSTATED / MISSING CONTEXT, with corrections.
- [ ] **Delta pass** over anything the first two passes didn't cover up to
      `CUT_SHA`.
- [ ] Apply every FALSE and OVERSTATED correction.
- [ ] Take each FIX-BEFORE-PUBLISH item to the DRI in a picker: fix it in
      this RC, or accept it. Record each pick verbatim on the relevant PR.
- [ ] File one batched follow-up issue (next milestone) for deferred review
      items.
- [ ] Post the red-team summary on the promotion PR, then ask the DRI for
      go/no-go.

## 4. Merge and deploy

- [ ] Human-only: after a recorded go, the DRI merges the promotion with a
      merge commit, pinned to `CUT_SHA` (the PR head), from their own
      terminal. Record its merge commit as `PROMO_SHA`, and check
      `origin/staging` equals it.
- [ ] Run `npm run check:deploy` until it passes for `PROMO_SHA` (Workers
      Builds takes a few minutes). Keep the PASS line for the tracker.
- [ ] Play lane (`android-play.yml`) run on the staging push: note its
      release name (`<version> (<code>) staging@<PROMO_SHA short>`) and status (a draft
      on internal). The DRI releases the draft in the Play Console if wanted.

## 5. Native builds, one commit

- [ ] The DRI dispatches, from `staging`:
      `gh workflow run android-apk.yml --repo unfoldingWord/tc-mobile --ref staging` and
      `gh workflow run ios-testflight.yml --repo unfoldingWord/tc-mobile --ref staging`
      (each needs the `release-signing` approval).
- [ ] Both runs' `headSha` equal `PROMO_SHA`, and so do the web and Play
      builds. If not, stop.

## 6. Check the APK

- [ ] `gh run download <apk run>`; the signer certificate SHA-256 equals the
      previous RC's (otherwise it won't install over it).
- [ ] `unzip -p app-release.apk assets/public/version.json` reads the version
      and `PROMO_SHA`.
- [ ] Record the APK's SHA-256. Get the TestFlight build number from the iOS
      run.

## 7. Publish

- [ ] Fill every placeholder in the announcement (staging sha, runs, cert,
      APK sha, TestFlight build, promotion #). No `<...>` left, apart from the
      template's own format examples.
- [ ] Make a QR PNG of
      `https://github.com/unfoldingWord/tc-mobile/releases/download/tester-build-v1.0.0-rc.N/app-release.apk`,
      and embed it in the notes.
- [ ] `gh release create tester-build-v1.0.0-rc.N --target <PROMO_SHA> --prerelease --notes-file <announcement> app-release.apk <qr>.png`.
- [ ] Download the published APK back and check its SHA-256 matches. Check
      the tag's target equals `PROMO_SHA`. Ask the DRI to scan the QR and to drag the image
      into the notes if it doesn't display.
- [ ] Post a publish record on the promotion PR.

## 8. TestFlight group

- [ ] The DRI assigns the processed build to the testers' group, unless
      automatic distribution is on. Unassigned testers stay on the old build,
      as happened on rc.1.

## 9. Record

- [ ] Tracker entry in `docs/progress_tracker.md`: channels, PASS lines, run
      ids, cert, hashes, red-team counts, not run.
- [ ] Move the freeze note (the text posted on new develop PRs) and the freeze watch to
      name the new RC. Update memory `tc-mobile-v1-release-freeze`.
- [ ] Tester reports go into issues by kind and source, roles only (public
      repo: no names, places or device-owner details).

## Final v1.0.0 additionally

Follow runbook §3 and §6: `staging → main` by merge commit, tag `v1.0.0` on
that merge commit, `check:deploy:prod`, native builds from `main` at the
tag, a GitHub Release on `v1.0.0` with the APK, QR and TestFlight build, the
installation guide updated, the milestone closed, and the freeze lifted
(tell the PR authors).
