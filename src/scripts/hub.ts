/* ============================================================
   marrowtech — hub page behaviors (vanilla port).
   Ported from design_system/ui_kits/hub/{index.html,Nav.jsx,
   Hero.jsx}: nav blur-on-scroll, the streaming hero headline,
   and view-gated entrance reveals. Respects reduced motion.
   ============================================================ */

const reduce = () =>
  window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---- Nav: toggle .is-scrolled past 24px ---- */
function initNav() {
  const nav = document.querySelector<HTMLElement>('.hub-nav');
  if (!nav) return;
  const on = () => nav.classList.toggle('is-scrolled', window.scrollY > 24);
  on();
  window.addEventListener('scroll', on, { passive: true });
}

/* ---- Hero: stream the display headline char-by-char ---- */
function initHero() {
  const host = document.querySelector<HTMLElement>('[data-hero-title]');
  if (!host) return;
  const lineEls = Array.from(host.querySelectorAll<HTMLElement>('.ln'));
  if (!lineEls.length) return;

  const lines = lineEls.map((el) => ({
    el,
    text: el.dataset.line ?? '',
    delay: Number(el.dataset.delay ?? 0),
    speed: Number(el.dataset.speed ?? 46),
    done: false,
    started: false,
  }));

  if (reduce()) {
    lines.forEach((l) => { l.el.textContent = l.text; });
    return;
  }

  const caret = document.createElement('i');
  caret.className = 'cr';

  const updateCaret = () => {
    let owner: HTMLElement | null = null;
    for (let i = 0; i < lines.length; i++) {
      const prevDone = lines.slice(0, i).every((p) => p.done);
      if (prevDone && !lines[i].done) { owner = lines[i].el; break; }
    }
    if (owner) owner.appendChild(caret);
    else if (caret.parentElement) caret.parentElement.removeChild(caret);
  };

  lines.forEach((l) => { l.el.textContent = ''; });
  updateCaret();

  lines.forEach((line) => {
    window.setTimeout(() => {
      line.started = true;
      let i = 0;
      const tick = () => {
        i++;
        line.el.textContent = line.text.slice(0, i);
        updateCaret();
        if (i < line.text.length) window.setTimeout(tick, line.speed);
        else { line.done = true; updateCaret(); }
      };
      if (line.text.length) tick();
      else { line.done = true; updateCaret(); }
    }, line.delay);
  });
}

/* ---- Entrance reveals, gated on view ---- */
function initReveals() {
  if (reduce()) return;
  const selectors = [
    '.hub-section-head',
    '.hub-grid > *',
    '.hub-journal-grid > *',
    '.hub-blog-grid > *',
    '.hub-about-grid > *',
    '.hub-contact-inner',
  ];
  const els: HTMLElement[] = [];
  selectors.forEach((s) => document.querySelectorAll<HTMLElement>(s).forEach((el) => els.push(el)));
  if (!els.length) return;

  els.forEach((el, i) => {
    el.classList.add('reveal');
    el.style.transitionDelay = Math.min(i, 4) * 60 + 'ms';
  });
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    });
  }, { threshold: 0.16 });
  els.forEach((el) => io.observe(el));
}

function init() {
  initNav();
  initHero();
  initReveals();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
