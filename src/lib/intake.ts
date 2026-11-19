/**
 * On-device prompt intelligence. No network, no model download.
 *
 * - A multinomial naive Bayes classifier (unigrams + bigrams, Laplace smoothing) trained at
 *   load time on the labeled examples below. It guesses what kind of thing the user wants built.
 * - Slot detection finds what the user already said (audience, look, data, sign-in, images, tech)
 *   so Nexus only asks about what is missing.
 * - A question bank per kind turns the gaps into short multiple-choice questions.
 *
 * It is a small statistical model, not a language model. Nexus labels it that way in the UI.
 */

export const DOMAINS = ["website", "webapp", "api", "cli", "mobile", "game", "data", "automation", "docs", "fix"] as const;
export type Domain = (typeof DOMAINS)[number];

export const DOMAIN_LABELS: Record<Domain, string> = {
  website: "Website",
  webapp: "Web app",
  api: "API or backend",
  cli: "Command-line tool",
  mobile: "Mobile app",
  game: "Game",
  data: "Data or analysis",
  automation: "Automation script",
  docs: "Documentation",
  fix: "Bug fix",
};

const TRAINING: [Domain, string][] = [
  ["website", "build a landing page for my science club with events and projects"],
  ["website", "make a portfolio website to show my photography"],
  ["website", "create a website for a bakery with menu, hours and location"],
  ["website", "personal homepage with about me, blog and contact form"],
  ["website", "marketing site for our startup with pricing and features"],
  ["website", "website for a school event with schedule and sign up"],
  ["website", "restaurant website with gallery and reservations"],
  ["website", "simple one page site for a band with tour dates"],
  ["website", "redesign the homepage hero and footer of our site"],
  ["website", "make a website about space for kids"],
  ["webapp", "build a website to track your sleep and show stats"],
  ["webapp", "habit tracker app in the browser with streaks and charts"],
  ["webapp", "todo list web app with tags and due dates"],
  ["webapp", "budget tracker that logs expenses and shows a chart"],
  ["webapp", "dashboard to visualize my workouts over time"],
  ["webapp", "a web app to manage club members and attendance"],
  ["webapp", "notes app with markdown preview and search"],
  ["webapp", "recipe manager web app where I can save and search recipes"],
  ["webapp", "build a kanban board app with drag and drop"],
  ["webapp", "make a pomodoro timer app that tracks focus sessions"],
  ["webapp", "flashcard study app with spaced repetition"],
  ["api", "rest api for a todo list with authentication"],
  ["api", "build an express server with endpoints for users and posts"],
  ["api", "backend service that stores orders in postgres"],
  ["api", "graphql api for a bookstore"],
  ["api", "add an endpoint that returns user stats as json"],
  ["api", "webhook receiver that saves events to a database"],
  ["api", "fastapi service for image metadata"],
  ["cli", "command line tool that renames files in a folder"],
  ["cli", "cli to convert csv files to json"],
  ["cli", "terminal app that shows the weather"],
  ["cli", "script with flags to resize images from the command line"],
  ["cli", "build a cli that backs up a directory"],
  ["mobile", "iphone app to track water intake"],
  ["mobile", "android app for a running club"],
  ["mobile", "react native expo app for journaling"],
  ["mobile", "mobile app with push notifications for reminders"],
  ["mobile", "swiftui app that shows my calendar"],
  ["game", "make a snake game in the browser"],
  ["game", "2d platformer game with levels and coins"],
  ["game", "tic tac toe game against the computer"],
  ["game", "space shooter game with score and lives"],
  ["game", "puzzle game with drag and drop pieces"],
  ["game", "make a flappy style game with keyboard controls"],
  ["data", "analyze this csv and make charts of sales by month"],
  ["data", "jupyter notebook to clean survey data"],
  ["data", "scrape prices and compare them in a report"],
  ["data", "train a model to classify emails"],
  ["data", "visualize temperature data over years"],
  ["automation", "script that emails me a daily summary"],
  ["automation", "automate renaming photos by date every night"],
  ["automation", "github action that runs tests on every push"],
  ["automation", "cron job that cleans old files"],
  ["automation", "bot that posts updates to slack"],
  ["docs", "write a readme for this project"],
  ["docs", "document the api endpoints"],
  ["docs", "add comments and a getting started guide"],
  ["docs", "write a changelog and contributing guide"],
  ["fix", "fix the login bug where users get logged out"],
  ["fix", "the build is failing with a type error"],
  ["fix", "page crashes when I click submit"],
  ["fix", "why is the app so slow on load"],
  ["fix", "tests are failing after the upgrade"],
  ["fix", "button does not work on mobile"],
];

const STOP = new Set(["a", "an", "the", "for", "to", "of", "and", "with", "my", "our", "i", "me", "that", "this", "in", "on", "it", "is", "be", "can", "want", "please", "make", "build", "create"]);

export function tokens(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w));
  const out = [...words];
  for (let i = 0; i < words.length - 1; i++) out.push(`${words[i]}_${words[i + 1]}`);
  return out;
}

type Model = { prior: Map<Domain, number>; counts: Map<Domain, Map<string, number>>; totals: Map<Domain, number>; vocab: Set<string> };

