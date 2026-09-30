---
name: tc-release
description: Step-by-step checklist for cutting a tC Mobile tester release (a 1.0.0-rc.N candidate) or the final v1.0.0 promotion. It covers scope picks, the version bump, the release red team, the pinned release branch, the promotion PR, the DRI go/no-go, check:deploy, all channels from one commit, APK checks, the tester-build pre-release with QR, TestFlight group assignment and records. It marks each step human-only (the DRI) or agent-allowed. Use whenever cutting, promoting or publishing a tc-mobile release.
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
      issue, clean from both uwreview lenses. The DRI merges it, pinned with
      `--match-head-commit <reviewed sha>`.

**Who runs a step.** Each step below is tagged.

- **Human-only (the DRI):** the agent does not run it, not even after an
  explicit ask in chat. The agent prepares what the DRI needs (the PR number,
  the head to pin, the exact command) and waits for the DRI to say it is done.
  Then it checks the result with a read-only command.
- **Agent-allowed:** the agent may run it. It never touches a merge, a
  workflow dispatch or a tag. It publishes the tester pre-release only under
  the conditions in step 7.

Human-only across every release: merging any PR (the bump, the promotion,
`staging → main`, the picked fixes), dispatching any workflow (via `!`), the
go/no-go decision, publishing the `v1.0.0` GitHub Release, pushing the
`v1.0.0` tag, releasing anything in the Play Console, and assigning the
TestFlight build. An agent never passes `--admin`. Agent-allowed: preparing PR
and release-note bodies, the red team, and read-only checks (`check:deploy`,
the signer and hash checks, the download-back).

**Two commits name every step below.** Write both down when they exist and
use no other. Put each in the promotion PR's hold line as it is known, and
re-read it there at every step instead of taking it from memory:

- **`CUT_SHA`**: the squash commit of the bump PR on `develop`. The bump
  merges **last**, after every picked fix, so `CUT_SHA` is the exact tree
  being promoted. If anything merges to `develop` after it, stop and cut a
  new bump. Each new bump makes a new `CUT_SHA`, and the old one is retired:
  a red-team report names the `CUT_SHA` it read, and it does not vouch for a
  later one beyond a delta pass.
- **`PROMO_SHA`**: the promotion PR's merge commit on `staging`. Every
  channel (web, Play, APK, TestFlight) must be built from it.

Before each step that names one of them, check it. If it does not match, stop:
the steps of one release must not mix refs.

## 1. Bump

