(function () {
  'use strict';

  var LABELS = { yes: 'Yes', no: 'No', maybe: 'Maybe' };

  function setPressed(choice) {
    var hidden = document.getElementById('rsvp-status');
    if (hidden) hidden.value = choice || '';
    var guests = document.getElementById('rsvp-guests');
    ['yes', 'no', 'maybe'].forEach(function (c) {
      var btn = document.querySelector('[data-rsvp="' + c + '"]');
      if (!btn) return;
      var on = choice === c;
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.textContent = on ? ('✓ ' + LABELS[c] + ' · Selected') : LABELS[c];
    });
    if (guests) {
      if (choice !== 'yes') {
        guests.value = '1';
        guests.disabled = true;
      } else {
        guests.disabled = false;
      }
    }
  }

  var form = document.getElementById('rsvp-form');
  if (form) {
    var initial = (document.getElementById('rsvp-status') || {}).value || '';
    setPressed(initial || null);
    document.querySelectorAll('[data-rsvp]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setPressed(btn.getAttribute('data-rsvp'));
      });
    });
    form.addEventListener('submit', function (ev) {
      var status = (document.getElementById('rsvp-status') || {}).value;
      if (!status) {
        ev.preventDefault();
        toast('Choose Yes, No, or Maybe');
        return;
      }
      var guests = document.getElementById('rsvp-guests');
      if (guests) guests.disabled = false;
    });
  }

  function toast(msg) {
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.remove('show'); }, 2800);
  }

  var flash = document.querySelector('.flash-ok, .flash-error, .flash-info');
  if (flash) toast(flash.textContent);

  var SCROLL_KEY = 'poker-group-scroll';

  function scrollToHash() {
    if (!location.hash || location.hash.length < 2) return false;
    var el = document.getElementById(location.hash.slice(1));
    if (!el) return false;
    el.scrollIntoView({ block: 'start', behavior: 'auto', inline: 'nearest' });
    if (typeof el.focus === 'function') {
      try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
    }
    var focusable = el.querySelector('input, select, textarea, button');
    if (focusable && document.activeElement === el) {
      try { focusable.focus({ preventScroll: true }); } catch (e) { focusable.focus(); }
    }
    return true;
  }

  function restoreScroll() {
    if (scrollToHash()) {
      try { sessionStorage.removeItem(SCROLL_KEY); } catch (e) {}
      return;
    }
    var saved;
    try { saved = JSON.parse(sessionStorage.getItem(SCROLL_KEY) || 'null'); } catch (e) { saved = null; }
    if (!saved || !saved.path || saved.path !== location.pathname) return;
    if (Date.now() - (saved.t || 0) > 60000) {
      try { sessionStorage.removeItem(SCROLL_KEY); } catch (e) {}
      return;
    }
    var y = Number(saved.y);
    if (!isFinite(y)) return;
    window.scrollTo(0, y);
    try { sessionStorage.removeItem(SCROLL_KEY); } catch (e) {}
  }

  function saveScrollForPath(pathname) {
    try {
      sessionStorage.setItem(SCROLL_KEY, JSON.stringify({
        path: pathname,
        y: window.scrollY || window.pageYOffset || 0,
        t: Date.now()
      }));
    } catch (e) {}
  }

  document.querySelectorAll('form').forEach(function (f) {
    f.addEventListener('submit', function () {
      var action = f.getAttribute('action') || location.pathname;
      var dest = location.pathname;
      try {
        dest = new URL(action, location.href).pathname;
        // Most posts redirect back to the current page (or a parent like /players).
        if (dest === location.pathname || dest.indexOf(location.pathname) === 0 || location.pathname.indexOf(dest) === 0) {
          dest = dest === location.pathname ? location.pathname : (dest.indexOf(location.pathname) === 0 ? location.pathname : dest);
        }
      } catch (e) {}
      // Prefer the current page: calendar and settings posts stay on the same path.
      if (dest.indexOf('/calendar') === 0) dest = '/calendar';
      else if (dest.indexOf('/players') === 0) dest = '/players';
      else if (dest.indexOf('/settings') === 0) dest = '/settings';
      else if (dest.indexOf('/announce') === 0) dest = '/announce';
      else if (dest.indexOf('/dashboard') === 0) dest = '/';
      else if (dest.indexOf('/rsvp/') === 0) dest = location.pathname;
      else if (dest !== location.pathname && dest !== '/login' && dest !== '/logout') {
        // keep dest
      } else {
        dest = location.pathname;
      }
      if (dest === '/login' || dest === '/logout' || dest.indexOf('/setup/') === 0) return;
      saveScrollForPath(dest);
    });
  });

  document.querySelectorAll('[data-copy]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var text = btn.getAttribute('data-copy') || '';
      var label = btn.getAttribute('data-copy-label') || btn.textContent || 'Copy';
      if (!text) return;
      function done() {
        toast('Copied');
        btn.textContent = 'Copied';
        clearTimeout(btn._t);
        btn._t = setTimeout(function () { btn.textContent = label; }, 1800);
      }
      function fallback() {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); done(); } catch (e) { toast(text); }
        document.body.removeChild(ta);
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(fallback);
      } else {
        fallback();
      }
    });
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', restoreScroll);
  } else {
    restoreScroll();
  }
  window.addEventListener('pageshow', function (ev) {
    if (ev.persisted) restoreScroll();
  });
})();
