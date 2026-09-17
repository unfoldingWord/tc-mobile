import type { DatabaseStatus } from "@/hooks/use-database-status";
import { Control } from "./control";
import { Icon, type IconName } from "./icon";
import { strings } from "./strings";

/** The heading that names the alert, referenced by `aria-labelledby`. */
const TITLE_ID = "db-panel-title";

/** The teach line that describes the alert, referenced by `aria-describedby`. */
const TEACH_ID = "db-panel-teach";

/**
 * Restart the app from disk — the same exit `ErrorBoundary` offers, for the
 * same reason: everything saved is in IndexedDB, and a reload is what picks up
 * the newer build the service worker has already activated.
 */
function reload(): void {
  window.location.reload();
}

/** Put the reader on the alert's name, not on its one control (see
 * `error-boundary.tsx` for why the heading and not the button). */
function focusOnMount(node: HTMLParagraphElement | null): void {
  node?.focus();
}

interface DatabasePanelProps {
  status: Exclude<DatabaseStatus, "ok">;
}

/**
 * The database is unreachable, and this says so — one full screen per copy of
 * the app, in the shape `SaveFailed` and `ErrorBoundary` already use: a 56px
 * mark, two short lines, one large control.
 *
 * Two copies of this app can be open at once (a second tab, or the pre-update
 * page still alive after a service-worker swap), and when the newer one
 * upgrades the database exactly one of these two states is true in each of
 * them. Neither is a crash and both need a person to do something, so the
 * meaning has to survive being unread: the mark differs between them — two
 * sheets for "there is another copy of this", a heads-up ring for "this one is
 * out of date" — and the control is the same restart in both.
 *
 * The control means different things in the two states, which is why only the
 * out-of-date teach line asks for it. On `reloadNeeded` a restart is the only
 * exit. On `blocked` it is a FALLBACK: closing the other copy is the whole
 * action, and this panel takes itself down on its own when that happens
 * (`onUnblocked`), so the teach line says just that and the button is there for
 * someone who would rather start over than hunt for the other tab.
 */
export function DatabasePanel({ status }: DatabasePanelProps) {
  const blocked = status === "blocked";
  const mark: IconName = blocked ? "copies" : "info";

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={TITLE_ID}
      aria-describedby={TEACH_ID}
      className="flex w-full max-w-md flex-col items-center gap-[18px] px-[22px] text-center"
    >
      <span style={{ color: "var(--s-live)" }}>
        <Icon name={mark} size={56} />
      </span>

      <p
        id={TITLE_ID}
        ref={focusOnMount}
        tabIndex={-1}
        className="t-title"
        style={{ color: "var(--s-ink)" }}
      >
        {blocked ? strings.dbBlocked : strings.dbOutOfDate}
      </p>

      <p
        id={TEACH_ID}
        className="text-[13px]"
        style={{ color: "var(--s-ink-muted)" }}
      >
        {blocked ? strings.dbBlockedTeach : strings.dbOutOfDateTeach}
      </p>

      <Control
        icon="retry"
        label={strings.appReload}
        variant="primary"
        size={30}
        onClick={reload}
      />
    </div>
  );
}
