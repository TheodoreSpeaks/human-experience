import type { SQL } from "bun";
import { nearest, spectrum, sql, type SpectrumRow, type Valence } from "./db";

// Taste match needs a few shared experiences before it means anything.
const MIN_SHARED_FOR_MATCH = 3;
// How many shared experiences it takes to trust the match halfway; fewer pull it toward 50%.
const MATCH_CONFIDENCE = 5;
// The feed shows what's new: the last week, then "Show older" pages back from there.
const FEED_WINDOW_DAYS = 7;
const FEED_PAGE = 20;

// Every person shown anywhere carries the same context: who they are, how your tastes line up, whether you follow them.
export type Person = {
  id: string;
  name: string;
  handle: string;
  image: string | null;
  // 0-100, or null below MIN_SHARED_FOR_MATCH shared experiences.
  match: number | null;
  shared: number;
  ranked: number;
  isFollowing: boolean;
  isYou: boolean;
};

// Agreement on shared experiences (1 - mean score gap / 10), shrunk toward 50% while there are few.
function matchPercent(shared: number, meanGap: number | null): number | null {
  if (shared < MIN_SHARED_FOR_MATCH || meanGap === null) return null;
  const agreement = 1 - meanGap / 10;
  const confidence = shared / (shared + MATCH_CONFIDENCE);
  return Math.round(100 * (0.5 + (agreement - 0.5) * confidence));
}

// Loads people (in the given order) with match and follow state relative to the viewer.
async function people(viewerId: string, userIds: string[]): Promise<Person[]> {
  if (userIds.length === 0) return [];
  const rows: (Omit<Person, "match" | "isYou"> & { gap: number | null })[] = await sql`
    SELECT u.id, u.name, u.username AS handle, u.image,
           coalesce(m.shared, 0)::int AS shared, m.gap,
           (SELECT count(*)::int FROM rankings r WHERE r.user_id = u.id) AS ranked,
           EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = ${viewerId} AND f.followee_id = u.id) AS "isFollowing"
    FROM "user" u
    LEFT JOIN (
      SELECT theirs.user_id, count(*) AS shared, avg(abs(mine.score - theirs.score)) AS gap
      FROM scored_rankings mine
      JOIN scored_rankings theirs ON theirs.experience_id = mine.experience_id AND theirs.user_id <> mine.user_id
      WHERE mine.user_id = ${viewerId}
      GROUP BY theirs.user_id
    ) m ON m.user_id = u.id
    WHERE u.id = ANY(${sql.array(userIds, "text")})
  `;
  const byId = new Map(rows.map((r) => [r.id, r]));
  return userIds.map((id) => {
    const r = byId.get(id);
    if (!r) throw new Error(`User ${id} not found`);
    const { gap, ...rest } = r;
    return { ...rest, match: matchPercent(r.shared, gap), isYou: id === viewerId };
  });
}

// ---- Feed ----

export type FeedItem = {
  user: Person;
  experienceId: string;
  title: string;
  valence: Valence;
  score: number;
  note: string;
  rankedAt: string;
};

// Rankings (and re-rankings) from people the viewer follows. Without `before`: the last week, so the
// feed ends at "You're caught up". With `before`: one older page, for "Show older".
export async function feed(viewerId: string, before: string | null): Promise<{ items: FeedItem[]; hasOlder: boolean }> {
  const rows: (Omit<FeedItem, "user"> & { userId: string })[] = before
    ? await sql`
        SELECT s.user_id AS "userId", s.experience_id AS "experienceId", x.title, s.valence, s.score, s.created_at AS "rankedAt",
               (SELECT e.note FROM entries e WHERE e.user_id = s.user_id AND e.experience_id = s.experience_id
                ORDER BY e.created_at DESC LIMIT 1) AS note
        FROM scored_rankings s JOIN experiences x ON x.id = s.experience_id
        WHERE s.user_id IN (SELECT followee_id FROM follows WHERE follower_id = ${viewerId})
          AND s.created_at < ${before}::timestamptz
        ORDER BY s.created_at DESC
        LIMIT ${FEED_PAGE}
      `
    : await sql`
        SELECT s.user_id AS "userId", s.experience_id AS "experienceId", x.title, s.valence, s.score, s.created_at AS "rankedAt",
               (SELECT e.note FROM entries e WHERE e.user_id = s.user_id AND e.experience_id = s.experience_id
                ORDER BY e.created_at DESC LIMIT 1) AS note
        FROM scored_rankings s JOIN experiences x ON x.id = s.experience_id
        WHERE s.user_id IN (SELECT followee_id FROM follows WHERE follower_id = ${viewerId})
          AND s.created_at > now() - make_interval(days => ${FEED_WINDOW_DAYS})
        ORDER BY s.created_at DESC
      `;

  const oldest = rows.at(-1)?.rankedAt ?? before ?? new Date(Date.now() - FEED_WINDOW_DAYS * 86400000).toISOString();
  const [{ older }] = await sql`
    SELECT EXISTS (
      SELECT 1 FROM rankings
      WHERE user_id IN (SELECT followee_id FROM follows WHERE follower_id = ${viewerId}) AND created_at < ${oldest}::timestamptz
    ) AS older
  `;

  const users = new Map((await people(viewerId, [...new Set(rows.map((r) => r.userId))])).map((p) => [p.id, p]));
  const items = rows.map(({ userId, ...item }) => ({ ...item, user: users.get(userId)! }));
  return { items, hasOlder: older };
}

