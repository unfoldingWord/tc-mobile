# Android → Google Play — setup runbook

The CI lane is `.github/workflows/android-play.yml`. Every push to `staging`
or `main` (docs-only pushes excepted) builds a signed Android App Bundle and
uploads it to Google Play:

| Branch    | Play track       | Variable that overrides it | Who sees it                         |
| --------- | ---------------- | -------------------------- | ----------------------------------- |
| `staging` | Internal testing | `PLAY_TRACK_STAGING`       | up to 100 listed testers, no review |
| `main`    | Closed testing   | `PLAY_TRACK_MAIN`          | the closed track's tester list      |

Production is never automatic: promote a closed-testing release to Production
by hand in Play Console. The lane is **off** until the repository variable
`PLAY_UPLOAD_ENABLED` is `true`, so pushes before setup is finished only log a
notice.

The Play Console app record exists: **tC Mobile**, package
`org.unfoldingword.tcmobile`, in the unfoldingWord organization developer
account (created 2026-09-24).

Do the steps below **in order**. Step 1 has a deadline: after any release has
gone to open testing or production, you can no longer change the app signing
key.

**This app's current values, for reference — the steps below are already done
for tC Mobile, not a from-scratch checklist:**

- **Cloud project:** `uw-tc-mobile` (step 3). Not a random unfoldingWord
  project — use this one, so the service account and API enablement stay in
  one place.
- **Service account:** `tc-mobile-play-ci@uw-tc-mobile.iam.gserviceaccount.com`
  (step 3), granted **Release apps to testing tracks** only.
