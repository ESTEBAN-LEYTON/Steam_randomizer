"use strict";

// ---------- Constantes ----------
const LS_CONFIG = "steamBacklog.config";
const LS_LEGACY_INF = "steamBacklog.infinitos"; // versión anterior: solo infinitos
const LS_INSTALLED = "steamBacklog.installed";
const PAGE = 60;
const NONE = "none";

// Las tres carpetas principales: siempre existen y siempre cuentan en el reparto.
const MAIN = [
  { id: "pend", nombre: "Pendientes", color: "var(--pend)" },
  { id: "inf", nombre: "Infinitos", color: "var(--inf)" },
  { id: "plat", nombre: "Por platinar", color: "var(--plat)" },
];
const EXTRA_COLORS = ["#1aa39a", "#d4507a", "#6c8a1f", "#b5653a", "#4a6fd1", "#9a6b2e", "#7c5cbf", "#2b8a57"];

const DEFAULT_CONFIG = { horas_pendiente: 2, carpetas: [], asignaciones: {} };

const $ = (id) => document.getElementById(id);
const state = {
  games: [],
  config: structuredClone(DEFAULT_CONFIG),
  fileConfig: structuredClone(DEFAULT_CONFIG),
  filter: "pend",
  query: "",
  shown: PAGE,
};

// ---------- Carpetas ----------
function folders() {
  const extra = state.config.carpetas.map((c, i) => ({ ...c, color: EXTRA_COLORS[i % EXTRA_COLORS.length] }));
  return [...MAIN.map((m) => ({ ...m, reparto: true, main: true })), ...extra];
}
function folderById(id) {
  return folders().find((f) => f.id === id);
}

function autoFolder(g) {
  const limit = Number(state.config.horas_pendiente) * 60;
  if (limit > 0 && g.playtime_min < limit) return "pend";
  if (g.ach_total > 0 && g.ach_done < g.ach_total) return "plat";
  return NONE;
}

// Carpeta final de un juego: la elegida a mano o, si no hay, la automática.
function folderOf(g) {
  const manual = state.config.asignaciones[g.appid];
  if (manual === NONE) return NONE;
  if (manual && folderById(manual)) return manual;
  return autoFolder(g);
}

// ---------- Matemáticas ----------
const gcd = (a, b) => (b ? gcd(b, a % b) : Math.abs(a));

/**
 * Método del mayor residuo (Hamilton).
 * Reparte `total` en proporción a `weights`, sin que ninguna parte supere su peso.
 */
function largestRemainder(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  const n = Math.max(0, Math.min(Math.floor(total), sum));
  if (sum === 0 || n === 0) return weights.map(() => 0);
  const quotas = weights.map((w) => (n * w) / sum);
  const result = quotas.map(Math.floor);
  let left = n - result.reduce((a, b) => a + b, 0);
  const order = quotas
    .map((q, i) => ({ i, r: q - Math.floor(q), w: weights[i] }))
    .sort((a, b) => b.r - a.r || b.w - a.w || a.i - b.i);
  for (const { i } of order) {
    if (left === 0) break;
    if (result[i] < weights[i]) { result[i]++; left--; }
  }
  return result;
}

// ---------- Configuración (config.json + localStorage) ----------
function normalizeConfig(raw) {
  const c = { ...structuredClone(DEFAULT_CONFIG), ...(raw || {}) };
  c.carpetas = Array.isArray(c.carpetas) ? c.carpetas.filter((f) => f && f.id && f.nombre) : [];
  c.asignaciones = c.asignaciones && typeof c.asignaciones === "object" ? { ...c.asignaciones } : {};
  // Formato antiguo: {"infinitos": [appid, ...]}
  if (Array.isArray(c.infinitos)) {
    for (const id of c.infinitos) c.asignaciones[id] ??= "inf";
    delete c.infinitos;
  }
  const h = Number(c.horas_pendiente);
  c.horas_pendiente = Number.isFinite(h) && h >= 0 ? h : 2;
  return c;
}

function lsGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function lsSet(key, value) {
  try { localStorage.setItem(key, value); } catch {}
}
function lsDel(key) {
  try { localStorage.removeItem(key); } catch {}
}

function saveConfig() {
  lsSet(LS_CONFIG, JSON.stringify(state.config));
}

function loadLocalConfig() {
  const raw = lsGet(LS_CONFIG);
  if (raw) {
    try { return normalizeConfig(JSON.parse(raw)); } catch {}
  }
  // Migrar los infinitos guardados por la versión anterior
  const legacy = lsGet(LS_LEGACY_INF);
  if (legacy) {
    try {
      const c = structuredClone(state.fileConfig);
      for (const id of JSON.parse(legacy)) c.asignaciones[id] = "inf";
      lsDel(LS_LEGACY_INF);
      return c;
    } catch {}
  }
  return null;
}

