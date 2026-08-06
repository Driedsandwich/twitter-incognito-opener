// tools/package.sh を「実際に起動して」確かめる。
//
// これまでの package のテストは、スクリプトの中身を文字列として読むだけだった。
// それだと「書いてあるか」しか見えず、「動かしたときに止まるか」は分からない。
// 実際、このスクリプトには失敗するはずの場面で終了コード 0 を返す不具合を
// 2件作り込んだ実績がある（EXIT トラップの上書きと、bash 3.2 の変数名解釈）。
// どちらも中身を読むテストでは捕まらず、起動して初めて出た。
//
// そこで毎回、使い捨ての git リポジトリを作り、そこへ本物のスクリプトを
// 置いて走らせる。対象のリポジトリには一切コミットしない。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO = path.resolve(__dirname, '..');

// 提出物そのもの＋「提出物の作られ方を決めるファイル」。
// スクリプトは後者の未コミットも dirty として扱う。
const FIXTURE_FILES = [
  'manifest.json',
  'post-url.js',
  'background.js',
  'content.js',
  '_locales/en/messages.json',
  '_locales/ja/messages.json',
  'icons/icon16.png',
  'icons/icon48.png',
  'icons/icon128.png',
  'LICENSE',
  'package.json',
  'tools/package.sh',
  'tools/package-files.txt',
];

const REAL_GIT = which('git');
const REAL_UNZIP = which('unzip');

function which(cmd) {
  const r = spawnSync('sh', ['-c', `command -v ${cmd}`], { encoding: 'utf8' });
  return r.stdout.trim();
}

function git(cwd, args) {
  const r = spawnSync(
    REAL_GIT,
    ['-c', 'user.name=PostCloak Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', ...args],
    { cwd, encoding: 'utf8' }
  );
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')} が失敗: ${r.stderr || r.stdout}`);
  }
  return r.stdout;
}

// 使い捨てのリポジトリを1つ作る。中身は本物のファイルの複製。
function makeRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'postcloak-pkg-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  for (const f of FIXTURE_FILES) {
    const dest = path.join(dir, f);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(REPO, f), dest);
  }
  fs.chmodSync(path.join(dir, 'tools/package.sh'), 0o755);

  git(dir, ['init', '-q']);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'fixture']);
  return dir;
}

