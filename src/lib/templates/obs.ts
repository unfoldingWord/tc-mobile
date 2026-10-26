import type { ObsCatalog } from "@/types/obs";
import type {
  TemplatePackage,
  TemplateSegment,
  TemplateTitleTable,
} from "@/types/template";
import { loadObsCatalog, OBS_BOOK_CODE, thumbUrl } from "@/lib/obs/catalog";
import { parseTemplatePackage, parseTemplateTitleTable } from "./validate";

/**
 * Open Bible Stories as a template package (#1466): the first source
 * described in the one package shape (#1465), so a picker reads the stories
 * the way it will read any other package.
 *
 * Everything OBS-specific lives here — the id, the kind, the book code, the
 * key format, the source revision — and nowhere in the validator or the
 * types, which stay source-agnostic (#1451; `tests/template-validate.test.ts`
 * holds them to that). The package goes through `parseTemplatePackage` like
 * any other, so the adapter cannot hand the app a shape the contract refuses.
 *
 * A runtime adapter over the committed catalogue, not a re-bake:
 * `scripts/build-obs-catalog.mjs` fetches from the network, and re-running it
 * against a moved branch could change the content.
 *
 * Mapping: a story is a chapter (key "01"–"50", number = story number); a
 * frame is a segment (key "01-07") whose span is that one frame, as
 * chapter:verse = story:frame. Not mapped in v0: the English "Genesis 1-2"
 * reference strings, the frame text and the CDN image URLs (no reader, and
 * ADR 0006 rules out a full-size image cache). Frames have no titles, so the
 * segment title table is empty.
 */

const ID = "obs";
const VERSION = "0.1.0";
const LANGUAGE = "en";

/**
 * The `en_obs` commit the committed catalogue was built from: the last
 * commit touching `content/` before the catalogue was generated. Re-running
 * the build script at this ref reproduces `src/data/obs-catalog.json`
 * byte for byte (#1466's scope comment records the check).
 */
const REVISION = "75236873a3ac8203117df9e9f781614e62a0a3ec";

const pad = (n: number) => String(n).padStart(2, "0");

function toPackage(catalog: ObsCatalog): TemplatePackage {
  return {
    format: "tc-mobile-template",
    formatVersion: 0,
    id: ID,
    version: VERSION,
    kind: ID,
    bookCode: OBS_BOOK_CODE,
    title: { [LANGUAGE]: "Open Bible Stories" },
    titleLanguages: [LANGUAGE],
    dataLicence: "CC-BY-SA-4.0",
    // Binds the recordings a translator makes from this package, not only the
    // package: a recorded translation of a story is a derivative work and is
    // CC BY-SA. Settled in #15 (closed) and recorded in
    // docs/decisions/0006-obs-content.md; D5 locks it for every template.
    recordingLicence: "CC-BY-SA-4.0",
    attribution: catalog.attribution,
    source: { url: catalog.source, revision: REVISION },
    chapters: catalog.stories.map((story) => ({
      key: pad(story.story),
      number: story.story,
      segments: story.frames.map((f): TemplateSegment => ({
        key: `${pad(story.story)}-${pad(f.frame)}`,
        reference: {
          book: OBS_BOOK_CODE,
          startChapter: story.story,
          startVerse: f.frame,
          endChapter: story.story,
          endVerse: f.frame,
        },
        // A package asset path is relative; `thumbUrl` is root-relative.
        // Nothing resolves it yet (the validator checks its form only), so a
        // screen must resolve it against the app's base, not the current
        // route, or it will miss the precached `/obs/thumbs/` file (#246).
        thumbnail: thumbUrl(story.story, f.frame).replace(/^\//, ""),
      })),
    })),
  };
}

function toTitleTable(catalog: ObsCatalog): TemplateTitleTable {
  return {
    packageId: ID,
    version: VERSION,
    language: LANGUAGE,
    chapters: Object.fromEntries(
      catalog.stories.map((s) => [pad(s.story), s.title])
    ),
    segments: {},
  };
}

interface ObsTemplate {
  readonly pkg: TemplatePackage;
  readonly titles: readonly TemplateTitleTable[];
}

let loading: Promise<ObsTemplate> | null = null;

async function build(): Promise<ObsTemplate> {
  const catalog = await loadObsCatalog();
  const pkg = parseTemplatePackage(toPackage(catalog));
  return { pkg, titles: [parseTemplateTitleTable(toTitleTable(catalog), pkg)] };
}

/**
 * The bundled stories as a validated package and its title tables (English
 * only today), built once and shared. Rejects with `TemplateValidationError`
 * if the adapted package breaks the contract; the caller routes that to the
 * failure log. A rejection is not kept, so a later call tries again (a lazy
 * chunk that failed to load offline can load once the network is back).
 *
 * @pivotpending No caller yet. #246 (Template Library, UI half) reads this to
 * list the stories and seed a book's segments, and restores `jpg` to the
 * precache when it does (`tests/precache-manifest.test.ts` counts an import of
 * this function as the thumbnail reader).
 */
export function loadObsTemplate(): Promise<ObsTemplate> {
  loading ??= build().catch((cause: unknown) => {
    loading = null;
    throw cause;
  });
  return loading;
}
