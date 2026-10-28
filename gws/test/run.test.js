// node --test で実行: cd gws/test && npm install && node --test
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { loadGas } = require('./gas-mock');

const SRC = path.join(__dirname, '..', 'apps-script');
const fx = (f) => fs.readFileSync(path.join(__dirname, 'fixtures', f), 'utf8');

test('RSS 2.0 を解析し、HTMLを除去してIDを付ける', () => {
  const g = loadGas(SRC);
  const items = g.RssCore.parseFeed(fx('rss2_note.xml'), { source: '深津貴之' });
  assert.strictEqual(items.length, 2);
  assert.strictEqual(items[0].title, '生成AIとプロンプトエンジニアリングの現在地');
  assert.strictEqual(items[0].summary, 'ChatGPT以降の プロンプト 設計について&考える。');
  assert.strictEqual(items[0].author, 'fladdict');
  assert.strictEqual(items[0].image, 'https://assets.st-note.com/a.png');
  assert.strictEqual(items[0].source, '深津貴之');
  assert.strictEqual(items[0].published.toISOString(), '2026-10-26T00:00:00.000Z');
  // utm_ の有無で同じIDになる
  assert.strictEqual(items[0].id, g.RssCore.makeId('https://note.com/fladdict/n/n123'));
});

test('YouTube の Atom から説明文とサムネイルを取る', () => {
  const g = loadGas(SRC);
  const [v] = g.RssCore.parseFeed(fx('atom_youtube.xml'));
  assert.strictEqual(v.link, 'https://www.youtube.com/watch?v=abc');
  assert.strictEqual(v.summary, '生成AIを業務に取り入れる中小企業の事例。');
  assert.strictEqual(v.image, 'https://i.ytimg.com/vi/abc/hqdefault.jpg');
  assert.strictEqual(v.author, 'ReHacQ−リハック−');
});

test('Atom の alternate リンクと HTML 要約、RSS 1.0(RDF) に対応', () => {
  const g = loadGas(SRC);
  const [a] = g.RssCore.parseFeed(fx('atom_publickey.xml'));
  assert.strictEqual(a.link, 'https://www.publickey1.jp/blog/26/devops.html');
  assert.strictEqual(a.summary, 'コンテナのセキュリティ対策');
  const [r] = g.RssCore.parseFeed(fx('rdf_livedoor.xml'));
  assert.strictEqual(r.title, '金利と株価');
  assert.strictEqual(r.author, 'kazu');
  assert.strictEqual(r.published.toISOString(), '2026-10-19T23:00:00.000Z');
});

test('フィードでないものは例外', () => {
  const g = loadGas(SRC);
  assert.throws(() => g.RssCore.parseFeed(fx('not_feed.xml')), /対応していない形式/);
});

function setupWith(fetchMap, properties) {
  const g = loadGas(SRC, { fetchMap, properties });
  g.SEED_FEEDS = [
    ['深津貴之', 'https://note.com/fladdict/rss', 'AI'],
    ['リハック', 'https://yt/rehacq', 'お気に入り'],
    ['壊れたフィード', 'https://broken/feed', 'テスト']
  ];
  g.SEED_KEYWORDS = [['生成AI', 5.5], ['プロンプト', 4, 'AI活用'], ['セキュリティ', 5]];
  g.setup();
  return g;
}

test('取得 → 分類 → 記事シートに追加、2回目は重複しない', () => {
  const g = setupWith({ 'https://note.com/fladdict/rss': fx('rss2_note.xml'), 'https://yt/rehacq': fx('atom_youtube.xml') });
  g.runFetch();
  const rows = g.__sheets['記事'].data();
  assert.strictEqual(rows.length, 1 + 3);
  const byTitle = Object.fromEntries(rows.slice(1).map((r) => [r[4], r]));
  assert.strictEqual(byTitle['生成AIとプロンプトエンジニアリングの現在地'][7], '生成AI, AI活用');
  assert.strictEqual(byTitle['生成AIとプロンプトエンジニアリングの現在地'][8], 5.5);
  assert.strictEqual(byTitle['週末の散歩'][8], 0);
  // 公開日時の古い順に追加される
  assert.strictEqual(rows[1][4], '週末の散歩');

  const feeds = g.__sheets['フィード'].data();
  assert.match(feeds[3][7], /^エラー: HTTP 404/);
  assert.match(feeds[1][7], /新着2件/);

  g.runFetch();
  assert.strictEqual(g.__sheets['記事'].data().length, 4);
  assert.match(g.__sheets['ログ'].data().at(-1)[3], /追加0件/);
});

