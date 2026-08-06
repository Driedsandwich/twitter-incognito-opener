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

function which(cmd) {
  const r = spawnSync('sh', ['-c', `command -v ${cmd}`], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : '';
}

// このファイルのテストは、拡張のコードではなく「提出物を作る手順」を確かめる。
// そのため Node 以外の道具が要る。無い環境では、意味の分からない TypeError や
// 空文字のパスで落ちるのではなく、何が足りないかを名指しで止める。
//
// skip にはしない。ここは提出前の関門なので、確かめられないまま
// 「通った」と表示されるほうが危ない。
const REQUIRED_COMMANDS = ['sh', 'bash', 'git', 'zip', 'unzip', 'cmp'];
const MISSING = REQUIRED_COMMANDS.filter((c) => !which(c));
if (MISSING.length > 0) {
  throw new Error(
    `提出物のテストに必要なコマンドがありません: ${MISSING.join(', ')}\n` +
      'Node.js だけでは走りません。WSL か、これらの道具が揃った環境で実行してください。'
  );
}

const REAL_GIT = which('git');
const REAL_UNZIP = which('unzip');

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

  // 通常モードは、その前の dirty 判定で止まる（追跡ファイルが消えている）
  const r = runPackage(dir);
  assert.notEqual(r.status, 0);
  assert.deepEqual(distEntries(dir), []);

  // 抜け道を使っても、提出対象が無いことを理由に止まる
  const forced = runPackage(dir, { env: { POSTCLOAK_ALLOW_DIRTY_PACKAGE: '1' } });
  assert.notEqual(forced.status, 0);
  assert.match(forced.stderr, /提出対象の post-url\.js がありません/);
  assert.deepEqual(distEntries(dir), []);
});

