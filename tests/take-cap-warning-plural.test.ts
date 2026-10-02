import { describe, expect, it, vi } from "vitest";

import { plural } from "@/lib/plural";
import { strings } from "@/lib/strings";

/**
 * The take-length warning's minute count goes through `plural` (#169).
 *
 * `takeCapWarning` is the one count in the table that a translator cannot
 * vary by count without a code change while it is a bare template: "{n} min
 * left" is one form in English, and Russian needs three ("1 минута",
 * "2 минуты", "5 минут"). English still supplies only `other`, so what the
 * recorder shows does not change; the wording cases below pin that.
 *
 * The second half is the one that sees the move. English renders the same
 * sentence either way, so a wording assertion stays green if the entry is
 * put back to a template. The spy is what tells the two apart: it wraps the
 * real `plural`, so every other entry in the table behaves as shipped, and it
 * asserts the call carries this entry's count and a `{n}` form rather than a
 * number spliced in by the caller.
 */
vi.mock("@/lib/plural", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/plural")>();
  return { plural: vi.fn(actual.plural) };
});

describe("takeCapWarning", () => {
  it("reads as the recorder has always shown it, at each minute it can show", () => {
    // The marker counts down from 5 at 15:00 and is clamped at 1
    // (`take-cap-marker.tsx`).
    expect(strings.takeCapWarning(1)).toBe("1 min left");
    expect(strings.takeCapWarning(2)).toBe("2 min left");
    expect(strings.takeCapWarning(5)).toBe("5 min left");
  });

  it("chooses its form through plural, with the count and a {n} form", () => {
    const spy = vi.mocked(plural);
    spy.mockClear();
    strings.takeCapWarning(3);
    expect(spy).toHaveBeenCalledTimes(1);
    const [n, forms] = spy.mock.calls[0]!;
    expect(n).toBe(3);
    expect(forms.other).toContain("{n}");
  });
});
