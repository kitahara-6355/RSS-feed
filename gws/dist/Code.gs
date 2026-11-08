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
  AUTHORS: '著者',
  VIEWS: '視聴履歴',
  SETTINGS: '設定',
  LOG: 'ログ'
};

var HEADERS = {
  PROFILE: ['項目', '値', '説明'],
  FEEDS: ['有効', '名前', 'URL', 'カテゴリ', '重み', '最終取得', '状態', '紹介'],
  ARTICLES: ['ID', '取得日時', '公開日時', 'ソース', 'タイトル', 'URL', '概要', 'タグ', '関連度',
    'AI要約', '興味度', '重要度', 'ステータス', '画像', '当たった興味ワード', '書き手', '評価日時', '追加元', '原題', '鍵'],
  KEYWORDS: ['キーワード', '重み', '分類', '由来'],
  AUTHORS: ['名前', '別名', '見方（手書き）', 'フラグ 記事', 'フラグ まとめ経由', 'フラグ YouTube', 'フラグ X', '提案を保留',
    '見方（自動）', '記事', 'まとめ経由', 'YouTube', 'X', '刺さるテーマ', '刺さらないテーマ', '最終判定', '更新'],
  VIEWS: ['チャンネル', 'チャンネルID', '年月', '本数', '最後に見た日', '最近の動画'],
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
  ['読んだ視聴履歴', '', '取り込み済みのテイクアウトのファイルID（自動で入る。空にすると次の朝に読み直す）'],
  ['取得しないサイト', 'note.com', 'URLにこの文字を含むフィードは止める。複数は「,」で区切る（2026-11-01 北原さん: noteは取得しない）'],
  ['おすすめフィードの版', 0, '自動で入れた「おすすめフィード」の版。手で変えない'],
  ['日本語に訳す', 'オン', 'オン / オフ。英語などの記事の見出しと概要を日本語に訳して保存する（元の見出しは「原題」列）。Apps Script の翻訳を使う（無料）'],
  ['ショート動画を外す', 'オン', 'オン / オフ。YouTube のショート動画を保存しない・新着に出さない（2026-11-08 北原さん）'],
  ['会員限定とみなすサイト', 'nikkei.com', 'このサイトの記事は会員登録しないと中身が読めないとみなし、🔒を付けて新着とメールの下へ回す（消さない）。複数は「,」で区切る（2026-11-08 北原さん）']
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
        (a.words || []).join('・'), a.author || '', '', '', a.original || ''];
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
    // 「注目の人」「注目の媒体」は書き手・発信元の名前にも当てる（スマホでURLを貼ったときに入る）
    var who = (text + ' ' + (article.author || '') + ' ' + (article.source || '')).toLowerCase();
    var tags = [];
    var hits = [];
    var score = feedWeight || 0;
    keywords.forEach(function (k) {
      var target = /^注目の/.test(k.tag) ? who : text;
      if (k.keyword && target.indexOf(k.keyword.toLowerCase()) !== -1) {
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
  var skipShorts = String(settings['ショート動画を外す'] || 'オン') !== 'オフ';
  var translate = String(settings['日本語に訳す'] || 'オン') !== 'オフ';
  var shorts = 0, translated = 0;
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
      if (skipShorts && isShort_(item.link, item.title)) { shorts++; return; }
      // 英語などは先に日本語にする（興味キーワードも日本語の見出しに当たるようになる）
      if (translate && translated < TRANSLATE_PER_RUN && needsJa_(item.title)) {
        var ja = toJa_(item.title);
        if (ja) { item.original = item.title; item.title = ja; item.summary = toJa_(item.summary) || item.summary; translated++; }
      }
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
    '追加' + added.length + '件 / しきい値で除外' + skipped + '件 / 有料で除外' + paid + '件 / ショート動画で除外' + shorts + '件 / 日本語に訳した' + translated + '件' +
    (stopped.length ? ' / 続けて失敗したので止めた: ' + stopped.join('、') : '') +
    (errors.length ? ' / ' + errors.join(' | ') : ''));

  if (settings['要約方式'] && settings['要約方式'] !== 'なし') runSummaries();
  try { rebuildAuthors_(); } catch (e) { Store.log('著者', 'エラー', e.message); }
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
    a.tags.forEach(function (t) { if (!/^注目の/.test(t)) add_(tagTotals, t, score); });  // 注目の人・媒体は手で足した重みのまま
    add_(sourceTotals, a.source, score);
  });
  Store.saveLearned(average_(tagTotals), average_(sourceTotals));
  Store.log('学習', 'OK', 'タグ' + Object.keys(tagTotals).length + '件 / ソース' + Object.keys(sourceTotals).length + '件');
  try { rebuildAuthors_(); } catch (e) { Store.log('著者', 'エラー', e.message); }
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
function runFetchAll() { forEachBook_(function () { runFetch(); backfillWords_(); translateBackfill_(TRANSLATE_PER_RUN); importViewsSafe_(); sendMorningMail_(); }, '取得'); }

// ===== 日本語訳とショート動画（2026-11-08 北原さん） =====
var TRANSLATE_PER_RUN = 150;
/** 仮名・漢字が1字もなく、英字などがある見出しは訳す。 */
function needsJa_(s) {
  s = String(s || '');
  return /[A-Za-z\u00C0-\u024F]{3,}/.test(s) && !/[\u3040-\u30FF\u4E00-\u9FFF]/.test(s);
}
function toJa_(s) {
  s = String(s || '').trim();
  if (!s) return '';
  try { return LanguageApp.translate(s.slice(0, 1500), '', 'ja'); } catch (e) { return ''; }
}
/** YouTube のショート動画か。フィードではショートの URL が /shorts/ になる。 */
function isShort_(link, title) {
  return /youtube\.com\/shorts\//.test(String(link || '')) || /#shorts?\b/i.test(String(title || ''));
}
/**
 * まだ訳していない未読・あとで読むの記事を訳す（列を足す前に取った記事用）。
 * 見出しと概要を日本語にして、元の見出しを「原題」に残す。timeLimitMs を過ぎたらやめる。
 */
