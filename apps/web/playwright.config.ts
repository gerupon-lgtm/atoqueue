import { defineConfig } from "@playwright/test";

const port = Number(process.env.ATOQUEUE_E2E_PORT ?? 4173);

export default defineConfig({
  testDir: "./e2e",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
  },
  webServer: {
    command: `pnpm build && pnpm vite preview --host 127.0.0.1 --port ${port} --strictPort`,
    port,
    reuseExistingServer: false,
  },
});
