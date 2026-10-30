import { useEffect, useState, type ReactNode } from "react";
import type { Valence } from "./lib";
import { Link, Score } from "./ui";

// One row of any ranked list: a profile's sorted experiences or the global spectrum.
export type SpectrumItem = {
  key: string;
  to: string;
  title: string;
  score: number;
  valence: Valence;
  // Secondary line under the title (a note, "41 people", …).
  detail?: ReactNode;
  // Marked rows are highlighted in the list and on the rail (on Everything: ones you've rated).
  marked?: boolean;
};

// The rail never draws more ticks than this; each tick stands for a round-numbered run of ranks.
const MAX_TICKS = 60;
// Every fifth tick is a labeled major tick, like the hour marks on a watch face.
const MAJOR_EVERY = 5;
// The row crossing this fraction of the viewport height counts as "where you are".
const ACTIVE_LINE = 0.35;

const rowId = (rank: number) => `rank-${rank}`;

// A ranked list: rank number on the left, score on the right, and a Codex-style rail
// pinned to the window edge for jumping around long spectrums.
export function Spectrum({ rows, empty }: { rows: SpectrumItem[]; empty: string }) {
  if (rows.length === 0) return <p className="empty">{empty}</p>;
  return (
    <>
      <ol className="spectrum">
        {rows.map((r, i) => (
          <li key={r.key} id={rowId(i + 1)}>
            <span className="rank">{i + 1}</span>
            <div>
              <Link to={r.to}>
                <span className={r.marked ? "highlight" : undefined}>{r.title}</span>
              </Link>
              {r.detail && <div className="note">{r.detail}</div>}
            </div>
            <Score score={r.score} valence={r.valence} />
          </li>
        ))}
      </ol>
      {rows.length > 1 && <Rail rows={rows} />}
    </>
  );
}

// Ranks are 1-based, end inclusive. `label` is set on major ticks.
type Tick = { start: number; end: number; row: SpectrumItem; label: number | null; marked: boolean };

// Smallest of 1, 2, 5, 10, 20, 50, … ranks per tick that fits under MAX_TICKS.
function tickStep(total: number): number {
  for (let magnitude = 1; ; magnitude *= 10) {
    for (const m of [1, 2, 5]) {
      const step = m * magnitude;
      if (Math.ceil(total / step) + 1 <= MAX_TICKS) return step;
    }
  }
}

// Ticks sit at rank 1 and then every multiple of the step, so labels land on round numbers (1, 50, 100, …).
function ticksFor(rows: SpectrumItem[]): Tick[] {
  const step = tickStep(rows.length);
  const starts = [1];
  for (let r = step; r <= rows.length; r += step) if (r > 1) starts.push(r);
  return starts.map((start, i) => ({
    start,
    end: (starts[i + 1] ?? rows.length + 1) - 1,
    row: rows[start - 1]!,
    label: start === 1 || start % (MAJOR_EVERY * step) === 0 ? start : null,
    marked: rows.slice(start - 1, (starts[i + 1] ?? rows.length + 1) - 1).some((r) => r.marked),
  }));
}

// Rank of the row currently crossing the active line.
function useActiveRank(total: number): number {
  const [active, setActive] = useState(1);
  useEffect(() => {
    const update = () => {
      const line = innerHeight * ACTIVE_LINE;
      let rank = 1;
      for (let i = 1; i <= total; i++) {
        const el = document.getElementById(rowId(i));
        if (!el || el.getBoundingClientRect().top > line) break;
        rank = i;
      }
      // The last rows can't scroll up to the line; at the bottom of the page you're at the end.
      const atBottom = innerHeight + scrollY >= document.documentElement.scrollHeight - 2;
      setActive(atBottom ? total : rank);
    };
    update();
    addEventListener("scroll", update, { passive: true });
    addEventListener("resize", update);
    return () => {
      removeEventListener("scroll", update);
      removeEventListener("resize", update);
    };
  }, [total]);
  return active;
}

function Rail({ rows }: { rows: SpectrumItem[] }) {
  const ticks = ticksFor(rows);
  const active = useActiveRank(rows.length);
  const [hovered, setHovered] = useState<number | null>(null);

  return (
    <div className="rail" onMouseLeave={() => setHovered(null)}>
      {ticks.map((t, i) => (
        <button
          key={t.start}
          className={[
            "tick",
            t.row.valence,
            t.label !== null ? "major" : "",
            active >= t.start && active <= t.end ? "active" : "",
            t.marked ? "marked" : "",
          ].join(" ")}
          onMouseEnter={() => setHovered(i)}
          onClick={() => document.getElementById(rowId(t.start))!.scrollIntoView({ behavior: "smooth", block: "start" })}
          aria-label={`Jump to #${t.start}`}
        >
          <span className="label">{t.label}</span>
          <span className="rail-mark" />
          <span className="bar" />
          {hovered === i && (
            <span className="peek">
              <span className="peek-title">
                <span className={t.row.marked ? "highlight" : undefined}>{t.row.title}</span>
              </span>
              <Score score={t.row.score} valence={t.row.valence} />
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
