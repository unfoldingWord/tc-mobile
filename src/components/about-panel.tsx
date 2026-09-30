import { useEffect, useRef, useState } from "react";

import { BuildStamp } from "./build-stamp";
import {
  contentAttribution,
  licenseTextsFor,
  thirdPartyLicenses,
  type LicenseText,
} from "./licenses";
import { Menu } from "./menu";
import { Notice } from "./notice";
import { reportFailure } from "@/hooks/report-failure";
import { readSharePlatform } from "@/hooks/share-target";
import { strings } from "@/lib/strings";

interface AboutPanelProps {
  open: boolean;
  /** The licence text read in-drawer, or `null` for the list. Owned by the
   * caller so each level can carry its own system-Back layer (Frank F2, bench
   * round 1 on #144). */
  viewing: LicenseText | null;
  onView: (text: LicenseText) => void;
  /** Pop the licence text back to the list. */
  onBack: () => void;
  onClose: () => void;
}

/**
 * The About & licenses surface (#36), rendered as the global menu's content.
 *
 * The app is MIT with one copyleft dependency, lamejs (LGPL-3.0, ADR 0003). The
 * LGPL and the MIT/ISC clauses of the other bundled dependencies all require
 * their licence text and copyright to travel with the app; this makes them
 * reachable by someone holding the phone, not just in `node_modules`. On a
 * native build the list also names that shell's own notice (#477,
 * `licenseTextsFor`), since the Capacitor runtime and the Android or iOS
 * libraries it is built with ship in the app too.
 *
 * It owns its own `Menu` so the two-level view (the list, and a licence text
 * read in-drawer) composes with the modal contract: Close / Escape / a scrim
 * tap **pop the text back to the list first**, and only close the drawer from
 * the list — so there is one back affordance (the Menu header), not a second
 * chevron inside (Frank F2 / George G1). `focusKey` re-lands focus when the body
 * swaps, so neither switch orphans focus inside the open dialog.
 *
 * The licence texts are read in-drawer, not via `target="_blank"`: the app is a
 * standalone PWA with an index.html navigate-fallback, so opening a
 * `/licenses/*.txt` as a navigation could leave the app or be answered with the
 * shell on a service-worker miss (George G1, round 1). The in-app buttons come
 * first in DOM so the open-edge focus lands on one of them, never on an
 * off-phone link (George G2). A text-first screen by necessity — a legal notice
 * has no wordless form. Links are underlined ink, not the amber accent
 * (`--s-voice` is "audio exists" and fails contrast as text, 2-semantic).
 */
