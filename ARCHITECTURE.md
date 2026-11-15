# Librarify — Architecture

Librarify is a Claude Code skill. Typing `/librarify` inside any project turns that
project into a **library**: a folder containing one self-contained HTML file that a
person can open and read to understand the system.

Graphify answers "how are these things connected?" with a graph.
Librarify answers "explain this system to me" with books.

## 1. What it produces

Running `/librarify` in a project creates this folder in the project root:

```
librarify-out/
├─ index.html      the library — one file, works offline, open by double-click
├─ library.json    the same content as data (used by `/librarify ask` and other agents)
├─ LIBRARY.md      plain-markdown index, readable on GitHub
├─ books/*.md      one markdown file per book (mirror of the HTML content)
├─ manifest.json   source-file hashes per book, commit, librarify version
└─ .work/          scratch space for the run (ignored by an inner .gitignore)
```

`index.html` has no external requests of any kind: no CDN, no fonts, no analytics.
All CSS, JavaScript and content are inlined.

## 2. The library model

Everything in the viewer and the data file is built from six concepts.

| Concept | What it is | Example |
|---|---|---|
| **Wing** | A top-level area of the library | Architecture Wing |
| **Shelf** | A group of related books inside a wing | "Payments" |
| **Book** | One topic, explained end to end | "How a checkout request is processed" |
| **Chapter** | A section of a book | "Step 3: charging the card" |
| **Reading path** | An ordered tour through several books for one goal | "Your first day" |
| **Catalog** | Search index, glossary and the "How do I…?" recipes | — |

In the viewer these are drawn as a small isometric building: a wing is a room, a
shelf is a bookcase, a book is a block on that bookcase, and a reading path is a
trail across the floor.

### Standard wings

Every library has the same floor plan, so a reader who has used one librarified
project knows their way around the next.

| Wing | Answers | Typical books |
|---|---|---|
| **Lobby** | What is this and where do I start? | Overview, How to run it, Map of the system |
| **Architecture** | What are the parts and how do they fit? | Components, Data model, Boundaries and dependencies |
| **Workflow** | What happens when…? | Request lifecycle, key user journeys, build and deploy |
| **Security** | What is protected, and how? | Trust boundaries, sign-in and permissions, secrets handling, areas needing review |
| **Stacks** | What does this module do? | One book per significant module |
| **Workshop** | How do I change…? | Task recipes: "add an endpoint", "add a migration" |

Wings with nothing to say are omitted (a CLI tool with no auth gets a short Security
wing, not a padded one).

### Book anatomy

```jsonc
{
  "id": "ARC-002",                 // call number: wing prefix + sequence, stable across updates
  "title": "Data model",
  "wing": "architecture",
  "shelf": "Core",
  "blurb": "One sentence.",        // depth level 1
  "summary": "One paragraph.",     // depth level 2
  "chapters": [                    // depth level 3
    {
      "id": "entities",
      "title": "The main entities",
      "stamp": "verified",         // verified | inferred | open
      "body": "Restricted markdown with [[src:…]] [[book:…]] [[term:…]] references"
    }
  ],
  "diagrams": [ { "type": "flow" | "map", "…": "declarative spec, see §6" } ],
  "checks":   [ { "q": "Question?", "a": "Answer." } ],   // reading check, 2–3 per book
  "unknowns": [ "Things the writer could not determine from the source." ],
  "sources":  [ { "path": "src/models/user.ts", "hash": "sha256:…" } ],
  "related":  [ "ARC-001", "WRK-003" ],
  "weight": 0.12                   // share of the codebase this book covers (drives the book's thickness on its shelf)
}
```

Three reference kinds are allowed inside chapter bodies:

- `[[src:path/to/file.ts#L10-L24]]` — a citation into the source. Rendered as a chip.
- `[[book:ARC-001]]` — a link to another book.
- `[[term:Session]]` — a glossary term. Rendered with a hover definition.

The full schema lives in `skill/references/book-schema.md` and is enforced by the
validator. Books that fail validation never reach the HTML.

## 3. Repository layout

