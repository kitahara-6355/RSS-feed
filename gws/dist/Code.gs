// ===== RssCore.gs =====
/**
 * RssCore.gs — RSS / Atom / RDF を取得して共通の形にそろえる部品（共通の核）。
 *
 * 法人版SNSダッシュボード、克洋さん版（マイプロジェクト）、RSS学習ログで同じファイルを使う。
 * ライブラリとして共有はせず、各版のプロジェクトにこのファイルをそのままコピーする
 * （アカウントとデータを混ぜないため）。直すときは core/ を直して各版へ配る。
 *
 *   var items = RssCore.fetchFeed('https://example.com/rss', { source: '見本' });
 *   // => [{ id, source, title, link, published, author, summary, image }]
 *   var results = RssCore.fetchFeeds([{ url, name }, ...]);
 *   // => [{ feed, items, error }]   1件失敗しても他は取れる
 *
 * シートにもAIにも依存しない。外部とのやりとりは UrlFetchApp だけ。
 */
var RssCore = (function () {
  var VERSION = '1.0.0';
  var UA = 'Mozilla/5.0 (compatible; GwsRssCore/1.0; +Google Apps Script)';

  function request_(url) {
    return { url: String(url).trim(), muteHttpExceptions: true, followRedirects: true, headers: { 'User-Agent': UA } };
  }

  /** 1つのフィードを取得して記事の配列を返す。失敗したら例外。 */
  function fetchFeed(url, opts) {
    opts = opts || {};
    var res = UrlFetchApp.fetch(String(url).trim(), request_(url));
    var code = res.getResponseCode();
    if (code >= 400) throw new Error('HTTP ' + code);
    return parseFeed(res.getContentText(), { source: opts.source || url, limit: opts.limit });
  }

  /** 複数フィードをまとめて取得する。1件の失敗で全体を止めない。feeds は {url, name} の配列。 */
  function fetchFeeds(feeds, opts) {
    opts = opts || {};
    var responses = null;
    try {
      responses = UrlFetchApp.fetchAll(feeds.map(function (f) { return request_(f.url); }));
    } catch (e) {
      // fetchAll は1件でもURLが不正だと全体が例外になるので、1件ずつに切り替える
      responses = null;
    }
    return feeds.map(function (f, i) {
      try {
        var items;
        if (responses) {
          var code = responses[i].getResponseCode();
          if (code >= 400) throw new Error('HTTP ' + code);
          items = parseFeed(responses[i].getContentText(), { source: f.name || f.url, limit: opts.limit });
        } else {
          items = fetchFeed(f.url, { source: f.name || f.url, limit: opts.limit });
        }
        return { feed: f, items: items, error: '' };
      } catch (e) {
        return { feed: f, items: [], error: String(e && e.message ? e.message : e) };
      }
    });
  }

  /** XML文字列を解析する。RSS 2.0 / Atom 1.0 / RSS 1.0(RDF) に対応。 */
  function parseFeed(xmlText, opts) {
    var root = XmlService.parse(sanitizeXml(xmlText)).getRootElement();
    return parseTree(toTree_(root), opts);
  }

  /**
   * 木の形（{name, attrs, text, children}）から記事を取り出す。GoogleのサービスなしでテストできるようXmlServiceと分けてある。
   * 名前空間の接頭辞は無視して、要素のローカル名で読む。
   */
  function parseTree(root, opts) {
    opts = opts || {};
    var limit = opts.limit || 50;
    var source = opts.source || '';
    var rootName = local_(root && root.name);
    var entries;
    var about = ''; // 発信元が自分で書いている紹介文（RSS の channel/description、Atom の subtitle）
    if (rootName === 'feed') {
      entries = kids_(root, 'entry');
      about = text_(root, 'subtitle');
    } else if (rootName === 'rss') {
      var channel = kids_(root, 'channel')[0];
      entries = channel ? kids_(channel, 'item') : [];
      about = channel ? text_(channel, 'description') : '';
    } else if (rootName === 'RDF') {
      entries = kids_(root, 'item');
    } else {
      throw new Error('対応していない形式です: <' + rootName + '>');
    }
    var out = [];
    entries.slice(0, limit).forEach(function (e) {
      var group = kids_(e, 'group')[0]; // YouTube のフィードは media:group の中に説明とサムネイルがある
      var desc = text_(e, 'description') || text_(e, 'summary') || text_(e, 'content') || text_(e, 'encoded') ||
        (group ? text_(group, 'description') : '');
      var link = atomLink_(e) || text_(e, 'link') || text_(e, 'guid');
      if (!link) return;
      var authorEl = kids_(e, 'author')[0];
      out.push({
        id: makeId(link),
        source: source,
        title: toPlainText(text_(e, 'title')) || '(タイトルなし)',
        link: link.trim(),
        published: toDate_(text_(e, 'pubDate') || text_(e, 'published') || text_(e, 'updated') || text_(e, 'date')),
        author: text_(e, 'creator') || (authorEl ? (text_(authorEl, 'name') || String(authorEl.text || '').trim()) : ''),
        summary: truncate_(toPlainText(desc), 300),
        image: image_(e, group, desc),
        paid: paid_(e, desc),
        sourceAbout: truncate_(toPlainText(about), 120)
      });
    });
    return out;
  }

  /** XmlService の要素を parseTree が読める形にする。 */
  function toTree_(el) {
    var ns = el.getNamespace();
    var prefix = ns && ns.getPrefix() ? ns.getPrefix() + ':' : '';
    var attrs = {};
    el.getAttributes().forEach(function (a) { attrs[a.getName()] = a.getValue(); });
    return { name: prefix + el.getName(), attrs: attrs, text: el.getText(), children: el.getChildren().map(toTree_) };
  }

  function local_(name) {
    name = String(name || '');
    var i = name.indexOf(':');
    return i >= 0 ? name.slice(i + 1) : name;
  }

  function kids_(node, name) {
    return (node.children || []).filter(function (c) { return local_(c.name) === name; });
  }

  function text_(node, name) {
    var c = kids_(node, name)[0];
    return c ? String(c.text || '').trim() : '';
  }

  function atomLink_(entry) {
    var links = kids_(entry, 'link').filter(function (l) { return l.attrs && l.attrs.href; });
    if (!links.length) return '';
    var alt = links.filter(function (l) { return !l.attrs.rel || l.attrs.rel === 'alternate'; })[0];
    return (alt || links[0]).attrs.href;
  }

  function image_(entry, group, html) {
    var thumb = (group && kids_(group, 'thumbnail')[0]) || kids_(entry, 'thumbnail')[0];
    if (thumb && thumb.attrs && thumb.attrs.url) return thumb.attrs.url;
    var enc = kids_(entry, 'enclosure')[0];
    if (enc && enc.attrs && /^image\//.test(enc.attrs.type || '')) return enc.attrs.url;
    var m = /<img[^>]+src=["']([^"']+)["']/i.exec(html || '');
    return m ? m[1] : '';
  }

  /**
   * 有料記事かどうか。note などは item に価格の要素（price 等）を付けることがあるので、名前に price・paid・premium を
   * 含む要素の値を見る。要素がないときは本文の「有料」「この続きをみるには」で判断する。
   */
  function paid_(entry, html) {
    var hit = (entry.children || []).some(function (c) {
      var n = local_(c.name).toLowerCase();
      var v = String(c.text || '').trim().toLowerCase();
      if (n.indexOf('price') !== -1) return Number(v.replace(/[^0-9.]/g, '')) > 0;
      if (n.indexOf('paid') !== -1 || n.indexOf('premium') !== -1) return v === 'true' || v === '1' || v === 'yes';
      return false;
    });
    return hit || /有料記事|この続きをみるには|この記事は有料/.test(String(html || ''));
  }

  function toDate_(s) {
    if (!s) return null;
    var d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  function truncate_(s, max) {
    return s.length <= max ? s : s.slice(0, max - 1) + '…';
  }

  /** HTMLを取り除いて読める文字にする（改行は残す）。 */
  function toPlainText(s) {
    return String(s || '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
      .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(Number(n)); })
      .replace(/&amp;/g, '&')
      .replace(/[ \t\u00A0]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /**
   * XMLとして読めない文字を直す。RSSには &nbsp; などHTMLの書き方や、裸の & が混ざっていることがある。
   */
  function sanitizeXml(text) {
    return String(text || '')
      .replace(/^\uFEFF/, '')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(/&nbsp;/g, '&#160;')
      .replace(/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;');
  }

  /** URLを比べやすい形にする（#以降、utm_*・fbclid・gclid、末尾のスラッシュを落とす）。 */
  function normalizeUrl(url) {
    var s = String(url || '').trim().replace(/#.*$/, '');
    var q = s.indexOf('?');
    if (q >= 0) {
      var params = s.slice(q + 1).split('&').filter(function (p) {
        return p && !/^utm_/i.test(p) && !/^(fbclid|gclid)=/i.test(p);
      });
      s = params.length ? s.slice(0, q) + '?' + params.join('&') : s.slice(0, q);
    }
    return s.replace(/\/+$/, '');
  }

  /** 重複判定用のID（正規化したURLのMD5の先頭16桁）。 */
  function makeId(link) {
    var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, normalizeUrl(link), Utilities.Charset.UTF_8);
    return bytes.map(function (b) { return ((b + 256) % 256).toString(16).padStart(2, '0'); }).join('').slice(0, 16);
  }

  /** 取り込み済みのURLを除き、新しい記事だけを返す。maxAgeDays より古い記事も除く。 */
  function pickNew(items, existingUrls, now, maxAgeDays) {
    var seen = {};
    (existingUrls || []).forEach(function (u) { seen[normalizeUrl(u)] = true; });
    var limit = maxAgeDays ? new Date(now).getTime() - maxAgeDays * 24 * 60 * 60 * 1000 : null;
    return items.filter(function (it) {
      var key = normalizeUrl(it.link);
      if (seen[key]) return false;
      if (limit && it.published && it.published.getTime() < limit) return false;
      seen[key] = true;
      return true;
    });
  }

  return {
    VERSION: VERSION,
    fetchFeed: fetchFeed,
    fetchFeeds: fetchFeeds,
    parseFeed: parseFeed,
    parseTree: parseTree,
    toPlainText: toPlainText,
    sanitizeXml: sanitizeXml,
    normalizeUrl: normalizeUrl,
    makeId: makeId,
    pickNew: pickNew
  };
})();

// ===== Store.gs =====
/**
 * Store.gs — スプレッドシートの読み書き。シート名と列はここで一元管理する。
 */
var SHEETS = {
  PROFILE: 'プロフィール',
  FEEDS: 'フィード',
  ARTICLES: '記事',
  KEYWORDS: '興味キーワード',
  SETTINGS: '設定',
  LOG: 'ログ'
};

var HEADERS = {
  PROFILE: ['項目', '値', '説明'],
  FEEDS: ['有効', '名前', 'URL', 'カテゴリ', '重み', '最終取得', '状態', '紹介'],
  ARTICLES: ['ID', '取得日時', '公開日時', 'ソース', 'タイトル', 'URL', '概要', 'タグ', '関連度',
    'AI要約', '興味度', '重要度', 'ステータス', '画像', '当たった興味ワード', '書き手'],
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
  ['取得時刻', 6, '毎日この時（0〜23時）に自動取得'],
  ['朝のメール', 'オン', 'オン / オフ。毎朝の取得のあと、関連度の高い未読を最大10件メールで送る'],
  ['有料記事を外す', 'オン', 'オン / オフ。note などの有料記事を保存しない'],
  ['エラーで止める回数', 3, '同じフィードがこの回数続けて失敗したら、有効のチェックを自動で外す'],
  ['取得しないサイト', 'note.com', 'URLにこの文字を含むフィードは止める。複数は「,」で区切る（2026-11-01 北原さん: noteは取得しない）'],
  ['おすすめフィードの版', 0, '自動で入れた「おすすめフィード」の版。手で変えない']
];

// 1人1冊。このブックが誰のものかを書いておく。
var DEFAULT_PROFILE = [
  ['利用者名', '', 'このブックの持ち主（1人1冊）'],
  ['区分', '個人事業主', '個人事業主 / 会社員 / 学生 など'],
  ['事業・活動内容', '', '例: DX支援、書道教室'],
  ['集めたい情報', '', '例: 生成AIの業務活用、補助金'],
  ['初期データ', '', '登録時に入れた初期データの種類'],
  ['登録日', '', '']
];

var Store = (function () {
  var target_ = null;

  function ss_() {
    return target_ || SpreadsheetApp.getActiveSpreadsheet();
  }

  /** 別のブック（登録で作った利用者のブックなど）を読み書きするときに切り替える。null で元に戻す。 */
  function use(ss) {
    target_ = ss;
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
      } else {
        // あとから足した列の見出しを右端に付け足す（既存の列とデータには触らない）
        var have = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0];
        for (var i = 0; i < headers.length; i++) {
          if (have[i] === '' || have[i] === undefined) sh.getRange(1, i + 1).setValue(headers[i]).setFontWeight('bold');
        }
      }
    });
    var settings = sheet(SHEETS.SETTINGS);
    if (settings.getLastRow() === 1) {
      settings.getRange(2, 1, DEFAULT_SETTINGS.length, 3).setValues(DEFAULT_SETTINGS);
    } else {
      // あとから足した設定を末尾に足す
      var keys = settings.getRange(2, 1, settings.getLastRow() - 1, 1).getValues().map(function (r) { return r[0]; });
      DEFAULT_SETTINGS.forEach(function (d) { if (keys.indexOf(d[0]) === -1) settings.appendRow(d); });
    }
    var profile = sheet(SHEETS.PROFILE);
    if (profile.getLastRow() === 1) {
      profile.getRange(2, 1, DEFAULT_PROFILE.length, 3).setValues(DEFAULT_PROFILE);
    }
  }

  function profile() {
    var out = {};
    rows_(SHEETS.PROFILE).forEach(function (r) { if (r[0]) out[r[0]] = r[1]; });
    return out;
  }

  /** プロフィールの値を書き換える（項目がなければ追加）。 */
  function setProfile(values) {
    var sh = sheet(SHEETS.PROFILE);
    var rows = rows_(SHEETS.PROFILE);
    Object.keys(values).forEach(function (key) {
      var i = rows.map(function (r) { return r[0]; }).indexOf(key);
      if (i === -1) {
        sh.getRange(sh.getLastRow() + 1, 1, 1, 2).setValues([[key, values[key]]]);
        rows.push([key, values[key]]);
      } else {
        sh.getRange(i + 2, 2).setValue(values[key]);
      }
    });
  }

  /** 人ごとのデータ（フィード・記事・興味キーワード・ログ）を見出しだけ残して消す。設定は残す。 */
  function clearPersonalData() {
    [SHEETS.FEEDS, SHEETS.ARTICLES, SHEETS.KEYWORDS, SHEETS.LOG].forEach(function (name) {
      var sh = sheet(name);
      if (sh && sh.getLastRow() > 1) {
        // チェックボックスが残ると空行も「値あり」になるので、入力規則も消す。
        sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearDataValidations().clearContent();
      }
    });
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

  function setSetting(key, value) {
    var sh = sheet(SHEETS.SETTINGS);
    var keys = sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 1).getValues().map(function (r) { return r[0]; });
    var i = keys.indexOf(key);
    if (i === -1) sh.appendRow([key, value, '']); else sh.getRange(i + 2, 2).setValue(value);
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
        weight: Number(r[c['重み']]) || 0,
        status: String(r[c['状態']] || ''),
        intro: String(r[c['紹介']] || '')
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

  /** フィードの紹介文が空なら入れる。 */
  function setFeedIntro(feed, text) {
    if (!text || feed.intro) return;
    var c = index_(SHEETS.FEEDS);
    sheet(SHEETS.FEEDS).getRange(feed.row, c['紹介'] + 1).setValue(text);
    feed.intro = text;
  }

  /** フィードを止める（有効のチェックを外す）。 */
  function disableFeed(feed) {
    var c = index_(SHEETS.FEEDS);
    sheet(SHEETS.FEEDS).getRange(feed.row, c['有効'] + 1).setValue(false);
  }

  /** 発信元の名前 → 紹介文。画面とメールで使う。 */
  function feedIntros() {
    var c = index_(SHEETS.FEEDS);
    var out = {};
    rows_(SHEETS.FEEDS).forEach(function (r) { if (r[c['名前']]) out[r[c['名前']]] = String(r[c['紹介']] || ''); });
    return out;
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
        (a.tags || []).join(', '), a.score, a.aiSummary || '', '', '', '未読', a.image || '',
        (a.words || []).join('・'), a.author || ''];
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
    use: use,
    ensureSchema: ensureSchema,
    profile: profile,
    setProfile: setProfile,
    clearPersonalData: clearPersonalData,
    sheet: sheet,
    settings: settings,
    feeds: feeds,
    markFeed: markFeed,
    setFeedIntro: setFeedIntro,
    setSetting: setSetting,
    disableFeed: disableFeed,
    feedIntros: feedIntros,
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

// ===== Classify.gs =====
/**
 * Classify.gs — 分類と要約。方式を差し替えられるようにしてある。
 *
 * - キーワード分類（常に実行・費用ゼロ）: 興味キーワード シートの語がタイトル/概要に含まれるかで
 *   タグと関連度を決める。旧版 main.py の calculate_relevance_score と同じ「最大の重み」方式。
 * - 要約方式「Sheets AI」: AI要約 列に =AI() の式を書くだけ。生成は人がシート上で押す（使えるかは個人のプランによる）。
 * - 要約方式「Gemini無料API」: 旧版と同じ無料枠の Gemini API を使う。APIキーはスクリプト
 *   プロパティ GEMINI_API_KEY に置く（ファイルにはしない）。課金設定のないキーだけを使うこと。
 */
var Classify = (function () {
  var SUMMARY_PROMPT = 'この記事の要点を3つ、箇条書き（・）で、日本語150文字以内で要約してください。';

  /** キーワードでタグと関連度を付ける。feedWeight はフィードごとの重み（学習結果）。 */
  function byKeywords(article, keywords, feedWeight) {
    var text = (article.title + ' ' + article.summary).toLowerCase();
    var tags = [];
    var hits = [];
    var score = feedWeight || 0;
    keywords.forEach(function (k) {
      if (k.keyword && text.indexOf(k.keyword.toLowerCase()) !== -1) {
        if (tags.indexOf(k.tag) === -1) tags.push(k.tag);
        if (k.weight > score) score = k.weight;
        hits.push(k);
      }
    });
    // 当たった興味ワード（重みの大きい順）。「キーワード（分類）」の形で記事を開く前に見せる
    hits.sort(function (a, b) { return b.weight - a.weight; });
    var words = hits.slice(0, 5).map(function (k) {
      return k.tag && k.tag !== k.keyword ? k.keyword + '（' + k.tag + '）' : k.keyword;
    });
    return { tags: tags.slice(0, 5), score: score, words: words };
  }

  /** 設定された方式で、AI要約が空の記事を埋める。戻り値は処理件数。 */
  function fillSummaries(settings) {
    var mode = settings['要約方式'];
    var limit = Number(settings['1回のAI処理上限']) || 20;
    if (mode === 'Sheets AI') return fillWithSheetsAi_(limit);
    if (mode === 'Gemini無料API') return fillWithGemini_(limit, settings['Geminiモデル']);
    return 0;
  }

  function fillWithSheetsAi_(limit) {
    var targets = Store.articlesWithoutSummary(limit);
    targets.forEach(function (a) {
      // タイトル(E)〜概要(G)を参照させる。式を置くだけで、生成はシート上の操作で行う。
      Store.writeSummary(a.row, '=AI("' + SUMMARY_PROMPT + '", E' + a.row + ':G' + a.row + ')');
    });
    return targets.length;
  }

  function fillWithGemini_(limit, model) {
    var key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
    if (!key) throw new Error('スクリプトプロパティ GEMINI_API_KEY が未設定です');
    var targets = Store.articlesWithoutSummary(limit);
    var done = 0;
    // 1回のリクエストで最大10件まとめて送り、無料枠の回数を節約する。
    for (var i = 0; i < targets.length; i += 10) {
      var batch = targets.slice(i, i + 10);
      var results = geminiBatch_(batch, key, model || 'gemini-2.5-flash-lite');
      batch.forEach(function (a, j) {
        var r = results[j];
        if (!r) return;
        var tags = mergeTags_(a.tags, r.tags);
        Store.writeSummary(a.row, r.summary || '', tags);
        done++;
      });
      if (i + 10 < targets.length) Utilities.sleep(5000);
    }
    return done;
  }

  function geminiBatch_(articles, key, model) {
    var list = articles.map(function (a, i) {
      return '[' + i + '] タイトル: ' + a.title + '\n概要: ' + String(a.summary).slice(0, 500);
    }).join('\n\n');
    var prompt = '次の記事それぞれについて、' + SUMMARY_PROMPT +
      'あわせて内容を表す日本語の短いタグを3つ以内で付けてください。\n' +
      '出力は記事の順番どおりのJSON配列で、各要素は {"summary": "...", "tags": ["..."]} とします。\n\n' + list;
    var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent';
    var res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-goog-api-key': key },
      muteHttpExceptions: true,
      payload: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.2 }
      })
    });
    if (res.getResponseCode() !== 200) {
      throw new Error('Gemini API ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 300));
    }
    var body = JSON.parse(res.getContentText());
    var text = body.candidates && body.candidates[0].content.parts[0].text;
    var parsed = JSON.parse(text || '[]');
    return Array.isArray(parsed) ? parsed : [];
  }

  function mergeTags_(existing, added) {
    var tags = String(existing || '').split(',').map(function (t) { return t.trim(); }).filter(String);
    (added || []).forEach(function (t) { if (tags.indexOf(t) === -1) tags.push(t); });
    return tags.slice(0, 5);
  }

  return {
    byKeywords: byKeywords,
    fillSummaries: fillSummaries
  };
})();

