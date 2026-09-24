import { useEffect, useRef, useState } from "react";

import { BuildStamp } from "./build-stamp";
import {
  contentAttribution,
  licenseTexts,
  thirdPartyLicenses,
  type LicenseText,
} from "./licenses";
import { Menu } from "./menu";
import { Notice } from "./notice";
import { strings } from "./strings";

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
 * reachable by someone holding the phone, not just in `node_modules`.
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

  return (
    <Menu
      open={open}
      onClose={handleClose}
      title={viewing ? viewing.label : strings.aboutTitle}
      focusKey={viewing?.href ?? "list"}
      closeLabel={viewing ? strings.aboutBack : undefined}
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
            {licenseTexts.map((text) => (
              <button
                key={text.href}
                type="button"
                onClick={() => onView(text)}
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
              defers the `__BUILD_SHA__` read to render time, so mounting a
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
                  <ExternalLink
                    href={lib.source.href}
                    label={strings.aboutVisitSource(lib.name)}
                  >
                    {lib.source.label}
                  </ExternalLink>
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
 */
function LicenseTextView({ text }: { text: LicenseText }) {
  const [body, setBody] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const preRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    let live = true;
    fetch(text.href)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.text();
      })
      .then((t) => {
        if (live) setBody(t);
      })
      .catch((cause: unknown) => {
        if (live) setFailed(true);
        console.error("Could not load a licence text", cause);
      });
    return () => {
      live = false;
    };
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
      className="text-ink min-h-0 flex-1 overflow-auto text-[13px] leading-normal whitespace-pre-wrap"
    >
      {body}
    </pre>
  );
}

/**
 * The durable link to the app's own Corresponding Source for THIS build (LGPL
 * §4(d)(0), the DRI's 2026-09-24 decision on #144). A GitHub `/tree/<sha>` URL
 * is permanent and version-specific: it resolves to the exact commit shipped,
 * so a recipient of the Combined Work can obtain the matching source. Kept a
 * component so the `__BUILD_SHA__` build define is read at render time, not when
 * a closed AboutPanel is constructed (mirrors `BuildStamp`). The built bundle
 * carries the resolved URL; `tests/dist-source-offer.test.ts` asserts it ships.
 */
function SourceOfferLink() {
  return (
    <ExternalLink
      href={`https://github.com/unfoldingWord/tc-mobile/tree/${__BUILD_SHA__}`}
      label={strings.aboutVisitAppSource}
    >
      unfoldingWord/tc-mobile
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
