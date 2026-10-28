import { useCallback, useState } from "react";

import { Icon } from "./icon";
import { Menu } from "./menu";
import { NameEdit } from "./name-edit";
import { Notice } from "./notice";
import {
  useTemplateLibrary,
  type TemplateEntry,
  type TemplateLibraryStatus,
} from "@/hooks/use-template-library";
import type { FailureKey } from "@/hooks/save-failure";
import { activeLocale } from "@/lib/locale";
import { strings } from "@/lib/strings";
import {
  licenceTag,
  previewThumbnail,
  resolveAssetUrl,
  templateTitle,
} from "@/lib/templates/library";

/**
 * The Template Library (#246, part of #1450): the global menu's Templates
 * tile opens this panel, a plain list with one row per bundled package, each a
 * thumbnail, the title and one icon-first licence line. Tapping a row asks
 * for the book's name (the same field New Book uses, pre-filled with the
 * title) and creates the book. A name another book already has is refused with
 * the existing `bookNameTaken` Notice and the field stays open (U4b).
 *
 * The list's layout is deliberately the plainest one. How a longer list reads
 * to someone who does not read is the requirements owner's call (#246); this
 * invents none of it.
 */

const titleOf = (entry: TemplateEntry, language: string): string =>
  templateTitle(entry.pkg.title, entry.pkg.titleLanguages, language);

/** The rows. Presentational: no state, so one render shows it. */
export function TemplateList({
  entries,
  base,
  language,
  busy,
  onPick,
}: {
  entries: readonly TemplateEntry[];
  /** The app's base, so a thumbnail never resolves against the route. */
  base: string;
  language: string;
  busy: boolean;
  onPick: (entry: TemplateEntry) => void;
}) {
  return (
    <div className="settings-list" aria-busy={busy}>
      {entries.map((entry) => {
        const title = titleOf(entry, language);
        const thumb = previewThumbnail(entry.pkg);
        const licence = licenceTag(entry.pkg.recordingLicence);
        return (
          <button
            key={entry.pkg.id}
            type="button"
            className="setting-row template-row"
            aria-label={strings.sentences(
              title,
              strings.templateLicenceLabel(licence)
            )}
            aria-busy={busy}
            onClick={() => {
              if (!busy) onPick(entry);
            }}
          >
            {thumb !== null && (
              <img
                className="template-row-thumb"
                src={resolveAssetUrl(thumb, base)}
                alt=""
                width={56}
                height={56}
              />
            )}
            <span className="template-row-text">
              <span className="template-row-title">{title}</span>
              <span className="template-row-licence">
                <Icon name="copies" size={18} />
                {licence}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * The list step: the failure Notice when nothing loaded, then the rows
 * (#1747). Every open reads the list again, and while it does a busy Notice
 * says so and the rows are busy in place (marked and inert) instead of the
 * last load's failure staying on screen. Presentational: one render shows it.
 */
export function TemplateLibraryBody({
  status,
  creating,
  ...list
}: {
  status: TemplateLibraryStatus;
  creating: boolean;
  entries: readonly TemplateEntry[];
  base: string;
  language: string;
  onPick: (entry: TemplateEntry) => void;
}) {
  return (
    <>
      {status === "loading" && (
        <Notice tone="busy">{strings.loadingTemplates}</Notice>
      )}
      {status === "failed" && <Notice>{strings.loadFailed}</Notice>}
      <TemplateList {...list} busy={creating || status === "loading"} />
    </>
  );
}

export function TemplatePicker({
  open,
  onClose,
  onCreated,
  onBusyChange,
}: {
  open: boolean;
  onClose: () => void;
  /** The book is written: the shelf re-reads and the panel closes. */
  onCreated: () => void;
  /** True while a create is in flight, so system Back can be refused. */
  onBusyChange: (busy: boolean) => void;
}) {
  const { status, entries, creating, create, reset } = useTemplateLibrary(
    open,
    onCreated,
    onBusyChange
  );
  const [chosen, setChosen] = useState<TemplateEntry | null>(null);
  const [error, setError] = useState<FailureKey | null>(null);
  const language = activeLocale().tag;
  // Every close resets the picker, system Back included: Back dismisses the
  // layer by `open` falling, without `close`, so the reset is keyed on that
  // falling edge (adjusted during render, not in an effect). The hook forgets
  // its held intent on the same edge.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (!open) {
      setChosen(null);
      setError(null);
    }
  }

  const close = useCallback(() => {
    if (creating) return;
    reset();
    setChosen(null);
    setError(null);
    onClose();
  }, [creating, onClose, reset]);

  const cancelName = useCallback(() => {
    if (creating) return;
    reset();
    setChosen(null);
    setError(null);
  }, [creating, reset]);

  const confirm = useCallback(
    async (name: string) => {
      if (chosen === null) return;
      setError(null);
      const outcome = await create(chosen, name);
      // A create already in flight answers its own outcome; this one is none.
      if (outcome === null) return;
      if (outcome.ok) {
        setChosen(null);
      } else {
        setError(outcome.key);
      }
    },
    [chosen, create]
  );

  return (
    <Menu open={open} onClose={close} title={strings.templatesTitle}>
      {chosen === null ? (
        <TemplateLibraryBody
          status={status}
          creating={creating}
          entries={entries}
          base={import.meta.env.BASE_URL}
          language={language}
          onPick={setChosen}
        />
      ) : (
        <>
          <NameEdit
            initialValue={titleOf(chosen, language)}
            selectInitialValue
            fieldLabel={strings.bookNameField}
            saveLabel={strings.createBook}
            onSave={(name) => void confirm(name)}
            onCancel={cancelName}
            busy={creating}
            busyLabel={strings.creatingBook}
          />
          {creating && <Notice tone="busy">{strings.creatingBook}</Notice>}
          {error !== null && <Notice>{strings[error]}</Notice>}
        </>
      )}
    </Menu>
  );
}