function translateBackfill_(max, timeLimitMs, book) {
  var sh = book ? book.getSheetByName(SHEETS.ARTICLES) : Store.sheet(SHEETS.ARTICLES);
  if (!sh || sh.getLastRow() < 2) return 0;
  if (!book && String(Store.settings()['日本語に訳す'] || 'オン') === 'オフ') return 0;
  var c = articleCols_();
  if (!sh.getRange(1, c['原題'] + 1).getValue()) sh.getRange(1, c['原題'] + 1).setValue('原題').setFontWeight('bold');
  var start = Date.now(), done = 0;
  var values = sh.getRange(2, 1, sh.getLastRow() - 1, HEADERS.ARTICLES.length).getValues();
  for (var i = values.length - 1; i >= 0 && done < max; i--) {
    if (timeLimitMs && Date.now() - start > timeLimitMs) break;
    var r = values[i], st = String(r[c['ステータス']] || '未読');
    if (st !== '未読' && st !== 'あとで読む') continue;
    if (r[c['原題']] || !needsJa_(r[c['タイトル']])) continue;
    var ja = toJa_(r[c['タイトル']]); if (!ja) continue;
    var sum = toJa_(r[c['概要']]) || r[c['概要']];
    sh.getRange(i + 2, c['タイトル'] + 1).setValue(ja);
    sh.getRange(i + 2, c['概要'] + 1).setValue(sum);
    sh.getRange(i + 2, c['原題'] + 1).setValue(r[c['タイトル']]);
    done++;
  }
  return done;
}
function importViewsSafe_() {
  try { importWatchHistory_(false); rebuildAuthors_(); } catch (e) { Store.log('視聴履歴', 'エラー', e.message); }
}
/** メニューや手動で読み直すとき。 */
function runImportWatchHistory() { forEachBook_(function () { Store.ensureSchema(); importWatchHistory_(true); rebuildAuthors_(); }, '視聴履歴'); }
/** メニューの「今すぐ取得」。メールは送らない。管理用ブックで押すと台帳のブックをまとめて取得する。 */
function runFetchNow() { forEachBook_(function () { runFetch(); backfillWords_(); translateBackfill_(TRANSLATE_PER_RUN); importViewsSafe_(); }, '今すぐ取得'); }

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
/** 記事のステータス。興味なし はスマホの左スワイプ（興味度1も入り、月曜の学習で重みが下がる）。 */
var STATUSES = ['未読', 'あとで読む', '完了', '興味なし'];

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
  var name = '';
  var intros = {};
  var st = {};
  try { Store.use(book); name = Store.profile()['利用者名'] || ''; intros = Store.feedIntros(); st = Store.settings(); } finally { Store.use(null); }
  // 開いたときに、まだ訳していない未読があれば少しだけ訳す（待たせないよう2秒まで。残りは朝の取得で）
  if (String(st['日本語に訳す'] || 'オン') !== 'オフ') {
    try { if (translateBackfill_(20, 2000, book)) SpreadsheetApp.flush(); } catch (e) {}
  }
  var hideShorts = String(st['ショート動画を外す'] || 'オン') !== 'オフ';
  var all = readArticles_(book).filter(function (a) { return !(hideShorts && a.short); });
  if (!all.length) return { name: name, items: [], counts: { new: 0, later: 0 } };
  var people = authorStats_(all, readAuthorSheet_(book), readViews_(book));
  applyLocks_(all, st);
  all.forEach(function (a) { a.about = intros[a.source] || ''; });
  var rep = reputation_(all);
  var isNew = function (a) { return a.status === '未読' || a.status === ''; };
  var items, suggest = null;
  if (view === 'later') {
    items = all.filter(function (a) { return a.status === 'あとで読む'; }).sort(function (a, b) { return b.published - a.published; });
  } else if (view === 'rated') {
    items = all.filter(function (a) { return a.interest || a.importance; }).reverse();
  } else {
    all.forEach(function (a) { a.stale = isStale_(a.kind, a.published); });
    items = applyAuthorFlags_(all.filter(isNew), people).sort(function (a, b) {
      // 🔒（会員限定・読めない）は消さずに、読める記事の下へ回す
      return (a.stale - b.stale) || ((b.flag === '注目') - (a.flag === '注目')) || (a.locked - b.locked) || (b.score - a.score) || (b.published - a.published);
    });
    suggest = suggestion_(people);
  }
  var newCount = view === 'new' || !view ? items.length : applyAuthorFlags_(all.filter(isNew), people).length;
  items = items.slice(0, MOBILE_LIMIT);
  items.forEach(function (a) {
    a.src = rep['媒体:' + a.source] || null;
    var p = a.person && people[a.person];
    var s = p && p.ch[a.ch];
    // 人のバッジは「その人×この経路」の数字（落合さんの記事とYouTubeを分けて見る）
    a.who = a.author && a.author !== a.source && s ? { plus: s.plus, minus: s.minus, rp: s.rp, rm: s.rm, score: s.score, trend: s.trend } : null;
    a.pkey = a.person ? a.person + '|' + a.ch : '';
  });
  return {
    name: name,
    items: items,
    suggest: suggest,
    counts: { new: newCount, later: all.filter(function (a) { return a.status === 'あとで読む'; }).length }
  };
}

/**
 * 記事の仕分けから、媒体（ソース）と書き手ごとのプラス・マイナスを自動で数える。
 * プラス: あとで読む・読んだ・興味度4以上。マイナス: 興味なし・興味度2以下。
 * 最近（REP_RECENT_DAYS 日）とそれより前の「プラスの割合」を比べて、上向き・下向きを出す。
 */
var REP_RECENT_DAYS = 14;

/**
 * 古くなると価値が落ちる記事（ニュース型）か、古くても役立つ記事（保存型）かを見出しで見分ける。
 * ニュース型で NEWS_STALE_DAYS 日より古いものは、新着の下へ回し、朝のメールにも入れない。
 */
var NEWS_STALE_DAYS = 14;
var NEWS_WORDS = /発表|開始|提供|リリース|発売|速報|公開|アップデート|更新|値上げ|値下げ|終了|廃止|決定|launch|release|announc|update|now available|introduc/i;
var KEEP_WORDS = /とは|入門|解説|方法|やり方|使い方|コツ|考え方|まとめ|ガイド|事例|インタビュー|教訓|理由|なぜ|how to|guide|tips|lessons|why/i;
var NEWS_SOURCES = /Workspace Updates|ニュースリリース|OpenAI News|INTERNET Watch/;
function freshKind_(title, source) {
  if (KEEP_WORDS.test(title)) return 'keep';
  if (NEWS_WORDS.test(title) || NEWS_SOURCES.test(source)) return 'news';
  return 'keep';
}
function isStale_(kind, publishedMs) {
  return kind === 'news' && publishedMs > 0 && Date.now() - publishedMs > NEWS_STALE_DAYS * 24 * 3600 * 1000;
}
/**
 * 会員登録・有料会員にならないと中身が読めない記事（2026-11-08 北原さん）。
 * 消さずに 🔒 を付け、新着とメールで下へ回す。興味の記録（話題・書き手・媒体のプラス・マイナス）には入れず、
 * 「読めた／読めない」は 記事 シートの「鍵」列に別に残す（judge_ は鍵を見ない）。
 * 見分け方: 見出し・概要の文言 / 設定「会員限定とみなすサイト」/ その媒体で「読めない」が LOCK_LEARN_MIN 件以上かつ「読めた」より多い。
 */