```
librarify/
├─ ARCHITECTURE.md  SECURITY.md  README.md      committed
├─ DESIGN.md  WORKFLOW.md  TASK.md              local working docs (gitignored)
├─ skill/                     ← everything that gets installed
│  ├─ SKILL.md                the instructions Claude follows on /librarify
│  ├─ references/             loaded only when the step needs them
│  │  ├─ catalog-planning.md  how to decide wings, shelves and books
│  │  ├─ writer-brief.md      the prompt given to each book-writing subagent
│  │  ├─ book-schema.md       the book format and reference syntax
│  │  ├─ ask.md               answering questions from an existing library
│  │  └─ update.md            incremental rebuild
│  ├─ scripts/
│  │  ├─ librarify.mjs        CLI entry: survey | validate | build | check | open
│  │  └─ lib/                 inventory, ignore rules, hashing, redaction,
│  │                          schema, references, markdown mirror, html assembly
│  └─ viewer/
│     ├─ template.html        shell with CSP and injection points
│     ├─ order.json           the order css/ and js/ files are concatenated in
│     ├─ css/*.css            tokens, frame, scene, reader, overlays, print
│     └─ js/*.js              one file per module (see §6)
├─ install.mjs                copies skill/ to ~/.claude/skills/librarify
├─ tests/                     node:test suites + fixture repos
└─ examples/                  a finished library for a small fixture project
```

## 4. Technology choices

| Choice | Decision | Why |
|---|---|---|
| Runtime for scripts | Node.js 18+, **zero dependencies** | One language for scripts and viewer, a single `node` binary name on every OS, nothing to `npm install`, no supply-chain surface |
| Viewer | Vanilla JS + CSS, no framework, no build step | Must inline into one offline file and stay auditable |
| Markdown | Own renderer for a restricted subset, building DOM nodes directly | No `innerHTML` with content means no XSS path (see SECURITY.md) |
| 3D scene | Isometric SVG drawn by our own projection code, four fixed view angles | No WebGL and no 3D library; every book stays a real, focusable element; colours come from CSS so themes work |
| Diagrams | Own SVG renderer for two declarative types | Avoids shipping a large diagram library; diagram text is never executed |
| Fonts | System font stacks | No network, no embedded font weight |
| Tests | `node:test` built-in | No dependency |

## 5. The pipeline

`/librarify` runs seven stages. Stages marked **script** are deterministic Node code
and cost no tokens. Stages marked **model** are done by Claude.

```
 1 Survey ──▶ 2 Plan ──▶ 3 Write ──▶ 4 Validate ──▶ 5 Assemble ──▶ 6 Build ──▶ 7 Report
  script       model      model       script          model          script      model
                         (parallel)   ▲      │
                                      └──────┘ one retry per failed book
```

| # | Stage | Who | Input → Output |
|---|---|---|---|
| 1 | **Survey** | script | project → `.work/survey.json`: file inventory (via `git ls-files`, falling back to a walk with default ignores), languages, sizes, hashes, package manifests, likely entry points. Secret-bearing and binary files are listed as *excluded* and never opened. |
| 2 | **Plan the catalog** | model | survey + a skim of entry points → `.work/catalog.json`: the wings, shelves and books to write, and which source files belong to each book. Book count scales with project size and is capped. |
| 3 | **Write books** | model, parallel subagents | each writer gets one book assignment, reads only its files, and writes `.work/drafts/<id>.json` following `writer-brief.md`. |
| 4 | **Validate** | script | every draft is checked: schema, every `[[src:]]` points at a real file and line range, every `[[book:]]` and `[[term:]]` resolves, no secret patterns, size limits. Failures go back to the writer once with the error list; a second failure drops the book and is reported. |
| 5 | **Assemble** | model | with all books in hand, write the cross-cutting pieces: reading paths, glossary, Workshop recipes, the Lobby overview. |
| 6 | **Build** | script | drafts → `library.json`, `books/*.md`, `LIBRARY.md`, `manifest.json`, and `index.html` (viewer template + inlined CSS/JS + embedded JSON). |
| 7 | **Report** | model | prints where the library is, how many books, what share of files are cited, what was excluded, and what could not be determined. Offers to open it. |

### Commands

```
/librarify                  build the library for the current project
/librarify <path>           build for a sub-folder
/librarify --quick          fewer, shorter books (fast first look)
/librarify --deep           more Stacks books, reading checks on every book
/librarify --update         rewrite only books whose source files changed
/librarify check            list stale books (script only, no tokens)
/librarify ask "<question>" answer from the existing library, with citations
/librarify open             open index.html in the default browser
/librarify --help           print usage
```

