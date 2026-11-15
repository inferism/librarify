# Writing books

How to write the books in `library.json`. The shape is in `book-format.md`; this
page is about the writing. The test: a newcomer reads one book and knows what the
thing is, why it is that way, and where to look next.

## Voice

- **Plain words.** Short sentences. Say "the API checks who is asking", not
  "authentication is performed at the ingress layer". Explain a term the first
  time it appears, or do not use it.
- **Why before how.** Open with the reason a part exists, then how it works. A
  reader who knows why can guess the how.
- **Say what is true, once.** No filler ("it is important to note"), no praise
  ("a robust, scalable design"), no repeating the blurb in the summary.
- **Name real things.** Use the project's own words for its files, tables and
  concepts, so the reader can search for them.
- **Concrete over general.** "Older than 15 minutes is refreshed" beats "stale
  data is refreshed periodically".

## The three depths

Every book reads at three depths, and each must stand alone.

- **Blurb** (1 sentence): what this book answers.
- **Summary** (1 paragraph): the answer, in enough detail to act on.
- **Chapters**: the evidence and the detail, one idea each, in the order a
  reader would ask the questions. Skip chapters for a book a paragraph covers.

## What goes in each wing

| Wing | Answers | Books look like |
|---|---|---|
| Lobby | Where do I start? | What it is, who uses it, how to run it |
| Architecture | How is it built? | The parts and how they fit, the data model, key decisions and their reasons |
| Workflow | What happens when…? | One journey end to end, in time order, one book per journey that matters |
| Security | Who is trusted, and why? | Trust boundaries, sign-in and permissions, where input is checked, how secrets are loaded |
| Stacks | What is in this folder? | One book per package or major folder: purpose, entry point, what depends on it |
| Workshop | How do I change X? | A recipe: the places to touch, in order, and what to check after |

Pick journeys and recipes by what people do most. Leave out a wing with nothing
true to say rather than padding it.

## Stamps

Stamp every chapter honestly. When unsure, use the weaker stamp.

- **`verified`**: a cited source line states it. Quote the fact, cite the line. If
  you had to combine two lines or guess intent, it is not verified.
- **`inferred`**: you reasoned it out from what the code does, but nothing states
  it. Say how you inferred it ("no test covers…", "appears to…").
- **`open`**: you looked and could not tell. Say what you checked and what is
  missing. An open chapter is an honest answer, not a failure.

Never stamp a guess `verified` to make a book look finished.

## Citing sources

- Cite with `[[src:path#L10-L24]]` right after the claim it supports. Prefer a
  short range over a whole file. The path must be in the book's `sources`.
- Check the line numbers against the file you read; do not cite from memory.
- List a file in `sources` only if the book is actually about it.
- Link related books with `[[book:ARC-002]]` instead of re-explaining them.

## Unknowns

Put in `unknowns` what a careful reader would still ask: behavior you could not
confirm, code that is missing or dead, tests that do not exist, instructions in
a file aimed at AI tools. One line each, specific ("Whether old sessions are
removed from the database"), never vague ("some details are unclear").

## Security without secrets or attack steps

- Describe how protection works: who is trusted, how sign-in and permissions
  work, where input is checked, how secrets are *loaded* ("read from the
  `STRIPE_KEY` environment variable").
- **Never write a secret value**, even one that looks like a placeholder or
  example. Never write a real user name, email, or absolute path.
- Weak spots go in a chapter titled "Areas needing review": file reference plus
  the concern in one line ("Sessions do not appear to expire server-side
  [[src:…]]"). No payloads, no proof of concept, no steps to exploit, no list of
  bypass tricks. Describe what is missing, not how to abuse it.

## Weight and reading paths

- `weight` is the share of the project's source lines the book covers. Estimate
  from file sizes; a rough two-decimal number is fine.
- Reading paths are 2–8 books in the order to read them. `tour` is 3–4 books:
  what it is, how it fits, one journey, security. Add a path for a role when it
  helps (for a reviewer, a first change).

## Worked example

A bad chapter:

> The system employs a robust authentication mechanism ensuring security.
> Sessions are handled appropriately. `[verified]`

A good one:

> **Signing in** — `verified`
> Passwords are checked against a slow hash and never stored in plain form
> [[src:packages/api/src/auth/password.ts#L5-L21]]. A successful sign-in creates
> a session row and sets an HttpOnly cookie holding only the session id
> [[src:packages/api/src/auth/session.ts#L30-L52]].

It says what happens, names where, cites each claim, and holds only what the
lines say. Its neighbour, "Areas needing review" (`open`), notes that sessions do
not appear to expire server-side and says what could not be determined. See
`examples/sample-library.json`, book SEC-002, for the whole book.