- **Certificate SHA-256 fingerprints**, read from the keystores with
  `keytool` (not secret — a fingerprint cannot be used to sign anything):
  - App signing / release key (`tc-mobile-release.jks`, alias `tc-mobile`):
    `EE:D2:3E:1B:CC:F9:FB:AD:8B:69:F2:F9:59:8F:D8:D9:7E:09:4D:23:E5:44:B7:1B:9E:91:DD:21:C9:34:BA:F2`
  - Upload key (`tc-mobile-upload.jks`, alias `upload`):
    `98:E7:EF:93:D5:9A:FB:6F:5D:E8:EE:E1:44:0D:3C:C7:2B:AB:FA:88:8C:C9:7D:0A:77:62:5E:B4:EE:6B:32:53`

  Confirming these against what Play Console's **App integrity** page shows
  for the app signing key certificate and the upload key certificate is a
  separate, not-yet-done check (#874) — this list only records what the
  keystores themselves report.

---

## 1. Keep the existing release keystore as the app signing key

**Why:** testers already have sideloaded APKs signed with the release keystore
(`docs/native/README.md` §5a). Android refuses an update signed with a
different key, and the forced uninstall wipes IndexedDB, which means every
recording on the phone. If Play signs with that **same** key, a sideloaded
install updates from Play in place.

By default Play Console has already generated its own key for this app
("quantum-ready" hybrid key). Replace it:

1. Play Console → tC Mobile → **Protected with Play** → **Play Store
   protection** → **Manage Play app signing** → **Change key**.
2. Pick the option to **export and upload a key from a Java keystore**.
3. Download **pepk.jar** and the **encryption public key** from that page.
4. On the machine that holds `tc-mobile-release.jks` (never in CI, never in
   this repo), run the command the page shows. It looks like this:

   ```bash
   java -jar pepk.jar --keystore=tc-mobile-release.jks --alias=<ANDROID_KEY_ALIAS> \
     --output=tc-mobile-signing-key.zip --include-cert --rsa-aes-encryption \
     --encryption-key-path=encryption_public_key.pem
   ```

5. Upload the generated ZIP on the same page.

Trade-off: a key you bring yourself is a classical RSA key. The app gives up
the post-quantum half of Google's generated key. Keeping existing testers'
recordings matters more than that.

## 2. Create a separate upload key

CI signs bundles with an **upload key**, not the app signing key. If the
upload key ever leaks, Play Console can reset it. The app signing key can't be
reset.

```bash
keytool -genkeypair -v -keystore tc-mobile-upload.jks -alias upload \
  -keyalg RSA -keysize 4096 -validity 10000
keytool -export -rfc -keystore tc-mobile-upload.jks -alias upload \
  -file upload_certificate.pem
```

Upload `upload_certificate.pem` in the same Change key flow
("For increased security, create a new upload key"). Keep
`tc-mobile-upload.jks` and its password in the team secret store next to the
release keystore.

## 3. Service account for the Play API

You no longer have to link a Google Cloud project in Play Console
([Google docs](https://developers.google.com/android-publisher/getting_started)).

1. In Google Cloud Console (the `uw-tc-mobile` project), enable the
   **Google Play Android Developer API**, then **IAM & Admin → Service
   Accounts → Create**. Name it something like `tc-mobile-play-ci`. It needs
   no Cloud roles.
2. Open the account → **Keys → Add key → JSON**. The downloaded file is the
   secret.
3. Play Console (account level) → **Users and permissions → Invite new
   users**. Enter the service account's email, then under **App permissions**
   add **tC Mobile** only, with **Release apps to testing tracks** (plus **View
   app information**). Do not grant **Release to production**: the service
   account is scoped to testing tracks only, and even if it were granted
   production release, the workflow's preflight
   (`.github/workflows/android-play.yml`) refuses the `production` track
   before any upload runs.

## 4. GitHub environment, secrets, and variables

Settings → Environments → **New environment** `play-upload`:

- **Deployment branches:** "Selected branches" → `staging` and `main`. This
  rule, not a reviewer, is what keeps a feature branch from reaching these
  secrets. Leave **Required reviewers** off so uploads are automatic.
- **Environment secrets:**

  | Secret                        | Value                                                              |
  | ----------------------------- | ------------------------------------------------------------------ |
  | `PLAY_UPLOAD_KEYSTORE_BASE64` | `base64 < tc-mobile-upload.jks \| tr -d '\n'` (one line, portable) |
  | `PLAY_UPLOAD_STORE_PASSWORD`  | upload keystore password                                           |
  | `PLAY_UPLOAD_KEY_ALIAS`       | `upload`                                                           |
  | `PLAY_UPLOAD_KEY_PASSWORD`    | same as the store password for a PKCS12 keystore                   |
  | `PLAY_SERVICE_ACCOUNT_JSON`   | the full contents of the service-account JSON file                 |

Repository **variables** (Settings → Secrets and variables → Actions →
Variables), all optional except the first:

| Variable              | Default    | Meaning                                                   |
| --------------------- | ---------- | --------------------------------------------------------- |
| `PLAY_UPLOAD_ENABLED` | _(unset)_  | `true` turns the push trigger on (step 6)                 |
| `PLAY_TRACK_STAGING`  | `internal` | track for `staging` pushes                                |
| `PLAY_TRACK_MAIN`     | `alpha`    | track for `main` pushes (`alpha` is Closed testing)       |
| `PLAY_RELEASE_STATUS` | `draft`    | `draft` until the app is published once, then `completed` |

The sideload APK lane (`android-apk.yml`) and its `release-signing`
environment don't change. That environment still holds the app signing
keystore and still needs a reviewer's approval.

## 5. First bundle: upload it by hand

Play's API won't accept a bundle for an app that has never had one uploaded
([fastlane docs](https://docs.fastlane.tools/actions/upload_to_play_store/)).
So the first bundle is uploaded manually:

1. Actions → **Android → Google Play** → Run workflow on `staging` with
   **build_only** ticked. This builds and signs with the upload key and skips
   the API.
2. Download the `android-aab-staging-<versionCode>` artifact.
3. Play Console → **Test and release → Testing → Internal testing → Create
   new release** → upload `app-release.aab` → save. Add testers (an email
   list or Google Group) on the track's **Testers** tab.

## 6. Turn on automatic uploads

Set `PLAY_UPLOAD_ENABLED=true`. From then on, every qualifying push to
`staging` or `main` uploads on its own.

While the app has never been published, Play only accepts **draft** releases
from the API. CI releases therefore arrive as drafts that someone rolls out in
Play Console. After the first release has been rolled out and the app's
dashboard setup tasks are done (store listing, content rating, data safety,
target audience), set `PLAY_RELEASE_STATUS=completed` and uploads roll out
without a manual step.

## Notes

- **versionCode** is a unix timestamp, the same scheme as the APK lane. Play's
  ceiling is 2,100,000,000
  ([Play help](https://support.google.com/googleplay/android-developer/answer/17367361?hl=en)).
  The timestamp reaches it on 2036-07-18, so switch schemes before then.
- **versionName** comes from `package.json` (`docs/native/README.md` §6). The
  Play release name is `<version> (<versionCode>) <branch>@<short sha>`.
- **Store listing, screenshots, and release notes** are maintained in Play
  Console. The fastlane `android play` lane skips all metadata.
- **Android developer verification:** Play Console asks that packages and
  signing keys used for distribution outside Play be registered (the
  notification in the account says by 2026-09-30). The sideloaded APKs are
  exactly that, so register `org.unfoldingword.tcmobile` and the release
  key's certificate there too.
