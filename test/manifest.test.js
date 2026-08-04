'use strict';

// manifest と _locales と実ファイルの食い違いを機械で突き合わせる。
// 目視では、片方の言語にキーを足し忘れた・参照先のファイル名を変えた、を見落とす。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

const manifest = readJson('manifest.json');
const en = readJson('_locales/en/messages.json');
const ja = readJson('_locales/ja/messages.json');

// manifest が参照している __MSG_*__ を全部拾う
function messageKeysUsedInManifest() {
  const found = new Set();
  const walk = (node) => {
    if (typeof node === 'string') {
      const m = node.match(/^__MSG_(\w+)__$/);
      if (m) found.add(m[1]);
    } else if (Array.isArray(node)) {
      node.forEach(walk);
    } else if (node && typeof node === 'object') {
      Object.values(node).forEach(walk);
    }
  };
  walk(manifest);
  return [...found];
}

test('manifest が参照する翻訳キーが両方の言語に存在する', () => {
  const used = messageKeysUsedInManifest();
  // 対照: 参照が1つも拾えていないなら、この検査自体が空振りしている
  assert.ok(used.length >= 3, `__MSG_*__ を拾えていない（${used.length}件）`);
  for (const key of used) {
    assert.ok(key in en, `en に無いキー: ${key}`);
    assert.ok(key in ja, `ja に無いキー: ${key}`);
  }
});

test('en と ja のキー集合が一致する', () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(ja).sort());
});

test('すべての訳文が空でない', () => {
  for (const [locale, messages] of [['en', en], ['ja', ja]]) {
    for (const [key, entry] of Object.entries(messages)) {
      assert.equal(typeof entry.message, 'string', `${locale}/${key} に message が無い`);
      assert.ok(entry.message.trim().length > 0, `${locale}/${key} が空`);
    }
  }
});

test('ウェブストアの上限に収まっている（名前75字・説明132字）', () => {
  for (const [locale, messages] of [['en', en], ['ja', ja]]) {
    assert.ok(
      messages.extName.message.length <= 75,
      `${locale} の名前が長い: ${messages.extName.message.length}字`
    );
    assert.ok(
      messages.extDescription.message.length <= 132,
      `${locale} の説明が長い: ${messages.extDescription.message.length}字`
    );
  }
});

test('default_locale のフォルダが実在する', () => {
  assert.ok(manifest.default_locale, 'default_locale が無い');
  assert.ok(
    fs.existsSync(path.join(ROOT, '_locales', manifest.default_locale, 'messages.json')),
    `_locales/${manifest.default_locale}/messages.json が無い`
  );
});

test('manifest が挙げているファイルがすべて実在する', () => {
  const files = [
    manifest.background.service_worker,
    ...Object.values(manifest.icons),
    ...manifest.content_scripts.flatMap((cs) => cs.js),
  ];
  assert.ok(files.length >= 6, `参照ファイルを拾えていない（${files.length}件）`);
  for (const f of files) {
    assert.ok(fs.existsSync(path.join(ROOT, f)), `参照先が無い: ${f}`);
  }
});

test('content script は post-url.js を content.js より先に読む', () => {
  for (const cs of manifest.content_scripts) {
    assert.ok(
      cs.js.indexOf('post-url.js') < cs.js.indexOf('content.js'),
      `読み込み順が逆: ${cs.js.join(', ')}`
    );
  }
});

test('service worker が post-url.js を読み込んでいる', () => {
  const src = fs.readFileSync(path.join(ROOT, manifest.background.service_worker), 'utf8');
  assert.match(src, /importScripts\(['"]post-url\.js['"]\)/);
  // module 形式の service worker では importScripts が使えない
  assert.notEqual(manifest.background.type, 'module');
});

test('入れ直しでも同じ順序で両方のファイルを入れている', () => {
  const src = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
  assert.match(src, /files:\s*\['post-url\.js',\s*'content\.js'\]/);
});

test('package.json と manifest のバージョンが揃っている', () => {
  assert.equal(readJson('package.json').version, manifest.version);
});

test('要求している権限が2つのままである', () => {
  assert.deepEqual([...manifest.permissions].sort(), ['contextMenus', 'scripting']);
  assert.equal(manifest.host_permissions.length, 4);
});
