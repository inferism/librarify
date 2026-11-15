import { createHash } from 'node:crypto';
import { mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const prefixes = { lobby: 'LOB', architecture: 'ARC', workflow: 'WRK', security: 'SEC', stacks: 'STK', workshop: 'WSH' };
const secret = /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\bgh[pousr]_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{22,}\b|\bxox[baprs]-[A-Za-z0-9-]{10,}\b|\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b|\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b|\bAIza[A-Za-z0-9_-]{35}\b/;

function check(condition, field, rule) {
  if (!condition) throw new Error(`${field}: ${rule}. Fix library.json and build again.`);
}

function object(value, field, required, optional = []) {
  check(value !== null && typeof value === 'object' && !Array.isArray(value), field, 'expected an object');
  check(required.every(key => Object.hasOwn(value, key)), field, `required fields are ${required.join(', ')}`);
  check(Object.keys(value).every(key => [...required, ...optional].includes(key)), field, 'contains an unsupported field');
}

function string(value, field, max = Infinity) {
  check(typeof value === 'string' && value.trim().length > 0 && [...value].length <= max, field, `expected nonempty text${Number.isFinite(max) ? ` of at most ${max} characters` : ''}`);
}

function array(value, field, min, max) {
  check(Array.isArray(value) && value.length >= min && value.length <= max, field, `expected ${min}–${max} items`);
}

function unique(values, field) {
  check(new Set(values).size === values.length, field, 'items must be unique');
}

function sourcePath(value, field) {
  string(value, field);
  const parts = value.replace(/\/$/, '').split('/');
  check(!/[\\:#\x00-\x1f\x7f]/.test(value) && parts.every(part => part && part !== '.' && part !== '..'), field, 'use a project-relative path with forward slashes and no .. or drive letters');
}

function scanSecrets(value, location = 'project metadata') {
  if (typeof value === 'string') {
    if (secret.test(value)) throw new Error(`Obvious secret found in ${location}. Remove the secret from library.json and build again; no HTML was written.`);
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => {
      const book = location === 'books' ? `book ${index + 1}${/^(LOB|ARC|WRK|SEC|STK|WSH)-\d{3}$/.test(item?.id) ? ` (${item.id})` : ''}` : location;
      scanSecrets(item, book);
    });
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      scanSecrets(key, location);
      scanSecrets(item, location === 'project metadata' && key === 'books' ? 'books' : location);
    }
  }
}

function validate(library) {
  object(library, 'library', ['format', 'project', 'wings', 'books', 'paths']);
  check(library.format === 'librarify/1', 'format', 'expected librarify/1');
  const { project, wings, books, paths } = library;
  object(project, 'project', ['name', 'description', 'languages'], ['commit', 'written']);
  string(project.name, 'project.name', 60);
  string(project.description, 'project.description', 160);
  array(project.languages, 'project.languages', 1, 8);
  project.languages.forEach(value => string(value, 'project.languages'));
  if (Object.hasOwn(project, 'commit')) check(project.commit === null || typeof project.commit === 'string' && /^[a-f\d]{7,40}$/i.test(project.commit), 'project.commit', 'expected 7–40 hex characters or null');
  if (Object.hasOwn(project, 'written')) check(typeof project.written === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(project.written) && Number.isFinite(Date.parse(project.written)) && new Date(project.written).toISOString().slice(0, 10) === project.written, 'project.written', 'expected a valid YYYY-MM-DD date');
  array(wings, 'wings', 1, 6);
  wings.forEach((wing, i) => {
    const field = `wings[${i}]`;
    object(wing, field, ['id', 'shelves'], ['intro']);
    check(Object.hasOwn(prefixes, wing.id), `${field}.id`, 'expected a standard wing id');
    if (Object.hasOwn(wing, 'intro')) string(wing.intro, `${field}.intro`, 160);
    array(wing.shelves, `${field}.shelves`, 1, 6);
    wing.shelves.forEach(value => string(value, `${field}.shelves`, 30));
    unique(wing.shelves, `${field}.shelves`);
  });
  unique(wings.map(wing => wing.id), 'wings');
  array(books, 'books', 1, 60);
  books.forEach((book, i) => {
    const field = `books[${i}]`;
    object(book, field, ['id', 'title', 'wing', 'shelf', 'blurb', 'summary', 'sources', 'weight'], ['chapters', 'unknowns']);
    const wing = wings.find(wing => wing.id === book.wing);
    check(wing && typeof book.id === 'string' && new RegExp(`^${prefixes[wing.id]}-\\d{3}$`).test(book.id), `${field}.id`, 'expected a call number matching a listed wing');
    check(wing.shelves.includes(book.shelf), `${field}.shelf`, 'expected a shelf listed in the book’s wing');
    string(book.title, `${field}.title`, 60);
    string(book.blurb, `${field}.blurb`, 160);
    string(book.summary, `${field}.summary`, 700);
    check(typeof book.weight === 'number' && book.weight > 0 && book.weight <= 1 && Math.abs(book.weight * 100 - Math.round(book.weight * 100)) < 1e-10, `${field}.weight`, 'expected a number above 0 and at most 1 with at most two decimal places');
    array(book.sources, `${field}.sources`, 1, 40);
    book.sources.forEach(value => sourcePath(value, `${field}.sources`));
    if (Object.hasOwn(book, 'chapters')) {
      array(book.chapters, `${field}.chapters`, 1, 8);
      book.chapters.forEach((chapter, j) => {
        const chapterField = `${field}.chapters[${j}]`;
        object(chapter, chapterField, ['title', 'stamp', 'body']);
        string(chapter.title, `${chapterField}.title`, 60);
        string(chapter.body, `${chapterField}.body`, 1500);
        check(['verified', 'inferred', 'open'].includes(chapter.stamp), `${chapterField}.stamp`, 'expected verified, inferred or open');
        check(chapter.stamp !== 'verified' || /\[\[src:[^\]]+\]\]/.test(chapter.body), chapterField, 'verified chapters require a source citation');
      });
    }
    if (Object.hasOwn(book, 'unknowns')) {
      array(book.unknowns, `${field}.unknowns`, 0, 10);
      book.unknowns.forEach(value => string(value, `${field}.unknowns`, 200));
    }
  });
  const ids = books.map(book => book.id);
  unique(ids, 'books');
  wings.forEach((wing, i) => wing.shelves.forEach(shelf => check(books.some(book => book.wing === wing.id && book.shelf === shelf), `wings[${i}].shelves`, 'every shelf must contain a book')));
  books.forEach((book, i) => {
    const texts = [book.summary, ...(book.unknowns ?? []), ...(book.chapters ?? []).map(chapter => chapter.body)];
    for (const text of texts) {
      for (const token of text.matchAll(/\[\[(src|book):([^\]]*)\]\]/g)) {
        const field = `books[${i}] citations`;
        if (token[1] === 'book') {
          check(ids.includes(token[2]), field, 'book links must refer to an existing book');
        } else {
          const citation = /^([^#]+)(?:#L([1-9]\d*)(?:-L([1-9]\d*))?)?$/.exec(token[2]);
          check(citation, field, 'expected a path, path#L10 or path#L10-L24');
          sourcePath(citation[1], field);
          check(!citation[3] || Number(citation[3]) >= Number(citation[2]), field, 'source line ranges must not run backward');
          check(book.sources.some(source => citation[1] === source || source.endsWith('/') && citation[1].startsWith(source)), field, 'cited paths must be covered by the book’s sources');
        }
      }
    }
  });
  array(paths, 'paths', 1, 8);
  paths.forEach((path, i) => {
    const field = `paths[${i}]`;
    object(path, field, ['id', 'title', 'books'], ['for']);
    string(path.id, `${field}.id`, 30);
    check(/^[a-z\d-]+$/.test(path.id), `${field}.id`, 'use lowercase letters, digits and hyphens');
    string(path.title, `${field}.title`, 40);
    if (Object.hasOwn(path, 'for')) string(path.for, `${field}.for`, 40);
    array(path.books, `${field}.books`, path.id === 'tour' ? 3 : 2, path.id === 'tour' ? 4 : 8);
    unique(path.books, `${field}.books`);
    check(path.books.every(id => ids.includes(id)), `${field}.books`, 'each id must refer to an existing book');
  });
  unique(paths.map(path => path.id), 'paths');
  check(paths.some(path => path.id === 'tour'), 'paths', 'include a reading path with id tour');
}

async function build(folder) {
  const directory = await realpath(folder);
  const input = await readFile(join(directory, 'library.json'), 'utf8');
  let library;
  try { library = JSON.parse(input); } catch { throw new Error('library.json is not valid JSON. Correct its JSON syntax and build again.'); }
  scanSecrets(library);
  validate(library);
  // Template contract for X2: one {{LIBRARY_JSON}} marker inside a script, plus a <head>.
  // The builder inserts CSP first in <head> and hashes every inline script after embedding.
  const template = (await readFile(new URL('../viewer/template.html', import.meta.url), 'utf8')).replace(/\r\n?/g, '\n');
  check(template.split('{{LIBRARY_JSON}}').length === 2 && /<head\b[^>]*>/i.test(template), 'viewer template', 'expected one {{LIBRARY_JSON}} marker and a <head> element');
  const data = JSON.stringify(library).replace(/</g, '\\u003c');
  let html = template.replace('{{LIBRARY_JSON}}', () => data);
  const hashes = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)].map(match => `'sha256-${createHash('sha256').update(match[1]).digest('base64')}'`);
  check(hashes.length > 0, 'viewer template', 'expected an inline script');
  const policy = `default-src 'none'; script-src ${hashes.join(' ')}; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none';`;
  html = html.replace(/<head\b[^>]*>/i, head => `${head}\n<meta http-equiv="Content-Security-Policy" content="${policy}">`);
  // Rename a fresh file so an existing symlink/hard link cannot redirect or truncate writes.
  const temporary = await mkdtemp(join(directory, '.librarify-'));
  try {
    await writeFile(join(temporary, 'index.html'), html, { encoding: 'utf8', flag: 'wx' });
    await rename(join(temporary, 'index.html'), join(directory, 'index.html'));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

try {
  if (process.argv.length !== 3) throw new Error('Usage: node build.mjs <folder> (containing library.json).');
  await build(process.argv[2]);
  console.log('Built index.html in the supplied folder.');
} catch (error) {
  const message = error.code === 'ENOENT' ? 'A required folder or file is missing. Check the supplied folder, its library.json, and skill/viewer/template.html (provided by X2).'
    : error.code ? `File operation failed (${error.code}). Check folder permissions and that index.html is not a directory.` : error.message;
  console.error(`Build failed: ${message}`);
  process.exitCode = 1;
}
