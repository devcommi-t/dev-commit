// Runs before first paint (no inline scripts are allowed by the site's Content-Security-Policy).
(function () {
  try {
    var d = document.documentElement, p = location.pathname, seen = sessionStorage.getItem('dcs');
    // First visit to the English home page by someone who prefers Arabic: send them to /ar/.
    if (p === '/' && d.hasAttribute('data-ar')) {
      var pref = null; try { pref = localStorage.getItem('dcl'); } catch (e) {}
      if (!pref) pref = /^ar/i.test(navigator.language || '') ? 'ar' : 'en';
      if (pref === 'ar') { location.replace('/ar/' + location.search + location.hash); return; }
    }
    if ((p === '/' || p === '/ar/') && !seen) d.classList.add('splash');
  } catch (e) {}
})();
