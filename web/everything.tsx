import { peopleCount, valenceOf, type GlobalRow } from "./lib";
import { useLoad } from "./load";
import { Spectrum } from "./spectrum";

// The spectrum of all human experience: every experience anyone has rated, by everyone's verdict.
export function EverythingPage() {
  const { data, error } = useLoad<GlobalRow[]>("/api/everything");
  if (error) return <p className="error">{error}</p>;
  if (!data) return null;

  const rated = data.filter((r) => r.mine).length;

  return (
    <>
      <p className="title">Everything</p>
      <div className="meta">
        {data.length} {data.length === 1 ? "experience" : "experiences"}
        {rated > 0 && ` · ${rated} rated by you`}
      </div>

      <h2>Ranked by everyone</h2>
      <Spectrum
        empty="Nothing has been rated yet."
        rows={data.map((r) => ({
          key: r.experienceId,
          to: `/e/${r.experienceId}`,
          title: r.title,
          score: r.score!,
          valence: valenceOf(r.score!),
          marked: r.mine !== null,
          detail: (
            <>
              {peopleCount(r.raters)}
              {r.mine && ` · you gave it ${r.mine.score.toFixed(1)}`}
            </>
          ),
        }))}
      />
    </>
  );
}
