/* Canvas charts, devicePixelRatio aware. Draws only the numbers it is given. */
(function () {
  const reduce = () => window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  function setup(canvas) {
    const r = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }

  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  const COLORS = { blue: "#0a84ff", green: "#00d35a", red: "#ff453a" };

  /* Balance line. opts: {points:[[t,v]], start, marks:[{t,label,color}], color, from:{t1}} */
  function line(canvas, opts, progress) {
    const { ctx, w, h } = setup(canvas);
    const pts = opts.points || [];
    if (!pts.length) return;
    const color = opts.color || "#00d35a";
    // label rows: a later mark moves up a row, never overlaps
    ctx.font = "600 11px -apple-system, system-ui, sans-serif";
    const marks = (opts.marks || []).slice().sort((a, b) => a.t - b.t);
    let t0 = pts[0][0], t1 = pts[pts.length - 1][0];
    if (opts.from && opts.from.t1 && progress !== undefined && progress < 1) {
      const e = 1 - Math.pow(1 - progress, 3);
      t1 = opts.from.t1 + (t1 - opts.from.t1) * e;
    }
    if (t1 <= t0) { t0 -= 30; t1 += 30; }
    const xOf = (t) => 6 + (t - t0) / (t1 - t0) * (w - 12);
    const placed = [];
    for (const m of marks) {
      const x = xOf(m.t);
      const tw = ctx.measureText(m.label).width + 14;
      const a = Math.min(Math.max(x - tw / 2, 2), w - tw - 2), b = a + tw;
      let row = 0;
      while (placed.some((p) => p.row === row && !(b + 4 < p.a || a > p.b + 4))) row++;
      placed.push({ ...m, x, a, b, row, tw });
    }
    const rows = placed.length ? Math.max(...placed.map((p) => p.row)) + 1 : 0;
    const top = 10 + rows * 24, bottom = h - 10;
    let lo = Infinity, hi = -Infinity;
    for (const p of pts) { lo = Math.min(lo, p[1]); hi = Math.max(hi, p[1]); }
    if (opts.start != null) { lo = Math.min(lo, opts.start); hi = Math.max(hi, opts.start); }
    if (hi - lo < Math.abs(hi) * 0.002 || hi === lo) { const pad = Math.max(Math.abs(hi) * 0.01, 0.01); lo -= pad; hi += pad; }
    const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
    const yOf = (v) => bottom - (v - lo) / (hi - lo) * (bottom - top);

    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, xOf(t1) + 1, h); ctx.clip();
    // start line
    if (opts.start != null) {
      ctx.setLineDash([3, 4]); ctx.strokeStyle = "rgba(235,235,245,0.3)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, yOf(opts.start)); ctx.lineTo(w, yOf(opts.start)); ctx.stroke(); ctx.setLineDash([]);
    }
    // area + line
    const path = new Path2D();
    pts.forEach((p, i) => (i ? path.lineTo(xOf(p[0]), yOf(p[1])) : path.moveTo(xOf(p[0]), yOf(p[1]))));
    if (pts.length === 1) path.lineTo(xOf(pts[0][0]) + 0.01, yOf(pts[0][1]));
    const area = new Path2D(path);
    area.lineTo(xOf(pts[pts.length - 1][0]), bottom); area.lineTo(xOf(pts[0][0]), bottom); area.closePath();
    const g = ctx.createLinearGradient(0, top, 0, bottom);
    g.addColorStop(0, "rgba(0,211,90,0.22)"); g.addColorStop(1, "rgba(0,211,90,0)");
    ctx.fillStyle = g; ctx.fill(area);
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.stroke(path);
    ctx.restore();
    // last point dot
    const lp = pts[pts.length - 1];
    if (xOf(lp[0]) <= w) {
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(Math.min(xOf(lp[0]), w - 5), yOf(lp[1]), 4, 0, Math.PI * 2); ctx.fill();
    }
    // marks above the line
    const valueAt = (t) => {
      let best = pts[0];
      for (const p of pts) if (Math.abs(p[0] - t) < Math.abs(best[0] - t)) best = p;
      return best[1];
    };
    for (const m of placed) {
      const c = COLORS[m.color] || m.color || "#0a84ff";
      const ly = 10 + (rows - 1 - m.row) * 24;
      const py = yOf(valueAt(m.t));
      ctx.strokeStyle = c; ctx.globalAlpha = 0.5; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(m.x, ly + 20); ctx.lineTo(m.x, py); ctx.stroke(); ctx.globalAlpha = 1;
      ctx.fillStyle = c; ctx.beginPath(); ctx.arc(m.x, py, 3.5, 0, Math.PI * 2); ctx.fill();
      rr(ctx, m.a, ly, m.tw, 20, 10); ctx.fill();
      ctx.fillStyle = m.color === "green" ? "#000" : "#fff"; ctx.textBaseline = "middle";
      ctx.fillText(m.label, m.a + 7, ly + 10.5);
    }
  }

  /* animate the newest point sliding in over 250 ms (no motion when reduced) */
  function lineAnimated(canvas, opts) {
    if (!opts.from || reduce()) return line(canvas, opts);
    const t0 = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - t0) / 250);
      line(canvas, opts, p);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /* 1-minute candles. opts: {candles:[[t,o,h,l,c]], exit, entry} */
  function candles(canvas, opts) {
    const { ctx, w, h } = setup(canvas);
    const cs = (opts.candles || []).slice(-60);
    if (!cs.length) return;
    let lo = Infinity, hi = -Infinity;
    for (const c of cs) { lo = Math.min(lo, c[3]); hi = Math.max(hi, c[2]); }
    for (const v of [opts.exit, opts.entry]) if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    if (hi === lo) { lo *= 0.98; hi *= 1.02; }
    const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
    const top = 10, bottom = h - 18, right = w - 8, left = 8;
    const yOf = (v) => bottom - (v - lo) / (hi - lo) * (bottom - top);
    const tFirst = cs[0][0], tLast = cs[cs.length - 1][0];
    const slots = Math.max(30, Math.round((tLast - tFirst) / 60) + 1);
    const slotW = (right - left) / slots;
    const bw = Math.max(2, Math.min(10, slotW * 0.62));
    if (opts.exit != null) {
      ctx.setLineDash([5, 4]); ctx.strokeStyle = "#ff9f0a"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(0, yOf(opts.exit)); ctx.lineTo(w, yOf(opts.exit)); ctx.stroke(); ctx.setLineDash([]);
    }
    if (opts.entry != null) {
      ctx.setLineDash([2, 4]); ctx.strokeStyle = "rgba(235,235,245,0.3)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, yOf(opts.entry)); ctx.lineTo(w, yOf(opts.entry)); ctx.stroke(); ctx.setLineDash([]);
    }
    for (const c of cs) {
      const i = Math.round((c[0] - tFirst) / 60) + (slots - (Math.round((tLast - tFirst) / 60) + 1));
      const x = left + (i + 0.5) * slotW;
      const up = c[4] >= c[1];
      ctx.strokeStyle = ctx.fillStyle = up ? "#00d35a" : "#ff453a";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, yOf(c[2])); ctx.lineTo(x, yOf(c[3])); ctx.stroke();
      const y1 = yOf(Math.max(c[1], c[4])), y2 = yOf(Math.min(c[1], c[4]));
      ctx.fillRect(x - bw / 2, y1 - (y2 - y1 < 2 ? 1 : 0), bw, Math.max(2, y2 - y1));
    }
    ctx.fillStyle = "rgba(235,235,245,0.3)"; ctx.font = "11px -apple-system, system-ui, sans-serif"; ctx.textBaseline = "alphabetic";
    const fmt = (t) => new Date(t * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    ctx.fillText(fmt(tFirst), left, h - 3);
    const lt = fmt(tLast); ctx.fillText(lt, right - ctx.measureText(lt).width, h - 3);
  }

  window.DeskChart = { line, lineAnimated, candles };
})();
