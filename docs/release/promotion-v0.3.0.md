# Promotion plan: v0.3.0 training build

This is a release checklist, not authorization to promote, dispatch signing
jobs, publish artifacts, or accept a remaining defect. The DRI records those
choices on the promotion PR. Follow [AGENTS.md](../../AGENTS.md) for the
branch and review rules and [the native runbook](../native/README.md) for
signing and installation.

## 1. Dates and scope

The [delivery decision on issue 262](https://github.com/unfoldingWord/tc-mobile/issues/262#issuecomment-5765506100)
sets October 1 as the planned promotion and **October 4, 2026 as handoff to
facilitators**. The milestone's October 9 date is the training date, not the
handoff deadline. Leave time for TestFlight processing, installation and a
failed-build recovery.

`v1-required` means required for **v0.3.0**, not the literal `v1.0.0`
post-training milestone. `v1-desired` work is optional for training. A parked
PR does not waive a required outcome, and a merged PR does not establish
on-device acceptance.

Resolve the live issue list when preparing the promotion; do not copy a count
from an earlier tracker entry:

```sh
gh issue list --repo unfoldingWord/tc-mobile \
  --milestone 'v0.3.0 — Oct: training' --state open --limit 1000 \
  --json number,title,labels,assignees,url
```

Record each required item's disposition and supporting evidence on the
promotion PR. Any scope reduction needs an explicit owner decision on the
issue. Consult the [decisions register](https://github.com/unfoldingWord/tc-mobile/issues/243)
and [pivot plan](../design/pivot-plan.md) for settled requirements; do not
reopen old questions solely because an earlier release-plan snapshot listed
them as unanswered.

## 2. Acceptance work

These groups organize the training acceptance pass; they do not replace the
live `v1-required` query. Record device, OS, app version, build SHA, steps,
PASS/FAIL/NOT RUN, and evidence links for each result. Keep Android and iOS
results separate. A browser test or Node test is not a phone result.

| Ref | Acceptance                                                                                                                                                                                                                                                            | Tracking                                              |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| A1  | Compare the same take before Finished, after Finished, and in whole/selection playback. Capture channel levels and output route. Diagnose quiet/silent playback without assuming a shared cause.                                                                      | #553, #555, #269; canonicalisation investigation #562 |
| A2  | Check recovery of a playable take and microphone release after calls, short takes, and backgrounding immediately after Close recorder. Record each outcome separately from the accepted mid-take pagehide limitation below.                                           | #59, #245                                             |
| A3  | Selection starts at the agreed playhead position; one tap opens editing with the selection visible; the toggle stays in place. Obtain the requirements owner's end-of-buffer/zoom decision before changing viewport behavior.                                         | #554, #557, #567; PR #560                             |
| A4  | On the shipping APK/TestFlight candidate, check callout suppression including Rename, usable Chapter MP3 and Book ZIP sharing, correct system Back dismissal, and interrupted-context resume. Include a multi-minute iPhone Share for the encoder heartbeat boundary. | #556, #564, #336, #374, #108, #245, #405              |
| A5  | Install the candidate through the actual facilitator distribution route, verify its identity, and make Android re-download durable before handoff.                                                                                                                    | #262                                                  |

The [training scope decision on issue 58](https://github.com/unfoldingWord/tc-mobile/issues/58#issuecomment-5770432574)
accepts loss of an uncommitted take when `pagehide` cancels it. Recovery across
mid-take backgrounding is not a training acceptance requirement. Facilitators
must follow the [runbook's save-before-leaving guidance](../training/facilitator-runbook.md).
PR #471 and the #484 device-log investigation are post-training work; neither
is a prerequisite for this promotion. This exception does not waive the
separate interruption and close/save checks in A2.

Capture the separate clicking/static report (#558) during A1. Its priority and
cause must be determined from evidence; neither a chunk-join explanation nor
a stereo/downmix explanation is an established diagnosis of the field reports.
The subarray regression test (PR #565) does not repair quiet playback.

Include the recorded distribution obligations in the release review: #36 / PR
#144 covers the web notice; #477 tracks native-shell attribution separately.
Do not treat the former as completing the latter, or silently change either
issue's priority in this checklist.

## 3. Promotion and origin verification

1. Prepare the candidate through `develop`. Routine `develop → staging`
   releases bump the patch; the `staging → main` milestone promotion owns
   the `0.3.0` minor bump, per AGENTS.md. Keep `package.json` and its lockfile
   consistent. List carried PRs and acceptance evidence in the promotion bodies.
2. Promote `develop → staging` by PR. Complete the applicable checks and
   reviews, then confirm the deployed staging version and promoted SHA:

   ```sh
   npm run check:deploy
   ```

3. Prepare the `staging → main` promotion with the `0.3.0` minor bump. Before
   execution, the DRI records the release branch/ref carrying that bump and
   how the version change will return to `develop`/`staging` through PRs; this
   plan does not authorize direct commits to protected branches. Validate the
   final candidate and merge the production promotion with a merge commit
   to preserve the promotion history. This is the production gate. Record any explicitly
   accepted residuals before merging; an unresolved required issue is not
   waived merely by moving its milestone.
4. Fetch `main` and tag the production merge commit `v0.3.0`; push that tag.
   If the tag already exists, inspect it and stop on a different target;
   never overwrite a published release tag.
5. Confirm the production origin with the production-specific command:

   ```sh
   npm run check:deploy:prod
   ```

The production origin is
<https://tc-mobile.unfoldingword.workers.dev>; staging is
<https://tc-mobile-staging.unfoldingword.workers.dev>. The commands are defined
in [package.json](../../package.json). The production command explicitly
supplies its origin so it cannot silently check staging.

[The deploy checker](../../scripts/check-deploy.mjs) fetches the canonical
remote branch before resolving the expected SHA/version for these known
origins, and compares origin `version.json`. An explicit SHA/version pair
bypasses that resolution; use the promoted branch's identity, not a local
feature tip. Workers Builds owns PWA deployment. A green promotion merge is
not evidence that the Worker deployed (#143).

## 4. Native candidate and durable delivery

Read the workflow files **on the dispatched ref** and follow their
`release-signing` environment approval. Dispatch the manual
[iOS](../../.github/workflows/ios-testflight.yml) and
[Android](../../.github/workflows/android-apk.yml) lanes from the `main` branch
at the tagged release commit. Record each run's resolved SHA and require it
to equal `v0.3.0` before accepting its artifact. If `main` moved, stop and
select an explicitly approved ref strategy; do not label a different build
as the tagged release.

The normal tester path accepts `staging`/`main`, not an arbitrary tag. In
particular, Android's guard requires a branch unless `allow_any_ref` is
explicitly enabled. Do not dispatch a tag under the assumption it is accepted
by the normal branch guard.

Android `versionName` comes from `package.json`; iOS `MARKETING_VERSION` is
separate. Check both and their build numbers against the release's intended
identity using [the versioning runbook](../native/README.md). A successful
upload does not mean TestFlight processing has completed or the facilitator
can install it. Confirm tester access and installation.

The Android lane uploads an Actions artifact with 14-day retention; it does
not publish a GitHub Release automatically. The [issue 262 delivery record](https://github.com/unfoldingWord/tc-mobile/issues/262#issuecomment-5765506100)
names a test APK that expires October 5, immediately after handoff. Do not
reuse that test artifact as the training release.

The [DRI's delivery decision](https://github.com/unfoldingWord/tc-mobile/issues/262#issuecomment-5770487585)
requires a GitHub Release on `v0.3.0`, with the fresh signed APK from the tagged
commit attached and the TestFlight build number noted. Record the APK's
SHA-256 and workflow-run URL, verify the download matches, and test
the actual facilitator download/install route. Update
[tester installation instructions](../tester-install.md) with the Release's
durable download link. An expiring Actions link alone does not satisfy handoff.

## 5. Rollback readiness

Before promotion, record the previous production deployment/version and Git
SHA, plus the available Cloudflare rollback target. Follow AGENTS.md's
**Confirming a deploy and rolling one back** procedure: dashboard rollback or
`npx wrangler rollback` targets production; `--env staging` targets staging.
After rollback, verify the origin against the explicitly chosen rollback
SHA/version using the deploy checker's explicit arguments. Its normal default
still expects the branch tip until the corrective PR lands.

A Worker rollback does not move Git branches. Follow it with a revert PR
against the affected branch, and reconcile subsequent promotions so they do
not redeploy the regression. Opening a PR from an old ancestor alone does not
revert newer commits. Installed PWAs may retain their current service worker;
verify a device separately. Native rollback/replacement also needs its own
artifact and distribution decision; a Worker rollback does not replace an
installed APK or TestFlight bundle.

## 6. Promotion PR checklist

- [ ] Live required issues reconciled; owner-approved residuals linked.
- [ ] A1–A4 results recorded on the candidate builds for both phone platforms.
- [ ] Distribution obligations reviewed, with web/native scope kept explicit.
- [ ] Patch release and `develop → staging` promotion reviewed and green.
- [ ] Production minor-bump branch/ref strategy recorded; `0.3.0` candidate
      checked and version reconciliation back to development branches planned.
- [ ] `check:deploy` confirms the staging version and promoted SHA.
- [ ] Production promotion reviewed and green; previous deployment recorded.
- [ ] `staging → main` merged; `v0.3.0` points to that merge commit.
- [ ] `check:deploy:prod` confirms the production version and promoted SHA.
- [ ] Native run SHAs match the release tag; versions/build numbers recorded.
- [ ] TestFlight build processed, assigned and installable by facilitators.
- [ ] GitHub Release on `v0.3.0` has the fresh signed APK attached and the
      TestFlight build number noted; downloaded bytes and installation checked;
      installation guide updated.
- [ ] Handoff complete by October 4, including candidate acceptance evidence.
- [ ] Remaining milestone issues explicitly reconciled under AGENTS.md;
      close `v0.3.0` with its promotion, leaving delivery evidence on #262 and
      the promotion PR until handoff is complete.

Execution results belong in the promotion PR and linked issues, where their
build identities and dates can be updated. Do not tick this template to imply
that a future release has already passed.
