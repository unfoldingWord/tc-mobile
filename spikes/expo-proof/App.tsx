/**
 * THROWAWAY (#1520): the Expo proof for the Capacitor-or-Expo spike. Never
 * merged. RUN-SHEET.md says what to run on a phone and what each result
 * means for ADR 0016.
 *
 * 1. Record with expo-audio, then Play with playsInSilentMode on (or off, as
 *    a control). The mode last set is shown on screen.
 * 2. The data-continuity probe: a hidden web view at the old Capacitor
 *    origin lists the IndexedDB databases and store counts it can see, and
 *    exports one recording to a native file.
 * 3. Identity: the bundle id / package this build carries.
 */
import { StatusBar } from "expo-status-bar";
import Constants from "expo-constants";
import {
  type AudioMode,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { Directory, File, Paths } from "expo-file-system";
import { useCallback, useRef, useState } from "react";
import {
  Button,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { probeHtml, type ProbeMessage } from "./src/probe-page";

/** The origins the Capacitor shell can have run at (research note §4.1). */
const ORIGINS =
  Platform.OS === "ios"
    ? ["capacitor://localhost", "https://localhost"]
    : ["https://localhost", "http://localhost"];

function wavHeader(byteLength: number, sampleRate: number): Uint8Array {
  const h = new DataView(new ArrayBuffer(44));
  const ascii = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) h.setUint8(at + i, s.charCodeAt(i));
  };
  ascii(0, "RIFF");
  h.setUint32(4, 36 + byteLength, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  h.setUint32(16, 16, true);
  h.setUint16(20, 1, true); // PCM
  h.setUint16(22, 1, true); // mono
  h.setUint32(24, sampleRate, true);
  h.setUint32(28, sampleRate * 2, true);
  h.setUint16(32, 2, true);
  h.setUint16(34, 16, true);
  ascii(36, "data");
  h.setUint32(40, byteLength, true);
  return new Uint8Array(h.buffer);
}

export default function App() {
  // ---- 1. Record, then Play past the silent switch ----
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recState = useAudioRecorderState(recorder);
  const player = useAudioPlayer(null);
  const playStatus = useAudioPlayerStatus(player);
  const [mode, setMode] = useState<Partial<AudioMode> | null>(null);
  const [takeUri, setTakeUri] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);

  const applyMode = useCallback(async (next: Partial<AudioMode>) => {
    await setAudioModeAsync(next);
    setMode(next);
  }, []);

  const record = useCallback(async () => {
    setAudioError(null);
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        setAudioError("Microphone permission refused");
        return;
      }
      await applyMode({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
    } catch (e) {
      setAudioError(String(e));
    }
  }, [applyMode, recorder]);

  const stop = useCallback(async () => {
    try {
      await recorder.stop();
      setTakeUri(recorder.uri);
    } catch (e) {
      setAudioError(String(e));
    }
  }, [recorder]);

  const play = useCallback(
    async (uri: string | null, playsInSilentMode: boolean) => {
      if (!uri) return;
      setAudioError(null);
      try {
        await applyMode({
          playsInSilentMode,
          allowsRecording: false,
          interruptionMode: "doNotMix",
          shouldPlayInBackground: false,
        });
        player.replace({ uri });
        await player.seekTo(0);
        player.play();
      } catch (e) {
        setAudioError(String(e));
      }
    },
    [applyMode, player]
  );

  // ---- 2. The data-continuity probe ----
  const [probeOrigin, setProbeOrigin] = useState<string | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [exportedUri, setExportedUri] = useState<string | null>(null);
  const exportFile = useRef<File | null>(null);
  const writes = useRef<Promise<void>>(Promise.resolve());
  const expected = useRef(0);

  const log = (s: string) => setLines((l) => [...l, s]);

  const onMessage = useCallback((ev: WebViewMessageEvent) => {
    let m: ProbeMessage;
    try {
      m = JSON.parse(ev.nativeEvent.data) as ProbeMessage;
    } catch {
      log(`unparsed message: ${ev.nativeEvent.data.slice(0, 80)}`);
      return;
    }
    switch (m.type) {
      case "origin":
        log(`page origin: ${m.origin} (indexedDB: ${m.indexedDB})`);
        break;
      case "databases":
        log(
          m.hasDatabases
            ? `databases: ${JSON.stringify(m.list)}`
            : "indexedDB.databases() not available"
        );
        break;
      case "no-database":
        log(`tc-mobile not found at this origin (${m.message})`);
        break;
      case "counts":
        log(`${m.name} v${m.version}`);
        for (const [store, n] of Object.entries(m.counts)) {
          log(`  ${store}: ${n}`);
        }
        break;
      case "no-clip":
        log("no clipData entry to export");
        break;
      case "clip-begin": {
        const encoding = m.meta?.encoding ?? "unknown";
        const dir = new Directory(Paths.document, "tc-migration-probe");
        if (!dir.exists) dir.create();
        const ext =
          encoding === "pcm" ? "wav" : encoding === "mp3" ? "mp3" : "bin";
        const file = new File(dir, `${m.key}.${ext}`);
        if (file.exists) file.delete();
        file.create();
        exportFile.current = file;
        expected.current = m.byteLength + (ext === "wav" ? 44 : 0);
        log(
          `exporting clip ${m.key}: ${m.byteLength} bytes, ${encoding}, ${m.meta?.sampleRate ?? "?"} Hz, ${m.chunks} chunks`
        );
        if (ext === "wav") {
          const header = wavHeader(m.byteLength, m.meta?.sampleRate ?? 48000);
          writes.current = writes.current.then(() => file.write(header));
        }
        break;
      }
      case "clip-chunk": {
        const file = exportFile.current;
        if (!file) break;
        const b64 = m.b64;
        writes.current = writes.current.then(() =>
          file.write(b64, { encoding: "base64", append: true })
        );
        break;
      }
      case "clip-end": {
        const file = exportFile.current;
        writes.current = writes.current.then(() => {
          if (!file) return;
          const size = new File(file.uri).size;
          log(
            `written ${size} bytes, expected ${expected.current}: ${size === expected.current ? "MATCH" : "MISMATCH"}`
          );
          setExportedUri(file.uri);
        });
        writes.current.catch((e) => log(`write failed: ${String(e)}`));
        break;
      }
      case "error":
        log(`error at ${m.stage}: ${m.message}`);
        break;
    }
  }, []);

  const runProbe = (origin: string) => {
    setLines([]);
    setExportedUri(null);
    exportFile.current = null;
    writes.current = Promise.resolve();
    setProbeOrigin(null);
    // Remount the web view for each run.
    setTimeout(() => setProbeOrigin(origin), 0);
  };

  // ---- 3. Identity ----
  const ios = Constants.expoConfig?.ios?.bundleIdentifier ?? "(none)";
  const android = Constants.expoConfig?.android?.package ?? "(none)";

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.h1}>tC Mobile — Expo proof (#1520)</Text>
      <Text style={styles.warn}>Throwaway spike. Never merged.</Text>

      <Text style={styles.h2}>1. Record, then Play</Text>
      <View style={styles.row}>
        <Button
          title={recState.isRecording ? "Recording…" : "Record"}
          onPress={record}
          disabled={recState.isRecording}
        />
        <Button title="Stop" onPress={stop} disabled={!recState.isRecording} />
      </View>
      <Text>
        Recording: {recState.isRecording ? "yes" : "no"} ·{" "}
        {Math.round(recState.durationMillis / 100) / 10} s
      </Text>
      <Text selectable>Take: {takeUri ?? "none yet"}</Text>
      <View style={styles.row}>
        <Button
          title="Play (playsInSilentMode: true)"
          onPress={() => play(takeUri, true)}
          disabled={!takeUri}
        />
      </View>
      <View style={styles.row}>
        <Button
          title="Control: Play (playsInSilentMode: false)"
          onPress={() => play(takeUri, false)}
          disabled={!takeUri}
        />
      </View>
      <Text>Playing: {playStatus.playing ? "yes" : "no"}</Text>
      <Text style={styles.mono}>
        Audio mode set: {mode ? JSON.stringify(mode, null, 1) : "none yet"}
      </Text>
      {audioError ? <Text style={styles.err}>{audioError}</Text> : null}

      <Text style={styles.h2}>2. Data-continuity probe</Text>
      <Text>Open the old app&apos;s storage at:</Text>
      {ORIGINS.map((o) => (
        <View style={styles.row} key={o}>
          <Button title={o} onPress={() => runProbe(o)} />
        </View>
      ))}
      <Text style={styles.mono} selectable>
        {lines.length ? lines.join("\n") : "not run"}
      </Text>
      {exportedUri ? (
        <View style={styles.row}>
          <Button
            title="Play the exported recording"
            onPress={() => play(exportedUri, true)}
          />
        </View>
      ) : null}
      {probeOrigin ? (
        <View style={styles.hidden}>
          <WebView
            key={probeOrigin}
            originWhitelist={["*"]}
            source={{ html: probeHtml, baseUrl: probeOrigin }}
            onMessage={onMessage}
            onError={(e) => log(`web view error: ${e.nativeEvent.description}`)}
          />
        </View>
      ) : null}

      <Text style={styles.h2}>3. Identity</Text>
      <Text>iOS bundle id: {ios}</Text>
      <Text>Android package: {android}</Text>
      <Text>
        Platform: {Platform.OS} {String(Platform.Version)}
      </Text>
      <StatusBar style="auto" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, paddingTop: 56, gap: 8 },
  h1: { fontSize: 20, fontWeight: "700" },
  h2: { fontSize: 17, fontWeight: "700", marginTop: 16 },
  warn: { color: "#E59D33" },
  err: { color: "#b00020" },
  row: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  mono: {
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontSize: 12,
  },
  hidden: { width: 1, height: 1, opacity: 0, overflow: "hidden" },
});
