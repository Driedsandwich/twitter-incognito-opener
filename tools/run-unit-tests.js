// 拡張そのもののテストだけを走らせる（Windows など、提出物を作る道具が
// 揃っていない環境向け）。
//
//   node tools/run-unit-tests.js          … 拡張のテストだけ
//   node tools/run-unit-tests.js --full   … 提出物を作る手順のテストも
//
// **探索は Node 自身にさせる。** 以前はここで `test/` を自前で走査していたが、
// Node の既定の探索とずれていた（実測）。
//
//   - Node は `test/` の外でも `test-*.js` / `*-test.js` / `*.test.js` などを拾う
//     → 自前の走査は拾わない
//   - Node は隠しファイル・隠しディレクトリを無視する
//     → 自前の走査は拾ってしまう
//
// 規則を書き写すたびに、Node 側の更新でずれる。そこで、
// **提出物を作る手順のテストを Node の探索に当たらない場所と名前へ置き**、
// 拡張のテストは `node --test` にそのまま探させる。
// こうすると「探索の一致」を保つ仕事が無くなる。
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');

// 提出物を作る手順のテスト。bash・git・zip・unzip が要るので Windows では走らせない。
//
// このパスと名前は「Node の既定の探索に当たらないこと」が条件。
// `test/` の下に置かず、`test.js` / `test-*.js` / `*-test.js` / `*_test.js` /
// `*.test.js` のいずれにも当てはめない。tools/run-unit-tests.test.js が
// この条件を機械で確かめている。
const INTEGRATION_TEST = 'integration/package-script.js';

// Node が既定でテストとして扱うファイル名（`test/` 配下は別に全部対象）
const NODE_TEST_NAME_PATTERNS = [
  /^test\.[cm]?js$/,
  /^test-.*\.[cm]?js$/,
  /.*-test\.[cm]?js$/,
  /.*_test\.[cm]?js$/,
  /.*\.test\.[cm]?js$/,
];

// 与えたパスが Node の既定の探索に当たるか。
// 統合テストの置き場所を選ぶときの判定に使う（純粋な関数）。
function isDiscoveredByNode(relPath) {
  const parts = relPath.split('/');
  if (parts.some((p) => p.startsWith('.'))) return false; // 隠しは無視される
  if (parts[0] === 'test') return /\.[cm]?js$/.test(relPath);
  return NODE_TEST_NAME_PATTERNS.some((re) => re.test(parts[parts.length - 1]));
}

function run(args) {
  const r = spawnSync(process.execPath, ['--test', ...args], { cwd: ROOT, stdio: 'inherit' });
  if (r.error) {
    console.error(`エラー: テストを起動できません: ${r.error.message}`);
    return 1;
  }
  // シグナルで死んだ場合も 0 で返さない
  return r.status === null ? 1 : r.status;
}

module.exports = { INTEGRATION_TEST, NODE_TEST_NAME_PATTERNS, isDiscoveredByNode };

if (require.main === module) {
  const full = process.argv.includes('--full');

  if (isDiscoveredByNode(INTEGRATION_TEST)) {
    console.error(
      `エラー: ${INTEGRATION_TEST} は Node の既定の探索に当たります。\n` +
        '拡張のテストだけを走らせる意味が無くなるので、探索に当たらない場所と名前へ移してください。'
    );
    process.exit(1);
  }
  if (!fs.existsSync(path.join(ROOT, INTEGRATION_TEST))) {
    console.error(`エラー: ${INTEGRATION_TEST} がありません`);
    process.exit(1);
  }

  // 拡張のテスト。探索は Node に任せる（自前で歩かない）。
  let status = run([]);

  if (full) {
    const integration = run([INTEGRATION_TEST]);
    if (status === 0) status = integration;
  }

  process.exit(status);
}