var LOCK_WORDS = /会員限定|有料会員|無料会員登録|会員登録(を|して|すると|で)|ログインして(続き|全文)|続きを読むには|プレミアム会員|有料プラン/;
var LOCK_MARKS = ['読めた', '読めない'];
var LOCK_LEARN_MIN = 2;
function lockHosts_(settings) {
  return String(settings['会員限定とみなすサイト'] || '').split(/[,、\s]+/).map(function (x) { return x.trim().toLowerCase(); }).filter(String);
}
/** all（readArticles_ の結果）に lock（'会員限定' / '読めない' / '読めた' / ''）と locked を付け、媒体ごとの数を返す。 */
function applyLocks_(all, settings) {
  var hosts = lockHosts_(settings || {});
  var bySource = {};
  all.forEach(function (a) {
    if (LOCK_MARKS.indexOf(a.lockMark) === -1) return;
    var o = bySource[a.source] || (bySource[a.source] = { no: 0, ok: 0 });
    if (a.lockMark === '読めない') o.no++; else o.ok++;
  });
  all.forEach(function (a) {
    var host = ((/^https?:\/\/([^\/:?#]+)/.exec(a.link) || [])[1] || '').toLowerCase();
    var o = bySource[a.source];
    a.lockGuess = LOCK_WORDS.test(a.title + ' ' + (a.rawSummary || '')) ||
      hosts.some(function (x) { return host === x || host.slice(-x.length - 1) === '.' + x; }) ||
      !!(o && o.no >= LOCK_LEARN_MIN && o.no > o.ok);
    a.lock = LOCK_MARKS.indexOf(a.lockMark) !== -1 ? a.lockMark : (a.lockGuess ? '会員限定' : '');
    a.locked = a.lock === '会員限定' || a.lock === '読めない';
    delete a.rawSummary;
  });
  return bySource;
}

function judge_(a) {
  if (a.status === '興味なし' || (a.interest && a.interest <= 2)) return -1;
  if (a.status === 'あとで読む' || a.status === '完了' || a.interest >= 4) return 1;
  return 0;
}
function reputation_(all) {
  var since = Date.now() - REP_RECENT_DAYS * 24 * 3600 * 1000;
  var t = {};
  var bump = function (key, sign, recent) {
    var o = t[key] || (t[key] = { plus: 0, minus: 0, rp: 0, rm: 0 });
    if (sign > 0) { o.plus++; if (recent) o.rp++; } else { o.minus++; if (recent) o.rm++; }
  };
  all.forEach(function (a) {
    var sign = judge_(a);
    if (!sign) return;
    var recent = a.judged >= since;
    if (a.source) bump('媒体:' + a.source, sign, recent);
    if (a.author && a.author !== a.source) bump('人:' + a.author, sign, recent);
  });
  Object.keys(t).forEach(function (k) {
    var o = t[k];
    var op = o.plus - o.rp, om = o.minus - o.rm;
    var rate = function (p, m) { return p + m ? (p - m) / (p + m) : null; };
    var now = rate(o.rp, o.rm), before = rate(op, om), all_ = rate(o.plus, o.minus);
    o.score = Math.round(all_ * 100) / 100;
    o.trend = now === null ? 'flat' : before === null ? (now > 0 ? 'up' : now < 0 ? 'down' : 'flat')
      : (now - before > 0.2 ? 'up' : now - before < -0.2 ? 'down' : 'flat');
  });
  return t;
}

/** 評価を書き込む。行がずれていないか ID で確かめる。field: 興味度 / 重要度 / ステータス */
function apiRate(user, row, id, field, value) {
  if (['興味度', '重要度', 'ステータス'].indexOf(field) === -1) throw new Error('書き換えられない列です');
  if (field === 'ステータス' && STATUSES.indexOf(value) === -1) throw new Error('ステータスの値が違います');
  if (field !== 'ステータス' && !(value === '' || (Number(value) >= 1 && Number(value) <= 5))) throw new Error('1〜5で付けてください');
  var book = mobileBook_(user);
  var sh = book.getSheetByName(SHEETS.ARTICLES);
  var c = articleCols_();
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (String(sh.getRange(row, c['ID'] + 1).getValue()) !== String(id)) throw new Error('記事の位置が変わりました。開き直してください');
    sh.getRange(row, c[field] + 1).setValue(field === 'ステータス' ? value : (value === '' ? '' : Number(value)));
    sh.getRange(row, c['評価日時'] + 1).setValue(new Date());
  } finally {
    lock.releaseLock();
  }
  return true;
}

/**
 * スワイプの仕分け。ステータスと（興味なしのときは）興味度を1回の呼び出しで書く。
 * interest: 数字なら興味度に入れる、'' なら空にする、null なら触らない。
 */
function apiTriage(user, row, id, status, interest) {
  if (STATUSES.indexOf(status) === -1) throw new Error('ステータスの値が違います');
  if (interest !== null && interest !== undefined && !(interest === '' || (Number(interest) >= 1 && Number(interest) <= 5))) throw new Error('1〜5で付けてください');
  var book = mobileBook_(user);
  var sh = book.getSheetByName(SHEETS.ARTICLES);
  var c = articleCols_();
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (String(sh.getRange(row, c['ID'] + 1).getValue()) !== String(id)) throw new Error('記事の位置が変わりました。開き直してください');
    sh.getRange(row, c['ステータス'] + 1).setValue(status);
    if (interest !== null && interest !== undefined) sh.getRange(row, c['興味度'] + 1).setValue(interest === '' ? '' : Number(interest));
    sh.getRange(row, c['評価日時'] + 1).setValue(new Date());
  } finally {
    lock.releaseLock();
  }
  return true;
}

/**
 * まとめて仕分けを書く（スマホで続けてスワイプしたとき、1回の呼び出しにまとめる）。
 * ops: [{ row, id, status, interest, importance }]。interest / importance は null なら触らない、'' なら空にする。
 * 返り値: 失敗した op の id と理由の配列（全部できたら空）。
 */
function apiTriageBatch(user, ops) {
  var book = mobileBook_(user);
  var sh = book.getSheetByName(SHEETS.ARTICLES);
  var c = articleCols_();
  var failed = [];
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var now = new Date();
    (ops || []).forEach(function (op) {
      try {
        if (STATUSES.indexOf(op.status) === -1) throw new Error('ステータスの値が違います');
        var row = Number(op.row);
        if (String(sh.getRange(row, c['ID'] + 1).getValue()) !== String(op.id)) {
          // 行がずれていたら ID で探し直す
          var ids = sh.getRange(2, c['ID'] + 1, sh.getLastRow() - 1, 1).getValues();
          row = 0;
          for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(op.id)) { row = i + 2; break; }
          if (!row) throw new Error('記事が見つかりません');
        }
        sh.getRange(row, c['ステータス'] + 1).setValue(op.status);
        [['interest', '興味度'], ['importance', '重要度']].forEach(function (f) {
          var v = op[f[0]];
          if (v === null || v === undefined) return;
          if (!(v === '' || (Number(v) >= 1 && Number(v) <= 5))) throw new Error('1〜5で付けてください');
          sh.getRange(row, c[f[1]] + 1).setValue(v === '' ? '' : Number(v));
        });
        sh.getRange(row, c['評価日時'] + 1).setValue(now);
      } catch (e) {
        failed.push({ id: op.id, reason: e.message });
      }
    });
  } finally {
    lock.releaseLock();
  }
  return failed;
}

/**
 * 中身が読めたか（鍵）を記事に残す。value: 読めた / 読めない / ''（取り消し）。
 * 興味度・ステータスには触らない（興味があったことはそのまま記録に残す）。
 */
function apiMarkLock(user, row, id, value) {
  if (value !== '' && LOCK_MARKS.indexOf(value) === -1) throw new Error('鍵の値が違います');
  var book = mobileBook_(user);
  var sh = book.getSheetByName(SHEETS.ARTICLES);
  var c = articleCols_();
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    row = Number(row);
    if (String(sh.getRange(row, c['ID'] + 1).getValue()) !== String(id)) {
      var ids = sh.getRange(2, c['ID'] + 1, sh.getLastRow() - 1, 1).getValues();
      row = 0;
      for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) { row = i + 2; break; }
      if (!row) throw new Error('記事が見つかりません');
    }
    if (!sh.getRange(1, c['鍵'] + 1).getValue()) sh.getRange(1, c['鍵'] + 1).setValue('鍵').setFontWeight('bold');
    sh.getRange(row, c['鍵'] + 1).setValue(value);
  } finally {
    lock.releaseLock();
  }
  return true;
}

// ===== 著者（人×受け取り方） =====
/**
 * 著者を「人×経路（記事／まとめ経由／YouTube／X）」で数える。2026-11-01 北原さんの提案OKで追加。
 * - 経路は URL から自動で判定（channelOf_）。人は 書き手、YouTube はチャンネル名、X は投稿者。
 * - 表記ゆれは 著者 シートの「別名」でまとめる。
 * - フラグ（注目／ふつう／量を絞る／ミュート）は経路ごと。新着の並びと朝のメールに効く。
 * - 条件を満たすと新着の先頭に「提案カード」を出し、スワイプ一回で決めてもらう（勝手には止めない）。
 * - 見方（自動）は数字から文を組む型。手書きの見方があればそちらを優先。
 */
var CHANNELS = ['記事', 'まとめ経由', 'YouTube', 'X'];
var AUTHOR_FLAGS = ['注目', 'ふつう', '量を絞る', 'ミュート'];
var DIGEST_HOSTS = /newspicks\.com|b\.hatena\.ne\.jp|gunosy\.com|smartnews\.com|news\.yahoo\.co\.jp|news\.livedoor\.com|antenna\.jp|news\.google\.com/;
var SUGGEST = { muteRun: 3, focusRun: 3, throttleMin: 10, throttleRate: 0.2, snoozeDays: 30, recentDays: 14 };

function channelOf_(link) {
  var u = String(link || '');
  if (/youtube\.com|youtu\.be/.test(u)) return 'YouTube';
  if (/(^|\/\/|\.)(x|twitter)\.com\//.test(u)) return 'X';
  if (DIGEST_HOSTS.test(u)) return 'まとめ経由';
  return '記事';
}
function normName_(s) {
  return String(s || '').replace(/【[^】]*】|\[[^\]]*\]/g, '').replace(/[\s　・\-−ー_]/g, '').toLowerCase();
}
/** 記事 1 行の「人」。いなければ ''。 */
function personOf_(a, ch, alias) {
  var raw = ch === 'YouTube' ? a.source : (a.author && a.author !== a.source ? a.author : '');
  raw = String(raw || '').trim();
  if (!raw) return '';
  return alias[normName_(raw)] || raw;
}

