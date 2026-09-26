import { describe, expect, it } from "vitest";

import {
  HIDDEN,
  MIN_BUSY_MS,
  carryFromPrepare,
  reduceShareProgress,
  type ShareProgress,
} from "@/hooks/share-progress";

/**
 * The prepare's per-item result, carried into the send (#1023, the Frank and
 * George blocker at `share-o4-view.ts`'s hand-off): a send begins from
 * `hidden` once the prepare's busy phase has ended, so the prepare's `steps`
 * are gone by then. `carryFromPrepare` snapshots them while the prepare is
 * still up, and a `carry` event puts the snapshot on the send's busy state,
 * from where a settle takes it onto the outcome. Additive: a send with no
 * carry is exactly the state it always was.
 */

type Busy = Extract<ShareProgress, { phase: "busy" }>;

const prepare = (steps?: Busy["steps"]): Busy =>
  steps === undefined
    ? { phase: "busy", work: "prepare", since: 0, pending: null }
    : { phase: "busy", work: "prepare", since: 0, pending: null, steps };

const send = (): ShareProgress =>
  reduceShareProgress(HIDDEN, { type: "begin", work: "send", now: 0 });

describe("carryFromPrepare", () => {
  it("snapshots which items the prepare finished with no audio", () => {
    expect(
      carryFromPrepare(prepare({ done: 3, total: 3, skipped: 1, hollow: [1] }))
    ).toEqual({ hollow: [1] });
  });

  it("keeps the item count when some of the total is not items (Share Chapter)", () => {
    expect(
      carryFromPrepare(
        prepare({ done: 5, total: 5, items: 3, skipped: 1, hollow: [2] })
      )
    ).toEqual({ items: 3, hollow: [2] });
  });

  it("an empty hollow list when nothing was skipped", () => {
    expect(carryFromPrepare(prepare({ done: 2, total: 2 }))).toEqual({
      hollow: [],
    });
  });

  it("nothing to carry without a count, or from anything but a prepare", () => {
    expect(carryFromPrepare(prepare())).toBeUndefined();
    expect(carryFromPrepare(HIDDEN)).toBeUndefined();
    expect(carryFromPrepare(send())).toBeUndefined();
  });
});

describe("the carry event", () => {
  it("puts the snapshot on a busy send", () => {
    const next = reduceShareProgress(send(), {
      type: "carry",
      carried: { hollow: [1] },
    });
    expect(next).toMatchObject({ phase: "busy", work: "send" });
    expect(next.phase === "busy" && next.carried).toEqual({ hollow: [1] });
  });

  it("is ignored anywhere but a busy send that carries nothing yet", () => {
    const carried = { hollow: [0] };
    const p = prepare({ done: 1, total: 1 });
    expect(reduceShareProgress(p, { type: "carry", carried })).toBe(p);
    expect(reduceShareProgress(HIDDEN, { type: "carry", carried })).toBe(
      HIDDEN
    );
    const once = reduceShareProgress(send(), { type: "carry", carried });
    expect(
      reduceShareProgress(once, { type: "carry", carried: { hollow: [] } })
    ).toBe(once);
  });

  it("rejects a snapshot that is not ascending whole positions", () => {
    const s = send();
    for (const hollow of [[-1], [1.5], [2, 1], [1, 1]])
      expect(
        reduceShareProgress(s, { type: "carry", carried: { hollow } })
      ).toBe(s);
    expect(
      reduceShareProgress(s, {
        type: "carry",
        carried: { items: 0, hollow: [] },
      })
    ).toBe(s);
  });

  it("a send that is never carried stays exactly the state it always was", () => {
    expect("carried" in send()).toBe(false);
  });
});

describe("the settle takes the snapshot onto the outcome", () => {
  const carried = { hollow: [1] };

  it("when the settle lands after the hold", () => {
    const busy = reduceShareProgress(send(), { type: "carry", carried });
    const out = reduceShareProgress(busy, {
      type: "settle",
      settled: "sent",
      now: MIN_BUSY_MS,
    });
    expect(out).toMatchObject({ phase: "outcome", settled: "sent", carried });
  });

  it("when the settle is held and a tick releases it", () => {
    const busy = reduceShareProgress(send(), { type: "carry", carried });
    const held = reduceShareProgress(busy, {
      type: "settle",
      settled: "sent",
      now: 1,
    });
    const out = reduceShareProgress(held, { type: "tick", now: MIN_BUSY_MS });
    expect(out).toMatchObject({ phase: "outcome", settled: "sent", carried });
  });

  it("an outcome from a send with no carry has no carried key", () => {
    const out = reduceShareProgress(send(), {
      type: "settle",
      settled: "sent",
      now: MIN_BUSY_MS,
    });
    expect("carried" in out).toBe(false);
  });
});