test('8. 提出対象がシンボリックリンクだと失敗する', (t) => {
  const dir = makeRepo(t);
  const p = path.join(dir, 'content.js');
  fs.rmSync(p);
  fs.symlinkSync('/etc/hosts', p);

  const r = runPackage(dir);
  assert.notEqual(r.status, 0);
  assert.deepEqual(distEntries(dir), []);

  const forced = runPackage(dir, { env: { POSTCLOAK_ALLOW_DIRTY_PACKAGE: '1' } });
  assert.notEqual(forced.status, 0);
  assert.match(forced.stderr, /シンボリックリンク/);
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

// ---- T1〜T7. index の印で隠した変更 ----
//
// assume-unchanged と skip-worktree が立っていると、実際に変更があっても
// `git diff --quiet HEAD --` は成功し `git status --short` も空になる。
// 「git が何も言わない」ことを clean の根拠にすると、HEAD に無い中身で
// HEAD のコミット名を名乗る成果物ができてしまう。
//
// 各テストは、まず対照として「git が本当に黙っていること」を実測してから、
// package だけは止まることを見る。対照が無いと、単に別の理由で
// 落ちているのを成功と読み違える。

function hide(dir, file, flag) {
  git(dir, ['update-index', `--${flag}`, file]);
}

function assertGitIsSilent(dir) {
  const diff = spawnSync(REAL_GIT, ['diff', '--quiet', 'HEAD', '--'], { cwd: dir });
  assert.equal(diff.status, 0, '対照が成立していない（git diff が変更を検出した）');
  assert.equal(git(dir, ['status', '--short']).trim(), '', '対照が成立していない（git status が空でない）');
}

for (const [n, flag] of [
  ['T1', 'assume-unchanged'],
  ['T2', 'skip-worktree'],
]) {
  test(`${n}. ${flag} で隠した payload の変更を、通常モードは拒否する`, (t) => {
    const dir = makeRepo(t);
    fs.appendFileSync(path.join(dir, 'content.js'), '\n// 隠した変更\n');
    hide(dir, 'content.js', flag);

    assertGitIsSilent(dir);

    const r = runPackage(dir);
    assert.notEqual(r.status, 0, 'git が黙っているだけで通してしまった');
    assert.match(r.stderr, /印|一致しません/);
    assert.deepEqual(distEntries(dir), [], '提出名の成果物ができた');
  });
}

test('T3. assume-unchanged で隠した manifest の version 変更を拒否する', (t) => {
  const dir = makeRepo(t);
  const p = path.join(dir, 'manifest.json');
  const m = JSON.parse(fs.readFileSync(p, 'utf8'));
  m.version = '9.9.9';
  fs.writeFileSync(p, JSON.stringify(m, null, 2) + '\n');
  hide(dir, 'manifest.json', 'assume-unchanged');

  assertGitIsSilent(dir);

  const r = runPackage(dir);
  assert.notEqual(r.status, 0);
  assert.deepEqual(distEntries(dir), [], '作業ツリー側の version で成果物ができた');
  assert.ok(!r.stdout.includes('9.9.9'), '隠した version が名前に使われた');
});

test('T4. skip-worktree で隠した配布一覧の変更を拒否する', (t) => {
  const dir = makeRepo(t);
  writeList(dir, readList(dir).filter((f) => f !== 'LICENSE'));
  hide(dir, 'tools/package-files.txt', 'skip-worktree');

  assertGitIsSilent(dir);

  const r = runPackage(dir);
  assert.notEqual(r.status, 0, 'HEAD に無い一覧が配布内容を決めてしまった');
  assert.deepEqual(distEntries(dir), []);
});

test('T5. assume-unchanged で隠した package script の変更を拒否する', (t) => {
  const dir = makeRepo(t);
  fs.appendFileSync(path.join(dir, 'tools/package.sh'), '\n# 隠した変更\n');
  hide(dir, 'tools/package.sh', 'assume-unchanged');

  assertGitIsSilent(dir);

  const r = runPackage(dir);
  assert.notEqual(r.status, 0, 'HEAD に無い作られ方で公式名の成果物ができた');
  assert.deepEqual(distEntries(dir), []);
});

test('T6. 印がついていても、抜け道で作れるのは UNCOMMITTED だけ', (t) => {
  const dir = makeRepo(t);
  fs.appendFileSync(path.join(dir, 'content.js'), '\n// 隠した変更\n');
  hide(dir, 'content.js', 'assume-unchanged');

  const r = runPackage(dir, { env: { POSTCLOAK_ALLOW_DIRTY_PACKAGE: '1' } });
  assert.equal(r.status, 0, `抜け道で失敗した: ${r.stderr}`);
  assert.deepEqual(distEntries(dir), ['postcloak-1.6.1-UNCOMMITTED.zip']);
  const releaseName = `postcloak-1.6.1-${shortHead(dir)}.zip`;
  assert.ok(!distEntries(dir).includes(releaseName), '提出名の成果物ができた');
});

test('T8. index に印が無くても、作られ方を決めるファイルが HEAD と違えば止まる', (t) => {
  // clean/smudge フィルタを対にすると、作業ツリーの中身が HEAD と違うのに
  // git diff も git status も黙り、しかも ls-files の印は付かない（H のまま）。
  // 印の検査では見えない経路なので、ここはバイト比較だけが効く。
  const dir = makeRepo(t);
  git(dir, ['config', 'filter.inject.smudge', 'cat; echo "README.md"']);
  git(dir, ['config', 'filter.inject.clean', 'grep -v "^README.md$" || true']);
  fs.mkdirSync(path.join(dir, '.git/info'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.git/info/attributes'), 'tools/package-files.txt filter=inject\n');
  fs.rmSync(path.join(dir, 'tools/package-files.txt'));
  git(dir, ['checkout', '--', 'tools/package-files.txt']);

  // 対照: 仕掛けが本当に成立しているか（git は黙り、印も付いていない）
  assertGitIsSilent(dir);
  const flags = git(dir, ['ls-files', '-v', '--', 'tools/package-files.txt']).trim();
  assert.ok(flags.startsWith('H '), `印が付いてしまっている: ${flags}`);
  assert.notEqual(
    fs.readFileSync(path.join(dir, 'tools/package-files.txt'), 'utf8'),
    git(dir, ['show', 'HEAD:tools/package-files.txt']),
    '対照が成立していない（作業ツリーと HEAD が同じ）'
  );

  const r = runPackage(dir);
  assert.notEqual(r.status, 0, '印が無いだけで通してしまった');
  assert.match(r.stderr, /HEAD の中身と一致しません/);
  assert.deepEqual(distEntries(dir), []);
});

test('T9. 通常モードの version は、作業ツリーではなく HEAD から読む', (t) => {
  // T8 と同じ仕掛けを manifest.json へ当てる。作業ツリーの version は 9.9.9、
  // HEAD は 1.6.1。git は黙り、印も付かない。
  // この状態は最終的に停止するのが正しいが、「止まる前にどちらの version を
  // 読んだか」で、HEAD 由来かどうかが分かる。
  const dir = makeRepo(t);
  git(dir, ['config', 'filter.ver.smudge', 'sed "s/\\"version\\": \\"1.6.1\\"/\\"version\\": \\"9.9.9\\"/"']);
  git(dir, ['config', 'filter.ver.clean', 'sed "s/\\"version\\": \\"9.9.9\\"/\\"version\\": \\"1.6.1\\"/"']);
  fs.mkdirSync(path.join(dir, '.git/info'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.git/info/attributes'), 'manifest.json filter=ver\n');
  fs.rmSync(path.join(dir, 'manifest.json'));
  git(dir, ['checkout', '--', 'manifest.json']);

  // 対照: 仕掛けが成立しているか
  assertGitIsSilent(dir);
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')).version,
    '9.9.9',
    '対照が成立していない（作業ツリーの version が変わっていない）'
  );

  const r = runPackage(dir);
  assert.match(r.stderr, /version 1\.6\.1（いずれも HEAD 由来）/, 'HEAD ではなく作業ツリーの version を読んでいる');
  assert.doesNotMatch(r.stderr, /version 9\.9\.9/);
  assert.notEqual(r.status, 0, '作業ツリーと HEAD が違うのに通した');
  assert.deepEqual(distEntries(dir), []);
});

test('T7. 通常モードの一覧と version は HEAD 由来である', (t) => {
  const dir = makeRepo(t);

  // HEAD 側だけを変える。作業ツリーは HEAD と同じままなので clean。
  const p = path.join(dir, 'manifest.json');
  const m = JSON.parse(fs.readFileSync(p, 'utf8'));
  m.version = '1.7.0';
  fs.writeFileSync(p, JSON.stringify(m, null, 2) + '\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'bump']);

  const r = runPackage(dir);
  assert.equal(r.status, 0, `失敗した: ${r.stderr}`);
  assert.deepEqual(distEntries(dir), [`postcloak-1.7.0-${shortHead(dir)}.zip`]);

  // HEAD の一覧に載っているものが、そのまま入っている
  const fromHead = git(dir, ['show', 'HEAD:tools/package-files.txt'])
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .sort();
  assert.deepEqual(
    zipEntries(path.join(dir, 'dist', `postcloak-1.7.0-${shortHead(dir)}.zip`)).filter((e) => !e.endsWith('/')),
    fromHead
  );
});

// ---- T10. 途中で死んだときに成功として出ない ----

test('T10. 途中で致命的なエラーが起きたら、終了コードは 0 にならない', (t) => {
  // bash 3.2 では、set -u の展開エラーでシェルが止まっても、EXIT トラップから
  // 見える $? は 0 のままになる（実測）。$? だけを返す後始末だと、
  // 「途中で死んだ」が「成功」として外へ出る。
  //
  // ここでは fixture 側の複製に、必ず失敗する展開を1行入れてコミットし、
  // 作業ツリーは clean のまま走らせる。ロケールや bash の版に依存しないよう、
  // 未定義であることが明らかな変数名を使う。
  const dir = makeRepo(t);
  const p = path.join(dir, 'tools/package.sh');
  const src = fs.readFileSync(p, 'utf8');
  const anchor = 'if ! git rev-parse --git-dir >/dev/null 2>&1; then';
  assert.ok(src.includes(anchor), '差し込み位置が見つからない');
  fs.writeFileSync(p, src.replace(anchor, `echo "$POSTCLOAK_TEST_UNDEFINED_VARIABLE"\n${anchor}`));
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'inject fatal expansion']);

  const r = runPackage(dir);
  assert.notEqual(r.status, 0, '途中で死んだのに終了コードが 0 になった');
  assert.deepEqual(distEntries(dir), [], '死んだのに成果物ができた');
});

test('T10b. 途中で exit 0 して終わったら、成功として出さない', (t) => {
  // T10 は未定義変数を使うが、その場合に $? がどう見えるかは bash の版で違う。
  // bash 5 では未定義変数だけで exit 1 になるため、印の仕組みを外しても T10 は通る。
  // 版に依らず印だけが効く場面として、明示的な exit 0 を注入する。
  const dir = makeRepo(t);
  const p = path.join(dir, 'tools/package.sh');
  const src = fs.readFileSync(p, 'utf8');
  const anchor = 'if ! git rev-parse --git-dir >/dev/null 2>&1; then';
  assert.ok(src.includes(anchor), '差し込み位置が見つからない');
  fs.writeFileSync(p, src.replace(anchor, `exit 0\n${anchor}`));
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'inject early exit 0']);

  const r = runPackage(dir);
  assert.notEqual(r.status, 0, '最後まで到達していないのに終了コードが 0 になった');
  assert.deepEqual(distEntries(dir), [], '成果物ができた');
});

test('T11. シェルスクリプトに、変数名として読まれる書き方が残っていない', () => {
  // bash 3.2 は "$VAR。" を「VAR。」という名前の変数として読む。
  // set -u と組み合わさると、その行に来た瞬間に死ぬ。
  // 同じ書き方を2度作り込んだので、目視ではなく機械で止める。
  const bad = [];
  for (const rel of ['tools/package.sh']) {
    const lines = fs.readFileSync(path.join(REPO, rel), 'utf8').split('\n');
    lines.forEach((line, i) => {
      // ${VAR} 形式は安全。$VAR の直後に非 ASCII が続くものだけを拾う。
      if (/\$[A-Za-z_][A-Za-z0-9_]*[^\x00-\x7f]/.test(line)) {
        bad.push(`${rel}:${i + 1}: ${line.trim()}`);
      }
    });
  }
  assert.deepEqual(bad, [], `変数の直後に非 ASCII が続く箇所は \${VAR} 形式にする:\n${bad.join('\n')}`);
});

// ---- T12〜T16. 出力先そのものが差し替えられているとき ----
//
// `mv A B` は B がディレクトリだと「B の中へ入れる」に化ける。実測では、
// B がディレクトリでも、ディレクトリへのシンボリックリンクでも mv は成功し、
// ZIP は B の中（リンクならリポジトリの外）へ置かれた。それでも表示は
// 「作成: B」のままなので、提出物ができたという主張だけが嘘になる。

function releaseName(dir) {
  return `postcloak-1.6.1-${shortHead(dir)}.zip`;
}

test('T12. 出力先がディレクトリなら失敗し、その中へ置かない', (t) => {
  const dir = makeRepo(t);
  const out = path.join(dir, 'dist', releaseName(dir));
  fs.mkdirSync(out, { recursive: true });

  const r = runPackage(dir);
  assert.notEqual(r.status, 0, 'ディレクトリなのに成功した');
  assert.match(r.stderr, /出力先 .* が通常のファイルではありません/, '作る前の確認で止まっていない');
  assert.deepEqual(fs.readdirSync(out), [], 'ディレクトリの中へ置いた');
});

test('T13. 出力先がディレクトリへのリンクなら失敗し、リンク先へ置かない', (t) => {
  const dir = makeRepo(t);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'postcloak-outdir-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
  fs.symlinkSync(outside, path.join(dir, 'dist', releaseName(dir)));

  const r = runPackage(dir);
  assert.notEqual(r.status, 0, 'リンクなのに成功した');
  assert.match(r.stderr, /出力先 .* がシンボリックリンクです/, '作る前の確認で止まっていない');
  assert.deepEqual(fs.readdirSync(outside), [], 'リンク先へ置いた');
});

test('T14. 出力先がファイルへのリンクなら失敗し、リンク先を書き換えない', (t) => {
  const dir = makeRepo(t);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'postcloak-outfile-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  const target = path.join(outside, 'target.bin');
  fs.writeFileSync(target, 'もとの中身');
  fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
  fs.symlinkSync(target, path.join(dir, 'dist', releaseName(dir)));

  const r = runPackage(dir);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /出力先 .* がシンボリックリンクです/, '作る前の確認で止まっていない');
  assert.equal(fs.readFileSync(target, 'utf8'), 'もとの中身', 'リンク先を書き換えた');
});

test('T15. 出力先が通常のファイルでなければ失敗する（FIFO）', (t) => {
  const dir = makeRepo(t);
  fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
  const out = path.join(dir, 'dist', releaseName(dir));
  const mk = spawnSync('mkfifo', [out]);
  if (mk.status !== 0) {
    assert.fail(`mkfifo が使えないため確認できない: ${mk.stderr}`);
  }

  const r = runPackage(dir);
  assert.notEqual(r.status, 0, 'FIFO なのに成功した');
  assert.match(r.stderr, /出力先 .* が通常のファイルではありません/, '作る前の確認で止まっていない');
  assert.ok(fs.lstatSync(out).isFIFO(), 'FIFO が置き換わった');
});

test('T16. 成功したときの成果物は、通常のファイルで、表示した SHA-256 と一致する', (t) => {
  const dir = makeRepo(t);
  const name = releaseName(dir);
  const out = path.join(dir, 'dist', name);

  // 先に別の中身の成果物を置いておく（置き換わることまで見る）
  fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
  fs.writeFileSync(out, '前の成果物');
  const before = sha256(out);

  const r = runPackage(dir);
  assert.equal(r.status, 0, `失敗した: ${r.stderr}`);

  const st = fs.lstatSync(out);
  assert.ok(!st.isSymbolicLink(), '成果物がシンボリックリンクになっている');
  assert.ok(st.isFile(), '成果物が通常のファイルではない');

  const actual = sha256(out);
  assert.notEqual(actual, before, '前の成果物が置き換わっていない');

  const reported = /SHA-256 : ([0-9a-f]{64})/.exec(r.stdout);
  assert.ok(reported, `表示に SHA-256 が無い: ${r.stdout}`);
  assert.equal(actual, reported[1], '表示した SHA-256 と実物が違う');

  // 一時ファイルが残っていない
  assert.deepEqual(distEntries(dir), [name], 'dist に余分なものが残っている');
});

// ---- T17・T18. 置いたあとの検査を、外から壊して確かめる ----
//
// 成果物を最終的な名前へ置いたあと、スクリプトはもう一度その型と SHA-256 を
// 確かめる。この2つは、置いた直後に外から割り込まれない限り破れないので、
// 普通のテストでは到達できない（第6回では変異させても1件も落ちなかった）。
//
// そこで、テストが起動する node の中だけで fs を包み、「置いたあとに型が
// 変わった」「置いたあとに中身が変わった」場面を作る。
// 製品側のコードにはデバッグ用の分岐を足していない。

const FAULT_SHIM = path.join(REPO, 'tools', 'fs-fault-shim.js');

test('T17. 置いたあとに型が変わっていたら、成果物を残さず失敗する', (t) => {
  const dir = makeRepo(t);
  const r = runPackage(dir, {
    env: { NODE_OPTIONS: `--require=${FAULT_SHIM}`, POSTCLOAK_TEST_FAULT: 'type' },
  });

  assert.notEqual(r.status, 0, '置いたあとの型が変わっていたのに成功した');
  assert.match(r.stderr, /置いたあとの .* が通常のファイルではないものになっています/);
  assert.deepEqual(distEntries(dir), [], '壊れた成果物が残っている');
});

test('T18. 置いたあとに中身が変わっていたら、成果物を残さず失敗する', (t) => {
  const dir = makeRepo(t);
  const r = runPackage(dir, {
    env: { NODE_OPTIONS: `--require=${FAULT_SHIM}`, POSTCLOAK_TEST_FAULT: 'sha' },
  });

  assert.notEqual(r.status, 0, '表示した SHA-256 と中身が違うのに成功した');
  assert.match(r.stderr, /SHA-256 が検査時と違います/);
  assert.deepEqual(distEntries(dir), [], '中身の違う成果物が残っている');
});

test('T19. 差し込みを入れても、指定が無ければ普通に作れる（対照）', (t) => {
  // T17・T18 が「差し込みを読み込んだせいで落ちた」のではないことを示す。
  const dir = makeRepo(t);
  const r = runPackage(dir, { env: { NODE_OPTIONS: `--require=${FAULT_SHIM}` } });

  assert.equal(r.status, 0, `差し込みを読み込んだだけで失敗した: ${r.stderr}`);
  assert.deepEqual(distEntries(dir), [`postcloak-1.6.1-${shortHead(dir)}.zip`]);
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
