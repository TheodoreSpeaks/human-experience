import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { type Valence } from "./lib";
import { CountUp } from "./ranker";
import { Link, Score } from "./ui";

// What logged-out visitors see at "/".
export function Landing() {
  return (
    <div className="landing">
      <nav>
        <Link to="/" className="home">
          Every human experience
        </Link>
        <span className="spacer" />
        <Link to="/login">Log in</Link>
      </nav>

      <main>
        <section className="hero">
          <div className="hero-copy">
            <h1>Sort out your life.</h1>
            <p className="sub">Every experience, sorted in one list.</p>
            <p className="caption">
              Talk through your day. Each moment becomes an experience, and you place it by answering one question:
              which was better?
            </p>
            <Link to="/signup" className="cta">
              Start sorting →
            </Link>
          </div>
          <RankerDemo />
        </section>

        <section>
          <h2>Movies, meals, books, the day your kid was born. One list.</h2>
          <Funnel />
        </section>

        <section>
          <Steps />
        </section>

        <section className="closer">
          <p className="closer-line">Start with today.</p>
          <Link to="/signup" className="cta">
            Start sorting →
          </Link>
        </section>
      </main>
    </div>
  );
}

// ---- The ranker, mid-comparison, as it looks in the app. Pick one and the score lands. ----

const DEMO = {
  title: "A grandparent nearing the end of life",
  note: "Grandma dying.",
  opponent: "A hired photographer asking when they're showing up",
  // Score the new experience gets depending on which side was picked as better.
  scoreIfBetter: 1.8,
  scoreIfWorse: 0.4,
};

function RankerDemo() {
  const [score, setScore] = useState<number | null>(null);
  const [settled, setSettled] = useState(false);

  const reset = () => {
    setScore(null);
    setSettled(false);
  };

  return (
    <div className="demo">
      <section className="ranker">
        <div className="eyebrow">
          <span>1 to rank</span>
          {/* Where Discard sits in the app; once the score lands it offers the other answer instead. */}
          {score === null ? (
            <span className="quiet-text">Discard</span>
          ) : (
            <button className={`link quiet retry ${settled ? "visible" : ""}`} onClick={reset} disabled={!settled}>
              Try the other answer
            </button>
          )}
        </div>
        <div className="rank-head">
          <div>
            <p className="title">{DEMO.title}</p>
            <div className="note">{DEMO.note}</div>
          </div>
          <div className={`big-score ${score === null ? "" : "bad"}`}>
            {score !== null && <CountUp key={score} to={score} onSettled={() => setSettled(true)} />}
          </div>
        </div>
        <div className="valences">
          <span className="dim">Good</span>
          <span className="dim">Fine</span>
          <span className="chosen">Bad</span>
        </div>
        <div className="stage">
          <p className="prompt">Which was better?</p>
          <div className={`versus ${score === null ? "" : "picked"}`}>
            <button disabled={score !== null} onClick={() => setScore(DEMO.scoreIfBetter)}>
              {DEMO.title}
            </button>
            <span className="or">or</span>
            <button disabled={score !== null} onClick={() => setScore(DEMO.scoreIfWorse)}>
              {DEMO.opponent}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

// ---- Steps: brain dump, compare, share, each with a small moving picture of that screen. ----

// Steps through 0..count-1 forever; stays on 0 for people who turn motion off.
function useCycle(count: number, ms: number): number {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(() => setI((n) => (n + 1) % count), ms);
    return () => clearInterval(timer);
  }, [count, ms]);
  return i;
}

function Steps() {
  return (
    <div className="steps">
      <Step title="Brain dump" text="Talk or type through your day. It comes apart into separate experiences.">
        <DumpPicture />
      </Step>
      <Step title="Compare" text="Place each one by answering which was better. The score follows from where it lands.">
        <ComparePicture />
      </Step>
      <Step title="Share" text="Follow friends, see what they're ranking, and how everyone felt about the same thing.">
        <SharePicture />
      </Step>
    </div>
  );
}

function Step({ title, text, children }: { title: string; text: string; children: ReactNode }) {
  return (
    <div className="step">
      <div className="picture">{children}</div>
      <p className="step-title">{title}</p>
      <p className="step-text">{text}</p>
    </div>
  );
}

