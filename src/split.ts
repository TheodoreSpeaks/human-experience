import { z } from "zod";
import { ArrayItemParser, streamStructuredText, type LlmConfig } from "./llm";

// The split is ~90% of dump latency. Check eval:split and the media-name check before changing it.
export const SPLIT_CONFIG: LlmConfig = { provider: "anthropic", model: "claude-opus-5-5", effort: "low" };

export const SplitEvent = z.object({
  title: z.string().describe("Canonical experience name, 3-10 words; keeps the name of a shared thing being experienced"),
  description: z
    .string()
    .describe("One generalized sentence naming the core feeling and what causes it"),
  where: z.string().nullable().describe("Specific place from the dump, if any"),
  with_people: z.array(z.string()).describe("People mentioned as part of it"),
  note: z.string().describe("The user's specific version in their own flavor, 1 sentence"),
});
export type SplitEvent = z.infer<typeof SplitEvent>;

const SplitResult = z.object({ events: z.array(SplitEvent) });

const SYSTEM = `You turn someone's brain dump into a list of distinct human experiences. It might cover today, or anything from their whole life: a first-time dump can span years. Each experience will be matched against a shared global catalog of every human experience, then ranked by the user against everything else they've ever experienced.

## The granularity target

Experiences sit on a ladder:
- "Hiking" — too broad. No specific feeling.
- "Walking through a redwood forest" — an activity in a setting. OK when the setting is the whole point.
- "Wet socks for the rest of a hike" — a MOMENT. This is the sweet spot.
- "Wet socks in Muir Woods on Tuesday" — an instance. Too specific; only this person has had it.

Aim for the moment rung. A good canonical experience:
1. Has ONE core feeling with ONE cause. If the feeling or its cause changes, that's a new experience.
2. Is concrete enough to be funny or vivid — it has a hook (a sensory detail, a twist, an irony). "Bad weather" is too vague; "Your umbrella flipping inside out" is right.
3. Keeps a name only when it identifies the shared thing being experienced. Test: could a stranger have had this exact experience with this exact named thing? "Watching Inception", "Reading Dune", "Seeing Radiohead live", "Seeing the Grand Canyon for the first time" keep their names: the named thing IS the experience, and millions share it. Names that are private or incidental context get dropped: people ("Sam" → "a friend"), your workplace, and places or brands that are just the setting ("Wet socks in Muir Woods" → "Wet socks for the rest of a hike"). Never keep dates. Use the common canonical name, adding a year only to disambiguate ("Dune (2021)"). Put dropped specifics in where / with_people / note.
4. Passes the "so real" test: if posted online, many strangers would say "this happened to me." Roughly 0.1%–70% of people have had it. "Breathing" fails (everyone). "Skydiving" passes (rare but shared).
5. Keeps context only when the context changes the feeling. "A burrito after a long hike" differs from "a burrito" because post-exertion food hits different. "Wet socks" at a desk vs. on a hike: the hike version means suffering for miles, so keep it.

## Splitting

- Split whenever the valence or the cause of the feeling changes, even within one sentence.
- Don't emit the same experience twice for one dump. Merge repeated mentions.
- Include mundane things that had any felt quality ("A normal commute on a crowded train" is fine — it can be ranked neutral).
- Skip pure logistics with no felt quality ("then I went home", "had a meeting at 2" with nothing said about it).
- Don't invent feelings the person didn't express or clearly imply.

## Title style

Gerund or noun phrase, sentence case, no trailing period, written so anyone could have it:
- "Finding cash in an old jacket pocket"
- "Waking up a minute before your alarm"
- "Stepping on a Lego barefoot"
- "A stranger's dog choosing you to sit next to"
- "Walking among giant redwoods"
- "Watching Inception"
- "Crying at the end of Coco"

## Example

Dump: "Hiked Muir Woods with Sam, trees were unreal, but I stepped in a creek and had wet socks the whole way back lol. Got Chipotle after, best burrito of my life. Then answered emails."

events:
- title "Walking among giant redwoods", description "Feeling tiny and awed walking under enormous ancient trees.", where "Muir Woods", with_people ["Sam"], note "Trees were unreal."
- title "Wet socks for the rest of a hike", description "Stepping in water early on a hike and squelching through every remaining mile.", where "Muir Woods", with_people ["Sam"], note "Stepped in a creek, wet socks the whole way back."
- title "A burrito after a long hike", description "Eating heavy comfort food when you're truly depleted and it tastes like the best thing ever.", where "Chipotle", with_people ["Sam"], note "Best burrito of my life."
("Answered emails" is skipped: no felt quality. Muir Woods and Chipotle are dropped because they're the setting: the experiences are the awe, the soggy socks, and post-hike food.)

Dump: "Rewatched Inception with Sam, still holds up. Then put on Coco and cried at the ending again."

events:
- title "Watching Inception", description "Watching Christopher Nolan's dream-heist movie Inception.", where null, with_people ["Sam"], note "Rewatched it, still holds up."
- title "Crying at the end of Coco", description "Getting emotional at the ending of Pixar's Coco.", where null, with_people [], note "Cried at the ending again."
(The movies keep their names: they ARE the experiences, and anyone could have them.)`;

// Each event is handed to onEvent the moment the model finishes writing it.
export async function streamSplit(
  dump: string,
  onEvent: (event: SplitEvent) => void,
  config: LlmConfig = SPLIT_CONFIG,
): Promise<SplitEvent[]> {
  const parser = new ArrayItemParser();
  const events: SplitEvent[] = [];
  for await (const chunk of streamStructuredText({ config, system: SYSTEM, user: `Brain dump:\n\n${dump}`, schema: SplitResult })) {
    for (const item of parser.push(chunk)) {
      const event = SplitEvent.parse(item);
      events.push(event);
      onEvent(event);
    }
  }
  return events;
}

export async function splitDump(dump: string, config: LlmConfig = SPLIT_CONFIG): Promise<SplitEvent[]> {
  return streamSplit(dump, () => {}, config);
}
