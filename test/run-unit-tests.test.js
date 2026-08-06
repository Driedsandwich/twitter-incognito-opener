// Windows など、提出物を作る道具（bash・git・zip・unzip）が揃っていない環境では、
// 拡張そのもののテストだけを走らせる。その選び方を確かめる。
//
// ここを手で並べた一覧にすると、あとから足したテストが Windows 側だけ黙って
// 走らなくなる。`node --test` は test/ を**再帰的に**探し、`.js` / `.cjs` / `.mjs`
// をテストとして扱うので（実測: Node 22.22.3）、同じ規則で探せているかを見る。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { findTestFiles, EXCLUDED, EXTENSIONS } = require('../tools/run-unit-tests.js');

// 使い捨ての木を作る。実物の test/ に依存すると、
// ファイルを足すたびに期待値を書き換えることになる。
function makeTree(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'postcloak-disc-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const f of files) {
    const p = path.join(root, f);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, '// fixture\n');
  }
  return root;
}

test('直下と入れ子の、.js / .cjs / .mjs をすべて拾う', (t) => {
  const root = makeTree(t, [
    'test/a.test.js',
    'test/plain.js',
    'test/nested/deep.js',
    'test/nested/deep.cjs',
    'test/nested/deep.mjs',
    'test/nested/more/deeper.test.js',
  ]);

  assert.deepEqual(findTestFiles(root), [
    'test/a.test.js',
    'test/nested/deep.cjs',
    'test/nested/deep.js',
    'test/nested/deep.mjs',
    'test/nested/more/deeper.test.js',
    'test/plain.js',
  ]);
});

test('テストではない拡張子は拾わない', (t) => {
  const root = makeTree(t, ['test/a.test.js', 'test/fixture.json', 'test/notes.md', 'test/data.txt']);
  assert.deepEqual(findTestFiles(root), ['test/a.test.js']);
});

test('除外するのは、完全一致した1ファイルだけ', (t) => {
  const root = makeTree(t, [
    'test/package-script.test.js',
    'test/nested/package-script.test.js',
    'test/a.test.js',
  ]);

  const found = findTestFiles(root);
  assert.ok(!found.includes('test/package-script.test.js'), '除外対象が残っている');
  assert.ok(
    found.includes('test/nested/package-script.test.js'),
    '入れ子の同名ファイルまで除外している（名前だけで比べている）'
  );
});

test('並び順が実行ごとに変わらない', (t) => {
  const root = makeTree(t, ['test/b.test.js', 'test/a.test.js', 'test/nested/c.js']);
  const first = findTestFiles(root);
  assert.deepEqual(findTestFiles(root), first);
  assert.deepEqual(first, [...first].sort(), '整列していない');
});

test('除外リストと対象拡張子が、意図した中身のままである', () => {
  assert.deepEqual(EXCLUDED, ['test/package-script.test.js']);
  assert.deepEqual([...EXTENSIONS].sort(), ['.cjs', '.js', '.mjs']);
});

test('実物の test/ でも、除外1件を除いてすべて拾えている', () => {
  const root = path.resolve(__dirname, '..');
  const found = findTestFiles(root);

  const all = [];
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const child = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(child);
      else if (e.isFile() && EXTENSIONS.includes(path.extname(e.name))) all.push(child);
    }
  };
  walk('test');

  assert.deepEqual(found, all.filter((f) => !EXCLUDED.includes(f)).sort());
  // 除外しているファイルが実在することも見る（名前を変えたら気づけるように）
  for (const f of EXCLUDED) {
    assert.ok(all.includes(f), `除外リストのファイルが存在しない: ${f}`);
  }
});
