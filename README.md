# librarify

Librarify is a Claude Code skill that reads a project and turns it into a small
library of books a newcomer can browse: an isometric building you explore in the
browser. It writes one offline page and the same content as data.

<!-- SCREENSHOT: the library building (replace this line with an image) -->

## Install

You need [Claude Code](https://claude.com/claude-code) and
[Node.js](https://nodejs.org) 18 or later. Copy the `skill/` folder from this
repository to `~/.claude/skills/librarify`.

**macOS / Linux**

```bash
mkdir -p ~/.claude/skills && cp -R skill ~/.claude/skills/librarify
```

**Windows (PowerShell)**

```powershell
New-Item -ItemType Directory -Force "$HOME\.claude\skills" | Out-Null
Copy-Item -Recurse -Force skill "$HOME\.claude\skills\librarify"
```

Run these from the repository root. Start a new Claude Code session afterwards so
it picks up the skill.

## Use

In any project, open Claude Code and type:

| Command | Does |
|---|---|
| `/librarify` | Build the library for the current project |
| `/librarify <path>` | Build for one sub-folder only |
| `/librarify --help` | Show help |

Claude looks at the project, plans the books, writes them, and builds the page.
Small projects take a few minutes; larger ones use several helpers at once and
Claude asks before starting on a very large project. When it finishes you get a
short report: how many books, how much of the source is covered, what was left
out, and what could not be determined.

Open `librarify-out/index.html` by double-click. Ring the bell at the front desk
for a ten-minute tour. After a library exists, you can also ask Claude questions
about the project and it answers from the books first.

Running `/librarify` again rebuilds the library from scratch.

## What you get

A folder named `librarify-out/` in the project:

| File | What it is |
|---|---|
| `index.html` | The isometric library. One self-contained file that works offline |
| `library.json` | The same content as data: wings, books, chapters, sources, reading paths |

## Privacy and safety

- Nothing is sent anywhere. The page makes no network requests.
- Claude never opens secret-bearing files (`.env`, keys, credentials, anything
  git-ignored) and never copies secret values into the books. The build stops if
  it finds one.
- It runs nothing from your project and writes only inside `librarify-out/`.
- **The library describes your project's internals.** Read it before you share it,
  and treat committing or publishing it as a decision.

Details, limits and how to report a problem are in [SECURITY.md](SECURITY.md).
How it is built is in [ARCHITECTURE.md](ARCHITECTURE.md).