// Each sentence of the dump and the experience it becomes.
const DUMP: { said: string; becomes: string }[] = [
  { said: "Hiked Muir Woods with Sam.", becomes: "Hiking among redwoods" },
  { said: "Wet socks the whole way back.", becomes: "Wet socks for the rest of a hike" },
  { said: "Best ramen I've had.", becomes: "A perfect bowl of ramen" },
];

function DumpPicture() {
  const active = useCycle(DUMP.length, 1600);
  return (
    <div className="dump-picture">
      <p className="dump-text">
        {DUMP.map((d, i) => (
          <span key={i} className={`said ${i === active ? "active" : ""}`}>
            {d.said}{" "}
          </span>
        ))}
      </p>
      <div className="chips">
        {DUMP.map((d, i) => (
          <span key={i} className={`chip ${i === active ? "active" : ""}`}>
            {d.becomes}
          </span>
        ))}
      </div>
    </div>
  );
}

const PAIRS: [string, string][] = [
  ["Wet socks for the rest of a hike", "Waiting at the DMV"],
  ["A perfect bowl of ramen", "Homemade dumplings with family"],
  ["Hiking among redwoods", "First swim of summer"],
];

function ComparePicture() {
  // Two beats per pair: show it, then pick one.
  const beat = useCycle(PAIRS.length * 2, 1100);
  const [a, b] = PAIRS[Math.floor(beat / 2)]!;
  const picked = beat % 2 === 1;
  return (
    <div className="compare-picture">
      <p className="prompt">Which was better?</p>
      <div className={`mini-versus ${picked ? "picked" : ""}`}>
        <span className="mini-card chosen">{a}</span>
        <span className="or">or</span>
        <span className="mini-card">{b}</span>
      </div>
    </div>
  );
}

const FEED: { name: string; title: string; score: number; valence: Valence; when: string }[] = [
  { name: "Sam", title: "Wet socks for the rest of a hike", score: 2.8, valence: "bad", when: "2h" },
  { name: "Priya", title: "A perfect bowl of ramen", score: 9.1, valence: "good", when: "5h" },
  { name: "Jordan", title: "Falling asleep halfway through a movie", score: 5.4, valence: "fine", when: "1d" },
];

