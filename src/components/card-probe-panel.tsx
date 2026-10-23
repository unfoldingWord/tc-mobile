import { useState } from "react";

import {
  cardFull,
  cardProbe,
  cardProbeAvailable,
  filesystemFullPath,
  idbBaseline,
  readBack,
  runStep,
  writeSpeed,
} from "@/hooks/card-probe";

const BUTTON =
  "rounded-full bg-raised px-4 py-2 text-ink disabled:opacity-50 min-h-11";

/** What one tap may hand to a later tap: the last written file and the picked folder. */
interface Memory {
  lastPath: string;
  tree: string;
}

const p = cardProbe.probe;

async function leaveOpen() {
  const dir = await cardProbe.cardDir();
  await p.writeStart({ dir, name: "killed.bin" });
  await p.writeChunk({ data: "AAAA" });
  return { openedAt: dir, note: "force stop now, then tap P4 list" };
}

const remembered =
  (m: Memory, minutes: number) => async (): Promise<unknown> => {
    const result = await writeSpeed(minutes);
    m.lastPath = result.path;
    return result;
  };

const STEPS: [string, (m: Memory) => () => Promise<unknown>][] = [
  ["P1 volumes", () => () => p.volumes()],
  ["P2 write 2 min", (m) => remembered(m, 2)],
  ["P2 write 10 min", (m) => remembered(m, 10)],
  ["P2 write 20 min", (m) => remembered(m, 20)],
  ["P2 IndexedDB 20 min", () => () => idbBaseline(20)],
  ["P3 read back last write", (m) => () => readBack(m.lastPath)],
  ["P4 list card folder", () => () => cardProbe.list()],
  ["P4 write 20 min then leave open", () => () => leaveOpen()],
  ["P5 write 20 min for pulling card", () => () => writeSpeed(20)],
  ["P6 fill card leaving 20 MB", () => () => cardFull(20)],
  ["P6 write 2 min on full card", () => () => writeSpeed(2)],
  [
    "P6 remove filler",
    () => async () =>
      p.remove({ path: `${await cardProbe.cardDir()}/filler.bin` }),
  ],
  [
    "P8 pick folder",
    (m) => async () => {
      const picked = await p.pickTree();
      m.tree = picked.uri;
      return picked;
    },
  ],
  ["P8 grants", () => () => p.grants()],
  [
    "P8 write 50 MB",
    (m) => () =>
      p.treeWrite({ uri: m.tree, name: "tc-probe.bin", bytes: 50e6 }),
  ],
  [
    "P8 overwrite with 1 MB",
    (m) => () => p.treeWrite({ uri: m.tree, name: "tc-probe.bin", bytes: 1e6 }),
  ],
  ["P9 events", () => () => p.events()],
  ["P11 filesystem plugin full path", () => () => filesystemFullPath()],
];

/**
 * THROWAWAY (#1472, `spike/card-store` only, never merged): the microSD spike
 * buttons, shown at the foot of the phone check on a native Android build and
 * nowhere else. Each tap appends one line; the tester copies the lines into
 * `docs/native/card-spike-sheet.md`. Plain labels on purpose: this is a
 * tester's tool, not product copy.
 */
export function CardProbePanel() {
  const [lines, setLines] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [memory] = useState<Memory>({ lastPath: "", tree: "" });
  if (!cardProbeAvailable()) return null;

  const run = async (label: string, step: () => Promise<unknown>) => {
    setBusy(true);
    const line = await runStep(label, step);
    setLines((prev) => [...prev, line]);
    setBusy(false);
  };

  return (
    <div
      className="border-edge flex flex-col gap-2 rounded-2xl border p-3"
      data-card-probe="panel"
    >
      <h2 className="text-ink">Card spike 1472</h2>
      {STEPS.map(([label, make]) => (
        <button
          key={label}
          type="button"
          className={BUTTON}
          disabled={busy}
          onClick={() => void run(label, make(memory))}
        >
          {label}
        </button>
      ))}
      <textarea
        readOnly
        value={lines.join("\n")}
        rows={14}
        className="border-edge bg-surface text-ink w-full rounded-xl border p-2 font-mono text-[12px]"
        data-card-probe="log"
      />
    </div>
  );
}
