/* Shared behaviour for the public pages. Each part checks for its own markup. */
(function () {
  var root = document.documentElement;
  var scroller = document.body;

  // ------------------------------------------------------------ theme switch
  var themeBtn = document.querySelector('.theme-btn');
  var media = window.matchMedia('(prefers-color-scheme: dark)');
  function activeTheme() { return root.dataset.theme || (media.matches ? 'dark' : 'light'); }
  function labelTheme() {
    if (!themeBtn) return;
    var label = activeTheme() === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
    themeBtn.setAttribute('aria-label', label);
    themeBtn.title = label;
  }
  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      var next = activeTheme() === 'dark' ? 'light' : 'dark';
      root.dataset.theme = next;
      try { localStorage.setItem('sc-theme', next); } catch (e) {}
      labelTheme();
      document.dispatchEvent(new Event('themechange'));
    });
    media.addEventListener('change', function () { labelTheme(); document.dispatchEvent(new Event('themechange')); });
    labelTheme();
  }

  // ------------------------------------------- footer ⓘ: frosted full-screen note
  var infoBtn = document.querySelector('.info-btn');
  var note = document.getElementById('glass-note');
  if (infoBtn && note) {
    var timer = 0;
    var open = function (hover) {
      note.classList.add('open');
      note.classList.toggle('hovering', !!hover);
      infoBtn.setAttribute('aria-expanded', 'true');
    };
    var close = function () {
      clearTimeout(timer);
      note.classList.remove('open', 'hovering');
      infoBtn.setAttribute('aria-expanded', 'false');
    };
    infoBtn.addEventListener('pointerenter', function (e) {
      if (e.pointerType !== 'mouse') return;
      timer = setTimeout(function () { open(true); }, 400);
    });
    infoBtn.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') close(); });
    infoBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (note.classList.contains('open') && !note.classList.contains('hovering')) close(); else open(false);
    });
    note.addEventListener('click', close);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
  }

  // ------------------------------------- screen-fit groups + ↑/↓ paging (landing)
  var home = document.getElementById('home');
  var barWrap = document.querySelector('.bar-wrap');
  function barHeight() { return barWrap ? barWrap.offsetHeight : 0; }
  if (barWrap) {
    new ResizeObserver(function () { root.style.setProperty('--bar-h', barHeight() + 'px'); }).observe(barWrap);
  }

  if (home) {
    var groups = [].slice.call(home.querySelectorAll('.group'));

    var layout = function () {
      var avail = scroller.clientHeight - barHeight();
      var phone = window.innerWidth <= 760;
      groups.forEach(function (g) { g.style.minHeight = ''; });
      var heights = groups.map(function (g) { return g.getBoundingClientRect().height; });
      var screens = [];
      var cur = null;
      groups.forEach(function (g, i) {
        var solo = g.hasAttribute('data-solo') || (cur && cur.solo);
        if (cur && !solo && cur.sum + heights[i] <= avail + 1) {
          cur.items.push(i);
          cur.sum += heights[i];
        } else {
          cur = { items: [i], sum: heights[i], solo: g.hasAttribute('data-solo') };
          screens.push(cur);
        }
      });
      screens.forEach(function (sc) {
        var extra = phone ? 0 : Math.max(0, avail - sc.sum) / sc.items.length;
        sc.items.forEach(function (i, k) {
          if (!phone) groups[i].style.minHeight = (heights[i] + extra) + 'px';
          groups[i].classList.toggle('screen', k === 0);
        });
      });
      markCurrent();
    };
    var raf = 0;
    var relayout = function () { cancelAnimationFrame(raf); raf = requestAnimationFrame(layout); };
    new ResizeObserver(relayout).observe(scroller);
    if (document.fonts) document.fonts.ready.then(relayout);
    window.addEventListener('load', relayout);

    var target = null;
    scroller.addEventListener('scrollend', function () { target = null; });
    var stops = function () {
      return [].slice.call(home.querySelectorAll('.screen')).map(function (s) {
        return Math.round(s.getBoundingClientRect().top + scroller.scrollTop - barHeight());
      });
    };
    var pageBy = function (dir) {
      var pos = target != null ? target : scroller.scrollTop;
      var step = scroller.clientHeight - barHeight();
      var max = scroller.scrollHeight - scroller.clientHeight;
      var s = stops();
      var dest;
      if (dir > 0) {
        var next = s.filter(function (t) { return t > pos + 4; })[0];
        dest = Math.min(next != null ? next : max, pos + step);
      } else {
        var prev = s.filter(function (t) { return t < pos - 4; }).pop();
        dest = Math.max(prev != null ? prev : 0, pos - step);
      }
      dest = Math.min(Math.max(dest, 0), max);
      if (dest === Math.round(pos)) return;
      target = dest;
      scroller.scrollTo({ top: dest, behavior: 'smooth' });
    };
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      var t = e.target instanceof Element ? e.target : null;
      if (t && t.closest('input, textarea, select, [role="slider"], [contenteditable]')) return;
      e.preventDefault();
      pageBy(e.key === 'ArrowDown' ? 1 : -1);
    });

    // app-bar topic: the section filling the view is current; last topic at the end
    var links = [].slice.call(document.querySelectorAll('.nav a[href^="#"]'));
    var markCurrent = function () {
      var y = scroller.scrollTop + barHeight() + (scroller.clientHeight - barHeight()) * 0.45;
      var atEnd = scroller.scrollTop >= scroller.scrollHeight - scroller.clientHeight - 2;
      var current = null;
      links.forEach(function (a) {
        var sec = document.querySelector(a.getAttribute('href'));
        if (!sec) return;
        var top = sec.getBoundingClientRect().top + scroller.scrollTop;
        if (top <= y) current = a;
      });
      if (atEnd && links.length) current = links[links.length - 1];
      links.forEach(function (a) {
        if (a === current) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
      });
    };
    scroller.addEventListener('scroll', markCurrent, { passive: true });

    // deep links land just under the floating bar (body is the scroller)
    links.forEach(function (a) {
      a.addEventListener('click', function (e) {
        var sec = document.querySelector(a.getAttribute('href'));
        if (!sec) return;
        e.preventDefault();
        scroller.scrollTo({ top: sec.getBoundingClientRect().top + scroller.scrollTop - barHeight(), behavior: 'smooth' });
        history.replaceState(null, '', a.getAttribute('href'));
      });
    });
    // the browser's own anchor jump scrolls <html> (hidden overflow); undo it and scroll body
    var toHash = function () {
      root.scrollTop = 0;
      var sec = location.hash && document.querySelector(location.hash);
      if (sec) scroller.scrollTop = sec.getBoundingClientRect().top + scroller.scrollTop - barHeight();
    };
    if (location.hash) {
      toHash();
      window.addEventListener('load', function () { requestAnimationFrame(toHash); setTimeout(toHash, 300); });
    }
    window.addEventListener('hashchange', toHash);
  }

  // ---------------------------------- ambient particles: manuals, QR codes, tools
  var canvas = document.getElementById('particles');
  if (canvas) {
    var ctx = canvas.getContext('2d');
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    var dpr = 1, W = 0, H = 0, color = '#1a73e8', parts = [], last = 0, running = false;

    // each icon is drawn in a 24×24 box, centred on 0,0, stroked
    var ICONS = [
      function book(c) { c.strokeRect(-7, -9, 14, 18); c.beginPath(); c.moveTo(-4, -9); c.lineTo(-4, 9); c.moveTo(-1, -4); c.lineTo(4, -4); c.moveTo(-1, 0); c.lineTo(4, 0); c.stroke(); },
      function qr(c) { c.strokeRect(-9, -9, 7, 7); c.strokeRect(2, -9, 7, 7); c.strokeRect(-9, 2, 7, 7); c.fillRect(3, 3, 2.5, 2.5); c.fillRect(6.5, 6.5, 2.5, 2.5); c.fillRect(-7, -7, 3, 3); c.fillRect(4, -7, 3, 3); c.fillRect(-7, 4, 3, 3); },
      function wrench(c) { c.beginPath(); c.arc(5, -5, 4.5, Math.PI * 0.75, Math.PI * 2.25); c.moveTo(1.8, -1.8); c.lineTo(-7, 7); c.stroke(); },
      function plug(c) { c.beginPath(); c.moveTo(-3, -9); c.lineTo(-3, -4); c.moveTo(3, -9); c.lineTo(3, -4); c.moveTo(-6, -4); c.lineTo(6, -4); c.lineTo(6, 1); c.quadraticCurveTo(6, 5, 0, 5); c.quadraticCurveTo(-6, 5, -6, 1); c.closePath(); c.moveTo(0, 5); c.lineTo(0, 9); c.stroke(); },
      function gear(c) { c.beginPath(); c.arc(0, 0, 3, 0, Math.PI * 2); c.stroke(); c.beginPath(); for (var i = 0; i < 8; i++) { var a = i * Math.PI / 4; c.moveTo(Math.cos(a) * 5.5, Math.sin(a) * 5.5); c.lineTo(Math.cos(a) * 8.5, Math.sin(a) * 8.5); } c.stroke(); c.beginPath(); c.arc(0, 0, 6, 0, Math.PI * 2); c.stroke(); },
      function pdf(c) { c.beginPath(); c.moveTo(-6, -9); c.lineTo(3, -9); c.lineTo(7, -5); c.lineTo(7, 9); c.lineTo(-6, 9); c.closePath(); c.moveTo(3, -9); c.lineTo(3, -5); c.lineTo(7, -5); c.stroke(); c.font = '600 6px Inter, sans-serif'; c.textAlign = 'center'; c.fillText('PDF', 0.5, 4); },
      function bulb(c) { c.beginPath(); c.arc(0, -2, 6, Math.PI * 0.8, Math.PI * 2.2); c.lineTo(3, 6); c.lineTo(-3, 6); c.closePath(); c.moveTo(-2.5, 9); c.lineTo(2.5, 9); c.stroke(); },
      function screw(c) { c.beginPath(); c.arc(0, 0, 7, 0, Math.PI * 2); c.moveTo(-4, 0); c.lineTo(4, 0); c.moveTo(0, -4); c.lineTo(0, 4); c.stroke(); }
    ];

    var readColor = function () {
      color = getComputedStyle(root).getPropertyValue('--accent').trim() || '#1a73e8';
    };
    var resize = function () {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = window.innerWidth; H = window.innerHeight;
      canvas.width = W * dpr; canvas.height = H * dpr;
      var n = Math.round(Math.min(46, Math.max(16, W * H / 34000)));
      while (parts.length < n) parts.push(spawn());
      parts.length = n;
      if (!running) draw();
    };
    var spawn = function () {
      var depth = Math.random();
      return {
        x: Math.random() * W, y: Math.random() * H,
        vx: (Math.random() - .5) * 8, vy: (Math.random() - .5) * 8,
        rot: Math.random() * Math.PI * 2, vr: (Math.random() - .5) * .25,
        s: .8 + depth * 1.1, a: .05 + depth * .08,
        icon: ICONS[Math.floor(Math.random() * ICONS.length)]
      };
    };
    var draw = function () {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      parts.forEach(function (p) {
        ctx.save();
        ctx.globalAlpha = p.a;
        ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.scale(p.s, p.s);
        ctx.lineWidth = 1.4 / p.s;
        p.icon(ctx);
        ctx.restore();
      });
    };
    var step = function (t) {
      if (!running) return;
      var dt = Math.min(.05, (t - (last || t)) / 1000);
      last = t;
      parts.forEach(function (p) {
        p.vx += (Math.random() - .5) * 6 * dt; p.vy += (Math.random() - .5) * 6 * dt;
        p.vx = Math.max(-10, Math.min(10, p.vx)); p.vy = Math.max(-10, Math.min(10, p.vy));
        p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
        if (p.x < -30) p.x = W + 30; if (p.x > W + 30) p.x = -30;
        if (p.y < -30) p.y = H + 30; if (p.y > H + 30) p.y = -30;
      });
      draw();
      requestAnimationFrame(step);
    };
    var start = function () {
      if (running || reduce.matches || document.hidden) { draw(); return; }
      running = true; last = 0; requestAnimationFrame(step);
    };
    var stop = function () { running = false; };

    readColor();
    resize();
    window.addEventListener('resize', resize);
    document.addEventListener('themechange', function () { readColor(); draw(); });
    document.addEventListener('visibilitychange', function () { if (document.hidden) stop(); else start(); });
    reduce.addEventListener('change', function () { stop(); start(); });
    start();
  }
})();
