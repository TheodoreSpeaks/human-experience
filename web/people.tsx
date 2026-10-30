import { useState } from "react";
import { sendJson, type Person } from "./lib";
import { useLoad } from "./load";
import { Link } from "./ui";

export const profilePath = (p: { handle: string }) => `/u/${p.handle}`;

// Why this person might matter to you: taste match, or at least what you share.
export function matchLabel(p: Person): string | null {
  if (p.isYou) return "you";
  if (p.match !== null) return `${p.match}% match`;
  if (p.shared > 0) return `${p.shared} in common`;
  return null;
}

export function FollowButton({ person, onChange }: { person: Person; onChange: () => void }) {
  const [error, setError] = useState<string | null>(null);
  if (person.isYou) return null;
  return (
    <span>
      <button
        className={`link ${person.isFollowing ? "quiet" : ""}`}
        onClick={() =>
          sendJson(person.isFollowing ? "DELETE" : "POST", `/api/users/${person.id}/follow`)
            .then(onChange)
            .catch((e) => setError(e.message))
        }
      >
        {person.isFollowing ? "Following" : "Follow"}
      </button>
      {error && <span className="error"> {error}</span>}
    </span>
  );
}

// Name, handle and taste match: how a person reads in any list.
export function PersonName({ person }: { person: Person }) {
  const label = matchLabel(person);
  return (
    <>
      <Link to={profilePath(person)}>{person.name}</Link>
      <span className="meta">
        {" "}
        @{person.handle}
        {label && ` · ${label}`}
      </span>
    </>
  );
}

export function PersonList({ people, empty, onChange }: { people: Person[]; empty: string; onChange: () => void }) {
  if (people.length === 0) return <p className="empty">{empty}</p>;
  return (
    <ol>
      {people.map((p) => (
        <li key={p.id} className="person">
          <div>
            <PersonName person={p} />
            <div className="meta">{p.ranked} ranked</div>
          </div>
          <FollowButton person={p} onChange={onChange} />
        </li>
      ))}
    </ol>
  );
}

export function FollowListPage({ handle, direction }: { handle: string; direction: "followers" | "following" }) {
  const { data, error, reload } = useLoad<Person[]>(`/api/users/${handle}/${direction}`);
  if (error) return <p className="error">{error}</p>;
  if (!data) return null;
  return (
    <>
      <p className="title">{direction === "followers" ? "Followers" : "Following"}</p>
      <div className="meta">
        <Link to={`/u/${handle}`}>@{handle}</Link>
      </div>
      <h2>{data.length === 1 ? "1 person" : `${data.length} people`}</h2>
      <PersonList people={data} empty={direction === "followers" ? "No followers yet." : "Not following anyone yet."} onChange={reload} />
    </>
  );
}
