import { useState } from "react";
import { authClient } from "./auth-client";
import { Composer } from "./composer";
import { api, editNote, peopleCount, sendJson, timeAgo, valenceOf, type Person, type SpectrumRow, type Valence } from "./lib";
import { useLoad } from "./load";
import { FollowButton, PersonList, PersonName, profilePath } from "./people";
import { Spectrum } from "./spectrum";
import { Editable, Link, Score } from "./ui";

// ---- Home: write it all down, then see what's new from people you follow ----

type FeedItem = { user: Person; experienceId: string; title: string; valence: Valence; score: number; note: string; rankedAt: string };
type FeedPage = { items: FeedItem[]; hasOlder: boolean; people: Person[] };

// With fewer new items than this, "People like you" moves above the feed: quiet feeds need discovery most.
const QUIET_FEED = 5;

export function Home({ onSubmit }: { onSubmit: (dump: string) => Promise<void> }) {
  const { data, error, reload } = useLoad<FeedPage>("/api/feed");
  // Pages loaded with "Show older", appended after the last week.
  const [older, setOlder] = useState<FeedItem[]>([]);
  const [olderMore, setOlderMore] = useState<boolean | null>(null);
  const [olderError, setOlderError] = useState<string | null>(null);

  if (error) return <p className="error">{error}</p>;

  const items = data ? [...data.items, ...older] : [];
  const hasOlder = olderMore ?? data?.hasOlder ?? false;
  const quiet = data !== null && data.items.length < QUIET_FEED;

  function showOlder() {
    const oldest = items.at(-1)?.rankedAt ?? new Date(Date.now() - 7 * 86400000).toISOString();
    api<FeedPage>(`/api/feed?before=${encodeURIComponent(oldest)}`)
      .then((page) => {
        setOlder((prev) => [...prev, ...page.items]);
        setOlderMore(page.hasOlder);
      })
      .catch((e) => setOlderError(e.message));
  }

  const people = data && data.people.length > 0 && (
    <>
      <h2>People like you</h2>
      <PersonList people={data.people} empty="" onChange={reload} />
    </>
  );

  return (
    <>
      <Composer onSubmit={onSubmit} />
      {quiet && people}

      <h2>Feed</h2>
      {data && items.length === 0 && <p className="empty">Nothing new from people you follow.</p>}
      {items.length > 0 && (
        <ol>
          {items.map((f) => (
            <li key={`${f.user.id}:${f.experienceId}:${f.rankedAt}`}>
              <Score score={f.score} valence={f.valence} />
              <div>
                <Link to={`/e/${f.experienceId}`}>{f.title}</Link>
                {f.note && <div className="note">{f.note}</div>}
                <div className="meta">
                  <Link to={profilePath(f.user)}>{f.user.name}</Link> · {timeAgo(f.rankedAt)}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
      {data && (
        <p className="caught-up">
          You're caught up
          {hasOlder && (
            <>
              {" · "}
              <button className="link" onClick={showOlder}>
                Show older
              </button>
            </>
          )}
        </p>
      )}
      {olderError && <p className="error">{olderError}</p>}

      {!quiet && people}
    </>
  );
}

// ---- Profile: someone's sorted experiences ----

type Profile = Person & { followers: number; following: number; spectrum: SpectrumRow[] };

export function ProfilePage({ handle }: { handle: string }) {
  const { data, error, reload } = useLoad<Profile>(`/api/users/${handle}`);
  if (error) return <p className="error">{error}</p>;
  if (!data) return null;

  const match = data.isYou ? null : data.match !== null ? `${data.match}% match` : data.shared > 0 ? `${data.shared} in common` : null;

  return (
    <>
      <div className="page-head">
        <div>
          <p className="title">{data.name}</p>
          <div className="meta">
            @{data.handle} · {data.ranked} ranked{match && ` · ${match}`}
          </div>
          <div className="meta">
            <Link to={`/u/${data.handle}/followers`}>
              {data.followers} {data.followers === 1 ? "follower" : "followers"}
            </Link>
            {" · "}
            <Link to={`/u/${data.handle}/following`}>{data.following} following</Link>
          </div>
        </div>
        {data.isYou ? (
          <button className="link quiet" onClick={() => authClient.signOut()}>
            Log out
          </button>
        ) : (
          <FollowButton person={data} onChange={reload} />
        )}
      </div>

      <h2>{data.isYou ? "Your sorted experiences" : "Sorted experiences"}</h2>
      <Spectrum
        empty="Nothing ranked yet."
        rows={data.spectrum.map((r) => ({
          key: r.experienceId,
          to: `/e/${r.experienceId}`,
          title: r.title,
          score: r.score,
          valence: r.valence,
          detail: (r.note || r.times > 1) && (
            <>
              {r.note}
              {r.times > 1 && `${r.note ? " · " : ""}${r.times}×`}
            </>
          ),
        }))}
      />
    </>
  );
}

// ---- Experience: everyone's verdict, how it spreads, and your own history ----

type ExperienceView = {
  id: string;
  title: string;
  global: { score: number; raters: number } | null;
  rankings: { user: Person; valence: Valence; score: number; times: number; note: string }[];
  yours: { entryId: string; occurredOn: string; note: string }[];
};

// onQueued refreshes the ranking queue, which opens the ranker over this page.
export function ExperiencePage({ id, onQueued }: { id: string; onQueued: () => void }) {
  const { data, error, reload } = useLoad<ExperienceView>(`/api/experiences/${id}`);
  const [rateError, setRateError] = useState<string | null>(null);
  if (error) return <p className="error">{error}</p>;
  if (!data) return null;

  const mine = data.rankings.find((r) => r.user.isYou);

  return (
    <>
      <div className="page-head">
        <div>
          <p className="title">{data.title}</p>
          <div className="meta">
            {data.global ? peopleCount(data.global.raters) : "No ratings yet"}
            {" · "}
            <button
              className="link inline"
              onClick={() =>
                sendJson("POST", `/api/experiences/${data.id}/rate`)
                  .then(onQueued)
                  .catch((e) => setRateError(e.message))
              }
            >
              {mine ? "Re-rate" : "Rate it"}
            </button>
          </div>
          {rateError && <p className="error">{rateError}</p>}
        </div>
        {data.global && (
          <div className="avg">
            <div className={`avg-score ${valenceOf(data.global.score)}`}>{data.global.score.toFixed(1)}</div>
            <div className="meta">score</div>
          </div>
        )}
      </div>

      {data.rankings.length > 0 && <DotStrip scores={data.rankings.map((r) => ({ score: r.score, you: r.user.isYou }))} />}

      {data.yours.length > 0 && (
        <>
          <h2>You{mine && <> · <Score score={mine.score} valence={mine.valence} /></>}</h2>
          <ol>
            {data.yours.map((e) => (
              <li key={e.entryId}>
                <span className="meta date">{formatDay(e.occurredOn)}</span>
                <div className="note">
                  <Editable value={e.note} placeholder="Add a note" onSave={(n) => editNote(e.entryId, n).then(reload)} />
                </div>
              </li>
            ))}
          </ol>
        </>
      )}

      {data.rankings.length > 0 && (
        <>
          <h2>Everyone</h2>
          <ol>
            {data.rankings.map((r) => (
              <li key={r.user.id} className="rated-by">
                <Score score={r.score} valence={r.valence} />
                <div>
                  <PersonName person={r.user} />
                  {(r.note || r.times > 1) && (
                    <div className="note">
                      {r.note}
                      {r.times > 1 && `${r.note ? " · " : ""}${r.times}×`}
                    </div>
                  )}
                </div>
                <FollowButton person={r.user} onChange={reload} />
              </li>
            ))}
          </ol>
        </>
      )}
    </>
  );
}

// Everyone's score on a 0-10 line, yours marked: shows at a glance whether people agree or split.
function DotStrip({ scores }: { scores: { score: number; you: boolean }[] }) {
  // Identical scores stack upward instead of hiding behind each other.
  const seen = new Map<string, number>();
  const dots = scores.map((s) => {
    const k = s.score.toFixed(1);
    const stack = seen.get(k) ?? 0;
    seen.set(k, stack + 1);
    return { ...s, stack };
  });
  const you = scores.find((s) => s.you);

  return (
    <div className="strip">
      <span className="strip-end">0</span>
      <div className="strip-line">
        {dots.map((d, i) => (
          <span
            key={i}
            className={`strip-dot ${d.you ? "you" : ""}`}
            style={{ left: `${d.score * 10}%`, bottom: `${d.stack * 7}px` }}
          />
        ))}
        {you && (
          <span className="strip-you" style={{ left: `${you.score * 10}%` }}>
            you
          </span>
        )}
      </div>
      <span className="strip-end">10</span>
    </div>
  );
}

function formatDay(day: string): string {
  return new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
