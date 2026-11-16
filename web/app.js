/* STEP 10 · Desk iPhone web app (hosting plan B: static GitHub Pages, encrypted files).
   The key arrives once in the link fragment (#k=…&d=…), is kept in localStorage and removed from the
   address bar. Every file is AES-256-GCM, decrypted here with WebCrypto. Nothing in this file is a secret.
   Rules: every FOMO link comes from the desk (links.py), never built here. Never a made-up number:
   unknown = "n/a" or "—". Writes have no server on plan B: the app hands you the exact command for
   the Grok Bot chat. Untrusted text (coin names) only ever goes in via textContent. */
(() => {
  "use strict";
  const SALT = new TextEncoder().encode("fomo-desk");
  const enc = new TextEncoder();
  const reduceMotion = () => window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const BOTCOLOR = { scanner: "#64d2ff", analyst: "#ffd60a", brain: "#bf5af2", executor: "#00d35a", risk: "#ff6b9a" };
  const BOTNAME = { scanner: "Scanner", analyst: "Analyst", brain: "Brain", executor: "Executor", risk: "Risk" };
  const RANGES = ["LIVE", "1H", "4H", "1D", "1W", "ALL"];
  const STALE_S = 120;

  // ---------- key from the fragment, then out of the address bar
  const frag = new URLSearchParams(location.hash.slice(1));
  if (frag.get("k")) localStorage.setItem("desk.k", frag.get("k"));
  if (frag.get("d")) localStorage.setItem("desk.d", frag.get("d"));
  if (location.hash) history.replaceState(null, "", location.pathname + location.search);
  const K = localStorage.getItem("desk.k");
  const D = localStorage.getItem("desk.d");

  // ---------- tiny DOM helper (textContent only, never raw HTML with data)
  function el(tag, props, ...kids) {
    const n = document.createElement(tag);
    if (props) for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k === "style") n.setAttribute("style", v);
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    }
    for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) n.append(c.nodeType ? c : String(c));
    return n;
  }
  const svgNS = "http://www.w3.org/2000/svg";
  function svg(tag, attrs, ...kids) {
    const n = document.createElementNS(svgNS, tag);
    for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v);
    kids.forEach((c) => n.append(c.nodeType ? c : document.createTextNode(c)));
    return n;
  }
  const $ = (s, r = document) => r.querySelector(s);
  function fomoLink(link, label = "Open on FOMO", cls = "fomo") {
    if (!link) return null;  // links come only from the desk (links.py); no link = no button
    const a = el("a", { class: cls, target: "_blank", rel: "noopener noreferrer", text: label });
    a.setAttribute("href", link);  // exactly as the desk wrote it
    a.addEventListener("click", (e) => e.stopPropagation());
    return a;
  }

  // ---------- formatting (null stays "—": never a made-up number)
  const NA = "—";
  const isNum = (v) => typeof v === "number" && isFinite(v);
  const money = (v) => !isNum(v) ? NA : (v < 0 ? "-$" : "$") + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const short$ = (v) => {
    if (!isNum(v)) return "n/a";
    const a = Math.abs(v);
    if (a >= 1e9) return "$" + (v / 1e9).toFixed(2) + "B";
    if (a >= 1e6) return "$" + (v / 1e6).toFixed(2) + "M";
    if (a >= 1e3) return "$" + (v / 1e3).toFixed(1) + "K";
    return "$" + v.toFixed(2);
  };
  const pct = (v, d = 2) => !isNum(v) ? NA : (v >= 0 ? "+" : "") + v.toFixed(d) + "%";
  const SUB = "₀₁₂₃₄₅₆₇₈₉";
  function price(v) {
    if (!isNum(v)) return NA;
    if (v >= 1) return "$" + v.toLocaleString("en-US", { maximumFractionDigits: 4, minimumFractionDigits: 2 });
    if (v >= 0.001) return "$" + v.toPrecision(4);
    const s = v.toFixed(20).slice(2);
    const z = s.match(/^0*/)[0].length;
    const sig = s.slice(z, z + 4).replace(/0+$/, "") || "0";
    return "$0.0" + String(z).split("").map((d) => SUB[+d]).join("") + sig;
  }
  function tsOf(s) {
    if (s === null || s === undefined) return null;
    if (typeof s === "number") return s;
    if (/^\d+(\.\d+)?$/.test(s)) return parseFloat(s);
    const t = Date.parse(String(s).replace(/([+-]\d\d)(\d\d)$/, "$1:$2"));
    return isNaN(t) ? null : t / 1000;
  }
  const clock = (t) => t ? new Date(t * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : NA;
  const clockS = (t) => t ? new Date(t * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" }) : NA;
  function age(s) {
    if (!isNum(s)) return null;
    if (s < 3600) return Math.max(1, Math.round(s / 60)) + "m";
    if (s < 86400) return Math.round(s / 3600) + "h";
    return Math.round(s / 86400) + "d";
  }
  const sym = (r) => (r && (r.symbol || r.name)) || (r && r.mint ? r.mint.slice(0, 6) : "?");
  const now = () => Date.now() / 1000;

  // ---------- crypto + data
  let keys = null;
  function unb64u(s) {
    s = s.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  }
  async function deriveKeys() {
    const master = await crypto.subtle.importKey("raw", unb64u(K), "HKDF", false, ["deriveBits"]);
    const bits = (info) => crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: SALT, info: enc.encode(info) }, master, 256);
    const aes = await crypto.subtle.importKey("raw", await bits("fomo-desk enc v1"), "AES-GCM", false, ["decrypt"]);
    const nameKey = await crypto.subtle.importKey("raw", await bits("fomo-desk name v1"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return { aes, nameKey };
  }
  const idCache = {};
  async function fileId(name) {
    if (idCache[name]) return idCache[name];
    const mac = new Uint8Array(await crypto.subtle.sign("HMAC", keys.nameKey, enc.encode(name)));
    return (idCache[name] = Array.from(mac.slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join(""));
  }
  async function loadBin(name) {
    const r = await fetch(`d/${D}/${await fileId(name)}.bin?t=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) { const e = new Error(`${name}: HTTP ${r.status}`); e.status = r.status; throw e; }
    const blob = new Uint8Array(await r.arrayBuffer());
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: blob.slice(0, 12), additionalData: enc.encode(name) }, keys.aes, blob.slice(12)));
  }
  const loadJSON = async (name) => JSON.parse(new TextDecoder().decode(await loadBin(name)));

  const S = { state: null, chart: {}, range: localStorage.getItem("desk.range") || "LIVE", activity: null, account: null,
    screen: null, frameTs: null, dec: {}, lastOk: 0, err: false, nextTry: 0, tab: "home", dirty: new Set(), prevChart: {}, open: {} };

  // ---------- toast / sheets / stack
  let toastT = 0;
  function toast(t) {
    const n = $("#toast"); n.textContent = t; n.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => (n.hidden = true), 2000);
  }
  function sheet(build) {
    const scrim = el("div", { class: "scrim" });
    const sh = el("div", { class: "sheet", role: "dialog" }, el("div", { class: "grab" }));
    const close = () => { scrim.remove(); sh.remove(); };
    scrim.addEventListener("click", close);
    build(sh, close);
    document.body.append(scrim, sh);
    return close;
  }
  async function copy(text, ok = "Copied") {
    try { await navigator.clipboard.writeText(text); toast(ok); }
    catch (e) { toast("Press and hold the text to copy it"); }
  }
  /* Plan B has no POST /api: the exact command for the Grok Bot chat (STEP 11 command words). */
  function command(title, cmd, note) {
    sheet((sh, close) => {
      sh.append(el("h3", { text: title }),
        el("div", { class: "cmd", text: cmd }),
        el("p", { text: note || "Send this in your Grok Bot chat. The desk does it there and answers you. This app can't send it: the Page is static and holds no token." }),
        el("button", { class: "btn primary", text: "Copy command", onclick: () => copy(cmd) }),
        el("button", { class: "btn grey", text: "Close", onclick: close }));
    });
  }
  const stack = [];
  function pushView(kind, arg) {
    const v = el("div", { class: "view" });
    v._kind = kind; v._arg = arg;
    $("#stack").append(v);
    stack.push(v);
    history.pushState({ depth: stack.length }, "");
    renderView(v);
    return v;
  }
  function popView() {
    const v = stack.pop();
    if (v) { if (v._cleanup) v._cleanup(); v.remove(); }
  }
  window.addEventListener("popstate", () => popView());
  const backBtn = () => el("button", { class: "back", onclick: () => history.back(), "aria-label": "Back" },
    svg("svg", { viewBox: "0 0 13 22" }, svg("path", { d: "M11 2 2 11l9 9" })), "Back");

  // ---------- odometer: changed digits roll 600 ms ease-out, 30 ms stagger; reduced motion: swap
  function odo(node, text) {
    if (node._text === text) return;
    const same = node._text && node._text.length === text.length &&
      [...text].every((c, i) => /\d/.test(c) === /\d/.test(node._text[i]));
    if (!same || reduceMotion()) {
      node.textContent = "";
      node._cols = [...text].map((c) => {
        if (!/\d/.test(c)) { const s = el("span", { class: "ch", text: c }); node.append(s); return null; }
        const strip = el("span", { class: "strip" }, ...Array.from({ length: 10 }, (_, d) => el("span", { text: String(d) })));
        strip.style.transition = "none";
        strip.style.transform = `translateY(${-c * 1.05}em)`;
        node.append(el("span", { class: "col" }, strip));
        return strip;
      });
      node._text = text;
      requestAnimationFrame(() => node._cols.forEach((s) => s && (s.style.transition = "")));
      return;
    }
    let k = 0;
    [...text].forEach((c, i) => {
      const s = node._cols[i];
      if (s && c !== node._text[i]) {
        s.style.transitionDelay = `${k++ * 30}ms`;
        s.style.transform = `translateY(${-c * 1.05}em)`;
      }
    });
    node._text = text;
  }

  // ---------- HOME
  const home = {};
  function buildHome() {
    const t = $("#tab-home");
    t.textContent = "";
    home.bell = el("button", { class: "iconbtn", "aria-label": "Pushes", onclick: openBell },
      svg("svg", { viewBox: "0 0 24 24" }, svg("path", { d: "M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z" }), svg("path", { d: "M10 20a2 2 0 0 0 4 0" })));
    home.avatar = el("div", { class: "avatar", text: "·" });
    t.append(el("div", { class: "navbar" },
      el("button", { class: "avatarbtn", "aria-label": "Account", onclick: () => go("account") }, home.avatar),
      el("button", { class: "title", onclick: () => go("bots") }, "Grok Bot", el("span", { class: "chev", text: " ›" })),
      el("button", { class: "iconbtn", "aria-label": "Search", onclick: openSearch },
        svg("svg", { viewBox: "0 0 24 24" }, svg("circle", { cx: "11", cy: "11", r: "6.5" }), svg("path", { d: "m16 16 4.5 4.5" }))),
      home.bell));
    home.offline = el("div", { class: "offline", hidden: true });
    t.append(home.offline);
    home.odo = el("span", { class: "odo" });
    home.big = el("div", { class: "big" }, home.odo);
    home.paper = el("span", { class: "pill paper", text: "PAPER", hidden: true });
    home.today = el("span", { class: "num" });
    home.mult = el("span", { class: "pill mult", hidden: true, title: "balance / night start" });
    home.balNote = el("span", { class: "faint" });
    t.append(el("div", { class: "balance" },
      el("div", { class: "balrow" }, home.big, home.paper),
      el("div", { class: "sub" }, home.today, home.mult, home.balNote)));
    home.canvas = el("canvas");
    home.chartEmpty = el("div", { class: "chartempty", hidden: true });
    t.append(el("div", { class: "chartwrap" }, home.canvas, home.chartEmpty));
    home.ranges = el("div", { class: "ranges" }, ...RANGES.map((r) =>
      el("button", { "data-r": r, class: r === S.range ? "on" : "", onclick: () => setRange(r) }, el("span", { text: r }))));
    t.append(home.ranges);
    // LIVE SCREEN card
    home.imgA = el("img", { alt: "" }); home.imgB = el("img", { alt: "" });
    home.tl = el("span", { class: "tl" }); home.tr = el("span", { class: "tr" });
    home.noframe = el("div", { class: "noframe", hidden: true });
    home.screen = el("button", { class: "screen", "aria-label": "Bot's computer, full screen", onclick: openFull },
      home.imgA, home.imgB, home.noframe, home.tl, home.tr);
    home.last = el("div", { class: "lastorder" });
    t.append(el("div", { class: "live" }, home.screen, home.last));
    home.botsHead = el("h2", { text: "Bots" });
    t.append(el("div", { class: "sechead" }, home.botsHead, el("button", { text: "All", onclick: () => go("bots") })));
    home.carousel = el("div", { class: "carousel" });
    t.append(home.carousel);
    t.append(el("div", { class: "sechead" }, el("h2", { text: "Activity" }), el("button", { text: "See all", onclick: () => go("activity") })));
    home.act = el("div");
    t.append(home.act);
    skeletonHome();
  }
  function skeletonHome() {
    home.odo.textContent = "";
    home.big.replaceChildren(el("div", { class: "sk", style: "width:220px;height:66px" }));
    home.today.replaceChildren(el("span", { class: "sk", style: "display:inline-block;width:120px;height:18px" }));
    home.chartEmpty.hidden = true;
    home.carousel.replaceChildren(...[0, 1].map(() => el("div", { class: "bcard sk" })));
    home.act.replaceChildren(el("div", { class: "list" }, ...[0, 1, 2].map(() => el("div", { class: "lrow" }, el("div", { class: "sk", style: "height:36px;flex:1" })))));
    home.last.replaceChildren(el("div", { class: "sk", style: "height:18px;width:70%" }));
  }
  function renderHome() {
    const st = S.state;
    if (!st) return;
    if (!home.big.contains(home.odo)) home.big.replaceChildren(home.odo);
    home.avatar.textContent = ((S.account && S.account.fomoHandle) || "G").slice(0, 1).toUpperCase();
    if (isNum(st.balance)) { odo(home.odo, money(st.balance)); home.balNote.textContent = ""; }
    else if (!home.odo._text) { odo(home.odo, NA); home.balNote.textContent = "a position has no price yet"; }
    else home.balNote.textContent = "last good balance · a position has no price yet";
    home.paper.hidden = st.mode !== "PAPER";
    home.today.replaceChildren(el("span", { class: isNum(st.todayPct) ? (st.todayPct >= 0 ? "up" : "down") : "muted", text: isNum(st.todayPct) ? pct(st.todayPct) : NA }), " today");
    home.mult.hidden = !isNum(st.multiplier);
    if (isNum(st.multiplier)) home.mult.textContent = st.multiplier.toFixed(2) + "×";
    const lastSeen = +(localStorage.getItem("desk.pushSeen") || 0);
    const newest = st.pushes && st.pushes[0] ? tsOf(st.pushes[0].ts) : 0;
    home.bell.querySelector(".dot")?.remove();
    if (newest && newest > lastSeen) home.bell.append(el("span", { class: "dot" }));
    drawChart(false);
    renderScreenText();
    renderLastOrder();
    home.botsHead.textContent = `Bots · ${st.running} running`;
    const sl = home.carousel.scrollLeft;
    home.carousel.replaceChildren(...st.bots.map(botCard));
    home.carousel.scrollLeft = sl;
    renderHomeActivity();
  }
  function renderHomeActivity() {
    const rows = S.activity ? S.activity.rows.slice(0, 5) : null;
    if (!rows) return;
    const trades = rows.length;
    if (!trades) { home.act.replaceChildren(el("div", { class: "empty", text: "Waiting for the first trade" })); return; }
    home.act.replaceChildren(el("div", { class: "list" }, ...rows.map(actRow)));
  }
  function setRange(r) {
    S.range = r; localStorage.setItem("desk.range", r);
    home.ranges.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.r === r));
    if (S.chart[r]) drawChart(false); else refreshChart();
  }
  function drawChart(animate) {
    const c = S.chart[S.range], st = S.state;
    if (!c || !st) return;
    const marks = c.marks || [];
    const hasTrades = marks.length > 0 || (st.positions && st.positions.length > 0);
    if (!c.points.length) {
      home.chartEmpty.hidden = false;
      home.chartEmpty.textContent = S.range === "LIVE" ? "No balance points in the last 15 min" : "No balance points in this range";
      DeskChart.line(home.canvas, { points: [] });
      return;
    }
    home.chartEmpty.hidden = hasTrades;
    home.chartEmpty.textContent = "Waiting for the first trade";
    const prev = S.prevChart[S.range];
    const opts = { points: c.points, start: st.nightStart, marks, color: "#00d35a" };
    const last = c.points[c.points.length - 1][0];
    if (animate && prev && last > prev) { opts.from = { t1: prev }; DeskChart.lineAnimated(home.canvas, opts); }
    else DeskChart.line(home.canvas, opts);
    S.prevChart[S.range] = last;
  }

  // LIVE SCREEN card: double buffered, never flashes
  let frontImg = null, frameURL = null;
  async function refreshScreen() {
    const sc = await loadJSON("screen.json");
    S.screen = sc;
    if (sc.frame && sc.ts !== S.frameTs) {
      const bytes = await loadBin("screen.img");
      const url = URL.createObjectURL(new Blob([bytes], { type: sc.mime || "image/png" }));
      const back = frontImg === home.imgA ? home.imgB : home.imgA;
      await new Promise((res) => { back.onload = res; back.onerror = res; back.src = url; });
      back.classList.add("show");
      if (frontImg) frontImg.classList.remove("show");
      const old = frameURL;
      frontImg = back; frameURL = url; S.frameTs = sc.ts;
      if (old) setTimeout(() => URL.revokeObjectURL(old), 400);
    }
    renderScreenText();
  }
  function renderScreenText() {
    const sc = S.screen, st = S.state;
    if (!home.tl) return;
    if (!sc || !sc.frame) {
      home.noframe.hidden = false;
      home.noframe.textContent = sc ? "No frame yet. The first order screenshot shows up here." : "Loading the bot's computer…";
      home.tl.replaceChildren(el("span", { class: "ldot" }), "No frame");
    } else {
      home.noframe.hidden = true;
      const fresh = now() - sc.ts < 5;
      home.tl.replaceChildren(el("span", { class: "ldot" + (fresh ? " red" : "") }), fresh ? "Live · Bot's computer" : `Last frame ${clock(sc.ts)}`);
    }
    const lane = st && st.lane;
    home.tr.replaceChildren(lane ? el("span", { style: `color:${BOTCOLOR[lane.bot] || "#fff"}`, text: `${BOTNAME[lane.bot] || lane.bot} · ${lane.verb}` }) : el("span", { class: "muted", text: "Idle" }));
  }
  function checkChip(label, v) {
    return el("span", { class: "check" + (v === true || v === 1 ? " ok" : v === false || v === 0 ? " bad" : ""), title: `${label}: ${v === null || v === undefined ? "n/a" : v ? "ok" : "failed"}` },
      el("i", { text: v === true || v === 1 ? "✓" : v === false || v === 0 ? "✕" : "–" }), label);
  }
  function renderLastOrder() {
    const o = S.state && S.state.lastOrder;
    if (!o) { home.last.replaceChildren(el("span", { class: "muted", text: "No order yet" })); return; }
    const c = o.checks || {};
    const all = [c.screen, c.api, c.chain].filter((v) => v !== null && v !== undefined);
    const verified = o.status === "done" && all.length > 0 && all.every(Boolean);
    let text;
    if (o.test) text = `PAPER test · ${sym(o)} · ${money(o.usd)} · ${String(o.status).replace(/^test /, "")}`;
    else if (o.status === "done") text = `${o.side === "buy" ? "Bought" : "Sold"} ${sym(o)} · ${money(o.usd)} · ${verified ? "verified" : "not verified"}`;
    else text = `${o.side === "buy" ? "Buy" : "Sell"} ${sym(o)} · ${money(o.usd)} · ${o.status}`;
    home.last.replaceChildren(el("span", { style: "min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap", text }),
      el("span", { class: "checks" }, checkChip("screen", c.screen), checkChip("api", c.api), checkChip("chain", c.chain)));
  }
  function openFull() {
    if (!S.screen || !S.screen.frame || !frontImg) return;
    const img = el("img", { src: frontImg.src, alt: "Bot's computer" });
    let scale = 1, tx = 0, ty = 0;
    const pts = new Map();
    let start = null;
    const apply = () => (img.style.transform = `translate(calc(-50% + ${tx}px), calc(-50% + ${ty}px)) scale(${scale})`);
    const box = el("div", { class: "fullscreen" }, img);
    box.addEventListener("pointerdown", (e) => { pts.set(e.pointerId, [e.clientX, e.clientY]); box.setPointerCapture(e.pointerId); start = snap(); });
    box.addEventListener("pointermove", (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, [e.clientX, e.clientY]);
      const s = snap();
      if (pts.size === 2 && start && start.d) { scale = Math.min(6, Math.max(1, start.scale * s.d / start.d)); }
      if (start) { tx = start.tx + (s.cx - start.cx); ty = start.ty + (s.cy - start.cy); }
      if (scale === 1) { tx = 0; ty = 0; }
      apply();
    });
    const up = (e) => { pts.delete(e.pointerId); start = pts.size ? snap() : null; };
    box.addEventListener("pointerup", up); box.addEventListener("pointercancel", up);
    box.addEventListener("dblclick", () => { scale = 1; tx = ty = 0; apply(); });
    function snap() {
      const a = [...pts.values()];
      const cx = a.reduce((s, p) => s + p[0], 0) / (a.length || 1), cy = a.reduce((s, p) => s + p[1], 0) / (a.length || 1);
      const d = a.length === 2 ? Math.hypot(a[0][0] - a[1][0], a[0][1] - a[1][1]) : 0;
      return { cx, cy, d, scale, tx, ty };
    }
    const coin = S.screen.coin;
    box.append(el("button", { class: "iconbtn close", "aria-label": "Close", onclick: () => history.back() },
      svg("svg", { viewBox: "0 0 24 24" }, svg("path", { d: "M6 6l12 12M18 6 6 18" }))));
    const bar = el("div", { class: "bar" });
    const fl = coin && fomoLink(coin.link, `Open ${sym(coin)} on FOMO`, "btn grey");
    if (fl) bar.append(fl);
    box.append(bar);
    box.addEventListener("pointerdown", (e) => e.stopPropagation());
    $("#stack").append(box);
    stack.push(box);
    history.pushState({ depth: stack.length }, "");
  }

  // ---------- BOT CARDS
  function ring(score, min) {
    const r = 26, c = 2 * Math.PI * r;
    const v = isNum(score) ? Math.max(0, Math.min(100, score)) : 0;
    const col = !isNum(score) ? "rgba(235,235,245,0.3)" : score >= min ? "#00d35a" : "#ff453a";
    return svg("svg", { class: "ring", viewBox: "0 0 64 64" },
      svg("circle", { cx: "32", cy: "32", r: String(r), fill: "none", stroke: "#2c2c2e", "stroke-width": "6" }),
      svg("circle", { cx: "32", cy: "32", r: String(r), fill: "none", stroke: col, "stroke-width": "6", "stroke-linecap": "round",
        "stroke-dasharray": `${c * v / 100} ${c}`, transform: "rotate(-90 32 32)" }),
      svg("text", { x: "32", y: "38", "text-anchor": "middle" }, isNum(score) ? String(Math.round(score)) : NA));
  }
  function botHead(b, right) {
    const dot = !b.alive ? "rgba(235,235,245,0.3)" : b.paused ? "#ff9f0a" : b.color;
    return el("div", { class: "bhead" }, el("span", { class: "sdot", style: `background:${dot}` }),
      el("span", { style: `color:${b.color}`, text: b.name }), el("span", { class: "right", text: right || (b.alive ? (b.paused ? "Paused" : "Running") : "Stale") }));
  }
  function botCard(b) {
    const card = el("div", { class: "bcard" });
    if (b.bot === "scanner") {
      card.append(botHead(b), el("div", { class: "bbig", text: `${b.pools} pools` }),
        el("div", { class: "feed" }, ...(b.feed || []).slice(0, 5).map((f) => {
          const pass = f.verdict === "pass";
          return el("div", { class: "row " + (pass ? "pass" : "killed") }, el("span", { class: "sym", text: sym(f) }),
            el("span", { class: "why", text: pass ? "→ Analyst" : (f.reason || f.verdict) }));
        }), !(b.feed || []).length ? el("div", { class: "muted", text: "No pools yet" }) : null));
    } else if (b.bot === "analyst") {
      const l = b.last;
      const strips = el("div", { class: "strips" }, ...Array.from({ length: 8 }, (_, i) => {
        const v = l ? l.layers[i] : null;
        return el("span", { class: v === true ? "g" : v === false ? "r" : "" });
      }));
      card.append(botHead(b), el("div", { class: "bbig", text: `${b.takenApart} taken apart` }),
        el("div", { class: "ringrow" }, ring(l ? l.score : null, b.minScore),
          el("div", { style: "flex:1;min-width:0" }, strips,
            el("div", { class: "muted", style: "font-size:13px;margin-top:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap", text: l ? `${sym(l)} · ${l.pass ? "passed" : l.reason || "rejected"}` : "No audit yet" }),
            el("div", { style: "font-size:13px;margin-top:2px", text: b.social === "off" ? "Social: off" : (l && isNum(l.socialPts) ? `Social +${l.socialPts}` : "Social n/a") }))));
    } else if (b.bot === "brain") {
      const l = b.last;
      const full = l && isNum(l.score) ? l.score >= b.fullScore : null;
      card.append(botHead(b, "Sizing"),
        el("div", { class: "bbig", text: l && isNum(l.sizeUsd) ? `${money(l.sizeUsd)} · ${l.pctOfCash}% of cash` : (l ? "Skipped" : "No sizing yet") }),
        el("div", { class: "muted", style: "font-size:13px", text: l ? `${sym(l)}${isNum(l.score) ? " · score " + l.score : ""}${l.reason ? " · " + l.reason : ""}` : "Waits for a coin that passes Analyst" }),
        el("div", { class: "pills", style: "margin-top:auto" },
          el("span", { class: "pill mono " + (full === true ? "green" : "grey"), text: `${b.fullScore}+ = full size` }),
          el("span", { class: "pill mono " + (full === false ? "green" : "grey"), text: b.belowPct === 50 ? `under ${b.fullScore} = half size` : `under ${b.fullScore} = ${b.belowPct}% size` })));
    } else if (b.bot === "executor") {
      const s = b.state;
      let bar;
      if (!s) bar = el("div", { class: "statusbar muted", text: "Idle" });
      else if (s.kind === "dip") bar = el("div", { class: "statusbar", text: `Waiting for a dip -${b.dipPct}% · ${sym(s)}` });
      else if (s.kind === "clicking") bar = el("div", { class: "statusbar", style: "color:#00d35a", text: `Clicking Buy... ${sym(s)}` });
      else bar = el("div", { class: "statusbar", style: s.verified ? "color:#00d35a" : "color:#ff9f0a", text: `✓ Bought ${sym(s)} · ${s.verified ? "verified" : "not verified"}` });
      card.append(botHead(b), el("div", { class: "bbig", text: `${b.trades} trades` }), bar);
    } else {
      card.append(botHead(b, b.status), el("div", { class: "bbig", text: b.status }),
        el("div", { class: "muted", style: "font-size:13px", text: b.open ? `${b.open} open position${b.open > 1 ? "s" : ""}` : "No open position" }),
        el("div", { class: "pills", style: "margin-top:auto" },
          el("span", { class: "pill mono red", text: `stop -${b.stopPct}%` }), el("span", { class: "pill mono green", text: `trail ${b.trailPct}%` })));
    }
    return card;
  }

  // ---------- ACTIVITY rows
  function actRow(r) {
    const v = r.value || "";
    const cls = r.kind === "reject" ? "muted" : v.startsWith("+") ? "up" : v.startsWith("-") ? "down" : "";
    return el("div", { class: "lrow", role: "button", tabindex: "0", onclick: () => r.mint && pushView(r.open === "audit" ? "audit" : "coin", r.mint) },
      el("div", { class: "main" }, el("div", { class: "ttl", text: r.title || "" }), el("div", { class: "subt", text: r.subtitle || "" })),
      el("div", { class: "val " + cls, text: v }), fomoLink(r.link, "FOMO"));
  }
  function renderActivity() {
    const t = $("#tab-activity");
    t.replaceChildren(el("div", { class: "navbar" }, el("h1", { text: "Activity" })), offlineRow());
    if (!S.activity) { t.append(el("div", { class: "list" }, ...[0, 1, 2, 3, 4].map(() => el("div", { class: "lrow" }, el("div", { class: "sk", style: "height:36px;flex:1" }))))); return; }
    const rows = S.activity.rows;
    if (!rows.length) { t.append(el("div", { class: "empty", text: "Nothing yet tonight" })); return; }
    t.append(el("div", { class: "list" }, ...rows.map(actRow)));
    if (S.activity.more) t.append(el("div", { style: "text-align:center;padding:12px" },
      el("button", { class: "linkbtn", text: "Load more", onclick: loadMoreActivity })));
  }
  async function loadMoreActivity() {
    const next = (S.activity.page || 0) + 1;
    try {
      const p = await loadJSON(`activity/${next}.json`);
      S.activity = { ...p, rows: S.activity.rows.concat(p.rows) };
      renderActivity();
    } catch (e) { toast("Couldn't load more"); }
  }

  // ---------- BOTS tab
  function decRow(bot, r) {
    let main;
    if (bot === "scanner") main = r.verdict === "pass" ? "→ Analyst" : `${r.verdict} · ${r.reason || ""}`;
    else if (bot === "analyst") main = r.pass ? `passed · score ${r.score}` : (r.reason || "rejected");
    else if (bot === "brain") main = isNum(r.sizeUsd) ? `${money(r.sizeUsd)} · ${r.pctOfCash}% of cash` : `skip · ${r.reason || ""}`;
    else main = `${r.side || ""} ${money(r.usd)} · ${r.status || ""}${r.reason ? " · " + r.reason : ""}`;
    return el("div", { class: "row" }, el("div", { class: "l" }, el("div", { style: "font-weight:600", text: sym(r) }), el("div", { class: "muted", style: "font-size:13px", text: main })),
      el("span", { class: "t", text: clock(tsOf(r.ts)) }), fomoLink(r.link, "FOMO"));
  }
  function renderBots() {
    const t = $("#tab-bots");
    t.replaceChildren(el("div", { class: "navbar" }, el("h1", { text: "Bots" })), offlineRow());
    const st = S.state;
    if (!st) { t.append(...[0, 1, 2].map(() => el("div", { class: "bfull sk", style: "height:140px" }))); return; }
    for (const b of st.bots) {
      const locked = b.bot === "risk" && b.locked;
      const sw = el("span", { class: "switch" + (b.paused ? "" : " on") + (locked ? " locked" : "") });
      const swBtn = el("button", { class: "switchwrap", "aria-label": `Pause ${b.name}`, onclick: () => {
        if (locked) return toast("Risk can't pause while a position is open");
        command(b.paused ? `Resume ${b.name}` : `Pause ${b.name}`, `${b.paused ? "resume" : "pause"} ${b.name}`);
      } }, locked ? el("span", { class: "faint", text: "🔒" }) : null, sw);
      const dec = S.dec[b.bot];
      const card = el("div", { class: "bfull" },
        el("div", { class: "top" }, el("span", { class: "sdot", style: `width:10px;height:10px;border-radius:5px;background:${!b.alive ? "rgba(235,235,245,0.3)" : b.paused ? "#ff9f0a" : "#00d35a"}` }),
          el("div", { class: "grow" }, el("div", { class: "name", style: `color:${b.color}`, text: b.name }),
            el("div", { class: "count", text: `${isNum(b.today) ? b.today : NA} tonight · ${b.alive ? "heartbeat " + b.ageS + "s ago" : b.ageS === null ? "no heartbeat" : "stale " + age(b.ageS)}` })),
          swBtn),
        el("div", { class: "dec" }, ...(dec ? (dec.rows.length ? dec.rows.slice(0, S.open[b.bot] ? 20 : 5).map((r) => decRow(b.bot, r)) : [el("div", { class: "row muted", text: "No decisions yet" })])
          : [el("div", { class: "row" }, el("div", { class: "sk", style: "height:30px;flex:1" }))])),
        dec && dec.rows.length > 5 ? el("button", { class: "linkbtn", style: "margin-right:16px", text: S.open[b.bot] ? "Show fewer" : `Last ${Math.min(20, dec.rows.length)} decisions`,
          onclick: () => { S.open[b.bot] = !S.open[b.bot]; renderBots(); } }) : null,
        el("button", { class: "linkbtn", text: "Settings ›", onclick: () => { go("account"); setTimeout(() => document.getElementById("grp-" + b.name)?.scrollIntoView({ block: "start" }), 50); } }));
      t.append(card);
    }
  }

  // ---------- ACCOUNT tab
  function renderAccount(force) {
    if (S.dirty.size && !force) return;  // never wipe what you're typing
    const t = $("#tab-account");
    const a = S.account, st = S.state;
    t.replaceChildren(el("div", { class: "navbar" }, el("h1", { text: "Account" })), offlineRow());
    if (!a) { t.append(...[0, 1, 2].map(() => el("div", { class: "group" }, el("div", { class: "sk", style: "height:96px" })))); return; }
    const group = (name, ...rows) => el("div", { class: "group", id: "grp-" + name }, el("h3", { text: name }), el("div", { class: "gcard" }, ...rows));
    // mode
    const seg = el("div", { class: "seg" },
      el("button", { class: a.mode === "PAPER" ? "on" : "", text: "PAPER" }),
      el("button", { class: a.mode === "LIVE" ? "on" : "", text: "LIVE", onclick: liveSheet }));
    t.append(group("Mode", el("div", { class: "setting" }, seg,
      el("div", { class: "rng", style: "margin-top:8px", text: "LIVE needs 1 full PAPER night, STEP 15 passed and you typing LIVE." }))));
    // cash + FOMO
    const cashIn = el("input", { class: "field", type: "number", inputmode: "decimal", value: isNum(a.cash) ? a.cash.toFixed(2) : "", "aria-label": "PAPER cash" });
    cashIn.addEventListener("input", () => S.dirty.add("cash"));
    cashIn.addEventListener("change", () => {
      const v = parseFloat(cashIn.value), r = a.ranges.paper_start_cash;
      S.dirty.delete("cash");
      if (!isNum(v) || v < r[0] || v > r[1]) return toast(`Out of range: ${r[0]} to ${r[1]}`);
      command("PAPER cash", `set paper_start_cash to ${v}`, "Send this in your Grok Bot chat. PAPER cash restarts from this number at the next PAPER reset.");
    });
    const profileRow = a.profile ? fomoLink(a.profile, "", "grow2") : null;
    if (profileRow) profileRow.append(el("span", { class: "k", text: "Your FOMO profile" }), el("span", { class: "v", text: "@" + (a.fomoHandle || "") }), el("span", { class: "chev", text: "›" }));
    t.append(group("Cash", el("div", { class: "grow2" }, el("span", { class: "k", text: "PAPER cash" }), cashIn)),
      group("FOMO", profileRow || el("div", { class: "grow2 muted", text: "No FOMO handle set" }),
        el("button", { class: "grow2", onclick: () => invite(a.signupUrl) }, el("span", { class: "k", text: "Invite a friend" }), el("span", { class: "chev", text: "›" }))));
    // settings per bot (STEP 12)
    for (const g of a.groups) {
      const items = g.items.filter((i) => i.key !== "mode");
      t.append(group(g.name, ...items.map((i) => settingRow(i))));
    }
    // copy picks
    let every = "off";
    const time = el("input", { type: "time", value: "09:00", "aria-label": "Copy picks time" });
    const pseg = el("div", { class: "seg" }, ...["off", "24h", "12h", "6h"].map((v) => el("button", { class: v === every ? "on" : "", text: v === "off" ? "Off" : "Every " + v,
      onclick: (e) => { every = v; pseg.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === e.currentTarget)); } })));
    t.append(group("Copy picks", el("div", { class: "setting" }, pseg,
      el("div", { class: "top", style: "margin-top:10px" }, el("span", { class: "k", style: "font-family:var(--textf)", text: "Time" }), time),
      el("div", { class: "rng", style: "margin-top:6px", text: a.copyPicks.note }),
      el("button", { class: "linkbtn", text: "Set copy picks", onclick: () => command("Copy picks", every === "off" ? "set copy_picks to off" : `set copy_picks to every ${every} at ${time.value}`) }))));
    // pushes
    t.append(group("Pushes",
      el("div", { class: "grow2" }, el("span", { class: "k", text: "Telegram" }), el("span", { class: "v", style: a.pushes.connected ? "color:#00d35a" : "", text: a.pushes.connected ? "Telegram connected" : "Not connected" })),
      el("div", { class: "setting" }, el("div", { class: "rng", style: "font-family:var(--textf);font-size:13px", text: a.pushes.note })),
      el("button", { class: "grow2", disabled: !a.pushes.connected, style: a.pushes.connected ? "" : "opacity:.4", onclick: () => command("Test push", "test push") },
        el("span", { class: "k", text: "Send test push" }), el("span", { class: "v", text: a.pushes.connected ? "copy command ›" : "after you press Start" }))));
    t.append(group("Grok Bot",
      el("div", { class: "grow2" }, el("span", { class: "k", text: "Watch in Grok Bot" }), el("span", { class: "v", text: "in the Grok Bot app" })),
      el("div", { class: "setting" }, el("div", { class: "rng", style: "font-family:var(--textf);font-size:13px", text: "Open this bot in the Grok Bot app to watch its computer live. The LIVE SCREEN card on Home shows the newest order screenshot every 15 s." }))));
    t.append(el("div", { class: "empty", style: "padding:10px 16px 30px;font-size:12px", text: `Hosting ${a.hosting} · last update ${st ? clockS(st.publishedAt) : NA}` }));
  }
  function settingRow(i) {
    const row = el("div", { class: "setting" });
    const err = el("div", { class: "err", hidden: true });
    const send = el("button", { class: "linkbtn", hidden: true });
    const show = (v) => {
      S.dirty.add(i.key);
      if (String(v) === String(i.value)) { send.hidden = true; S.dirty.delete(i.key); return; }
      send.hidden = false; send.textContent = `Send "set ${i.key} to ${v}" ›`;
      send.onclick = () => { S.dirty.delete(i.key); command(i.label, `set ${i.key} to ${v}`); };
    };
    let input;
    if (i.kind === "number") {
      input = el("input", { type: "number", inputmode: "decimal", value: i.value, min: i.min, max: i.max, step: i.step || "any", "aria-label": i.key });
      const sl = el("input", { type: "range", min: i.min, max: i.max, step: i.step || (i.max - i.min <= 5 ? 0.05 : i.max - i.min <= 100 ? 0.5 : 1), value: i.value, "aria-label": i.key + " slider" });
      sl.addEventListener("input", () => { input.value = sl.value; err.hidden = true; show(sl.value); });
      input.addEventListener("input", () => {
        const v = parseFloat(input.value);
        if (!isNum(v) || v < i.min || v > i.max) { err.hidden = false; err.textContent = `Out of range: ${i.min} to ${i.max}`; send.hidden = true; S.dirty.add(i.key); return; }
        err.hidden = true; sl.value = v; show(v);
      });
      row.append(el("div", { class: "top" }, el("span", { class: "k", text: i.label }), input), sl,
        el("div", { class: "rng", text: `${i.min} – ${i.max}` }), err, send);
    } else if (i.kind === "bool") {
      let v = !!i.value;
      const sw = el("span", { class: "switch" + (v ? " on" : "") });
      row.append(el("div", { class: "top" }, el("span", { class: "k", text: i.label }),
        el("button", { class: "switchwrap", "aria-label": i.key, onclick: () => { v = !v; sw.classList.toggle("on", v); show(v); } }, sw)), send);
    } else if (i.kind === "choice") {
      input = el("select", { "aria-label": i.key }, ...i.choices.map((c) => el("option", { value: c, text: c, selected: c === i.value })));
      input.addEventListener("change", () => show(input.value));
      row.append(el("div", { class: "top" }, el("span", { class: "k", text: i.label }), input), send);
    } else {
      const isTime = /_time$|night_start/.test(i.key);
      input = el("input", { type: isTime ? "time" : "text", value: i.value ?? "", "aria-label": i.key, autocapitalize: "off", autocomplete: "off", spellcheck: "false" });
      input.addEventListener("input", () => show(input.value));
      row.append(el("div", { class: "top" }, el("span", { class: "k", text: i.label }), input), send);
    }
    return row;
  }
  function liveSheet() {
    sheet((sh, close) => {
      const inp = el("input", { class: "searchin", placeholder: "Type LIVE", autocapitalize: "characters", autocomplete: "off", spellcheck: "false" });
      const go2 = el("button", { class: "btn red", text: "Switch to LIVE", disabled: true });
      const msg = el("p");
      inp.addEventListener("input", () => (go2.disabled = inp.value !== "LIVE"));
      go2.addEventListener("click", () => {
        msg.textContent = "LIVE is locked. It needs 1 full PAPER night and STEP 15 passed first. Nothing changed: the desk stays PAPER.";
        msg.style.color = "#ff9f0a"; go2.disabled = true;
      });
      sh.append(el("h3", { text: "Switch to LIVE" }), el("p", { text: "LIVE clicks Buy and Sell with real money in your FOMO account." }), inp, go2, msg,
        el("button", { class: "btn grey", text: "Cancel", onclick: close }));
      setTimeout(() => inp.focus(), 50);
    });
  }
  async function invite(url) {
    if (!url) return;
    try { if (navigator.share) { await navigator.share({ url }); return; } } catch (e) { if (e && e.name === "AbortError") return; }
    copy(url, "Link copied");
  }

  // ---------- search + bell
  function openSearch() {
    sheet((sh, close) => {
      const inp = el("input", { class: "searchin", placeholder: "Name, symbol or mint", autocapitalize: "off", autocomplete: "off", spellcheck: "false" });
      const list = el("div", { style: "margin-top:10px" });
      const run = () => {
        const q = inp.value.trim().toLowerCase();
        const coins = (S.state && S.state.coins) || [];
        const hits = !q ? coins.slice(0, 12) : coins.filter((c) => [c.name, c.symbol, c.mint].some((x) => x && x.toLowerCase().includes(q)));
        list.replaceChildren(...(hits.length ? hits.slice(0, 30).map((c) => el("div", { class: "lrow", style: "padding:0", role: "button", onclick: () => { close(); pushView("coin", c.mint); } },
          el("div", { class: "main" }, el("div", { class: "ttl", text: c.symbol || c.mint.slice(0, 6) }), el("div", { class: "subt", text: c.name || c.mint })), fomoLink(c.link, "FOMO")))
          : [el("p", { text: "Not on the desk. Send \"buy X\" with the name or mint in your Grok Bot chat and Analyst audits it." })]));
      };
      inp.addEventListener("input", run);
      sh.append(el("h3", { text: "Search" }), inp, list);
      run();
      setTimeout(() => inp.focus(), 50);
    });
  }
  function openBell() {
    const ps = (S.state && S.state.pushes) || [];
    if (ps[0]) localStorage.setItem("desk.pushSeen", String(tsOf(ps[0].ts)));
    home.bell.querySelector(".dot")?.remove();
    sheet((sh, close) => {
      sh.append(el("h3", { text: "Pushes" }),
        el("p", { text: "Logged by the desk. Telegram sends them from STEP 11." }),
        ...(ps.length ? ps.map((p) => el("div", { class: "lrow", style: "padding:0" },
          el("div", { class: "main" }, el("div", { class: "subt", text: `Grok Bot · ${clock(tsOf(p.ts))}` }), el("div", { style: "white-space:normal", text: p.text || "" })),
          fomoLink(p.link, "FOMO"))) : [el("div", { class: "empty", text: "No pushes yet" })]),
        el("button", { class: "btn grey", text: "Close", onclick: close }));
    });
  }

  // ---------- COIN + AUDIT screens
  async function renderView(v) {
    if (v._kind === "coin") return renderCoin(v);
    if (v._kind === "audit") return renderAudit(v);
  }
  async function renderCoin(v, refresh) {
    const mint = v._arg;
    if (!refresh) v.replaceChildren(el("div", { class: "navbar" }, backBtn()), el("div", { class: "coinhead" },
      el("div", { class: "sk", style: "height:34px;width:60%" }), el("div", { class: "sk", style: "height:66px;width:70%;margin-top:14px" })),
      el("div", { class: "candlewrap sk", style: "margin:16px" }));
    let c;
    try { c = await loadJSON(`coin/${mint}.json`); }
    catch (e) {
      if (!refresh) v.replaceChildren(el("div", { class: "navbar" }, backBtn()), el("div", { class: "empty", text: e.status === 404 ? "This coin isn't on the desk right now." : "Desk offline · couldn't load this coin" }));
      return;
    }
    const st = S.state || {};
    const p = c.position;
    const sh = c.shield || {};
    const shield = el("span", { class: "shield" + (!sh.checked ? " none" : sh.pass === 8 ? "" : " part") },
      svg("svg", { viewBox: "0 0 12 12" }, svg("path", { d: "M6 0 11 2v4c0 3-2.2 5.2-5 6-2.8-.8-5-3-5-6V2z" })),
      sh.checked ? `${sh.pass}/8` : "not audited");
    const big = el("div", { class: "big", text: price(c.price) });
    const canvas = el("canvas");
    const statsAge = c.statsTs ? ` · ${clock(tsOf(c.statsTs))}` : "";
    v.replaceChildren(
      el("div", { class: "navbar" }, backBtn()),
      el("div", { class: "coinhead" },
        el("div", { class: "nm" }, el("span", { style: "overflow:hidden;text-overflow:ellipsis;white-space:nowrap", text: c.name || sym(c) }), st.mode === "PAPER" ? el("span", { class: "pill paper", text: "PAPER" }) : null),
        el("div", { class: "meta" }, `${sym(c)} · Solana${c.ageS ? " · " + age(c.ageS) + " old" : ""}`,
          el("button", { onclick: () => pushView("audit", mint), "aria-label": "Audit" }, shield)),
        big,
        p && isNum(p.pnlPct) ? el("div", { class: p.pnlPct >= 0 ? "up" : "down", style: "font-size:17px", text: `${p.pnlPct >= 0 ? "▲" : "▼"} ${Math.abs(p.pnlPct).toFixed(2)}% since entry` })
          : el("div", { class: "muted", style: "font-size:15px", text: c.priceTs ? `price at ${clock(c.priceTs)}` : "no price yet" })),
      el("div", { class: "candlewrap" }, canvas, !c.candles.length ? el("div", { class: "chartempty", text: "No 1-minute prices yet" }) : null),
      el("div", { class: "stats" },
        el("div", { class: "stat" }, el("div", { class: "l", text: "Market cap" }), el("div", { class: "v", text: short$(c.marketCap) })),
        el("div", { class: "stat" }, el("div", { class: "l", text: "Liquidity" }), el("div", { class: "v", text: short$(c.liquidityUsd) })),
        el("div", { class: "stat" }, el("div", { class: "l", text: "Holders" }), el("div", { class: "v", text: isNum(c.holders) ? c.holders.toLocaleString("en-US") : "n/a" }))),
      el("div", { class: "faint", style: "font-size:12px;margin:6px 16px 0", text: c.statsTs ? `From the last Scanner read${statsAge}` : "" }),
      el("div", { class: "poscard" }, p ? el("span", {}, "Your position · ", el("b", { text: money(p.sizeUsd) }), " in · Executor",
        isNum(p.pnlUsd) ? el("span", { class: p.pnlUsd >= 0 ? "up" : "down", text: `  ${p.pnlUsd >= 0 ? "+" : "-"}$${Math.abs(p.pnlUsd).toFixed(2)}` }) : null)
        : el("span", { class: "muted", text: "No position in this coin" })),
      el("div", { class: "btnrow" }, fomoLink(c.link, "Open on FOMO", "btn grey"),
        el("button", { class: "btn red", text: "Sell now", disabled: !p, onclick: () => sellSheet(c) })));
    requestAnimationFrame(() => DeskChart.candles(canvas, { candles: c.candles, exit: c.exit, entry: p ? p.entry : null }));
  }
  function sellSheet(c) {
    sheet((sh, close) => {
      let pctSel = 100;
      const seg = el("div", { class: "seg" }, ...[25, 50, 100].map((n) => el("button", { class: n === pctSel ? "on" : "", text: n + "%",
        onclick: (e) => { pctSel = n; seg.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === e.currentTarget)); } })));
      sh.append(el("h3", { text: `Sell ${sym(c)}` }), seg,
        el("button", { class: "btn red", text: "Confirm sell", onclick: () => { close(); command(`Sell ${pctSel}% of ${sym(c)}`, `sell ${c.symbol || c.mint} ${pctSel}`, "Send this in your Grok Bot chat. It asks \"Sell " + pctSel + "% of " + sym(c) + " now?\", you say yes, and Executor clicks it."); } }),
        el("button", { class: "btn grey", text: "Cancel", onclick: close }));
    });
  }
  async function renderAudit(v) {
    const mint = v._arg;
    v.replaceChildren(el("div", { class: "navbar" }, backBtn()), el("div", { class: "discs" }, ...Array.from({ length: 8 }, () => el("div", { class: "disc sk" }))));
    let a;
    try { a = await loadJSON(`audit/${mint}.json`); }
    catch (e) { v.replaceChildren(el("div", { class: "navbar" }, backBtn()), el("div", { class: "empty", text: e.status === 404 ? "No audit for this coin on the desk." : "Desk offline · couldn't load the audit" })); return; }
    const layers = a.layers || [];
    const discs = Array.from({ length: 8 }, (_, i) => {
      const l = layers[i];
      const cls = !l ? "x" : l.pass === true ? "g" : l.pass === false ? "r" : "x";
      return el("div", {}, el("div", { class: "disc " + cls }, el("span", { class: "n", text: String(i + 1) }), el("span", { class: "beam" }),
        el("span", { class: "mark", text: cls === "g" ? "✓" : cls === "r" ? "✕" : "–" })), el("div", { class: "dlabel", text: l ? l.name : "" }));
    });
    const sc = a.score;
    const social = a.social || {};
    v.replaceChildren(el("div", { class: "navbar" }, backBtn()),
      el("div", { class: "coinhead" }, el("div", { class: "nm", text: `Audit · ${sym(a)}` }),
        el("div", { class: "meta", text: a.ts ? `Analyst · ${clock(tsOf(a.ts))}${sc && isNum(sc.score) ? " · score " + sc.score : ""}` : "Not audited yet" })),
      el("div", { class: "discs" }, ...discs),
      el("div", { class: "sechead" }, el("h2", { text: "Layers" })),
      layers.length ? el("div", { class: "list" }, ...layers.map((l) => el("div", { class: "lrow" },
        el("div", { class: "main" }, el("div", { class: "ttl", text: `${l.n} · ${l.name}` }), el("div", { class: "subt", text: l.source ? `source: ${l.source}` : "" })),
        el("div", { class: "val " + (l.pass === true ? "up" : l.pass === false ? "down" : "faint"), style: "max-width:55%;white-space:normal", text: l.value || "" }))))
        : el("div", { class: "empty", text: "Analyst hasn't read this coin's layers." }),
      el("div", { class: "list", style: "margin-top:12px" }, el("div", { class: "lrow" }, el("div", { class: "main" }, el("div", { class: "ttl", text:
        social.off ? "Social: off" : `Social ${isNum(social.pts) ? "+" + social.pts : "n/a"} · ${isNum(social.u15) ? social.u15 : "n/a"} accounts in 15m · ${isNum(social.smart) ? social.smart : "n/a"} top traders hold` })))),
      sc && sc.reason ? el("div", { class: "muted", style: "margin:10px 16px", text: (sc.pass ? "Passed" : "Rejected") + " · " + sc.reason }) : null,
      el("div", { class: "btnrow" }, fomoLink(a.link, "Open on FOMO", "btn grey")));
    // the cyan beam reads each layer, then the check or cross
    const nodes = [...v.querySelectorAll(".disc")];
    if (reduceMotion()) { nodes.forEach((n) => n.classList.add("done")); return; }
    let i = 0;
    const step = () => {
      if (!v.isConnected || i >= nodes.length) return;
      const n = nodes[i++];
      n.classList.add("scan");
      setTimeout(() => { n.classList.add("done"); step(); }, 420);
    };
    step();
  }

  // ---------- offline row: "Desk offline · retrying in {n}s · last update {time}"
  function offlineText() {
    const st = S.state;
    const stale = st && now() - st.publishedAt > STALE_S;
    if (!S.err && !stale) return null;
    const n = Math.max(0, Math.ceil(S.nextTry - now()));
    return `Desk offline · retrying in ${n}s · last update ${st ? clock(st.publishedAt) : NA}`;
  }
  function offlineRow() {
    const t = offlineText();
    return el("div", { class: "offline", hidden: !t, text: t || "" });
  }
  function paintOffline() {
    const t = offlineText();
    document.querySelectorAll(".offline").forEach((n) => { n.hidden = !t; if (t) n.textContent = t; });
  }

  // ---------- tabs
  function go(tab) {
    S.tab = tab;
    document.querySelectorAll(".tab").forEach((t) => (t.hidden = t.dataset.tab !== tab));
    document.querySelectorAll("#tabbar button").forEach((b) => b.classList.toggle("on", b.dataset.go === tab));
    while (stack.length) { popView(); }
    if (tab === "bots") { renderBots(); refreshDecisions(); }
    if (tab === "activity") renderActivity();
    if (tab === "account") renderAccount();
    if (tab === "home") requestAnimationFrame(() => drawChart(false));
    window.scrollTo(0, 0);
  }
  document.querySelectorAll("#tabbar button").forEach((b) => b.addEventListener("click", () => go(b.dataset.go)));

  // ---------- polling (plan B: every publish_s, 15 s)
  let newest = 0;
  async function refreshChart() {
    try { S.chart[S.range] = await loadJSON(`chart/${S.range}.json`); drawChart(true); } catch (e) { /* keep the last good chart */ }
  }
  async function refreshDecisions() {
    if (!S.state) return;
    await Promise.all(S.state.bots.map(async (b) => {
      try { S.dec[b.bot] = await loadJSON(`bots/${b.bot}/decisions.json`); } catch (e) { /* keep last good */ }
    }));
    if (S.tab === "bots" && !stack.length) renderBots();
  }
  async function tick() {
    const period = ((S.state && S.state.publishS) || 15) * 1000;
    try {
      const s = await loadJSON("state.json");
      if (s.publishedAt >= newest) { newest = s.publishedAt; S.state = s; }  // a stale CDN copy never steps back
      S.err = false; S.lastOk = now();
      await Promise.all([
        refreshChart(),
        loadJSON("activity/0.json").then((a) => { S.activity = a; }).catch(() => {}),
        loadJSON("account.json").then((a) => { S.account = a; }).catch(() => {}),
        refreshScreen().catch(() => {}),
      ]);
      renderHome();
      if (S.tab === "activity") renderActivity();
      if (S.tab === "account") renderAccount();
      if (S.tab === "bots") refreshDecisions();
      const top = stack[stack.length - 1];
      if (top && top._kind === "coin") renderCoin(top, true);
    } catch (e) {
      S.err = true;
      if (!S.state && (e.name === "OperationError")) return fatal("This link's key doesn't open the desk files. Open the newest desk link from Grok Bot.");
    }
    S.nextTry = now() + period / 1000;
    paintOffline();
    setTimeout(tick, period);
  }
  setInterval(() => { paintOffline(); renderScreenText(); }, 1000);
  window.addEventListener("resize", () => drawChart(false));

  function fatal(msg) {
    $("#tab-home").replaceChildren(el("div", { class: "nokey" }, el("h2", { text: "Desk" }), el("p", { text: msg })));
  }

  (async () => {
    buildHome();
    renderActivity(); renderBots(); renderAccount();
    if (!K || !D) return fatal("Open your desk link from Grok Bot once. It carries the key, and this phone keeps it.");
    try { keys = await deriveKeys(); } catch (e) { return fatal("This link's key is broken. Open the newest desk link from Grok Bot."); }
    tick();
  })();
})();
