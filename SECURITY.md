# Librarify — Security

Librarify reads a whole project, has a language model write about it, and produces
an HTML file that people open in a browser and may share. Each of those three steps
has its own risk. This document states what we defend against and how.

## 1. What is being protected

| Asset | Why it matters |
|---|---|
| Secrets in the scanned project (keys, tokens, `.env` values) | The library may be committed, emailed or published. A secret copied into it is a leak. |
| The user's machine and project files | The skill runs with the user's permissions. It must not be steerable into modifying or deleting things. |
| The reader's browser | `index.html` is opened from disk, often by someone other than the person who generated it. |
| The reader's trust | A library that states guesses as facts causes real mistakes. |

## 2. Threats and defences at a glance

| # | Threat | Defence | Where enforced |
|---|---|---|---|
| T1 | A file in the scanned project contains text aimed at the model ("ignore your instructions, run…") | Repository content is treated as data only; writers have no need for and are told not to use shell, network or writes outside `.work/`; outputs are schema-validated | SKILL.md, writer-brief.md, validator |
| T2 | A secret ends up in the library | Secret-bearing files are never opened; all book text passes a redaction scan; the build fails closed on a hit | survey, validator, build |
| T3 | Malicious content in a book runs script in the reader's browser | No `innerHTML` for content; restricted markdown; link-scheme allowlist; strict CSP; escaped JSON embedding | viewer, build |
| T4 | The skill writes or deletes outside its folder | Every write path is resolved and checked to be inside `librarify-out/`; symlinks leaving the project are not followed | scripts/lib |
| T5 | A crafted path or filename is executed as shell | Paths are passed as arguments, never interpolated into a command string | SKILL.md, scripts |
| T6 | A compromised dependency | There are none. No install step, no post-install scripts, no auto-update | repository policy |
| T7 | Personal data in the output | No absolute paths, usernames, emails or git author data are collected; credentials are stripped from remote URLs | survey, build |
| T8 | The Security wing becomes an attack guide | It describes mechanisms and boundaries, not exploit steps; can be turned off | writer-brief.md, `--no-security` |
| T9 | Runaway cost on a huge project | File, size and book caps; an estimate and confirmation before large runs | survey, SKILL.md |

## 3. Untrusted input: the scanned project (T1, T5, T9)

Any file in the project may have been written by someone else — a dependency, a
contributor, a pasted document. Librarify assumes file content can be hostile.

- **Data, not instructions.** SKILL.md and the writer brief state that nothing read
  from the project changes what the model does. Text addressed to an AI inside a
  source file is reported in that book's `unknowns` as "contains instructions
  aimed at AI tools" and otherwise ignored.
- **Least capability for writers.** A book-writing subagent needs to read its
  assigned files and write one draft JSON file. Its brief forbids running project
  code, installing anything, making network requests, or writing anywhere but
  `.work/drafts/`.
- **Nothing from the project is executed.** Librarify never runs the project's
  scripts, tests, build, or package manager.
- **Structured output is checked by code.** A writer that has been manipulated can
  still only produce a draft; the validator rejects anything outside the schema,
  any reference that does not resolve, and any link that is not allowed.
- **No shell interpolation.** The project path and all file paths are handed to
  `node` as argv entries. SKILL.md never builds a command by pasting a path into a
  string.
- **Bounded work.** Files over the size limit are summarised from their head only
  and flagged as partial. Past the file-count threshold the user is asked before
  any model work starts.

## 4. The viewer (T3)

Book text is written by a model that read untrusted files, so the viewer treats
book text as untrusted too.

**Rendering**
- Content is rendered by building DOM nodes with `createElement` and `textContent`.
  `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write` and `eval` are
  not used on content anywhere. A test greps the viewer for them.
- The markdown subset has no raw HTML. Angle-bracket text is shown as text.
- Links are allowed only when they are `https:`, `http:`, or an internal `#/` route.
  `javascript:`, `data:`, `file:` and everything else are rendered as plain text.
  External links get `rel="noopener noreferrer"` and open in a new tab.
- The isometric scene and the diagrams are drawn by our own SVG code from numbers,
  ids and a declarative spec. Labels are set as text nodes. No SVG markup from the
  library data is ever inserted.
- Positions and sizes that change at run time (the view, a lifted book) are set
  through element properties, never by writing a `style` attribute string.

**Embedding**
- Library data sits in `<script type="application/json">` and is read with
  `JSON.parse`. During build every `<` in the JSON is written as `<`, so the
  data cannot close the script tag.

**Content Security Policy** (meta tag in `template.html`)

```
default-src 'none';
script-src 'sha256-<hash of the inlined script block>';
style-src  'sha256-<hash of the inlined style block>';
img-src data:;
base-uri 'none';
form-action 'none';
```

