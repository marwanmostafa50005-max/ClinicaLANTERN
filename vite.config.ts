import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// The page talks to the local server only. In dev, /api is passed through to it.
// The local server listens on 8787 unless PORT says otherwise (tools/dev.mjs passes the same PORT to both).
const serverPort = /^\d+$/.test(process.env.PORT ?? '') ? process.env.PORT : '8787';

// "vite build --mode replay --outDir dist-replay" builds the judges' view: the page plays a recorded
// real run and never talks to a server. Its files are found from wherever the folder is put, so the
// addresses in it are relative.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === 'replay' ? './' : '/',
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: { '/api': { target: `http://127.0.0.1:${serverPort}`, changeOrigin: false } },
    // The page is not built from these folders. The server writes data\state.json after every step,
    // and a file that is in use there stopped the live page with an EBUSY error on 18 November.
    watch: { ignored: ['**/data/**', '**/eval/results/**', '**/docs/screens/**', '**/cases/**', '**/criteria/**'] }
  },
  build: { outDir: 'dist', sourcemap: false },
  // 30 seconds, not the 5-second default. cases/expected.further.json now holds more than a
  // thousand histories. The test that reads every one of them finishes in about a second on its
  // own, and went past 5 seconds when all test files ran together (merge-grok-266705e).
  test: {
    environment: 'node',
    testTimeout: 30_000,
    include: ['**/*.test.ts', '**/*.test.tsx'],
    exclude: ['node_modules/**', 'dist/**', 'dist-replay/**', '.proof/**']
  }
}));
