import { useEffect, useState } from "react";

import { Control } from "./control";
import {
  contentAttribution,
  licenseTexts,
  thirdPartyLicenses,
  type LicenseText,
} from "./licenses";
import { Notice } from "./notice";
import { strings } from "./strings";

/**
 * The About & licenses surface, rendered inside the global menu.
 *
 * The app is MIT with one copyleft dependency, lamejs (LGPL-3.0, ADR 0003).
 * #36 requires the licence text and attribution of the bundled components to be
 * reachable by someone holding the phone, not just in `node_modules`. This
 * panel is that surface: every bundled runtime dependency with its licence and
 * copyright, the lamejs LGPL relink note and its LAME acknowledgement, the
 * verbatim licence texts, and the OBS content credit.
 *
 * The licence texts are read **in-drawer**, not via `target="_blank"`: the app
 * is a standalone PWA with an index.html navigate-fallback (vite.config /
 * wrangler SPA), so opening a `/licenses/*.txt` as a navigation could leave the
 * app or, on a service-worker miss, be answered with the shell instead of the
 * licence (George G1). Fetching the precached text into a `<pre>` keeps it in
 * the controlling document and offline-correct. Only genuinely off-phone links
 * (a project page, a CC deed) open in a new tab.
 *
 * A text-first screen by necessity — a legal notice has no wordless form — so
 * it carries real labels for AT. Links are underlined ink, not the amber accent
 * (`--s-voice` means "audio exists" and fails contrast as a text colour on the
 * light theme, 2-semantic).
 */
export function AboutPanel() {
  const [viewing, setViewing] = useState<LicenseText | null>(null);

  if (viewing) {
    // Keyed by href so selecting a different text remounts with fresh state,
    // rather than resetting it synchronously inside the fetch effect.
    return (
      <LicenseTextView
        key={viewing.href}
        text={viewing}
        onBack={() => setViewing(null)}
      />
    );
  }

  return (
    <div
      className="flex min-w-0 flex-col gap-[14px] text-[13px] leading-relaxed"
      style={{ color: "var(--s-ink)" }}
    >
      <p style={{ color: "var(--s-ink-muted)" }}>{strings.aboutBlurb}</p>
      <p>{strings.aboutAppLicense}</p>

      <section className="flex flex-col gap-[10px]">
        <h3 className="t-title">{strings.aboutThirdParty}</h3>
        {thirdPartyLicenses.map((lib) => (
          <div key={lib.name} className="flex flex-col gap-[3px]">
            <ExternalLink
              href={lib.homepage}
              label={strings.aboutVisitSource(lib.name)}
            >
              <span className="t-title">{lib.name}</span> {lib.version}
            </ExternalLink>
            <span style={{ color: "var(--s-ink-muted)" }}>
              {lib.role ? `${lib.role} · ` : ""}
              {lib.spdx} · {lib.copyright}
            </span>
            {lib.note && (
              <span style={{ color: "var(--s-ink-muted)" }}>{lib.note}</span>
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
  );
}

/**
 * A verbatim licence text, read inside the drawer. The file is precached, so
 * the fetch resolves offline; a miss shows a Notice rather than a blank pane.
 */
function LicenseTextView({
  text,
  onBack,
}: {
  text: LicenseText;
  onBack: () => void;
}) {
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
    <div className="flex min-w-0 flex-col gap-[10px]">
      <div className="flex items-center gap-[6px]">
        <Control
          icon="back"
          label={strings.aboutBack}
          variant="quiet"
          onClick={onBack}
        />
        <span className="t-title">{text.label}</span>
      </div>
      {failed ? (
        <Notice>{strings.aboutTextFailed}</Notice>
      ) : body === null ? (
        <Notice tone="busy">{strings.aboutTextLoading}</Notice>
      ) : (
        <pre
          className="max-h-[60vh] overflow-auto text-[11px] leading-normal whitespace-pre-wrap"
          style={{ color: "var(--s-ink-muted)" }}
        >
          {body}
        </pre>
      )}
    </div>
  );
}

/** An off-phone link (a project page, an upstream, or a Creative Commons deed). */
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
