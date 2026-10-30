import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { authClient } from "./auth-client";
import { api, usePath, type Pending } from "./lib";
import { Landing } from "./landing";
import { Login } from "./login";
import { EverythingPage } from "./everything";
import { ExperiencePage, Home, ProfilePage } from "./pages";
import { FollowListPage } from "./people";
import { SearchOverlay } from "./search";
import { Ranker } from "./ranker";
import { Link } from "./ui";

function App() {
  const { data: session, isPending } = authClient.useSession();
  const path = usePath();
  if (isPending) return <main />;
  if (!session) {
    if (path === "/login") return <Login initialMode="signIn" />;
    if (path === "/signup") return <Login initialMode="signUp" />;
    return <Landing />;
  }
  return <SignedIn user={session.user} />;
}

type DumpLine = { type: "event" } | { type: "done" } | { type: "error"; error: string };

// Reads a newline-delimited JSON response, calling onLine for each complete line.
async function readLines(body: ReadableStream<Uint8Array>, onLine: (line: DumpLine) => void) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      onLine(JSON.parse(buffer.slice(0, newline)));
      buffer = buffer.slice(newline + 1);
    }
  }
}

function SignedIn({ user }: { user: { id: string; name: string; username?: string | null } }) {
  if (!user.username) throw new Error("Signed-in user has no handle");
  const handle = user.username;
  const [searching, setSearching] = useState(false);

  // "/" opens search from anywhere, unless you're typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || /^(INPUT|TEXTAREA)$/.test(e.target.tagName));
      if (e.key === "/" && !typing) {
        e.preventDefault();
        setSearching(true);
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);
  const path = usePath();
  const [queue, setQueue] = useState<Pending[] | null>(null);
  // Bumped after ranking so pages refetch and show new scores.
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // A dump still being split and saved; events join the ranking queue as they land.
  const [ingesting, setIngesting] = useState(false);
  const [received, setReceived] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  // Events land close together; only the newest queue fetch may win.
  const latest = useRef(0);

  const refresh = () => {
    const mine = ++latest.current;
    return api<Pending[]>("/api/pending")
      .then((q) => {
        if (mine !== latest.current) return;
        setQueue(q);
        setVersion((v) => v + 1);
      })
      .catch((e) => setError(e.message));
  };

  useEffect(() => {
    refresh();
  }, []);

  // Resolves once the first event is saved (the ranker takes over) or the dump had none.
  // The stream keeps being read afterwards so later events keep joining the queue.
  async function submitDump(dump: string): Promise<void> {
    const res = await fetch("/api/dump", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dump }),
    });
    if (!res.ok) throw new Error((await res.json()).error ?? `Dump failed with ${res.status}`);
    setIngesting(true);
    setReceived(0);
    setNotice(null);

    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (message: string) => {
        setIngesting(false);
        if (settled) {
          // Some events were saved: keep them rankable and say the rest failed.
          refresh();
          setNotice(`Some of that couldn't be read: ${message}`);
        } else {
          // Nothing saved: reject so the text box shows the error and keeps the dump.
          settled = true;
          reject(new Error(message));
        }
      };
      readLines(res.body!, (line) => {
        if (line.type === "event") {
          setReceived((n) => n + 1);
          refresh();
        } else if (line.type === "done") {
          setIngesting(false);
          refresh();
        } else {
          return fail(line.error);
        }
        if (!settled) {
          settled = true;
          resolve();
        }
      }).catch((e) => fail((e as Error).message));
    });
  }

  if (error) return <main><p className="error">{error}</p></main>;
  if (!queue) return <main />;

  const noticeLine = notice && <p className="error">{notice}</p>;

  // Anything waiting to be ranked takes over until it's done.
  const current = queue[0];
  if (current) {
    return (
      <main>
        {noticeLine}
        <Ranker key={current.entryId} item={current} remaining={queue.length} more={ingesting} onDone={refresh} />
      </main>
    );
  }
  // Ranked faster than the dump is being read.
  if (ingesting && received > 0) {
    return (
      <main>
        <p className="status waiting">Reading the rest…</p>
      </main>
    );
  }

  const [, section, id, sub] = path.split("/");
  const page =
    path === "/" ? (
      <Home key={version} onSubmit={submitDump} />
    ) : path === "/everything" ? (
      <EverythingPage key={version} />
    ) : section === "u" && id && (sub === "followers" || sub === "following") ? (
      <FollowListPage key={`${id}:${sub}:${version}`} handle={id} direction={sub} />
    ) : section === "u" && id && !sub ? (
      <ProfilePage key={`${id}:${version}`} handle={id} />
    ) : section === "e" && id ? (
      <ExperiencePage key={`${id}:${version}`} id={id} onQueued={refresh} />
    ) : (
      <p className="empty">Nothing here.</p>
    );

  return (
    <>
      <nav>
        <Link to="/" className="home">
          Every human experience
        </Link>
        <span className="spacer" />
        <Link to="/everything">Everything</Link>
        <button className="link" onClick={() => setSearching(true)}>
          Search
        </button>
        <Link to={`/u/${handle}`}>{user.name}</Link>
      </nav>
      <main>
        {noticeLine}
        {page}
      </main>
      {searching && <SearchOverlay onClose={() => setSearching(false)} />}
    </>
  );
}

// Reuse the root across hot reloads in dev.
const container = document.getElementById("root")!;
if (import.meta.hot) {
  (import.meta.hot.data.root ??= createRoot(container)).render(<App />);
} else {
  createRoot(container).render(<App />);
}