function train(rows: [Domain, string][]): Model {
  const prior = new Map<Domain, number>();
  const counts = new Map<Domain, Map<string, number>>();
  const totals = new Map<Domain, number>();
  const vocab = new Set<string>();
  for (const [d, text] of rows) {
    prior.set(d, (prior.get(d) ?? 0) + 1);
    const c = counts.get(d) ?? new Map<string, number>();
    for (const t of tokens(text)) {
      c.set(t, (c.get(t) ?? 0) + 1);
      totals.set(d, (totals.get(d) ?? 0) + 1);
      vocab.add(t);
    }
    counts.set(d, c);
  }
  return { prior, counts, totals, vocab };
}

const MODEL = train(TRAINING);
export const TRAINING_SIZE = TRAINING.length;

/** Returns domains ranked by posterior probability. */
export function classifyDomain(text: string): { domain: Domain; p: number }[] {
  const toks = tokens(text).filter((t) => MODEL.vocab.has(t));
  const n = TRAINING.length;
  const V = MODEL.vocab.size;
  const logs = DOMAINS.map((d) => {
    let lp = Math.log((MODEL.prior.get(d) ?? 0.5) / n);
    const c = MODEL.counts.get(d);
    const tot = MODEL.totals.get(d) ?? 0;
    for (const t of toks) lp += Math.log(((c?.get(t) ?? 0) + 1) / (tot + V));
    return { domain: d, lp };
  });
  const max = Math.max(...logs.map((l) => l.lp));
  const exp = logs.map((l) => ({ domain: l.domain, e: Math.exp(l.lp - max) }));
  const sum = exp.reduce((a, b) => a + b.e, 0);
  return exp.map((x) => ({ domain: x.domain, p: x.e / sum })).sort((a, b) => b.p - a.p);
}

export type Slot = "audience" | "look" | "features" | "data" | "auth" | "images" | "tech" | "polish" | "platform" | "controls" | "symptom" | "repro" | "input" | "output" | "trigger";

const SLOT_RE: Partial<Record<Slot, RegExp>> = {
  audience: /\b(for (me|myself|kids|children|students|teachers|customers|users|members|my team|the team|family|friends|everyone|the public)|audience|visitors)\b/i,
  look: /\b(dark|light mode|minimal|playful|modern|retro|colou?rful|clean|elegant|theme|style|brand|aesthetic|pastel|neon|night)\b/i,
  data: /\b(database|db|local ?storage|sqlite|postgres|supabase|firebase|persist|save (it|data|entries)|store (it|data))\b/i,
  auth: /\b(log ?in|sign ?in|sign ?up|accounts?|auth|password)\b/i,
  images: /\b(images?|photos?|illustrations?|icons?|logo|pictures?|artwork|graphics?|sprites?)\b/i,
  tech: /\b(react|next(\.js)?|vue|svelte|html|tailwind|python|node|flask|django|express|fastapi|swift(ui)?|kotlin|flutter|expo|typescript|go|rust|vite)\b/i,
  polish: /\b(prototype|mvp|quick|production|polished|ship)\b/i,
  platform: /\b(iphone|ios|android|both platforms|expo)\b/i,
  controls: /\b(keyboard|mouse|touch|controller|arrow keys|wasd)\b/i,
};

export function detectSlots(text: string): Slot[] {
  return (Object.keys(SLOT_RE) as Slot[]).filter((k) => SLOT_RE[k]!.test(text));
}

export type IntakeQuestion = {
  id: string;
  slot: Slot;
  text: string;
  why: string;
  options: string[];
  multi: boolean;
  /** Free-text answer allowed (always true for open questions without options). */
  freeText: boolean;
  source: "classifier" | "local-model";
};

const q = (slot: Slot, text: string, why: string, options: string[], multi = false): IntakeQuestion => ({ id: slot, slot, text, why, options, multi, freeText: true, source: "classifier" });

const IMAGES_YES = "Yes, generate custom images";

