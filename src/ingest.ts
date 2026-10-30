import { insertEntry, insertExperience, nearest } from "./db";
import { embed, embeddingText } from "./embed";
import { judge } from "./judge";
import { streamSplit, type SplitEvent } from "./split";

const CANDIDATES_K = 8;

export type IngestedEvent = {
  entryId: string;
  experienceId: string;
  title: string;
  note: string;
  isNewExperience: boolean;
};

// Dump → streamed split → per event, as soon as it's written: embed → nearest → judge → store.
// The split is ~90% of the latency, so each event is saved (and rankable) seconds before the split finishes.
export async function ingestDump(opts: {
  userId: string;
  dump: string;
  occurredOn: string;
  onEvent: (event: IngestedEvent) => void;
}): Promise<IngestedEvent[]> {
  // Experiences this dump created. A sibling event can't match them: the splitter already
  // decided they're distinct, and merging would silently drop one of the user's events.
  const createdHere = new Set<string>();
  const inFlight: Promise<IngestedEvent>[] = [];

  const ingest = async (event: SplitEvent): Promise<IngestedEvent> => {
    const [embedding] = await embed([embeddingText(event)]);
    const candidates = (await nearest(embedding!, CANDIDATES_K)).filter((c) => !createdHere.has(c.id));
    const matchId = candidates.length > 0 ? (await judge(event, candidates)).matchId : null;
    const match = matchId === null ? null : candidates.find((c) => c.id === matchId)!;

    const experience = match ?? (await insertExperience({ title: event.title, description: event.description, embedding: embedding! }));
    if (!match) createdHere.add(experience.id);

    const entry = await insertEntry({
      userId: opts.userId,
      experienceId: experience.id,
      occurredOn: opts.occurredOn,
      note: event.note,
      where: event.where,
      withPeople: event.with_people,
      dump: opts.dump,
    });

    const ingested = {
      entryId: entry.id,
      experienceId: experience.id,
      title: experience.title,
      note: event.note,
      isNewExperience: match === null,
    };
    opts.onEvent(ingested);
    return ingested;
  };

  try {
    await streamSplit(opts.dump, (event) => {
      const p = ingest(event);
      // Observed below via Promise.all; this only stops an early failure counting as unhandled mid-stream.
      p.catch(() => {});
      inFlight.push(p);
    });
  } catch (err) {
    await Promise.allSettled(inFlight);
    throw err;
  }
  return Promise.all(inFlight);
}
