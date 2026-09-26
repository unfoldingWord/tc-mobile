import { Control } from "./control";
import { shareControlAffordance } from "./control-affordance";
import { Icon } from "./icon";
import { Notice } from "./notice";
import { noticePresentation } from "./notice-tone";
import { shareErrorGlyph, shareOutcomeGlyph } from "./share-outcome-glyph";
import {
  libraryShareErrorText,
  libraryShareGapText,
} from "./storage-banner-copy";
import type { StoragePressureNotice } from "./storage-pressure-notice";
import { strings } from "@/lib/strings";
import { readSharePlatform } from "@/hooks/share-target";
import { useLibraryShare } from "@/hooks/use-library-share";

interface StoragePressureBannerProps {
  /** `storagePressureNotice()`'s line — whether it shows at all is decided there. */
  notice: StoragePressureNotice;
  /** Draw state 17 of the O4 workbench (#983) rather than the #247 Notice. */
  o4: boolean;
}

/**
 * The Books shelf's storage-pressure line (#247), in either look.
 *
 * With the switch off it is exactly the `<Notice>` the shelf always rendered.
 * With it on it is the workbench's state 17: a warn-washed banner with a
 * phone icon and a "Share your work" button that shares every book at once
 * (#948's D14 — the library share #987 built, not the problem report's Send).
 *
 * The share hook lives in the O4 branch's own component, so the current look
 * mounts no share flow at all, and the flow unmounts (and cancels, through
 * `useShareFlow`'s own unmount cleanup) with the banner.
 */
export function StoragePressureBanner({
  notice,
  o4,
}: StoragePressureBannerProps) {
  if (!o4) return <Notice tone={notice.tone}>{notice.text}</Notice>;
  return <O4StorageBanner notice={notice} />;
}

function O4StorageBanner({ notice }: { notice: StoragePressureNotice }) {
  const share = useLibraryShare();
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
    void share.prepare(
      strings.shareAllFilename,
      strings.shareAllFolder,
      strings.shareFilename
    );
  };
  const onSend = () => {
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
