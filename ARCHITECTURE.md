# Librarify — Architecture

Librarify is a skill for coding agents. Typing `/librarify` inside any project
turns that project into a **library**: a folder containing one self-contained HTML
file that a person can open and look around in to understand the system.

Graphify answers "how are these things connected?" with a graph.
Librarify answers "explain this system to me" with books.

It is a small thing: a set of instructions, one HTML template, and one short
script. The agent does the reading, the deciding and the writing. The script only
puts the result into the page.

## 1. What it produces

Running `/librarify` in a project creates this folder in the project root:

```
librarify-out/
├─ index.html      the library — one file, works offline, open by double-click
└─ library.json    the same content as data
```

`index.html` makes no external requests of any kind: no CDN, no fonts, no
analytics. All styling, code and content are inside the one file.

## 2. The library model

| Concept | What it is | In the viewer |
|---|---|---|
| **Wing** | A top-level area of the library | A room |
| **Shelf** | A group of related books inside a wing | A bookcase in that room |
| **Book** | One topic, explained end to end | A block on the bookcase; thicker = covers more code |
| **Chapter** | A section of a book | A section on the reading desk |
| **Reading path** | An ordered tour through several books for one goal | A dotted trail across the floor |

### Standard wings

Every library uses the same wings, so someone who has seen one librarified
project knows their way around the next.

| Wing | Answers | Typical books |
|---|---|---|
| **Lobby** | What is this and where do I start? | Overview, How to run it |
| **Architecture** | What are the parts and how do they fit? | Components, Data model, Boundaries |
| **Workflow** | What happens when…? | Request lifecycle, key user journeys, build and deploy |
| **Security** | What is protected, and how? | Trust boundaries, sign-in and permissions, secrets handling, areas needing review |
| **Stacks** | What does this module do? | One book per significant module |
| **Workshop** | How do I change…? | Task recipes: "add an endpoint", "add a migration" |

Wings with nothing to say are left out.

### What a book holds

```jsonc
{
  "id": "ARC-002",                 // call number: wing prefix + sequence
  "title": "Data model",
  "wing": "architecture",
  "shelf": "Core",
  "blurb": "One sentence.",        // depth 1
  "summary": "One paragraph.",     // depth 2
  "chapters": [                    // depth 3
    {
      "title": "The main entities",
      "stamp": "verified",         // verified | inferred | open
      "body": "Plain paragraphs. May contain [[src:path/file.ts#L10-L24]] and [[book:ARC-001]]."
    }
  ],
  "unknowns": [ "Things the writer could not determine from the source." ],
  "weight": 0.12                   // share of the codebase this book covers
}
```

`library.json` also holds a short project summary (name, one-sentence
description, languages, the commit it was written from) and the reading paths.
The exact format, with limits, is in `skill/references/book-format.md`.

## 3. Repository layout

```
librarify/
├─ ARCHITECTURE.md  SECURITY.md  README.md
├─ skill/                        ← this folder is the skill; copy it to ~/.claude/skills/librarify
│  ├─ SKILL.md                   the steps the agent follows on /librarify
│  ├─ references/
│  │  ├─ book-format.md          what library.json contains
│  │  └─ writing-books.md        how to write a good book
│  ├─ scripts/
│  │  └─ build.mjs               puts library.json into the template → index.html
│  └─ viewer/
│     └─ template.html           the isometric library viewer, one file
├─ examples/
│  └─ sample-library.json        a hand-written library used to build and test the viewer
└─ tests/
```

## 4. What happens on `/librarify`

Five steps. Only step 4 is code; the rest is the agent following `SKILL.md`.

```
1 Look ──▶ 2 Plan ──▶ 3 Write ──▶ 4 Build ──▶ 5 Report
 agent      agent      agent       script      agent
```

| # | Step | What happens |
|---|---|---|
| 1 | **Look** | List the project's files (using git when available), note languages and sizes, and skim the entry points and manifests. Files that hold secrets, binaries, and ignored files are skipped and never opened. |
| 2 | **Plan** | Decide which wings apply and which books to write, and which files each book is about. The number of books follows the size of the project. |
| 3 | **Write** | Write each book following `writing-books.md` and save everything as `librarify-out/library.json` in the format from `book-format.md`. On larger projects, books are written by parallel subagents, one per book or shelf. |
| 4 | **Build** | Run `node build.mjs librarify-out`. The script checks the data has what the viewer needs, checks it for obvious secrets, and writes `index.html`. |
| 5 | **Report** | Say where the library is, how many books and wings, what was skipped, and what could not be determined. Offer to open it. |

### Commands

```
/librarify            build the library for the current project
/librarify <path>     build for a sub-folder
/librarify --help     print usage
```

Running it again rebuilds the library from scratch.

If `librarify-out/library.json` already exists and the user asks a question about
the project, the agent reads the library first instead of re-reading the code.

### How many books

| Project size | Books | How |
|---|---|---|
| under 50 files | 6–10 | written in one go |
| 50–500 files | 10–25 | parallel subagents |
| 500–5,000 files | 25–40 | Stacks books cover folders, not files; the agent says how big the job is before starting |
| over 5,000 files | — | the agent asks the user to pick a sub-folder |

## 5. The viewer

`template.html` is a single page that draws the library as a small isometric
building and lets the visitor:

- **hover** a book to see its call number, title, one-line blurb and how much of
  the code it covers
- **click** a book to read it at a side panel, at one of three depths: Blurb,
  Summary, Full
- **turn** the building a quarter at a time, **drag** to move, **scroll** to zoom
- pick a **reading path** and see it drawn as a trail from book to book
- **search**, which fades every book that does not match
- switch to a plain **list view**, and between light and dark themes

How it is built:

| Choice | Decision | Why |
|---|---|---|
| Drawing | SVG, with our own isometric projection and four fixed view angles | No WebGL, no 3D library; every book is a real element that can be hovered, focused and clicked |
| Code | Plain JavaScript and CSS inside the one file | Nothing to install or bundle; easy to read and review |
| Data | Embedded in the page by the build script | Opens from disk with no server |
| Fonts | System fonts | No network |
| Build script | Node.js 18+, no dependencies | One small file, nothing to install |

The visitor's own state (what they have read, theme) stays in their browser.
Nothing is written back to the project.

How it looks and behaves in detail is a design matter and is kept out of this
document.

## 6. Rules the design follows

1. **Honest over complete.** Every chapter is stamped *verified* (cited from
   source), *inferred* (reasoned, not stated in code), or *open* (not
   determined). Each book lists what the writer could not tell.
2. **The agent understands; the script only assembles.** No code tries to
   understand the project.
3. **Project content is data.** Text found in the scanned project is never
   treated as an instruction to the agent (SECURITY.md).
4. **Everything stays inside `librarify-out/`.** The skill writes nowhere else in
   the user's project.
5. **Needs nothing but Node.** No package install, no server, no network.

## 7. Not in the first version

- Rewriting only the books whose source changed.
- A separate `/librarify ask` command and a glossary.
- Reading checks, bookmarks, and a full-window reader.
- A markdown copy of each book.
- Non-code inputs such as PDFs, images or video.
