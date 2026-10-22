import { useId, useMemo, useState } from "react";

import type { LanguageListState } from "@/hooks/use-language-ask";
import { searchLanguages } from "@/lib/languages/list";
import { strings } from "@/lib/strings";
import { Notice } from "./notice";
import { TileGrid } from "./o4-tile-menu";

/** Rows drawn at once; more matches ask for a longer query instead. */
const SHOWN = 50;

/**
 * The language ask (#1492): a search over the bundled list (ADR 0017) in the
 * book sheet's tile grid, as the cover picker is. A row tap is the answer; a
 * row is named by English name and tag; Up and Down move between the field
 * and the rows. Presentational: everything else arrives by prop.
 */
export function LanguageAsk(props: {
  state: LanguageListState;
  onRetry: () => void;
  onPick: (tag: string) => void;
  onCancel: () => void;
  saving: boolean;
  error: string | null;
}) {
  const { state, saving, error } = props;
  const [query, setQuery] = useState("");
  const listId = useId();
  const found = useMemo(
    () =>
      state.kind === "ready" ? searchLanguages(state.list, query, SHOWN) : null,
    [state, query]
  );
  const onArrow = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    if (step === 0) return;
    const stops = Array.from(
      e.currentTarget.querySelectorAll<HTMLElement>("input, .language-row")
    );
    const next = stops[stops.indexOf(e.target as HTMLElement) + step];
    if (!next) return;
    e.preventDefault();
    next.focus();
  };

  return (
    <TileGrid>
      <div className="language-ask" onKeyDown={onArrow}>
        <h3 className="language-ask-title">{strings.languageAskTitle}</h3>
        <p className="language-ask-lead">{strings.languageAskLead}</p>
        <input
          type="search"
          className="name-input language-search"
          aria-label={strings.languageSearch}
          aria-controls={listId}
          placeholder={strings.languageSearchHint}
          value={query}
          autoFocus
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
        />
        {state.kind === "loading" && (
          <Notice tone="busy">{strings.languageLoading}</Notice>
        )}
        {state.kind === "failed" && (
          <>
            <Notice>{strings.languageLoadFailed}</Notice>
            <button
              type="button"
              className="language-ask-quiet"
              onClick={props.onRetry}
            >
              {strings.tryAgain}
            </button>
          </>
        )}
        <ul id={listId} className="language-list">
          {found?.matches.map((entry) => (
            <li key={entry.tag}>
              <button
                type="button"
                className="language-row"
                aria-label={strings.languageRow(entry.name, entry.tag)}
                aria-disabled={saving || undefined}
                onClick={() => !saving && props.onPick(entry.tag)}
              >
                <span className="language-row-name">{entry.name}</span>
                {entry.autonym && (
                  <span lang={entry.tag} dir="auto">
                    {entry.autonym}
                  </span>
                )}
                <span className="language-row-tag">{entry.tag}</span>
              </button>
            </li>
          ))}
        </ul>
        {found?.total === 0 && <Notice>{strings.languageNoMatch}</Notice>}
        {found && found.total > found.matches.length && (
          <p className="language-ask-lead">{strings.languageNarrow}</p>
        )}
        {saving && <Notice tone="busy">{strings.languageSaving}</Notice>}
        {error && <Notice>{error}</Notice>}
        <button
          type="button"
          className="language-ask-quiet"
          onClick={props.onCancel}
        >
          {strings.languageAskCancel}
        </button>
      </div>
    </TileGrid>
  );
}
