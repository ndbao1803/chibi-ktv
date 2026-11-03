import { z } from 'zod';

/** All settings come from environment variables, checked once at startup. */
const Env = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  /** Optional: checks pasted links (title, length, embeddable, blocked in Vietnam). Without it, any valid link is accepted. */
  YOUTUBE_API_KEY: z.string().optional(),
  /** Optional: Cloudflare Realtime TURN key, for friends on networks that block direct connections. */
  CF_TURN_KEY_ID: z.string().optional(),
  CF_TURN_KEY_TOKEN: z.string().optional(),
});

export type AppConfig = z.infer<typeof Env>;

let cached: AppConfig | undefined;
export function config(): AppConfig {
  if (!cached) {
    const parsed = Env.safeParse(process.env);
    if (!parsed.success) {
      throw new Error('Invalid environment: ' + parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
    }
    cached = parsed.data;
  }
  return cached;
}
