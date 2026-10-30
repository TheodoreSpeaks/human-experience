import { getMigrations } from "better-auth/db/migration";
import { auth, generateHandle } from "./auth";
import { migrate, sql } from "./db";

// Better Auth's tables (user, session, account, verification) first: ours reference its user ids.
const { runMigrations } = await getMigrations(auth.options);
await runMigrations();
await migrate();

// Accounts created before handles existed get one generated from their name.
const missing: { id: string; name: string }[] = await sql`SELECT id, name FROM "user" WHERE username IS NULL ORDER BY "createdAt"`;
for (const u of missing) {
  const handle = await generateHandle(u.name);
  await sql`UPDATE "user" SET username = ${handle}, "displayUsername" = ${handle} WHERE id = ${u.id}`;
  console.log(`handle: ${u.name} → @${handle}`);
}
console.log("migrated");
await sql.close();
process.exit(0);
