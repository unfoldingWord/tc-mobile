import { useEffect, useId, useMemo, useState } from "react";

import type { LanguageListState } from "@/hooks/use-language-ask";
import { searchLanguages } from "@/lib/languages/list";
import { strings } from "@/lib/strings";
import { Notice } from "./notice";
import { TileGrid } from "./o4-tile-menu";

/** Rows drawn at once; more matches ask for a longer query instead. */
const SHOWN = 50;

/** How long a query holds still before its count is said aloud. */
const SETTLE_MS = 500;

/**
 * The spoken result count (#1344): one polite status line, mounted with the
 * ask so the live region exists before its text changes. Silent for no search
 * (the whole list is not news) and for no match (the visible notice is an
 * alert and already says it). That a screen reader reads it is inference from
 * the markup, not observed.
 */
export function LanguageCountStatus(props: {
  result: { readonly total: number; readonly shown: number } | null;
}) {
  const { result } = props;
  const text =
    !result || result.total === 0
      ? ""
      : result.total > result.shown
        ? strings.languageCountMore(result.total, result.shown)
        : strings.languageCount(result.total);
  return (
    <p className="sr-only" role="status" aria-live="polite">
      {text}
    </p>
  );
}

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
  const [settled, setSettled] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setSettled(query), SETTLE_MS);
    return () => clearTimeout(t);
  }, [query]);
  const listId = useId();
  const found = useMemo(
    () =>
      state.kind === "ready" ? searchLanguages(state.list, query, SHOWN) : null,
    [state, query]
  );
  const spoken = useMemo(
    () =>
      state.kind === "ready" && settled.trim() !== ""
        ? searchLanguages(state.list, settled, SHOWN)
        : null,
    [state, settled]
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
        <LanguageCountStatus
          result={
            spoken
              ? { total: spoken.total, shown: spoken.matches.length }
              : null
          }
        />
        <ul id={listId} className="language-list">
          {found?.matches.map((entry) => (
            <li key={entry.tag}>
              <button
                type="button"
                className="language-row"
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
