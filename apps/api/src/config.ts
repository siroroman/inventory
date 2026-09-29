import { z } from 'zod';

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(8080),
    DATABASE_URL: z.string().min(1),
    /** Public origin of the app; also the base URL Better Auth builds links and cookies for. */
    BETTER_AUTH_URL: z.url(),
    BETTER_AUTH_SECRET: z.string().min(32, 'must be at least 32 characters'),
    GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  })
  .refine((env) => !env.GOOGLE_CLIENT_ID === !env.GOOGLE_CLIENT_SECRET, {
    message: 'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set together',
    path: ['GOOGLE_CLIENT_ID'],
  });

export type Config = {
  env: 'development' | 'test' | 'production';
  isProduction: boolean;
  port: number;
  databaseUrl: string;
  auth: {
    baseUrl: string;
    secret: string;
    google?: { clientId: string; clientSecret: string };
  };
};

/**
 * Reads the API's configuration from the environment and fails fast on anything missing or
 * malformed. The message names the variables but never their values (they include secrets).
 */
export function parseConfig(env: Record<string, string | undefined>): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.') || 'env'}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  }
  const e = parsed.data;
  return {
    env: e.NODE_ENV,
    isProduction: e.NODE_ENV === 'production',
    port: e.PORT,
    databaseUrl: e.DATABASE_URL,
    auth: {
      baseUrl: e.BETTER_AUTH_URL,
      secret: e.BETTER_AUTH_SECRET,
      google:
        e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET
          ? { clientId: e.GOOGLE_CLIENT_ID, clientSecret: e.GOOGLE_CLIENT_SECRET }
          : undefined,
    },
  };
}