async function fetchJSON(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

// ---------- Utilidades de DOM ----------
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "style") for (const [p, val] of Object.entries(v)) node.style.setProperty(p, val);
    else if (k in node) node[k] = v;
    else node.setAttribute(k, v);
  }
  node.append(...children.filter((c) => c != null));
  return node;
}
const fmtPct = (n) => `${n.toLocaleString("es", { maximumFractionDigits: 1 })} %`;

// ---------- Render: contadores y reparto ----------
function counts() {
  const c = Object.fromEntries(folders().map((f) => [f.id, 0]));
  c[NONE] = 0;
  for (const g of state.games) c[folderOf(g)]++;
  return c;
}

function renderCounters() {
  const c = counts();
  const included = folders().filter((f) => f.reparto);
  const values = included.map((f) => c[f.id]);
  const total = values.reduce((a, b) => a + b, 0);
  const tenths = largestRemainder(total ? 1000 : 0, values.map((v) => v * 1000)).map((t) => t / 10);

  $("counters").replaceChildren(
    ...included.map((f, i) =>
      el("div", { className: "counter", style: { "--c": f.color } },
        el("span", { className: "label" }, f.nombre),
        el("strong", {}, String(values[i])),
        el("span", { className: "pct" }, fmtPct(tenths[i])))
    )
  );
  $("counters").style.gridTemplateColumns = `repeat(${Math.min(included.length, 3)}, 1fr)`;
  $("bar").replaceChildren(
    ...included.map((f, i) =>
      el("span", { style: { background: f.color, width: total ? `${(values[i] / total) * 100}%` : "0" } }))
  );

  const g = values.reduce(gcd, 0);
  $("ratio-labels").textContent = included.map((f) => initials(f.nombre)).join(" : ");
  $("ratio").textContent = g ? values.map((v) => v / g).join(" : ") : "—";

  // Carpetas que no cuentan en el reparto + sin carpeta
  const extras = folders().filter((f) => !f.reparto);
  $("extra").replaceChildren(
    ...extras.map((f) => chip(f.nombre, c[f.id], f.color)),
    chip("Sin carpeta", c[NONE], "var(--muted)")
  );
  $("others").textContent = state.games.length
    ? `${total} juegos cuentan en el reparto, de ${state.games.length} en tu biblioteca.`
    : "";
  renderAllocation(included, values);
}

function chip(name, n, color) {
  return el("span", { className: "chip", style: { "--c": color } }, el("i"), `${name}: `, el("b", {}, String(n)));
}

function initials(name) {
  return name.split(/\s+/).filter(Boolean).map((w) => w[0].toUpperCase()).join("").slice(0, 3);
}

let lastAlloc = null;
function renderAllocation(included, values) {
  if (included) lastAlloc = { included, values };
  if (!lastAlloc) return;
  ({ included, values } = lastAlloc);
  const raw = parseInt($("installed").value, 10);
  const wanted = Number.isFinite(raw) && raw > 0 ? raw : 0;
  const alloc = largestRemainder(wanted, values);
  $("alloc").replaceChildren(
    ...included.map((f, i) =>
      el("div", { style: { "--c": f.color } }, el("span", {}, f.nombre), el("strong", {}, String(alloc[i]))))
  );
  $("alloc").style.gridTemplateColumns = `repeat(${Math.min(included.length, 3)}, 1fr)`;
  const sum = values.reduce((a, b) => a + b, 0);
  $("alloc-note").textContent =
    wanted > sum
      ? `Solo tienes ${sum} juegos en estas carpetas, así que el reparto se limita a ${sum}.`
      : "Reparto proporcional con el método del mayor residuo.";
}

// ---------- Render: pestañas y lista ----------
function renderTabs() {
  const c = counts();
  const tabs = [...folders().map((f) => ({ id: f.id, nombre: f.nombre })), { id: NONE, nombre: "Sin carpeta" }, { id: "all", nombre: "Todos" }];
  if (!tabs.some((t) => t.id === state.filter)) state.filter = "pend";
  $("tabs").replaceChildren(
    ...tabs.map((t) => {
      const b = el("button", { className: t.id === state.filter ? "active" : "", type: "button" },
        t.nombre, el("small", {}, ` ${t.id === "all" ? state.games.length : c[t.id]}`));
      b.addEventListener("click", () => {
        state.filter = t.id;
        state.shown = PAGE;
        renderTabs();
        renderList();
      });
      return b;
    })
  );
}

function hours(min) {
  const h = min / 60;
  return h < 10 ? h.toLocaleString("es", { maximumFractionDigits: 1 }) : Math.round(h).toString();
}