**Fast path.** If `librarify-out/library.json` exists and the user asks a question
about the project, Claude answers from the library first (`ask.md`) instead of
re-reading the codebase.

### Incremental update

`manifest.json` records, for each book, the hash of every source file it was written
from. `check` re-hashes and reports books whose sources changed, were deleted, or
whose folder gained new files. `--update` rewrites only those books, re-runs
Assemble, and rebuilds. Call numbers are preserved so bookmarks and links survive.

### Scaling limits

| Project size | Books | Behaviour |
|---|---|---|
| < 50 files | 6–10 | single pass, few subagents |
| 50–500 files | 10–25 | parallel writers |
| 500–5,000 files | 25–40 | Stacks books cover folders, not files; estimate shown before writing |
| > 5,000 files | — | asks the user to pick a sub-folder or confirm `--quick` |

## 6. The viewer

`index.html` opens on an isometric view of the library: rooms, bookcases and
books that can be hovered, turned, and clicked to read. Its structure:

```
template.html
├─ <meta CSP>                         locks the page down (SECURITY.md §4)
├─ <style>            css/*.css       concatenated and inlined at build
├─ <script type="application/json">   library data, "<" escaped
└─ <script>           js/*.js         concatenated and inlined at build
```

The viewer source is split into one file per module so several people can work on
it at once. There is no bundler: the build concatenates the files in the order
given by `order.json`. Each file is an IIFE that adds itself to one shared
`Lib` object.

| Module (`js/`) | Responsibility |
|---|---|
| **store** | parses the embedded JSON once; read-only |
| **router** | hash routes: `#/` (the building), `#/book/<id>` (open on the reading desk), `#/read/<id>/<chapter>` (expanded reader), `#/path/<id>`, `#/list`, `#/glossary`, `#/card`. The route is also held in memory so the page works where the address cannot change (embedded previews) |
| **world** | turns the library into a building: rooms sized by content, bookcases per shelf, book sizes from `weight`. Deterministic — same library, same building |
| **iso** | isometric projection, quarter-turn rotation, back-to-front ordering, drawing a solid as three shaded faces |
| **scene** | draws the building with `iso`; camera (pan, zoom, turn); hover card; selection; read markers; search fading; trails |
| **render** | restricted markdown → DOM nodes; reference chips; depth levels |
| **reader** | the reading desk side panel and the expanded reader: stamps, reading checks, previous / next, margin notes |
| **diagram** | `flow` (ordered steps) and `map` (layered boxes) inside books → inline SVG |
| **search** | in-memory inverted index over titles, blurbs, chapter text, terms, file paths; catalog results overlay |
| **paths** | reading paths, their progress, and the stops strip |
| **card** | reading progress, bookmarks, last position — `localStorage`, wrapped in try/catch, optional |
| **list** | the same library as a plain list, for screen readers, small screens and printing |
| **glossary** | glossary page and term hovers |
| **keys** | keyboard shortcuts and the help overlay |
| **theme** | light / dark / follow system; depth preference |

The scene is ordinary SVG elements, one group per book, so hover, focus and
click are plain DOM events and nothing needs a canvas or hit-testing code.

The reader's own state (what they have read, bookmarks, theme) stays in their
browser. Nothing about it is written back to the project.

What the screens look like and how they behave is specified in DESIGN.md.

## 7. Design rules

1. **Honest over complete.** Every chapter carries a stamp: *verified* (cited
   directly from source), *inferred* (reasoned from structure, not stated in
   code), or *open* (not determined). Each book lists its unknowns. A smaller
   library that is right beats a bigger one that guesses.
2. **Scripts decide facts, models write prose.** File lists, hashes, line ranges,
   link resolution and secret detection are never left to a model.
3. **Repository content is data.** Text found in the scanned project is never
   treated as an instruction to the model (SECURITY.md §3).
4. **Everything stays inside `librarify-out/`.** The skill writes nowhere else in
   the user's project.
5. **Works with nothing installed but Node.** No package install, no server, no
   network.

## 8. Not in scope for v1

- A hosted or multi-project library.
- Asking questions inside the HTML page (it is offline; use `/librarify ask`).
- Non-code inputs such as PDFs, images or video.
- Automatic rebuild on commit (a hook can be added later; `check` is the hook-ready piece).