/** 著者シートを読む: 別名→名前、名前→{flags, manual, snooze, aliases} */
function readAuthorSheet_(book) {
  var sh = book.getSheetByName(SHEETS.AUTHORS);
  var out = { alias: {}, people: {} };
  if (!sh || sh.getLastRow() < 2) return out;
  var H = HEADERS.AUTHORS;
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, H.length).getValues();
  rows.forEach(function (r, i) {
    var name = String(r[H.indexOf('名前')] || '').trim();
    if (!name) return;
    var p = { row: i + 2, name: name, manual: String(r[H.indexOf('見方（手書き）')] || ''), flags: {}, snooze: {},
      aliases: String(r[H.indexOf('別名')] || '').split(/[,、]/).map(function (x) { return x.trim(); }).filter(String) };
    CHANNELS.forEach(function (ch) { p.flags[ch] = String(r[H.indexOf('フラグ ' + ch)] || ''); });
    String(r[H.indexOf('提案を保留')] || '').split(';').forEach(function (kv) {
      var m = /^\s*([^=]+)=(\d{4}-\d{2}-\d{2})/.exec(kv);
      if (m) p.snooze[m[1].trim()] = m[2];
    });
    out.people[name] = p;
    out.alias[normName_(name)] = name;
    p.aliases.forEach(function (al) { out.alias[normName_(al)] = name; });
  });
  return out;
}

/** 記事シートを読んで、画面と集計の両方で使う形にする。 */
function readArticles_(book) {
  var sh = book.getSheetByName(SHEETS.ARTICLES);
  if (!sh || sh.getLastRow() < 2) return [];
  var c = articleCols_();
  // 「鍵」列を足す前のブックでも読めるよう、シートにある列までだけ読む（足りない列は空として扱う）
  var values = sh.getRange(2, 1, sh.getLastRow() - 1, Math.min(HEADERS.ARTICLES.length, sh.getMaxColumns())).getValues();
  return values.map(function (r, i) {
    var pub = r[c['公開日時']] instanceof Date ? r[c['公開日時']] : (r[c['取得日時']] instanceof Date ? r[c['取得日時']] : null);
    var got = r[c['取得日時']] instanceof Date ? r[c['取得日時']].getTime() : 0;
    return {
      row: i + 2, id: String(r[c['ID']]), title: String(r[c['タイトル']] || ''), source: String(r[c['ソース']] || ''),
      link: String(r[c['URL']] || ''), summary: String(r[c['AI要約']] || r[c['概要']] || '').slice(0, 220),
      tags: String(r[c['タグ']] || ''), score: Number(r[c['関連度']]) || 0, published: pub ? pub.getTime() : 0,
      interest: r[c['興味度']] === '' ? 0 : Number(r[c['興味度']]) || 0,
      importance: r[c['重要度']] === '' ? 0 : Number(r[c['重要度']]) || 0,
      status: String(r[c['ステータス']] || '未読'), image: String(r[c['画像']] || ''),
      words: String(r[c['当たった興味ワード']] || ''), author: String(r[c['書き手']] || ''),
      pinned: String(r[c['追加元']] || '') === '手で追加',
      original: String(r[c['原題']] || ''),
      lockMark: String(r[c['鍵']] || ''), rawSummary: String(r[c['概要']] || ''),
      short: isShort_(String(r[c['URL']] || ''), String(r[c['タイトル']] || '')),
      kind: freshKind_(String(r[c['タイトル']] || ''), String(r[c['ソース']] || '')),
      got: got,
      judged: r[c['評価日時']] instanceof Date ? r[c['評価日時']].getTime() : got
    };
  });
}

/** 人×経路の集計。all は readArticles_ の結果（ch・person を付ける）。 */
function authorStats_(all, sheet, views) {
  var now = Date.now(), recent = now - SUGGEST.recentDays * 864e5;
  var people = {};
  views = views || {};
  Object.keys(views).forEach(function (raw) {
    var name = sheet.alias[normName_(raw)] || raw, v = views[raw];
    var p = people[name] || (people[name] = { name: name, ch: {}, evidence: [], pos: {}, neg: {}, pinned: false, last: 0 });
    p.views = v;
    if (v.last > p.last) p.last = v.last;
  });
  all.forEach(function (a) {
    a.ch = channelOf_(a.link);
    a.person = personOf_(a, a.ch, sheet.alias);
    if (!a.person) return;
    var p = people[a.person] || (people[a.person] = { name: a.person, ch: {}, evidence: [], pos: {}, neg: {}, pinned: false, last: 0 });
    var s = p.ch[a.ch] || (p.ch[a.ch] = { n: 0, plus: 0, minus: 0, rp: 0, rm: 0, rn: 0, months: {}, seq: [] });
    var ym = Utilities.formatDate(new Date(a.got || a.published || now), 'Asia/Tokyo', 'yyyy-MM');
    var mo = s.months[ym] || (s.months[ym] = { p: 0, m: 0, n: 0 });
    s.n++; mo.n++;
    if (a.got >= recent) s.rn++;
    if (a.pinned) p.pinned = true;
    var sign = judge_(a);
    if (!sign) return;
    var isRecent = a.judged >= recent;
    if (sign > 0) { s.plus++; mo.p++; if (isRecent) s.rp++; } else { s.minus++; mo.m++; if (isRecent) s.rm++; }
    s.seq.push({ t: a.judged, s: sign });
    if (a.judged > p.last) p.last = a.judged;
    a.tags.split(',').map(function (t) { return t.trim(); }).filter(function (t) { return t && !/^注目の/.test(t); })
      .forEach(function (t) { var box = sign > 0 ? p.pos : p.neg; box[t] = (box[t] || 0) + 1; });
    if (sign > 0) p.evidence.push({ title: a.title, link: a.link, ch: a.ch, t: a.judged });
  });
  Object.keys(people).forEach(function (k) {
    var p = people[k];
    p.evidence.sort(function (x, y) { return y.t - x.t; }); p.evidence = p.evidence.slice(0, 3);
    CHANNELS.forEach(function (ch) {
      var s = p.ch[ch]; if (!s) return;
      s.seq.sort(function (x, y) { return x.t - y.t; });
      var rate = function (pp, mm) { return pp + mm ? (pp - mm) / (pp + mm) : null; };
      var nowR = rate(s.rp, s.rm), before = rate(s.plus - s.rp, s.minus - s.rm), allR = rate(s.plus, s.minus);
      s.score = allR === null ? 0 : Math.round(allR * 100) / 100;
      s.hasBefore = before !== null;
      s.trend = nowR === null ? 'flat' : before === null ? (nowR > 0 ? 'up' : nowR < 0 ? 'down' : 'flat')
        : (nowR - before > 0.2 ? 'up' : nowR - before < -0.2 ? 'down' : 'flat');
    });
    var top = function (box, other) {
      return Object.keys(box).filter(function (t) { return box[t] > (other[t] || 0); })
        .sort(function (x, y) { return box[y] - box[x]; }).slice(0, 3);
    };
    p.likes = top(p.pos, p.neg); p.dislikes = top(p.neg, p.pos);
    var info = sheet.people[k];
    p.flags = info ? info.flags : {};
    p.manual = info ? info.manual : '';
    p.aliases = info ? info.aliases : [];
    p.snooze = info ? info.snooze : {};
    p.auto = autoView_(p);
  });
  return people;
}

