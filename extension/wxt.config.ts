import { defineConfig } from 'wxt';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  vite: () =>
    ({
      server: {
        port: 3333,
        strictPort: true,
        hmr: {
          port: 3333,
        }
      },
      plugins: [react()],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, './src'),
          '@contracts': path.resolve(__dirname, '../contracts/ts'),
        },
      },
    } as any),
  manifest: {
    name: 'SIH26171 Browser Agent',
    version: '1.0.0',
    description: 'On-device visual perception for light-weight browser agents (ISRO, PS 26171)',
    permissions: [
      'scripting',
      'storage',
      'offscreen',
      'sidePanel',
      'webNavigation',
      'tabs',
      'activeTab',
    ],
    host_permissions: ['<all_urls>', 'http://localhost:8000/*'],
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    },
    cross_origin_embedder_policy: {
      value: "require-corp"
    },
    cross_origin_opener_policy: {
      value: "same-origin"
    },
    web_accessible_resources: [
      {
        resources: ['mediapipe/*', 'models/*', 'onnx/*'],
        matches: ['<all_urls>'],
      },
    ],
    commands: {
      "dummy_command": {
        "suggested_key": {
          "default": "Ctrl+Shift+U",
          "mac": "Command+Shift+U"
        },
        "description": "Dummy command to fix onCommand error"
      }
    },
  },
});