const BANK: Record<Domain, IntakeQuestion[]> = {
  website: [
    q("audience", "Who is it for?", "Sets tone and content", ["Just me", "Members of a group", "The public", "Customers"]),
    q("features", "Which sections should it have?", "Defines the pages the agent builds", ["Hero with one main action", "About", "Events or schedule", "Gallery", "Contact form", "Sign-up form"], true),
    q("look", "What look do you want?", "Guides colors and type", ["Dark and calm", "Light and clean", "Bold and colorful", "Playful"]),
    q("images", "Should it have images?", "Decides whether an image agent joins the team", [IMAGES_YES, "Icons and shapes only", "No images"]),
    q("tech", "Which technology?", "Matches what you can run", ["Plain HTML, CSS and JS", "React with Vite", "Next.js", "Let the agent choose"]),
  ],
  webapp: [
    q("features", "Which features matter most?", "Defines the first version", ["Log new entries", "Stats and charts", "History with edit and delete", "Reminders", "Export and import", "Goals"], true),
    q("data", "Where should data be saved?", "Changes the architecture", ["In the browser (no server)", "A local database", "Not needed yet"]),
    q("auth", "Do people need accounts?", "Adds or skips sign-in", ["No, single user", "Yes, sign-in"]),
    q("look", "What look do you want?", "Guides colors and type", ["Dark and calm", "Light and clean", "Bold and colorful", "Playful"]),
    q("images", "Should it have images?", "Decides whether an image agent joins the team", [IMAGES_YES, "Icons and shapes only", "No images"]),
    q("tech", "Which technology?", "Matches what you can run", ["Plain HTML, CSS and JS", "React with Vite", "Next.js", "Let the agent choose"]),
  ],
  api: [
    q("features", "Which endpoints come first?", "Defines the first version", ["Create, read, update, delete", "Search and filters", "Stats", "Webhooks"], true),
    q("data", "Where should data live?", "Changes the architecture", ["SQLite file", "Postgres", "In memory for now"]),
    q("auth", "How do clients authenticate?", "Adds or skips auth", ["No auth yet", "Sessions", "Tokens"]),
    q("tech", "Which stack?", "Matches what you can run", ["Node with Express", "Python with FastAPI", "Let the agent choose"]),
  ],
  cli: [
    q("tech", "Which language?", "Matches what you can run", ["Node.js", "Python", "Go", "Let the agent choose"]),
    q("input", "What does it take as input?", "Defines arguments", ["Files or folders", "Text from stdin", "Flags only"]),
    q("output", "What should it print?", "Defines output format", ["Plain text", "JSON", "A table"]),
  ],
  mobile: [
    q("platform", "Which phones?", "Picks the framework", ["iPhone", "Android", "Both (Expo)"]),
    q("features", "Which screens come first?", "Defines the first version", ["Home", "Log or create", "History", "Settings", "Reminders"], true),
    q("look", "What look do you want?", "Guides colors and type", ["Follow the system look", "Dark and calm", "Bold and colorful"]),
    q("images", "Should it have images?", "Decides whether an image agent joins the team", [IMAGES_YES, "Icons only", "No images"]),
  ],
  game: [
    q("controls", "How do players control it?", "Defines input handling", ["Keyboard", "Mouse or touch", "Both"]),
    q("look", "What art style?", "Guides visuals", ["Pixel art", "Simple shapes", "Hand-drawn", "Neon"]),
    q("images", "Should it have generated art?", "Decides whether an image agent joins the team", [IMAGES_YES, "Shapes drawn in code", "No"]),
    q("features", "What should be in the first version?", "Defines scope", ["Score", "Levels", "Lives", "Sound", "High scores saved"], true),
  ],
  data: [
    q("input", "Where does the data come from?", "Defines loading", ["A CSV or Excel file", "An API", "A database"]),
    q("output", "What should come out?", "Defines deliverables", ["Charts", "A written report", "A cleaned file", "A model"], true),
    q("tech", "Which tool?", "Matches what you can run", ["Python script", "Jupyter notebook", "Let the agent choose"]),
  ],
  automation: [
    q("trigger", "When should it run?", "Defines scheduling", ["When I run it", "On a schedule", "On an event (push, file change)"]),
    q("tech", "Which language?", "Matches what you can run", ["Shell", "Node.js", "Python", "Let the agent choose"]),
  ],
  docs: [
    q("audience", "Who reads it?", "Sets depth", ["New users", "Contributors", "Me later"]),
    q("output", "What should it include?", "Defines sections", ["Install and run", "Examples", "API reference", "Troubleshooting"], true),
  ],
  fix: [
    { ...q("symptom", "What happens now, and what should happen?", "Agents fix faster with the expected behavior", []), freeText: true },
    { ...q("repro", "How do you trigger it?", "Lets the agent reproduce the bug first", []), freeText: true },
  ],
};

const POLISH = q("polish", "How finished should the first version be?", "Sets the bar for done", ["Quick prototype", "Polished and tested"]);

export type IntakeAnalysis = {
  domain: Domain;
  confidence: number;
  ranking: { domain: Domain; p: number }[];
  slots: Slot[];
  questions: IntakeQuestion[];
  engine: string;
};

/** Picks up to `max` questions for what the goal leaves open. */
export function analyzeGoal(goal: string, opts: { hasStack?: boolean; max?: number } = {}): IntakeAnalysis {
  const ranking = classifyDomain(goal);
  const top = ranking[0];
  const slots = detectSlots(goal);
  const bank = [...BANK[top.domain]];
  if (!["fix", "docs", "data", "automation", "cli"].includes(top.domain)) bank.push(POLISH);
  const questions = bank.filter((x) => !slots.includes(x.slot) && !(x.slot === "tech" && opts.hasStack)).slice(0, opts.max ?? 5);
  return {
    domain: top.domain,
    confidence: top.p,
    ranking: ranking.slice(0, 3),
    slots,
    questions,
    engine: `Nexus on-device classifier (naive Bayes, ${TRAINING_SIZE} built-in examples)`,
  };
}

export const wantsImages = (answers: Record<string, string>, goal: string) =>
  (answers.images ?? "").startsWith("Yes") || (!answers.images && /\b(generate|ai)[- ](images?|art|illustrations?)\b/i.test(goal));
