import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { access, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const base = fileURLToPath(new URL('.', import.meta.url));
const template = await readFile(new URL('../skill/viewer/template.html', import.meta.url), 'utf8');
const sample = JSON.parse(await readFile(new URL('../examples/sample-library.json', import.meta.url), 'utf8'));
let browser;
for (const candidate of [process.env.CHROME_BIN,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean)) {
  try { await access(candidate); browser = candidate; break; } catch {}
}

async function fixture(t, library, checks = '', before = '') {
  const root = await mkdtemp(join(base, '.librarify-viewer-'));
  t.after(async () => {
    assert.equal(dirname(resolve(root)), resolve(base));
    assert.ok(root.includes('.librarify-viewer-'));
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(join(root, 'skill/scripts'), { recursive: true });
  await mkdir(join(root, 'skill/viewer'));
  const folder = join(root, 'output'); await mkdir(folder);
  await copyFile(new URL('../skill/scripts/build.mjs', import.meta.url), join(root, 'skill/scripts/build.mjs'));
  let page = template;
  if (checks) {
    page = page.replace("'use strict';", `'use strict';
      var violations = [];
      window.addEventListener('securitypolicyviolation', function (e) { violations.push(e.violatedDirective); });
      ${before}`);
    page = page.replace('applyTheme(); render();\n})();', `applyTheme(); render();
      function check(ok, message) { if (!ok) throw new Error(message); }
      try {
        ${checks}
        setTimeout(function () {
          try {
            check(violations.length === 0, 'CSP violations: ' + violations.join(', '));
            check(performance.getEntriesByType('resource').length === 0, 'The page requested a resource');
            window.top.document.body.setAttribute('data-viewer-test', 'passed');
          } catch (e) { window.top.document.body.setAttribute('data-viewer-test', e.message); }
        }, 100);
      } catch (e) { window.top.document.body.setAttribute('data-viewer-test', e.message); }
    })();`);
    page = page.replace('</style>', '.rise{animation:none!important}.book{transition:none!important}</style>');
  }
  await writeFile(join(root, 'skill/viewer/template.html'), page);
  await writeFile(join(folder, 'library.json'), JSON.stringify(library));
  const result = spawnSync(process.execPath, [join(root, 'skill/scripts/build.mjs'), folder], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  return { root, folder, html: await readFile(join(folder, 'index.html'), 'utf8') };
}

function runBrowser(f, viewport) {
  let page = join(f.folder, 'index.html');
  if (viewport) {
    // An iframe gives an exact CSS viewport below Chrome's minimum desktop window width.
    page = join(f.folder, 'viewport.html');
    const srcdoc = f.html.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    writeFileSync(page, `<body style="margin:0"><iframe style="border:0;width:${viewport[0]}px;height:${viewport[1]}px" srcdoc="${srcdoc}"></iframe></body>`);
  }
  const result = spawnSync(browser, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-component-update', '--disable-extensions', '--disable-sync',
    '--metrics-recording-only', '--password-store=basic', '--window-size=1360,900',
    '--user-data-dir=' + join(f.root, 'browser-profile'), '--dump-dom', '--virtual-time-budget=500',
    pathToFileURL(page).href], { encoding: 'utf8', timeout: 25000, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr.slice(-2000));
  const outcome = result.stdout.match(/<body[^>]*data-viewer-test="([^"]+)"/);
  assert.equal(outcome?.[1], 'passed', outcome?.[1] || 'The viewer did not initialize');
}

function generated(count, wingIds = ['stacks']) {
  const prefixes = { lobby: 'LOB', architecture: 'ARC', workflow: 'WRK', security: 'SEC', stacks: 'STK', workshop: 'WSH' };
  const books = Array.from({ length: count }, (_, i) => {
    const wing = wingIds[i % wingIds.length];
    return { id: prefixes[wing] + '-' + String(i + 1).padStart(3, '0'), wing, shelf: 'Core',
      title: i === 0 ? 'A'.repeat(60) : 'Book ' + (i + 1), blurb: 'A topic in this project.',
      summary: 'Plain text about this topic.', sources: ['src/book-' + i + '.js'], weight: i % 3 === 0 ? .01 : 1 };
  });
  return { format: 'librarify/1', project: { name: 'Test library', description: 'A generated layout fixture.', languages: ['JavaScript'] },
    wings: wingIds.map(id => ({ id, shelves: ['Core'] })), books,
    paths: [{ id: 'tour', title: 'The ten-minute tour', books: books.slice(0, 3).map(b => b.id) }] };
}

test('the production template builds offline with inert embedded data and correct script hashes', async t => {
  const library = structuredClone(sample);
  library.books[0].summary = '</script><script>window.injected=true</script> javascript:alert(1) <img src=x>';
  const f = await fixture(t, library);
  assert.ok(!f.html.includes('{{LIBRARY_JSON}}'));
  assert.ok(f.html.includes('\\u003c/script>'));
  assert.deepEqual(JSON.parse(f.html.match(/id="library-data">([\s\S]*?)<\/script>/)[1]), library);
  const scripts = [...f.html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 2);
  const policy = f.html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  for (const script of scripts) assert.ok(policy.includes(`'sha256-${createHash('sha256').update(script[1]).digest('base64')}'`));
  assert.doesNotMatch(template, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\s*\(|new\s+Function|\bfetch\s*\(|XMLHttpRequest|WebSocket/);
  assert.doesNotMatch(template, /<(?:script|link|img)\b[^>]*(?:src|href)=/i);
  assert.ok(Buffer.byteLength(template) < 180 * 1024);
});

const layoutChecks = `
  function intersects(a, b) { return a.x0 < b.x1 - .001 && a.x1 > b.x0 + .001 && a.y0 < b.y1 - .001 && a.y1 > b.y0 + .001; }
  check($('svg').querySelectorAll('[data-book]').length === library.books.length, 'Every book is drawn once');
  check($('svg').querySelectorAll('.carpet').length === library.wings.length, 'Only populated rooms are drawn');
  var bookBoxes = [];
  ROOMS.forEach(function (r, i) {
    ROOMS.slice(i + 1).forEach(function (other) { check(!intersects(r.box, other.box), 'Rooms overlap'); });
    r.units.forEach(function (u, j) {
      check(u.base.x0 >= r.box.x0 && u.base.x1 <= r.box.x1 && u.base.y0 >= r.box.y0 && u.base.y1 <= r.box.y1, 'Furniture escapes its room');
      r.units.slice(j + 1).forEach(function (other) { check(!intersects(u.base, other.base), 'Cases or front desk overlap'); });
      u.items.forEach(function (item) {
        check(item.box.x0 >= u.base.x0 && item.box.x1 <= u.base.x1 && item.box.y0 >= u.base.y0 && item.box.y1 <= u.base.y1, 'An item escapes its case');
        if (item.book) bookBoxes.push(item);
      });
    });
  });
  check(new Set(bookBoxes.map(function (b) { return b.book.id; })).size === library.books.length, 'Layout lost or duplicated a book');
  bookBoxes.forEach(function (a, i) { bookBoxes.slice(i + 1).forEach(function (b) { check(!intersects(a.box, b.box), 'Books overlap'); }); });
  for (var angle = 0; angle < 4; angle++) {
    turn(1);
    check(!/NaN|Infinity/.test($('svg').getAttribute('viewBox')), 'Invalid fitted camera');
    var drawn = $('svg').firstElementChild.getBBox();
    check(drawn.x >= view.x - 1 && drawn.y >= view.y - 1 && drawn.x + drawn.width <= view.x + view.w + 1 && drawn.y + drawn.height <= view.y + view.h + 1, 'Fit clips the drawing');
    bookBoxes.forEach(function (item) {
      var b = R(item.box), points = [];
      [.15, .5, .85].forEach(function (x) { [.15, .5, .85].forEach(function (y) {
        points.push(P(b.x0 + (b.x1 - b.x0) * x, b.y0 + (b.y1 - b.y0) * y, b.z1));
        points.push(P(b.x0 + (b.x1 - b.x0) * x, b.y1, b.z0 + (b.z1 - b.z0) * (.55 + y * .4)));
        points.push(P(b.x1, b.y0 + (b.y1 - b.y0) * y, b.z0 + (b.z1 - b.z0) * (.55 + x * .4)));
      }); });
      var hits = [];
      var visible = points.some(function (point) {
        var screen = new DOMPoint(point[0], point[1]).matrixTransform($('svg').getScreenCTM());
        var hit = document.elementFromPoint(screen.x, screen.y);
        hits.push(hit && hit.closest('[data-book]') ? hit.closest('[data-book]').dataset.book : hit && hit.parentElement.getAttribute('class'));
        return hit && hit.closest('[data-book]') && hit.closest('[data-book]').dataset.book === item.book.id;
      });
      check(visible, 'Upper half of book hidden at angle ' + S.rot + ': ' + item.book.id + ' behind ' + Array.from(new Set(hits)).join(', '));
    });
  }
  $('pathSel').value = 'tour'; $('pathSel').dispatchEvent(new Event('change'));
  check($('svg').querySelectorAll('.stop').length === 3 || $('svg').querySelectorAll('.stop').length === 4, 'Tour stops missing');
  check($('stops').querySelectorAll('button').length === activePath().books.length, 'Trail buttons missing');
`;

test('browser: sample, 3-book, 40-book and 60-book layouts fit and remain visible at all four angles', { skip: !browser && 'Install Chrome/Chromium or set CHROME_BIN for browser checks' }, async t => {
  for (const [name, library] of [['sample', sample], ['three in one wing', generated(3)], ['forty in one wing', generated(40)],
    ['forty across six wings', generated(40, ['lobby', 'architecture', 'workflow', 'security', 'stacks', 'workshop'])],
    ['sixty across six wings', generated(60, ['lobby', 'architecture', 'workflow', 'security', 'stacks', 'workshop'])]]) {
    await t.test(name, async t => { runBrowser(await fixture(t, library, layoutChecks)); });
  }
});

test('browser: reader, citations, links, search, tour, camera, themes and saved progress', { skip: !browser }, async t => {
  const library = structuredClone(sample);
  library.books[0].summary += '\n\n</script><script>window.injected=true</script><img src=x> javascript:alert(1)';
  const f = await fixture(t, library, `
    var first = BOOKS[0];
    $('svg').querySelector('[data-book="' + first.id + '"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    check(!$('desk').hidden && $('bookTitle').textContent === first.title, 'Click did not open the real book');
    check($('desk').textContent.includes('<img src=x>') && !document.querySelector('img') && !window.injected, 'HTML was not inert text');
    check($('desk').textContent.includes('javascript:alert(1)') && !document.querySelector('a'), 'Unsafe link became active');
    check($('desk').querySelectorAll('.prose p').length >= 3, 'Paragraphs not split');
    check(S.read[first.id] === 'started', 'Opening Summary should start the book');
    $('desk').querySelectorAll('.dial button')[2].click();
    check($('desk').querySelectorAll('.chap').length === first.chapters.length, 'Chapters missing');
    check($('desk').querySelector('.stamp.verified').textContent === 'From source', 'Chapter stamp missing');
    $('desk').querySelector('.chap .chip').click();
    check(!$('sourceDetail').hidden && $('sourceDetail').querySelector('input').value.includes('roles.ts#L1-L14'), 'Source details missing');
    var content = $('desk').querySelector('.deskbody'); content.scrollTop = content.scrollHeight; content.dispatchEvent(new Event('scroll'));
    check(S.read[first.id] === 'read', 'Reaching the end did not mark the book read');
    var stored = JSON.parse(localStorage.getItem(storageKey)); check(stored.read[first.id] === 'read' && stored.depth === 3, 'Reading state not saved');
    $('desk').querySelector('.booklink').click(); check(S.open === 'ARC-001', 'Book link did not navigate');
    $('q').value = 'roles.ts'; $('q').dispatchEvent(new Event('input'));
    check($('svg').querySelectorAll('.book:not(.dim)').length > 0 && $('svg').querySelectorAll('.dim').length > 0, 'Source search did not fade books');
    $('q').value = 'no-such-topic-xyz'; $('q').dispatchEvent(new Event('input'));
    check($('qn').textContent === '0 found' && $('svg').querySelectorAll('.dim').length === BOOKS.length, 'Empty search state incorrect');
    $('q').value = ''; $('q').dispatchEvent(new Event('input'));
    closeBook(); $('svg').querySelector('[data-desk]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    check(S.path === 'tour' && S.depth === 2 && !$('stops').hidden, 'Bell did not start tour at Summary');
    $('stops').querySelectorAll('button')[0].click();
    $('desk').querySelectorAll('.deskfoot button')[1].click(); check(S.open === activePath().books[1], 'Next stop did not follow path');
    var beforeZoom = view.w; $('zIn').click(); check(view.w < beforeZoom, 'Zoom in failed');
    $('zFit').click(); check(view.w === bounds.w, 'Fit failed');
    var beforeDrag = view.x;
    $('svg').dispatchEvent(new PointerEvent('pointerdown', { button: 0, pointerId: 1, clientX: 300, clientY: 300, bubbles: true }));
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 360, clientY: 330 }));
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1 }));
    check(view.x !== beforeDrag, 'Drag did not pan');
    var openBeforeClick = S.open;
    $('svg').querySelector('[data-book="SEC-001"]').dispatchEvent(new MouseEvent('click', { detail: 1, bubbles: true }));
    check(S.open === openBeforeClick, 'Drag counted as a click');
    $('themeBtn').click(); check(document.documentElement.dataset.theme === 'light', 'Day theme failed');
    $('themeBtn').click(); check(document.documentElement.dataset.theme === 'dark', 'Lamp theme failed');
    check(JSON.parse(localStorage.getItem(storageKey)).theme === 'dark', 'Theme not saved');
  `);
  runBrowser(f);
});

test('browser: omitted optional content and unavailable storage keep working', { skip: !browser }, async t => {
  const f = await fixture(t, generated(3), `
    check(!$('storageNote').hidden, 'Unavailable storage was not explained');
    openBook(BOOKS[0].id); $('desk').querySelectorAll('.dial button')[2].click();
    check($('desk').textContent.includes('No open questions recorded.'), 'Optional unknowns broke the reader');
    check($('desk').querySelectorAll('.chap').length === 0, 'Invented chapters');
    $('desk').querySelector('.chip').click(); check(!$('sourceDetail').hidden, 'Source-only book failed');
    $('themeBtn').click(); check(document.documentElement.dataset.theme === 'light', 'Theme requires storage');
    closeBook(); startTour(); check(S.open === PATHS[0].books[0], 'Tour assumes a Lobby book exists');
  `, `Object.defineProperty(window, 'localStorage', { get: function () { throw new Error('Storage denied'); } });`);
  runBrowser(f);
});

test('browser: restores reading markers, depth, theme and the last unfinished book', { skip: !browser }, async t => {
  const library = generated(3, ['lobby']);
  const key = 'librarify:' + JSON.stringify([library.project.name, library.project.description]);
  const stored = { depth: 3, theme: 'dark', read: { 'LOB-001': 'read', 'LOB-002': 'started', 'LOB-003': 'invalid' }, last: 'LOB-002' };
  const f = await fixture(t, library, `
    check(S.depth === 3 && S.theme === 'dark' && document.documentElement.dataset.theme === 'dark', 'Preferences were not restored');
    check(S.read['LOB-001'] === 'read' && S.read['LOB-002'] === 'started' && !S.read['LOB-003'], 'Progress was not restored or validated');
    check($('svg').querySelector('[data-book="LOB-001"]').getAttribute('aria-label').includes('read.'), 'Restored read marker has no spoken label');
    $('svg').querySelector('[data-desk]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    check(S.open === 'LOB-002' && S.depth === 2, 'Bell did not resume the unfinished book at Summary');
  `, `localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify(stored))});`);
  runBrowser(f);
});

test('browser: list groups every book, shares read state and search, and restores focus', { skip: !browser }, async t => {
  const library = structuredClone(sample);
  library.books[0].title = '<img src=x onerror=alert(1)>';
  const f = await fixture(t, library, `
    $('viewBtn').click();
    check(S.list && !$('listView').hidden && $('scene').hidden && location.hash === '#/list', 'List switch or route failed');
    check($('listView').querySelectorAll('h2').length === library.wings.length, 'Wing headings missing');
    var rows = Array.from($('listView').querySelectorAll('[data-list-book]'));
    check(rows.map(function (row) { return row.dataset.listBook; }).join() === BOOKS.map(function (b) { return b.id; }).join(), 'List order does not follow wings and shelves');
    check(!$('listView').querySelector('img') && rows[0].textContent.includes('<img src=x'), 'List text became HTML');
    rows.forEach(function (row) {
      check(row.tagName === 'BUTTON' && !row.disabled, 'Book is not keyboard operable');
      row.focus(); row.click();
      check(S.open === row.dataset.listBook && document.activeElement === $('bookTitle'), 'List book did not open or receive focus');
      check(row.textContent.includes('Started') || row.textContent.includes('Read'), 'List read state not updated');
      closeBook(); check(document.activeElement === row, 'Closing did not return to the list row');
    });
    $('q').value = 'ARC-002'; $('q').dispatchEvent(new Event('input'));
    var visible = rows.filter(function (row) { return !row.closest('[hidden]'); });
    check(visible.length === 1 && visible[0].dataset.listBook === 'ARC-002', 'List search did not filter books');
    $('q').value = 'no-such-topic-xyz'; $('q').dispatchEvent(new Event('input'));
    check(!$('listEmpty').hidden && rows.every(function (row) { return row.closest('[hidden]'); }), 'List needs a no-results message');
    $('q').value = ''; $('q').dispatchEvent(new Event('input'));
    rows[0].click(); markRead(BOOKS[0].id);
    check(rows[0].querySelector('.read-state').textContent === 'Read', 'Read marker did not reach list');
    closeBook(); $('viewBtn').click();
    check(!S.list && !$('scene').hidden && $('listView').hidden, 'Could not return to building');
  `);
  runBrowser(f);
});

test('browser: keyboard order, v1 shortcuts, input guards and reader scrolling', { skip: !browser }, async t => {
  const f = await fixture(t, sample, `
    function key(value, element, extra) {
      var event = new KeyboardEvent('keydown', Object.assign({ key: value, bubbles: true, cancelable: true }, extra));
      (element || document.activeElement).dispatchEvent(event); return event;
    }
    $('themeBtn').focus(); key('Tab');
    check(document.activeElement.dataset.desk, 'Tab did not enter the front desk');
    BOOKS.forEach(function (book) {
      key('Tab'); check(document.activeElement.dataset.book === book.id, 'Tab order changed at ' + book.id);
    });
    key('Tab'); check(document.activeElement === $('rotL'), 'Tab trapped at last book');
    for (var i = BOOKS.length - 1; i >= 0; i--) {
      key('Tab', null, { shiftKey: true }); check(document.activeElement.dataset.book === BOOKS[i].id, 'Reverse Tab order changed');
    }
    key('Enter'); check(S.open === BOOKS[0].id && document.activeElement === $('bookTitle'), 'Enter did not open focused book');
    key('3'); check(S.depth === 3 && $('desk').contains(document.activeElement), 'Depth shortcut lost focus');
    var x = view.x, arrow = key('ArrowDown', $('bookTitle'));
    check(!arrow.defaultPrevented && view.x === x, 'Camera keys prevent reading scroll');
    key('j'); check(S.open === BOOKS[1].id, 'Next book shortcut failed');
    key('k'); check(S.open === BOOKS[0].id, 'Previous book shortcut failed');
    key('Escape'); check(!S.open && document.activeElement.dataset.book === BOOKS[0].id, 'Escape lost book focus');
    key(' '); check(S.open === BOOKS[0].id, 'Space did not open focused book'); closeBook();
    key('e'); check(S.rot === 1 && document.activeElement.dataset.book === BOOKS[0].id, 'Rotation lost keyboard focus');
    key('Tab', null, { shiftKey: true }); check(document.activeElement.dataset.desk, 'Front desk missing from reverse order');
    key('q'); check(document.activeElement.dataset.desk && S.rot === 0, 'Redraw lost bell focus');
    x = view.x; check(key('ArrowRight').defaultPrevented && view.x > x, 'Arrow key did not pan');
    var width = view.w; key('+'); check(view.w < width, 'Zoom in shortcut failed');
    key('−'); key('0'); check(view.w === bounds.w, 'Zoom out or fit shortcut failed');
    key('L'); check(S.list && document.activeElement === $('viewBtn'), 'List shortcut left focus in hidden scene');
    key('t'); check(S.theme === 'light', 'Theme shortcut failed');
    key('/'); check(document.activeElement === $('q'), 'Search shortcut failed');
    ['l', 'q', 'e', 't', 'j', 'k', '3', '?', '+'].forEach(function (value) { key(value); });
    check(S.list && S.rot === 0 && S.theme === 'light' && !$('shortcuts').open, 'Shortcuts ran while typing');
    $('pathSel').focus(); key('l'); check(S.list, 'Shortcut ran on a select');
    $('viewBtn').focus(); key('l', null, { ctrlKey: true }); check(S.list, 'Modified key ran a single-key shortcut');
    key('?'); check($('shortcuts').open && $('shortcuts').contains(document.activeElement), 'Shortcut help not accessible');
    $('closeShortcuts').click(); check(!$('shortcuts').open, 'Help did not close');
    S.path = 'tour'; openBook(activePath().books[0]); key('j');
    check(S.open === activePath().books[1], 'j did not follow the selected trail');
  `);
  runBrowser(f);
});

test('browser: list and book URLs restore state, and browser Back restores the previous book', { skip: !browser }, async t => {
  const f = await fixture(t, sample, `
    check(S.list && S.open === 'ARC-001' && S.path === 'tour', 'Initial list/book/path URL was not restored');
    history.replaceState(null, '', location.href.split('#')[0]); window.dispatchEvent(new PopStateEvent('popstate'));
    check(!S.list && !S.open && !S.path, 'Returning to the initial empty URL did not restore the default view');
    history.replaceState(null, '', '#/list?book=ARC-001&path=tour'); window.dispatchEvent(new HashChangeEvent('hashchange'));
    openBook('ARC-002');
    var wentBack = false;
    window.addEventListener('popstate', function () {
      wentBack = true;
      try { check(S.list && S.open === 'ARC-001' && S.path === 'tour', 'Back did not restore the prior book'); }
      catch (e) { violations.push(e.message); }
    }, { once: true });
    history.back();
    setTimeout(function () { if (!wentBack) violations.push('Browser Back did not fire'); }, 50);
  `, `history.replaceState(null, '', '#/list?book=ARC-001&path=tour');`);
  runBrowser(f);
});

test('browser: phone and tablet widths keep controls and the reading sheet usable', { skip: !browser }, async t => {
  for (const width of [320, 390, 559, 560, 819]) {
    await t.test(String(width) + 'px', async t => {
      const library = generated(40);
      library.books[0].sources = ['src/' + 'long-path-'.repeat(30) + '.js'];
      const f = await fixture(t, library, `
        check(innerWidth === ${width}, 'Fixture viewport differs from requested phone width: ' + innerWidth);
        check(S.list === (${width} < 560), 'List default is wrong at this width');
        function fits(el) { var r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1 && r.width > 0; }
        ['q', 'pathSel', 'viewBtn', 'themeBtn'].forEach(function (id) { check(fits($(id)), 'Header control overflows: ' + id); });
        check(document.documentElement.scrollWidth <= innerWidth, 'Page scrolls sideways');
        if (!S.list) $('viewBtn').click();
        var row = $('listView').querySelector('[data-list-book]'); row.click();
        var desk = $('desk').getBoundingClientRect(), stage = document.querySelector('.stage').getBoundingClientRect();
        check(desk.width === innerWidth && desk.height > stage.height * .45 && desk.height < stage.height * .6, 'Desk is not a lower-half sheet');
        check($('desk').querySelector('.deskbody').clientHeight > 100, 'Reading area is too short');
        $('desk').querySelectorAll('button').forEach(function (button) { check(fits(button), 'Reading control overflows'); });
        check($('desk').scrollWidth <= innerWidth, 'Desk scrolls sideways');
        $('desk').querySelectorAll('.dial button')[2].click();
        check($('desk').querySelector('.deskbody').scrollWidth <= innerWidth, 'Full book with long sources overflows');
        check($('desk').querySelector('.chip').getBoundingClientRect().height >= 44, 'Source chip is too small to tap');
        var state = S.list; $('viewBtn').click();
        check(S.list !== state, 'Building is not one tap away');
        check(document.documentElement.scrollWidth <= innerWidth, 'Building mode overflows');
        document.documentElement.style.fontSize = '200%';
        check(document.documentElement.scrollWidth <= innerWidth, 'Larger text makes the page overflow');
        check($('desk').scrollWidth <= innerWidth, 'Larger text makes the desk overflow');
      `);
      runBrowser(f, [width, 844]);
    });
  }
});
