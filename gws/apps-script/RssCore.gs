/**
 * RssCore.gs — RSS / Atom / RDF を取得して共通形式に揃える部品。
 *
 * シートにも AI にも依存しない。SNS自動管理ダッシュボードなど別のプロジェクトでも、
 * このファイルだけをコピー（または Apps Script ライブラリとして追加）すれば使える。
 *
 *   const items = RssCore.fetchFeed('https://note.com/fladdict/rss', { source: '深津貴之' });
 *   // => [{ id, source, title, link, published, author, summary, image }]
 *
 * 外部サービスは UrlFetchApp だけ（Workspace の定額枠内。Business Standard は 1日10万回）。
 */
var RssCore = (function () {
  var ATOM_NS = 'http://www.w3.org/2005/Atom';
  var RSS1_NS = 'http://purl.org/rss/1.0/';
  var DC_NS = 'http://purl.org/dc/elements/1.1/';
  var CONTENT_NS = 'http://purl.org/rss/1.0/modules/content/';
  var MEDIA_NS = 'http://search.yahoo.com/mrss/';

  /** 1つのフィードを取得して記事の配列を返す。失敗したら例外。 */
  function fetchFeed(url, opts) {
    opts = opts || {};
    var res = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      followRedirects: true,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RssLearningLog/1.0; +Google Apps Script)' }
    });
    var code = res.getResponseCode();
    if (code >= 400) throw new Error('HTTP ' + code + ' ' + url);
    return parseFeed(res.getContentText(), {
      source: opts.source || url,
      limit: opts.limit || 20
    });
  }

  /** 複数フィードをまとめて取得する。1件の失敗で全体を止めない。 */
  function fetchFeeds(feeds, opts) {
    opts = opts || {};
    var requests = feeds.map(function (f) {
      return {
        url: f.url,
        muteHttpExceptions: true,
        followRedirects: true,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RssLearningLog/1.0; +Google Apps Script)' }
      };
    });
    var responses;
    try {
      responses = UrlFetchApp.fetchAll(requests);
    } catch (e) {
      // fetchAll は1件でも名前解決に失敗すると全体が例外になるので、1件ずつに切り替える。
      responses = null;
    }
    return feeds.map(function (f, i) {
      try {
        if (responses) {
          var code = responses[i].getResponseCode();
          if (code >= 400) throw new Error('HTTP ' + code);
          return { feed: f, items: parseFeed(responses[i].getContentText(), { source: f.name || f.url, limit: opts.limit || 20 }), error: '' };
        }
        return { feed: f, items: fetchFeed(f.url, { source: f.name || f.url, limit: opts.limit }), error: '' };
      } catch (e) {
        return { feed: f, items: [], error: String(e && e.message || e) };
      }
    });
  }

  /** XML 文字列を解析する。RSS 2.0 / Atom 1.0 / RSS 1.0(RDF) に対応。 */
  function parseFeed(xmlText, opts) {
    opts = opts || {};
    var source = opts.source || '';
    var limit = opts.limit || 20;
    var root = XmlService.parse(stripBadChars_(xmlText)).getRootElement();
    var name = root.getName();
    var entries;

    if (name === 'feed') {
      entries = root.getChildren('entry', XmlService.getNamespace(ATOM_NS)).map(atomEntry_);
    } else if (name === 'rss') {
      var channel = root.getChild('channel');
      entries = channel ? channel.getChildren('item').map(rss2Item_) : [];
    } else if (name === 'RDF') {
      entries = root.getChildren('item', XmlService.getNamespace(RSS1_NS)).map(rss1Item_);
    } else {
      throw new Error('対応していない形式です: <' + name + '>');
    }

    return entries.slice(0, limit).filter(function (e) { return e.link; }).map(function (e) {
      e.source = source;
      e.id = makeId(e.link);
      e.summary = toPlainText(e.summary).slice(0, 500);
      return e;
    });
  }

  function rss2Item_(item) {
    var dc = XmlService.getNamespace(DC_NS);
    var content = XmlService.getNamespace(CONTENT_NS);
    var desc = text_(item, 'description') || text_(item, 'encoded', content);
    return {
      title: toPlainText(text_(item, 'title')),
      link: text_(item, 'link') || text_(item, 'guid'),
      published: toDate_(text_(item, 'pubDate') || text_(item, 'date', dc)),
      author: text_(item, 'creator', dc) || text_(item, 'author'),
      summary: desc,
      image: imageOf_(item, desc)
    };
  }

  function rss1Item_(item) {
    var ns = XmlService.getNamespace(RSS1_NS);
    var dc = XmlService.getNamespace(DC_NS);
    var content = XmlService.getNamespace(CONTENT_NS);
    var desc = text_(item, 'description', ns) || text_(item, 'encoded', content);
    return {
      title: toPlainText(text_(item, 'title', ns)),
      link: text_(item, 'link', ns),
      published: toDate_(text_(item, 'date', dc)),
      author: text_(item, 'creator', dc),
      summary: desc,
      image: imageOf_(item, desc)
    };
  }

  function atomEntry_(entry) {
    var ns = XmlService.getNamespace(ATOM_NS);
    var media = XmlService.getNamespace(MEDIA_NS);
    var link = '';
    entry.getChildren('link', ns).forEach(function (l) {
      var rel = l.getAttribute('rel');
      if (!link && (!rel || rel.getValue() === 'alternate')) link = attr_(l, 'href');
    });
    var author = entry.getChild('author', ns);
    // YouTube のチャンネルRSSは説明文が media:group の中にある。
    var group = entry.getChild('group', media);
    var desc = text_(entry, 'summary', ns) || text_(entry, 'content', ns) ||
      (group ? text_(group, 'description', media) : '');
    var thumb = group ? group.getChild('thumbnail', media) : null;
    return {
      title: toPlainText(text_(entry, 'title', ns)),
      link: link,
      published: toDate_(text_(entry, 'published', ns) || text_(entry, 'updated', ns)),
      author: author ? text_(author, 'name', ns) : '',
      summary: desc,
      image: thumb ? attr_(thumb, 'url') : imageOf_(entry, desc)
    };
  }

  function imageOf_(el, html) {
    var media = XmlService.getNamespace(MEDIA_NS);
    var thumb = el.getChild('thumbnail', media) || el.getChild('content', media);
    if (thumb && attr_(thumb, 'url')) return attr_(thumb, 'url');
    var enc = el.getChild('enclosure');
    if (enc && /^image\//.test(attr_(enc, 'type'))) return attr_(enc, 'url');
    var m = /<img[^>]+src=["']([^"']+)["']/i.exec(html || '');
    return m ? m[1] : '';
  }

  function text_(el, name, ns) {
    var c = ns ? el.getChild(name, ns) : el.getChild(name);
    return c ? c.getText().trim() : '';
  }

  function attr_(el, name) {
    var a = el.getAttribute(name);
    return a ? a.getValue() : '';
  }

  function toDate_(s) {
    if (!s) return null;
    var d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  /** HTML を取り除いて1行のテキストにする。 */
  function toPlainText(s) {
    return String(s || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** 重複判定用のID。URL の末尾スラッシュや utm_* の違いを吸収する。 */
  function makeId(link) {
    var normalized = String(link).trim()
      .replace(/[?&]utm_[^&#]*/g, '')
      .replace(/[?&]$/, '')
      .replace(/\/$/, '');
    var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, normalized, Utilities.Charset.UTF_8);
    return bytes.map(function (b) { return ((b + 256) % 256).toString(16).padStart(2, '0'); }).join('').slice(0, 16);
  }

  // XmlService は制御文字が混ざると解析に失敗するので取り除く。
  function stripBadChars_(s) {
    return String(s).replace(/^﻿/, '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  }

  return {
    fetchFeed: fetchFeed,
    fetchFeeds: fetchFeeds,
    parseFeed: parseFeed,
    toPlainText: toPlainText,
    makeId: makeId
  };
})();