// ===== Main.gs =====
/**
 * Main.gs — メニューと自動実行。旧版の GitHub Actions（6時間ごと／毎朝6時）の置き換え。
 */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('RSS学習ログ')
    .addItem('初期設定（シート作成と初期データ）', 'setup')
    .addItem('利用者を登録（1人1冊を作る）', 'registerUserDialog')
    .addSeparator()
    .addItem('今すぐ取得', 'runFetchNow')
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
  SpreadsheetApp.getActiveSpreadsheet().setSpreadsheetTimeZone('Asia/Tokyo'); // 新しいシートは米国時間のことがある
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
  Store.ensureSchema(); // あとから足した列・設定を足す（既存のデータには触らない）
  var settings = Store.settings();
  var limit = Number(settings['1フィードあたり件数']) || 20;
  var threshold = Number(settings['関連度しきい値']) || 0;
  var skipPaid = String(settings['有料記事を外す'] || 'オン') !== 'オフ';
  var maxErrors = Number(settings['エラーで止める回数']) || 3;
  var keywords = Store.keywords();
  var seen = Store.existingIds();
  var added = [];
  var skipped = 0;
  var paid = 0;
  var errors = [];
  var stopped = [];

  applyFeedPolicy_(settings);
  RssCore.fetchFeeds(Store.feeds(), { limit: limit }).forEach(function (result) {
    var feed = result.feed;
    if (result.error) {
      // 「エラー(2回目): …」の形で回数を数え、続けて maxErrors 回失敗したら止める
      var m = /^エラー\((\d+)回目\)/.exec(feed.status);
      var n = m ? Number(m[1]) + 1 : 1;
      errors.push(feed.name + ': ' + result.error);
      Store.markFeed(feed, 'エラー(' + n + '回目): ' + result.error);
      if (n >= maxErrors) { Store.disableFeed(feed); stopped.push(feed.name); }
      return;
    }
    Store.setFeedIntro(feed, SEED_INTROS[feed.url] || (result.items[0] && result.items[0].sourceAbout) || '');
    var count = 0;
    result.items.forEach(function (item) {
      if (seen[item.id]) return;
      seen[item.id] = true;
      if (skipPaid && item.paid) { paid++; return; }
      var c = Classify.byKeywords(item, keywords, feed.weight);
      if (c.score < threshold) { skipped++; return; }
      item.tags = c.tags;
      item.words = c.words;
      item.score = c.score;
      added.push(item);
      count++;
    });
    Store.markFeed(feed, 'OK（新着' + count + '件）');
  });

  added.sort(function (a, b) { return (a.published || 0) - (b.published || 0); });
  Store.appendArticles(added);
  Store.log('取得', errors.length ? '一部エラー' : 'OK',
    '追加' + added.length + '件 / しきい値で除外' + skipped + '件 / 有料で除外' + paid + '件' +
    (stopped.length ? ' / 続けて失敗したので止めた: ' + stopped.join('、') : '') +
    (errors.length ? ' / ' + errors.join(' | ') : ''));

  if (settings['要約方式'] && settings['要約方式'] !== 'なし') runSummaries();
}

