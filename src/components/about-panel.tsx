import { Icon } from "./icon";
import { appLicense, contentAttribution, thirdPartyLicenses } from "./licenses";
import { strings } from "./strings";

/**
 * The About & licenses surface, rendered inside the global menu.
 *
 * lamejs is LGPL-3.0 (ADR 0003); #36 requires its attribution and licence text
 * to be reachable by someone holding the phone, not just in `node_modules`.
 * This panel is that surface: the app's own MIT licence, every bundled
 * open-source component with a link to its verbatim licence text under
 * `/licenses/`, and the OBS content credit. It is a deliberately text-first
 * screen — a legal notice has no wordless form — so it carries real labels for
 * AT rather than the icon-only chrome the rest of the app uses.
 *
 * Links are underlined ink, not the amber accent: `--s-voice` means "audio that
 * exists" and fails contrast as a text colour on the light theme (2-semantic),
 * so the underline is the affordance and the ink keeps the contrast.
 */
export function AboutPanel() {
  return (
    <div
      className="flex min-w-0 flex-col gap-[14px] text-[13px] leading-relaxed"
      style={{ color: "var(--s-ink)" }}
    >
      <p style={{ color: "var(--s-ink-muted)" }}>{strings.aboutBlurb}</p>

      <section className="flex flex-col gap-[4px]">
        <p>{strings.aboutAppLicense}</p>
        <FileLink
          href={appLicense.file.href}
          text={appLicense.file.label}
          label={strings.aboutReadLicense(appLicense.spdx)}
        />
      </section>

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
              {lib.role} · {lib.spdx}
            </span>
            <span style={{ color: "var(--s-ink-muted)" }}>{lib.copyright}</span>
            <span style={{ color: "var(--s-ink-muted)" }}>{lib.note}</span>
            <span className="flex flex-wrap gap-x-[14px] gap-y-[2px]">
              {lib.files.map((file) => (
                <FileLink
                  key={file.href}
                  href={file.href}
                  text={file.label}
                  label={strings.aboutReadLicense(file.label)}
                />
              ))}
            </span>
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
  );
}

/**
 * A licence document shipped under `/licenses/`. `target="_blank"` opens it
 * outside the standalone PWA rather than navigating away from the app; the
 * files precache, so this resolves offline.
 */
function FileLink({
  href,
  text,
  label,
}: {
  href: string;
  text: string;
  label: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      className="inline-flex w-fit items-center gap-[4px] underline"
      style={{ color: "var(--s-ink)" }}
    >
      <Icon name="share" size={13} />
      {text}
    </a>
  );
}

/** An off-phone link (a project page or a Creative Commons deed). */
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
