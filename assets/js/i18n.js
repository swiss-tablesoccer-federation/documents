/* ── Translations ────────────────────────────────────────── */
var TRANSLATIONS = {
  de: {
    pageTitle:              'Dokumente',
    loading:                'Laden\u2026',
    errorLoading:           'Dokumente konnten nicht geladen werden.',
    errorDetails:           'Die Dokumente sind direkt auf OneDrive verf\u00fcgbar:',
    noDocuments:            'Keine Dokumente vorhanden.',
    colDocument:            'Dokument',
    dataSource:             'Dokumente bereitgestellt \u00fcber'
  },
  fr: {
    pageTitle:              'Documents',
    loading:                'Chargement\u2026',
    errorLoading:           'Impossible de charger les documents.',
    errorDetails:           'Les documents sont disponibles directement sur OneDrive\u00a0:',
    noDocuments:            'Aucun document disponible.',
    colDocument:            'Document',
    dataSource:             'Documents disponibles via'
  },
  it: {
    pageTitle:              'Documenti',
    loading:                'Caricamento\u2026',
    errorLoading:           'Impossibile caricare i documenti.',
    errorDetails:           'I documenti sono disponibili direttamente su OneDrive:',
    noDocuments:            'Nessun documento disponibile.',
    colDocument:            'Documento',
    dataSource:             'Documenti disponibili tramite'
  }
};

/* ── Language state ──────────────────────────────────────── */
var SUPPORTED_LANGS = ['de', 'fr', 'it'];

var currentLang = (function () {
  var stored = typeof localStorage !== 'undefined' ? localStorage.getItem('stf_lang') : null;
  return (stored && SUPPORTED_LANGS.indexOf(stored) !== -1) ? stored : 'de';
}());

/**
 * Return the translation for key in the active language, substituting
 * any {placeholder} tokens with values from the optional params object.
 */
function tr(key, params) {
  var dict = TRANSLATIONS[currentLang] || TRANSLATIONS['de'];
  var str  = dict.hasOwnProperty(key) ? dict[key] : (TRANSLATIONS['de'][key] || key);
  if (params) {
    Object.keys(params).forEach(function (k) {
      var safeKey = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      str = str.replace(new RegExp('\\{' + safeKey + '\\}', 'g'), String(params[k]));
    });
  }
  return str;
}

/**
 * Walk the DOM and update elements carrying translation attributes:
 *   data-i18n             → textContent
 *   data-i18n-placeholder → placeholder attribute
 *   data-i18n-title       → title attribute
 *   data-i18n-aria-label  → aria-label attribute
 */
function applyTranslations() {
  document.querySelectorAll('[data-i18n]').forEach(function (el) {
    el.textContent = tr(el.getAttribute('data-i18n'));
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
    el.placeholder = tr(el.getAttribute('data-i18n-placeholder'));
  });
  document.querySelectorAll('[data-i18n-title]').forEach(function (el) {
    el.title = tr(el.getAttribute('data-i18n-title'));
  });
  document.querySelectorAll('[data-i18n-aria-label]').forEach(function (el) {
    el.setAttribute('aria-label', tr(el.getAttribute('data-i18n-aria-label')));
  });
}

/* ── Language selector initialisation ───────────────────── */
$(function () {
  /* Mark the currently active language button */
  $('#langSelector .lang-btn').each(function () {
    $(this).toggleClass('active', $(this).data('lang') === currentLang);
  });

  /* Language switch handler */
  $('#langSelector').on('click', '.lang-btn', function () {
    var lang = $(this).data('lang');
    if (!TRANSLATIONS[lang] || lang === currentLang) return;
    currentLang = lang;
    localStorage.setItem('stf_lang', lang);
    document.documentElement.lang = lang;
    $('#langSelector .lang-btn').removeClass('active');
    $(this).addClass('active');
    applyTranslations();
    document.dispatchEvent(new CustomEvent('langChanged', { detail: { lang: lang } }));
  });

  /* Set initial lang on html element */
  document.documentElement.lang = currentLang;

  /* Apply translations on initial page load */
  applyTranslations();
});