/** 数字から見方の文を組む（費用ゼロ）。 */
function autoView_(p) {
  var parts = [];
  var judgedAll = 0;
  CHANNELS.forEach(function (ch) {
    var s = p.ch[ch]; if (!s) return;
    var j = s.plus + s.minus; judgedAll += j;
    if (!j) { if (s.n >= 5) parts.push(ch + 'は' + s.n + '本出ているが未判定'); return; }
    var hit = s.plus / j;
    var word = j < 3 ? '判定はまだ少ない' : hit >= 0.6 ? 'よく刺さる' : hit >= 0.3 ? 'ときどき刺さる' : '刺さらない';
    var tr = !s.hasBefore ? '' : s.trend === 'up' ? '・最近上向き' : s.trend === 'down' ? '・最近下向き' : '';
    parts.push(ch + (j < 3 ? 'の' : 'は') + word + '（' + j + '本中' + s.plus + '本が刺さった' + tr + '）');
    if (s.rn >= SUGGEST.throttleMin && s.rp / s.rn < SUGGEST.throttleRate) parts.push(ch + 'は量のわりに当たりが少ない（2週間で' + s.rn + '本）');
  });
  if (!judgedAll && !parts.length && !(p.views && p.views.total)) return 'まだ判定がありません';
  var t = parts.length ? parts.join('。') + '。' : '';
  if (p.likes.length) t += '刺さるテーマ: ' + p.likes.join('・') + '。';
  if (p.dislikes.length) t += '刺さらないテーマ: ' + p.dislikes.join('・') + '。';
  if (p.pinned) t += '自分でURLを貼ったことがある。';
  if (p.views && p.views.total) {
    var ms = Object.keys(p.views.months).sort();
    t += 'YouTubeで' + p.views.total + '本見ている（最近3か月で' + p.views.recent + '本、' + ms[0].replace('-', '年').replace(/^(\d+)年0?/, '$1年') + '月から）。';
    if (!p.views.subscribed && p.views.recent >= VIEWS_SUGGEST_MIN) t += 'まだフィードに入っていない。';
  }
  return t;
}

/** 提案カード。1つだけ返す（ミュート＞量を絞る＞注目の順）。 */
function suggestion_(people) {
  var today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
  var cutoff = Utilities.formatDate(new Date(Date.now() - SUGGEST.snoozeDays * 864e5), 'Asia/Tokyo', 'yyyy-MM-dd');
  var best = null, rank = { 'ミュート': 3, '量を絞る': 2, '注目': 1 };
  Object.keys(people).forEach(function (k) {
    var p = people[k];
    CHANNELS.forEach(function (ch) {
      var s = p.ch[ch]; if (!s) return;
      var flag = p.flags[ch] || 'ふつう';
      if (p.snooze[ch] && p.snooze[ch] > cutoff) return;
      // YouTube は新着で見送っても本編を見ていることが多いので、止める・絞る提案はしない（2026-11-08 北原さん）
      var noStop = ch === 'YouTube';
      var last = s.seq.slice(-Math.max(SUGGEST.muteRun, SUGGEST.focusRun));
      var tail = function (n, sign) { var x = s.seq.slice(-n); return x.length === n && x.every(function (e) { return e.s === sign; }); };
      var cand = null;
      if (!noStop && flag !== 'ミュート' && tail(SUGGEST.muteRun, -1)) {
        cand = { type: 'ミュート', reason: p.name + 'の' + ch + 'を' + SUGGEST.muteRun + '回続けて興味なしにしました。' + ch + 'だけミュートしますか？' + otherChannels_(p, ch) };
      } else if (!noStop && flag === 'ふつう' && s.rn >= SUGGEST.throttleMin && s.rp / s.rn < SUGGEST.throttleRate) {
        cand = { type: '量を絞る', reason: p.name + 'の' + ch + 'は2週間で' + s.rn + '本出て、刺さったのは' + s.rp + '本です。1日1本に絞りますか？' };
      } else if (flag !== '注目' && flag !== 'ミュート' && tail(SUGGEST.focusRun, 1)) {
        cand = { type: '注目', reason: p.name + 'の' + ch + 'が' + SUGGEST.focusRun + '回続けて刺さりました。注目にして上に出しますか？' };
      }
      if (cand && (!best || rank[cand.type] > rank[best.type])) { cand.person = p.name; cand.ch = ch; best = cand; }
      void last; void today;
    });
  });
  if (!best) {
    // よく見ているのにフィードに無いチャンネル
    var cand = Object.keys(people).map(function (k) { return people[k]; })
      .filter(function (p) { return p.views && p.views.id && !p.views.subscribed && p.views.recent >= VIEWS_SUGGEST_MIN && !(p.snooze['YouTube'] && p.snooze['YouTube'] > cutoff); })
      .sort(function (a, b) { return b.views.recent - a.views.recent; })[0];
    if (cand) best = { type: 'フィードに足す', person: cand.name, ch: 'YouTube', channelId: cand.views.id,
      reason: cand.name + 'のYouTubeを最近3か月で' + cand.views.recent + '本見ています。フィードに足して新着に出しますか？' };
  }
  return best;
}
function otherChannels_(p, ch) {
  var good = CHANNELS.filter(function (c) { return c !== ch && p.ch[c] && p.ch[c].plus > p.ch[c].minus; });
  return good.length ? good.join('・') + 'はそのままです。' : '';
}

/** 新着に フラグ を当てる: ミュートを外し、量を絞るは1日1本、注目は上へ。 */
function applyAuthorFlags_(items, people) {
  var seen = {};
  return items.filter(function (a) {
    var p = a.person && people[a.person];
    var flag = p ? (p.flags[a.ch] || 'ふつう') : 'ふつう';
    a.flag = flag;
    if (flag === 'ミュート') return false;
    if (flag === '量を絞る') {
      var key = a.person + '|' + a.ch + '|' + Utilities.formatDate(new Date(a.got || a.published || Date.now()), 'Asia/Tokyo', 'yyyy-MM-dd');
      if (seen[key]) return false;
      seen[key] = true;
    }
    return true;
  });
}

/** 著者シートを書き直す（手で書く列は残す）。毎日の取得と月曜の学習のあとに呼ぶ。 */
function rebuildAuthors_() {
  var sh = Store.sheet(SHEETS.AUTHORS);
  if (!sh) return;
  var book = sh.getParent();
  var sheet = readAuthorSheet_(book);
  var people = authorStats_(readArticles_(book), sheet, readViews_(book));
  var H = HEADERS.AUTHORS;
  var names = Object.keys(people).filter(function (k) {
    var p = people[k];
    var judged = CHANNELS.some(function (ch) { return p.ch[ch] && (p.ch[ch].plus + p.ch[ch].minus); }) || (p.views && p.views.recent >= 3);
    var many = CHANNELS.some(function (ch) { return p.ch[ch] && p.ch[ch].n >= 5; });
    return judged || many || p.pinned || sheet.people[k];
  });
  Object.keys(sheet.people).forEach(function (k) { if (names.indexOf(k) === -1) names.push(k); });
  var cell = function (s) { return s ? (s.plus + s.minus ? '+' + s.plus + ' −' + s.minus + ' ' + (s.trend === 'up' ? '↗' : s.trend === 'down' ? '↘' : '→') : '') + '（' + s.n + '本）' : ''; };
  var stamp = new Date();
  var rows = names.map(function (k) {
    var p = people[k] || { ch: {}, likes: [], dislikes: [], auto: 'まだ判定がありません', last: 0 };
    var old = sheet.people[k];
    var snoozeText = old ? Object.keys(old.snooze).map(function (ch) { return ch + '=' + old.snooze[ch]; }).join(';') : '';
    return H.map(function (h) {
      switch (h) {
        case '名前': return k;
        case '別名': return old ? old.aliases.join('、') : '';
        case '見方（手書き）': return old ? old.manual : '';
        case '提案を保留': return snoozeText;
        case '見方（自動）': return p.auto;
        case '刺さるテーマ': return p.likes.join('・');
        case '刺さらないテーマ': return p.dislikes.join('・');
        case '最終判定': return p.last ? new Date(p.last) : '';
        case '更新': return stamp;
        default:
          if (/^フラグ /.test(h)) return old ? old.flags[h.slice(4)] || '' : '';
          if (CHANNELS.indexOf(h) !== -1) return cell(p.ch[h]);
          return '';
      }
    });
  });
  rows.sort(function (x, y) { return (y[H.indexOf('最終判定')] || 0) - (x[H.indexOf('最終判定')] || 0); });
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, H.length).clearContent();
  if (rows.length) sh.getRange(2, 1, rows.length, H.length).setValues(rows);
  // フラグ列はプルダウンにする
  var rule = SpreadsheetApp.newDataValidation().requireValueInList(AUTHOR_FLAGS, true).setAllowInvalid(true).build();
  CHANNELS.forEach(function (ch) { sh.getRange(2, H.indexOf('フラグ ' + ch) + 1, Math.max(rows.length, 1), 1).setDataValidation(rule); });
}

