import { choice, TypeSafeClient } from "@typesafe-ai/sdk";

export type Candidate = { id: string; title: string; description: string };
export type JudgeInput = { title: string; description: string; note: string };
export type Verdict = { matchId: string | null; probability: number };

// The winning candidate must clear this to merge; otherwise we create a new experience.
// A wrong merge corrupts everyone's rankings, a duplicate can be merged later. Tune via evals/judge.eval.ts.
export const MATCH_MIN_PROBABILITY = 0.6;

const NEW = "new";

const INSTRUCTIONS = `This is a catalog of every human experience. People rank catalog entries against the rest of their life. Is the NEW experience in the state the same as one of the existing catalog entries, or is it new?

Two experiences are the same if they share the same core feeling with the same cause, so a person would rank them as one thing.
- Incidental details do NOT make experiences different: the setting, who you were with, dates, amounts, minor details.
- A name that identifies the shared thing being experienced DOES: a specific movie, book, album, game, artist, show, landmark, or event. Different named things are always different experiences, however similar.
- A different cause of the feeling DOES make them different, even with the same object or activity.
- Opposite or different feelings about the same thing are different experiences.
- Context matters only when it changes the feeling.

Same: "Hiking through towering redwoods" = "Walking among giant redwoods". "Finding a $20 bill in your winter coat" = "Finding cash in an old jacket pocket". "Burrito after a long hike" = "Eating a huge meal after a day of exercise". "Watching Inception" = "Seeing Inception (2010)". "Listening to Blonde by Frank Ocean" = "Hearing Frank Ocean's Blonde".
Different: "Your coffee going cold before you drink it" ≠ "The first sip of coffee in the morning". "Getting caught in the rain" ≠ "Listening to rain from bed". "Stepping in a puddle in socks indoors" ≠ "Wet socks for the rest of a hike". "Flight delayed" ≠ "Flight canceled". "Watching Inception" ≠ "Watching Interstellar". "Reading Dune" ≠ "Watching Dune (2021)". "Watching Inception" ≠ "Falling asleep during Inception".`;

// The SDK takes and releases a reader on each response body before parsing it. Bun marks an
// already-buffered body as used once a reader is taken, so the SDK's later res.text() throws
// "Body already used". Re-wrapping the body as a stream keeps it readable under Bun.
async function streamingFetch(input: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
}

const client = new TypeSafeClient({ fetch: streamingFetch });

export async function judge(event: JudgeInput, candidates: Candidate[]): Promise<Verdict> {
  if (candidates.length === 0) {
    throw new Error("judge() called with no candidates");
  }

  const labelToId = new Map(candidates.map((c, i) => [`c${i + 1}`, c.id]));
  const criteria: Record<string, string> = Object.fromEntries(
    candidates.map((c, i) => [`c${i + 1}`, `${c.title}: ${c.description}`]),
  );
  criteria[NEW] = "None of the existing entries is the same experience.";

  const { answers } = await client.systemOne({
    state: { new_experience: event },
    questions: { match: choice(INSTRUCTIONS, criteria) },
  });

  const label = answers.match.choice;
  const probability = answers.match.probabilities[label]!;
  if (label === NEW || probability < MATCH_MIN_PROBABILITY) {
    return { matchId: null, probability };
  }

  const matchId = labelToId.get(label);
  if (!matchId) throw new Error(`Jev returned unknown label "${label}" for "${event.title}"`);
  return { matchId, probability };
}
