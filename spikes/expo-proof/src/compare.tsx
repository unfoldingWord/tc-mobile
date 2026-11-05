/**
 * THROWAWAY (#1921): duplex and write-test screens for the Capacitor-vs-Expo
 * simulator comparison. Driven by deep links (`expoproof://run?op=...`), so
 * adb and simctl can start a step; every result is one `SIM1921 {json}` line in
 * the system log and on screen.
 */
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioRecorder,
} from "expo-audio";
import { Directory, File, FileMode, Paths } from "expo-file-system";
import * as Linking from "expo-linking";
import { useEffect, useRef, useState } from "react";
import { AppState, Button, Platform, ScrollView, Text } from "react-native";

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Same generator as the Capacitor harness, so both stacks write identical bytes. */
function makeBytes(size: number): Uint8Array {
  const words = new Uint32Array(Math.ceil(size / 4));
  let x = 0x1921;
  for (let i = 0; i < words.length; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    words[i] = x >>> 0;
  }
  return new Uint8Array(words.buffer, 0, size);
}

async function toneFile(seconds: number): Promise<File> {
  const rate = 44100;
  const n = seconds * rate;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const ascii = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i));
  };
  ascii(0, "RIFF");
  v.setUint32(4, 36 + n * 2, true);
  ascii(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  ascii(36, "data");
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++)
    v.setInt16(44 + i * 2, 8000 * Math.sin((2 * Math.PI * 440 * i) / rate), true);
  const f = new File(Paths.cache, "tone.wav");
  if (f.exists) f.delete();
  f.create();
  await f.write(new Uint8Array(buf));
  return f;
}

const expected = new Map<number, number>();
/** The SAF folder from `op=pick`: Expo's only route onto the removable volume. */
let picked: Directory | null = null;

const CHUNK = 1024 * 1024;

function crc32Update(c: number, b: Uint8Array): number {
  for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]!) & 0xff]! ^ (c >>> 8);
  return c;
}

/** `whole`: File.write plus File.bytes. `handle`: FileHandle in 1 MiB chunks. */
async function writeRun(size: number, where: string, mode: string) {
  const bytes = makeBytes(size);
  if (!expected.has(size)) expected.set(size, crc32(bytes));
  const out: Record<string, unknown> = { stack: "expo", size, where, mode, crc: expected.get(size) };
  const t0 = performance.now();
  let f: File;
  if (where === "saf") {
    f = picked!.createFile(`w-${size}.bin`, "application/octet-stream");
  } else {
    const dir = where === "internal" ? Paths.document : new Directory(where);
    f = new File(dir, `w-${size}.bin`);
    if (f.exists) f.delete();
    f.create();
  }
  try {
    if (mode === "whole") {
      await f.write(bytes);
    } else if (mode === "append") {
      for (let at = 0; at < size; at += CHUNK)
        await f.write(bytes.subarray(at, at + CHUNK), { append: at > 0 });
    } else {
      const h = f.open(FileMode.ReadWrite);
      for (let at = 0; at < size; at += CHUNK) await h.writeBytes(bytes.subarray(at, at + CHUNK));
      h.close();
    }
    out.writeMs = Math.round(performance.now() - t0);
  } catch (e) {
    out.writeError = String(e).slice(0, 240);
    out.writeFailMs = Math.round(performance.now() - t0);
  }
  if (out.writeMs !== undefined) {
    const r0 = performance.now();
    const h = f.open(FileMode.ReadOnly);
    let c = 0xffffffff;
    let len = 0;
    let crcMs = 0;
    for (;;) {
      const chunk = await h.readBytes(CHUNK);
      if (chunk.length === 0) break;
      len += chunk.length;
      const c0 = performance.now();
      c = crc32Update(c, chunk);
      crcMs += performance.now() - c0;
    }
    h.close();
    out.handleReadMs = Math.round(performance.now() - r0 - crcMs);
    out.len = len;
    out.crcOk = ((c ^ 0xffffffff) >>> 0) === expected.get(size);
    try {
      const w0 = performance.now();
      const back = await f.bytes();
      out.wholeReadMs = Math.round(performance.now() - w0);
      out.wholeCrcOk = crc32(back) === expected.get(size);
    } catch (e) {
      out.wholeReadError = String(e).slice(0, 240);
    }
  }
  try {
    f.delete();
  } catch (e) {
    out.deleteError = String(e).slice(0, 160);
  }
  return out;
}

