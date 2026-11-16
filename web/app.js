// STEP 8 pipe test: read #k (DATA_KEY) and #d (DATA_PATH) once, keep them in localStorage,
// strip the fragment, poll the encrypted state file, decrypt with WebCrypto, show a readout.
(() => {
  const SALT = new TextEncoder().encode("fomo-desk");
  const enc = new TextEncoder();
  const $ = (id) => document.getElementById(id);

  function unb64u(s) {
    s = s.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  }

  // fragment -> localStorage, then remove it from the address bar
  const frag = new URLSearchParams(location.hash.slice(1));
  if (frag.get("k")) localStorage.setItem("desk.k", frag.get("k"));
  if (frag.get("d")) localStorage.setItem("desk.d", frag.get("d"));
  if (location.hash) history.replaceState(null, "", location.pathname + location.search);

  const K = localStorage.getItem("desk.k");
  const D = localStorage.getItem("desk.d");

  let keys = null;
  async function deriveKeys() {
    const master = await crypto.subtle.importKey("raw", unb64u(K), "HKDF", false, ["deriveBits"]);
    const bits = async (info) => crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt: SALT, info: enc.encode(info) }, master, 256);
    const aes = await crypto.subtle.importKey("raw", await bits("fomo-desk enc v1"), "AES-GCM", false, ["decrypt"]);
    const nameKey = await crypto.subtle.importKey("raw", await bits("fomo-desk name v1"),
      { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return { aes, nameKey };
  }

  async function fileId(name) {
    const mac = new Uint8Array(await crypto.subtle.sign("HMAC", keys.nameKey, enc.encode(name)));
    return Array.from(mac.slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
  }

  async function load(name) {
    const url = `d/${D}/${await fileId(name)}.bin?t=${Date.now()}`;
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
    const blob = new Uint8Array(await r.arrayBuffer());
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: blob.slice(0, 12), additionalData: enc.encode(name) }, keys.aes, blob.slice(12));
    return JSON.parse(new TextDecoder().decode(plain));
  }

  // GitHub Pages edges sometimes serve an older copy for a while: never step backwards.
  let newest = 0;
  const money = (v) => (v === null || v === undefined ? "—" : "$" + v.toFixed(2));

  async function tick() {
    try {
      const s = await load("state.json");
      if (s.publishedAt < newest) return;  // stale CDN copy, keep the newer one on screen
      newest = s.publishedAt;
      $("mode").textContent = "· " + s.mode;
      $("bal").textContent = money(s.balance);
      const age = Math.round(Date.now() / 1000 - s.publishedAt);
      $("meta").textContent = `cash ${money(s.cash)} · ×${s.multiplier === null ? "—" : s.multiplier.toFixed(3)}` +
        ` · ${s.positions.length} open · published ${age}s ago`;
      $("bots").innerHTML = s.bots.map((b) =>
        `<tr><td style="color:${b.color}">● ${b.name}</td><td>${b.alive ? "alive" : "stale"}</td>` +
        `<td class="muted">heartbeat ${b.ageS === null ? "—" : b.ageS + "s ago"}</td></tr>`).join("");
      $("err").textContent = "";
    } catch (e) {
      $("err").textContent = String(e.message || e);
    }
  }

  (async () => {
    if (!K || !D) { $("err").textContent = "Open the desk link once (it carries the key in #k=…&d=…)."; return; }
    try { keys = await deriveKeys(); } catch (e) { $("err").textContent = "bad key"; return; }
    tick();
    setInterval(tick, 15000);
  })();
})();
