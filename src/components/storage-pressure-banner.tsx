import { useLayoutEffect, useRef } from "react";

import { Control } from "./control";
import { shareControlAffordance } from "./control-affordance";
import { Icon } from "./icon";
import { Notice } from "./notice";
import { noticePresentation } from "./notice-tone";
import { libraryShareErrorText, libraryShareGapText } from "./share-error-copy";
import { shareErrorGlyph, shareOutcomeGlyph } from "./share-outcome-glyph";
import type { StoragePressureNotice } from "./storage-pressure-notice";
import { strings } from "@/lib/strings";
import { shareOverlayOwnsScreen } from "@/hooks/share-progress";
import { readSharePlatform } from "@/hooks/share-target";
import { useFocusRestore } from "@/hooks/use-focus-restore";
import type { UseLibraryShare } from "@/hooks/use-library-share";

interface StoragePressureBannerProps {
  /** `storagePressureNotice()`'s line — whether it shows at all is decided there. */
  notice: StoragePressureNotice;
  /** Draw state 17 of the O4 workbench (#983) rather than the #247 Notice. */
  o4: boolean;
  /**
   * The Books screen's `useLibraryShare()` (#1045). The screen owns the flow,
   * not this banner, because the screen is what renders the share overlay
   * for it and makes the shelf inert while that overlay owns the screen —
   * both in the same render the timeline changes in. The current look reads
   * none of it.
   */
  share: UseLibraryShare;
}

/**
 * The Books shelf's storage-pressure line (#247), in either look.
 *
 * With the switch off it is exactly the `<Notice>` the shelf always rendered.
 * With it on it is the workbench's state 17: a warn-washed banner with a
 * phone icon and a "Share your work" button that shares every book at once
 * (#948's D14 — the library share #987 built, not the problem report's Send).
 *
 * The share's busy and outcome timeline is not drawn here: the Books screen
 * renders it as the same full-screen `<ShareProgress>` Share Book uses, with
 * the `"library"` scope (#1045).
 */
export function StoragePressureBanner({
  notice,
  o4,
  share,
}: StoragePressureBannerProps) {
  if (!o4) return <Notice tone={notice.tone}>{notice.text}</Notice>;
  return <O4StorageBanner notice={notice} share={share} />;
}

function O4StorageBanner({
  notice,
  share,
}: {
  notice: StoragePressureNotice;
  share: UseLibraryShare;
}) {
  // The overlay takes focus while it owns the screen and the shelf this
  // banner sits in goes inert, so the tapped control loses focus. Capture it
  // in the tap itself and hand it back once the shelf's `inert` has lifted,
  // the same #96/#97 contract Share Book keeps (`books-screen.tsx`).
  const focusRestore = useFocusRestore();
  const shareControlRef = useRef<HTMLButtonElement | null>(null);
  const ownsScreen = shareOverlayOwnsScreen(share.progress);
  useLayoutEffect(() => {
    if (ownsScreen) return;
    focusRestore.restore({
      suppressed: false,
      fallback: shareControlRef.current,
    });
  }, [ownsScreen, focusRestore]);

  // The Notice's role, on the words only: the band still decides how urgently
  // a screen reader hears it, and the button is not part of that announcement.
  const { role } = noticePresentation(notice.tone);
  const affordance = shareControlAffordance(
    share.status,
    readSharePlatform(),
    share.sendUnconfirmed
  );
  const errorText = libraryShareErrorText(share.error);
  // A space refusal is a failure like any other to the glyph table; only its
  // words differ.
  const errorMark = shareErrorGlyph(
    share.error === "storage" ? "failed" : share.error
  );
  const gapText =
    share.status === "ready"
      ? libraryShareGapText(share.missing, share.incompleteChapters)
      : null;
  const partial = shareOutcomeGlyph("partial");

  const onPrepare = () => {
    focusRestore.capture();
    void share.prepare(
      strings.shareAllFilename,
      strings.shareAllFolder,
      strings.shareFilename
    );
  };
  const onSend = () => {
    focusRestore.capture();
    void share.send();
  };

  return (
    <div className="o4-storage" data-tone={notice.tone}>
      <div className="o4-storage-row">
        <span className="o4-storage-icon" aria-hidden="true">
          <Icon name="phone" size={34} />
        </span>
        <span className="o4-storage-words" role={role}>
          <span className="o4-storage-title">{strings.storageShareSoon}</span>
          <span className="o4-storage-why">{notice.text}</span>
        </span>
        {/* The same two gestures as the ≡ menus' Share (ShareMenuSection):
            tap 1 builds the archive, tap 2 hands it to the sheet in a fresh
            activation. `busy`, never `disabled`, while preparing, so the
            control keeps focus. */}
        {share.status === "ready" ? (
          <Control
            ref={shareControlRef}
            icon={affordance.icon}
            label={strings.shareSend}
            size={34}
            className={
              affordance.className
                ? `o4-storage-share ${affordance.className}`
                : "o4-storage-share"
            }
            autoFocus
            onClick={onSend}
          />
        ) : (
          <Control
            ref={shareControlRef}
            icon={affordance.icon}
            label={
              share.status === "preparing"
                ? strings.shareAllPreparing
                : share.sendUnconfirmed
                  ? strings.shareAllUnconfirmed
                  : strings.shareAll
            }
            size={34}
            className="o4-storage-share"
            busy={affordance.busy}
            onClick={onPrepare}
          />
        )}
      </div>
      {gapText && (
        <Notice tone={partial.tone} icon={partial.icon}>
          {gapText}
        </Notice>
      )}
      {errorText && (
        <Notice tone={errorMark?.tone} icon={errorMark?.icon}>
          {errorText}
        </Notice>
      )}
    </div>
  );
}
