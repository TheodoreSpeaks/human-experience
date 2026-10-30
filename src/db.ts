import { SQL } from "bun";
import type { Candidate } from "./judge";
import { EMBEDDING_DIMS } from "./embed";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}
export const sql = new SQL(process.env.DATABASE_URL);

const toVector = (v: number[]) => `[${v.join(",")}]`;

export async function migrate() {
  await sql`CREATE EXTENSION IF NOT EXISTS vector`;
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS experiences (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      title       text NOT NULL,
      description text NOT NULL,
      embedding   vector(${EMBEDDING_DIMS}) NOT NULL,
      created_at  timestamptz NOT NULL DEFAULT now()
    )
  `);
  await sql`
    CREATE INDEX IF NOT EXISTS experiences_embedding_idx
      ON experiences USING hnsw (embedding vector_cosine_ops)
  `;
  // One row per time a user had an experience. Instance details live here, never on the experience.
  await sql`
    CREATE TABLE IF NOT EXISTS entries (
      id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id       text NOT NULL,
      experience_id uuid NOT NULL REFERENCES experiences(id),
      occurred_on   date NOT NULL,
      note          text NOT NULL,
      "where"       text,
      with_people   text[] NOT NULL,
      dump          text NOT NULL,
      created_at    timestamptz NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS entries_user_idx ON entries (user_id, occurred_on)`;
  // A user's Beli-style ranking: one row per experience, ordered within its valence by position (lower = better).
  await sql`
    CREATE TABLE IF NOT EXISTS rankings (
      user_id       text NOT NULL,
      experience_id uuid NOT NULL REFERENCES experiences(id),
      valence       text NOT NULL CHECK (valence IN ('good', 'fine', 'bad')),
      position      double precision NOT NULL,
      created_at    timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, experience_id)
    )
  `;
  // An entry is reviewed once the user has ranked (or re-ranked) its experience after having it.
  // Unreviewed entries are the ranking queue, so repeats of ranked experiences get re-ranked.
  await sql`ALTER TABLE entries ADD COLUMN IF NOT EXISTS reviewed boolean NOT NULL DEFAULT false`;
  await sql`
    UPDATE entries e SET reviewed = true
    FROM rankings r
    WHERE r.user_id = e.user_id AND r.experience_id = e.experience_id AND e.created_at <= r.created_at AND NOT e.reviewed
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS follows (
      follower_id text NOT NULL,
      followee_id text NOT NULL,
      created_at  timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (follower_id, followee_id),
      CHECK (follower_id <> followee_id)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS follows_followee_idx ON follows (followee_id)`;
  // Beli-style 0-10 scores: each valence owns a band, spread evenly by rank within it.
  // The single source of truth for scores: spectrum, feed, profiles and experience pages all read this.
  await sql`
    CREATE OR REPLACE VIEW scored_rankings AS
    SELECT user_id, experience_id, valence, position, created_at,
           round(CASE WHEN n = 1 THEN (lo + hi) / 2 ELSE hi - (rn - 1)::numeric / (n - 1) * (hi - lo) END, 1)::float8 AS score
    FROM (
      SELECT r.*,
             row_number() OVER (PARTITION BY user_id, valence ORDER BY position) AS rn,
             count(*) OVER (PARTITION BY user_id, valence) AS n,
             CASE valence WHEN 'good' THEN 6.7 WHEN 'fine' THEN 3.4 ELSE 0 END AS lo,
             CASE valence WHEN 'good' THEN 10 WHEN 'fine' THEN 6.6 ELSE 3.3 END AS hi
      FROM rankings r
    ) ranked
  `;
  // Everyone's verdict on each experience: a Bayesian average that starts as if PRIOR_RATERS people had
  // rated it at the global mean, so one enthusiastic 10.0 can't top the spectrum of all human experience.
  // Test accounts (@example.test) are left out of global numbers.
  await sql.unsafe(`
    CREATE OR REPLACE VIEW global_scores AS
    WITH real AS (
      SELECT s.* FROM scored_rankings s JOIN "user" u ON u.id = s.user_id
      WHERE u.email NOT LIKE '%@example.test'
    ),
    prior AS (SELECT avg(score)::numeric AS mean FROM real)
    SELECT r.experience_id,
           count(*)::int AS raters,
           round(((${PRIOR_RATERS} * prior.mean + sum(r.score)::numeric) / (${PRIOR_RATERS} + count(*))), 1)::float8 AS score
    FROM real r CROSS JOIN prior
    GROUP BY r.experience_id, prior.mean
  `);
}

const PRIOR_RATERS = 3;

export type Valence = "good" | "fine" | "bad";
export const VALENCES: Valence[] = ["good", "fine", "bad"];

// Experiences with unreviewed entries (new, or repeats of ranked ones), oldest first, with their latest note.
// Repeats carry their current score as `previous` so the ranker can show "last time".
export async function pending(userId: string): Promise<
  {
    experienceId: string;
    title: string;
    titleEditable: boolean;
    note: string;
    entryId: string;
    previous: { score: number; valence: Valence } | null;
  }[]
> {
  return sql`
    SELECT x.id AS "experienceId", x.title,
           (array_agg(e.note ORDER BY e.created_at DESC))[1] AS note,
           (array_agg(e.id ORDER BY e.created_at DESC))[1] AS "entryId",
           CASE WHEN s.score IS NULL THEN NULL ELSE json_build_object('score', s.score, 'valence', s.valence) END AS previous,
           -- Same rule as renameExperience(): nobody else has it and nobody has rated it.
           NOT EXISTS (SELECT 1 FROM entries o WHERE o.experience_id = x.id AND o.user_id <> ${userId})
             AND NOT EXISTS (SELECT 1 FROM rankings r WHERE r.experience_id = x.id) AS "titleEditable"
    FROM entries e
    JOIN experiences x ON x.id = e.experience_id
    LEFT JOIN scored_rankings s ON s.user_id = e.user_id AND s.experience_id = x.id
    WHERE e.user_id = ${userId} AND NOT e.reviewed
    GROUP BY x.id, x.title, s.score, s.valence
    ORDER BY min(e.created_at)
  `;
}

// One valence bucket, best first.
export async function bucket(userId: string, valence: Valence): Promise<{ experienceId: string; title: string; position: number }[]> {
  return sql`
    SELECT r.experience_id AS "experienceId", x.title, r.position
    FROM rankings r JOIN experiences x ON x.id = r.experience_id
    WHERE r.user_id = ${userId} AND r.valence = ${valence}
    ORDER BY r.position
  `;
}

// Place between the neighbor ranked just better and the one just worse (either may be null at the ends).
// A re-rank drops the old placement first, then marks all of the user's entries for it reviewed.
export async function rank(opts: {
  userId: string;
  experienceId: string;
  valence: Valence;
  betterId: string | null;
  worseId: string | null;
}) {
  if (opts.experienceId === opts.betterId || opts.experienceId === opts.worseId) {
    throw new Error("An experience can't be its own neighbor");
  }
  await sql.begin(async (tx) => {
    await tx`DELETE FROM rankings WHERE user_id = ${opts.userId} AND experience_id = ${opts.experienceId}`;

    const ranked: { experienceId: string; position: number }[] = await tx`
      SELECT experience_id AS "experienceId", position FROM rankings
      WHERE user_id = ${opts.userId} AND valence = ${opts.valence}
    `;
    const pos = (id: string | null) => {
      if (id === null) return null;
      const row = ranked.find((r) => r.experienceId === id);
      if (!row) throw new Error(`Neighbor ${id} is not in the user's ${opts.valence} bucket`);
      return row.position;
    };
    const better = pos(opts.betterId);
    const worse = pos(opts.worseId);
    const position =
      better === null && worse === null ? 0 : better === null ? worse! - 1 : worse === null ? better + 1 : (better + worse) / 2;

    await tx`
      INSERT INTO rankings (user_id, experience_id, valence, position)
      VALUES (${opts.userId}, ${opts.experienceId}, ${opts.valence}, ${position})
    `;
    await tx`UPDATE entries SET reviewed = true WHERE user_id = ${opts.userId} AND experience_id = ${opts.experienceId}`;
  });
}

