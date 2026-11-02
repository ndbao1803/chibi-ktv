import { BadRequestException } from '@nestjs/common';
import type { z } from 'zod';

/** Validates input with a shared Zod schema; the first problem becomes a 400 error message. */
export function parseOrThrow<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new BadRequestException(result.error.issues[0]?.message ?? 'Dữ liệu không hợp lệ');
  }
  return result.data;
}
