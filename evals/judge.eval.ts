// Grades the dedupe judge in isolation: fixed candidates in, expected match id (or null) out.
// Needs only TYPESAFE_API_KEY. Add a case every time you see a bad merge or a missed dup.
import { judge, type Candidate, type JudgeInput } from "../src/judge";

const CATALOG = {
  redwoods: { id: "redwoods", title: "Walking among giant redwoods", description: "Feeling tiny and awed walking under enormous ancient trees." },
  wetSocksHike: { id: "wetSocksHike", title: "Wet socks for the rest of a hike", description: "Stepping in water early on a hike and squelching through every remaining mile." },
  puddleSocks: { id: "puddleSocks", title: "Stepping in a wet spot in socks indoors", description: "The instant gross shock of a damp floor soaking through your sock." },
  postHikeFood: { id: "postHikeFood", title: "Eating a huge meal after a long day of exercise", description: "Food tasting incredible because you are completely depleted." },
  firstCoffee: { id: "firstCoffee", title: "The first sip of coffee in the morning", description: "That warm jolt that makes the day feel possible." },
  coldCoffee: { id: "coldCoffee", title: "Your coffee going cold before you drink it", description: "Forgetting your drink and returning to a sad lukewarm cup." },
  cashPocket: { id: "cashPocket", title: "Finding cash in an old jacket pocket", description: "A small windfall from your past self." },
  rainCaught: { id: "rainCaught", title: "Getting caught in the rain without an umbrella", description: "Getting soaked when you weren't prepared for it." },
  rainBed: { id: "rainBed", title: "Listening to rain from bed", description: "Feeling cozy and safe while it pours outside." },
  flightDelay: { id: "flightDelay", title: "Your flight getting delayed", description: "Stuck at the gate watching the departure time slide." },
  flightCancel: { id: "flightCancel", title: "Your flight getting canceled", description: "Your travel plans collapsing and scrambling for a rebooking." },
  alarmEarly: { id: "alarmEarly", title: "Waking up a minute before your alarm", description: "Your body beating the alarm and feeling oddly powerful." },
  dogPicksYou: { id: "dogPicksYou", title: "A stranger's dog choosing to sit next to you", description: "Being selected by a dog you don't know, and feeling honored." },
} satisfies Record<string, Candidate>;

type Case = { name: string; event: JudgeInput; candidates: Candidate[]; expected: string | null };

const c = CATALOG;
const CASES: Case[] = [
  {
    name: "place is detail",
    event: { title: "Hiking through towering redwoods", description: "Being awestruck by massive trees on a forest trail.", note: "Muir Woods with Sam, trees were unreal." },
    candidates: [c.redwoods, c.wetSocksHike, c.postHikeFood],
    expected: "redwoods",
  },
  {
    name: "co-occurring but different feeling",
    event: { title: "Wet socks for the rest of a hike", description: "Squelching through miles after stepping in a creek.", note: "Stepped in a creek, wet the whole way back." },
    candidates: [c.redwoods, c.wetSocksHike, c.puddleSocks],
    expected: "wetSocksHike",
  },
  {
    name: "brief shock vs endurance",
    event: { title: "Stepping in a puddle in socks on the bathroom floor", description: "The gross instant of a wet floor soaking your sock.", note: "Someone splashed everywhere after a shower." },
    candidates: [c.wetSocksHike, c.puddleSocks, c.rainCaught],
    expected: "puddleSocks",
  },
  {
    name: "food is detail, depletion is core",
    event: { title: "A burrito after a long hike", description: "Heavy comfort food tasting incredible when depleted.", note: "Best burrito of my life." },
    candidates: [c.postHikeFood, c.redwoods, c.firstCoffee],
    expected: "postHikeFood",
  },
  {
    name: "same object, opposite feeling",
    event: { title: "Microwaving your coffee for the third time", description: "Repeatedly forgetting your coffee until it's cold again.", note: "Kept getting pulled into calls." },
    candidates: [c.firstCoffee, c.coldCoffee],
    expected: "coldCoffee",
  },
  {
    name: "amount and garment are detail",
    event: { title: "Finding a $20 bill in your winter coat", description: "Discovering forgotten money the first cold day of the year.", note: "$20 in my winter coat!" },
    candidates: [c.cashPocket, c.dogPicksYou],
    expected: "cashPocket",
  },
  {
    name: "opposite rain feelings",
    event: { title: "Falling asleep to a thunderstorm", description: "Cozy and safe listening to a storm from bed.", note: "Huge storm last night, slept great." },
    candidates: [c.rainCaught, c.rainBed],
    expected: "rainBed",
  },
  {
    name: "delay vs cancel",
    event: { title: "Your flight getting canceled at the gate", description: "Plans collapsing and racing to rebook.", note: "SFO, canceled after boarding started." },
    candidates: [c.flightDelay, c.flightCancel],
    expected: "flightCancel",
  },
  {
    name: "nothing fits → new",
    event: { title: "Parallel parking perfectly on the first try", description: "Nailing a tight parallel park while people watch.", note: "Did it in one move on a busy street." },
    candidates: [c.dogPicksYou, c.alarmEarly, c.cashPocket],
    expected: null,
  },
  {
    name: "nearby topic but different → new",
    event: { title: "Your dog greeting you at the door", description: "Your own dog losing its mind with joy when you get home.", note: "Came home late, she went nuts." },
    candidates: [c.dogPicksYou],
    expected: null,
  },
];

const results = await Promise.all(
  CASES.map(async (tc) => ({ tc, got: await judge(tc.event, tc.candidates) })),
);

let passed = 0;
for (const { tc, got } of results) {
  const ok = got.matchId === tc.expected;
  if (ok) passed++;
  const detail = ok ? "" : `  — expected ${tc.expected}, got ${got.matchId}`;
  console.log(`${ok ? "✓" : "✗"} ${tc.name}  (p=${got.probability.toFixed(2)})${detail}`);
}
console.log(`\n${passed}/${CASES.length} passed`);
if (passed !== CASES.length) process.exit(1);
