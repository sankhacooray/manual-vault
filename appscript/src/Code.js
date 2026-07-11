/**
 * Manual Vault — scan a QR code on a paper manual, save the PDF into a
 * "Manual Vault" folder in the signed-in user's own Google Drive, and index
 * it with Claude for search.
 *
 * Permission model (deliberately narrow):
 *   - drive.file          → the app can only see/touch files and folders it
 *                           created itself. It cannot read, write or delete
 *                           anything else in the user's Drive.
 *   - script.external_request → needed to download the manual PDF and to call
 *                           the Claude API.
 *
 * The web app runs as USER_ACCESSING, so each user authorizes with their own
 * Google account and the vault folder lives in their own Drive.
 */

var FOLDER_NAME = 'Manual Vault';
var INDEX_FILE_NAME = 'manual-vault-index.json';
var CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
var CLAUDE_MODEL = 'claude-opus-4-8';
// Claude accepts PDFs up to 32MB / 100 pages; keep headroom for base64 + JSON.
var CLAUDE_MAX_PDF_BYTES = 22 * 1024 * 1024;

// ---------------------------------------------------------------- web entry

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Manual Vault')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ------------------------------------------------------------- client API

/** Initial payload for the home view. */
function getAppData() {
  var folder = findFolder_();
  return {
    email: Session.getActiveUser().getEmail(),
    hasApiKey: !!getApiKey_(),
    folderUrl: folder ? 'https://drive.google.com/drive/folders/' + folder.id : null,
    index: readIndex_(folder)
  };
}

function getIndex() {
  return readIndex_(findFolder_());
}

/** Stores the user's Anthropic API key in their own user properties. */
function saveApiKey(key) {
  key = String(key || '').trim();
  if (!key) {
    PropertiesService.getUserProperties().deleteProperty('ANTHROPIC_API_KEY');
    return { ok: true, hasApiKey: false };
  }
  if (!/^sk-ant-/.test(key)) {
    return { ok: false, reason: 'BAD_KEY_FORMAT' };
  }
  PropertiesService.getUserProperties().setProperty('ANTHROPIC_API_KEY', key);
  return { ok: true, hasApiKey: true };
}

/**
 * Step 1 of the scan flow: download the URL from the QR code and, if it is a
 * PDF, save it into the vault folder. Indexing happens in a separate call so
 * the client can show real progress.
 */
function saveFromUrl(url) {
  url = String(url || '').trim();
  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, reason: 'NOT_URL', detail: url };
  }

  var resp;
  try {
    resp = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      followRedirects: true,
      validateHttpsCertificates: true
    });
  } catch (e) {
    return { ok: false, reason: 'FETCH_FAILED', detail: String(e && e.message || e) };
  }
  if (resp.getResponseCode() >= 400) {
    return { ok: false, reason: 'HTTP_' + resp.getResponseCode(), detail: url };
  }

  var blob = resp.getBlob();
  var bytes = blob.getBytes();
  var pdfUrl = url;
  if (!looksLikePdf_(resp, bytes)) {
    // Manual QR codes often point at a product page rather than the PDF
    // itself — follow the first .pdf link found on that page.
    var pdfLink = findPdfLink_(resp.getContentText(), url);
    var pdfResp = null;
    if (pdfLink) {
      try {
        pdfResp = UrlFetchApp.fetch(pdfLink, {
          muteHttpExceptions: true,
          followRedirects: true,
          validateHttpsCertificates: true
        });
      } catch (e) {
        pdfResp = null;
      }
    }
    if (!pdfResp || pdfResp.getResponseCode() >= 400 || !looksLikePdf_(pdfResp, pdfResp.getContent())) {
      return { ok: false, reason: 'NOT_PDF', detail: url };
    }
    resp = pdfResp;
    blob = resp.getBlob();
    pdfUrl = pdfLink;
  }

  var folder = ensureFolder_();
  var index = readIndex_(folder);
  for (var i = 0; i < index.items.length; i++) {
    if (index.items[i].sourceUrl === url) {
      return { ok: true, duplicate: true, item: index.items[i], hasApiKey: !!getApiKey_() };
    }
  }

  var name = fileNameFor_(resp, pdfUrl);
  blob.setName(name);
  blob.setContentType('application/pdf');
  var file = Drive.Files.create(
    { name: name, parents: [folder.id], mimeType: 'application/pdf' },
    blob,
    { fields: 'id,name,webViewLink' }
  );

  var item = {
    id: file.id,
    name: file.name,
    webViewLink: file.webViewLink,
    sourceUrl: url,
    pdfUrl: pdfUrl,
    savedAt: new Date().toISOString(),
    indexed: false,
    title: name.replace(/\.pdf$/i, ''),
    brand: '',
    model: '',
    category: 'Uncategorized',
    tags: [],
    summary: ''
  };
  upsertIndexItem_(folder, item);
  return { ok: true, duplicate: false, item: item, hasApiKey: !!getApiKey_() };
}

/**
 * Step 2 of the scan flow (also usable to re-index later): send the saved PDF
 * to Claude, merge the returned metadata into the index and rename the Drive
 * file to a human-friendly title.
 */
