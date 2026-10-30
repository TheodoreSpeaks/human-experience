import { parseArgs } from "util";
import { sql } from "./db";
import { ingestDump } from "./ingest";

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    user: { type: "string" },
    date: { type: "string" },
  },
  allowPositionals: true,
});

const dump = positionals.join(" ").trim();
if (!values.user) throw new Error("--user is required");
if (!dump) throw new Error('Usage: bun dump --user <id> [--date YYYY-MM-DD] "your day..."');

const occurredOn = values.date ?? new Date().toISOString().slice(0, 10);
await ingestDump({
  userId: values.user,
  dump,
  occurredOn,
  onEvent: (e) => console.log(`• ${e.title}${e.isNewExperience ? "  (new)" : ""}\n    ${e.note}`),
});
await sql.close();
