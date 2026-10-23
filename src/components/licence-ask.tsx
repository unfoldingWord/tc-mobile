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
}) {
  const { saving, error } = props;
  const [selected, setSelected] = useState<LicenceId>("CC-BY-SA-4.0");
  return (
    <TileGrid>
      <div className="licence-ask">
        <h3 className="licence-ask-title">{strings.licenceAskTitle}</h3>
        <p className="licence-ask-lead">{strings.licenceAskLead}</p>
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
                aria-label={choiceName(id)}
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
            icon="share"
            label={strings.licenceAskContinue}
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