export function CompareScreen() {
  const recorder = useAudioRecorder({
    ...RecordingPresets.HIGH_QUALITY,
    isMeteringEnabled: true,
  });
  const player = useAudioPlayer(null);
  const [lines, setLines] = useState<string[]>([]);
  const lastTake = useRef<string | null>(null);
  const peakDb = useRef(-160);
  const meter = useRef<ReturnType<typeof setInterval> | null>(null);

  const say = (o: unknown) => {
    const s = JSON.stringify(o);
    console.log(`SIM1921 ${s}`);
    const log = new File(Paths.document, "sim1921.jsonl");
    log.writeSync((log.exists ? log.textSync() : "") + s + "\n");
    setLines((l) => [...l.slice(-30), s]);
  };

  const ops: Record<string, (q: Record<string, string>) => Promise<unknown>> = {
    // Duplex needs a session that allows both directions on iOS.
    mode: async () => {
      await requestRecordingPermissionsAsync();
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
        interruptionMode: "doNotMix",
        shouldPlayInBackground: false,
        allowsBackgroundRecording: false,
      });
      return { ok: true };
    },
    startRec: async () => {
      await recorder.prepareToRecordAsync();
      recorder.record();
      peakDb.current = -160;
      meter.current = setInterval(() => {
        const m = recorder.getStatus().metering;
        if (m != null && m > peakDb.current) peakDb.current = m;
      }, 100);
      return { recording: recorder.isRecording };
    },
    stopRec: async () => {
      if (meter.current) clearInterval(meter.current);
      await recorder.stop();
      lastTake.current = recorder.uri;
      return { uri: recorder.uri, peakDb: peakDb.current };
    },
    playTone: async (q) => {
      player.replace({ uri: (await toneFile(Number(q.seconds ?? 30))).uri });
      player.play();
      return { playing: player.playing };
    },
    playTake: async () => {
      if (!lastTake.current) return { error: "no take" };
      player.replace({ uri: lastTake.current });
      player.play();
      return { playing: player.playing };
    },
    stopPlay: async () => {
      player.pause();
      return { ok: true };
    },
    status: async () => ({
      recording: recorder.isRecording,
      recSeconds: recorder.currentTime,
      metering: recorder.getStatus().metering ?? null,
      playing: player.playing,
      playTime: +player.currentTime.toFixed(2),
      appState: AppState.currentState,
    }),
    write: async (q) => writeRun(Number(q.size), q.where ?? "internal", q.mode ?? "whole"),
    loop: async (q) => {
      const results: unknown[] = [];
      for (let i = 0; i < Number(q.n ?? 20); i++) {
        const t = Date.now();
        try {
          const r = await writeRun(Number(q.size), q.where ?? "saf", q.mode ?? "append");
          results.push(r.writeError ? { i, t, err: r.writeError } : { i, ms: r.writeMs, ok: r.crcOk });
          if (r.writeError) break;
        } catch (e) {
          results.push({ i, t, thrown: String(e).slice(0, 240) });
          break;
        }
      }
      return results;
    },
    probeDir: async (q) => {
      const d = new Directory(q.where!);
      const f = new File(d, "probe.txt");
      if (!d.exists) d.create({ intermediates: true });
      f.create({ overwrite: true });
      await f.write("x");
      const ok = f.exists;
      f.delete();
      return { ok, where: q.where };
    },
    pick: async (q) => {
      picked = await Directory.pickDirectoryAsync(q.initial);
      return { uri: picked.uri };
    },
  };
  const latest = useRef(ops);
  latest.current = ops;

  useEffect(() => {
    const handle = (url: string | null) => {
      if (!url) return;
      const { hostname, path, queryParams } = Linking.parse(url);
      if (hostname !== "run" && path !== "run") return;
      const q = (queryParams ?? {}) as Record<string, string>;
      const op = q.op!;
      const id = q.id ?? "";
      say({ id, op, start: true });
      void (async () => {
        const t0 = Date.now();
        try {
          const r = await latest.current[op]!(q);
          say({ id, op, ms: Date.now() - t0, r });
        } catch (e) {
          say({ id, op, ms: Date.now() - t0, error: String(e) });
        }
      })();
    };
    void Linking.getInitialURL().then(handle);
    // iOS: simctl openurl shows a confirm dialog each time, so poll the
    // loopback server on the Mac for ops instead.
    let polling = Platform.OS === "ios";
    const poll = async () => {
      while (polling) {
        try {
          const r = await fetch("http://127.0.0.1:8921/next");
          if (r.status === 200) {
            const { id, code } = (await r.json()) as { id: number; code: string };
            let out: unknown;
            const q = Object.fromEntries(new URLSearchParams(code)) as Record<string, string>;
            try {
              out = await latest.current[q.op!]!(q);
            } catch (e) {
              out = { error: String(e) };
            }
            say({ op: q.op, r: out });
            await fetch("http://127.0.0.1:8921/result", {
              method: "POST",
              body: JSON.stringify({ id, out }),
            });
          }
        } catch {
          // Server not up: keep polling.
        }
        await new Promise((res) => setTimeout(res, 150));
      }
    };
    void poll();
    const sub = Linking.addEventListener("url", (e) => handle(e.url));
    const app = AppState.addEventListener("change", (s) =>
      say({ appState: s, recording: recorder.isRecording, recSeconds: recorder.currentTime })
    );
    return () => {
      polling = false;
      sub.remove();
      app.remove();
    };
  }, [recorder]);

  return (
    <ScrollView>
      <Text>Compare harness (#1921), {Platform.OS}</Text>
      <Button title="write 9.6 MB internal" onPress={() => void ops.write!({ size: "9600000" }).then(say)} />
      {lines.map((l, i) => (
        <Text key={i} style={{ fontSize: 10 }}>
          {l}
        </Text>
      ))}
    </ScrollView>
  );
}