- [ ] Agent-allowed: every picked fix is merged (the DRI's merges). Branch from
      the `origin/develop` tip, then run
      `npm version 1.0.0-rc.N --no-git-tag-version` (or `1.0.0` for the final).
      Only `package.json` and `package-lock.json` change.
- [ ] Agent-allowed: body with every PR carried, what a tester will see, not
      in this build, not run, and the DRI's cut pick (verbatim).
- [ ] Agent-allowed: storage check.
      `git diff <last RC's CUT_SHA> HEAD -- src/lib/storage` is empty, or
      the migration is named. State `DB_VERSION`.
- [ ] Agent-allowed: `closingIssuesReferences` is `[]` (and grep the title too).
- [ ] Human-only: the DRI merges it by squash after review, from their own
      terminal, pinned to the PR head. Its squash commit is `CUT_SHA`. Check
      that `origin/develop` equals `CUT_SHA`.

## 2. Release red team (every cut; the DRI requires it)

This runs on `CUT_SHA` **before** the release ref exists, so a fix it demands
never has to move a ref.

Agent-allowed: run read-only agents and write their reports to the job tmp.
Each report states the `CUT_SHA` it read.

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
- [ ] Human-only: take each FIX-BEFORE-PUBLISH item to the DRI in a picker: fix
      it in this RC, or accept it. Record each pick verbatim on the relevant
      PR.
- [ ] If a fix goes into this RC: the DRI merges it, then go back to step 1 for
      a new bump and a new `CUT_SHA`, and run a delta pass over what changed
      before going on. Do not create the release ref until the red team has
      finished on the `CUT_SHA` you will promote.
- [ ] File one batched follow-up issue (next milestone) for deferred review
      items.

## 3. Pin the release ref and open the promotion PR

- [ ] Agent-allowed: if `release/v1.0.0-rc.N` already exists
      (`gh api repos/unfoldingWord/tc-mobile/git/ref/heads/release/v1.0.0-rc.N`),
      stop. Use the next N. Never move, delete, recreate or reuse it.
- [ ] Agent-allowed: create it at the final `CUT_SHA`:
      `gh api repos/unfoldingWord/tc-mobile/git/refs -f ref=refs/heads/release/v1.0.0-rc.N -f sha=<CUT_SHA>`.
- [ ] Agent-allowed: open the PR `release/v1.0.0-rc.N → staging` with a
      **hold** line at the top ("no merge until the red team is posted and
      the DRI gives a go/no-go"), naming `CUT_SHA`. The PR head equals
      `CUT_SHA`. `closingIssuesReferences` is `[]`.
- [ ] Agent-allowed: post the red-team summary on the promotion PR.
- [ ] Human-only: the DRI gives go/no-go. Record it verbatim.

## 4. Merge and deploy

- [ ] Human-only: after a recorded go, the DRI merges the promotion from their
      own terminal with this pinned command, and no other:
      `gh pr merge <N> --repo unfoldingWord/tc-mobile --merge --match-head-commit <CUT_SHA>`.
      The agent hands over the PR number and `CUT_SHA`, and never adds
      `--admin`. Record the merge commit as `PROMO_SHA`, and check
      `origin/staging` equals it.
- [ ] Agent-allowed: run `npm run check:deploy` until it passes for
      `PROMO_SHA` (Workers Builds takes a few minutes). Keep the PASS line for
      the tracker.
- [ ] Agent-allowed: Play lane (`android-play.yml`) runs on the staging push.
      Note its release name (`<version> (<code>) staging@<PROMO_SHA short>`) and
      status (a draft on internal). Human-only: the DRI releases the draft in
      the Play Console if wanted.

## 5. Native builds, one commit

- [ ] Human-only: the DRI dispatches, from `staging`, via `!`:
      `gh workflow run android-apk.yml --repo unfoldingWord/tc-mobile --ref staging` and
      `gh workflow run ios-testflight.yml --repo unfoldingWord/tc-mobile --ref staging`
      (each needs the `release-signing` approval).
- [ ] Agent-allowed: both runs' `headSha` equal `PROMO_SHA`, and so do the web
      and Play builds. If not, stop and re-promote. Do not mix refs.

## 6. Check the APK

All agent-allowed and read-only.

- [ ] `gh run download <apk run>`. The signer certificate SHA-256 equals the
      previous RC's. If not, stop and tell the DRI. Do not publish. Uninstall is not the remedy: uninstalling deletes recordings.
- [ ] `unzip -p app-release.apk assets/public/version.json` shows version
      `1.0.0-rc.N` and commit `PROMO_SHA`. If not, stop. Do not publish.
- [ ] Record the APK's SHA-256. Get the TestFlight build number from the iOS
      run.

## 7. Publish

- [ ] Agent-allowed: fill every placeholder in the announcement (staging sha,
      runs, cert, APK sha, TestFlight build, promotion #). No `<...>` left,
      apart from the template's own format examples.
- [ ] Agent-allowed: make a QR PNG of
      `https://github.com/unfoldingWord/tc-mobile/releases/download/tester-build-v1.0.0-rc.N/app-release.apk`,
      and embed it in the notes.
- [ ] Agent-allowed, on two conditions: (a) every fail-closed check before
      it has passed (the native runs' `headSha` equals `PROMO_SHA`, the APK
      signer, the embedded `version.json`, the recorded APK hash), and (b) the
      DRI has explicitly asked for the publish in this session. If either is
      missing, do not run it: hand the DRI the exact command and the files to
      run themselves. The command:
      `gh release create tester-build-v1.0.0-rc.N --target <PROMO_SHA> --prerelease --notes-file <announcement> app-release.apk <qr>.png`.
- [ ] Agent-allowed: download the published APK back. Its SHA-256 equals the
      one recorded, and the tag target equals `PROMO_SHA`. If not, stop. Do not send the link. Tell the DRI to take the pre-release
      down, which the DRI does. Ask the DRI to scan the QR and to drag the image
      into the notes if it doesn't display.
- [ ] Agent-allowed: post a publish record on the promotion PR.

## 8. TestFlight group

- [ ] Human-only: the DRI assigns the processed build to the testers' group,
      unless automatic distribution is on. Unassigned testers stay on the old
      build, as happened on rc.1.

## 9. Record

- [ ] Agent-allowed: tracker entry in `docs/progress_tracker.md`: channels,
      PASS lines, run ids, cert, hashes, red-team counts, not run.
- [ ] Agent-allowed: move the freeze note (the text posted on new develop PRs)
      and the freeze watch to name the new RC. Update memory
      `tc-mobile-v1-release-freeze`.
- [ ] Agent-allowed: tester reports go into issues by kind and source, roles
      only (public repo: no names, places or device-owner details).

## Final v1.0.0 additionally

Follow runbook §3 and §6. Human-only: the `staging → main` merge (a merge
commit, from the DRI's terminal, never `--admin`), the tag `v1.0.0` on that
merge commit, the native dispatches from `main` at the tag, and publishing the
GitHub Release on `v1.0.0` with the APK, QR and TestFlight build. Agent-allowed:
`check:deploy:prod`, the APK checks, the download-back, the installation guide
update, closing the milestone and telling the PR authors the freeze is lifted
(after the DRI lifts it).
