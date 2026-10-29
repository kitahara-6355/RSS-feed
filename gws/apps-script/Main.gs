/**
 * Main.gs — メニューと自動実行。旧版の GitHub Actions（6時間ごと／毎朝6時）の置き換え。
 */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('RSS学習ログ')
    .addItem('初期設定（シート作成と初期データ）', 'setup')
    .addItem('利用者を登録（1人1冊を作る）', 'registerUserDialog')
    .addSeparator()
    .addItem('今すぐ取得', 'runFetch')
    .addItem('AI要約を補完', 'runSummaries')
    .addItem('評価から興味を学習', 'runLearn')
    .addItem('YouTube登録チャンネルを取り込む', 'importYoutubeSubscriptions')
    .addSeparator()
    .addItem('自動実行をオンにする', 'installTriggers')
    .addItem('自動実行をオフにする', 'removeTriggers')
    .addToUi();
}

/**
 * シートを作り、空ならプロフィールの「初期データ」に応じたフィードと興味キーワードを入れる。
 * 何度実行しても安全（既にあるデータには触らない）。
 */
function setup() {
  Store.ensureSchema();
  seedPreset_(Store.profile()['初期データ'] || '空');
  Store.log('初期設定', 'OK', '');
}

function seedPreset_(name) {
  var preset = SEED_PRESETS[name];
  if (!preset) throw new Error('初期データ「' + name + '」はありません');
  var feeds = Store.sheet(SHEETS.FEEDS);
  if (feeds.getLastRow() === 1 && preset.feeds.length) {
    var rows = preset.feeds.map(function (f) { return [true, f[0], f[1], f[2], '', '', '']; });
    feeds.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
    feeds.getRange(2, 1, rows.length, 1).insertCheckboxes();
  }
  var kw = Store.sheet(SHEETS.KEYWORDS);
  if (kw.getLastRow() === 1 && preset.keywords.length) {
    var kwRows = preset.keywords.map(function (k) { return [k[0], k[1], k[2] || '', preset.origin]; });
    kw.getRange(2, 1, kwRows.length, 4).setValues(kwRows);
  }
}

/** 新着を取得し、キーワード分類して記事シートに追加する。 */
function runFetch() {
  var settings = Store.settings();
  var limit = Number(settings['1フィードあたり件数']) || 20;
  var threshold = Number(settings['関連度しきい値']) || 0;
  var keywords = Store.keywords();
  var seen = Store.existingIds();
  var added = [];
  var skipped = 0;
  var errors = [];

  RssCore.fetchFeeds(Store.feeds(), { limit: limit }).forEach(function (result) {
    var feed = result.feed;
    if (result.error) {
      errors.push(feed.name + ': ' + result.error);
      Store.markFeed(feed, 'エラー: ' + result.error);
      return;
    }
    var count = 0;
    result.items.forEach(function (item) {
      if (seen[item.id]) return;
      seen[item.id] = true;
      var c = Classify.byKeywords(item, keywords, feed.weight);
      if (c.score < threshold) { skipped++; return; }
      item.tags = c.tags;
      item.score = c.score;
      added.push(item);
      count++;
    });
    Store.markFeed(feed, 'OK（新着' + count + '件）');
  });

  added.sort(function (a, b) { return (a.published || 0) - (b.published || 0); });
  Store.appendArticles(added);
  Store.log('取得', errors.length ? '一部エラー' : 'OK',
    '追加' + added.length + '件 / しきい値で除外' + skipped + '件' + (errors.length ? ' / ' + errors.join(' | ') : ''));

  if (settings['要約方式'] && settings['要約方式'] !== 'なし') runSummaries();
}

function runSummaries() {
  try {
    var n = Classify.fillSummaries(Store.settings());
    Store.log('AI要約', 'OK', n + '件');
  } catch (e) {
    Store.log('AI要約', 'エラー', e.message);
  }
}

/**
 * 記事シートの 興味度・重要度（1〜5）とステータスから、タグとフィードの重みを計算し直す。
 * 計算式は旧版 learn_from_feedback.py と同じ: 興味度×0.6 ＋ 重要度×0.4 ＋（あとで読む/完了なら1）
 */
function runLearn() {
  var tagTotals = {};
  var sourceTotals = {};
  Store.ratedArticles().forEach(function (a) {
    var bonus = (a.status === 'あとで読む' || a.status === '完了') ? 1 : 0;
    var score = a.interest * 0.6 + a.importance * 0.4 + bonus;
    if (score <= 0) return;
    a.tags.forEach(function (t) { add_(tagTotals, t, score); });
    add_(sourceTotals, a.source, score);
  });
  Store.saveLearned(average_(tagTotals), average_(sourceTotals));
  Store.log('学習', 'OK', 'タグ' + Object.keys(tagTotals).length + '件 / ソース' + Object.keys(sourceTotals).length + '件');
}

function add_(totals, key, score) {
  if (!key) return;
  totals[key] = totals[key] || { sum: 0, n: 0 };
  totals[key].sum += score;
  totals[key].n++;
}

function average_(totals) {
  var out = {};
  Object.keys(totals).forEach(function (k) { out[k] = totals[k].sum / totals[k].n; });
  return out;
}

/** 毎日の取得と、毎週月曜の学習を登録する。Apps Script のトリガーは無料の上限内（1日の合計実行時間に上限あり）。 */
function installTriggers() {
  removeTriggers();
  var hour = Number(Store.settings()['取得時刻']);
  ScriptApp.newTrigger('runFetch').timeBased().everyDays(1).atHour(isNaN(hour) ? 6 : hour).create();
  ScriptApp.newTrigger('runLearn').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(5).create();
  Store.log('自動実行', 'オン', '');
}

function removeTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['runFetch', 'runLearn'].indexOf(t.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(t);
  });
}
