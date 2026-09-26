import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";

import {
  autoScrollStep,
  createReorderGesture,
  type ReorderGesture,
} from "@/lib/view/reorder-gesture";

/** What the list paints while a row is lifted. `null` when nothing is. */
interface ReorderDrag {
  readonly fromIndex: number;
  /** Where the lifted row would land if released now. */
  readonly toIndex: number;
  /** How far the lifted row has moved from its own slot, in px. */
  readonly offset: number;
  /** One slot: the lifted row's height plus the gap below it, in px. */
  readonly pitch: number;
}

export interface SegmentReorderOptions<Id> {
  /** Off means a press does nothing and a gesture in progress is cancelled. */
  readonly enabled: boolean;
  /** The rows in the order the screen shows them. */
  readonly ids: readonly Id[];
  /** Each row's element, for measuring at the lift. */
  readonly nodeFor: (id: Id) => HTMLElement | null;
  /** The list's scrolling container. */
  readonly scrollRef: RefObject<HTMLElement | null>;
  /** A row was lifted (for the announcement and the haptic). */
  readonly onLift: (index: number) => void;
  /** The one write: row `id` was released at `toIndex`. */
  readonly onDrop: (id: Id, fromIndex: number, toIndex: number) => void;
  /** A LIFTED row was put back without a write. */
  readonly onCancel: (index: number) => void;
}

export interface SegmentReorder {
  readonly drag: ReorderDrag | null;
  /** The `onPointerDown` for row `index`'s hold area (badge and title). */
  readonly holdStart: (index: number) => (e: ReactPointerEvent) => void;
}

/** How long a lifted row's release keeps its own click from landing. */
const CLICK_GUARD_MS = 600;
/** The design reference's haptic on lift (§4). */
const LIFT_HAPTIC_MS = 15;

/**
 * The DOM half of press-and-hold reorder on the Segments list (#953 PR2a).
 *
 * `lib/view/reorder-gesture.ts` decides — the hold, the slop, the target, the
 * single drop — and is tested in Node. This hook only feeds it: it turns
 * pointer positions into the list's content coordinates, measures the rows
 * when the hold completes, auto-scrolls near an edge, and turns the result
 * into React state the list paints as transforms. Nothing here writes;
 * `onDrop` is the caller's one write, and it fires only on a release at a new
 * index.
 *
 * Cancelled, with no write, by: a release before the hold (a plain tap — its
 * click still lands, so the badge still opens the recorder), 8px of movement
 * before the hold, a scroll before the lift, `pointercancel`, Escape, the
 * page being hidden or losing focus, the list changing under the finger,
 * `enabled` going false, and unmounting (leaving the screen).
 *
 * Browser behaviour this relies on and that no test here can observe (jsdom
 * has no scrolling, no touch panning and no layout): once a row is lifted, a
 * non-passive `touchmove` listener's `preventDefault()` is what stops the
 * finger scrolling the page instead of dragging; before the lift a vertical
 * move either crosses the 8px slop or the browser takes it as a pan and sends
 * `pointercancel`, and both cancel. `contextmenu` is refused while a press is
 * in progress, for a long press on Android.
 */
