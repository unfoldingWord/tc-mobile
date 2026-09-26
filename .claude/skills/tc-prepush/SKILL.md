---
name: tc-prepush
description: Checklist to run before pushing or opening a PR in tc-mobile. Runs `npm run check:prepush`, then walks the judgment checks and PR-body pre-emptions drawn from the review bench's recurring findings. Use before pushing or opening a PR in tc-mobile.
---

# tc-prepush

This is a checklist, not a self-review. uwreview is the review. Do not post
the results of this checklist as a review, and do not call a PR "clean"
because of it.

## 1. Run the script

```bash
npm run check:prepush
```

- A `FAIL` blocks the push. Fix it; never bypass with `--no-verify`.
- Read every `WARN` line and decide on each: fix it, or be able to say why it
  is right. A warning is a prompt, not a verdict.
- A `SKIP` means no range was checked. Run `git fetch origin develop` and
  rerun.
- Rule (b) reads installed `node_modules`. After a dependency change, run
  `npm ci` first.

## 2. Judgment checks the script cannot make

Go through each one for the change you are pushing.

- **Async re-read overwrite.** For each async read that writes state: what
  happens if the result is stale, unknown or a no-op? It must not overwrite a
  known or already-landed value.
- **Live control during an await.** Before any `await` in a handler, what does
  a second tap, a second pointer or a tap on another control do? Set the busy
  or disabled state synchronously, before the `await`.
- **Regex or indexOf guard.** Give it one case with the pattern inside a
  comment or string, and one case outside the intended scope. Both must stay
  quiet.
- **Visual property actually pinned.** If a test name claims a visual property
  (a circle, a colour), an assertion must pin that property.
- **Bundler helper disclosure.** After a bundler or build-tool upgrade, compare
  the helpers injected into `dist/` with the licence disclosure table.
- **UX ambiguity.** If the behaviour is a product call, record the DRI's call
  in the PR body before opening. Do not let a reviewer discover it as a bug.
- **No false verification claims.** No docblock, comment, test name or PR body
  says something was tested, verified or checked on a device unless it was.

## 3. PR-body pre-emptions

Add these where they apply, so a reviewer does not have to guess.

- **Base rules outside the diff.** "Relies on the base rule at `<file:line>`
  (unchanged)."
- **Races.** A "why this is safe" note listing every writer of the contested
  state, with file:line. Say the list is exhaustive only if you searched.
- **React reconciliation.** Where the same component type stays in the same
  slot and updates in place, say so and name the element.
- **Not verified on device.** A section naming what no browser or device ran,
  including the questions a reviewer is likely to raise (WebView kill, screen
  reader double announce).
- **Closing keywords.** `Closes #N` only when the PR delivers the whole issue;
  otherwise `Part of #N`, then confirm
  `gh pr view <n> --repo unfoldingWord/tc-mobile --json closingIssuesReferences`
  is `[]`.
