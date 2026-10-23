import { useCallback, useState } from "react";

import { Icon } from "./icon";
import { Menu } from "./menu";
import { NameEdit } from "./name-edit";
import { Notice } from "./notice";
import {
  useTemplateLibrary,
  type TemplateEntry,
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
    <div className="settings-list">
      {entries.map((entry) => {
        const title = titleOf(entry, language);
        const thumb = previewThumbnail(entry.pkg);
        const licence = licenceTag(entry.pkg.recordingLicence);
        return (
          <button
            key={entry.pkg.id}
            type="button"
            className="setting-row template-row"
            aria-label={title}
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
              <span
                className="template-row-licence"
                aria-label={strings.templateLicenceLabel(licence)}
              >
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
        <>
          {status === "failed" && <Notice>{strings.loadFailed}</Notice>}
          <TemplateList
            entries={entries}
            base={import.meta.env.BASE_URL}
            language={language}
            busy={creating}
            onPick={setChosen}
          />
        </>
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
