import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/e2e/**'],
  },
  resolve: {
    alias: [
      {
        find: /^@contracts\/(.*)$/,
        replacement: path.resolve(__dirname, 'contracts/ts/$1'),
      },
      {
        find: '@contracts',
        replacement: path.resolve(__dirname, 'contracts/ts/index.ts'),
      },
      {
        find: /^@\/(.*)$/,
        replacement: path.resolve(__dirname, 'extension/src/$1'),
      },
    ],
  },
});
