// 拡張のテストだけを走らせる仕組みを確かめる。
//
// 以前はここで `test/` を自前で走査していたが、Node の既定の探索とずれていた。
// いまは探索を Node 自身にさせ、**提出物を作る手順のテストを Node の探索に
// 当たらない場所と名前へ置く**ことで分けている。
// つまり守るべき性質は1つだけになる:
//
//   Node が拾うファイル − 統合テスト1件 = Windows で走らせるファイル
//
// そのために「統合テストが Node の探索に当たらないこと」を機械で確かめる。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { INTEGRATION_TEST, isDiscoveredByNode } = require('../tools/run-unit-tests.js');

const ROOT = path.resolve(__dirname, '..');

test('統合テストは、Node の既定の探索に当たらない場所と名前にある', () => {
  assert.equal(isDiscoveredByNode(INTEGRATION_TEST), false, `${INTEGRATION_TEST} が探索に当たっている`);
  assert.ok(fs.existsSync(path.join(ROOT, INTEGRATION_TEST)), `${INTEGRATION_TEST} が存在しない`);
  // test/ の下に戻したら意味が無くなる
  assert.ok(!INTEGRATION_TEST.startsWith('test/'), 'test/ の下に置かれている');
});

test('Node が拾う名前を、判定が正しく言い当てる', () => {
  // どこにあっても拾われるもの（実測で確認した5つの形）
  for (const p of [
    'tools/test-outside.js',
    'src/thing.test.js',
    'src/thing-test.js',
    'src/thing_test.js',
    'src/test.js',
    'a/b/test-deep.cjs',
    'a/b/deep.test.mjs',
  ]) {
    assert.equal(isDiscoveredByNode(p), true, `拾われるはずなのに false: ${p}`);
  }

  // test/ の下は、名前を問わず拾われる
  for (const p of ['test/plain.js', 'test/nested/deep.js', 'test/nested/deep.cjs', 'test/nested/deep.mjs']) {
    assert.equal(isDiscoveredByNode(p), true, `拾われるはずなのに false: ${p}`);
  }

  // 隠しファイル・隠しディレクトリは無視される
  for (const p of ['test/.dotfile.js', 'test/.hidden/h.js', '.hidden/test-x.js']) {
    assert.equal(isDiscoveredByNode(p), false, `無視されるはずなのに true: ${p}`);
  }

  // 名前が当たらないもの
  for (const p of [
    'integration/package-script.js',
    'tools/fs-fault-shim.js',
    'tools/run-unit-tests.js',
    'src/testing.js',
    'src/attest.js',
  ]) {
    assert.equal(isDiscoveredByNode(p), false, `拾われないはずなのに true: ${p}`);
  }
});

test('拡張子が .js / .cjs / .mjs 以外なら、test/ の下でも拾わない', () => {
  for (const p of ['test/fixture.json', 'test/notes.md', 'test/data.txt']) {
    assert.equal(isDiscoveredByNode(p), false, `拾われないはずなのに true: ${p}`);
  }
});

// ---- ランチャーを実際に起動して、--full の意味を確かめる ----
//
// 「--full を付けると提出物のテストも走る」は、書いてあるだけでは守られない。
// 外しても全部通ったように見えるので、実際に起動して確かめる。

const os = require('node:os');
const { spawnSync } = require('node:child_process');

function makeLauncherTree(t, { integrationFails = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'postcloak-launcher-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  fs.mkdirSync(path.join(dir, 'tools'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'tools/run-unit-tests.js'), path.join(dir, 'tools/run-unit-tests.js'));

  fs.mkdirSync(path.join(dir, 'test'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'test/unit.test.js'),
    "const test=require('node:test'); test('UNIT_SENTINEL', () => {});\n"
  );

  fs.mkdirSync(path.join(dir, 'integration'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'integration/package-script.js'),
    integrationFails
      ? "const test=require('node:test'); test('INTEGRATION_SENTINEL', () => { throw new Error('boom'); });\n"
      : "const test=require('node:test'); test('INTEGRATION_SENTINEL', () => {});\n"
  );
  return dir;
}

function runLauncher(dir, args) {
  // node --test は、テストの中から再帰的に呼ばれると
  // 「skipping running files」と言って何も走らせない。
  // 子はテストの外で動かしたいので、その印を外す。
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;

  const r = spawnSync(process.execPath, ['tools/run-unit-tests.js', ...args], {
    cwd: dir,
    encoding: 'utf8',
    env,
  });
  return { status: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}

test('--full を付けると、提出物のテストも走る', (t) => {
  const dir = makeLauncherTree(t);
  const r = runLauncher(dir, ['--full']);

  assert.equal(r.status, 0, `失敗した: ${r.out}`);
  assert.match(r.out, /UNIT_SENTINEL/, '拡張のテストが走っていない');
  assert.match(r.out, /INTEGRATION_SENTINEL/, '提出物のテストが走っていない');
});

test('--full が無ければ、提出物のテストは走らない', (t) => {
  const dir = makeLauncherTree(t);
  const r = runLauncher(dir, []);

  assert.equal(r.status, 0, `失敗した: ${r.out}`);
  assert.match(r.out, /UNIT_SENTINEL/);
  assert.doesNotMatch(r.out, /INTEGRATION_SENTINEL/, '提出物のテストまで走っている');
});

test('提出物のテストが落ちたら、--full は失敗で返す', (t) => {
  // 走らせるだけで結果を無視していたら、ここが通ってしまう。
  const dir = makeLauncherTree(t, { integrationFails: true });
  const r = runLauncher(dir, ['--full']);

  assert.notEqual(r.status, 0, '提出物のテストが落ちたのに成功で返した');
  assert.match(r.out, /INTEGRATION_SENTINEL/);
});

test('提出物のテストが見当たらなければ、黙って通さない', (t) => {
  const dir = makeLauncherTree(t);
  fs.rmSync(path.join(dir, 'integration/package-script.js'));

  const r = runLauncher(dir, ['--full']);
  assert.notEqual(r.status, 0, '無いのに成功で返した');
  assert.match(r.out, /がありません/);
});

test('npm scripts が、探索をランチャーへ任せている', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['test:unit'], 'node tools/run-unit-tests.js');
  assert.equal(pkg.scripts.test, 'node tools/run-unit-tests.js --full');
  // ファイルを手で並べていないこと（並べると Node の探索とずれる）
  assert.ok(!pkg.scripts.test.includes('test/'), 'test にファイル名が直書きされている');
  assert.ok(!pkg.scripts['test:unit'].includes('test/'), 'test:unit にファイル名が直書きされている');
});
