import { useEffect, useRef, useState } from "react";
import { api, navigate, peopleCount, valenceOf, type GlobalRow, type Person } from "./lib";
import { matchLabel, profilePath } from "./people";
import { Score } from "./ui";

const DEBOUNCE_MS = 250;
const MIN_QUERY = 2;

type Results = { experiences: GlobalRow[]; people: Person[] };

// One box for experiences and people. Search only finds; adding experiences happens through dumps.
export function SearchOverlay({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Results | null>(null);
  // The query whose results are still on their way (typing pauses count as searching too).
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef("");

  useEffect(() => {
    const q = query.trim();
    latest.current = q;
    if (q.length < MIN_QUERY) {
      setResults(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(() => {
      api<Results>(`/api/search?q=${encodeURIComponent(q)}`)
        .then((r) => {
          if (latest.current !== q) return;
          setResults(r);
          setLoading(false);
        })
        .catch((e) => {
          setError(e.message);
          setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const go = (to: string) => {
    onClose();
    navigate(to);
  };

  function openFirst() {
    const first = results?.experiences[0];
    const person = results?.people[0];
    if (first) go(`/e/${first.experienceId}`);
    else if (person) go(profilePath(person));
  }

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="search" onMouseDown={(e) => e.stopPropagation()}>
        <input
          autoFocus
          placeholder="Search experiences and people"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "Enter") openFirst();
          }}
        />

        {results && (
          <ol className="results">
            {results.experiences.map((r) => (
              <li key={r.experienceId}>
                <button onClick={() => go(`/e/${r.experienceId}`)}>
                  <span className="result-title">
                    <span className={r.mine ? "highlight" : undefined}>{r.title}</span>
                  </span>
                  <span className="meta">{r.raters > 0 ? peopleCount(r.raters) : "unrated"}</span>
                  {r.score !== null ? <Score score={r.score} valence={valenceOf(r.score)} /> : <span />}
                </button>
              </li>
            ))}
            {results.people.map((p) => (
              <li key={p.id}>
                <button onClick={() => go(profilePath(p))}>
                  <span className="result-title">{p.name}</span>
                  <span className="meta">
                    @{p.handle}
                    {matchLabel(p) && ` · ${matchLabel(p)}`}
                  </span>
                  <span />
                </button>
              </li>
            ))}
            {!loading && results.experiences.length === 0 && results.people.length === 0 && <li className="empty">No matches.</li>}
          </ol>
        )}

        {loading && <p className="searching">Searching…</p>}
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