export function AboutPanel({
  open,
  viewing,
  onView,
  onBack,
  onClose,
}: AboutPanelProps) {
  // Close/Escape/scrim pop the in-drawer text back to the list before they
  // close the whole drawer — so the list is always the state a fresh open sees.
  const handleClose = viewing ? onBack : onClose;

  // Back from a licence text lands on the button that opened it, not the first
  // one (#823 item 7). The list unmounts while a text is read, so the opener is
  // remembered by `href` and found again when the list remounts. This effect
  // runs after the Menu's own `focusKey` landing (a child's effects run before
  // its parent's), so it has the last word. Closing the drawer forgets the
  // opener, so a fresh open still lands on the first button.
  const returnTo = useRef<string | null>(null);
  const listButtons = useRef(new Map<string, HTMLButtonElement>());
  useEffect(() => {
    if (!open) {
      returnTo.current = null;
      return;
    }
    if (viewing) return;
    const href = returnTo.current;
    returnTo.current = null;
    if (href) listButtons.current.get(href)?.focus();
  }, [open, viewing]);

  return (
    <Menu
      open={open}
      onClose={handleClose}
      title={viewing ? viewing.label : strings.aboutTitle}
      focusKey={viewing?.href ?? "list"}
      closeLabel={viewing ? strings.aboutBack : undefined}
      // In the licence view the header control goes back to the list, one
      // level, so it keeps the chevron in O4 rather than the sheets' ✕ (#1268).
      back={viewing !== null}
    >
      {viewing ? (
        <LicenseTextView text={viewing} />
      ) : (
        <div
          // The list is the scroll container, not `.menu-panel` — same
          // `min-h-0 flex-1 overflow-auto` contract the licence-text `<pre>`
          // takes — so on a short phone the panel's header Back stays put
          // instead of scrolling off with the content (#36 G1).
          className="text-ink flex min-h-0 min-w-0 flex-1 flex-col gap-[14px] overflow-auto text-[13px] leading-relaxed"
        >
          <p className="text-ink-muted">{strings.aboutBlurb}</p>
          <p>{strings.aboutAppLicense}</p>

          {/* Licence texts first: the open-edge focus lands on an in-app button,
              never on an off-phone link (George G2). */}
          <section className="flex flex-col gap-[6px]">
            <h3 className="t-title">{strings.aboutTexts}</h3>
            {licenseTextsFor(readSharePlatform()).map((text) => (
              <button
                key={text.href}
                ref={(el) => {
                  if (el) listButtons.current.set(text.href, el);
                  else listButtons.current.delete(text.href);
                }}
                type="button"
                onClick={() => {
                  returnTo.current = text.href;
                  onView(text);
                }}
                aria-label={strings.aboutReadText(text.label)}
                className="text-ink flex min-h-[40px] w-fit items-center border-0 bg-transparent p-0 text-left text-[13px] underline"
              >
                {text.label}
              </button>
            ))}
          </section>

          {/* The app's own Corresponding Source (LGPL §4(d)(0)). Placed AFTER
              the licence-text buttons so the open-edge focus still lands on a
              button, not this off-phone link (George G2). `SourceOfferLink`
              defers the `__BUILD_SHA_FULL__` read to render time, so mounting a
              closed AboutPanel (every BooksScreen test) never evaluates it. */}
          <div className="flex flex-col gap-[3px]">
            <span>{strings.aboutSourceOffer}</span>
            <SourceOfferLink />
          </div>

          <section className="flex flex-col gap-[10px]">
            <h3 className="t-title">{strings.aboutThirdParty}</h3>
            {thirdPartyLicenses.map((lib) => (
              <div key={lib.name} className="flex flex-col gap-[3px]">
                <span>
                  <span className="t-title">{lib.name}</span> {lib.version}
                </span>
                <span className="text-ink-muted">
                  {lib.role ? `${lib.role} · ` : ""}
                  {lib.spdx} · {lib.copyright}
                </span>
                {lib.note && <span className="text-ink-muted">{lib.note}</span>}
                {lib.source && (
                  <KeptSourceLink name={lib.name} source={lib.source} />
                )}
                {lib.acknowledges && (
                  <ExternalLink
                    href={lib.acknowledges.href}
                    label={strings.aboutVisitSource(lib.acknowledges.label)}
                  >
                    {lib.acknowledges.label}
                  </ExternalLink>
                )}
              </div>
            ))}
          </section>

          <section className="flex flex-col gap-[6px]">
            <h3 className="t-title">{strings.aboutContent}</h3>
            {contentAttribution.map((item) => (
              <span key={item.what} className="text-ink-muted">
                {item.what}: {item.holder},{" "}
                <ExternalLink
                  href={item.href}
                  label={strings.aboutVisitLicense(item.license)}
                >
                  {item.license}
                </ExternalLink>
              </span>
            ))}
          </section>

          <BuildStamp />
        </div>
      )}
    </Menu>
  );
}

/**
 * A verbatim licence text, read inside the drawer. Loading and failure go
 * through `Notice` (the established status/alert channel — George G1), so they
 * are announced; the `<pre>` renders the body only, and carries no `aria-label`
 * so AT reads the text rather than the panel title again. It fills the panel and
 * is the one scroll container (`flex-1`), focusable so the Menu's `focusKey`
 * refocus lands on it. The file is precached, so the fetch resolves offline.
 * Back is the Menu header, not a control here.
 *
 * A failed fetch reaches the failure log as `"about-licence-text"`, not only
 * `console.error` (#823). A 200 that is HTML counts as a failure: a host that
 * answers a missing `/licenses/*.txt` with the app shell would otherwise show
 * the shell's markup as a licence. The navigate-fallback denylist covers
 * navigations only, never this `fetch`.
 *
 * The result is held with the `href` it was fetched for, so a mounted `href`
 * change renders loading until its own result lands rather than the previous
 * text's body or failure, and the fetch it replaces is aborted.
 */