function SharePicture() {
  const newest = useCycle(FEED.length, 1800);
  return (
    <ol className="share-picture">
      {FEED.map((f, i) => (
        <li key={f.name} className={i === newest ? "active" : ""}>
          <Score score={f.score} valence={f.valence} />
          <div>
            <div className="share-title">{f.title}</div>
            <div className="meta">
              {f.name} · {f.when}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

// ---- Funnel: experiences stream from every corner of life through the sorter into one endlessly scrolling list. ----

type Source = "movies" | "books" | "food" | "life";
type Item = { title: string; source: Source; score: number; valence: Valence };

const EXPERIENCES: Item[] = [
  { title: "Getting the job", source: "life", score: 9.6, valence: "good" },
  { title: "Your best friend's wedding toast", source: "life", score: 9.4, valence: "good" },
  { title: "First swim of summer", source: "life", score: 9.1, valence: "good" },
  { title: "Homemade dumplings with family", source: "food", score: 9.0, valence: "good" },
  { title: "A bookstore on a rainy afternoon", source: "books", score: 8.1, valence: "good" },
  { title: "Rewatching a childhood favorite", source: "movies", score: 7.9, valence: "good" },
  { title: "A book club book nobody finished", source: "books", score: 4.9, valence: "fine" },
  { title: "A forgettable sequel", source: "movies", score: 4.8, valence: "fine" },
  { title: "Lukewarm coffee", source: "food", score: 4.5, valence: "fine" },
  { title: "Wet socks for the rest of a hike", source: "life", score: 3.1, valence: "bad" },
  { title: "Waiting at the DMV", source: "life", score: 2.9, valence: "bad" },
  { title: "Getting the ending spoiled", source: "movies", score: 2.7, valence: "bad" },
  { title: "Missing a connecting flight", source: "life", score: 1.9, valence: "bad" },
  { title: "Crying at the end of Past Lives", source: "movies", score: 8.4, valence: "good" },
  { title: "Gas station sushi", source: "food", score: 1.4, valence: "bad" },
  { title: "Holding your newborn for the first time", source: "life", score: 10.0, valence: "good" },
  { title: "Abandoning a book at page 40", source: "books", score: 3.6, valence: "fine" },
  { title: "A perfect bowl of ramen at 1am", source: "food", score: 8.9, valence: "good" },
  { title: "Falling asleep halfway through Oppenheimer", source: "movies", score: 5.1, valence: "fine" },
  { title: "A grandparent nearing the end of life", source: "life", score: 0.6, valence: "bad" },
  { title: "Finishing a 900-page novel", source: "books", score: 7.6, valence: "good" },
  { title: "Airport pasta", source: "food", score: 4.2, valence: "fine" },
];

const SOURCES: { key: Source; label: string; glyph: ReactNode }[] = [
  { key: "movies", label: "Movies", glyph: <LetterboxdGlyph /> },
  { key: "books", label: "Books", glyph: <BookGlyph /> },
  { key: "food", label: "Food", glyph: <ForkGlyph /> },
  { key: "life", label: "Life", glyph: <HeartGlyph /> },
];
const glyphOf = Object.fromEntries(SOURCES.map((s) => [s.key, s.glyph])) as Record<Source, ReactNode>;

const SORTED = [...EXPERIENCES].sort((a, b) => b.score - a.score);

const ROW_H = 48;
const VISIBLE_ROWS = 7;
// One full pass of the list takes this long; it then wraps seamlessly.
const SCROLL_S = SORTED.length * 2.2;
// Dots in flight per incoming pipe, how long each takes to cross, and the same for the outgoing pipe.
const DOTS_PER_PIPE = 3;
const IN_S = 2.4;
const OUT_DOTS = 4;
const OUT_S = 0.9;

// Pipes are drawn from where the boxes actually are, so CSS alone decides the layout:
// left to right on wide screens, top down on phones.
type Geometry = { width: number; height: number; inPaths: string[]; outPath: string };

function measure(root: HTMLElement): Geometry {
  const origin = root.getBoundingClientRect();
  const rel = (el: Element) => {
    const r = el.getBoundingClientRect();
    return { left: r.left - origin.left, right: r.right - origin.left, top: r.top - origin.top, bottom: r.bottom - origin.top };
  };
  const column = rel(root.querySelector(".sources")!);
  const box = rel(root.querySelector(".sorter")!);
  const list = rel(root.querySelector(".sorted")!);
  const tiles = [...root.querySelectorAll(".source")].map(rel);
  const horizontal = box.left >= column.right;

  const curve = (x1: number, y1: number, x2: number, y2: number) =>
    horizontal
      ? `M ${x1} ${y1} C ${(x1 + x2) / 2} ${y1}, ${(x1 + x2) / 2} ${y2}, ${x2} ${y2}`
      : `M ${x1} ${y1} C ${x1} ${(y1 + y2) / 2}, ${x2} ${(y1 + y2) / 2}, ${x2} ${y2}`;

  const boxMidX = (box.left + box.right) / 2;
  const boxMidY = (box.top + box.bottom) / 2;
  const inPaths = tiles.map((t) =>
    horizontal
      ? curve(column.right + 12, (t.top + t.bottom) / 2, box.left, boxMidY)
      : curve((t.left + t.right) / 2, column.bottom + 8, boxMidX, box.top),
  );
  const outPath = horizontal
    ? `M ${box.right} ${boxMidY} L ${list.left - 8} ${boxMidY}`
    : `M ${boxMidX} ${box.bottom} L ${boxMidX} ${list.top - 8}`;
  return { width: origin.width, height: origin.height, inPaths, outPath };
}

// `count` dots riding the path forever, evenly spaced, fading in and out at the ends.
// `offset` (0–1) staggers pipes so their dots don't all reach the box together.
function Dots({ pathId, count, seconds, offset }: { pathId: string; count: number; seconds: number; offset: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => {
        const begin = `-${(((i / count + offset) % 1) * seconds).toFixed(2)}s`;
        return (
          <circle key={i} r="4" className="flow-dot">
            <animateMotion dur={`${seconds}s`} begin={begin} repeatCount="indefinite" calcMode="linear">
              <mpath href={`#${pathId}`} />
            </animateMotion>
            <animate
              attributeName="opacity"
              dur={`${seconds}s`}
              begin={begin}
              repeatCount="indefinite"
              values="0;1;1;0"
              keyTimes="0;0.12;0.88;1"
            />
          </circle>
        );
      })}
    </>
  );
}

function Funnel() {
  const [geometry, setGeometry] = useState<Geometry | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const id = useId().replace(/:/g, "");

  useEffect(() => {
    const el = root.current!;
    const update = () => setGeometry(measure(el));
    const observer = new ResizeObserver(update);
    observer.observe(el);
    document.fonts.ready.then(update);
    return () => observer.disconnect();
  }, []);

  const row = (item: Item, rank: number, copy: number) => (
    <div key={`${copy}:${item.title}`} className="sorted-row" style={{ height: ROW_H }}>
      <span className="rank">{rank + 1}</span>
      <span className="glyph">{glyphOf[item.source]}</span>
      <span className="sorted-title">{item.title}</span>
      <Score score={item.score} valence={item.valence} />
    </div>
  );

  return (
    <div className="funnel" ref={root}>
      {geometry && (
        <svg className="pipes" viewBox={`0 0 ${geometry.width} ${geometry.height}`} aria-hidden>
          {geometry.inPaths.map((d, i) => (
            <path key={i} id={`${id}-in-${i}`} d={d} />
          ))}
          <path id={`${id}-out`} d={geometry.outPath} />
          <g className="flow">
            {geometry.inPaths.map((_, i) => (
              <Dots key={i} pathId={`${id}-in-${i}`} count={DOTS_PER_PIPE} seconds={IN_S} offset={i * 0.29} />
            ))}
            <Dots pathId={`${id}-out`} count={OUT_DOTS} seconds={OUT_S} offset={0} />
          </g>
        </svg>
      )}

      <div className="sources">
        {SOURCES.map((s) => (
          <div key={s.key} className="source">
            <span className="glyph">{s.glyph}</span>
            {s.label}
          </div>
        ))}
      </div>

      <div className="sorter" aria-label="Sorted by you">
        <span />
        <span />
        <span />
      </div>

      <div className="sorted" style={{ height: ROW_H * VISIBLE_ROWS }}>
        {/* Two copies back to back: scrolling up by exactly one copy and wrapping looks endless. */}
        <div className="sorted-track" style={{ animationDuration: `${SCROLL_S}s` }}>
          {SORTED.map((item, rank) => row(item, rank, 0))}
          {SORTED.map((item, rank) => row(item, rank, 1))}
        </div>
      </div>
    </div>
  );
}

// Three overlapping rings, drawn as line icons like the others.
function LetterboxdGlyph() {
  return (
    <svg viewBox="0 0 24 12" width="24" height="12" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden>
      <circle cx="5.5" cy="6" r="4.5" />
      <circle cx="12" cy="6" r="4.5" />
      <circle cx="18.5" cy="6" r="4.5" />
    </svg>
  );
}

function BookGlyph() {
  return (
    <svg viewBox="0 0 20 16" width="20" height="16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden>
      <path d="M10 3.5C8 2 5 1.5 1.5 2v11c3.5-.5 6.5 0 8.5 1.5 2-1.5 5-2 8.5-1.5V2C15 1.5 12 2 10 3.5Z" />
      <path d="M10 3.5v11" />
    </svg>
  );
}

function ForkGlyph() {
  return (
    <svg viewBox="0 0 16 18" width="16" height="18" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden>
      <path d="M4 1v5.5M2 1v4a2 2 0 0 0 4 0V1M4 7.5V17" />
      <path d="M12.5 17V1c-2 1.5-3 4-3 7h3" />
    </svg>
  );
}

function HeartGlyph() {
  return (
    <svg viewBox="0 0 18 16" width="18" height="16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden>
      <path d="M9 14.5S1.5 10 1.5 5.2A3.7 3.7 0 0 1 9 3.6a3.7 3.7 0 0 1 7.5 1.6C16.5 10 9 14.5 9 14.5Z" />
    </svg>
  );
}
