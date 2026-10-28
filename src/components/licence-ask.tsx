import { useState } from "react";

import { licenceLabel } from "@/lib/export/licence-tag";
import { strings } from "@/lib/strings";
import type { LicenceId } from "@/types/template";
import { Control } from "./control";
import { Icon } from "./icon";
import { Notice } from "./notice";
import { TileGrid } from "./o4-tile-menu";

/**
 * The choices D5 and R20 name, in their order. "Other" is not here: whether
 * it is `all-rights-reserved` is open (U1a), so the ask offers no fifth row.
 * CC BY-SA 4.0 is first and pre-selected (R20 `empty-preselect`).
 */
const CHOICES: readonly LicenceId[] = [
  "CC-BY-SA-4.0",
  "CC-BY-4.0",
  "CC0-1.0",
  "all-rights-reserved",
];

function choiceName(id: LicenceId): string {
  if (id === "all-rights-reserved") return strings.licenceAllRightsReserved;
  return licenceLabel(id) ?? id;
}

/** Read at call time: `strings` is the active language's table, and it can change. */
function fullName(id: Exclude<LicenceId, "all-rights-reserved">): string {
  switch (id) {
    case "CC-BY-SA-4.0":
      return strings.licenceNameCcBySa;
    case "CC-BY-4.0":
      return strings.licenceNameCcBy;
    case "CC0-1.0":
      return strings.licenceNameCc0;
  }
}

/**
 * What a radio is called aloud (#1344): the full licence title, then the short
 * label the row shows (so the name holds the visible text, WCAG 2.5.3). The
 * short label alone is what a screen reader spells out letter by letter
 * (inference). The file-name tag and ID3 text keep `licenceLabel`.
 */
function spokenName(id: LicenceId): string {
  if (id === "all-rights-reserved") return choiceName(id);
  return strings.licenceChoiceName(fullName(id), choiceName(id));
}

/**
 * The licence ask on Share Book (#1455): four rows, one selected, Share to
 * go on. A row is a choice and never a send, so a pre-selected licence is
 * confirmed by a deliberate tap, not taken on a mis-tap. Presentational:
 * everything else arrives by prop.
 */
export function LicenceAsk(props: {
  onContinue: (licence: LicenceId) => void;
  onCancel: () => void;
  saving: boolean;
  error: string | null;
  /**
   * Save-only mode (#1455, "change it later"): the ask reopened from a book's
   * Licence tile, not from Share. The stored licence is the selected row, the
   * action says Save, and the lead no longer claims the choice is made once.
   * Omitted, the ask is Share's, exactly as before.
   */
  change?: { readonly current: LicenceId | null };
}) {
  const { saving, error, change } = props;
  const [selected, setSelected] = useState<LicenceId>(
    change?.current ?? "CC-BY-SA-4.0"
  );
  return (
    <TileGrid>
      <div className="licence-ask">
        <h3 className="licence-ask-title">{strings.licenceAskTitle}</h3>
        <p className="licence-ask-lead">
          {change ? strings.licenceAskSaveLead : strings.licenceAskLead}
        </p>
        <div
          role="radiogroup"
          aria-label={strings.licenceAskTitle}
          className="licence-list"
        >
          {CHOICES.map((id) => {
            const on = id === selected;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={spokenName(id)}
                data-licence={id}
                disabled={saving}
                className="licence-row"
                onClick={() => setSelected(id)}
              >
                <span className="licence-row-name">{choiceName(id)}</span>
                {on ? <Icon name="check" size={20} /> : null}
              </button>
            );
          })}
        </div>
        {saving && <Notice tone="busy">{strings.licenceSaving}</Notice>}
        {error && <Notice>{error}</Notice>}
        <div className="licence-ask-actions">
          <Control
            icon={change ? "check" : "share"}
            label={change ? strings.licenceAskSave : strings.licenceAskContinue}
            variant="primary"
            busy={saving}
            onClick={() => props.onContinue(selected)}
          />
          <button
            type="button"
            className="licence-ask-quiet"
            disabled={saving}
            onClick={props.onCancel}
          >
            {strings.licenceAskCancel}
          </button>
        </div>
      </div>
    </TileGrid>
  );
}
