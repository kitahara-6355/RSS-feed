/**
 * Store.gs — スプレッドシートの読み書き。シート名と列はここで一元管理する。
 */
var SHEETS = {
  FEEDS: 'フィード',
  ARTICLES: '記事',
  KEYWORDS: '興味キーワード',
  SETTINGS: '設定',
  LOG: 'ログ'
};

var HEADERS = {
  FEEDS: ['有効', '名前', 'URL', 'カテゴリ', '重み', '最終取得', '状態'],
  ARTICLES: ['ID', '取得日時', '公開日時', 'ソース', 'タイトル', 'URL', '概要', 'タグ', '関連度',
    'AI要約', '興味度', '重要度', 'ステータス', '画像'],
  KEYWORDS: ['キーワード', '重み', '分類', '由来'],
  SETTINGS: ['項目', '値', '説明'],
  LOG: ['日時', '処理', '結果', '詳細']
};

var DEFAULT_SETTINGS = [
  ['要約方式', 'なし', 'なし / Sheets AI / Gemini無料API。なし は キーワード分類のみ'],
  ['関連度しきい値', 0, 'これ未満の記事は保存しない。0 なら全件保存'],
  ['1フィードあたり件数', 20, '1回の取得で見る新着の最大数'],
  ['1回のAI処理上限', 20, 'AI要約を1回の実行で何件まで作るか（無料枠の保護）'],
  ['Geminiモデル', 'gemini-2.5-flash-lite', 'Gemini無料APIを使う場合のモデル名。廃止されたら変更'],
  ['取得時刻', 6, '毎日この時（0〜23時）に自動取得']
];