/**
 * フィードの方針を当てる: 取得しないサイトのフィードを止め、まだ入れていない「おすすめフィード」を足す。
 * おすすめは版ごとに1回だけ足す（あとで人が止めたものを、勝手に戻さない）。
 */
function applyFeedPolicy_(settings) {
  var blocked = String(settings['取得しないサイト'] || '').split(',').map(function (x) { return x.trim(); }).filter(String);
  var stopped = [];
  Store.feeds().forEach(function (f) {
    if (blocked.some(function (b) { return String(f.url).indexOf(b) !== -1; })) { Store.disableFeed(f); stopped.push(f.name); }
  });
  var done = Number(settings['おすすめフィードの版']) || 0;
  var added = [];
  if (done < RECOMMENDED_FEEDS_VERSION) {
    var sh = Store.sheet(SHEETS.FEEDS);
    var urls = sh.getLastRow() > 1 ? sh.getRange(2, 3, sh.getLastRow() - 1, 1).getValues().map(function (r) { return String(r[0]); }) : [];
    RECOMMENDED_FEEDS.forEach(function (f) {
      if (f[4] <= done || urls.indexOf(f[1]) !== -1) return;
      sh.appendRow([true, f[0], f[1], f[2], '', '', '', f[3]]);
      sh.getRange(sh.getLastRow(), 1).insertCheckboxes();
      added.push(f[0]);
    });
    Store.setSetting('おすすめフィードの版', RECOMMENDED_FEEDS_VERSION);
  }
  if (stopped.length || added.length) {
    Store.log('フィードの方針', 'OK', (stopped.length ? '止めた: ' + stopped.join('、') : '') +
      (added.length ? (stopped.length ? ' / ' : '') + '足した: ' + added.join('、') : ''));
  }
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
  ScriptApp.newTrigger('runFetchAll').timeBased().everyDays(1).atHour(isNaN(hour) ? 6 : hour).create();
  ScriptApp.newTrigger('runLearnAll').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(5).create();
  Store.log('自動実行', 'オン', '');
}

function removeTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['runFetch', 'runLearn', 'runFetchAll', 'runLearnAll'].indexOf(t.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(t);
  });
}

/**
 * 自動実行の入口（2026-11-01）。管理用ブックで動いたときは、利用者台帳に載っているブックを順に処理する。
 * 自分のブックで動いたときは、そのブックだけを処理する（以前の動き）。
 * こうすると「利用者を登録」のあとに本人がブックを開いて自動実行を入れ直さなくてよい。
 * 開けないブック（持ち主が別の人で共有されていない等）はログに残して飛ばす。
 */
function runFetchAll() { forEachBook_(function () { runFetch(); backfillWords_(); sendMorningMail_(); }, '取得'); }
/** メニューの「今すぐ取得」。メールは送らない。管理用ブックで押すと台帳のブックをまとめて取得する。 */
function runFetchNow() { forEachBook_(function () { runFetch(); backfillWords_(); }, '今すぐ取得'); }

/** 当たった興味ワードが空の記事（列を足す前に取った記事）に、今の興味キーワードで付け直す。 */
function backfillWords_() {
  var sh = Store.sheet(SHEETS.ARTICLES);
  if (!sh || sh.getLastRow() < 2) return;
  var c = {};
  HEADERS.ARTICLES.forEach(function (h, i) { c[h] = i; });
  var n = sh.getLastRow() - 1;
  var values = sh.getRange(2, 1, n, HEADERS.ARTICLES.length).getValues();
  var keywords = Store.keywords();
  var changed = 0;
  var out = values.map(function (r) {
    if (r[c['当たった興味ワード']] !== '' || !r[c['タイトル']]) return [r[c['当たった興味ワード']]];
    changed++;
    var words = Classify.byKeywords({ title: String(r[c['タイトル']]), summary: String(r[c['概要']] || '') }, keywords, 0).words;
    return [words.length ? words.join('・') : 'なし'];
  });
  if (changed) sh.getRange(2, c['当たった興味ワード'] + 1, n, 1).setValues(out);
}
function runLearnAll() { forEachBook_(runLearn, '学習'); }

function forEachBook_(fn, label) {
  var here = SpreadsheetApp.getActiveSpreadsheet();
  var registry = here.getSheetByName(REGISTRY_SHEET);
  if (!registry || registry.getLastRow() < 2) { fn(); return; }
  var idCol = REGISTRY_HEADERS.indexOf('ブックID') + 1;
  var ids = registry.getRange(2, idCol, registry.getLastRow() - 1, 1).getValues()
    .map(function (r) { return String(r[0] || ''); }).filter(String);
  var errors = [];
  ids.forEach(function (id) {
    try {
      Store.use(SpreadsheetApp.openById(id));
      fn();
    } catch (e) {
      errors.push(id + ': ' + e.message);
    } finally {
      Store.use(null);
    }
  });
  Store.log('自動実行（' + label + '）', errors.length ? '一部エラー' : 'OK',
    ids.length + '冊' + (errors.length ? ' / ' + errors.join(' | ') : ''));
}

// ===== Users.gs =====
/**
 * Users.gs — 利用者の登録。1人に1冊のブックを作り、人ごとにRSSソースと興味を分けて管理する。
 *
 * 管理用ブック（テンプレート）で「利用者を登録」を実行すると:
 *   1. このブックをコピーして「RSS学習ログ_<名前>」を作る（コードもいっしょにコピーされる）
 *   2. コピーから人ごとのデータを消し、プロフィールと初期データを入れる
 *   3. 管理用ブックの 利用者台帳 に、名前・区分・ブックのURLだけを書く（記事や興味は書かない）
 *
 * 自動実行のトリガーは本人がそのブックを開いて「自動実行をオンにする」で入れる（本人の権限で動く）。
 * 本人への共有はこの関数では行わない。ブックの共有ボタンから人が行う。
 */
