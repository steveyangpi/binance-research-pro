import { z } from 'zod';

export const jsonOutputSchema = {
  data: z.unknown().describe('Structured result payload.'),
};

export function jsonResult(value: unknown) {
  return {
    structuredContent: { data: value },
    content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
  };
}

export function toolError(error: unknown) {
  const message = error instanceof Error ? error.message : 'Unknown error';
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}
