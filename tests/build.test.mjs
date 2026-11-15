import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFile, link, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = new URL('../skill/scripts/build.mjs', import.meta.url);
const sample = JSON.parse(await readFile(new URL('../examples/sample-library.json', import.meta.url), 'utf8'));
// X2 supplies the real viewer; this exercises the same data marker and script hashing.
const template = `<!doctype html><html><head><meta charset="utf-8"><title>Library</title></head><body>
<h1></h1><script type="application/json" id="library-data">{{LIBRARY_JSON}}</script>
<script>const library = JSON.parse(document.getElementById('library-data').textContent);
document.querySelector('h1').textContent = library.project.name;</script></body></html>`;

async function fixture(t) {
  const base = fileURLToPath(new URL('.', import.meta.url));
  const root = await mkdtemp(join(base, '.librarify-test-'));
  t.after(async () => {
    assert.equal(dirname(resolve(root)), resolve(base));
    assert.ok(root.includes('librarify-test-'));
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(join(root, 'skill/scripts'), { recursive: true });
  await mkdir(join(root, 'skill/viewer'));
  const folder = join(root, 'output with spaces & $ characters');
  await mkdir(folder);
  await copyFile(script, join(root, 'skill/scripts/build.mjs'));
  await writeFile(join(root, 'skill/viewer/template.html'), template);
  const run = (args = [folder]) => spawnSync(process.execPath, [join(root, 'skill/scripts/build.mjs'), ...args], { encoding: 'utf8', cwd: root });
  const input = library => writeFile(join(folder, 'library.json'), JSON.stringify(library));
  return { root, folder, run, input };
}

test('builds the sample, preserves JSON, escapes script breakouts, and hashes final scripts', async t => {
  const f = await fixture(t);
  const library = structuredClone(sample);
  library.books[0].summary = '</script><script>alert(1)</script> <img src=x> javascript:alert(1) $& $` $\' 😀 [[book:ARC-001]]';
  await f.input(library);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  const html = await readFile(join(f.folder, 'index.html'), 'utf8');
  assert.ok(html.includes('\\u003c/script>'));
  assert.ok(!html.includes('<img src=x>'));
  assert.deepEqual(JSON.parse(html.match(/id="library-data">([\s\S]*?)<\/script>/)[1]), library);
  const policy = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
    assert.ok(policy.includes(`'sha256-${createHash('sha256').update(match[1]).digest('base64')}'`));
  }
  for (const directive of ["default-src 'none'", "style-src 'unsafe-inline'", 'img-src data:', "base-uri 'none'", "form-action 'none'"]) assert.ok(policy.includes(directive));
  assert.ok(html.indexOf('Content-Security-Policy') < html.indexOf('<script'));
  assert.deepEqual((await readdir(f.folder)).sort(), ['index.html', 'library.json']);
  assert.equal(f.run().status, 0, 'rebuilding an existing page succeeds');
});

test('accepts omitted optional fields and source folders', async t => {
  const f = await fixture(t);
  const library = structuredClone(sample);
  delete library.project.commit;
  delete library.project.written;
  library.wings.forEach(wing => delete wing.intro);
  library.books.forEach(book => { delete book.chapters; delete book.unknowns; });
  library.paths.forEach(path => delete path.for);
  await f.input(library);
  assert.equal(f.run().status, 0);
});

test('normalizes Windows template newlines before computing browser script hashes', async t => {
  const f = await fixture(t);
  await f.input(sample);
  await writeFile(join(f.root, 'skill/viewer/template.html'), template.replace(/\n/g, '\r\n'));
  assert.equal(f.run().status, 0);
  const html = await readFile(join(f.folder, 'index.html'), 'utf8');
  assert.ok(!html.includes('\r'));
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
    assert.ok(html.includes(`'sha256-${createHash('sha256').update(match[1]).digest('base64')}'`));
  }
});

