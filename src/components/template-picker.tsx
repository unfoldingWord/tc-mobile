import { useCallback, useState } from "react";

import { Control } from "./control";
import { Icon } from "./icon";
import { Menu } from "./menu";
import { Notice } from "./notice";
import { strings } from "./strings";
import {
  useTemplateLibrary,
  type ObsStoryRow,
  type UseTemplateLibrary,
} from "@/hooks/use-template-library";
import { obsTemplate, thumbUrl } from "@/lib/obs/catalog";
import {
  bibleBookTemplate,
  listScriptureBooks,
  type ScriptureBook,
} from "@/lib/scripture/books";
import type { ChapterId } from "@/types/domain";

// Pure and static — computed once at module load, not per render or per open.
const BIBLE_BOOKS: readonly ScriptureBook[] = listScriptureBooks();

type Step = "categories" | "obs" | "bible";

interface TemplatePickerProps {
  open: boolean;
  onClose: () => void;
  /** A book was created; hand its first chapter to App for navigation. */
  onCreated: (chapterId: ChapterId) => void;
}

/**
 * The Template Library picker (#246, B7's #33 UI half): a second `Menu`
 * panel, entered from the global menu's "Template library" row. Reuses the
 * same surface (scrim, focus trap, Escape) rather than a new dialog — only
 * its `children` and `title` change per step.
 *
 * Three steps, held as local UI state (never on disk): `categories` (the two
 * templates), then `obs` (a preview list of the 50 stories, one "Create Open
 * Bible Stories" action for the whole set — `obsTemplate()` builds one Book
 * with all 50 chapters, not one per story) or `bible` (66 independently
 * creatable rows, one per book). The step resets to `categories` when the
 * picker closes, so reopening it never strands a translator on the last
 * screen they saw.
 */
export function TemplatePicker({
  open,
  onClose,
  onCreated,
}: TemplatePickerProps) {
  const [step, setStep] = useState<Step>("categories");
  // One instance of the hook for the whole picker — its `creatingIds` /
  // `failedIds` sets and `create` function are shared by both steps, not
  // re-created per step (which would give each its own, disconnected state).
  const {
    obsStories,
    obsLoadFailed,
    loadObsStories,
    creatingIds,
    failedIds,
    create,
  } = useTemplateLibrary();

  const onOpenObs = useCallback(() => {
    setStep("obs");
    loadObsStories();
  }, [loadObsStories]);

  const onBackToCategories = useCallback(() => setStep("categories"), []);

  const onCloseAll = useCallback(() => {
    onClose();
    setStep("categories");
  }, [onClose]);

  const title =
    step === "obs"
      ? strings.templateObs
      : step === "bible"
        ? strings.templateBible
        : strings.templateLibrary;

  return (
    <Menu open={open} onClose={onCloseAll} title={title}>
      {step === "categories" && (
        <CategoryList
          onOpenObs={onOpenObs}
          onOpenBible={() => setStep("bible")}
        />
      )}
      {step === "obs" && (
        <ObsStep
          onBack={onBackToCategories}
          stories={obsStories}
          loadFailed={obsLoadFailed}
          onRetry={() => loadObsStories(true)}
          creatingIds={creatingIds}
          failedIds={failedIds}
          create={create}
          onCreated={onCreated}
        />
      )}
      {step === "bible" && (
        <BibleStep
          onBack={onBackToCategories}
          creatingIds={creatingIds}
          failedIds={failedIds}
          create={create}
          onCreated={onCreated}
        />
      )}
    </Menu>
  );
}

function CategoryList({
  onOpenObs,
  onOpenBible,
}: {
  onOpenObs: () => void;
  onOpenBible: () => void;
}) {
  return (
    <ul className="flex flex-col gap-[4px]">
      <CategoryRow
        icon="templates"
        label={strings.templateObs}
        onClick={onOpenObs}
      />
      <CategoryRow
        icon="templates"
        label={strings.templateBible}
        onClick={onOpenBible}
      />
    </ul>
  );
}

function CategoryRow({
  icon,
  label,
  onClick,
}: {
  icon: "templates";
  label: string;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center gap-[10px] border-0 bg-transparent px-[4px] text-left"
        style={{ minHeight: "var(--c-control-md)" }}
      >
        <span className="flex-none" style={{ color: "var(--s-ink-muted)" }}>
          <Icon name={icon} size={20} />
        </span>
        <span
          className="t-title min-w-0 flex-1 truncate"
          style={{ color: "var(--s-ink)" }}
        >
          {label}
        </span>
        <span className="flex-none" style={{ color: "var(--s-ink-muted)" }}>
          <Icon name="chevron-right" size={18} />
        </span>
      </button>
    </li>
  );
}

function BackHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="flex items-center gap-[8px]">
      <Control
        icon="back"
        label={strings.templatePickerBack}
        variant="quiet"
        onClick={onBack}
      />
      <span className="t-title min-w-0 flex-1 truncate">{title}</span>
    </div>
  );
}

interface ObsStepProps {
  onBack: () => void;
  stories: readonly ObsStoryRow[] | null;
  loadFailed: boolean;
  onRetry: () => void;
  creatingIds: ReadonlySet<string>;
  failedIds: ReadonlySet<string>;
  create: UseTemplateLibrary["create"];
  onCreated: (chapterId: ChapterId) => void;
}

