// Apps Script の最小限のモック。Node で .gs を読み込んで動作確認するためのもの。
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { DOMParser } = require('@xmldom/xmldom');

function wrapEl(node) {
  const kids = (name, ns) => Array.from(node.childNodes).filter((c) =>
    c.nodeType === 1 && c.localName === name && (ns ? c.namespaceURI === ns.uri : !c.namespaceURI));
  return {
    getName: () => node.localName,
    getChild: (name, ns) => { const k = kids(name, ns)[0]; return k ? wrapEl(k) : null; },
    getChildren: (name, ns) => kids(name, ns).map(wrapEl),
    getText: () => node.textContent || '',
    getAttribute: (name) => node.hasAttribute(name) ? { getValue: () => node.getAttribute(name) } : null
  };
}

const XmlService = {
  parse(text) {
    const errors = [];
    const doc = new DOMParser({ errorHandler: { error: (e) => errors.push(e), fatalError: (e) => errors.push(e) } })
      .parseFromString(text, 'text/xml');
    if (errors.length || !doc.documentElement) throw new Error('XML parse error: ' + errors[0]);
    return { getRootElement: () => wrapEl(doc.documentElement) };
  },
  getNamespace: (uri) => ({ uri })
};

const Utilities = {
  DigestAlgorithm: { MD5: 'md5' },
  Charset: { UTF_8: 'utf8' },
  computeDigest: (alg, s) => Array.from(crypto.createHash(alg).update(s, 'utf8').digest()).map((b) => (b > 127 ? b - 256 : b)),
  sleep: () => {},
  parseCsv: (text) => parseCsv(text)
};

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') q = false;
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function makeSheet(name) {
  let data = [];
  const sheet = {
    name,
    data: () => data,
    getLastRow: () => data.length,
    getLastColumn: () => data.reduce((m, r) => Math.max(m, r.length), 0),
    setFrozenRows: () => {},
    appendRow: (row) => data.push(row.slice()),
    getRange: (r, c, nr = 1, nc = 1) => {
      const range = {
        getValues: () => Array.from({ length: nr }, (_, i) =>
          Array.from({ length: nc }, (_, j) => { const v = (data[r - 1 + i] || [])[c - 1 + j]; return v === undefined ? '' : v; })),
        setValues: (vals) => {
          vals.forEach((row, i) => { data[r - 1 + i] = data[r - 1 + i] || []; row.forEach((v, j) => { data[r - 1 + i][c - 1 + j] = v; }); });
          return range;
        },
        setValue: (v) => range.setValues([[v]]),
        setFontWeight: () => range,
        insertCheckboxes: () => range
      };
      return range;
    }
  };
  return sheet;
}

function loadGas(dir, { fetchMap = {}, properties = {} } = {}) {
  const sheets = {};
  const fetched = [];
  const response = (url) => {
    fetched.push(url);
    if (fetchMap[url] instanceof Function) return fetchMap[url]();
    if (fetchMap[url] === undefined) return { getResponseCode: () => 404, getContentText: () => '' };
    return { getResponseCode: () => 200, getContentText: () => fetchMap[url] };
  };
  const ctx = {
    console,
    XmlService,
    Utilities,
    UrlFetchApp: {
      fetch: (url, opts) => response(url, opts),
      fetchAll: (reqs) => reqs.map((r) => response(r.url, r))
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => properties[k] || null }) },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: (n) => sheets[n] || null,
        insertSheet: (n) => (sheets[n] = makeSheet(n))
      })
    }
  };
  vm.createContext(ctx);
  fs.readdirSync(dir).filter((f) => f.endsWith('.gs')).sort().forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f });
  });
  ctx.__sheets = sheets;
  ctx.__fetched = fetched;
  return ctx;
}

module.exports = { loadGas };