/** 画面の 著者 タブ。最近ハマっている順。 */
function apiAuthors(user) {
  var book = mobileBook_(user);
  var people = authorStats_(readArticles_(book), readAuthorSheet_(book), readViews_(book));
  var months = [];
  for (var i = 5; i >= 0; i--) {
    var d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i);
    months.push(Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM'));
  }
  var list = Object.keys(people).map(function (k) {
    var p = people[k];
    var heat = 0, judged = 0, shown = 0;
    var ch = {};
    CHANNELS.forEach(function (c) {
      var s = p.ch[c]; if (!s) return;
      heat += s.rp * 2 - s.rm + (s.plus - s.minus) * 0.3; judged += s.plus + s.minus; shown += s.n;
      ch[c] = { n: s.n, plus: s.plus, minus: s.minus, rn: s.rn, rp: s.rp, trend: s.trend, score: s.score,
        months: months.map(function (m) { return s.months[m] || { p: 0, m: 0, n: 0 }; }) };
    });
    if ((p.flags && CHANNELS.some(function (c) { return p.flags[c] === '注目'; })) || p.pinned) heat += 3;
    var views = null;
    if (p.views && p.views.total) {
      heat += Math.min(p.views.recent, 30) * 0.3;
      views = { total: p.views.total, recent: p.views.recent, subscribed: p.views.subscribed, months: months.map(function (m) { return p.views.months[m] || 0; }) };
    }
    return { name: k, view: p.manual || p.auto, auto: p.auto, manual: p.manual, flags: p.flags, aliases: p.aliases,
      likes: p.likes, dislikes: p.dislikes, evidence: p.evidence, ch: ch, heat: heat, judged: judged, shown: shown, pinned: p.pinned, views: views };
  }).filter(function (x) { return x.judged || x.pinned || x.shown >= 5 || (x.views && x.views.recent >= 3) || CHANNELS.some(function (c) { return x.flags[c] && x.flags[c] !== 'ふつう'; }); })
    .sort(function (a, b) { return (b.heat - a.heat) || (b.judged - a.judged) || (b.shown - a.shown); });
  // 提案カード（ミュート・注目・フィードに足す など）は新着ではなく著者タブに出す（2026-11-08 北原さん）
  return { months: months, channels: CHANNELS, flags: AUTHOR_FLAGS, items: list.slice(0, 80), suggest: suggestion_(people) };
}

/** 著者の設定を変える。field: flag（value=フラグ, ch 必須）/ snooze（ch 必須）/ manual / aliases */
function apiSetAuthor(user, name, field, value, ch) {
  name = String(name || '').trim();
  if (!name) throw new Error('名前がありません');
  if ((field === 'flag' || field === 'snooze') && CHANNELS.indexOf(ch) === -1) throw new Error('経路が違います');
  if (field === 'flag' && AUTHOR_FLAGS.indexOf(value) === -1) throw new Error('フラグの値が違います');
  var book = mobileBook_(user);
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    Store.use(book);
    Store.ensureSchema();
    var sh = Store.sheet(SHEETS.AUTHORS);
    var H = HEADERS.AUTHORS;
    var info = readAuthorSheet_(book).people[name];
    var row = info ? info.row : sh.getLastRow() + 1;
    if (!info) sh.getRange(row, H.indexOf('名前') + 1).setValue(name);
    if (field === 'flag') sh.getRange(row, H.indexOf('フラグ ' + ch) + 1).setValue(value);
    else if (field === 'manual') sh.getRange(row, H.indexOf('見方（手書き）') + 1).setValue(String(value || '').slice(0, 500));
    else if (field === 'aliases') sh.getRange(row, H.indexOf('別名') + 1).setValue(String(value || '').slice(0, 300));
    else if (field === 'snooze') {
      var snooze = info ? info.snooze : {};
      snooze[ch] = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
      sh.getRange(row, H.indexOf('提案を保留') + 1).setValue(Object.keys(snooze).map(function (k) { return k + '=' + snooze[k]; }).join(';'));
    } else throw new Error('変えられない項目です');
  } finally {
    Store.use(null);
    lock.releaseLock();
  }
  return true;
}

// ===== YouTube 視聴履歴（Google テイクアウト） =====
/**
 * テイクアウトの zip（watch-history.json）と、昔の watch-history.html を読み、
 * チャンネル×月の視聴本数を「視聴履歴」シートにまとめる。2026-11-02 北原さんの依頼で追加。
 * - 探す場所: このアカウントから見えるドライブ（共有された Takeout フォルダも含む）。ID はコードに書かない。
 * - 新しいファイルが来たときだけ読み直す（読んだファイルは 設定「読んだ視聴履歴」に ID を残す）。
 * - 広告の視聴は数えない。動画の題名はシートに最新の1本だけ残す（全部は残さない）。
 * - 著者リストでは YouTube の「視聴」として月ごとの帯に出る。よく見るのに未登録のチャンネルはフィードに足す提案を出す。
 */
var VIEWS_RECENT_DAYS = 90;
var VIEWS_SUGGEST_MIN = 5;

function viewSources_() {
  var out = [];
  var it = DriveApp.searchFiles("title contains 'takeout-' and trashed = false");
  while (it.hasNext()) { var f = it.next(); if (/\.zip$/i.test(f.getName())) out.push(f); }
  var seenSize = {};
  var it2 = DriveApp.searchFiles("title = 'watch-history.html' and trashed = false");
  while (it2.hasNext()) { var h = it2.next(); var k = h.getSize(); if (!seenSize[k]) { seenSize[k] = true; out.push(h); } }
  return out;
}

/** 新しいテイクアウトがあれば読み直す。毎朝の取得のあとに呼ぶ。 */
function importWatchHistory_(force) {
  var files = viewSources_();
  if (!files.length) return;
  var settings = Store.settings();
  var done = String(settings['読んだ視聴履歴'] || '').split(',').filter(String);
  var ids = files.map(function (f) { return f.getId(); });
  if (!force && ids.every(function (id) { return done.indexOf(id) !== -1; })) return;
  var events = {};
  var count = 0;
  files.forEach(function (f) {
    var add = function (e) { var key = e.url + '|' + e.time; if (!events[key]) { events[key] = e; count++; } };
    if (/\.zip$/i.test(f.getName())) {
      Utilities.unzip(f.getBlob().setContentType('application/zip')).forEach(function (b) {
        var n = b.getName();
        if (/watch-history\.json$|視聴履歴\.json$|再生履歴\.json$/i.test(n)) parseWatchJson_(b.getDataAsString('UTF-8')).forEach(add);
        else if (/watch-history\.html$|視聴履歴\.html$|再生履歴\.html$/i.test(n)) parseWatchHtml_(b.getDataAsString('UTF-8')).forEach(add);
      });
    } else {
      parseWatchHtml_(f.getBlob().getDataAsString('UTF-8')).forEach(add);
    }
  });
  writeViews_(Object.keys(events).map(function (k) { return events[k]; }));
  Store.setSetting('読んだ視聴履歴', ids.join(','));
  Store.log('視聴履歴', 'OK', files.length + 'ファイル / ' + count + '本');
}

/** JSON 形式: [{title, titleUrl, subtitles:[{name,url}], time, details}] */
function parseWatchJson_(text) {
  var list;
  try { list = JSON.parse(text); } catch (e) { return []; }
  return list.filter(function (x) {
    return x && x.titleUrl && x.subtitles && x.subtitles[0] && !(x.details || []).some(function (d) { return /広告|Ads/i.test(d.name || ''); });
  }).map(function (x) {
    return { url: x.titleUrl, title: String(x.title || '').replace(/^Watched |\s*を視聴しました$/g, ''), channel: x.subtitles[0].name,
      channelId: ((/channel\/(UC[\w-]{22})/.exec(x.subtitles[0].url || '')) || [])[1] || '', time: x.time };
  });
}

