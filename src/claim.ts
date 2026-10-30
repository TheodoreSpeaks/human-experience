// Moves data recorded under a legacy user id (pre-auth) onto a real account.
// Usage: bun claim --from teddy --email you@example.com
import { parseArgs } from "util";
import { sql } from "./db";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: { from: { type: "string" }, email: { type: "string" } },
});
if (!values.from || !values.email) throw new Error("Usage: bun claim --from <legacy user id> --email <account email>");

const [user] = await sql`SELECT id FROM "user" WHERE email = ${values.email}`;
if (!user) throw new Error(`No account with email ${values.email}. Sign up first.`);

await sql.begin(async (tx) => {
  const entries = await tx`UPDATE entries SET user_id = ${user.id} WHERE user_id = ${values.from} RETURNING id`;
  const rankings = await tx`UPDATE rankings SET user_id = ${user.id} WHERE user_id = ${values.from} RETURNING experience_id`;
  if (entries.length === 0) throw new Error(`Nothing recorded under "${values.from}"`);
  console.log(`moved ${entries.length} entries and ${rankings.length} rankings to ${values.email}`);
});
await sql.close();
