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

  (function setupRsvpEditor() {
    var editor = document.getElementById('rsvp-editor');
    if (!editor) return;
    var form = document.getElementById('rsvp-editor-form');
    var statusInput = document.getElementById('rsvp-editor-status');
    var partyInput = document.getElementById('rsvp-editor-party');
    var nameEl = document.getElementById('rsvp-editor-name');
    var cancelBtn = document.getElementById('rsvp-editor-cancel');
    var openBtn = null;
    var editLabels = { yes: 'Yes', no: 'No', maybe: 'Maybe' };

    function setChoice(choice) {
      if (statusInput) statusInput.value = choice || '';
      ['yes', 'no', 'maybe'].forEach(function (c) {
        var btn = editor.querySelector('[data-rsvp-edit="' + c + '"]');
        if (!btn) return;
        var on = choice === c;
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        btn.textContent = on ? ('✓ ' + editLabels[c]) : editLabels[c];
      });
      if (partyInput) {
        partyInput.disabled = choice !== 'yes';
      }
    }

    function focusables() {
      return Array.prototype.slice.call(
        editor.querySelectorAll('button, [href], input, select, textarea')
      ).filter(function (el) { return !el.disabled && !el.hidden; });
    }

    function place() {
      if (!openBtn) return;
      var rect = openBtn.getBoundingClientRect();
      var margin = 8;
      var vw = window.innerWidth;
      var vh = window.innerHeight;
      var ew = Math.min(editor.offsetWidth || 328, vw - 16);
      var eh = editor.offsetHeight;
      var left = rect.left;
      if (left + ew > vw - margin) left = vw - ew - margin;
      if (left < margin) left = margin;
      var top = rect.bottom + margin;
      if (top + eh > vh - margin && rect.top - margin - eh >= margin) {
        top = rect.top - margin - eh;
      }
      if (top + eh > vh - margin) top = Math.max(margin, vh - eh - margin);
      if (top < margin) top = margin;
      editor.style.left = left + 'px';
      editor.style.top = top + 'px';
    }

    function closeEditor() {
      if (editor.hidden) return;
      editor.hidden = true;
      if (openBtn) {
        openBtn.setAttribute('aria-expanded', 'false');
        openBtn.focus();
      }
      openBtn = null;
    }

    function openEditor(btn) {
      openBtn = btn;
      document.querySelectorAll('.rsvp-cell-btn').forEach(function (b) {
        b.setAttribute('aria-expanded', b === btn ? 'true' : 'false');
      });
      form.action = '/dashboard/rsvp/' + btn.getAttribute('data-player-id');
      if (nameEl) nameEl.textContent = btn.getAttribute('data-player-name') || 'this player';
      var status = btn.getAttribute('data-status') || '';
      var party = btn.getAttribute('data-party-size') || '1';
      if (partyInput) {
        partyInput.disabled = false;
        partyInput.value = party;
      }
      setChoice(status);
      editor.hidden = false;
      place();
      var start = editor.querySelector('[data-rsvp-edit="' + (status || 'yes') + '"]') || focusables()[0];
      if (start) start.focus();
    }

    document.querySelectorAll('.rsvp-cell-btn').forEach(function (btn) {
      btn.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        if (openBtn === btn && !editor.hidden) closeEditor();
        else openEditor(btn);
      });
    });

    editor.querySelectorAll('[data-rsvp-edit]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setChoice(btn.getAttribute('data-rsvp-edit'));
        if (partyInput && !partyInput.disabled) partyInput.focus();
      });
    });

    if (cancelBtn) cancelBtn.addEventListener('click', closeEditor);

    form.addEventListener('submit', function (ev) {
      var status = statusInput && statusInput.value;
      if (!status) {
        ev.preventDefault();
        toast('Choose Yes, No, or Maybe');
        return;
      }
      if (partyInput) partyInput.disabled = false;
    });

    document.addEventListener('keydown', function (ev) {
      if (editor.hidden) return;
      if (ev.key === 'Escape') {
        ev.preventDefault();
        closeEditor();
        return;
      }
      if (ev.key !== 'Tab') return;
      var list = focusables();
      if (!list.length) return;
      var first = list[0];
      var last = list[list.length - 1];
      if (ev.shiftKey && document.activeElement === first) {
        ev.preventDefault();
        last.focus();
      } else if (!ev.shiftKey && document.activeElement === last) {
        ev.preventDefault();
        first.focus();
      }
    });

    document.addEventListener('pointerdown', function (ev) {
      if (editor.hidden) return;
      if (editor.contains(ev.target)) return;
      if (openBtn && openBtn.contains(ev.target)) return;
      closeEditor();
    });

    window.addEventListener('resize', function () {
      if (!editor.hidden) place();
    });
    window.addEventListener('scroll', function () {
      if (!editor.hidden) place();
    }, true);
  })();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', restoreScroll);
  } else {
    restoreScroll();
  }
  window.addEventListener('pageshow', function (ev) {
    if (ev.persisted) restoreScroll();
  });
})();