const OBS_TEMPLATE_ID = "obs";

function ObsStep({
  onBack,
  stories,
  loadFailed,
  onRetry,
  creatingIds,
  failedIds,
  create,
  onCreated,
}: ObsStepProps) {
  const busy = creatingIds.has(OBS_TEMPLATE_ID);
  const failed = failedIds.has(OBS_TEMPLATE_ID);

  const onCreate = useCallback(() => {
    void create(OBS_TEMPLATE_ID, obsTemplate).then((result) => {
      if (result) onCreated(result.firstChapterId);
    });
  }, [create, onCreated]);

  return (
    <>
      <BackHeader title={strings.templateObs} onBack={onBack} />

      {stories === null && !loadFailed && (
        <Notice tone="busy">{strings.templateObsLoading}</Notice>
      )}
      {loadFailed && (
        <Notice>
          <span className="min-w-0 flex-1">
            {strings.templateObsLoadFailed}
          </span>
          <Control
            icon="retry"
            label={strings.tryAgain}
            variant="quiet"
            size={20}
            onClick={onRetry}
          />
        </Notice>
      )}

      {stories !== null && (
        <>
          <Control
            icon="plus"
            label={
              busy
                ? strings.templateCreating(strings.templateObs)
                : strings.templateCreate(strings.templateObs)
            }
            variant="primary"
            busy={busy}
            onClick={onCreate}
          />
          {failed && <Notice>{strings.templateCreateFailed}</Notice>}

          <ul className="flex flex-col gap-[2px] overflow-y-auto">
            {stories.map((s) => (
              <li
                key={s.story}
                className="flex items-center gap-[8px] px-[4px] py-[4px]"
              >
                <img
                  src={thumbUrl(s.story, 1)}
                  alt=""
                  width={40}
                  height={40}
                  style={{
                    borderRadius: 6,
                    objectFit: "cover",
                    flexShrink: 0,
                  }}
                />
                <span
                  className="min-w-0 flex-1 truncate text-[13px]"
                  style={{ color: "var(--s-ink)" }}
                >
                  {strings.obsStoryRow(s.story, s.title)}
                </span>
                <span className="t-count flex-none">
                  {strings.obsFrameCount(s.frameCount)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

interface BibleStepProps {
  onBack: () => void;
  creatingIds: ReadonlySet<string>;
  failedIds: ReadonlySet<string>;
  create: UseTemplateLibrary["create"];
  onCreated: (chapterId: ChapterId) => void;
}

function BibleStep({
  onBack,
  creatingIds,
  failedIds,
  create,
  onCreated,
}: BibleStepProps) {
  const onCreateBook = useCallback(
    (code: string) => {
      const id = `bible:${code}`;
      void create(id, () => bibleBookTemplate(code)).then((result) => {
        if (result) onCreated(result.firstChapterId);
      });
    },
    [create, onCreated]
  );

  return (
    <>
      <BackHeader title={strings.templateBible} onBack={onBack} />
      <ul className="flex flex-col gap-[2px] overflow-y-auto">
        {BIBLE_BOOKS.map((book) => (
          <BibleBookRow
            key={book.code}
            book={book}
            busy={creatingIds.has(`bible:${book.code}`)}
            failed={failedIds.has(`bible:${book.code}`)}
            onCreate={() => onCreateBook(book.code)}
          />
        ))}
      </ul>
    </>
  );
}

function BibleBookRow({
  book,
  busy,
  failed,
  onCreate,
}: {
  book: ScriptureBook;
  busy: boolean;
  failed: boolean;
  onCreate: () => void;
}) {
  const label = strings.scriptureBookRow(book.code, book.name);
  // Same shape as `Control`'s own name-building (busy/hint appended to the
  // label), hand-rolled here because this row needs VISIBLE text — the
  // book's name IS the non-reader's handle, unlike a `Control`'s bare glyph —
  // so it cannot be built from that icon-only component.
  const accessibleLabel = busy
    ? `${label}. ${strings.templateCreating(book.name)}`
    : failed
      ? `${label}. ${strings.templateCreateFailed}`
      : label;
  return (
    <li>
      <button
        type="button"
        onClick={onCreate}
        // `aria-busy`, not native `disabled`: a native disable during the
        // brief write would strand a keyboard/switch user's focus on this row
        // (Menu's `Control`, `hint` docblock states the same reasoning). A
        // second tap on THIS row while busy is blocked by the hook's
        // `creatingRef` guard, not by disabling the button.
        aria-busy={busy || undefined}
        aria-label={accessibleLabel}
        className="flex w-full items-center gap-[8px] border-0 bg-transparent px-[4px] text-left"
        style={{ minHeight: "var(--c-control-md)" }}
      >
        <span
          className="min-w-0 flex-1 truncate text-[13px]"
          style={{ color: failed ? "var(--s-live)" : "var(--s-ink)" }}
        >
          {label}
        </span>
        {busy && (
          <span className="t-count flex-none">
            {strings.templateCreatingShort}
          </span>
        )}
        {failed && !busy && (
          <span className="flex-none" style={{ color: "var(--s-live)" }}>
            <Icon name="alert" size={16} />
          </span>
        )}
      </button>
    </li>
  );
}