function LicenseTextView({ text }: { text: LicenseText }) {
  const [result, setResult] = useState<{
    href: string;
    body: string | null;
  } | null>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const current = result?.href === text.href ? result : null;
  const body = current?.body ?? null;
  const failed = current !== null && current.body === null;

  useEffect(() => {
    const controller = new AbortController();
    const href = text.href;
    fetch(href, { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(`licence text ${href}: HTTP ${r.status}`);
        const t = await r.text();
        if (isHtml(r.headers.get("content-type"), t))
          throw new Error(`licence text ${href}: answered with HTML`);
        return t;
      })
      .then((t) => {
        if (!controller.signal.aborted) setResult({ href, body: t });
      })
      .catch((cause: unknown) => {
        // An abort is this effect's own cleanup (unmount, or a newer `href`),
        // not a failure: nothing is shown and nothing is logged.
        if (controller.signal.aborted) return;
        setResult({ href, body: null });
        console.error("Could not load a licence text", cause);
        reportFailure(cause, "about-licence-text");
      });
    return () => controller.abort();
  }, [text.href]);

  // Land focus on the body once it arrives: while it loads a Notice shows (not
  // focusable), so the Menu's focusKey lands on the header Back until then.
  useEffect(() => {
    if (body !== null) preRef.current?.focus();
  }, [body]);

  if (failed) return <Notice>{strings.aboutTextFailed}</Notice>;
  if (body === null)
    return <Notice tone="busy">{strings.aboutTextLoading}</Notice>;
  return (
    <pre
      ref={preRef}
      tabIndex={0}
      className="text-ink min-h-0 min-w-0 flex-1 overflow-auto text-[13px] leading-normal whitespace-pre-wrap"
    >
      {body}
    </pre>
  );
}

/**
 * Whether a licence-text response is an HTML page rather than the plain text
 * asked for: by its declared type, or by a body that opens like a document
 * (a host may serve the shell with a generic type).
 */
function isHtml(contentType: string | null, body: string): boolean {
  if (contentType?.toLowerCase().includes("text/html")) return true;
  const head = body.trimStart().slice(0, 15).toLowerCase();
  return head.startsWith("<!doctype") || head.startsWith("<html");
}

/**
 * The link to the app's own source for THIS build (LGPL §4(d)(0), the DRI's
 * 2026-09-24 decision on #144): a GitHub `/tree/<commit>` URL at the build's
 * full 40-hex commit id, not the 7-character footer sha, so the link names one
 * commit without relying on GitHub resolving an abbreviation (Frank round 6).
 * Kept a component so the `__BUILD_SHA_FULL__` build define is read at render
 * time, not when a closed AboutPanel is constructed (mirrors `BuildStamp`).
 * `tests/dist-source-offer.test.ts` checks the built bundle carries the URL.
 */
function SourceOfferLink() {
  return (
    <ExternalLink
      href={`https://github.com/unfoldingWord/tc-mobile/tree/${__BUILD_SHA_FULL__}`}
      label={strings.aboutVisitAppSource}
    >
      unfoldingWord/tc-mobile
    </ExternalLink>
  );
}

/**
 * The link to a component's source kept in this repository (lamejs under
 * `third_party/`, the 2026-09-26 DRI ruling on #144's Frank round 6). A
 * component for the same reason as `SourceOfferLink`: `source.href` reads the
 * build define, so it is read only when the open list renders.
 */
function KeptSourceLink({
  name,
  source,
}: {
  name: string;
  source: NonNullable<(typeof thirdPartyLicenses)[number]["source"]>;
}) {
  return (
    <ExternalLink href={source.href} label={strings.aboutVisitKeptSource(name)}>
      {source.label}
    </ExternalLink>
  );
}

/** An off-phone link (an upstream a licence asks to credit, or a CC deed). */
function ExternalLink({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      // 40px min touch target on BOTH axes (the component-layer floor; the page
      // disables pinch-zoom) — the sibling of the round-4 button fix, on the
      // anchors. `min-w` floors the short "LAME" credit; `w-fit` keeps the
      // longer labels from stretching, and the wide ones no-op the floor (#36 F1).
      className="text-ink inline-flex min-h-[40px] w-fit min-w-[40px] items-center underline"
    >
      {children}
    </a>
  );
}
