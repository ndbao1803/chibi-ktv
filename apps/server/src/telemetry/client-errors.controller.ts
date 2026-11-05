import { Body, Controller, HttpCode, Ip, Logger, Post } from '@nestjs/common';
import { z } from 'zod';

/** What a browser may report about a crash (no personal data: no names, no chat, no audio). */
const ClientError = z.object({
  message: z.string().max(500),
  stack: z.string().max(3000).optional(),
  url: z.string().max(300).optional(),
  ua: z.string().max(300).optional(),
});

/**
 * O-01 without a paid service: browsers post their crashes here and they land in the server log
 * (Render → Logs). At most 20 reports per minute per address, so a broken page cannot flood it.
 */
@Controller('api/client-errors')
export class ClientErrorsController {
  private readonly log = new Logger('ClientError');
  private readonly counts = new Map<string, { n: number; since: number }>();

  @Post()
  @HttpCode(204)
  report(@Body() body: unknown, @Ip() ip: string): void {
    const now = Date.now();
    const c = this.counts.get(ip);
    if (c && now - c.since < 60_000 && c.n >= 20) return;
    this.counts.set(ip, c && now - c.since < 60_000 ? { n: c.n + 1, since: c.since } : { n: 1, since: now });
    if (this.counts.size > 5000) this.counts.clear();
    const parsed = ClientError.safeParse(body);
    if (!parsed.success) return;
    const e = parsed.data;
    this.log.warn(`${e.message} | ${e.url ?? '?'} | ${e.ua ?? '?'}${e.stack ? `\n${e.stack.split('\n').slice(0, 6).join('\n')}` : ''}`);
  }
}
