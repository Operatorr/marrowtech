# Writing style: sound human, avoid AI tells

The prose in this repo should read as if a person wrote it. Generated text has recognizable habits: it inflates importance, reaches for the same stock vocabulary, and falls into a few rigid shapes. This guide distills those habits so you can
spot and avoid them.

These are signals, not laws. A real person occasionally writes "is important to note" or uses a
list of three. What gives text away is the *density* and the *formulaic repetition*. Use
judgment; the aim is writing that is specific and plain, not writing that nervously dodges a
banned-words list.

## Core principles

- **Be specific over grand.** Name the thing that actually happened. "Cut p95 latency from
  800ms to 120ms" beats "played a pivotal role in driving performance improvements."
- **Use plain verbs.** Default to `is`, `are`, and `has`. Reach for a fancier verb only when it
  carries real meaning.
- **Cut hedging and filler.** If a sentence still means the same thing with a clause removed,
  remove it.
- **Vary structure because the content varies, not on purpose.** Don't fit every paragraph to
  the same template (claim, then an `-ing` clause about why it matters, then a closing
  flourish).
- **Say it once.** Don't restate a point in a closing "In summary" sentence.

## Words to watch

These words aren't forbidden, but they cluster in generated text. When one shows up, check
whether a plainer word says the same thing.

| Instead of | Prefer |
| --- | --- |
| delve into | look at, study |
| leverage, utilize | use |
| crucial, pivotal, vital, key | important, or just say what it does |
| robust | reliable, solid, or a concrete spec |
| foster, cultivate | build, support, grow |
| underscore, highlight (figurative) | show |
| showcase | show, present |
| boasts, features | has |
| garner | get, win, receive |
| enhance, elevate | improve |
| seamless, seamlessly | (usually cut it) |
| testament to | (cut; show the evidence instead) |
| tapestry, landscape, realm (abstract) | (name the actual field or set) |
| navigate (figurative) | handle, work through |
| vibrant, rich, dynamic | (cut, or give a concrete detail) |
| intricate, meticulous | detailed, careful |
| spearheaded | led, started |

Also watch sentence-openers that pile up in generated text: *Additionally*, *Moreover*,
*Furthermore*, *Notably*. One is fine; three in a section is a tell.

## Patterns to avoid

**Inflated significance and legacy.** Don't tell the reader something matters; show what it did.

> Avoid: This project stands as a testament to the team's commitment to engineering excellence.
>
> Better: The project shipped in six weeks and now handles 40k requests a day.

**Promotional, brochure tone.** No travel-guide adjectives or mission-statement filler.

> Avoid: A renowned engineer with a rich background, showcasing a commitment to innovation.
>
> Better: An engineer with ten years building payment systems at two startups.

**The trailing `-ing` "why it matters" clause.** Generated text tacks a participle phrase onto
the end of a sentence to editorialize about its own significance.

> Avoid: We migrated to Postgres, enhancing scalability and reflecting modern best practices.
>
> Better: We migrated to Postgres. Read replicas now absorb the analytics queries.

**Vague attribution (weasel words).** Don't credit an opinion to an unnamed crowd.

> Avoid: Experts agree this is widely regarded as the industry standard.
>
> Better: The Postgres docs recommend it for this case. / (Or cut the claim.)

**Dodging "is" and "has."** Generated text swaps plain copulas for `serves as`, `stands as`,
`represents`, `boasts`, `features`.

> Avoid: The site serves as a portfolio and boasts a print-ready CV.
>
> Better: The site is a portfolio and has a print-ready CV.

**Negative parallelism.** "Not just X, but Y." "It's not X, it's Y." "No X, no Y, just Z." These
read as punched-up sales copy.

> Avoid: This isn't just a résumé — it's a statement.
>
> Better: This is my résumé.

**The rule of three on autopilot.** Generated text loves triples of adjectives or phrases.
Sometimes two is the honest count, or one.

> Avoid: a fast, scalable, and elegant solution
>
> Better: a fast solution (it cut load time in half)

**Forced synonym swapping.** Don't rename the same thing every time it appears to avoid
repetition. Repeating "the API" is clearer than cycling through "the interface," "the service
layer," "the endpoint surface."

**Formulaic "challenges and future outlook" endings.** Skip the "Despite its success, X faces
challenges… but with ongoing initiatives, X continues to thrive" closer.

**Didactic disclaimers.** Drop "It's important to note that," "It's worth mentioning,"
"Keep in mind."

## Formatting

- **Headings in sentence case.** "Work experience," not "Work Experience."
- **Bold sparingly.** Bold a term on first definition at most. Don't bold a phrase in every
  bullet for emphasis.
- **Prefer prose to inline-header bullet lists** where it reads naturally. The
  `- **Thing:** description` shape on every line is a generated-text habit. Use it for genuine
  reference lists, not to chop ordinary prose into fragments.
- **Don't overuse em dashes.** A comma, colon, or parentheses is usually fine. If several
  sentences in a row hinge on an em dash, rewrite some.
- **Straight quotes and apostrophes** (`"`, `'`), not curly (`"`, `'`).
- **No chatbot filler.** Never ship "Certainly!", "I hope this helps", "Would you like me
  to…", or a closing offer to do more.
- **No knowledge-cutoff or sourcing disclaimers** in content, e.g. "based on available
  information," "as of my last update," "while details are limited."

## Quick self-check

Before committing prose, skim for:

- A word from the "words to watch" table — can a plainer one replace it?
- A sentence that ends in an `-ing` clause explaining why the thing matters — cut or rewrite it.
- `serves as` / `stands as` / `boasts` — swap for `is` / `has`.
- A "not just X, but Y" or three-item list that could be shorter.
- Title-case headings, curly quotes, em-dash pileups, or any "Certainly!"-style filler.
- A closing sentence that just restates the paragraph — delete it.
