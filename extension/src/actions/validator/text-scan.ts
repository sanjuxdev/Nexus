import type { StructuredAction } from '@contracts/index.js';
import { privacyStub } from '../../privacy/engine.js';

export async function validateTextScan(
  action: StructuredAction
): Promise<{ ok: boolean; reason?: string }> {
  let textToScan: string | undefined;

  if (action.action === 'type' && action.params?.text) {
    textToScan = action.params.text;
  } else if (action.action === 'select' && action.params?.option) {
    textToScan = action.params.option;
  }

  if (!textToScan) {
    return { ok: true };
  }

  const scan = await privacyStub.scanOutboundText(textToScan);
  if (!scan.safe) {
    return {
      ok: false,
      reason: `Outbound text contains forbidden sensitive data or unresolved tokens (findings: ${scan.findings.map((f) => f.type).join(', ')})`,
    };
  }

  return { ok: true };
}