export type SpectrumRow = {
  experienceId: string;
  title: string;
  valence: Valence;
  score: number;
  times: number;
  note: string;
  entryId: string;
};

// A user's whole spectrum, best to worst: good bucket, then fine, then bad.
export async function spectrum(userId: string): Promise<SpectrumRow[]> {
  return sql`
    SELECT s.experience_id AS "experienceId", x.title, s.valence, s.score,
           count(e.id)::int AS times,
           (array_agg(e.note ORDER BY e.created_at DESC))[1] AS note,
           (array_agg(e.id ORDER BY e.created_at DESC))[1] AS "entryId"
    FROM scored_rankings s
    JOIN experiences x ON x.id = s.experience_id
    JOIN entries e ON e.experience_id = s.experience_id AND e.user_id = s.user_id
    WHERE s.user_id = ${userId}
    GROUP BY s.experience_id, x.title, s.valence, s.position, s.score
    ORDER BY array_position(ARRAY['good','fine','bad'], s.valence), s.position
  `;
}

export async function scoreOf(userId: string, experienceId: string): Promise<{ score: number; valence: Valence }> {
  const [row] = await sql`
    SELECT score, valence FROM scored_rankings WHERE user_id = ${userId} AND experience_id = ${experienceId}
  `;
  if (!row) throw new Error(`Experience ${experienceId} is not ranked by ${userId}`);
  return row;
}