export function useSegmentReorder<Id>(
  options: SegmentReorderOptions<Id>
): SegmentReorder {
  const [drag, setDrag] = useState<ReorderDrag | null>(null);

  // Latest options, read by listeners and the gesture's callbacks, which
  // outlive any one render. Written in the layout phase, like
  // `segment-row.tsx`'s own latest-refs.
  const opts = useRef(options);
  useLayoutEffect(() => {
    opts.current = options;
  });

  const gesture = useRef<ReorderGesture | null>(null);
  const detach = useRef<(() => void) | null>(null);
  const frame = useRef<number | null>(null);
  const lastClient = useRef({ x: 0, y: 0 });
  const handle = useRef<Element | null>(null);
  const alive = useRef(true);
  const startIndex = useRef(0);
  /** The furthest the auto-scroll may go, measured at the lift. */
  const scrollMax = useRef(0);

  /** The pointer's position in the scrolled content, from the viewport's. */
  const contentY = useCallback((clientY: number): number => {
    const el = opts.current.scrollRef.current;
    if (!el) return clientY;
    return clientY - el.getBoundingClientRect().top + el.scrollTop;
  }, []);

  const stopScrolling = useCallback(() => {
    if (frame.current !== null) window.cancelAnimationFrame(frame.current);
    frame.current = null;
  }, []);

  const release = useCallback(() => {
    stopScrolling();
    detach.current?.();
    detach.current = null;
  }, [stopScrolling]);

  /**
   * A lifted row's release lands on its hold area, which is the badge's open
   * button: its click would open the recorder. Swallow that one click, and
   * only on that element, so a quick tap elsewhere right after a drop still
   * lands.
   */
  const guardClick = useCallback(() => {
    const target = handle.current;
    if (!target) return;
    const onClick = (e: MouseEvent) => {
      if (e.target instanceof Node && target.contains(e.target)) {
        e.preventDefault();
        e.stopPropagation();
      }
      done();
    };
    const timer = window.setTimeout(() => done(), CLICK_GUARD_MS);
    const done = () => {
      window.clearTimeout(timer);
      window.removeEventListener("click", onClick, true);
    };
    window.addEventListener("click", onClick, true);
  }, []);

  // Built on the first press, in the event handler rather than during render
  // (`react-hooks/refs`): its callbacks read the latest options through
  // `opts`, so one instance serves the hook's whole life.
  const buildGesture = useCallback((): ReorderGesture => {
    // The auto-scroll near an edge, one frame at a time while a row is
    // lifted. A scroll it makes arrives as a `scroll` event, which re-reads
    // the pointer's content position (see `onScroll` below).
    const scrollFrame = () => {
      frame.current = null;
      const el = opts.current.scrollRef.current;
      if (!el || gesture.current?.phase() !== "lifted") return;
      const rect = el.getBoundingClientRect();
      const step = autoScrollStep(lastClient.current.y, rect.top, rect.bottom);
      // Bounded by the list's extent measured at the lift, before any
      // transform: the lifted row's own translateY adds overflow, and
      // scrolling into it would grow it again without end (Frank round 1 on
      // #1057).
      const next = Math.min(
        scrollMax.current,
        Math.max(0, el.scrollTop + step)
      );
      if (next !== el.scrollTop) el.scrollTop = next;
      frame.current = window.requestAnimationFrame(scrollFrame);
    };
    return createReorderGesture({
      lift: (index) => {
        const { ids, nodeFor, scrollRef } = opts.current;
        const el = scrollRef.current;
        if (!el || ids.length < 2) return null;
        const nodes = ids.map((id) => nodeFor(id));
        if (nodes.some((n) => n === null)) return null;
        const top = el.getBoundingClientRect().top - el.scrollTop;
        scrollMax.current = Math.max(0, el.scrollHeight - el.clientHeight);
        const rects = nodes.map((n) => n!.getBoundingClientRect());
        const midpoints = rects.map((r) => r.top - top + r.height / 2);
        const own = rects[index]!;
        const next = rects[index + 1] ?? rects[index - 1]!;
        const gap =
          index + 1 < rects.length
            ? next.top - own.bottom
            : own.top - next.bottom;
        setDrag({
          fromIndex: index,
          toIndex: index,
          offset: 0,
          pitch: own.height + Math.max(0, gap),
        });
        // The design reference's 15 ms haptic on lift. Absent on iOS Safari
        // (no Vibration API), and a refusal there is not a failure worth a
        // report: the lift itself is the signal.
        try {
          navigator.vibrate?.(LIFT_HAPTIC_MS);
        } catch {
          // Deliberately empty: see the comment above.
        }
        opts.current.onLift(index);
        frame.current = window.requestAnimationFrame(scrollFrame);
        return midpoints;
      },
      drag: ({ fromIndex, toIndex, offset }) => {
        setDrag((d) => (d ? { ...d, fromIndex, toIndex, offset } : d));
      },
      drop: (fromIndex, toIndex) => {
        release();
        setDrag(null);
        if (!alive.current) return;
        guardClick();
        const id = opts.current.ids[fromIndex];
        if (id !== undefined) opts.current.onDrop(id, fromIndex, toIndex);
      },
      cancel: (lifted) => {
        release();
        setDrag(null);
        if (!lifted || !alive.current) return;
        guardClick();
        // The index is the drag's own; `drag` is state and may be a render
        // behind, so the caller is handed the index the gesture started at.
        opts.current.onCancel(startIndex.current);
      },
    });
  }, [guardClick, release]);

  const holdStart = useCallback(
    (index: number) => (e: ReactPointerEvent) => {
      if (!opts.current.enabled || opts.current.ids.length < 2) return;
      const g = (gesture.current ??= buildGesture());
      if (!e.isPrimary || e.button !== 0 || g.phase() !== "idle") return;
      const pointerId = e.pointerId;
      handle.current = e.currentTarget;
      startIndex.current = index;
      lastClient.current = { x: e.clientX, y: e.clientY };
      g.down(pointerId, index, e.clientX, contentY(e.clientY));

      const onMove = (ev: PointerEvent) => {
        // Another pointer's position must not reach `lastClient`: the
        // auto-scroll and `onScroll` read it as this pointer's (Frank round 1
        // on #1057: a second finger moved the drop target).
        if (ev.pointerId !== pointerId) return;
        lastClient.current = { x: ev.clientX, y: ev.clientY };
        g.move(ev.pointerId, ev.clientX, contentY(ev.clientY));
      };
      const onUp = (ev: PointerEvent) => g.up(ev.pointerId);
      const onCancel = () => g.cancel();
      // Non-passive, and only ever preventing once a row is lifted: before
      // that a vertical move must stay a scroll (which cancels the hold).
      const onTouchMove = (ev: TouchEvent) => {
        if (g.phase() === "lifted" && ev.cancelable) ev.preventDefault();
      };
      const onContextMenu = (ev: Event) => {
        if (g.phase() !== "idle") ev.preventDefault();
      };
      const onScroll = () => {
        g.scrolled();
        // A lifted row stays under the finger while the list scrolls under
        // it: the same client position is a new content position.
        if (g.phase() === "lifted") {
          const { x, y } = lastClient.current;
          g.move(pointerId, x, contentY(y));
        }
      };
      const onKey = (ev: KeyboardEvent) => {
        if (ev.key === "Escape") g.cancel();
      };
      const onHidden = () => {
        if (document.visibilityState === "hidden") g.cancel();
      };
      const scroller = opts.current.scrollRef.current;
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      window.addEventListener("touchmove", onTouchMove, { passive: false });
      window.addEventListener("contextmenu", onContextMenu);
      window.addEventListener("keydown", onKey);
      window.addEventListener("blur", onCancel);
      document.addEventListener("visibilitychange", onHidden);
      scroller?.addEventListener("scroll", onScroll);
      detach.current?.();
      detach.current = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        window.removeEventListener("touchmove", onTouchMove);
        window.removeEventListener("contextmenu", onContextMenu);
        window.removeEventListener("keydown", onKey);
        window.removeEventListener("blur", onCancel);
        document.removeEventListener("visibilitychange", onHidden);
        scroller?.removeEventListener("scroll", onScroll);
      };
    },
    [buildGesture, contentY]
  );

  // The list changed under the finger (a reload landed, a row was added or
  // erased, a previous drop's write settled) or the gesture was switched
  // off: the measured midpoints no longer describe the rows, so let go
  // without a write. A drop's own reorder arrives after the gesture is
  // already idle, where a cancel is a no-op.
  const idsKey = options.ids.join("\u0000");
  useEffect(() => {
    gesture.current?.cancel();
  }, [idsKey, options.enabled]);

  // Leaving the screen: no write, no callback into a screen that is gone.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      gesture.current?.cancel();
      release();
    };
  }, [release]);

  return { drag, holdStart };
}