var REGISTRY_SHEET = '利用者台帳';
var REGISTRY_HEADERS = ['利用者名', '区分', '初期データ', 'ブックURL', 'ブックID', '登録日', 'メモ'];

/**
 * 利用者を登録して、作ったブックのURLを返す。
 * @param {{name: string, kind: string, business: string, interests: string, preset: string, note: string}} user
 */
function registerUser(user) {
  if (!user || !user.name) throw new Error('利用者名を入れてください');
  var preset = user.preset || '空';
  if (!SEED_PRESETS[preset]) throw new Error('初期データ「' + preset + '」はありません');

  var admin = SpreadsheetApp.getActiveSpreadsheet();
  var registry = registrySheet_(admin);
  var names = registry.getLastRow() > 1
    ? registry.getRange(2, 1, registry.getLastRow() - 1, 1).getValues().map(function (r) { return r[0]; })
    : [];
  if (names.indexOf(user.name) !== -1) throw new Error(user.name + ' さんは登録済みです');

  var file = DriveApp.getFileById(admin.getId()).makeCopy('RSS学習ログ_' + user.name);
  var book = SpreadsheetApp.openById(file.getId());
  var today = new Date();
  try {
    Store.use(book);
    book.setSpreadsheetTimeZone('Asia/Tokyo');
    var copiedRegistry = book.getSheetByName(REGISTRY_SHEET);
    if (copiedRegistry) book.deleteSheet(copiedRegistry);
    Store.ensureSchema();
    Store.clearPersonalData();
    Store.setProfile({
      '利用者名': user.name,
      '区分': user.kind || '個人事業主',
      '事業・活動内容': user.business || '',
      '集めたい情報': user.interests || '',
      '初期データ': preset,
      '登録日': today
    });
    seedPreset_(preset);
    Store.log('利用者登録', 'OK', user.name + '（' + preset + '）');
  } finally {
    Store.use(null);
  }

  var url = book.getUrl();
  registry.appendRow([user.name, user.kind || '個人事業主', preset, url, file.getId(), today, user.note || '']);
  // 管理用ブックの自動実行がまだなら、ここで入れる（台帳のブックはまとめて毎朝処理される）
  var on = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'runFetchAll'; });
  if (!on) installTriggers();
  return url;
}