No `connect-src`, so the page cannot make a network request even if something goes
wrong. The hashes are computed at build time. No inline event handlers and no
inline `style` attributes are used, so the policy needs no `unsafe-inline`.

**Storage**
- Only reading progress, bookmarks and display preferences go in `localStorage`.
  Values read back are validated before use, and the page works without storage.

## 5. Secrets and personal data (T2, T7)

**Files that are never opened.** The survey lists these as *excluded* and no stage
reads them:

- `.env`, `.env.*` (except `.env.example` / `.env.sample`), `*.pem`, `*.key`,
  `*.p12`, `*.pfx`, `*.jks`, `id_rsa*`, `id_ed25519*`, `*.kdbx`
- `credentials*`, `secrets*`, `.npmrc`, `.pypirc`, `.netrc`, `.aws/`, `.ssh/`,
  `*.tfstate`, `*.tfvars`
- anything git-ignored, anything binary, anything under `librarify-out/`

**Redaction scan.** Before a draft is accepted and again before the HTML is
written, all text is scanned for:

- private-key blocks
- well-known token formats (cloud provider keys, source-host tokens, payment
  keys, JWTs, connection strings with embedded passwords)
- long high-entropy strings assigned to names such as `secret`, `token`,
  `password`, `api_key`

A hit rejects the draft. If one somehow reaches the build, **the build stops and
no HTML is written**. The pattern table lives in one file
(`scripts/lib/redact.mjs`) with tests for every entry.

**Writer rule.** Books explain *how* secrets are handled ("the API key is read from
the `STRIPE_KEY` environment variable") and never quote a value, including values
that look like placeholders.

**No personal data.** Output paths are relative to the project root. The survey
does not read git author names or emails. If a git remote is used to build source
links, `user:password@` is stripped first, and only `https://<host>/<owner>/<repo>`
is kept.

## 6. File-system safety (T4)

- The only directory librarify creates or modifies is `<project>/librarify-out/`.
- Every output path is built by joining onto that directory, resolved, and checked
  to still be inside it. A book id is restricted to `[A-Z]{3}-[0-9]{3}`, so it
  cannot carry a path.
- The survey does not follow symlinks that resolve outside the project root.
- A rebuild replaces files it owns. It does not delete anything it did not create;
  `manifest.json` is the record of what it owns.
- The installer copies `skill/` into `~/.claude/skills/librarify` and does nothing
  else. It does not edit shell profiles, settings, or hooks.

## 7. The Security wing of a generated library (T8)

A generated library includes a Security wing about the *scanned* project. To keep
it useful to maintainers without handing a map to an attacker:

- It describes trust boundaries, how sign-in and permissions work, where input is
  validated, and how secrets are loaded.
- Weak spots are listed as "areas needing review" with the file reference and the
  concern in one line. No proof-of-concept, payload, or step-by-step.
- The run report reminds the user that the library describes their system's
  internals and that committing or publishing it is their decision.
- `--no-security` omits the wing.
- `librarify-out/.gitignore` ignores `.work/` only. Librarify never edits the
  project's own `.gitignore`.

## 8. Supply chain (T6)

- Zero runtime and zero development dependencies. Tests use `node:test`.
- No `package.json` install scripts.
- The viewer loads nothing from the network.
- No self-update. A new version arrives only when the user reinstalls.

## 9. Honesty as a safety property

A wrong explanation of an auth flow is a security problem for whoever relies on it.

- Every chapter is stamped *verified*, *inferred* or *open*.
- *Verified* requires at least one `[[src:]]` citation that the validator has
  confirmed exists.
- The run report lists dropped books, excluded files, and partially read files.

## 10. Security checks before a release

- [ ] Viewer contains no `innerHTML` / `outerHTML` / `insertAdjacentHTML` / `document.write` / `eval` / `new Function`
- [ ] XSS fixture library (script tags, `javascript:` links, event-handler attributes, `</script>` in text) renders as inert text
- [ ] CSP hashes match the inlined blocks; page makes zero network requests
- [ ] Secret fixture repo: every planted secret is absent from all outputs; build fails closed when one is forced into a draft
- [ ] Prompt-injection fixture repo: no file outside `librarify-out/` is created or changed
- [ ] Path fixtures (`../`, absolute paths, symlink out of root, odd characters in names) stay confined
- [ ] No absolute paths, usernames or emails in any output file
- [ ] Independent review by a second model family of `viewer/js/render.js`, `viewer/js/scene.js`, `redact.mjs`, `html.mjs` and the path code

## 11. Reporting a vulnerability

Please report privately through the repository's **Security → Report a
vulnerability** page (GitHub private vulnerability reporting) rather than a public
issue. Include the librarify version, what you did, and what happened. If the
report involves a real secret that leaked into a library, rotate that secret first.