var Store = (function () {
  function ss_() {
    return SpreadsheetApp.getActiveSpreadsheet();
  }

  function sheet(name) {
    return ss_().getSheetByName(name);
  }

  /** 足りないシートと見出しを作る。既にあるデータには触らない。 */
  function ensureSchema() {
    var ss = ss_();
    Object.keys(SHEETS).forEach(function (key) {
      var sh = ss.getSheetByName(SHEETS[key]) || ss.insertSheet(SHEETS[key]);
      var headers = HEADERS[key];
      if (sh.getLastRow() === 0) {
        sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
        sh.setFrozenRows(1);
      }
    });
    var settings = sheet(SHEETS.SETTINGS);
    if (settings.getLastRow() === 1) {
      settings.getRange(2, 1, DEFAULT_SETTINGS.length, 3).setValues(DEFAULT_SETTINGS);
    }
  }

  /** 見出し名 → 列番号(0始まり) */
  function index_(name) {
    var key = Object.keys(SHEETS).filter(function (k) { return SHEETS[k] === name; })[0];
    var idx = {};
    HEADERS[key].forEach(function (h, i) { idx[h] = i; });
    return idx;
  }

  function rows_(name) {
    var sh = sheet(name);
    if (!sh || sh.getLastRow() < 2) return [];
    return sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
  }

  function settings() {
    var out = {};
    rows_(SHEETS.SETTINGS).forEach(function (r) { if (r[0]) out[r[0]] = r[1]; });
    return out;
  }

  /** 有効なフィード。 */
  function feeds() {
    var c = index_(SHEETS.FEEDS);
    return rows_(SHEETS.FEEDS).map(function (r, i) {
      return {
        row: i + 2,
        enabled: r[c['有効']] === true,
        name: r[c['名前']],
        url: r[c['URL']],
        category: r[c['カテゴリ']],
        weight: Number(r[c['重み']]) || 0
      };
    }).filter(function (f) {
      return f.enabled && f.url;
    });
  }

  function markFeed(feed, status) {
    var c = index_(SHEETS.FEEDS);
    var sh = sheet(SHEETS.FEEDS);
    sh.getRange(feed.row, c['最終取得'] + 1, 1, 2).setValues([[new Date(), status]]);
  }

  function keywords() {
    var c = index_(SHEETS.KEYWORDS);
    return rows_(SHEETS.KEYWORDS).filter(function (r) { return r[c['キーワード']]; }).map(function (r) {
      return {
        keyword: String(r[c['キーワード']]),
        weight: Number(r[c['重み']]) || 0,
        tag: String(r[c['分類']] || r[c['キーワード']]),
        origin: r[c['由来']]
      };
    });
  }

  function existingIds() {
    var sh = sheet(SHEETS.ARTICLES);
    var ids = {};
    if (sh.getLastRow() < 2) return ids;
    sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().forEach(function (r) { ids[r[0]] = true; });
    return ids;
  }

  /** 記事を末尾に追加する。新しい順に並べたい場合はシートのフィルタで並べ替える。 */
  function appendArticles(items) {
    if (!items.length) return;
    var now = new Date();
    var values = items.map(function (a) {
      return [a.id, now, a.published || '', a.source, a.title, a.link, a.summary,
        (a.tags || []).join(', '), a.score, a.aiSummary || '', '', '', '未読', a.image || ''];
    });
    var sh = sheet(SHEETS.ARTICLES);
    sh.getRange(sh.getLastRow() + 1, 1, values.length, values[0].length).setValues(values);
  }

  /** AI要約が空の行（新しいものから）を返す。 */
  function articlesWithoutSummary(limit) {
    var c = index_(SHEETS.ARTICLES);
    var out = [];
    var rows = rows_(SHEETS.ARTICLES);
    for (var i = rows.length - 1; i >= 0 && out.length < limit; i--) {
      var r = rows[i];
      if (r[c['URL']] && !r[c['AI要約']]) {
        out.push({ row: i + 2, title: r[c['タイトル']], summary: r[c['概要']], link: r[c['URL']], tags: r[c['タグ']] });
      }
    }
    return out;
  }

  function writeSummary(row, summary, tags) {
    var c = index_(SHEETS.ARTICLES);
    var sh = sheet(SHEETS.ARTICLES);
    if (summary !== undefined) sh.getRange(row, c['AI要約'] + 1).setValue(summary);
    if (tags) sh.getRange(row, c['タグ'] + 1).setValue(tags.join(', '));
  }

  /** 興味度・重要度が付いた記事（学習用）。 */
  function ratedArticles() {
    var c = index_(SHEETS.ARTICLES);
    return rows_(SHEETS.ARTICLES).filter(function (r) {
      return r[c['興味度']] !== '' || r[c['重要度']] !== '';
    }).map(function (r) {
      return {
        source: r[c['ソース']],
        tags: String(r[c['タグ']] || '').split(',').map(function (t) { return t.trim(); }).filter(String),
        interest: Number(r[c['興味度']]) || 0,
        importance: Number(r[c['重要度']]) || 0,
        status: r[c['ステータス']]
      };
    });
  }

  /** 学習結果を書き戻す。手入力（由来が 学習 以外）の行は上書きしない。 */
  function saveLearned(tagScores, sourceScores) {
    var sh = sheet(SHEETS.KEYWORDS);
    var c = index_(SHEETS.KEYWORDS);
    var rows = rows_(SHEETS.KEYWORDS);
    var byKeyword = {};
    rows.forEach(function (r, i) { byKeyword[r[c['キーワード']]] = { row: i + 2, origin: r[c['由来']] }; });
    var appends = [];
    Object.keys(tagScores).forEach(function (tag) {
      var hit = byKeyword[tag];
      if (!hit) appends.push([tag, round_(tagScores[tag]), '', '学習']);
      else if (hit.origin === '学習') sh.getRange(hit.row, c['重み'] + 1).setValue(round_(tagScores[tag]));
    });
    if (appends.length) sh.getRange(sh.getLastRow() + 1, 1, appends.length, 4).setValues(appends);

    var fc = index_(SHEETS.FEEDS);
    var fsh = sheet(SHEETS.FEEDS);
    rows_(SHEETS.FEEDS).forEach(function (r, i) {
      var s = sourceScores[r[fc['名前']]];
      if (s !== undefined) fsh.getRange(i + 2, fc['重み'] + 1).setValue(round_(s));
    });
  }

  function log(action, result, detail) {
    var sh = sheet(SHEETS.LOG);
    if (!sh) return;
    sh.appendRow([new Date(), action, result, String(detail || '').slice(0, 1000)]);
  }

  function round_(n) {
    return Math.round(n * 100) / 100;
  }

  return {
    ensureSchema: ensureSchema,
    sheet: sheet,
    settings: settings,
    feeds: feeds,
    markFeed: markFeed,
    keywords: keywords,
    existingIds: existingIds,
    appendArticles: appendArticles,
    articlesWithoutSummary: articlesWithoutSummary,
    writeSummary: writeSummary,
    ratedArticles: ratedArticles,
    saveLearned: saveLearned,
    log: log
  };
})();
