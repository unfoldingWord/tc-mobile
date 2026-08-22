import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
  test: {
    // The `lib/` layer is deliberately free of DOM and Web Audio APIs so the
    // audio core is testable in plain Node. Anything that genuinely needs
    // MediaRecorder / AudioContext is verified on-device — see AGENTS.md.
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
