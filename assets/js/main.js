/* ── Configuration ───────────────────────────────────────── */
var SHARE_URL  = 'https://1drv.ms/f/c/753cbab9de4f01b4/IgA0lMh6_4xeTKD4BOpLF1fUAULxtA4SPcECipRoj-ND88g';
var GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

/* ── Helpers ─────────────────────────────────────────────── */

/** Encode a sharing URL to a Graph API share ID. */
function encodeShareId(url) {
  var b64 = btoa(url).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return 'u!' + b64;
}

/** HTML-escape a string to prevent XSS. */
function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Parse a filename that contains a language tag and a known extension.
 * Returns { base: 'Document name', lang: 'DE' } or null if not recognised.
 * @param {string} filename
 * @param {string} ext  - Extension without dot, e.g. 'pdf' or 'txt'
 */
function parseFileName(filename, ext) {
  var re = new RegExp('^(.+)-(DE|FR|IT)\\.' + ext + '$', 'i');
  var m  = filename.match(re);
  if (!m) return null;
  return { base: m[1], lang: m[2].toUpperCase() };
}

/**
 * Fetch the raw text of a file from a direct download URL and extract
 * the first line that looks like an http(s) URL.
 * Returns a Promise<string|null>.
 */
function fetchExternalUrl(downloadUrl) {
  return fetch(downloadUrl)
    .then(function (resp) {
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      return resp.text();
    })
    .then(function (text) {
      var lines = text.split(/\r?\n/);
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (/^https?:\/\/.+/.test(line)) return line;
      }
      return null;
    });
}

/* ── OneDrive / Graph API ────────────────────────────────── */

/**
 * Fetch JSON from the Graph shares API.
 * @param {string} shareId - Encoded share ID (u!…)
 * @param {string} path    - API sub-path, e.g. '/root/children'
 */
function fetchShare(shareId, path) {
  var url = GRAPH_BASE + '/shares/' + shareId + path;
  return fetch(url).then(function (resp) {
    if (!resp.ok) {
      return resp.json().catch(function () { return {}; }).then(function (body) {
        var msg = (body.error && body.error.message) ? body.error.message : ('HTTP ' + resp.status);
        throw new Error(msg);
      });
    }
    return resp.json();
  });
}

/**
 * Load all subfolder names and their documents (PDFs and external-link placeholders)
 * from the OneDrive share.
 * Returns a Promise that resolves to an array of section objects:
 *   [ { name: 'Folder', docs: { 'DocName': { DE: {type,url}, FR: {type,url}, IT: {type,url} } } }, … ]
 *
 * Each version object has:
 *   { type: 'pdf',      url: '<download URL>' }
 *   { type: 'external', url: '<external URL extracted from .txt file>' }
 */
function loadDocuments() {
  var shareId = encodeShareId(SHARE_URL);

  return fetchShare(shareId, '/root/children').then(function (rootData) {
    var folders = (rootData.value || []).filter(function (item) {
      return item.folder;
    });
    folders.sort(function (a, b) {
      return a.name.localeCompare(b.name);
    });

    var promises = folders.map(function (folder) {
      var encodedName = encodeURIComponent(folder.name);
      return fetchShare(shareId, '/root:/' + encodedName + ':/children')
        .then(function (folderData) {
          var docs = {};
          var txtPromises = [];

          (folderData.value || []).forEach(function (item) {
            if (!item.file) return;

            if (/\.pdf$/i.test(item.name)) {
              var parsed = parseFileName(item.name, 'pdf');
              if (!parsed) return;
              if (!docs[parsed.base]) docs[parsed.base] = {};
              docs[parsed.base][parsed.lang] = {
                type: 'pdf',
                url:  item['@microsoft.graph.downloadUrl'] || item.webUrl || null
              };

            } else if (/\.txt$/i.test(item.name)) {
              var parsed = parseFileName(item.name, 'txt');
              if (!parsed) return;
              var dlUrl = item['@microsoft.graph.downloadUrl'] || null;
              if (!dlUrl) return;

              /* Capture loop variables for the async closure */
              (function (base, lang, downloadUrl) {
                txtPromises.push(
                  fetchExternalUrl(downloadUrl).then(function (externalUrl) {
                    if (!externalUrl) return;
                    if (!docs[base]) docs[base] = {};
                    docs[base][lang] = { type: 'external', url: externalUrl };
                  }).catch(function () { /* skip unreadable files */ })
                );
              }(parsed.base, parsed.lang, dlUrl));
            }
          });

          return Promise.all(txtPromises).then(function () {
            return { name: folder.name, docs: docs };
          });
        })
        .catch(function () {
          /* Skip folders that cannot be read */
          return null;
        });
    });

    return Promise.all(promises).then(function (sections) {
      return sections.filter(function (s) {
        return s && Object.keys(s.docs).length > 0;
      });
    });
  });
}

/* ── Rendering ───────────────────────────────────────────── */

