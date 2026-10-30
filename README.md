# human-experience

Brain dump your day → distinct experiences → deduped against a global catalog of every human experience.

```
dump ─► split (1 LLM call) ─► embed each event ─► pgvector top-8 ─► Jev judge per event (parallel) ─► match or create ─► entry
```

- `experiences`: the global catalog ("Wet socks for the rest of a hike"). No proper nouns, no instance details.
- `entries`: one user having one experience on one day, with the specifics (where, who, note).

## Setup

```sh
cp .env.example .env   # API keys, DATABASE_URL (Postgres with pgvector), BETTER_AUTH_SECRET/URL
bun install
bun db:migrate         # Better Auth tables + ours
bun dev                # http://localhost:3000
```

Google login turns on when `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set
(redirect URI: `<BETTER_AUTH_URL>/api/auth/callback/google`).

Data recorded before accounts existed can be moved onto an account with
`bun claim --from <old user id> --email <account email>`.

## Use

```sh
bun dump --user teddy "Hiked Muir Woods with Sam, stepped in a creek, wet socks the whole way back"
bun eval:judge   # Jev dedupe judge vs. fixed candidates (TYPESAFE_API_KEY only)
bun eval:split   # splitter granularity checks
```

The prompts in `src/split.ts` and `src/judge.ts` are the product. When you see a bad merge or a missed dup, add it as a case in `evals/` first, then fix the prompt.
