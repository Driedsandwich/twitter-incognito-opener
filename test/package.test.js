'use strict';

// 配布物の一覧（tools/package-files.txt）と、manifest が実際に参照している
// ファイルを突き合わせる。
//
// これが無いと、あとから manifest へファイルを足したときに「リポジトリには
// あるが配布 ZIP には入っていない」拡張が出来上がり、手元では動くのに
// ストアに出したものだけ壊れる、という形の事故になる。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const LIST_PATH = path.join(ROOT, 'tools', 'package-files.txt');
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

function readPackageFiles() {
  return fs
    .readFileSync(LIST_PATH, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
}

const files = readPackageFiles();
const manifest = readJson('manifest.json');

test('配布一覧を読めていて、空でない', () => {
  // 対照: 読めていなければ以下の検査はすべて空振りになる
  assert.ok(files.length >= 5, `一覧を読めていない（${files.length}件）`);
  assert.ok(files.includes('manifest.json'));
});

test('manifest が参照する実行時ファイルが、すべて配布一覧に入っている', () => {
  const referenced = [
    manifest.background.service_worker,
    ...manifest.content_scripts.flatMap((cs) => cs.js),
    ...Object.values(manifest.icons),
  ];
  assert.ok(referenced.length >= 6, `参照を拾えていない（${referenced.length}件）`);
  for (const ref of referenced) {
    assert.ok(files.includes(ref), `配布一覧に無い: ${ref}（ZIP に入らない）`);
  }
});

test('翻訳ファイルが、既定の言語とその他の言語ともに配布一覧に入っている', () => {
  const locales = fs.readdirSync(path.join(ROOT, '_locales'));
  assert.ok(locales.includes(manifest.default_locale), '既定の言語のフォルダが無い');
  for (const locale of locales) {
    const rel = `_locales/${locale}/messages.json`;
    assert.ok(files.includes(rel), `配布一覧に無い: ${rel}`);
  }
});

test('LICENSE が配布一覧に入っている', () => {
  assert.ok(files.includes('LICENSE'));
});

test('配布一覧のファイルがすべて実在し、シンボリックリンクでない', () => {
  for (const f of files) {
    const full = path.join(ROOT, f);
    assert.ok(fs.existsSync(full), `一覧にあるが実在しない: ${f}`);
    assert.ok(!fs.lstatSync(full).isSymbolicLink(), `シンボリックリンク: ${f}`);
  }
});

test('配布物に入れてはいけないものが一覧に混ざっていない', () => {
  const mustNotShip = [
    'package.json',
    'tools/package-files.txt',
    'tools/package.sh',
    'README.md',
    'PRIVACY.md',
    'STORE_LISTING.md',
    'SMOKE.md',
    '.gitignore',
  ];
  for (const f of mustNotShip) {
    assert.ok(!files.includes(f), `配布一覧に入ってはいけない: ${f}`);
  }
  for (const f of files) {
    assert.ok(!f.startsWith('test/'), `テストが配布一覧に入っている: ${f}`);
    assert.ok(!f.startsWith('.github/'), `CI 設定が配布一覧に入っている: ${f}`);
  }
});

test('package.sh は一覧をファイルから読んでいる（二重管理になっていない）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'tools', 'package.sh'), 'utf8');
  assert.match(src, /FILES_LIST=tools\/package-files\.txt/);
  assert.match(src, /done < "\$FILES_LIST"/);
  // 通常モードは HEAD のコミット内容から作る
  assert.match(src, /git archive --format=zip/);
  // 検査を通ってから最終的な名前へ移す
  assert.match(src, /mv -f "\$TMP_ARCHIVE" "\$OUT"/);
  // 逃げ道は厳密に 1 のときだけ
  assert.match(src, /POSTCLOAK_ALLOW_DIRTY_PACKAGE:-\}" != "1"/);
});
