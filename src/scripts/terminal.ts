/* ============================================================
   marrowtech — Terminal streaming (vanilla port).
   Ported from design_system/components/brand/Terminal.jsx.
   Streams shell lines char-by-char into any .mt-term[data-term],
   reading its lines from a child <script class="mt-term-data">.
   Starts when scrolled into view; respects reduced motion.
   ============================================================ */

type Kind = 'cmd' | 'out' | 'ok' | 'err' | 'dim';
interface Line { text: string; kind?: Kind; prompt?: string; }

const PREFIX: Record<string, string> = { cmd: '', ok: '› ', err: '✗ ', out: '  ', dim: '  ' };

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function lineHTML(line: Line, prompt: string, withCaret: boolean): string {
  const kind = line.kind || 'out';
  const cls = kind === 'cmd' ? 'cmd' : kind;
  let html = '<span class="mt-term-line">';
  if (kind === 'cmd') html += `<span class="mt-term-prompt">${esc((line.prompt || prompt) + ' ')}</span>`;
  html += `<span class="mt-term-${cls}">${esc((PREFIX[kind] || '') + line.text)}</span>`;
  if (withCaret) html += '<span class="mt-term-caret"></span>';
  html += '</span>';
  return html;
}

function mount(term: HTMLElement) {
  const body = term.querySelector<HTMLElement>('.mt-term-body');
  const dataEl = term.querySelector<HTMLElement>('.mt-term-data');
  if (!body || !dataEl) return;

  let lines: Line[] = [];
  try { lines = JSON.parse(dataEl.textContent || '[]'); } catch { lines = []; }
  if (!lines.length) return;

  const speed = Number(term.dataset.speed ?? 18);
  const startDelay = Number(term.dataset.startDelay ?? 200);
  const lineDelay = Number(term.dataset.lineDelay ?? 240);
  const prompt = term.dataset.prompt ?? '~/marrowtech $';
  const caret = (term.dataset.caret ?? 'true') !== 'false';

  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (reduce) {
    body.innerHTML = lines.map((l, i) => lineHTML(l, prompt, false) + (i === lines.length - 1 && caret ? '' : '')).join('');
    return;
  }

  const rendered: Line[] = [];
  let timers: number[] = [];

  const paint = (done: boolean) => {
    body.innerHTML = rendered
      .map((l, i) => lineHTML(l, prompt, caret && i === rendered.length - 1 && !done))
      .join('');
  };

  const run = () => {
    let li = 0;
    rendered.length = 0;
    if (caret) body.innerHTML = '<span class="mt-term-line"><span class="mt-term-caret"></span></span>';
    const startLine = (delay: number) => {
      const t = window.setTimeout(() => {
        const line = lines[li];
        if (!line) { paint(true); return; }
        rendered.push({ ...line, text: '' });
        let ci = 0;
        const tick = () => {
          ci++;
          rendered[rendered.length - 1] = { ...line, text: line.text.slice(0, ci) };
          paint(false);
          if (ci < line.text.length) timers.push(window.setTimeout(tick, speed));
          else { li++; startLine(lineDelay); }
        };
        if (line.text.length) timers.push(window.setTimeout(tick, speed));
        else { paint(false); li++; startLine(lineDelay); }
      }, delay);
      timers.push(t);
    };
    startLine(startDelay);
  };

  // start on view
  if (typeof IntersectionObserver === 'undefined') { run(); return; }
  const io = new IntersectionObserver((es) => {
    es.forEach((e) => { if (e.isIntersecting) { run(); io.disconnect(); } });
  }, { threshold: 0.35 });
  io.observe(term);
}

function init() {
  document.querySelectorAll<HTMLElement>('.mt-term[data-term]').forEach(mount);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
