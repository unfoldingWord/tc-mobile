import type { BookPlan } from "./plan";
import type { TemplateBookIds } from "@/lib/storage/template-book";
import type { TemplatePackage, TemplateTitleTable } from "@/types/template";
import type { BookId, ChapterId, SegmentId } from "@/types/domain";

/**
 * The Template Library's pure helpers (#246, part of #1450). No DOM and no
 * storage write: the picker (`components/template-picker.tsx`) and its hook
 * (`hooks/use-template-library.ts`) call these.
 */

/**
 * Where a package asset path resolves: against the app's base, never against
 * the page the screen is on. A package path is relative and rootless
 * (`obs/thumbs/obs-01-07.jpg`, the contract's form); handed straight to
 * `img.src` it would resolve against the current route and miss the precached
 * root path. `base` is Vite's `BASE_URL` (`"/"` for this app), given by the
 * caller because `lib/` reads no build environment.
 */
export function resolveAssetUrl(path: string, base: string): string {
  const root = base.endsWith("/") ? base : `${base}/`;
  return `${root}${path.replace(/^\/+/, "")}`;
}

/** An SPDX id the way people write it: `CC-BY-SA-4.0` is `CC BY-SA 4.0`. */
export function licenceTag(id: string): string {
  const m = /^CC-(.+)-(\d[\d.]*)$/.exec(id);
  return m ? `CC ${m[1]} ${m[2]}` : id;
}

/** A package's title in `language`, else in the first language it lists. */
export function templateTitle(
  title: Readonly<Record<string, string>>,
  titleLanguages: readonly string[],
  language: string
): string {
  const first = titleLanguages[0];
  return (
    title[language] ??
    (first === undefined ? undefined : title[first]) ??
    Object.values(title)[0] ??
    ""
  );
}

/** The thumbnail of the first segment that has one, or null. */
export function previewThumbnail(pkg: TemplatePackage): string | null {
  for (const chapter of pkg.chapters) {
    for (const segment of chapter.segments) {
      if (segment.thumbnail !== null) return segment.thumbnail;
    }
  }
  return null;
}

/** Look titles up in one table; a key it lacks has no title. */
export function titleResolverFor(
  table: TemplateTitleTable | undefined
): (kind: "chapter" | "segment", key: string) => string | undefined {
  return (kind, key) =>
    kind === "chapter" ? table?.chapters[key] : table?.segments[key];
}

/** Mint every id for one create, in the plan's shape and order. */
export function mintTemplateIds(plan: BookPlan): TemplateBookIds {
  return {
    book: crypto.randomUUID() as BookId,
    chapters: plan.chapters.map((chapter) => ({
      id: crypto.randomUUID() as ChapterId,
      segments: chapter.segments.map(() => crypto.randomUUID() as SegmentId),
    })),
  };
}