test('rejects invalid format fields, limits, paths and references without replacing an existing page', async t => {
  const f = await fixture(t);
  const cases = [
    ['top-level object', () => null, /library/],
    ['required field', x => { delete x.books; }, /required fields/],
    ['unknown field', x => { x.extra = true; }, /unsupported field/],
    ['version', x => { x.format = 'librarify/2'; }, /format/],
    ['project type', x => { x.project = []; }, /project/],
    ['empty name', x => { x.project.name = ''; }, /project.name/],
    ['name limit', x => { x.project.name = '😀'.repeat(61); }, /project.name/],
    ['description type', x => { x.project.description = 7; }, /project.description/],
    ['language limit', x => { x.project.languages = Array(9).fill('JS'); }, /languages/],
    ['commit', x => { x.project.commit = 'main'; }, /commit/],
    ['written date', x => { x.project.written = '2026-02-30'; }, /written/],
    ['wings limit', x => { x.wings = []; }, /wings/],
    ['unknown wing', x => { x.wings[0].id = 'other'; }, /wings/],
    ['duplicate wing', x => { x.wings[1] = x.wings[0]; }, /unique/],
    ['duplicate shelf', x => { x.wings[0].shelves.push(x.wings[0].shelves[0]); }, /unique/],
    ['empty shelf', x => { x.wings[0].shelves.push('Empty'); }, /every shelf/],
    ['shelf length', x => { x.wings[0].shelves[0] = 'x'.repeat(31); }, /shelves/],
    ['book count', x => { x.books = Array(61).fill(x.books[0]); }, /books/],
    ['duplicate book', x => { x.books.push(x.books[0]); }, /unique/],
    ['prefix mismatch', x => { x.books[0].id = 'ARC-099'; }, /call number/],
    ['unknown shelf', x => { x.books[0].shelf = 'Other'; }, /shelf/],
    ['book title', x => { x.books[0].title = 'x'.repeat(61); }, /title/],
    ['blurb', x => { x.books[0].blurb = 'x'.repeat(161); }, /blurb/],
    ['summary', x => { x.books[0].summary = 'x'.repeat(701); }, /summary/],
    ...[0, -1, 1.1, 0.001, '0.1'].map(weight => ['weight ' + weight, x => { x.books[0].weight = weight; }, /weight/]),
    ...['/etc/passwd', '../secret', 'src/../secret', 'C:/secret', 'src\\file', 'src//file', './file'].map(path => ['source path ' + path, x => { x.books[0].sources = [path]; }, /relative path/]),
    ['empty sources', x => { x.books[0].sources = []; }, /sources/],
    ['empty chapters', x => { x.books[0].chapters = []; }, /chapters/],
    ['chapter title', x => { x.books[0].chapters[0].title = 1; }, /title/],
    ['chapter body', x => { x.books[0].chapters[0].body = 'x'.repeat(1501); }, /body/],
    ['chapter stamp', x => { x.books[0].chapters[0].stamp = 'fact'; }, /stamp/],
    ['verified citation', x => { x.books[0].chapters[0].body = 'No citation'; }, /source citation/],
    ['unknowns count', x => { x.books[0].unknowns = Array(11).fill('Unknown'); }, /unknowns/],
    ['unknown length', x => { x.books[0].unknowns = ['x'.repeat(201)]; }, /unknowns/],
    ['book citation', x => { x.books[0].summary = '[[book:ARC-999]]'; }, /existing book/],
    ['source scope', x => { x.books[0].summary = '[[src:other/file.js]]'; }, /covered/],
    ['source lines', x => { x.books[0].summary = '[[src:README.md#L20-L2]]'; }, /backward/],
    ['source syntax', x => { x.books[0].summary = '[[src:README.md#L0]]'; }, /expected a path/],
    ['path count', x => { x.paths = []; }, /paths/],
    ['path id', x => { x.paths[0].id = 'Bad ID'; }, /lowercase/],
    ['path title', x => { x.paths[0].title = 'x'.repeat(41); }, /title/],
    ['path audience', x => { x.paths[0].for = null; }, /for/],
    ['duplicate path', x => { x.paths.push(x.paths[0]); }, /unique/],
    ['missing tour', x => { x.paths[0].id = 'start'; }, /tour/],
    ['short tour', x => { x.paths[0].books.length = 2; }, /3–4/],
    ['duplicate path book', x => { x.paths[0].books[1] = x.paths[0].books[0]; }, /unique/],
    ['unknown path book', x => { x.paths[0].books[0] = 'LOB-999'; }, /existing book/],
  ];
  for (const [name, mutate, message] of cases) {
    await t.test(name, async () => {
      let library = structuredClone(sample);
      const replacement = mutate(library);
      if (replacement === null) library = null;
      await f.input(library);
      await writeFile(join(f.folder, 'index.html'), 'previous good build');
      const result = f.run();
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, message);
      assert.equal(await readFile(join(f.folder, 'index.html'), 'utf8'), 'previous good build');
    });
  }
});