function registrySheet_(ss) {
  var sh = ss.getSheetByName(REGISTRY_SHEET);
  if (!sh) {
    sh = ss.insertSheet(REGISTRY_SHEET);
    sh.getRange(1, 1, 1, REGISTRY_HEADERS.length).setValues([REGISTRY_HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

/** メニューから: 名前・区分・初期データを聞いて登録する。 */
function registerUserDialog() {
  var ui = SpreadsheetApp.getUi();
  var ask = function (title, text) {
    var res = ui.prompt(title, text, ui.ButtonSet.OK_CANCEL);
    if (res.getSelectedButton() !== ui.Button.OK) throw new Error('キャンセルしました');
    return res.getResponseText().trim();
  };
  try {
    var name = ask('利用者を登録', '利用者名（例: 克洋）');
    var kind = ask('利用者を登録', '区分（空なら 個人事業主）') || '個人事業主';
    var business = ask('利用者を登録', '事業・活動内容（例: DX支援）');
    var preset = ask('利用者を登録', '初期データ: ' + Object.keys(SEED_PRESETS).join(' / ')) || '空';
    var url = registerUser({ name: name, kind: kind, business: business, preset: preset });
    ui.alert(name + ' さんのブックを作りました。\n' + url +
      '\n\n自動実行もオンにしました（毎朝この管理用ブックが、台帳に載っているブックをまとめて取得します）。共有は共有ボタンから行います。');
  } catch (e) {
    ui.alert(e.message);
  }
}

// ===== YouTubeImport.gs =====
/**
 * YouTubeImport.gs — Google データエクスポート（Takeout）の「登録チャンネル.csv」から
 * YouTube チャンネルのRSSを フィード シートに取り込む。
 *
 * YouTube はチャンネルごとに無料のRSS（新着15本）を出しているので、API もキーも要らない。
 * 取り込んだ行は 有効=オフ で入る。見たいチャンネルだけチェックを入れる。
 */

// チャンネル名からカテゴリを推測する規則。上から順に最初に当たったものを使う。
// カテゴリ名は Drive「Youtube」フォルダの再生リストのジャンル分けに合わせている。
var YOUTUBE_CATEGORY_RULES = [
  ['AI・DX', ['AI', 'OpenAI', 'DX', 'デジタル庁', 'SENSORS', 'データソリューション', 'アイデミー', 'Unreal']],
  ['専門スキル01_デジタル全般', ['プログラミング', 'Programming', 'Progate', 'エンジニア', 'パソコン', 'エクセル', 'ユースフル', 'キノコード', 'IT', 'Windows', 'Hack']],
  ['専門スキル03_税金', ['税', '国税', '財務省', '相続', '補助金', '行政書士', '資格']],
  ['経済・ビジネス', ['経済', 'ビジネス', 'BIZ', 'NewsPicks', 'PIVOT', 'リハック', 'ReHacQ', 'ワールドビジネス', 'GLOBIS', '事業', 'リベラルアーツ', 'サラタメ', 'ホリエモン', '堀江', '中島聡', '落合陽一', 'プレゼン']],
  ['専門スキル02_年収up', ['仮想通貨', 'クリプト', 'Crypto', 'ビットコイン', 'Web3', 'WEB3', 'FIRE', 'エアドロ', 'Airdrop', '億り人', 'トレード']],
  ['政治・社会', ['党', '政治', 'ニュース', '新聞', '高市', '橋下', '石丸', '立花', '安野', '上念', '髙橋洋一', '高橋洋一', '池上', '虎ノ門', '経済産業省', '農林水産省', 'くらら', '文化人']],
  ['勉強スキル', ['授業', '大学', '学長', 'スタディ', '教養', '学び', '数学', 'Stardy', '知識', 'Historia']],
  ['運動系01_バド', ['バドミントン', 'Badminton', 'badminton', 'Shuttle', 'Yonex', '桃', 'Cầu Lông']],
  ['運動系02_ゴルフ', ['ゴルフ', 'Golf']],
  ['運動系03_その他', ['筋トレ', 'Muscle', 'ビリヤード', 'DARTS', 'Baseball', '武井壮']],
  ['趣味嗜好', ['麻雀', 'Mリーグ', 'M.LEAGUE', 'パチ', 'スロ', 'ポーカー', 'マジック', 'マジシャン', 'ゲーム', 'Gaming', 'パズドラ', '漫画', 'オタク', 'Game']],
  ['生活習慣改善', ['料理', '飯', 'Cooking', '節約', 'DIY', 'ライフハック', 'ウェザー', 'ペット']],
  ['書道・文化', ['書道', '文学']]
];

var RssYouTube = (function () {
  function feedUrl(channelId) {
    return 'https://www.youtube.com/feeds/videos.xml?channel_id=' + channelId;
  }

  /** Takeout の CSV（チャンネル ID, チャンネルの URL, チャンネルのタイトル）を読む。 */
  function parseSubscriptions(csvText) {
    var rows = Utilities.parseCsv(String(csvText).replace(/^﻿/, ''));
    return rows.slice(1).filter(function (r) {
      return /^UC[\w-]{22}$/.test(String(r[0]).trim());
    }).map(function (r) {
      return { channelId: String(r[0]).trim(), title: String(r[2] || '').trim() };
    });
  }

  function guessCategory(title) {
    for (var i = 0; i < YOUTUBE_CATEGORY_RULES.length; i++) {
      var rule = YOUTUBE_CATEGORY_RULES[i];
      for (var j = 0; j < rule[1].length; j++) {
        if (title.indexOf(rule[1][j]) !== -1) return rule[0];
      }
    }
    return '未分類';
  }

  return { feedUrl: feedUrl, parseSubscriptions: parseSubscriptions, guessCategory: guessCategory };
})();

/** フィード シートに追加する。既にあるURLは飛ばす。戻り値は追加件数。 */
function importYoutubeSubscriptionsFromCsv(csvText) {
  Store.ensureSchema();
  var sh = Store.sheet(SHEETS.FEEDS);
  var existing = {};
  if (sh.getLastRow() > 1) {
    sh.getRange(2, 3, sh.getLastRow() - 1, 1).getValues().forEach(function (r) { existing[r[0]] = true; });
  }
  var rows = RssYouTube.parseSubscriptions(csvText).filter(function (c) {
    return !existing[RssYouTube.feedUrl(c.channelId)];
  }).map(function (c) {
    return [false, c.title, RssYouTube.feedUrl(c.channelId), RssYouTube.guessCategory(c.title),
      '', '', 'YouTube登録チャンネルから取り込み'];
  });
  if (rows.length) {
    var start = sh.getLastRow() + 1;
    sh.getRange(start, 1, rows.length, rows[0].length).setValues(rows);
    sh.getRange(start, 1, rows.length, 1).insertCheckboxes();
  }
  Store.log('YouTube取り込み', 'OK', rows.length + '件追加');
  return rows.length;
}

/** メニューから: Drive 上の 登録チャンネル.csv のURLかIDを聞いて取り込む。 */
function importYoutubeSubscriptions() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt('YouTube登録チャンネルの取り込み',
    'Google データエクスポートの「登録チャンネル.csv」のドライブURL（またはファイルID）を貼ってください。',
    ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var m = /[-\w]{25,}/.exec(res.getResponseText());
  if (!m) { ui.alert('ファイルIDが見つかりませんでした'); return; }
  var csv = DriveApp.getFileById(m[0]).getBlob().getDataAsString('UTF-8');
  var n = importYoutubeSubscriptionsFromCsv(csv);
  ui.alert(n + '件のチャンネルを フィード シートに追加しました（有効はオフ）。見たいものにチェックを入れてください。');
}

// ===== Seed.gs =====
/**
 * Seed.gs — 利用者ごとの初期データ。登録時（または初期設定でシートが空のとき）だけ書き込む。
 * 以後は各自のブックのシートを直接編集する。
 *
 * SEED_FEEDS / SEED_KEYWORDS は克洋さんの旧版（src/config.py の RSS_FEEDS と user_profile.json の重み3以上のタグ）。
 */
// 発信元の紹介（フィードの 紹介 列が空のときに入れる）。載っていないフィードは、サイトが自分で書いている紹介文を使う。
var SEED_INTROS = {
  'https://horiemon.com/feed/': '堀江貴文さんの公式サイト。起業・宇宙ビジネス・時事への意見',
  'https://note.com/ochyai/rss': '落合陽一さん（メディアアーティスト、筑波大学）。デジタルネイチャー、AIと社会',
  'https://satoshi.blogs.com/life/atom.xml': '中島聡さん（元マイクロソフトのエンジニア）。技術と経営の見立て',
  'https://note.com/takahiroanno/rss': '安野たかひろさん（AIエンジニア・起業家）。デジタル民主主義、AIの社会実装',
  'https://kensuu.com/feed': 'けんすう（古川健介）さん（起業家）。ネットサービスとコミュニティの考察',
  'https://note.com/yoichi_takahashi/rss': '高橋洋一さん（経済学者、元財務官僚）。財政・金融政策の解説',
  'https://note.com/yosukeyasuda/rss': '安田洋祐さん（経済学者、大阪大学）。ゲーム理論・マーケットデザイン',
  'https://diamond.jp/rss/feed/atom/top.xml': '週刊ダイヤモンド（ダイヤモンド社）。経済・企業・キャリアのニュース',
  'http://blog.livedoor.jp/kazu_fujisawa/index.rdf': '藤沢数希さん（作家、元外資系金融）。金融・経済・社会評論',
  'https://business.nikkei.com/rss/nb/index.xml': '日経ビジネス（日経BP）。経営・企業動向のニュース',
  'https://www.chusho.meti.go.jp/rss/index.xml': '中小企業庁（経済産業省）。補助金・支援策・公募のお知らせ',
  'https://note.com/fladdict/rss': '深津貴之さん（UIデザイナー、THE GUILD）。生成AIの使い方とデザイン',
  'https://note.com/kazobara/rss': '尾原和啓さん（IT批評家、元マッキンゼー・Google等）。テクノロジーとビジネスの潮流',
  'https://jp.techcrunch.com/feed/': 'TechCrunch Japan。スタートアップとテックのニュース',
  'https://wired.jp/feed/': 'WIRED.jp（コンデナスト）。テクノロジーと未来の社会',
  'https://www.publickey1.jp/atom.xml': 'Publickey（新野淳一さん）。クラウド・開発者向けITニュース',
  'https://www.lifehacker.jp/feed/atom.xml': 'ライフハッカー・ジャパン。仕事術・ツール・生活の工夫',
  'https://rashita.net/blog/feed/': '倉下忠憲さん（文筆家）。知的生産・タスク管理・ノート術',
  'https://note.com/masashichi/rss': '中川政七商店（奈良の老舗、工芸×小売）。伝統産業の経営と商品づくり',
  'https://natalie.mu/comic/feed': 'コミックナタリー（ナターシャ）。漫画の新刊・イベントのニュース',
  'https://realsound.jp/book/feed': 'Real Sound ブック。本・漫画の批評とインタビュー'
};

// おすすめフィード（信頼できる発信元だけ。PCで取得できることを確かめたもの）。[名前, URL, カテゴリ, 紹介, 版]
var RECOMMENDED_FEEDS_VERSION = 1;
var RECOMMENDED_FEEDS = [
  ['ITmedia AI+', 'https://rss.itmedia.co.jp/rss/2.0/aiplus.xml', 'AI・テクノロジー', 'ITmedia（アイティメディア）の生成AI専門ニュース', 1],
  ['ITmedia ビジネスオンライン', 'https://rss.itmedia.co.jp/rss/2.0/business.xml', '経済・政治', 'ITmediaのビジネス・企業ニュース', 1],
  ['ITmedia エンタープライズ', 'https://rss.itmedia.co.jp/rss/2.0/enterprise.xml', 'AI・テクノロジー', 'ITmediaの企業IT・DX・業務システムのニュース', 1],
  ['＠IT', 'https://rss.itmedia.co.jp/rss/2.0/ait.xml', 'AI・テクノロジー', 'ITmediaのエンジニア向け技術解説', 1],
  ['INTERNET Watch', 'https://internet.watch.impress.co.jp/data/rss/1.0/iw/feed.rdf', 'AI・テクノロジー', 'インプレスのネット・セキュリティのニュース', 1],
  ['日経クロステック', 'https://xtech.nikkei.com/rss/index.rdf', 'AI・テクノロジー', '日経BPの技術・ITの専門ニュース', 1],
  ['Google Workspace Updates', 'https://workspaceupdates.googleblog.com/feeds/posts/default', '業務効率化・ライフハック', 'Google公式。Workspaceの新機能・変更のお知らせ（英語）', 1],
  ['Google Japan Blog', 'https://blog.google/intl/ja-jp/rss/', 'AI・テクノロジー', 'Google日本法人の公式ブログ', 1],
  ['OpenAI News', 'https://openai.com/news/rss.xml', 'AI・テクノロジー', 'OpenAI公式のお知らせ（英語）', 1],
  ['経済産業省 ニュースリリース', 'https://www.meti.go.jp/ml_index_release_atom.xml', '経済・政治', '経済産業省の公式発表。補助金・制度・公募', 1],
  ['東洋経済オンライン', 'https://toyokeizai.net/list/feed/rss', '経済・政治', '東洋経済新報社の経済・企業・社会の記事', 1],
  ['Business Insider Japan', 'https://www.businessinsider.jp/feed/index.xml', '経済・政治', 'ビジネス・テクノロジー・キャリアのニュース', 1]
];

var SEED_FEEDS = [
  ["リハック", "https://www.youtube.com/feeds/videos.xml?channel_id=UCG_oqDSlIYEspNpd2H4zWhw", "お気に入りとリハック"],
  ["Horiemon.com", "https://horiemon.com/feed/", "お気に入りとリハック"],
  ["落合陽一", "https://note.com/ochyai/rss", "お気に入りとリハック"],
  ["中島聡", "https://satoshi.blogs.com/life/atom.xml", "お気に入りとリハック"],
  ["安野たかひろ", "https://note.com/takahiroanno/rss", "お気に入りとリハック"],
  ["けんすう", "https://kensuu.com/feed", "お気に入りとリハック"],
  ["高橋洋一", "https://note.com/yoichi_takahashi/rss", "経済・政治"],
  ["安田洋祐", "https://note.com/yosukeyasuda/rss", "経済・政治"],
  ["週刊ダイヤモンド", "https://diamond.jp/rss/feed/atom/top.xml", "経済・政治"],
  ["藤沢数希", "http://blog.livedoor.jp/kazu_fujisawa/index.rdf", "経済・政治"],
  ["日経ビジネス", "https://business.nikkei.com/rss/nb/index.xml", "経済・政治"],
  ["中小企業庁", "https://www.chusho.meti.go.jp/rss/index.xml", "経済・政治"],
  ["深津貴之", "https://note.com/fladdict/rss", "AI・テクノロジー"],
  ["尾原和啓", "https://note.com/kazobara/rss", "AI・テクノロジー"],
  ["TechCrunch Japan", "https://jp.techcrunch.com/feed/", "AI・テクノロジー"],
  ["WIRED.jp", "https://wired.jp/feed/", "AI・テクノロジー"],
  ["Publickey", "https://www.publickey1.jp/atom.xml", "AI・テクノロジー"],
  ["Lifehacker Japan", "https://www.lifehacker.jp/feed/atom.xml", "業務効率化・ライフハック"],
  ["倉下忠憲", "https://rashita.net/blog/feed/", "業務効率化・ライフハック"],
  ["中川政七商店", "https://note.com/masashichi/rss", "伝統文化 × ビジネス"],
  ["コミックナタリー", "https://natalie.mu/comic/feed", "漫画・エンタメ産業"],
  ["Real Sound [ブック]", "https://realsound.jp/book/feed", "漫画・エンタメ産業"]
];

var SEED_KEYWORDS = [
  ["ソフトウェア開発", 6.0],
  ["Renovate", 6.0],
  ["依存関係管理", 6.0],
  ["ライブラリ更新", 6.0],
  ["DevOps", 6.0],
  ["ChatGPT", 6.0],
  ["言語モデル", 6.0],
  ["テクノロジー", 6.0],
  ["情報技術", 6.0],
  ["プロンプトエンジニアリング", 6.0],
  ["大規模言語モデル", 6.0],
  ["まじん式", 6.0],
  ["生成AI", 5.5],
  ["タスク管理", 5.2],
  ["デジタルツール", 5.2],
  ["ライフハック", 5.2],
  ["Notion", 5.07],
  ["セキュリティ", 5.0],
  ["ディープフェイク", 5.0],
  ["音声認識", 5.0],
  ["詐欺", 5.0],
  ["DevSecOps", 5.0],
  ["コンテナ", 5.0],
  ["クラウドセキュリティ", 5.0],
  ["セキュリティ対策", 5.0],
  ["音声合成", 5.0],
  ["検証実験", 5.0],
  ["技術", 5.0],
  ["スマートフォン", 5.0],
  ["仕事効率化", 5.0],
  ["アプリ連携", 5.0],
  ["Pixel", 5.0],
  ["Google", 5.0],
  ["WhatsApp", 5.0],
  ["衛星通信", 5.0],
  ["提携", 5.0],
  ["開発ツール", 5.0],
  ["サーバー", 5.0],
  ["Claude", 5.0],
  ["ツール", 5.0],
  ["開発", 5.0],
  ["クラウド", 5.0],
  ["動画解析", 5.0],
  ["API", 5.0],
  ["職業", 5.0],
  ["キャリア", 5.0],
  ["副業", 5.0],
  ["DX", 5.0],
  ["大企業事例", 5.0],
  ["動画編集", 5.0],
  ["機械学習", 5.0],
  ["自然言語処理", 5.0],
  ["オープンソース", 5.0],
  ["雑記", 5.0],
  ["Gmail", 5.0],
  ["メール管理", 5.0],
  ["経営戦略", 5.0],
  ["データ活用", 5.0],
  ["デジタル変革", 5.0],
  ["経営", 5.0],
  ["経営効率化", 5.0],
  ["情報共有", 5.0],
  ["大阪ガス", 5.0],
  ["Gemini", 5.0],
  ["無料ツール", 5.0],
  ["GitHub", 5.0],
  ["Copilot", 5.0],
  ["DeepMind", 5.0],
  ["サーバー構築", 5.0],
  ["ハードウェア", 5.0],
  ["生産性向上", 4.85],
  ["AI", 4.73],
  ["プログラミング", 4.62],
  ["自動化", 4.6],
  ["IT", 4.6],
  ["Chrome拡張機能", 4.6],
  ["チャットボット", 4.6],
  ["npaka", 4.6],
  ["業務効率化", 4.53],
  ["SF", 4.4],
  ["回顧録", 4.4],
  ["創作", 4.4],
  ["画像生成", 4.4],
  ["Business", 4.25],
  ["Tech", 4.0],
  ["参加型民主主義", 4.0],
  ["政治運動", 4.0],
  ["組織運営", 4.0],
  ["ドキュメンテーション", 4.0],
  ["GitLab", 4.0],
  ["ナレッジマネジメント", 4.0],
  ["量子コンピューティング", 3.8],
  ["物理学", 3.8],
  ["科学技術", 3.8],
  ["ブレークスルー", 3.8],
  ["計算機科学", 3.8],
  ["Programming", 3.73],
  ["政治参加", 3.6],
  ["ネット選挙", 3.6],
  ["年間総括", 3.6],
  ["2022年", 3.6],
  ["プライベート", 3.6],
  ["日記", 3.6],
  ["仮想通貨", 3.6],
  ["ステーブルコイン", 3.6],
  ["金融", 3.6],
  ["JPYC", 3.6],
  ["経済", 3.6],
  ["エンジニア", 3.27]
];


/** 登録時に選べる初期データ。名前はプロフィールの「初期データ」に残る。 */
var SEED_PRESETS = {
  '空': { feeds: [], keywords: [], origin: '' },
  '克洋（旧版の興味）': { feeds: SEED_FEEDS, keywords: SEED_KEYWORDS, origin: '旧版プロファイル' }
};


// ===== Mobile.gs =====
/**
 * Mobile.gs — スマホで記事を読み、指で評価する画面（ウェブアプリ）と、朝のメール（2026-11-01）。
 *
 * ウェブアプリは管理用ブックのスクリプトを「自分だけ」に公開して使う。利用者台帳の1人目（または ?u=名前）の
 * ブックを読み書きする。評価は記事シートの 興味度・重要度・ステータス に入り、月曜の学習に使われる。
 * 朝のメールは毎朝の取得のあと、関連度の高い未読を最大10件、ブックの持ち主（実行しているアカウント）に送る。
 * 設定シートに「朝のメール」= オフ と書けば送らない。
 */
var MOBILE_LIMIT = 40;

function doGet(e) {
  var t = HtmlService.createTemplateFromFile('Mobile');
  t.user = (e && e.parameter && e.parameter.u) || '';
  return t.evaluate()
    .setTitle('RSS学習ログ')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

/** 利用者台帳から読むブックを決める。台帳がなければ、このブック自身。 */
function mobileBook_(user) {
  var here = SpreadsheetApp.getActiveSpreadsheet();
  var registry = here.getSheetByName(REGISTRY_SHEET);
  if (!registry || registry.getLastRow() < 2) return here;
  var rows = registry.getRange(2, 1, registry.getLastRow() - 1, REGISTRY_HEADERS.length).getValues();
  var nameCol = REGISTRY_HEADERS.indexOf('利用者名');
  var idCol = REGISTRY_HEADERS.indexOf('ブックID');
  var row = rows.filter(function (r) { return user && r[nameCol] === user; })[0] || rows[0];
  return SpreadsheetApp.openById(String(row[idCol]));
}

function articleCols_() {
  var c = {};
  HEADERS.ARTICLES.forEach(function (h, i) { c[h] = i; });
  return c;
}

/** 画面用の記事一覧。view: new（未読を関連度順）/ later（あとで読む）/ rated（最近評価したもの） */
function apiArticles(user, view) {
  var book = mobileBook_(user);
  var sh = book.getSheetByName(SHEETS.ARTICLES);
  var name = '';
  var intros = {};
  try { Store.use(book); name = Store.profile()['利用者名'] || ''; intros = Store.feedIntros(); } finally { Store.use(null); }
  if (!sh || sh.getLastRow() < 2) return { name: name, items: [], counts: { new: 0, later: 0 } };
  var c = articleCols_();
  var values = sh.getRange(2, 1, sh.getLastRow() - 1, HEADERS.ARTICLES.length).getValues();
  var all = values.map(function (r, i) {
    var pub = r[c['公開日時']] instanceof Date ? r[c['公開日時']] : (r[c['取得日時']] instanceof Date ? r[c['取得日時']] : null);
    return {
      row: i + 2, id: String(r[c['ID']]), title: String(r[c['タイトル']] || ''), source: String(r[c['ソース']] || ''),
      link: String(r[c['URL']] || ''), summary: String(r[c['AI要約']] || r[c['概要']] || '').slice(0, 220),
      tags: String(r[c['タグ']] || ''), score: Number(r[c['関連度']]) || 0, published: pub ? pub.getTime() : 0,
      interest: r[c['興味度']] === '' ? 0 : Number(r[c['興味度']]) || 0,
      importance: r[c['重要度']] === '' ? 0 : Number(r[c['重要度']]) || 0,
      status: String(r[c['ステータス']] || '未読'), image: String(r[c['画像']] || ''),
      words: String(r[c['当たった興味ワード']] || ''), author: String(r[c['書き手']] || ''),
      about: intros[String(r[c['ソース']] || '')] || ''
    };
  });
  var isNew = function (a) { return a.status === '未読' || a.status === ''; };
  var items;
  if (view === 'later') {
    items = all.filter(function (a) { return a.status === 'あとで読む'; }).sort(function (a, b) { return b.published - a.published; });
  } else if (view === 'rated') {
    items = all.filter(function (a) { return a.interest || a.importance; }).reverse();
  } else {
    items = all.filter(isNew).sort(function (a, b) { return (b.score - a.score) || (b.published - a.published); });
  }
  return {
    name: name,
    items: items.slice(0, MOBILE_LIMIT),
    counts: { new: all.filter(isNew).length, later: all.filter(function (a) { return a.status === 'あとで読む'; }).length }
  };
}

/** 評価を書き込む。行がずれていないか ID で確かめる。field: 興味度 / 重要度 / ステータス */
function apiRate(user, row, id, field, value) {
  if (['興味度', '重要度', 'ステータス'].indexOf(field) === -1) throw new Error('書き換えられない列です');
  if (field === 'ステータス' && ['未読', 'あとで読む', '完了'].indexOf(value) === -1) throw new Error('ステータスの値が違います');
  if (field !== 'ステータス' && !(value === '' || (Number(value) >= 1 && Number(value) <= 5))) throw new Error('1〜5で付けてください');
  var book = mobileBook_(user);
  var sh = book.getSheetByName(SHEETS.ARTICLES);
  var c = articleCols_();
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (String(sh.getRange(row, c['ID'] + 1).getValue()) !== String(id)) throw new Error('記事の位置が変わりました。開き直してください');
    sh.getRange(row, c[field] + 1).setValue(field === 'ステータス' ? value : (value === '' ? '' : Number(value)));
  } finally {
    lock.releaseLock();
  }
  return true;
}

/** 毎朝の取得のあとに呼ぶ。関連度の高い未読を最大10件メールで送る（Store.use で切り替えたブックが対象）。 */
function sendMorningMail_() {
  var settings = Store.settings();
  if (String(settings['朝のメール'] || '') === 'オフ') return;
  var sh = Store.sheet(SHEETS.ARTICLES);
  if (!sh || sh.getLastRow() < 2) return;
  var c = articleCols_();
  var since = Date.now() - 2 * 24 * 3600 * 1000;
  var top = sh.getRange(2, 1, sh.getLastRow() - 1, HEADERS.ARTICLES.length).getValues()
    .filter(function (r) {
      var got = r[c['取得日時']];
      return (r[c['ステータス']] === '未読' || r[c['ステータス']] === '') && got instanceof Date && got.getTime() >= since;
    })
    .sort(function (a, b) { return (Number(b[c['関連度']]) || 0) - (Number(a[c['関連度']]) || 0); })
    .slice(0, 10);
  if (!top.length) return;
  var to = Session.getEffectiveUser().getEmail();
  if (!to) return;
  var url = '';
  try { url = ScriptApp.getService().getUrl() || ''; } catch (e) { url = ''; }
  var name = Store.profile()['利用者名'] || '';
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]; }); };
  var html = ['<div style="font-family:sans-serif;line-height:1.6">',
    '<p>' + esc(name) + ' さん、今朝の注目記事です（関連度の高い順）。</p><ol>'];
  var text = [name + ' さん、今朝の注目記事です（関連度の高い順）。', ''];
  top.forEach(function (r) {
    html.push('<li style="margin-bottom:10px"><a href="' + esc(r[c['URL']]) + '">' + esc(r[c['タイトル']]) + '</a><br>' +
      '<span style="color:#666;font-size:12px">' + esc(r[c['ソース']]) + '・' + esc(r[c['当たった興味ワード']] || r[c['タグ']] || '興味ワードなし') + '</span></li>');
    text.push('・' + r[c['タイトル']] + '\n  ' + r[c['URL']]);
  });
  html.push('</ol>');
  if (url) {
    html.push('<p><a href="' + esc(url) + '">スマホの画面で読んで評価する</a></p>');
    text.push('', 'スマホの画面: ' + url);
  }
  html.push('</div>');
  MailApp.sendEmail({ to: to, subject: 'RSS学習ログ 今朝の' + top.length + '件', body: text.join('\n'), htmlBody: html.join('') });
}
