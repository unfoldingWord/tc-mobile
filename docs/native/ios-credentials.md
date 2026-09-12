# iOS credentials — the setup session, and every question it will ask

**Issue:** [#262](https://github.com/unfoldingWord/tc-mobile/issues/262).
**Companion to** [`README.md` §4a](README.md#4a-ios--testflight-via-ci-automated-no-mac-step),
which describes _what the pipeline does_. This file is the other half: the
**human account work** §4a cannot do for you, written as a sit-down checklist
with the answers pre-filled.

> **Manual signing needs seven secrets, not four.** The lane was rewritten from
> API-key automatic signing to a manual **Distribution certificate + App Store
> profile** (PR #309): on top of the four App Store Connect / Team values it now
> needs `IOS_DIST_CERT_P12_BASE64`, `IOS_DIST_CERT_PASSWORD` and
> `IOS_PROVISION_PROFILE_BASE64` (§5.5, §8). The chain has since archived, signed
> and uploaded a build to TestFlight — but `gh secret list` shows **names only**
> and cannot confirm a value is still correct. (That check covers **repository**
> secrets only; listing org-level secrets returns HTTP 403 without the
> `admin:org` scope.) Apple's web UI also changes wording between releases: where
> this file names a menu item, treat it as a strong hint, not a guarantee.

---

## 0. What you need in hand before you start

| Thing                                                 | Why                                                   | Have it?                    |
| ----------------------------------------------------- | ----------------------------------------------------- | --------------------------- |
| An Apple ID with 2FA                                  | Every portal below requires it                        |                             |
| The unfoldingWord Apple **Team**, enrolled and active | No signed iOS install exists without it               | **unverified — see §1**     |
| Your **role** on that team                            | Decides whether you can mint the API key at all (§6)  |                             |
| A password manager entry to hold the values           | The `.p8` downloads **once** and cannot be re-fetched | 1Password is on this Mac    |
| Admin on `unfoldingWord/tc-mobile`                    | To set repository secrets                             | yes (`gh` is authenticated) |

**Do not record any of the values below in this repo.** The Key ID, Issuer ID
and Team ID are not catastrophic on their own, but the `.p8` API key and the
Distribution `.p12` (§5.5) are signing credentials. Keep every value in
1Password (uw-devops) and paste it into GitHub secrets from there.

---

## 1. Three questions to answer first — they change everything downstream

### Q1. Does unfoldingWord already have an Apple Developer Program organization account?

**This is unresolved in our own docs and is the first thing to check.**
[`README.md` §3](README.md#3-one-time-mac-prerequisites) says enrollment is
"already done — see the research doc", but `docs/research/native-packaging.md`
contains **no mention of Apple enrollment**, and
[§0.1](README.md#01-humanpaid-gates) still lists the membership as an open
human/paid gate with "a day+" of lead time. One of those is stale. Confirm at
<https://developer.apple.com/account> before anything else.

- **If it exists and you are on it** → skip to §3.
- **If it exists and you are not on it** → you need an invite from the Account
  Holder. That is a person-dependency, not a task; start it today.
- **If it does not exist** → §2 is an enrollment, not a login, and it can take
  **more than a day**. It is the critical path to every other step on this page.

### Q2. What is your role on the team?

Roles that matter here:

| Role           | Can create the app record | Can mint a **Team** API key |
| -------------- | ------------------------- | --------------------------- |
| Account Holder | yes                       | **yes**                     |
| Admin          | yes                       | possibly — verify           |
| App Manager    | yes                       | no                          |
| Developer      | no                        | no                          |

**The likely trap:** App Store Connect has historically restricted **Team Key**
generation to the **Account Holder**. If you are an Admin or App Manager, you
may be able to do every step on this page _except_ §6 — and §6 is the one the
pipeline cannot work without. **Check this before you plan the rest of the
day**, because it turns the task from "an hour of forms" into "wait for whoever
holds the account".

### Q3. Internal or external testers for the Nairobi training?

This is a **product decision, not a setup step**, but it changes what you build
here — and the current pipeline has already picked one.

|                              | Internal                                                                              | External                                        |
| ---------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Tester cap                   | 100                                                                                   | 10 000                                          |
| How someone joins            | must be added as an **App Store Connect user** (an Apple ID each, invited one by one) | a **public link**, no account on your team      |
| Gate before they can install | none                                                                                  | one-time **Beta App Review** (typically ~a day) |
| What the Fastfile does today | ✅ `distribute_external: false`                                                       | ❌ not wired                                    |

`fastlane/Fastfile` sets `distribute_external: false`, so **today's pipeline is
internal-only**. For a handful of named testers (§7 lists Caleb, Javi, Tim) that
is right. For a room of facilitators in Nairobi each installing on their own
phone, adding every one as an App Store Connect user is painful, and the
external public link is the normal answer — but it needs Beta App Review, which
is a lead time you do not want to discover in October.

**Flagging it, not deciding it.** If the training needs the public link, that is
a change to the Fastfile and a review round, and it should be filed now rather
than in the last week of September.

---

## 2. Step A — Apple Developer Program (only if Q1 said "not enrolled")

Skip entirely if the team already exists.

Enrolling as an **organization** (not an individual) asks for materially more
than a personal signup:

| Question                       | Answer for unfoldingWord                  | Notes                                                                       |
| ------------------------------ | ----------------------------------------- | --------------------------------------------------------------------------- |
| Entity type                    | Organization                              | An individual enrollment puts the apps under a person, not the org          |
| Legal entity name              | the exact registered name                 | Must match the D-U-N-S record character-for-character                       |
| **D-U-N-S number**             | unfoldingWord's                           | If the org has none, Apple's lookup can issue one; **this alone adds days** |
| Website                        | a domain the org controls                 | Apple verifies it                                                           |
| Your authority to bind the org | you assert it; Apple may phone to confirm | The callback is a common source of delay                                    |
| Payment                        | the annual membership fee                 |                                                                             |

**If this step is live, stop planning around a near-term iOS build.** Everything
below is blocked, and the Android debug-APK route
([README §0](README.md#0-minimal-monday-path)) is the only path to a phone that
week.

---

## 3. Step B — capture the Team ID

<https://developer.apple.com/account> → **Membership details**.

| Field       | What to record                                        |
| ----------- | ----------------------------------------------------- |
| **Team ID** | a 10-character alphanumeric string, e.g. `A1B2C3D4E5` |

That string becomes the `APPLE_TEAM_ID` secret (§8). It is **not** secret in the
cryptographic sense, but store it with the others so they all stay together.

---

## 4. Step C — register the Bundle ID

<https://developer.apple.com/account/resources/identifiers> → **+**

| Question        | Answer                               | Why this answer                                                                                                                                                                                                                                                                                                                                                   |
| --------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Type            | **App IDs** → **App**                |                                                                                                                                                                                                                                                                                                                                                                   |
| Description     | `tC Mobile`                          | Free text, internal only                                                                                                                                                                                                                                                                                                                                          |
| Bundle ID style | **Explicit**                         | Wildcards cannot be used for App Store / TestFlight uploads                                                                                                                                                                                                                                                                                                       |
| Bundle ID       | **`org.unfoldingword.tcmobile`**     | Must match exactly — it is set in `capacitor.config.ts`, `fastlane/Appfile`, and `PRODUCT_BUNDLE_IDENTIFIER` in `ios/App/App.xcodeproj/project.pbxproj`. A mismatch fails the upload, not the build.                                                                                                                                                              |
| Capabilities    | **none — leave every box unchecked** | The app records audio through the WebView's `getUserMedia`. Microphone access comes from the `NSMicrophoneUsageDescription` string already in `Info.plist`, **not** from an App ID capability. Push, HealthKit, App Groups, iCloud are all unused. Enabling one you do not use adds an entitlement the profile must carry — a way to fail signing for no benefit. |

**This must exist before §5**, because App Store Connect's New App form offers a
dropdown of _registered_ identifiers only — if you skip this step,
`org.unfoldingword.tcmobile` simply will not be in the list, and the form does
not tell you why.

> **`org.`, not `com.` — and this is a real near-miss, caught in the form on
> 2026-09-12.** Reverse-DNS convention follows the domain the org controls, and
> unfoldingWord's is `unfoldingword.org`. Registering `com.unfoldingword.tcmobile`
> instead would have compiled and archived perfectly and then failed at upload,
> because the identifier is baked into **nine** places across both platforms:
>
> | File                                              | What                                          |
> | ------------------------------------------------- | --------------------------------------------- |
> | `capacitor.config.ts`                             | `appId`                                       |
> | `fastlane/Appfile`                                | `app_identifier` default                      |
> | `ios/App/App.xcodeproj/project.pbxproj`           | `PRODUCT_BUNDLE_IDENTIFIER` (**two** configs) |
> | `android/app/build.gradle`                        | `namespace` **and** `applicationId`           |
> | `android/app/src/main/res/values/strings.xml`     | `package_name`, `custom_url_scheme`           |
> | `android/app/src/main/java/org/unfoldingword/...` | the Java package **and its directory path**   |
>
> The Android Java package is the expensive one: changing it moves source
> directories, not just a string. **Register the identifier to match the repo**
> — the repo is not the thing to bend here.

---

## 5. Step D — create the App Store Connect app record

<https://appstoreconnect.apple.com> → **Apps** → **+** → **New App**

`upload_to_testflight` uploads **to an existing app record**; it does not create
one. Without this step the archive succeeds and the upload fails.

| Question         | Answer                           | Why / watch out                                                                               |
| ---------------- | -------------------------------- | --------------------------------------------------------------------------------------------- |
| Platforms        | **iOS** only                     | No macOS/tvOS/visionOS build exists                                                           |
| **Name**         | **`translationCore Mobile`**     | **Decided by Tim, 2026-09-12**, confirmed with the team. See the naming note below            |
| Primary Language | **English (U.S.)**               | The UI is English today; this is metadata, not a product constraint                           |
| Bundle ID        | **`org.unfoldingword.tcmobile`** | Picked from the dropdown §4 populated                                                         |
| **SKU**          | `tc-mobile`                      | Your own internal identifier. Never shown to users, but effectively permanent                 |
| User Access      | **Full Access**                  | "Limited Access" restricts which team members see the app — no reason to for an internal test |

**The naming question — settled.** The repo carries two names:
`capacitor.config.ts` `appName` and `Info.plist` `CFBundleDisplayName` are
**`tC Mobile`** (the home-screen label); the PWA manifest `name` is
**`translationCore Mobile`**. App Store Connect's **Name** is a third, separate
thing and must be unique across the whole store.

**Tim chose `translationCore Mobile` on 2026-09-12**, confirmed with the rest of
the team. That is the App Store Connect record name. It is also the longer and
more distinctive of the two, so it is the less likely of them to collide with an
existing app.

**This does not change anything in the repo.** The App Store Connect name does
not have to match the home-screen label, and the home-screen label stays
`tC Mobile` — a store name and a springboard label are independent fields.
Do not "align" `capacitor.config.ts` or `Info.plist` to the store name; the
short label is the right thing on a phone home screen.

If App Store Connect still rejects it with "The App Name you entered is already
being used", that is a question for Tim, not a decision to make in the form —
the name was agreed with the team.

**What you will _not_ be asked, and should not go looking for.** TestFlight
**internal** testing needs no screenshots, no description, no privacy-policy
URL, no age rating, no pricing, and no App Review. If a form is demanding those,
you have wandered into App Store submission — explicitly out of scope for #262.
Back out.

---

## 5.5. Step D2 — the Distribution certificate and App Store profile

Manual signing (the Fastfile does **not** use `-allowProvisioningUpdates`) needs
two files you create by hand and hand to CI as secrets: an **Apple
Distribution** certificate exported as a `.p12` **with its private key**, and an
**App Store** provisioning profile bound to `org.unfoldingword.tcmobile` and that
certificate. The same identity is reused on every run — that stability is the
reason for manual over automatic signing (see the `fastlane/Fastfile` header).

> **Verify these steps against what you actually did.** They describe the
> standard Apple-portal flow, but Apple's wording shifts between releases and the
> certificate can equally be minted from Xcode (_Settings → Accounts → Manage
> Certificates → + → Apple Distribution_). What CI needs is fixed regardless of
> route: a `.p12` **with the private key**, its export password, and a matching
> **App Store** profile.

### The Distribution certificate → `.p12`

1. <https://developer.apple.com/account/resources/certificates> → **+** → **Apple
   Distribution** (not _Apple Development_). It asks for a CSR: Keychain Access →
   _Certificate Assistant → Request a Certificate From a Certificate Authority_,
   "Saved to disk". Upload the CSR, download the resulting `.cer`, and
   double-click it to install it into your **login** keychain.
2. In **Keychain Access**, find the certificate, expand it so the **private key**
   shows nested beneath it, select **both** rows, right-click → **Export 2
   items** → **Personal Information Exchange (.p12)**. The export password you
   set becomes `IOS_DIST_CERT_PASSWORD`. A `.p12` exported **without** the
   private key cannot sign, and the failure is a late archive/export error, not
   an obvious one.

### The App Store provisioning profile

3. <https://developer.apple.com/account/resources/profiles> → **+** →
   **Distribution → App Store Connect**. App ID: **`org.unfoldingword.tcmobile`**
   (registered in §4). Certificate: the **Distribution** certificate from step 1.
   Name it (e.g. `tc-mobile App Store`) and **Download** the `.mobileprovision`.

### Then base64-encode both for the secrets (§8)

File the `.p12` and its password in 1Password (uw-devops) **before** anything
else — a `.p12` cannot be re-exported once the private key leaves the keychain.
Then base64 both files into the GitHub secrets in §8.

---

## 6. Step E — mint the App Store Connect API key

**App Store Connect** → **Users and Access** → **Integrations** → **App Store
Connect API** → **Team Keys** → **+**

| Question          | Answer                             | Why                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Name              | `tc-mobile CI (TestFlight)`        | Free text; name it so a future reader knows what revoking it breaks                                                                                                                                                                                                                                                                                                                  |
| **Access / role** | **App Manager** (Admin also works) | Required for the **upload** step. The key authenticates `upload_to_testflight`; it does **not** sign — signing is manual, from the Distribution `.p12` and the App Store profile ([§5.5](#55-step-d2--the-distribution-certificate-and-app-store-profile)). A `Developer`-role key cannot submit a build to TestFlight, and the failure surfaces at the upload step, not at signing. |

Then **Download** the key. Three things about that download:

1. **It is one-time.** Apple will not let you download the `.p8` again. If you
   lose it, the only remedy is to revoke the key and mint a new one — redoing
   this step and the `ASC_KEY_P8_BASE64` secret.
2. It lands as **`AuthKey_XXXXXXXXXX.p8`**, where the X's are the **Key ID**.
3. Record the **Key ID** and the **Issuer ID** now. The Issuer ID is a UUID
   shown **once at the top of the Keys page**, shared by every key on the team —
   easy to close the page and then not know where to find it again.

**Put the `.p8` in 1Password immediately**, before doing anything else with it.
It is gitignored at `fastlane/AuthKey.p8` and the workflow deletes it after each
run, but the copy in `~/Downloads` is the only one that exists until you file it.

---

## 7. Step F — the internal tester group

**App Store Connect** → your app → **TestFlight** → **Internal Testing** → **+**

| Question                                | Answer                                                          | Why                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Group name                              | `Internal` (or `Field testers`)                                 | Free text                                                                                                                                                                                                                                                                                                                                   |
| **Automatically distribute new builds** | **enable it**                                                   | ⚠️ **The quiet failure.** The pipeline assigns **no** tester group — `upload_to_testflight` uploads and stops. With this off, every build lands in App Store Connect and reaches **nobody** until you assign it by hand, and the workflow is still green. This one checkbox is the difference between "CI works" and "testers got the app". |
| Testers                                 | Caleb, Javi, Tim (per [README §4](README.md#4-ios--testflight)) |                                                                                                                                                                                                                                                                                                                                             |

**Each internal tester must first exist as an App Store Connect user** (Users
and Access → **+**, invite by Apple ID email). They then receive an invitation
and install through the **TestFlight** app. Someone never invited as a user
cannot be added to an internal group — the mechanical reason Q3 matters.

---

## 8. Step G — set the seven GitHub secrets

_Settings → Secrets and variables → Actions_, or from a checkout:

```bash
gh secret set ASC_KEY_ID             -R unfoldingWord/tc-mobile   # the 10-char Key ID
gh secret set ASC_ISSUER_ID          -R unfoldingWord/tc-mobile   # the Issuer UUID
gh secret set APPLE_TEAM_ID          -R unfoldingWord/tc-mobile   # the 10-char Team ID
gh secret set IOS_DIST_CERT_PASSWORD -R unfoldingWord/tc-mobile   # the .p12 export password (§5.5)
base64 -i ~/Downloads/AuthKey_XXXXXXXXXX.p8   | gh secret set ASC_KEY_P8_BASE64 -R unfoldingWord/tc-mobile
base64 -i ~/path/to/dist_cert.p12             | gh secret set IOS_DIST_CERT_P12_BASE64 -R unfoldingWord/tc-mobile
base64 -i ~/path/to/tc-mobile.mobileprovision | gh secret set IOS_PROVISION_PROFILE_BASE64 -R unfoldingWord/tc-mobile
```

The stdin-prompt forms (no value on the command line) keep the value out of
shell history. The names must match **exactly** — the preflight job checks these
seven literal strings and treats an unset secret and an empty one the same way.

Verify before dispatching:

```bash
gh secret list -R unfoldingWord/tc-mobile
```

You are looking for all seven alongside the pre-existing `CLOUDFLARE_ACCOUNT_ID`.
`gh secret list` shows **names only** — it cannot tell you a value is correct,
only that something is set. The first dispatch is the first test of the values.

---

## 9. Step H — the first dispatch, and the ref trap

**Read this before clicking Run workflow.** The lane's preflight refuses any ref
except `staging` or `main` unless you tick **`allow_any_ref`** — but as of
2026-09-12 the pipeline exists **only on `develop`**:

| Ref       | `ios-testflight.yml` | `Gemfile.lock` | `fastlane/Fastfile` | shared `App.xcscheme` |
| --------- | -------------------- | -------------- | ------------------- | --------------------- |
| `develop` | ✅                   | ✅             | ✅                  | ✅                    |
| `staging` | ❌                   | ❌             | ❌                  | ❌                    |
| `main`    | ❌                   | ❌             | ❌                  | ❌                    |

`staging` is still v0.1.13 (2026-09-09); the pipeline merged to `develop` on
2026-09-11. So the two workable first dispatches are:

- **`develop` with `allow_any_ref` ticked** — available now, and the honest
  choice for a first smoke test of signing; or
- **promote v0.1.14 to `staging` first**, then dispatch from `staging` — what
  [README §7](README.md#7-coexistence-with-the-cloudflare-pwa-deploy) means by
  "build tester IPAs from `staging` or `main`". A promotion is owed anyway.

Do not spend a dispatch discovering that `staging` has no workflow file to run.

---

## 10. What a green run means — and what it does not

A green run means **the binary uploaded**. It does not mean a tester has it, and
it cannot mean that, by design:

- The lane sets `skip_waiting_for_build_processing: true` so it does not hold a
  billed macOS runner open for Apple's server-side processing. **It therefore
  cannot observe a processing rejection**, which arrives later by email.
- It assigns no tester group, so distribution depends entirely on §7's checkbox.
- Export compliance is already answered — `ITSAppUsesNonExemptEncryption` is
  `false` in `Info.plist` (the app uses only standard HTTPS), so no per-build
  _Missing Compliance_ prompt should appear. If one does, that key did not make
  it into the archive.

The build number is the run's **unix timestamp**, so builds always increase and
never collide. TestFlight shows the marketing version **`1.0`**
(`MARKETING_VERSION`), deliberately **not** the PWA's `0.1.x` — see
[README §6](README.md#6-versioning). Do not "fix" that mismatch; it is
intentional.

**TestFlight builds expire 90 days after upload.** A build uploaded in
mid-September expires in mid-December, which covers the October training — but a
build made now is not the one you hand out in January.

Testers' devices must be on **iOS 15 or later** (the project's deployment
target).

---

## 11. When it fails — reading the error

| Symptom                                                             | Almost certainly                                                                                                                                                                                                 |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preflight fails in ~30s naming a secret                             | That secret is unset **or empty** — §8                                                                                                                                                                           |
| Preflight refuses the ref                                           | §9 — dispatch `develop` with `allow_any_ref`, or promote first                                                                                                                                                   |
| `org.unfoldingword.tcmobile` missing from the New App dropdown      | §4 was skipped — the identifier is not registered                                                                                                                                                                |
| "The App Name you entered is already being used"                    | `translationCore Mobile` is Tim's call (§5) — escalate to him rather than improvising a name in the form                                                                                                         |
| Upload rejected, "no app record" / "cannot find app"                | §5 was skipped, or the bundle id does not match exactly                                                                                                                                                          |
| Signing/provisioning failure in the **archive** or **export** phase | A manual-signing credential is wrong (§5.5): a `.p12` exported without its private key, or a profile not bound to `org.unfoldingword.tcmobile` **and** that certificate. Not the API key — the key only uploads. |
| Upload rejected for permissions after a clean archive               | The API key's role is too low — §6 wants **App Manager**                                                                                                                                                         |
| `errSecInternalComponent` after ~20 min                             | The keychain was not set up. `setup_ci` handles this when `CI=true`; a real failure mode running by hand                                                                                                         |
| Green run, no tester ever receives it                               | §7's _Automatically distribute new builds_ is off                                                                                                                                                                |
| Build uploaded but never appears                                    | Processing rejection — check email; the lane cannot see this                                                                                                                                                     |

---

## 12. Worksheet

Fill this in **in 1Password**, not in this file.

```
Apple Developer Program enrolled?    yes / no        (Q1)
My role on the team                  ________        (Q2 — can I mint a Team key?)
Team ID                              ________        -> APPLE_TEAM_ID
Bundle ID registered?                yes / no        (§4)
App Store Connect app record name    translationCore Mobile   (§5, decided)
SKU                                  ________        (§5)
Dist cert + .p12 (private key incl)? yes / no        -> IOS_DIST_CERT_P12_BASE64 (§5.5)
.p12 export password filed?          yes / no        -> IOS_DIST_CERT_PASSWORD   (§5.5)
App Store profile downloaded?        yes / no        -> IOS_PROVISION_PROFILE_BASE64 (§5.5)
API Key ID                           ________        -> ASC_KEY_ID
API Issuer ID                        ________        -> ASC_ISSUER_ID
.p8 filed in 1Password?              yes / no        -> ASC_KEY_P8_BASE64
Internal group auto-distribute on?   yes / no        (§7 — the quiet failure)
Seven secrets set?                   yes / no        (§8)
First dispatch ref + allow_any_ref   ________        (§9)
```

---

## 13. Local build prerequisites (only if you archive by hand)

[README §4a](README.md#4a-ios--testflight-via-ci-automated-no-mac-step)
recommends proving the chain with **one manual Xcode archive** before trusting
CI, since none of this has ever executed. That needs a working local toolchain,
and as of **2026-09-12 this Mac does not have one**:

| Check          | State on `excalibur.local`, 2026-09-12                                                                                                                                                                                 |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node` / `npm` | **absent** — not in Homebrew, no nvm/mise/asdf/volta, nothing on `PATH`. `node_modules/` (2026-09-10, Mach-O arm64) proves it was here recently; `PATH` still references `/pkg/env/global/bin`, which no longer exists |
| `xcode-select` | points at `/Library/Developer/CommandLineTools`, so `xcodebuild` errors out. Xcode **26.6** and Xcode-beta **27.0** are both installed                                                                                 |
| Ruby           | system **2.6.10** shadows Homebrew's **4.0.6** (`/usr/bin` precedes `/opt/homebrew/bin`). Bundler **2.6.9** (the pinned version) and fastlane are not installed                                                        |

To restore it:

```bash
brew install node@22                                              # matches the workflow's Node 22
npm ci                                                            # rebuild node_modules against a live toolchain
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer   # 26.6 stable, not the 27.0 beta
```

None of this is needed for the **CI** path, which is why §§1–9 come first.

**A caveat if you run `bundle` locally:** `Gemfile.lock` was generated for
`arm64-darwin-23` / `x86_64-darwin-23` (the macOS runner) plus the generic
`ruby` platform. This Mac reports `arm64-darwin25`, so a local
`bundle config set --local frozen true` then `bundle install` leans on that
generic entry. If it refuses, that is a local-platform artifact, **not** a
broken lock — the CI runner is darwin-23 and matches exactly. Do not "fix" the
lock to suit this Mac; it would desync CI.
