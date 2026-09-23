// Injected into every page. Draws captions, hand-drawn boxes/arrows, a fake
// cursor and title cards on top of the live app. Driven from record.js.
(() => {
  if (window.__ov) return;
  const FONT = '__CAVEAT__';
  const INK = '#e11d48';      // annotation ink
  const BLUE = '#2563eb';
  const NS = 'http://www.w3.org/2000/svg';
  let root, svg, cap, cur, card, spot;

  function ensure() {
    if (root && document.body.contains(root)) return;
    const st = document.createElement('style');
    st.textContent = `
      @font-face { font-family: 'OvHand'; src: url(${FONT}) format('woff2'); }
      nextjs-portal, [data-nextjs-toast], #__next-build-watcher { display: none !important; }
      #__ov { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647; font-family: Inter, system-ui, sans-serif; }
      #__ov svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
      #__ov .lbl { position: absolute; font-family: OvHand, cursive; font-size: 30px; color: ${INK}; white-space: nowrap;
                   text-shadow: 0 0 4px #fff, 0 0 4px #fff, 0 0 8px #fff; opacity: 0; transition: opacity .35s; line-height: 1; }
      #__ov .cap { position: absolute; left: 50%; bottom: 28px; transform: translate(-50%, 20px); opacity: 0;
                   transition: opacity .35s, transform .35s; max-width: 980px; width: max-content;
                   background: rgba(15,23,42,.92); color: #fff; border-radius: 12px; padding: 14px 22px 16px;
                   box-shadow: 0 10px 30px rgba(0,0,0,.3); display: flex; gap: 16px; align-items: flex-start; }
      #__ov .cap.on { opacity: 1; transform: translate(-50%, 0); }
      #__ov .cap .n { flex: none; width: 34px; height: 34px; border-radius: 50%; background: ${BLUE}; color: #fff;
                      font-weight: 700; font-size: 17px; display: grid; place-items: center; margin-top: 2px; }
      #__ov .cap .t { font-size: 21px; font-weight: 700; letter-spacing: -.01em; }
      #__ov .cap .b { font-size: 17px; line-height: 1.45; color: #cbd5e1; margin-top: 3px; max-width: 880px; }
      #__ov .cap .b b { color: #fff; }
      #__ov .cur { position: absolute; left: 0; top: 0; width: 26px; height: 26px; transition: transform .7s cubic-bezier(.45,.05,.3,1);
                   filter: drop-shadow(0 2px 3px rgba(0,0,0,.35)); }
      #__ov .rip { position: absolute; width: 44px; height: 44px; margin: -22px 0 0 -22px; border-radius: 50%;
                   border: 3px solid ${BLUE}; animation: ovrip .6s ease-out forwards; }
      @keyframes ovrip { from { transform: scale(.2); opacity: 1 } to { transform: scale(1.4); opacity: 0 } }
      #__ov .spot { position: absolute; border-radius: 10px; box-shadow: 0 0 0 9999px rgba(15,23,42,.45);
                    transition: all .5s ease; opacity: 0; }
      #__ov .card { position: absolute; inset: 0; background: linear-gradient(135deg, #1e3a8a 0%, #2563eb 55%, #3b82f6 100%);
                    color: #fff; display: flex; flex-direction: column; justify-content: center; padding: 0 140px;
                    opacity: 0; transition: opacity .6s; }
      #__ov .card.on { opacity: 1; }
      #__ov .card .k { font-size: 20px; font-weight: 600; letter-spacing: .12em; text-transform: uppercase; color: #bfdbfe; }
      #__ov .card h1 { font-size: 64px; font-weight: 800; margin: 14px 0 10px; letter-spacing: -.02em; line-height: 1.05; }
      #__ov .card p { font-size: 24px; color: #dbeafe; margin: 0; max-width: 900px; line-height: 1.4; }
      #__ov .card ol { margin: 26px 0 0; padding: 0; list-style: none; counter-reset: s; display: grid; gap: 12px; }
      #__ov .card li { counter-increment: s; font-size: 23px; display: flex; gap: 14px; align-items: center; }
      #__ov .card li::before { content: counter(s); width: 34px; height: 34px; border-radius: 50%; background: #fff;
                               color: ${BLUE}; font-weight: 800; display: grid; place-items: center; font-size: 17px; flex: none; }
      #__ov .card .hand { font-family: OvHand, cursive; font-size: 40px; color: #fde68a; margin-top: 30px; }
    `;
    document.head.appendChild(st);
    root = document.createElement('div');
    root.id = '__ov';
    svg = document.createElementNS(NS, 'svg');
    spot = document.createElement('div'); spot.className = 'spot';
    cap = document.createElement('div'); cap.className = 'cap';
    card = document.createElement('div'); card.className = 'card';
    cur = document.createElement('div'); cur.className = 'cur';
    cur.innerHTML = `<svg viewBox="0 0 24 24" width="26" height="26" style="position:static"><path d="M3 2l7 19 2.6-7.6L20 11z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
    root.append(spot, svg, card, cap, cur);
    document.body.appendChild(root);
    cur.style.transform = `translate(${window.__ovCur?.x ?? 720}px, ${window.__ovCur?.y ?? 450}px)`;
  }

  // Seeded jitter so a redraw looks the same across runs.
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;

  function sketchRect(x, y, w, h, pad = 8) {
    x -= pad; y -= pad; w += pad * 2; h += pad * 2;
    const j = (a) => a + rnd() * 6;
    const r = 10;
    // A slightly wobbly rounded rectangle that overshoots where it closes.
    return `M${j(x + r)} ${j(y)} Q${x + w / 2} ${j(y - 2)} ${j(x + w - r)} ${j(y)} Q${x + w} ${y} ${j(x + w)} ${j(y + r)}
            Q${j(x + w + 2)} ${y + h / 2} ${j(x + w)} ${j(y + h - r)} Q${x + w} ${y + h} ${j(x + w - r)} ${j(y + h)}
            Q${x + w / 2} ${j(y + h + 2)} ${j(x + r)} ${j(y + h)} Q${x} ${y + h} ${j(x)} ${j(y + h - r)}
            Q${j(x - 2)} ${y + h / 2} ${j(x)} ${j(y + r)} Q${x} ${y} ${j(x + r + 18)} ${j(y - 3)}`;
  }

  function drawPath(d, { color = INK, width = 3.5, dur = 700, delay = 0, fill = 'none' } = {}) {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    p.setAttribute('fill', fill);
    p.setAttribute('stroke', color);
    p.setAttribute('stroke-width', width);
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(p);
    const len = p.getTotalLength();
    p.style.strokeDasharray = len;
    p.style.strokeDashoffset = len;
    p.getBoundingClientRect();
    p.style.transition = `stroke-dashoffset ${dur}ms ease-in-out ${delay}ms`;
    requestAnimationFrame(() => (p.style.strokeDashoffset = 0));
    return p;
  }

  function label(text, x, y, { color = INK, size = 30, delay = 500, anchor = 'left' } = {}) {
    const l = document.createElement('div');
    l.className = 'lbl';
    l.textContent = text;
    l.style.color = color;
    l.style.fontSize = size + 'px';
    root.appendChild(l);
    const w = l.offsetWidth;
    l.style.left = (anchor === 'center' ? x - w / 2 : anchor === 'right' ? x - w : x) + 'px';
    l.style.top = y + 'px';
    setTimeout(() => (l.style.opacity = 1), delay);
    l.dataset.mark = 1;
    return l;
  }

  function arrow(x1, y1, x2, y2, { color = INK, delay = 0, bend = 0.25 } = {}) {
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    const dx = x2 - x1, dy = y2 - y1;
    const cx = mx - dy * bend, cy = my + dx * bend;
    drawPath(`M${x1} ${y1} Q${cx} ${cy} ${x2} ${y2}`, { color, delay, dur: 550 });
    const a = Math.atan2(y2 - cy, x2 - cx), s = 16;
    const h1 = [x2 - s * Math.cos(a - 0.45), y2 - s * Math.sin(a - 0.45)];
    const h2 = [x2 - s * Math.cos(a + 0.45), y2 - s * Math.sin(a + 0.45)];
    drawPath(`M${h1[0]} ${h1[1]} L${x2} ${y2} L${h2[0]} ${h2[1]}`, { color, delay: delay + 500, dur: 200 });
  }

  window.__ov = {
    ensure,
    rect(sel) {
      const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    },
    caption(n, title, body) {
      ensure();
      cap.classList.remove('on');
      setTimeout(() => {
        cap.innerHTML = (n ? `<div class="n">${n}</div>` : '') + `<div><div class="t">${title}</div>${body ? `<div class="b">${body}</div>` : ''}</div>`;
        cap.classList.add('on');
      }, cap.innerHTML ? 250 : 0);
    },
    hideCaption() { ensure(); cap.classList.remove('on'); },
    box(r, text, opts = {}) {
      ensure();
      const { color = INK, pos = 'below', pad = 8, dx = 0, dy = 0, delay = 0 } = opts;
      drawPath(sketchRect(r.x, r.y, r.w, r.h, pad), { color, delay });
      if (text) {
        const at = {
          below: [r.x + r.w / 2 + dx, r.y + r.h + pad + 8 + dy, 'center'],
          above: [r.x + r.w / 2 + dx, r.y - pad - 40 + dy, 'center'],
          right: [r.x + r.w + pad + 14 + dx, r.y + r.h / 2 - 17 + dy, 'left'],
          left: [r.x - pad - 14 + dx, r.y + r.h / 2 - 17 + dy, 'right'],
        }[pos];
        label(text, at[0], at[1], { color, anchor: at[2], delay: delay + 450, size: opts.size });
      }
    },
    arrow(x1, y1, x2, y2, opts) { ensure(); arrow(x1, y1, x2, y2, opts); },
    label(text, x, y, opts) { ensure(); return label(text, x, y, opts); },
    underline(r, opts = {}) {
      ensure();
      const y = r.y + r.h + 4;
      drawPath(`M${r.x - 4} ${y + rnd() * 3} Q${r.x + r.w / 2} ${y + 5} ${r.x + r.w + 6} ${y - 1}`, { color: opts.color || INK, dur: 400 });
    },
    spot(r, pad = 10) {
      ensure();
      if (!r) { spot.style.opacity = 0; return; }
      Object.assign(spot.style, { left: r.x - pad + 'px', top: r.y - pad + 'px', width: r.w + pad * 2 + 'px', height: r.h + pad * 2 + 'px', opacity: 1 });
    },
    clear() {
      ensure();
      svg.innerHTML = '';
      root.querySelectorAll('[data-mark]').forEach((n) => n.remove());
      spot.style.opacity = 0;
    },
    move(x, y) {
      ensure();
      window.__ovCur = { x, y };
      cur.style.transform = `translate(${x}px, ${y}px)`;
    },
    ripple(x, y) {
      ensure();
      const d = document.createElement('div');
      d.className = 'rip';
      d.style.left = x + 'px'; d.style.top = y + 'px';
      root.appendChild(d);
      setTimeout(() => d.remove(), 700);
    },
    card(html) {
      ensure();
      if (!html) { card.classList.remove('on'); return; }
      card.innerHTML = html;
      card.classList.add('on');
    },
    showCursor(on) { ensure(); cur.style.opacity = on ? 1 : 0; },
  };
})();