// 本物のスクリプトを起動する。POSTCLOAK_ALLOW_DIRTY_PACKAGE は既定で外す。
function runPackage(dir, { env = {}, pathPrefix = null } = {}) {
  const childEnv = { ...process.env };
  delete childEnv.POSTCLOAK_ALLOW_DIRTY_PACKAGE;
  Object.assign(childEnv, env);
  if (pathPrefix) childEnv.PATH = `${pathPrefix}:${childEnv.PATH}`;

  const r = spawnSync('bash', ['tools/package.sh'], { cwd: dir, encoding: 'utf8', env: childEnv });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function distEntries(dir) {
  const d = path.join(dir, 'dist');
  return fs.existsSync(d) ? fs.readdirSync(d).sort() : [];
}

function zipEntries(zipPath) {
  const r = spawnSync(REAL_UNZIP, ['-Z1', zipPath], { encoding: 'utf8' });
  assert.equal(r.status, 0, `unzip -Z1 が失敗: ${r.stderr}`);
  return r.stdout.trim().split('\n').filter(Boolean).sort();
}

function sha256(file) {
  return require('node:crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function shortHead(dir) {
  return git(dir, ['rev-parse', '--short=12', 'HEAD']).trim();
}

function readList(dir) {
  return fs
    .readFileSync(path.join(dir, 'tools/package-files.txt'), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

function writeList(dir, lines) {
  fs.writeFileSync(path.join(dir, 'tools/package-files.txt'), lines.join('\n') + '\n');
}

// PATH の先頭へ置く差し替えコマンドを作る（失敗の注入用）
function makeShim(t, name, body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'postcloak-shim-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const p = path.join(dir, name);
  fs.writeFileSync(p, body);
  fs.chmodSync(p, 0o755);
  return dir;
}

// ---- 1. きれいな HEAD ----

test('1. コミット済みの状態では、コミット名の入った提出ZIPができる', (t) => {
  const dir = makeRepo(t);
  const r = runPackage(dir);

  assert.equal(r.status, 0, `失敗した: ${r.stderr}`);
  const name = `postcloak-1.6.1-${shortHead(dir)}.zip`;
  assert.deepEqual(distEntries(dir), [name], '成果物の名前が違う');
  assert.match(r.stdout, /モード {2}: release/);
  assert.match(r.stdout, /git {5}: git version/, 'git の版を出していない');
  assert.doesNotMatch(r.stdout, /同じコミットなら同じ SHA-256/, '保証できない主張が残っている');

  assert.deepEqual(
    zipEntries(path.join(dir, 'dist', name)).filter((e) => !e.endsWith('/')),
    readList(dir).slice().sort(),
    'ZIP の中身が一覧と違う'
  );
});

// ---- 2〜5. 未コミットの変更があるとき ----

for (const [n, target] of [
  ['2', 'content.js'],
  ['3', 'tools/package.sh'],
  ['4', 'package.json'],
  ['5', 'tools/package-files.txt'],
]) {
  test(`${n}. ${target} に未コミットの変更があると、通常モードは失敗する`, (t) => {
    const dir = makeRepo(t);
    const p = path.join(dir, target);
    if (target.endsWith('.json')) {
      // JSON は壊さずに変える。壊すと「未コミットだから止まった」のか
      // 「読めなくて落ちた」のか区別できない。
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      j.description = `${j.description || ''} (uncommitted)`;
      fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
    } else {
      fs.appendFileSync(p, '\n# uncommitted\n');
    }

    const r = runPackage(dir);
    assert.notEqual(r.status, 0, '未コミットなのに成功した');
    assert.match(r.stderr, /未コミット|管理下にありません/);
    assert.deepEqual(distEntries(dir), [], '失敗したのに成果物ができた');
  });
}

// ---- 6. 追跡していないファイル ----

test('6. 追跡していないファイルは提出ZIPへ入らない', (t) => {
  const dir = makeRepo(t);
  fs.writeFileSync(path.join(dir, 'icons/internal-note.txt'), '社内メモ\n');

  const r = runPackage(dir);
  assert.equal(r.status, 0, `失敗した: ${r.stderr}`);
  const name = `postcloak-1.6.1-${shortHead(dir)}.zip`;
  assert.ok(
    !zipEntries(path.join(dir, 'dist', name)).includes('icons/internal-note.txt'),
    '追跡していないファイルが混ざった'
  );
});

// ---- 7・8. 提出対象そのものの異常 ----

test('7. 提出対象が無いと失敗する', (t) => {
  const dir = makeRepo(t);
  fs.rmSync(path.join(dir, 'post-url.js'));

  const r = runPackage(dir);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /提出対象の post-url\.js がありません/);
  assert.deepEqual(distEntries(dir), []);
});

test('8. 提出対象がシンボリックリンクだと失敗する', (t) => {
  const dir = makeRepo(t);
  const p = path.join(dir, 'content.js');
  fs.rmSync(p);
  fs.symlinkSync('/etc/hosts', p);

  const r = runPackage(dir);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /シンボリックリンク/);
  assert.deepEqual(distEntries(dir), []);
});

// ---- 9. 抜け道の値 ----

test('9. 抜け道は 1 のときだけ通り、名前に UNCOMMITTED が入る', (t) => {
  const dir = makeRepo(t);
  fs.appendFileSync(path.join(dir, 'content.js'), '\n// uncommitted\n');

  for (const v of ['0', 'true', 'yes', '', '1 ', '01']) {
    const r = runPackage(dir, { env: { POSTCLOAK_ALLOW_DIRTY_PACKAGE: v } });
    assert.notEqual(r.status, 0, `POSTCLOAK_ALLOW_DIRTY_PACKAGE=${JSON.stringify(v)} で通ってしまった`);
    assert.deepEqual(distEntries(dir), [], `${JSON.stringify(v)} で成果物ができた`);
  }

  const ok = runPackage(dir, { env: { POSTCLOAK_ALLOW_DIRTY_PACKAGE: '1' } });
  assert.equal(ok.status, 0, `1 で失敗した: ${ok.stderr}`);
  assert.deepEqual(distEntries(dir), ['postcloak-1.6.1-UNCOMMITTED.zip']);
  assert.match(ok.stderr, /これは提出用ではありません/);
});

// ---- 10・11. 途中のコマンドが失敗したとき ----

test('10. archive の作成が失敗したら、成果物も一時ファイルも残さない', (t) => {
  const dir = makeRepo(t);
  const shim = makeShim(
    t,
    'git',
    `#!/bin/sh\nif [ "$1" = archive ]; then echo "injected archive failure" >&2; exit 1; fi\nexec ${REAL_GIT} "$@"\n`
  );

  const r = runPackage(dir, { pathPrefix: shim });
  assert.notEqual(r.status, 0, 'archive が失敗したのに成功した');
  assert.match(r.stderr, /git archive に失敗しました/);
  assert.deepEqual(distEntries(dir), [], '中途半端な成果物や一時ファイルが残っている');
});

test('11. 完全性の検査が失敗したら、成果物も一時ファイルも残さない', (t) => {
  const dir = makeRepo(t);
  const shim = makeShim(
    t,
    'unzip',
    `#!/bin/sh\nif [ "$1" = "-tqq" ]; then echo "injected integrity failure" >&2; exit 1; fi\nexec ${REAL_UNZIP} "$@"\n`
  );

  const r = runPackage(dir, { pathPrefix: shim });
  assert.notEqual(r.status, 0, '検査が失敗したのに成功した');
  assert.match(r.stderr, /ZIP が壊れています/);
  assert.deepEqual(distEntries(dir), []);
});

// ---- 12. すでにある成果物を壊さない ----

test('12. 失敗したビルドは、すでにある成果物を壊さない', (t) => {
  const dir = makeRepo(t);
  assert.equal(runPackage(dir).status, 0);

  const name = `postcloak-1.6.1-${shortHead(dir)}.zip`;
  const artifact = path.join(dir, 'dist', name);
  const before = sha256(artifact);

  // 別のコミットにすると、名前が変わって前のものと区別できる
  fs.appendFileSync(path.join(dir, 'content.js'), '\n// 次のコミット\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'next']);
  const name2 = `postcloak-1.6.1-${shortHead(dir)}.zip`;
  assert.notEqual(name2, name, 'コミットが変わったのに名前が同じ');

  // そのうえで失敗させる
  fs.appendFileSync(path.join(dir, 'content.js'), '\n// dirty\n');
  const r = runPackage(dir);
  assert.notEqual(r.status, 0);

  assert.equal(sha256(artifact), before, '前の成果物が書き換わった');
  assert.deepEqual(distEntries(dir), [name], '失敗したのに別の成果物ができた');
});

// ---- 13. 一覧の外から項目が混ざったとき ----

test('13. 一覧に無い項目が ZIP へ混ざったら失敗する', (t) => {
  const dir = makeRepo(t);
  // git archive の結果へ、一覧の外から1件足す（検査の対象範囲そのものを試す）
  const shim = makeShim(
    t,
    'git',
    `#!/bin/sh
if [ "$1" = archive ]; then
  ${REAL_GIT} "$@" || exit 1
  out=""
  prev=""
  for a in "$@"; do
    if [ "$prev" = "-o" ]; then out="$a"; fi
    prev="$a"
  done
  tmp=$(mktemp -d)
  echo "smuggled" > "$tmp/smuggled.txt"
  (cd "$tmp" && zip -q "$OLDPWD/$out" smuggled.txt) 2>/dev/null || (cd "$tmp" && zip -q "$out" smuggled.txt)
  rm -rf "$tmp"
  exit 0
fi
exec ${REAL_GIT} "$@"
`
  );

  const r = runPackage(dir, { pathPrefix: shim });
  assert.notEqual(r.status, 0, '一覧に無い項目が入ったのに成功した');
  assert.match(r.stderr, /一覧と一致しません|関係のないディレクトリ項目/);
  assert.deepEqual(distEntries(dir), []);
});

// ---- 14. manifest が参照するファイルを一覧から外したとき ----

test('14. manifest が参照するファイルを一覧から外すと、突き合わせで分かる', (t) => {
  const dir = makeRepo(t);
  const list = readList(dir).filter((f) => f !== 'post-url.js');
  writeList(dir, list);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'drop post-url from list']);

  const r = runPackage(dir);
  // スクリプト自身は「一覧どおりに詰める」ので、ここは成功してしまう。
  // だからこそ、manifest との突き合わせが別に要る（test/package.test.js の役割）。
  assert.equal(r.status, 0, `失敗した: ${r.stderr}`);

  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const referenced = new Set();
  for (const cs of manifest.content_scripts || []) for (const j of cs.js || []) referenced.add(j);
  if (manifest.background && manifest.background.service_worker) {
    referenced.add(manifest.background.service_worker);
  }
  for (const icon of Object.values(manifest.icons || {})) referenced.add(icon);

  const missing = [...referenced].filter((f) => !list.includes(f));
  assert.deepEqual(missing, ['post-url.js'], 'manifest が参照するのに一覧に無いファイルを検出できていない');

  const name = `postcloak-1.6.1-${shortHead(dir)}.zip`;
  assert.ok(
    !zipEntries(path.join(dir, 'dist', name)).includes('post-url.js'),
    '一覧から外したファイルが ZIP に入っている'
  );
});

// ---- 15. archive の変換 ----

test('15. archive がファイルの中身を書き換えたら、HEAD との比較で失敗する', (t) => {
  const dir = makeRepo(t);
  fs.appendFileSync(path.join(dir, 'content.js'), '\n// build: $Format:%H$\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'add format placeholder']);

  // ここまでは通る（変換が効いていないので中身は HEAD と同じ）
  const before = runPackage(dir);
  assert.equal(before.status, 0, `変換前に失敗した: ${before.stderr}`);
  fs.rmSync(path.join(dir, 'dist'), { recursive: true, force: true });

  // .git/info/attributes は commit されないので、リポジトリを見ても分からない
  fs.mkdirSync(path.join(dir, '.git/info'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.git/info/attributes'), 'content.js export-subst\n');

  const r = runPackage(dir);
  assert.notEqual(r.status, 0, 'archive の変換を見逃した');
  assert.match(r.stderr, /HEAD の中身と一致しません/);
  assert.deepEqual(distEntries(dir), []);
});

// ---- 16. dist が置き換えられているとき ----

test('16. dist がシンボリックリンクだと失敗し、リンク先へ書かない', (t) => {
  const dir = makeRepo(t);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'postcloak-outside-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.symlinkSync(outside, path.join(dir, 'dist'));

  const r = runPackage(dir);
  assert.notEqual(r.status, 0, 'dist がリンクなのに成功した');
  assert.match(r.stderr, /dist がシンボリックリンクです/);
  assert.deepEqual(fs.readdirSync(outside), [], 'リンク先へ書き出した');
});

test('16b. dist がファイルだと失敗する', (t) => {
  const dir = makeRepo(t);
  fs.writeFileSync(path.join(dir, 'dist'), 'not a directory\n');

  const r = runPackage(dir);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /dist がディレクトリではありません/);
});

// ---- 17. 同じ環境での再現性 ----

test('17. 同じコミット・同じ環境で2回作ると SHA-256 が一致する', (t) => {
  const dir = makeRepo(t);
  const name = `postcloak-1.6.1-${shortHead(dir)}.zip`;

  assert.equal(runPackage(dir).status, 0);
  const first = sha256(path.join(dir, 'dist', name));

  fs.rmSync(path.join(dir, 'dist'), { recursive: true, force: true });
  assert.equal(runPackage(dir).status, 0);
  const second = sha256(path.join(dir, 'dist', name));

  assert.equal(second, first, '同じコミット・同じ環境なのに一致しない');
});