// People the viewer doesn't follow, best taste match first. Test accounts are never suggested.
export async function peopleLikeYou(viewerId: string): Promise<Person[]> {
  const ids: { id: string }[] = await sql`
    SELECT u.id FROM "user" u
    WHERE u.id <> ${viewerId} AND u.email NOT LIKE '%@example.test'
      AND u.id NOT IN (SELECT followee_id FROM follows WHERE follower_id = ${viewerId})
  `;
  const all = await people(viewerId, ids.map((r) => r.id));
  return all
    .sort((a, b) => (b.match ?? -1) - (a.match ?? -1) || b.shared - a.shared || b.ranked - a.ranked)
    .slice(0, 8);
}

// ---- Profiles and follows ----

export type Profile = Person & { followers: number; following: number; spectrum: SpectrumRow[] };

// Profiles are addressed by handle; ids still resolve so old links keep working.
export async function profile(viewerId: string, handleOrId: string): Promise<Profile> {
  const [user] = await sql`
    SELECT u.id,
           (SELECT count(*)::int FROM follows WHERE followee_id = u.id) AS followers,
           (SELECT count(*)::int FROM follows WHERE follower_id = u.id) AS following
    FROM "user" u WHERE u.username = ${handleOrId.toLowerCase()} OR u.id = ${handleOrId}
  `;
  if (!user) throw new Error(`No one with handle @${handleOrId}`);
  const [person] = await people(viewerId, [user.id]);
  return { ...person!, followers: user.followers, following: user.following, spectrum: await spectrum(user.id) };
}

export async function followList(viewerId: string, handleOrId: string, direction: "followers" | "following"): Promise<Person[]> {
  const [user] = await sql`SELECT id FROM "user" WHERE username = ${handleOrId.toLowerCase()} OR id = ${handleOrId}`;
  if (!user) throw new Error(`No one with handle @${handleOrId}`);
  const ids: { id: string }[] =
    direction === "followers"
      ? await sql`SELECT follower_id AS id FROM follows WHERE followee_id = ${user.id} ORDER BY created_at DESC`
      : await sql`SELECT followee_id AS id FROM follows WHERE follower_id = ${user.id} ORDER BY created_at DESC`;
  return people(viewerId, ids.map((r) => r.id));
}

export async function follow(followerId: string, followeeId: string) {
  if (followerId === followeeId) throw new Error("You can't follow yourself");
  await sql`INSERT INTO follows (follower_id, followee_id) VALUES (${followerId}, ${followeeId}) ON CONFLICT DO NOTHING`;
}

export async function unfollow(followerId: string, followeeId: string) {
  await sql`DELETE FROM follows WHERE follower_id = ${followerId} AND followee_id = ${followeeId}`;
}

// ---- Experiences ----

// An experience's place in everyone's spectrum, plus the viewer's own score if they've rated it.
export type GlobalRow = {
  experienceId: string;
  title: string;
  // Bayesian global score; null until a real (non-test) account has rated it.
  score: number | null;
  raters: number;
  mine: { score: number; valence: Valence } | null;
};

function globalRows(viewerId: string, where: SQL.Query<unknown>, order: SQL.Query<unknown>, limit: number | null) {
  return sql`
    SELECT x.id AS "experienceId", x.title, g.score, coalesce(g.raters, 0)::int AS raters,
           CASE WHEN m.score IS NULL THEN NULL ELSE json_build_object('score', m.score, 'valence', m.valence) END AS mine
    FROM experiences x
    LEFT JOIN global_scores g ON g.experience_id = x.id
    LEFT JOIN scored_rankings m ON m.experience_id = x.id AND m.user_id = ${viewerId}
    WHERE ${where}
    ORDER BY ${order}
    ${limit === null ? sql`` : sql`LIMIT ${limit}`}
  ` as Promise<GlobalRow[]>;
}

