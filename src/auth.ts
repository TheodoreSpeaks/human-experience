import { betterAuth } from "better-auth";
import { username } from "better-auth/plugins/username";
import { Pool } from "pg";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
if (!process.env.BETTER_AUTH_SECRET) throw new Error("BETTER_AUTH_SECRET is not set");
if (!process.env.BETTER_AUTH_URL) throw new Error("BETTER_AUTH_URL is not set");

const googleId = process.env.GOOGLE_CLIENT_ID;
const googleSecret = process.env.GOOGLE_CLIENT_SECRET;
if (Boolean(googleId) !== Boolean(googleSecret)) {
  throw new Error("Set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or neither");
}

// Google login is opt-in: it turns on once OAuth credentials exist.
export const googleEnabled = Boolean(googleId && googleSecret);

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// "Theodore Li" → "theodore_li", or "theodore_li2" if taken. Fits the username plugin's rules (3-30 of [a-z0-9_.]).
export async function generateHandle(name: string): Promise<string> {
  const base = (name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24) || "user").padEnd(3, "_");
  const { rows } = await pool.query<{ username: string }>(`SELECT username FROM "user" WHERE username LIKE $1`, [`${base}%`]);
  const taken = new Set(rows.map((r) => r.username));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}${n}`)) return `${base}${n}`;
}

export const auth = betterAuth({
  database: pool,
  emailAndPassword: { enabled: true },
  socialProviders: googleEnabled ? { google: { clientId: googleId!, clientSecret: googleSecret! } } : {},
  plugins: [username()],
  // Everyone gets a handle without an extra sign-up field; it's what friends search for and what profile URLs use.
  databaseHooks: {
    user: {
      create: {
        before: async (user) => ({ data: { ...user, username: user.username ?? (await generateHandle(user.name)) } }),
      },
    },
  },
});

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function requireUser(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) throw new HttpError(401, "Not signed in");
  return session.user;
}