function indexManual(fileId) {
  var apiKey = getApiKey_();
  if (!apiKey) return { ok: false, reason: 'NO_API_KEY' };

  var folder = ensureFolder_();
  var index = readIndex_(folder);
  var item = null;
  for (var i = 0; i < index.items.length; i++) {
    if (index.items[i].id === fileId) { item = index.items[i]; break; }
  }
  if (!item) return { ok: false, reason: 'NOT_FOUND' };

  var pdfBytes = null;
  try {
    pdfBytes = driveDownload_(fileId);
  } catch (e) {
    // fall through — Claude can still categorize from filename + source URL
  }

  var result = callClaude_(apiKey, pdfBytes, item, /* allowRetryWithoutPdf */ true);
  if (!result.ok) return result;

  var meta = result.meta;
  item.title = meta.title || item.title;
  item.brand = meta.brand || '';
  item.model = meta.model || '';
  item.category = meta.category || 'Uncategorized';
  item.tags = (meta.tags || []).map(function (t) { return String(t).toLowerCase(); });
  item.summary = meta.summary || '';
  item.indexed = true;
  item.indexedAt = new Date().toISOString();

  var niceName = buildFileName_(item);
  if (niceName && niceName !== item.name) {
    try {
      var updated = Drive.Files.update({ name: niceName }, fileId, null, { fields: 'id,name,webViewLink' });
      item.name = updated.name;
      item.webViewLink = updated.webViewLink || item.webViewLink;
    } catch (e) {
      // renaming is cosmetic; keep going
    }
  }

  upsertIndexItem_(folder, item);
  return { ok: true, item: item };
}

/** Moves an app-created manual to trash and removes it from the index. */
function removeManual(fileId) {
  var folder = findFolder_();
  if (!folder) return { ok: false, reason: 'NOT_FOUND' };
  try {
    Drive.Files.update({ trashed: true }, fileId);
  } catch (e) {
    // already gone from Drive — still remove from index
  }
  var index = readIndex_(folder);
  index.items = index.items.filter(function (it) { return it.id !== fileId; });
  writeIndex_(folder, index);
  return { ok: true, index: index };
}

// ---------------------------------------------------------------- Claude

function callClaude_(apiKey, pdfBytes, item, allowRetryWithoutPdf) {
  var schema = {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Short human-friendly document title, e.g. "Dyson V8 Vacuum User Manual"' },
      brand: { type: 'string', description: 'Manufacturer / brand name, empty string if unknown' },
      model: { type: 'string', description: 'Product model number or name, empty string if unknown' },
      category: {
        type: 'string',
        description: 'Single household category, e.g. Kitchen Appliances, Laundry, Climate & Heating, Audio & Video, Computers & Networking, Personal Care, Tools & Garden, Furniture, Toys & Games, Automotive, Other'
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: '5-12 lowercase search keywords: product type, brand, key features, common troubleshooting topics'
      },
      summary: { type: 'string', description: '1-2 sentence summary of what the product is and what the manual covers' }
    },
    required: ['title', 'brand', 'model', 'category', 'tags', 'summary'],
    additionalProperties: false
  };

  var content = [];
  var includedPdf = false;
  if (pdfBytes && pdfBytes.length > 0 && pdfBytes.length <= CLAUDE_MAX_PDF_BYTES) {
    content.push({
      type: 'document',
      source: {
        type: 'base64',
        media_type: 'application/pdf',
        data: Utilities.base64Encode(pdfBytes)
      }
    });
    includedPdf = true;
  }
  content.push({
    type: 'text',
    text: 'You are indexing a product user manual for a searchable home manual library.\n' +
      (includedPdf
        ? 'The manual PDF is attached.'
        : 'No PDF could be attached — infer what you can from the metadata below.') +
      '\nFile name: ' + item.name +
      '\nSource URL: ' + (item.sourceUrl || 'unknown') +
      '\nExtract the catalog metadata.'
  });

  var payload = {
    model: CLAUDE_MODEL,
    max_tokens: 2048,
    output_config: { format: { type: 'json_schema', schema: schema } },
    messages: [{ role: 'user', content: content }]
  };

  var resp;
  try {
    resp = UrlFetchApp.fetch(CLAUDE_API_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
  } catch (e) {
    return { ok: false, reason: 'CLAUDE_FETCH_FAILED', detail: String(e && e.message || e) };
  }

  var code = resp.getResponseCode();
  if (code !== 200) {
    // Oversized / >100-page PDFs come back as 400s — retry on metadata alone.
    if (includedPdf && allowRetryWithoutPdf) {
      return callClaude_(apiKey, null, item, false);
    }
    var detail = '';
    try { detail = JSON.parse(resp.getContentText()).error.message; } catch (e) { detail = String(code); }
    return { ok: false, reason: 'CLAUDE_HTTP_' + code, detail: detail };
  }

  var msg = JSON.parse(resp.getContentText());
  if (msg.stop_reason === 'refusal') {
    return { ok: false, reason: 'CLAUDE_REFUSAL' };
  }
  var text = null;
  for (var i = 0; i < (msg.content || []).length; i++) {
    if (msg.content[i].type === 'text') { text = msg.content[i].text; break; }
  }
  if (!text) return { ok: false, reason: 'CLAUDE_EMPTY' };
  try {
    return { ok: true, meta: JSON.parse(text) };
  } catch (e) {
    return { ok: false, reason: 'CLAUDE_BAD_JSON' };
  }
}