test('関連度しきい値で除外できる', () => {
  const g = setupWith({ 'https://note.com/fladdict/rss': fx('rss2_note.xml') });
  g.__sheets['設定'].data().find((r) => r[0] === '関連度しきい値')[1] = 1;
  g.runFetch();
  assert.strictEqual(g.__sheets['記事'].data().length, 1 + 1);
});

test('Sheets AI 方式は =AI() の式を置くだけ', () => {
  const g = setupWith({ 'https://note.com/fladdict/rss': fx('rss2_note.xml') });
  g.__sheets['設定'].data().find((r) => r[0] === '要約方式')[1] = 'Sheets AI';
  g.runFetch();
  const rows = g.__sheets['記事'].data();
  assert.match(rows[1][9], /^=AI\(".+", E2:G2\)$/);
  assert.match(rows[2][9], /E3:G3/);
});

test('Gemini無料API 方式はまとめて1回で要約し、タグを足す', () => {
  const calls = [];
  const fetchMap = {
    'https://note.com/fladdict/rss': fx('rss2_note.xml'),
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent': () => {
      calls.push(1);
      const out = [{ summary: '・要点A', tags: ['雑記'] }, { summary: '・要点B', tags: ['生成AI', 'LLM'] }];
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(out) }] } }] }) };
    }
  };
  const g = setupWith(fetchMap, { GEMINI_API_KEY: 'test' });
  g.__sheets['設定'].data().find((r) => r[0] === '要約方式')[1] = 'Gemini無料API';
  g.runFetch();
  assert.strictEqual(calls.length, 1);
  const rows = g.__sheets['記事'].data();
  // 新しい記事から順に送るので、行3(生成AI記事)が先頭
  assert.strictEqual(rows[2][9], '・要点A');
  assert.strictEqual(rows[1][9], '・要点B');
  assert.strictEqual(rows[1][7], '生成AI, LLM');
});

test('APIキー未設定ならログにエラーを残して止まらない', () => {
  const g = setupWith({ 'https://note.com/fladdict/rss': fx('rss2_note.xml') });
  g.__sheets['設定'].data().find((r) => r[0] === '要約方式')[1] = 'Gemini無料API';
  g.runFetch();
  assert.match(g.__sheets['ログ'].data().at(-1)[3], /GEMINI_API_KEY/);
});

test('評価から学習し、手入力の重みは上書きしない', () => {
  const g = setupWith({ 'https://note.com/fladdict/rss': fx('rss2_note.xml') });
  g.runFetch();
  const rows = g.__sheets['記事'].data();
  const ai = rows.find((r) => r[4].startsWith('生成AI'));
  ai[10] = 5; ai[11] = 4; ai[12] = 'あとで読む';
  g.runLearn();
  const kw = g.__sheets['興味キーワード'].data();
  assert.strictEqual(kw.find((r) => r[0] === '生成AI')[1], 5.5); // 旧版プロファイル由来は変えない
  assert.deepStrictEqual(kw.find((r) => r[0] === 'AI活用'), ['AI活用', 5.6, '', '学習']);
  assert.strictEqual(g.__sheets['フィード'].data()[1][5], 5.6);
});

test('用途でフィードを絞れる（SNSダッシュボードからの再利用）', () => {
  const g = setupWith({});
  g.__sheets['フィード'].data()[2][4] = 'SNS監視';
  assert.deepStrictEqual(Array.from(g.Store.feeds('SNS監視'), (f) => f.name), ['リハック']);
  assert.strictEqual(g.Store.feeds('学習').length, 2);
});

test('YouTube登録チャンネルCSVを取り込み、カテゴリを推測し、既存フィードは飛ばす', () => {
  const g = loadGas(SRC);
  g.setup(); // 初期フィードに ReHacQ が入っている
  const before = g.__sheets['フィード'].data().length;
  const n = g.importYoutubeSubscriptionsFromCsv(fx('subscriptions_sample.csv'), '学習');
  assert.strictEqual(n, 3);
  const rows = g.__sheets['フィード'].data().slice(before);
  assert.deepStrictEqual(rows.map((r) => [r[0], r[1], r[3]]), [
    [false, 'サンプルAI研究所', 'AI・DX'],
    [false, 'サンプル, バドミントン部', '運動系01_バド'],
    [false, 'なにかのチャンネル', '未分類']
  ]);
  assert.strictEqual(rows[0][2], 'https://www.youtube.com/feeds/videos.xml?channel_id=UCaaaaaaaaaaaaaaaaaaaaaa');
  // 2回目は何も増えない
  assert.strictEqual(g.importYoutubeSubscriptionsFromCsv(fx('subscriptions_sample.csv')), 0);
});
