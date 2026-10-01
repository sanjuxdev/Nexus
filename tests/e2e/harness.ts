import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const EXTENSION_PATH = path.resolve(__dirname, '../../extension/.output/chrome-mv3');
export const TEST_SITE_URL = 'http://localhost:5173/login-demo.html';
export const TEST_SITE_SECONDARY_URL = 'http://localhost:5174/login-demo.html';

export function getExtensionLaunchArgs(): string[] {
  return [
    `--disable-extensions-except=${EXTENSION_PATH}`,
    `--load-extension=${EXTENSION_PATH}`,
    '--headless=new',
    // Completely disable audio input/output and hardware querying
    '--mute-audio',
    '--disable-audio-output',
    // Completely isolate media streams (camera & microphone)
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--deny-permission-prompts',
    // Disable background audio and speech recognition services
    '--disable-features=AudioServiceOutOfProcess,SpeechRecognition',
  ];
}
