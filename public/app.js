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
})();