/** HTML 形式（昔のテイクアウト）: <a href=動画>題名</a><br><a href=チャンネル>名前</a><br>日時 */
function parseWatchHtml_(html) {
  var out = [];
  var re = /<a href="(https:\/\/www\.youtube\.com\/watch\?v=[^"]+)">([^<]*)<\/a><br><a href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})">([^<]*)<\/a><br>([^<]+)</g;
  var m;
  while ((m = re.exec(html))) {
    var t = parseTakeoutDate_(m[5]);
    if (t) out.push({ url: decode_(m[1]), title: decode_(m[2]), channelId: m[3], channel: decode_(m[4]), time: t });
  }
  return out;
}
/** 「2025/08/10 15:15:29 JST」や「Aug 10, 2025, 3:15:29 PM JST」を ISO に。 */
function parseTakeoutDate_(s) {
  s = String(s).trim();
  var m = /(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2}):(\d{2})/.exec(s);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 9, +m[5], +m[6])).toISOString();
  var d = new Date(s.replace(/ /g, ' ').replace(/\s+[A-Z]{2,4}$/, ''));
  return isNaN(d.getTime()) ? '' : d.toISOString();
}

/** チャンネル×月にまとめて 視聴履歴 シートを書き直す。 */
function writeViews_(events) {
  var agg = {};
  events.forEach(function (e) {
    var d = new Date(e.time); if (isNaN(d.getTime())) return;
    var ym = Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM');
    var key = (e.channelId || e.channel) + '|' + ym;
    var a = agg[key] || (agg[key] = { channel: e.channel, id: e.channelId, ym: ym, n: 0, last: 0, title: '' });
    a.n++;
    if (d.getTime() > a.last) { a.last = d.getTime(); a.title = e.title; a.channel = e.channel; }
  });
  var rows = Object.keys(agg).map(function (k) { var a = agg[k]; return [a.channel, a.id, a.ym, a.n, new Date(a.last), a.title]; })
    .sort(function (x, y) { return (y[2] > x[2] ? 1 : y[2] < x[2] ? -1 : 0) || y[3] - x[3]; });
  var sh = Store.sheet(SHEETS.VIEWS);
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, HEADERS.VIEWS.length).clearContent();
  if (rows.length) sh.getRange(2, 1, rows.length, HEADERS.VIEWS.length).setValues(rows);
}

/** 視聴履歴シートを読む: チャンネル（フィード名にそろえる）→ {id, months:{ym:n}, recent, total} */
function readViews_(book) {
  var sh = book.getSheetByName(SHEETS.VIEWS);
  var out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  // 登録済みの YouTube フィードは、そのフィード名にそろえる（チャンネルIDで照合）
  var feedName = {};
  var fsh = book.getSheetByName(SHEETS.FEEDS);
  if (fsh && fsh.getLastRow() >= 2) {
    var H = HEADERS.FEEDS;
    fsh.getRange(2, 1, fsh.getLastRow() - 1, H.length).getValues().forEach(function (r) {
      var m = /channel_id=(UC[\w-]{22})/.exec(String(r[H.indexOf('URL')] || ''));
      if (m) feedName[m[1]] = { name: String(r[H.indexOf('名前')]), enabled: r[H.indexOf('有効')] === true };
    });
  }
  var since = Utilities.formatDate(new Date(Date.now() - VIEWS_RECENT_DAYS * 864e5), 'Asia/Tokyo', 'yyyy-MM');
  sh.getRange(2, 1, sh.getLastRow() - 1, HEADERS.VIEWS.length).getValues().forEach(function (r) {
    var id = String(r[1] || ''), f = feedName[id];
    var name = f ? f.name : String(r[0] || '');
    if (!name) return;
    var v = out[name] || (out[name] = { id: id, months: {}, recent: 0, total: 0, subscribed: !!(f && f.enabled), lastTitle: '', last: 0 });
    var n = Number(r[3]) || 0, ym = String(r[2]);
    v.months[ym] = (v.months[ym] || 0) + n; v.total += n;
    if (ym >= since) v.recent += n;
    var t = r[4] instanceof Date ? r[4].getTime() : 0;
    if (t > v.last) { v.last = t; v.lastTitle = String(r[5] || ''); }
  });
  return out;
}

/** 提案カード「フィードに足す」を受けたとき。 */
function apiAddChannelFeed(user, name, channelId) {
  if (!/^UC[\w-]{22}$/.test(String(channelId))) throw new Error('チャンネルIDが違います');
  var book = mobileBook_(user);
  try {
    Store.use(book);
    Store.ensureSchema();
    addFeedIfNew_(name, RssYouTube.feedUrl(channelId), 'YouTube', 'YouTube チャンネル（視聴履歴から）');
  } finally { Store.use(null); }
  return true;
}

// ===== 手で貼ったURL =====
/**
 * スマホで貼った記事・YouTube のURLを取り込む。「自分の目でホットだと思った」印として:
 *  1. 記事を 興味5・重要5・完了（本人が読んでから貼る想定）で記事シートに入れる（すでにあれば印だけ付け直す）
 *  2. 書き手と発信元を 興味キーワード に「注目の人」「注目の媒体」（由来 手で追加・重み5）として足す
 *     → 以後その人・媒体の記事は関連度が上がる
 *  3. 発信元の RSS（YouTube はチャンネルのフィード）が見つかればフィードに足す
 *  4. その場で学習（runLearn）を回して、タグとフィードの重みを更新する
 * 外部の取得は UrlFetchApp（無料枠）と YouTube の oEmbed（キー不要）だけ。
 */
var PIN_WEIGHT = 5;
function apiAddUrl(user, url) {
  url = String(url || '').trim();
  var m = /https?:\/\/[^\s]+/.exec(url);
  if (!m) throw new Error('URLが読み取れませんでした');
  url = m[0];
  var book = mobileBook_(user);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    Store.use(book);
    Store.ensureSchema();
    var info = pageInfo_(url);
    // 登録済みフィードと同じサイトなら、そのフィードの名前にそろえる（バッジと学習が同じ媒体として数えるように）
    var same = info.isYouTube ? [] : Store.feeds().filter(function (f) { return domain_(f.url) === domain_(url); });
    if (same.length === 1) info.source = same[0].name;
    if (same.length) info.feedUrl = '';
    var res = pinArticle_(info);
    var added = [];
    if (info.author && info.author !== info.source && addFocusKeyword_(info.author, '注目の人')) added.push('人「' + info.author + '」');
    if (info.source && addFocusKeyword_(info.source, '注目の媒体')) added.push('媒体「' + info.source + '」');
    var feed = info.feedUrl ? addFeedIfNew_(info.source || info.title, info.feedUrl, info.isYouTube ? 'YouTube' : '手で追加', info.about) : false;
    if (feed) added.push('フィード');
    runLearn();
    Store.log('URLを追加', 'OK', info.title + ' / ' + (added.join('・') || '注目は登録済み'));
    return { title: info.title, source: info.source, author: info.author, existed: res.existed, added: added };
  } finally {
    Store.use(null);
    lock.releaseLock();
  }
}