/** Show the loading spinner. */
function showLoading() {
  document.getElementById('docsContainer').innerHTML =
    '<div class="state-message">' +
    '<span class="spinner-border spinner-border-sm text-secondary me-2" role="status" aria-hidden="true"></span>' +
    '<span>' + esc(tr('loading')) + '</span>' +
    '</div>';
}

/** Show an error state with a fallback link to the OneDrive share. */
function showError() {
  document.getElementById('docsContainer').innerHTML =
    '<div class="state-message is-error">' +
    '<i class="fa-solid fa-circle-exclamation me-2"></i>' +
    esc(tr('errorLoading')) +
    '<div class="mt-2 small">' + esc(tr('errorDetails')) + ' ' +
    '<a href="' + esc(SHARE_URL) + '" target="_blank" rel="noopener">OneDrive</a>' +
    '</div>' +
    '</div>';
}

/**
 * Build one language cell for the given version.
 * @param {string}      langKey  - 'de', 'fr', or 'it'
 * @param {{type:string,url:string}|null} version
 */
function renderLangCell(langKey, version) {
  var cls = 'lang-col-' + langKey.toLowerCase();
  if (version && version.url) {
    if (version.type === 'pdf') {
      return '<td class="' + cls + ' lang-cell">' +
        '<a href="' + esc(version.url) + '" class="action-link" target="_blank" rel="noopener">' +
        '<i class="fa-solid fa-file-pdf action-icon-mobile" aria-hidden="true"></i>' +
        '<span class="action-text-desktop">PDF</span>' +
        '</a></td>';
    }
    /* type === 'external' */
    return '<td class="' + cls + ' lang-cell">' +
      '<a href="' + esc(version.url) + '" class="action-link action-link-external" target="_blank" rel="noopener">' +
      '<i class="fa-solid fa-arrow-up-right-from-square action-icon-mobile" aria-hidden="true"></i>' +
      '<span class="action-text-desktop">Link</span>' +
      '</a></td>';
  }
  return '<td class="' + cls + ' lang-cell"><span class="doc-na">&mdash;</span></td>';
}

/** Render all sections into the container. */
function renderDocuments(sections) {
  var container = document.getElementById('docsContainer');

  if (!sections || sections.length === 0) {
    container.innerHTML =
      '<div class="state-message"><span class="text-muted">' + esc(tr('noDocuments')) + '</span></div>';
    return;
  }

  var html = '';

  sections.forEach(function (section) {
    var docNames = Object.keys(section.docs).sort(function (a, b) {
      return a.localeCompare(b);
    });

    html += '<div class="doc-section">';
    html += '<div class="doc-section-title">' + esc(section.name) + '</div>';
    html += '<div class="table-card">';
    html += '<div class="table-scroll-wrapper">';
    html += '<table class="table t-table" role="table">';
    html += '<thead><tr>';
    html += '<th class="col-doc-name" data-i18n="colDocument">' + esc(tr('colDocument')) + '</th>';
    html += '<th class="lang-col-de lang-cell-header text-center">DE</th>';
    html += '<th class="lang-col-fr lang-cell-header text-center">FR</th>';
    html += '<th class="lang-col-it lang-cell-header text-center">IT</th>';
    html += '</tr></thead>';
    html += '<tbody>';

    docNames.forEach(function (baseName) {
      var versions = section.docs[baseName];
      var hasDE = versions['DE'] ? '1' : '0';
      var hasFR = versions['FR'] ? '1' : '0';
      var hasIT = versions['IT'] ? '1' : '0';

      html += '<tr data-has-de="' + hasDE + '" data-has-fr="' + hasFR + '" data-has-it="' + hasIT + '">';
      html += '<td class="doc-name">' + esc(baseName) + '</td>';
      html += renderLangCell('de', versions['DE'] || null);
      html += renderLangCell('fr', versions['FR'] || null);
      html += renderLangCell('it', versions['IT'] || null);
      html += '</tr>';
    });

    html += '</tbody></table>';
    html += '</div></div></div>';
  });

  container.innerHTML = html;
  updateRowVisibility(currentLang);
}

/* ── Language filtering ──────────────────────────────────── */

/**
 * On mobile the CSS hides irrelevant language columns already.
 * Additionally hide rows that have no document in the selected language
 * so the table does not show empty rows on mobile.
 */
function updateRowVisibility(lang) {
  var attr = 'data-has-' + lang.toLowerCase();
  document.querySelectorAll('#docsContainer tbody tr').forEach(function (row) {
    var hasDoc = row.getAttribute(attr) === '1';
    row.classList.toggle('row-no-active-lang', !hasDoc);
  });
}

/* ── Initialisation ──────────────────────────────────────── */

$(function () {
  showLoading();

  loadDocuments()
    .then(renderDocuments)
    .catch(function (err) {
      console.error('[Documents] Failed to load:', err);
      showError();
    });

  document.addEventListener('langChanged', function (e) {
    updateRowVisibility(e.detail.lang);
  });
});
