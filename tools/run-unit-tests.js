// 拡張そのもののテストだけを走らせる（Windows など、提出物を作る道具が
// 揃っていない環境向け）。
//
//   node tools/run-unit-tests.js
//
// ファイルを手で並べない。`node --test` は test/ を**再帰的に**探し、
// `.js` / `.cjs` / `.mjs` をテストとして実行する（実測: Node 22.22.3 で
// 入れ子の .js と拡張子 .test.js でない .js も拾う）。手で並べた一覧だと、
// あとから足したテストが Windows 側だけ黙って走らなくなる。
//
// ここでは同じ規則で探し、**除外するのは1ファイルだけ**にする。
// シェルの展開や find に頼らないので、Windows でもそのまま動く。
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const TEST_DIR = 'test';

// 除外してよいのは「提出物を作る手順を実際に起動するテスト」だけ。
// bash・git・zip・unzip が要るため、Windows のランナーでは走らない。
// 完全一致で比べる。名前だけで比べると、入れ子に同名のファイルを置いたときに
// それも一緒に消える。
const EXCLUDED = ['test/package-script.test.js'];

const EXTENSIONS = ['.js', '.cjs', '.mjs'];

// 純粋な関数にしておく（テストから直接呼べるように）
function findTestFiles(root, dir = TEST_DIR) {
  const out = [];
  const walk = (rel) => {
    const entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
    for (const e of entries) {
      const childRel = `${rel}/${e.name}`;
      if (e.isDirectory()) {
        walk(childRel);
      } else if (e.isFile() && EXTENSIONS.includes(path.extname(e.name))) {
        out.push(childRel);
      }
    }
  };
  walk(dir);
  return out.filter((f) => !EXCLUDED.includes(f)).sort();
}

module.exports = { findTestFiles, EXCLUDED, EXTENSIONS };

if (require.main === module) {
  const files = findTestFiles(ROOT);
  if (files.length === 0) {
    console.error(`エラー: ${TEST_DIR}/ にテストが1つも見つかりません`);
    process.exit(1);
  }
  const r = spawnSync(process.execPath, ['--test', ...files], { cwd: ROOT, stdio: 'inherit' });
  if (r.error) {
    console.error(`エラー: テストを起動できません: ${r.error.message}`);
    process.exit(1);
  }
  // シグナルで死んだ場合も 0 で返さない
  process.exit(r.status === null ? 1 : r.status);
}
