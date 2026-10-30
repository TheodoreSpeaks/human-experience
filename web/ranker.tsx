import { useEffect, useState } from "react";
import { api, editNote, renameExperience, sendJson, type Pending, type Ranked, type Valence } from "./lib";
import { Editable, Score } from "./ui";

const VALENCE_LABELS: Record<Valence, string> = { good: "Good", fine: "Fine", bad: "Bad" };
const REVEAL_MS = 1400;

// Beli-style, on one screen: pick a valence, binary-search the bucket with "which was better?",
// then the score counts up in place. The header never changes size, so nothing above the stage moves.
// `more`: the dump is still being read, so the queue will grow.
export function Ranker({ item, remaining, more, onDone }: { item: Pending; remaining: number; more: boolean; onDone: () => void }) {
  const [valence, setValence] = useState<Valence | null>(null);
  const [ranked, setRanked] = useState<Ranked[] | null>(null);
  const [range, setRange] = useState<[number, number]>([0, 0]);
  const [result, setResult] = useState<{ score: number; valence: Valence } | null>(null);
  const [settled, setSettled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function place(v: Valence, list: Ranked[], at: number) {
    const placed = await sendJson<{ score: number; valence: Valence }>("POST", "/api/rank", {
      experienceId: item.experienceId,
      valence: v,
      betterId: list[at - 1]?.experienceId ?? null,
      worseId: list[at]?.experienceId ?? null,
    });
    setResult(placed);
  }

  async function chooseValence(v: Valence) {
    setValence(v);
    // On a re-rank the experience is still in its old bucket; never compare it against itself.
    const list = (await api<Ranked[]>(`/api/bucket/${v}`)).filter((r) => r.experienceId !== item.experienceId);
    setRanked(list);
    if (list.length === 0) return place(v, list, 0);
    setRange([0, list.length]);
  }

  function compare(newIsBetter: boolean) {
    const [lo, hi] = range;
    const mid = Math.floor((lo + hi) / 2);
    const next: [number, number] = newIsBetter ? [lo, mid] : [mid + 1, hi];
    setRange(next);
    if (next[0] === next[1]) place(valence!, ranked!, next[0]).catch((e) => setError(e.message));
  }

  const comparing = ranked !== null && range[0] < range[1];
  const opponent = comparing ? ranked[Math.floor((range[0] + range[1]) / 2)]! : null;

  return (
    <section className="ranker">
      <div className="eyebrow">
        <span>
          {remaining} to rank{more && " · more coming"}
        </span>
        {!result && (
          <button
            className="link quiet"
            onClick={() =>
              sendJson("DELETE", `/api/pending/${item.experienceId}`)
                .then(onDone)
                .catch((e) => setError(e.message))
            }
          >
            Discard
          </button>
        )}
      </div>

      <div className="rank-head">
        <div>
          <p className="title">
            {item.titleEditable ? (
              <Editable value={item.title} onSave={(t) => renameExperience(item.experienceId, t).then(onDone)} />
            ) : (
              item.title
            )}
          </p>
          <div className="note">
            <Editable value={item.note} placeholder="Add a note" onSave={(n) => editNote(item.entryId, n).then(onDone)} />
          </div>
          {item.previous && (
            <div className="previous">
              Last time <Score {...item.previous} />
            </div>
          )}
        </div>
        <div className={`big-score ${result?.valence ?? ""}`}>
          {result && <CountUp to={result.score} onSettled={() => setSettled(true)} />}
        </div>
      </div>

      <div className="valences">
        {(Object.keys(VALENCE_LABELS) as Valence[]).map((v) => (
          <button
            key={v}
            className={valence === null ? "" : valence === v ? "chosen" : "dim"}
            disabled={valence !== null}
            onClick={() => chooseValence(v).catch((e) => setError(e.message))}
          >
            {VALENCE_LABELS[v]}
          </button>
        ))}
      </div>

      <div className="stage">
        {opponent && (
          <>
            <p className="prompt">Which was better?</p>
            <div className="versus">
              <button onClick={() => compare(true)}>
                <span className="pick">{item.title}</span>
              </button>
              <span className="or">or</span>
              <button onClick={() => compare(false)}>
                <span className="pick">{opponent.title}</span>
              </button>
            </div>
          </>
        )}
        {result && (
          <button className={`link continue ${settled ? "visible" : ""}`} onClick={onDone} disabled={!settled}>
            {remaining === 1 && !more ? "Done" : "Next"}
          </button>
        )}
      </div>
      {error && <p className="error">{error}</p>}
    </section>
  );
}

// Counts up from 0.0, easing out so it settles onto the number.
export function CountUp({ to, onSettled }: { to: number; onSettled: () => void }) {
  const [shown, setShown] = useState(0);

  useEffect(() => {
    const start = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      const t = Math.min((now - start) / REVEAL_MS, 1);
      setShown(to * (1 - Math.pow(1 - t, 3)));
      if (t < 1) frame = requestAnimationFrame(tick);
      else onSettled();
    });
    return () => cancelAnimationFrame(frame);
  }, [to]);

  return <>{shown.toFixed(1)}</>;
}