// ------------------------------------------------------------- Drive utils

function getApiKey_() {
  return PropertiesService.getUserProperties().getProperty('ANTHROPIC_API_KEY');
}

function findFolder_() {
  var res = Drive.Files.list({
    q: "name = '" + FOLDER_NAME + "' and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
    fields: 'files(id,name)',
    pageSize: 1
  });
  return (res.files && res.files.length) ? res.files[0] : null;
}

function ensureFolder_() {
  return findFolder_() || Drive.Files.create(
    { name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' },
    null,
    { fields: 'id,name' }
  );
}

function findIndexFile_(folderId) {
  var res = Drive.Files.list({
    q: "name = '" + INDEX_FILE_NAME + "' and '" + folderId + "' in parents and trashed = false",
    fields: 'files(id,name)',
    pageSize: 1
  });
  return (res.files && res.files.length) ? res.files[0] : null;
}

function driveDownload_(fileId) {
  var resp = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media', {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: false
  });
  return resp.getContent();
}

function emptyIndex_() {
  return { version: 0, updatedAt: null, items: [] };
}

function readIndex_(folder) {
  if (!folder) return emptyIndex_();
  var file = findIndexFile_(folder.id);
  if (!file) return emptyIndex_();
  try {
    var raw = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + file.id + '?alt=media', {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }
    }).getContentText();
    var parsed = JSON.parse(raw);
    if (parsed && parsed.items) return parsed;
  } catch (e) {
    // corrupted index — start fresh rather than crash
  }
  return emptyIndex_();
}

function writeIndex_(folder, index) {
  index.version = (index.version || 0) + 1;
  index.updatedAt = new Date().toISOString();
  var blob = Utilities.newBlob(JSON.stringify(index, null, 2), 'application/json', INDEX_FILE_NAME);
  var existing = findIndexFile_(folder.id);
  if (existing) {
    Drive.Files.update({}, existing.id, blob);
  } else {
    Drive.Files.create({ name: INDEX_FILE_NAME, parents: [folder.id], mimeType: 'application/json' }, blob);
  }
  return index;
}

function upsertIndexItem_(folder, item) {
  var lock = LockService.getUserLock();
  lock.waitLock(20000);
  try {
    var index = readIndex_(folder);
    var replaced = false;
    for (var i = 0; i < index.items.length; i++) {
      if (index.items[i].id === item.id) { index.items[i] = item; replaced = true; break; }
    }
    if (!replaced) index.items.push(item);
    writeIndex_(folder, index);
  } finally {
    lock.releaseLock();
  }
}

// -------------------------------------------------------------- misc utils

function findPdfLink_(html, baseUrl) {
  var m = String(html).match(/href\s*=\s*["']([^"']+\.pdf(?:\?[^"']*)?)["']/i);
  if (!m) return null;
  var link = m[1].replace(/&amp;/g, '&');
  if (/^https?:\/\//i.test(link)) return link;
  var originMatch = baseUrl.match(/^https?:\/\/[^\/]+/i);
  if (!originMatch) return null;
  if (link.charAt(0) === '/') return originMatch[0] + link;
  return baseUrl.replace(/[?#].*$/, '').replace(/[^\/]*$/, '') + link;
}

function looksLikePdf_(resp, bytes) {
  var headers = resp.getHeaders() || {};
  var ct = String(headers['Content-Type'] || headers['content-type'] || '');
  if (/application\/pdf/i.test(ct)) return true;
  // %PDF magic bytes
  return bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

function fileNameFor_(resp, url) {
  var headers = resp.getHeaders() || {};
  var cd = String(headers['Content-Disposition'] || headers['content-disposition'] || '');
  var m = cd.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i);
  var name = m ? decodeURIComponent(m[1].replace(/"/g, '')) : '';
  if (!name) {
    var path = url.split(/[?#]/)[0];
    name = decodeURIComponent(path.substring(path.lastIndexOf('/') + 1) || 'manual');
  }
  name = sanitizeName_(name);
  if (!/\.pdf$/i.test(name)) name += '.pdf';
  return name;
}

function buildFileName_(item) {
  var parts = [];
  if (item.brand) parts.push(item.brand);
  if (item.model) parts.push(item.model);
  var base = parts.join(' ');
  var title = item.title || '';
  if (title && title.toLowerCase().indexOf(base.toLowerCase()) === -1) {
    base = base ? base + ' - ' + title : title;
  } else if (title) {
    base = title;
  }
  base = sanitizeName_(base);
  return base ? base + '.pdf' : null;
}

function sanitizeName_(s) {
  return String(s).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 120);
}