function pageInfo_(url) {
  var info = { url: url, title: '', source: '', author: '', summary: '', about: '', published: '', feedUrl: '', image: '', isYouTube: false };
  var yt = /(youtube\.com\/(watch|shorts|live)|youtu\.be\/)/.test(url);
  var html = '';
  try {
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true, headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'ja,en;q=0.8' } });
    if (res.getResponseCode() < 400) html = res.getContentText().slice(0, 600000);
  } catch (e) { html = ''; }
  var meta = function (name) {
    var r = new RegExp('<meta[^>]+(?:property|name|itemprop)=["\']' + name + '["\'][^>]*>', 'i').exec(html);
    if (!r) return '';
    var c = /content=["\']([^"\']*)["\']/i.exec(r[0]);
    return c ? decode_(c[1]) : '';
  };
  if (yt) {
    info.isYouTube = true;
    try {
      var o = JSON.parse(UrlFetchApp.fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(url), { muteHttpExceptions: true }).getContentText());
      info.title = o.title || ''; info.source = o.author_name || ''; info.image = o.thumbnail_url || '';
    } catch (e) { /* oEmbed が使えないときはページから読む */ }
    var ch = /"(?:channelId|externalChannelId)":"(UC[\w-]{22})"/.exec(html) || /channel\/(UC[\w-]{22})/.exec(html);
    if (ch) info.feedUrl = RssYouTube.feedUrl(ch[1]);
    info.summary = meta('og:description') || meta('description');
    var up = /"(?:uploadDate|publishDate)":"([^"]+)"/.exec(html) || [null, meta('uploadDate') || meta('datePublished')];
    info.published = up[1] || '';
    info.about = 'YouTube チャンネル';
  } else {
    info.title = meta('og:title') || meta('twitter:title') || decode_(((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [])[1] || '').trim());
    info.source = meta('og:site_name') || meta('application-name');
    info.author = meta('author') || meta('article:author') || meta('twitter:creator') ||
      decode_(((/"author"\s*:\s*(?:\[\s*)?\{[^}]*?"name"\s*:\s*"([^"]+)"/.exec(html)) || [])[1] || '');
    if (/^https?:/.test(info.author)) info.author = '';
    info.summary = meta('og:description') || meta('description');
    info.published = meta('article:published_time') || ((/"datePublished"\s*:\s*"([^"]+)"/.exec(html)) || [])[1] || '';
    info.image = meta('og:image');
    var alt = /<link[^>]+type=["\']application\/(?:rss|atom)\+xml["\'][^>]*>/i.exec(html);
    var href = alt && /href=["\']([^"\']+)["\']/i.exec(alt[0]);
    if (href) info.feedUrl = absUrl_(decode_(href[1]), url);
    var host = (/^https?:\/\/([^\/]+)/.exec(url) || [])[1] || '';
    if (!info.source) info.source = host.replace(/^www\./, '');
    info.about = meta('og:site_name') ? '' : host;
  }
  if (!info.title) info.title = url;
  info.summary = RssCore.toPlainText(info.summary).slice(0, 300);
  return info;
}

/** 比べる用のドメイン（www.itmedia.co.jp と rss.itmedia.co.jp → itmedia.co.jp）。 */
function domain_(u) {
  var host = ((/^https?:\/\/([^\/:]+)/.exec(String(u)) || [])[1] || '').toLowerCase().split('.');
  var n = /^(co|or|ne|go|ac|ed|gr|lg)$/.test(host[host.length - 2] || '') ? 3 : 2;
  return host.slice(-n).join('.');
}

function decode_(s) {
  return String(s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}
function absUrl_(href, base) {
  if (/^https?:/.test(href)) return href;
  var origin = (/^(https?:\/\/[^\/]+)/.exec(base) || [])[1] || '';
  return href.charAt(0) === '/' ? origin + href : origin + '/' + href;
}

/** 記事シートに入れる（すでにあれば 興味5・重要5 の印を付け直す）。 */
function pinArticle_(info) {
  var sh = Store.sheet(SHEETS.ARTICLES);
  var c = articleCols_();
  var id = RssCore.makeId(info.url);
  var now = new Date();
  if (sh.getLastRow() >= 2) {
    var ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) !== id) continue;
      var row = i + 2;
      sh.getRange(row, c['興味度'] + 1, 1, 3).setValues([[PIN_WEIGHT, PIN_WEIGHT, '完了']]);
      sh.getRange(row, c['評価日時'] + 1, 1, 2).setValues([[now, '手で追加']]);
      return { existed: true };
    }
  }
  var k = Classify.byKeywords({ title: info.title, summary: info.summary, author: info.author, source: info.source }, Store.keywords(), 0);
  var pub = info.published ? new Date(info.published) : '';
  if (pub && isNaN(pub.getTime())) pub = '';
  var values = HEADERS.ARTICLES.map(function (h) {
    return {
      'ID': id, '取得日時': now, '公開日時': pub, 'ソース': info.source, 'タイトル': info.title, 'URL': info.url,
      '概要': info.summary, 'タグ': k.tags.join(', '), '関連度': Math.max(k.score, PIN_WEIGHT), 'AI要約': '',
      '興味度': PIN_WEIGHT, '重要度': PIN_WEIGHT, 'ステータス': '完了', '画像': info.image,
      '当たった興味ワード': k.words.join('・'), '書き手': info.author, '評価日時': now, '追加元': '手で追加'
    }[h];
  }).map(function (v) { return v === undefined ? '' : v; });
  sh.getRange(sh.getLastRow() + 1, 1, 1, values.length).setValues([values]);
  return { existed: false };
}

/** 興味キーワードに注目の人・媒体を足す。すでにあれば重みを PIN_WEIGHT 以上にする。足したら true。 */
function addFocusKeyword_(name, tag) {
  name = String(name).trim();
  if (!name || name.length < 2) return false;
  var sh = Store.sheet(SHEETS.KEYWORDS);
  var hit = -1, weight = 0;
  if (sh.getLastRow() >= 2) {
    var rows = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
    for (var i = 0; i < rows.length; i++) if (String(rows[i][0]) === name) { hit = i + 2; weight = Number(rows[i][1]) || 0; break; }
  }
  if (hit === -1) { sh.appendRow([name, PIN_WEIGHT, tag, '手で追加']); return true; }
  if (weight < PIN_WEIGHT) sh.getRange(hit, 2).setValue(PIN_WEIGHT);
  return false;
}

/** フィードに無ければ足す（取得しないサイトは足さない）。足したら true。 */
function addFeedIfNew_(name, url, category, intro) {
  var blocked = String(Store.settings()['取得しないサイト'] || '').split(',').map(function (x) { return x.trim(); }).filter(String);
  if (blocked.some(function (b) { return url.indexOf(b) !== -1; })) return false;
  var sh = Store.sheet(SHEETS.FEEDS);
  var c = HEADERS.FEEDS;
  if (sh.getLastRow() >= 2) {
    var urls = sh.getRange(2, c.indexOf('URL') + 1, sh.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < urls.length; i++) if (String(urls[i][0]).trim() === url) return false;
  }
  sh.appendRow([true, name, url, category, PIN_WEIGHT, '', '', intro || '']);
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
  var book = sh.getParent();
  var keep = {};
  var all = readArticles_(book);
  var locked = {};
  applyLocks_(all, settings);
  all.forEach(function (a) { if (a.locked) locked[a.id] = true; });
  applyAuthorFlags_(all, authorStats_(all, readAuthorSheet_(book))).forEach(function (a) { keep[a.id] = true; });
  var top = sh.getRange(2, 1, sh.getLastRow() - 1, HEADERS.ARTICLES.length).getValues()
    .filter(function (r) {
      if (!keep[String(r[c['ID']])]) return false;  // ミュート・量を絞る を当てる
      var got = r[c['取得日時']];
      var pub = r[c['公開日時']] instanceof Date ? r[c['公開日時']].getTime() : 0;
      if (isStale_(freshKind_(String(r[c['タイトル']] || ''), String(r[c['ソース']] || '')), pub)) return false;
      return (r[c['ステータス']] === '未読' || r[c['ステータス']] === '') && got instanceof Date && got.getTime() >= since;
    })
    // 🔒（会員限定・読めない）は読める記事の下へ
    .sort(function (a, b) {
      return ((locked[String(a[c['ID']])] ? 1 : 0) - (locked[String(b[c['ID']])] ? 1 : 0)) || (Number(b[c['関連度']]) || 0) - (Number(a[c['関連度']]) || 0);
    })
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
    var lk = locked[String(r[c['ID']])] ? '🔒 ' : '';
    html.push('<li style="margin-bottom:10px">' + lk + '<a href="' + esc(r[c['URL']]) + '">' + esc(r[c['タイトル']]) + '</a><br>' +
      '<span style="color:#666;font-size:12px">' + esc(r[c['ソース']]) + '・' + esc(r[c['当たった興味ワード']] || r[c['タグ']] || '興味ワードなし') + '</span></li>');
    text.push('・' + lk + r[c['タイトル']] + '\n  ' + r[c['URL']]);
  });
  html.push('</ol>');
  if (url) {
    html.push('<p><a href="' + esc(url) + '">スマホの画面で読んで評価する</a></p>');
    text.push('', 'スマホの画面: ' + url);
  }
  html.push('</div>');
  MailApp.sendEmail({ to: to, subject: 'RSS学習ログ 今朝の' + top.length + '件', body: text.join('\n'), htmlBody: html.join('') });
}
