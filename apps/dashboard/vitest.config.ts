import { defineConfig } from 'vitest/config';

// Unit tests only. Browser tests in /e2e run with `pnpm e2e` (Playwright).
export default defineConfig({ test: { include: ['src/**/*.test.ts'] } });
