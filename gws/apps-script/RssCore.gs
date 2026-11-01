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
    if (rootName === 'feed') {
      entries = kids_(root, 'entry');
    } else if (rootName === 'rss') {
      var channel = kids_(root, 'channel')[0];
      entries = channel ? kids_(channel, 'item') : [];
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
        image: image_(e, group, desc)
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
