import { join } from "path";
import { auth, googleEnabled, HttpError, requireUser } from "./auth";
import {
  bucket,
  discardPending,
  experienceDescription,
  pending,
  queueRating,
  rank,
  renameExperience,
  scoreOf,
  spectrum,
  updateEntryNote,
  VALENCES,
  type Valence,
} from "./db";
import { embed, embeddingText } from "./embed";
import { ingestDump } from "./ingest";
import { everything, experience, feed, follow, followList, peopleLikeYou, profile, search, unfollow } from "./social";
import { WEB_ASSETS } from "./generated/web-assets";
import { createTranscriptionSecret } from "./transcribe";

function requiredText(v: unknown, field: string): string {
  if (typeof v !== "string" || !v.trim()) throw new HttpError(400, `${field} must be non-empty text`);
  return v.trim();
}

function parseValence(v: unknown): Valence {
  if (!VALENCES.includes(v as Valence)) throw new HttpError(400, `Invalid valence: ${v}`);
  return v as Valence;
}

// Production (Vercel) serves the frontend prebuilt by `bun run build`; Vercel can't serve HTML imports.
// Local dev bundles it live with hot reload.
const production = process.env.NODE_ENV === "production";
if (production && !WEB_ASSETS) throw new Error("Frontend isn't built: run `bun run build` before starting in production");

const assetResponse = (path: string) => {
  const asset = WEB_ASSETS![path]!;
  return new Response(asset.body, {
    headers: {
      "Content-Type": asset.type,
      "Cache-Control": asset.immutable ? "public, max-age=31536000, immutable" : "no-cache",
    },
  });
};

// The dev page is loaded by a runtime-computed path so the production bundler never follows it.
const index = production ? () => assetResponse("/index.html") : (await import(join(import.meta.dir, "../web/index.html"))).default;

const frontend = production
  ? Object.fromEntries(Object.keys(WEB_ASSETS!).map((path) => [path, () => assetResponse(path)]))
  : {
      // Read from disk per request: Bun's dev bundler keeps serving stale CSS after edits.
      "/styles.css": () =>
        new Response(Bun.file(join(import.meta.dir, "../web/styles.css")), { headers: { "Cache-Control": "no-store" } }),
    };

const server = Bun.serve({
  routes: {
    // Client-side routes all serve the app.
    "/": index,
    "/u/:id": index,
    "/e/:id": index,
    "/everything": index,
    "/u/:id/:list": index,
    "/login": index,
    "/signup": index,

    ...frontend,

    "/api/auth/*": (req) => auth.handler(req),

    "/api/auth-config": { GET: () => Response.json({ google: googleEnabled }) },

    "/api/transcribe/session": {
      POST: async (req) => {
        await requireUser(req);
        return Response.json({ secret: await createTranscriptionSecret() });
      },
    },

    "/api/dump": {
      POST: async (req) => {
        const user = await requireUser(req);
        const dump = requiredText((await req.json()).dump, "dump");
        const occurredOn = new Date().toISOString().slice(0, 10);

        // Newline-delimited JSON progress: one line per saved event, then done or error.
        // Ingestion runs to completion even if the client goes away; the stream only reports.
        const encoder = new TextEncoder();
        let controller!: ReadableStreamDefaultController<Uint8Array>;
        let open = true;
        const body = new ReadableStream<Uint8Array>({
          start: (c) => {
            controller = c;
          },
          cancel: () => {
            open = false;
          },
        });
        const send = (line: object) => {
          if (open) controller.enqueue(encoder.encode(JSON.stringify(line) + "\n"));
        };

        ingestDump({ userId: user.id, dump, occurredOn, onEvent: (event) => send({ type: "event", event }) })
          .then(() => send({ type: "done" }))
          .catch((err: Error) => {
            console.error(err);
            send({ type: "error", error: err.message });
          })
          .finally(() => {
            if (open) controller.close();
          });

        return new Response(body, { headers: { "Content-Type": "application/x-ndjson" } });
      },
    },

    "/api/pending": {
      GET: async (req) => Response.json(await pending((await requireUser(req)).id)),
    },

    "/api/pending/:experienceId": {
      DELETE: async (req) => {
        await discardPending((await requireUser(req)).id, req.params.experienceId);
        return Response.json({ ok: true });
      },
    },

    "/api/bucket/:valence": {
      GET: async (req) => Response.json(await bucket((await requireUser(req)).id, parseValence(req.params.valence))),
    },

    "/api/rank": {
      POST: async (req) => {
        const user = await requireUser(req);
        const body = (await req.json()) as { experienceId: string; valence: string; betterId: string | null; worseId: string | null };
        await rank({ userId: user.id, ...body, valence: parseValence(body.valence) });
        return Response.json(await scoreOf(user.id, body.experienceId));
      },
    },

    "/api/spectrum": {
      GET: async (req) => Response.json(await spectrum((await requireUser(req)).id)),
    },

    "/api/feed": {
      GET: async (req) => {
        const user = await requireUser(req);
        const before = new URL(req.url).searchParams.get("before");
        const [page, people] = await Promise.all([feed(user.id, before), before ? [] : peopleLikeYou(user.id)]);
        return Response.json({ ...page, people });
      },
    },

    "/api/everything": {
      GET: async (req) => Response.json(await everything((await requireUser(req)).id)),
    },

    "/api/search": {
      GET: async (req) => {
        const user = await requireUser(req);
        const q = requiredText(new URL(req.url).searchParams.get("q"), "q");
        const [embedding] = await embed([q]);
        return Response.json(await search(user.id, q, embedding!));
      },
    },

    // Profiles by handle (or id, for old links).
    "/api/users/:id": {
      GET: async (req) => Response.json(await profile((await requireUser(req)).id, req.params.id)),
    },

    "/api/users/:id/followers": {
      GET: async (req) => Response.json(await followList((await requireUser(req)).id, req.params.id, "followers")),
    },

    "/api/users/:id/following": {
      GET: async (req) => Response.json(await followList((await requireUser(req)).id, req.params.id, "following")),
    },

    "/api/users/:id/follow": {
      POST: async (req) => {
        await follow((await requireUser(req)).id, req.params.id);
        return Response.json({ ok: true });
      },
      DELETE: async (req) => {
        await unfollow((await requireUser(req)).id, req.params.id);
        return Response.json({ ok: true });
      },
    },

    "/api/experiences/:id/rate": {
      POST: async (req) => {
        await queueRating((await requireUser(req)).id, req.params.id);
        return Response.json({ ok: true });
      },
    },

    "/api/experiences/:id": {
      GET: async (req) => Response.json(await experience((await requireUser(req)).id, req.params.id)),
      PATCH: async (req) => {
        const user = await requireUser(req);
        const title = requiredText((await req.json()).title, "title");
        const description = await experienceDescription(req.params.id);
        const [embedding] = await embed([embeddingText({ title, description })]);
        await renameExperience({ userId: user.id, experienceId: req.params.id, title, embedding: embedding! });
        return Response.json({ ok: true });
      },
    },

    "/api/entries/:id": {
      PATCH: async (req) => {
        const user = await requireUser(req);
        const note = requiredText((await req.json()).note, "note");
        await updateEntryNote({ userId: user.id, entryId: req.params.id, note });
        return Response.json({ ok: true });
      },
    },
  },

  error(err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) console.error(err);
    return Response.json({ error: err.message }, { status });
  },

  development: production ? false : { hmr: true, console: true },
});

console.log(`listening on ${server.url}`);
