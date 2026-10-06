/** The slice of `navigator` {@link browserOnAndroid} reads. */
export interface BrowserOsSource {
  readonly userAgent?: string;
}

/**
 * Is this a BROWSER on an Android phone — Chrome or another browser running
 * the web build? Used only to word Share Book's refusal there (#272).
 *
 * Its own module, apart from `share-target.ts`, because the two answer
 * different questions. Which BUILD this is — APK, iOS app or web — is read
 * from Capacitor and never from the user-agent (#490, pinned in
 * `tests/share-progress.test.ts`), and the native route is still chosen that
 * way before this is ever asked. This asks which phone a browser is on,
 * which the web build reads as `"web"` by design, so only the browser can
 * say: it reads the user-agent's `Android` token. A UA can be spoofed, and
 * Chrome's "desktop site" mode drops the token. Either only changes which
 * share message a person sees, so the read is good enough for that and must
 * not decide anything more.
 */
export function browserOnAndroid(source: BrowserOsSource): boolean {
  return /\bAndroid\b/.test(source.userAgent ?? "");
}