test('blocks common secrets anywhere in JSON without echoing their values or writing HTML', async t => {
  const f = await fixture(t);
  const tokens = ['-----BEGIN PRIVATE KEY-----', '-----BEGIN RSA PRIVATE KEY-----', 'AKIA' + 'A'.repeat(16), 'ghp_' + 'a'.repeat(36), 'github_pat_' + 'a'.repeat(40), 'xoxb-' + '1'.repeat(25), 'sk_live_' + 'a'.repeat(24), 'sk-proj-' + 'a'.repeat(40), 'AIza' + 'a'.repeat(35)];
  for (const token of tokens) {
    for (const location of ['book', 'project', 'key']) {
      const library = structuredClone(sample);
      if (location === 'book') library.books[0].summary = token;
      if (location === 'project') library.project.name = token;
      if (location === 'key') library[token] = true;
      await f.input(library);
      const result = f.run();
      assert.equal(result.status, 1);
      assert.match(result.stderr, /Obvious secret/);
      assert.ok(!(result.stdout + result.stderr).includes(token));
      if (location === 'book') assert.match(result.stderr, /book 1 \(LOB-001\)/);
      assert.deepEqual(await readdir(f.folder), ['library.json']);
    }
  }
});

test('reports missing input, malformed JSON, missing template and CLI misuse', async t => {
  const f = await fixture(t);
  assert.match(f.run([]).stderr, /Usage:/);
  assert.match(f.run([f.folder, 'extra']).stderr, /Usage:/);
  assert.match(f.run([join(f.root, 'absent')]).stderr, /missing/);
  assert.match(f.run().stderr, /library.json/);
  await writeFile(join(f.folder, 'library.json'), '{"private":"do not echo this');
  const malformed = f.run();
  assert.equal(malformed.status, 1);
  assert.match(malformed.stderr, /not valid JSON/);
  assert.ok(!malformed.stderr.includes('do not echo this'));
  await f.input(sample);
  await rm(join(f.root, 'skill/viewer/template.html'));
  assert.match(f.run().stderr, /provided by X2/);
  for (const broken of [template.replace('{{LIBRARY_JSON}}', ''), template.replace('<head>', '<header>'), template + '{{LIBRARY_JSON}}']) {
    await writeFile(join(f.root, 'skill/viewer/template.html'), broken);
    assert.match(f.run().stderr, /viewer template/);
  }
  assert.deepEqual(await readdir(f.folder), ['library.json']);
});

test('replaces an output hard link without writing outside the folder', async t => {
  const f = await fixture(t);
  const outside = join(f.root, 'outside.html');
  await writeFile(outside, 'do not overwrite');
  try { await link(outside, join(f.folder, 'index.html')); } catch (error) {
    if (error.code === 'EPERM') return t.skip('The filesystem denied creating a hard link');
    throw error;
  }
  await f.input(sample);
  assert.equal(f.run().status, 0);
  assert.equal(await readFile(outside, 'utf8'), 'do not overwrite');
});

test('replaces an output symlink without following it', async t => {
  const f = await fixture(t);
  const outside = join(f.root, 'outside.html');
  await writeFile(outside, 'do not overwrite');
  try { await symlink(outside, join(f.folder, 'index.html')); } catch (error) {
    if (error.code === 'EPERM') return t.skip('Creating file symlinks requires Windows privileges');
    throw error;
  }
  await f.input(sample);
  assert.equal(f.run().status, 0);
  assert.equal(await readFile(outside, 'utf8'), 'do not overwrite');
});

test('a failed output replacement preserves existing files and cleans up temporary output', async t => {
  const f = await fixture(t);
  await f.input(sample);
  await mkdir(join(f.folder, 'index.html'));
  await writeFile(join(f.folder, 'index.html/keep.txt'), 'keep');
  assert.equal(f.run().status, 1);
  assert.equal(await readFile(join(f.folder, 'index.html/keep.txt'), 'utf8'), 'keep');
  assert.deepEqual((await readdir(f.folder)).sort(), ['index.html', 'library.json']);
});
