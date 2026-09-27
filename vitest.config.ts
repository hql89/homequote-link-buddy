import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}", "tests/**/*.{test,spec}.{ts,tsx}"],
    /**
     * src/integrations/supabase/client.ts reads these at import time and
     * createClient throws "supabaseUrl is required" without them, so any test
     * whose import graph reaches the client died on a machine with no .env —
     * two files did, and `npm test` therefore exited 1 on a checkout that had
     * only ever cloned the repo.
     *
     * Deliberately throwaway values, not the ones in .env.example: every test
     * that touches Supabase mocks it, so nothing here should ever open a
     * socket, and a real URL would make it possible to. These satisfy the
     * constructor and nothing else.
     */
    env: {
      VITE_SUPABASE_URL: "http://localhost:54321",
      VITE_SUPABASE_PUBLISHABLE_KEY: "test-anon-key",
      VITE_SUPABASE_PROJECT_ID: "test-project",
    },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
