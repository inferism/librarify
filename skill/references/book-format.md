# library.json — the book format

`librarify-out/library.json` is one JSON object, UTF-8, written by the agent and
read by `build.mjs`. This page is the whole contract. Anything not listed here is
an error. Example: `examples/sample-library.json`.

## Top level

| Field | Req | Type | Rule |
|---|---|---|---|
| `format` | yes | string | Always `"librarify/1"` |
| `project` | yes | object | See below |
| `wings` | yes | array | 1–6 wing objects, each wing id at most once |
| `books` | yes | array | 1–60 book objects |
| `paths` | yes | array | 1–8 reading paths; one must have id `"tour"` |

## `project`

| Field | Req | Type | Rule |
|---|---|---|---|
| `name` | yes | string | ≤ 60 chars |
| `description` | yes | string | One sentence, ≤ 160 chars |
| `languages` | yes | string[] | 1–8 items, most-used first, e.g. `["TypeScript", "SQL"]` |
| `commit` | no | string \| null | 7–40 hex chars; `null` when not a git repo |
| `written` | no | string | Date the library was written, `YYYY-MM-DD` |

## Wings

```json
{ "id": "architecture", "intro": "One sentence.", "shelves": ["Core", "Edges"] }
```

| Field | Req | Rule |
|---|---|---|
| `id` | yes | One of `lobby` `architecture` `workflow` `security` `stacks` `workshop` |
| `intro` | no | One sentence about this project's wing, ≤ 160 chars |
| `shelves` | yes | 1–6 shelf names, ≤ 30 chars each, in display order |

The viewer owns each wing's title, question and place in the building. Leave out
wings with nothing to say. Every wing listed must hold at least one book; every
shelf listed must hold at least one book.

## Books

| Field | Req | Type | Rule |
|---|---|---|---|
| `id` | yes | string | Call number: wing prefix + `-` + 3 digits, unique. Prefixes: `LOB` `ARC` `WRK` `SEC` `STK` `WSH` |
| `title` | yes | string | ≤ 60 chars |
| `wing` | yes | string | A wing id listed in `wings`; must match the id's prefix |
| `shelf` | yes | string | One of that wing's `shelves` |
| `blurb` | yes | string | Depth 1. One sentence, ≤ 160 chars |
| `summary` | yes | string | Depth 2. One paragraph, ≤ 700 chars |
| `chapters` | no | array | Depth 3. 1–8 chapters (see below). Omit only when the book truly needs none |
| `sources` | yes | string[] | 1–40 files or folders the book is about (see Paths) |
| `unknowns` | no | string[] | ≤ 10 items, ≤ 200 chars each: what the writer could not determine |
| `weight` | yes | number | Share of the project's source lines this book covers, `0 < weight ≤ 1`, two decimals. Books may overlap, so weights need not sum to 1 |

Books appear on their shelf in array order.

### Chapters

```json
{ "title": "Finding the shipment", "stamp": "verified", "body": "Text…" }
```

| Field | Req | Rule |
|---|---|---|
| `title` | yes | ≤ 60 chars |
| `stamp` | yes | `verified` (stated by cited source) · `inferred` (reasoned, not stated) · `open` (not determined) |
| `body` | yes | ≤ 1,500 chars. A `verified` chapter must contain at least one `[[src:…]]` |

## Reading paths

```json
{ "id": "tour", "title": "The ten-minute tour", "for": "Anyone", "books": ["LOB-001", "ARC-001"] }
```

| Field | Req | Rule |
|---|---|---|
| `id` | yes | Unique, lowercase letters, digits and `-`, ≤ 30 chars |
| `title` | yes | ≤ 40 chars |
| `for` | no | Who it is for, ≤ 40 chars |
| `books` | yes | 2–8 existing book ids, in reading order, no repeats |

The front desk bell starts the path with id `tour` (3–4 books).

## Text

All strings are plain text. Markdown and HTML are not interpreted; they show up
literally. Separate paragraphs in `summary` and `body` with a blank line (`\n\n`).
Two inline tokens are allowed in `summary`, `body` and `unknowns`:

- `[[src:path#L10-L24]]` — a source chip. Forms: `path`, `path#L10`, `path#L10-L24`.
  The path (or a folder containing it) must be in the book's `sources`.
- `[[book:ARC-002]]` — a link to another book. The id must exist.

## Paths

Relative to the project root, forward slashes, no leading `/`, no `..`, no drive
letters. A folder ends with `/` (`src/api/`).

## Never in the file

Secret values of any kind (the build stops if it sees one), absolute paths, user
names, emails, author names. Describe how a secret is loaded, never what it is.