// Drops the unreviewed entries for an experience the user doesn't want to rank. A ranked experience keeps its
// earlier entries and ranking. An unranked one is removed from the catalog if nobody else has had it,
// so junk extractions don't pollute future matching.
//
// A re-rate reopens an entry the user already had (see queueRating), so discarding it must cancel
// the re-rate, not delete their history: entries from before the ranking go back to reviewed, and
// only entries added since (new occurrences) are deleted. Without a ranking, everything pending is new.
export async function discardPending(userId: string, experienceId: string) {
  await sql.begin(async (tx) => {
    // Compared inside Postgres: timestamps are microsecond-precise there but only millisecond in JS,
    // so a round trip would make an entry from the same transaction look newer than its ranking.
    const reopened = await tx`
      UPDATE entries e SET reviewed = true
      FROM rankings r
      WHERE r.user_id = e.user_id AND r.experience_id = e.experience_id
        AND e.user_id = ${userId} AND e.experience_id = ${experienceId}
        AND NOT e.reviewed AND e.created_at <= r.created_at
      RETURNING e.id
    `;
    const deleted = await tx`
      DELETE FROM entries WHERE user_id = ${userId} AND experience_id = ${experienceId} AND NOT reviewed RETURNING id
    `;
    if (reopened.length + deleted.length === 0) throw new Error(`No pending entries for experience ${experienceId}`);

    await tx`
      DELETE FROM experiences
      WHERE id = ${experienceId}
        AND NOT EXISTS (SELECT 1 FROM entries WHERE experience_id = ${experienceId})
        AND NOT EXISTS (SELECT 1 FROM rankings WHERE experience_id = ${experienceId})
    `;
  });
}

// A catalog title is shared by everyone who has the experience, so it can only change while it's
// effectively private: this user has it, nobody else does, and nobody has rated it yet.
// The same rule computes `titleEditable` in pending().
export async function renameExperience(opts: { userId: string; experienceId: string; title: string; embedding: number[] }) {
  const rows = await sql`
    UPDATE experiences SET title = ${opts.title}, embedding = ${toVector(opts.embedding)}::vector
    WHERE id = ${opts.experienceId}
      AND EXISTS (SELECT 1 FROM entries WHERE experience_id = ${opts.experienceId} AND user_id = ${opts.userId})
      AND NOT EXISTS (SELECT 1 FROM entries WHERE experience_id = ${opts.experienceId} AND user_id <> ${opts.userId})
      AND NOT EXISTS (SELECT 1 FROM rankings WHERE experience_id = ${opts.experienceId})
    RETURNING id
  `;
  if (rows.length !== 1) {
    throw new Error("This title can't be changed: it's already rated or other people have this experience");
  }
}

export async function experienceDescription(experienceId: string): Promise<string> {
  const [row] = await sql`SELECT description FROM experiences WHERE id = ${experienceId}`;
  if (!row) throw new Error(`Experience ${experienceId} not found`);
  return row.description;
}

export async function updateEntryNote(opts: { userId: string; entryId: string; note: string }) {
  const rows = await sql`
    UPDATE entries SET note = ${opts.note}
    WHERE id = ${opts.entryId} AND user_id = ${opts.userId}
    RETURNING id
  `;
  if (rows.length !== 1) throw new Error(`Entry ${opts.entryId} not found for user`);
}

export async function nearest(embedding: number[], k: number): Promise<(Candidate & { similarity: number })[]> {
  const v = toVector(embedding);
  return sql`
    SELECT id, title, description, 1 - (embedding <=> ${v}::vector) AS similarity
    FROM experiences
    ORDER BY embedding <=> ${v}::vector
    LIMIT ${k}
  `;
}

export async function insertExperience(e: { title: string; description: string; embedding: number[] }) {
  const [row] = await sql`
    INSERT INTO experiences (title, description, embedding)
    VALUES (${e.title}, ${e.description}, ${toVector(e.embedding)}::vector)
    RETURNING id, title
  `;
  return row as { id: string; title: string };
}

// Puts an experience in the user's ranking queue from its page. Already ranked: re-open the latest
// entry as a re-rank (no new occurrence). Not had it yet: add today's entry with an empty note.
export async function queueRating(userId: string, experienceId: string) {
  await sql.begin(async (tx) => {
    const [x] = await tx`SELECT 1 FROM experiences WHERE id = ${experienceId}`;
    if (!x) throw new Error(`Experience ${experienceId} not found`);

    const [ranked] = await tx`SELECT 1 FROM rankings WHERE user_id = ${userId} AND experience_id = ${experienceId}`;
    if (ranked) {
      await tx`
        UPDATE entries SET reviewed = false
        WHERE id = (SELECT id FROM entries WHERE user_id = ${userId} AND experience_id = ${experienceId}
                    ORDER BY created_at DESC LIMIT 1)
      `;
    } else {
      await tx`
        INSERT INTO entries (user_id, experience_id, occurred_on, note, with_people, dump)
        VALUES (${userId}, ${experienceId}, current_date, '', '{}', '')
      `;
    }
  });
}

export async function insertEntry(e: {
  userId: string;
  experienceId: string;
  occurredOn: string;
  note: string;
  where: string | null;
  withPeople: string[];
  dump: string;
}) {
  const [row] = await sql`
    INSERT INTO entries (user_id, experience_id, occurred_on, note, "where", with_people, dump)
    VALUES (${e.userId}, ${e.experienceId}, ${e.occurredOn}, ${e.note}, ${e.where}, ${sql.array(e.withPeople, "text")}, ${e.dump})
    RETURNING id
  `;
  return row as { id: string };
}