const LEGACY_IMG = (appid) =>
  `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}/capsule_231x87.jpg`;

function thumb(g) {
  const sources = [g.img, LEGACY_IMG(g.appid), g.icon].filter(Boolean);
  const box = el("div", { className: "thumb" });
  const img = el("img", { alt: "", loading: "lazy", decoding: "async", referrerPolicy: "no-referrer" });
  let i = 0;
  img.addEventListener("error", () => {
    i++;
    if (i < sources.length) {
      img.src = sources[i];
      if (sources[i] === g.icon) box.classList.add("icon");
    } else {
      box.replaceChildren(el("span", {}, initials(g.name)));
      box.classList.add("ph");
    }
  });
  img.src = sources[0];
  box.append(img);
  return box;
}

function folderSelect(g) {
  const manual = state.config.asignaciones[g.appid];
  const auto = autoFolder(g);
  const autoName = auto === NONE ? "Sin carpeta" : folderById(auto).nombre;
  const sel = el("select", { className: "folder-sel" + (manual ? " manual" : ""), "aria-label": `Carpeta de ${g.name}` },
    el("option", { value: "" }, `Auto: ${autoName}`),
    ...folders().map((f) => el("option", { value: f.id }, f.nombre)),
    el("option", { value: NONE }, "Sin carpeta"));
  sel.value = manual && (manual === NONE || folderById(manual)) ? manual : "";
  sel.addEventListener("change", () => {
    if (sel.value) state.config.asignaciones[g.appid] = sel.value;
    else delete state.config.asignaciones[g.appid];
    saveConfig();
    refresh();
  });
  return sel;
}

function renderList() {
  const q = state.query.trim().toLocaleLowerCase("es");
  const items = state.games.filter((g) => {
    if (state.filter !== "all" && folderOf(g) !== state.filter) return false;
    return !q || g.name.toLocaleLowerCase("es").includes(q);
  });
  const list = $("list");
  list.replaceChildren();
  if (!items.length) {
    list.append(el("li", { className: "empty" }, state.games.length ? "No hay juegos aquí." : "Sin datos todavía."));
  }
  for (const g of items.slice(0, state.shown)) {
    const f = folderById(folderOf(g));
    const ach = g.ach_total
      ? ` · ${g.ach_done}/${g.ach_total} logros (${Math.floor((g.ach_done / g.ach_total) * 100)} %)`
      : " · sin logros";
    list.append(
      el("li", { style: { "--c": f ? f.color : "var(--line)" } },
        thumb(g),
        el("div", { className: "info" },
          el("div", { className: "name" }, g.name),
          el("div", { className: "meta" }, `${hours(g.playtime_min)} h${ach}`),
          folderSelect(g)))
    );
  }
  const rest = items.length - state.shown;
  $("more").hidden = rest <= 0;
  $("more").textContent = `Mostrar más (${rest} restantes)`;
}

// ---------- Render: gestión de carpetas ----------
function renderFolders() {
  const c = counts();
  $("folders").replaceChildren(
    ...MAIN.map((m) =>
      el("li", { style: { "--c": m.color } }, el("i"), el("span", { className: "fname" }, m.nombre),
        el("span", { className: "muted small" }, `${c[m.id]} · principal`))),
    ...state.config.carpetas.map((f, idx) => {
      const color = EXTRA_COLORS[idx % EXTRA_COLORS.length];
      const name = el("input", { type: "text", value: f.nombre, maxLength: 40, className: "fname-input", "aria-label": "Nombre" });
      name.addEventListener("change", () => {
        const v = name.value.trim();
        if (!v) { name.value = f.nombre; return; }
        f.nombre = v;
        saveConfig();
        refresh();
      });
      const rep = el("input", { type: "checkbox", checked: !!f.reparto });
      rep.addEventListener("change", () => { f.reparto = rep.checked; saveConfig(); refresh(); });
      const del = el("button", { type: "button", className: "icon-btn", title: "Borrar carpeta" }, "✕");
      del.addEventListener("click", () => {
        if (!confirm(`¿Borrar «${f.nombre}»? Sus ${c[f.id]} juegos vuelven a la clasificación automática.`)) return;
        state.config.carpetas = state.config.carpetas.filter((x) => x.id !== f.id);
        for (const [k, v] of Object.entries(state.config.asignaciones)) if (v === f.id) delete state.config.asignaciones[k];
        saveConfig();
        refresh();
      });
      return el("li", { style: { "--c": color } }, el("i"), name,
        el("label", { className: "rep" }, rep, "Reparto"),
        el("span", { className: "muted small count" }, String(c[f.id])), del);
    })
  );
  $("hours").value = state.config.horas_pendiente;
}

