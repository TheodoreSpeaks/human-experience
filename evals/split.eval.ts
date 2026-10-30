// Checks the splitter: event count in range, no instance details leaking into titles.
// Titles are printed so you can eyeball granularity. Needs only ANTHROPIC credentials.
import { splitDump } from "../src/split";

type Case = { name: string; dump: string; minEvents: number; maxEvents: number; forbiddenInTitles: string[] };

const CASES: Case[] = [
  {
    name: "muir woods",
    dump: "Hiked Muir Woods with Sam, trees were unreal, but I stepped in a creek and had wet socks the whole way back lol. Got Chipotle after, best burrito of my life. Then answered emails.",
    minEvents: 3,
    maxEvents: 3,
    forbiddenInTitles: ["Muir", "Sam", "Chipotle", "email"],
  },
  {
    name: "mundane workday",
    dump: "Woke up like a minute before my alarm which felt great. Train was packed as usual. Standup ran 40 min over and nothing got decided. Coffee went cold twice. Priya brought donuts though. Went home and watched TV.",
    minEvents: 4,
    maxEvents: 6,
    forbiddenInTitles: ["Priya", "standup"],
  },
  {
    name: "one sentence, two valences",
    dump: "My flight to Denver got delayed 3 hours but I ran into my college roommate at the gate and we caught up the whole time.",
    minEvents: 2,
    maxEvents: 2,
    forbiddenInTitles: ["Denver"],
  },
  {
    name: "repeated mention merges",
    dump: "Ugh, my neck hurt all day from sleeping weird. Seriously, my neck. Couldn't turn my head left in the meeting.",
    minEvents: 1,
    maxEvents: 1,
    forbiddenInTitles: [],
  },
  {
    name: "big rare moment",
    dump: "Proposed to Alex at the Golden Gate overlook at sunset. Alex said yes. I was shaking so much I almost dropped the ring.",
    minEvents: 2,
    maxEvents: 3,
    forbiddenInTitles: ["Alex", "Golden Gate"],
  },
];

const results = await Promise.all(CASES.map(async (tc) => ({ tc, events: await splitDump(tc.dump) })));

let passed = 0;
for (const { tc, events } of results) {
  const problems: string[] = [];
  if (events.length < tc.minEvents || events.length > tc.maxEvents) {
    problems.push(`got ${events.length} events, expected ${tc.minEvents}-${tc.maxEvents}`);
  }
  for (const e of events) {
    for (const bad of tc.forbiddenInTitles) {
      if (e.title.toLowerCase().includes(bad.toLowerCase())) problems.push(`"${bad}" in title "${e.title}"`);
    }
  }
  if (problems.length === 0) passed++;

  console.log(`${problems.length === 0 ? "✓" : "✗"} ${tc.name}`);
  for (const e of events) console.log(`    • ${e.title}  [${e.where ?? "-"}; ${e.with_people.join(", ") || "-"}]`);
  for (const p of problems) console.log(`    ! ${p}`);
}
console.log(`\n${passed}/${CASES.length} passed`);
if (passed !== CASES.length) process.exit(1);
