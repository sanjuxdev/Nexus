import { StructuredActionSchema } from '@contracts/index.js';

export function validateSchema(action: unknown): { ok: boolean; reason?: string } {
  const parseResult = StructuredActionSchema.safeParse(action);
  if (!parseResult.success) {
    const issue = parseResult.error.issues[0];
    return {
      ok: false,
      reason: `Schema validation failed: ${issue?.path.join('.') || 'root'} - ${issue?.message || 'Invalid structure'}`,
    };
  }
  return { ok: true };
}