function refresh() {
  renderCounters();
  renderTabs();
  renderList();
  renderFolders();
}

// ---------- Generador aleatorio ----------
function randInt(maxExclusive) {
  const limit = Math.floor(0x100000000 / maxExclusive) * maxExclusive;
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf); while (buf[0] >= limit);
  return buf[0] % maxExclusive;
}

function generate() {
  const out = $("r-out");
  out.classList.remove("err");
  let min = parseInt($("r-min").value, 10);
  let max = parseInt($("r-max").value, 10);
  const count = parseInt($("r-count").value, 10);
  const unique = $("r-unique").checked;
  const fail = (msg) => { out.textContent = msg; out.classList.add("err"); };
  if (![min, max, count].every(Number.isFinite)) return fail("Completa los tres campos.");
  if (min > max) [min, max] = [max, min];
  if (count < 1) return fail("La cantidad debe ser al menos 1.");
  const size = max - min + 1;
  if (size > 0xffffffff) return fail("El rango es demasiado grande.");
  if (count > 10000) return fail("Máximo 10 000 números.");
  if (unique && count > size) return fail(`Sin repetir solo hay ${size} números posibles entre ${min} y ${max}.`);

  let nums;
  if (unique) {
    // Fisher–Yates parcial sobre un mapa disperso: sirve para rangos enormes
    const swap = new Map();
    nums = [];
    for (let i = 0; i < count; i++) {
      const j = i + randInt(size - i);
      const vj = swap.has(j) ? swap.get(j) : j;
      const vi = swap.has(i) ? swap.get(i) : i;
      swap.set(j, vi);
      nums.push(min + vj);
    }
  } else {
    nums = Array.from({ length: count }, () => min + randInt(size));
  }
  nums.sort((a, b) => a - b);
  out.textContent = nums.join(", ");
}

// ---------- Eventos ----------
function bindEvents() {
  $("installed").addEventListener("input", () => {
    lsSet(LS_INSTALLED, $("installed").value);
    renderAllocation();
  });
  $("r-go").addEventListener("click", generate);
  $("search").addEventListener("input", (e) => { state.query = e.target.value; state.shown = PAGE; renderList(); });
  $("more").addEventListener("click", () => { state.shown += PAGE; renderList(); });

  $("new-folder").addEventListener("submit", (e) => {
    e.preventDefault();
    const nombre = $("new-name").value.trim();
    if (!nombre) return;
    const id = "c" + Date.now().toString(36);
    state.config.carpetas.push({ id, nombre, reparto: false });
    $("new-name").value = "";
    saveConfig();
    refresh();
  });

  $("hours").addEventListener("change", () => {
    const h = Number($("hours").value);
    state.config.horas_pendiente = Number.isFinite(h) && h >= 0 ? h : 2;
    saveConfig();
    refresh();
  });

  $("export").addEventListener("click", () => {
    const body = JSON.stringify(state.config, null, 2) + "\n";
    const a = el("a", { href: URL.createObjectURL(new Blob([body], { type: "application/json" })), download: "config.json" });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $("reset").addEventListener("click", () => {
    if (!confirm("¿Descartar los cambios de este navegador y usar config.json?")) return;
    lsDel(LS_CONFIG);
    state.config = structuredClone(state.fileConfig);
    refresh();
  });
}

// ---------- Inicio ----------
async function init() {
  bindEvents();
  const saved = lsGet(LS_INSTALLED);
  if (saved !== null) $("installed").value = saved;

  const [data, config] = await Promise.allSettled([fetchJSON("data.json"), fetchJSON("config.json")]);
  if (config.status === "fulfilled") state.fileConfig = normalizeConfig(config.value);
  state.config = loadLocalConfig() ?? structuredClone(state.fileConfig);

  if (data.status === "fulfilled") {
    state.games = data.value.games || [];
    const when = data.value.generated_at ? new Date(data.value.generated_at) : null;
    $("updated").textContent = when
      ? `Actualizado: ${when.toLocaleString("es", { dateStyle: "medium", timeStyle: "short" })}`
      : "Aún no hay datos: ejecuta el GitHub Action.";
  } else {
    $("updated").textContent = "No se pudo cargar data.json.";
  }
  refresh();
}

// ---------- App instalable (PWA) ----------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
let installPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installPrompt = e;
  $("install").hidden = false;
});
$("install").addEventListener("click", async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  $("install").hidden = true;
});
window.addEventListener("appinstalled", () => { $("install").hidden = true; });
const showOnline = () => $("updated").classList.toggle("offline", !navigator.onLine);
window.addEventListener("offline", showOnline);
window.addEventListener("online", showOnline);
showOnline();

init();
