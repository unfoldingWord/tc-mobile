import { useEffect, useState } from "react";

import {
  contentAttribution,
  licenseTexts,
  thirdPartyLicenses,
  type LicenseText,
} from "./licenses";
import { Menu } from "./menu";
import { strings } from "./strings";

interface AboutPanelProps {
  open: boolean;
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
export function AboutPanel({ open, onClose }: AboutPanelProps) {
  const [viewing, setViewing] = useState<LicenseText | null>(null);

  // Close/Escape/scrim pop the in-drawer text back to the list before they
  // close the whole drawer — so the list is always the state a fresh open sees.
  const handleClose = viewing ? () => setViewing(null) : onClose;

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
          className="flex min-w-0 flex-col gap-[14px] text-[13px] leading-relaxed"
          style={{ color: "var(--s-ink)" }}
        >
          <p style={{ color: "var(--s-ink-muted)" }}>{strings.aboutBlurb}</p>
          <p>{strings.aboutAppLicense}</p>

          {/* Licence texts first: the open-edge focus lands on an in-app button,
              never on an off-phone link (George G2). */}
          <section className="flex flex-col gap-[6px]">
            <h3 className="t-title">{strings.aboutTexts}</h3>
            {licenseTexts.map((text) => (
              <button
                key={text.href}
                type="button"
                onClick={() => setViewing(text)}
                aria-label={strings.aboutReadText(text.label)}
                className="w-fit border-0 bg-transparent p-0 text-left text-[13px] underline"
                style={{ color: "var(--s-ink)" }}
              >
                {text.label}
              </button>
            ))}
          </section>

          <section className="flex flex-col gap-[10px]">
            <h3 className="t-title">{strings.aboutThirdParty}</h3>
            {thirdPartyLicenses.map((lib) => (
              <div key={lib.name} className="flex flex-col gap-[3px]">
                <span>
                  <span className="t-title">{lib.name}</span> {lib.version}
                </span>
                <span style={{ color: "var(--s-ink-muted)" }}>
                  {lib.role ? `${lib.role} · ` : ""}
                  {lib.spdx} · {lib.copyright}
                </span>
                {lib.note && (
                  <span style={{ color: "var(--s-ink-muted)" }}>
                    {lib.note}
                  </span>
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
              <span key={item.what} style={{ color: "var(--s-ink-muted)" }}>
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

          <p style={{ color: "var(--s-ink-faint)" }}>
            v{__APP_VERSION__} · {__BUILD_SHA__}
          </p>
        </div>
      )}
    </Menu>
  );
}

/**
 * A verbatim licence text, read inside the drawer. The `<pre>` is always
 * rendered and focusable (`tabIndex={0}`), so the Menu's `focusKey` refocus
 * lands on it and it is the one thing to read/scroll here; the file is precached
 * so the fetch resolves offline. Back is the Menu header, not a control here.
 */
function LicenseTextView({ text }: { text: LicenseText }) {
  const [body, setBody] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

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

  return (
    <pre
      tabIndex={0}
      aria-label={text.label}
      className="max-h-[70vh] overflow-auto text-[11px] leading-normal whitespace-pre-wrap"
      style={{ color: "var(--s-ink-muted)" }}
    >
      {failed
        ? strings.aboutTextFailed
        : body === null
          ? strings.aboutTextLoading
          : body}
    </pre>
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
      className="w-fit underline"
      style={{ color: "var(--s-ink)" }}
    >
      {children}
    </a>
  );
}