// The spectrum of all human experience: everything at least one real person has rated, best first.
export function everything(viewerId: string): Promise<GlobalRow[]> {
  return globalRows(viewerId, sql`g.raters > 0`, sql`g.score DESC, g.raters DESC, x.title`, null);
}

export type ExperienceView = {
  id: string;
  title: string;
  global: { score: number; raters: number } | null;
  // Everyone who has ranked it, best first.
  rankings: { user: Person; valence: Valence; score: number; times: number; note: string }[];
  // The viewer's own entries for it, newest first.
  yours: { entryId: string; occurredOn: string; note: string }[];
};

export async function experience(viewerId: string, experienceId: string): Promise<ExperienceView> {
  const [x] = await sql`
    SELECT x.id, x.title, g.score, g.raters
    FROM experiences x LEFT JOIN global_scores g ON g.experience_id = x.id
    WHERE x.id = ${experienceId}
  `;
  if (!x) throw new Error(`Experience ${experienceId} not found`);

  const [ranked, yours] = await Promise.all([
    sql`
      SELECT s.user_id AS "userId", s.valence, s.score,
             count(e.id)::int AS times,
             (array_agg(e.note ORDER BY e.created_at DESC))[1] AS note
      FROM scored_rankings s
      JOIN entries e ON e.user_id = s.user_id AND e.experience_id = s.experience_id
      WHERE s.experience_id = ${experienceId}
      GROUP BY s.user_id, s.valence, s.score
      ORDER BY s.score DESC
    ` as Promise<{ userId: string; valence: Valence; score: number; times: number; note: string }[]>,
    sql`
      SELECT id AS "entryId", to_char(occurred_on, 'YYYY-MM-DD') AS "occurredOn", note
      FROM entries WHERE user_id = ${viewerId} AND experience_id = ${experienceId}
      ORDER BY created_at DESC
    `,
  ]);

  const users = new Map((await people(viewerId, ranked.map((r) => r.userId))).map((p) => [p.id, p]));
  return {
    id: x.id,
    title: x.title,
    global: x.score === null ? null : { score: x.score, raters: x.raters },
    rankings: ranked.map(({ userId, ...r }) => ({ ...r, user: users.get(userId)! })),
    yours,
  };
}

// ---- Search ----

const SEARCH_LIMIT = 8;
// Below this, embedding neighbors are noise (an unknown name like "oppenheimer" scores ~0.2 against
// everything), so search shows nothing rather than unrelated experiences. Measured on real queries.
const MIN_SEMANTIC_SIMILARITY = 0.35;

// Exact title matches first (named things like "Oppenheimer"), then semantic neighbors (paraphrases like
// "getting dumped" → "Being broken up with over text"). People match on name or handle.
export async function search(viewerId: string, query: string, embedding: number[]): Promise<{ experiences: GlobalRow[]; people: Person[] }> {
  const pattern = `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const [byText, byMeaning, peopleIds] = await Promise.all([
    globalRows(viewerId, sql`x.title ILIKE ${pattern}`, sql`g.raters DESC NULLS LAST, length(x.title)`, SEARCH_LIMIT),
    nearest(embedding, SEARCH_LIMIT),
    sql`
      SELECT id FROM "user"
      WHERE name ILIKE ${pattern} OR username ILIKE ${pattern}
      ORDER BY username = ${query.toLowerCase().replace(/^@/, "")} DESC, name
      LIMIT 5
    ` as Promise<{ id: string }[]>,
  ]);

  const seen = new Set(byText.map((r) => r.experienceId));
  const semanticIds = byMeaning
    .filter((c) => c.similarity >= MIN_SEMANTIC_SIMILARITY)
    .map((c) => c.id)
    .filter((id) => !seen.has(id));
  const semantic = semanticIds.length
    ? await globalRows(viewerId, sql`x.id = ANY(${sql.array(semanticIds, "uuid")})`, sql`x.title`, null)
    : [];
  const semanticOrdered = semanticIds.map((id) => semantic.find((r) => r.experienceId === id)!);

  return {
    experiences: [...byText, ...semanticOrdered].slice(0, SEARCH_LIMIT),
    people: await people(viewerId, peopleIds.map((r) => r.id)),
  };
}
