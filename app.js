"use strict";

// ---------- Constantes ----------
const LS_CONFIG = "steamBacklog.config";
const LS_LEGACY_INF = "steamBacklog.infinitos"; // versión anterior: solo infinitos
const LS_INSTALLED = "steamBacklog.installed";
const LS_VIEW = "steamBacklog.view"; // "grid" | "list"
const LS_COLLAPSED = "steamBacklog.collapsed";
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
  view: "grid",
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

const STEAM_CDN = "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/";
const LEGACY_IMG = (appid) => `${STEAM_CDN}${appid}/capsule_231x87.jpg`;
const LEGACY_COVER = (appid) => `${STEAM_CDN}${appid}/library_600x900.jpg`;

// Fuentes de imagen de un juego: primero las portadas verticales (como la biblioteca de Steam),
// luego las cápsulas horizontales, que se muestran centradas con el nombre debajo.
function imageSources(g) {
  return {
    tall: [g.cover, LEGACY_COVER(g.appid)].filter(Boolean),
    wide: [g.img, LEGACY_IMG(g.appid)].filter(Boolean),
  };
}

// Portada vertical 2:3 con las alternativas en cadena si alguna imagen no existe.
function cover(g) {
  const { tall, wide } = imageSources(g);
  const sources = [...tall.map((src) => ({ src, wide: false })), ...wide.map((src) => ({ src, wide: true }))];
  const box = el("div", { className: "cover" });
  const img = el("img", { alt: g.name, loading: "lazy", decoding: "async", referrerPolicy: "no-referrer" });
  let i = 0;
  const show = () => {
    img.src = sources[i].src;
    if (sources[i].wide && !box.classList.contains("wide")) {
      box.classList.add("wide");
      box.append(el("span", { className: "cover-name" }, g.name));
    }
  };
  img.addEventListener("error", () => {
    i++;
    if (i < sources.length) return show();
    img.remove();
    box.classList.remove("wide");
    box.classList.add("ph");
    box.replaceChildren(el("span", { className: "cover-name" }, g.name));
  });
  box.append(img);
  show();
  return box;
}

// Miniatura horizontal para la vista compacta.
function thumb(g) {
  const sources = [...imageSources(g).wide, g.icon].filter(Boolean);
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

// Juegos de la pestaña actual que coinciden con la búsqueda.
function filteredGames() {
  const q = state.query.trim().toLocaleLowerCase("es");
  return state.games.filter((g) => {
    if (state.filter !== "all" && folderOf(g) !== state.filter) return false;
    return !q || g.name.toLocaleLowerCase("es").includes(q);
  });
}

function achText(g) {
  return g.ach_total ? `${g.ach_done}/${g.ach_total} logros` : "sin logros";
}

function renderList() {
  const items = filteredGames();
  const grid = state.view === "grid";
  const list = $("list");
  list.className = grid ? "list grid" : "list";
  list.replaceChildren();
  if (!items.length) {
    list.append(el("li", { className: "empty" }, state.games.length ? "No hay juegos aquí." : "Sin datos todavía."));
  }
  for (const g of items.slice(0, state.shown)) {
    const f = folderById(folderOf(g));
    const color = f ? f.color : "var(--line)";
    if (grid) {
      const pct = g.ach_total ? Math.floor((g.ach_done / g.ach_total) * 100) : null;
      const c = cover(g);
      if (pct !== null) c.append(el("span", { className: "badge" + (pct === 100 ? " full" : "") }, `${pct} %`));
      list.append(
        el("li", { className: "tile", style: { "--c": color }, title: `${g.name} · ${hours(g.playtime_min)} h · ${achText(g)}` },
          c,
          el("div", { className: "t-name" }, g.name),
          el("div", { className: "t-meta" }, achText(g)),
          el("div", { className: "t-hours" }, hours(g.playtime_min), el("small", {}, " h")),
          folderSelect(g)));
    } else {
      list.append(
        el("li", { style: { "--c": color } },
          thumb(g),
          el("div", { className: "info" },
            el("div", { className: "name" }, g.name),
            el("div", { className: "meta" }, `${hours(g.playtime_min)} h · ${achText(g)}`),
            folderSelect(g)))
      );
    }
  }
  const rest = items.length - state.shown;
  $("more").hidden = rest <= 0;
  $("more").textContent = `Mostrar más (${rest} restantes)`;
  $("snapshot").disabled = !items.length;
}

function setView(view) {
  state.view = view === "list" ? "list" : "grid";
  lsSet(LS_VIEW, state.view);
  $("view-grid").classList.toggle("active", state.view === "grid");
  $("view-list").classList.toggle("active", state.view === "list");
  renderList();
}

function setCollapsed(collapsed) {
  $("games-body").hidden = collapsed;
  $("collapse").setAttribute("aria-expanded", String(!collapsed));
  $("collapse").textContent = collapsed ? "▾" : "▴";
  $("collapse").title = collapsed ? "Mostrar lista" : "Comprimir lista";
  $("games-card").classList.toggle("collapsed", collapsed);
  lsSet(LS_COLLAPSED, collapsed ? "1" : "");
}

// ---------- Imagen descargable con todas las portadas de la lista ----------
const MAX_PIXELS = 16_000_000; // límite seguro de canvas en móviles (iOS ≈ 16,7 M)
const MAX_SIDE = 16_000;

async function loadBitmap(url) {
  const res = await fetch(url, { mode: "cors", credentials: "omit" });
  if (!res.ok) throw new Error(res.status);
  return createImageBitmap(await res.blob());
}

async function coverBitmap(g) {
  const { tall, wide } = imageSources(g);
  for (const [urls, isWide] of [[tall, false], [wide, true]]) {
    for (const url of urls) {
      try { return { bmp: await loadBitmap(url), wide: isWide }; } catch {}
    }
  }
  return null;
}

async function mapPool(items, limit, fn, onDone) {
  const out = new Array(items.length);
  let next = 0, done = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
      onDone(++done);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function wrapText(ctx, text, maxWidth, maxLines) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width <= maxWidth || !line) line = test;
    else { lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    let last = lines[maxLines - 1];
    while (last && ctx.measureText(last + "…").width > maxWidth) last = last.slice(0, -1);
    lines[maxLines - 1] = last + "…";
  }
  return lines;
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

function drawTile(ctx, g, res, x, y, w, h) {
  const r = w * 0.03;
  ctx.save();
  roundRectPath(ctx, x, y, w, h, r);
  ctx.clip();
  ctx.fillStyle = "#1f2733";
  ctx.fillRect(x, y, w, h);
  const font = (size, weight = 700) => `${weight} ${size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  let textTop = y + h * 0.35;
  if (res && !res.wide) {
    // Recorta a 2:3 por si la imagen no tiene exactamente esa proporción
    const { bmp } = res;
    const s = Math.max(w / bmp.width, h / bmp.height);
    const sw = w / s, sh = h / s;
    ctx.drawImage(bmp, (bmp.width - sw) / 2, (bmp.height - sh) / 2, sw, sh, x, y, w, h);
  } else {
    if (res) {
      const { bmp } = res;
      const dh = (w * bmp.height) / bmp.width;
      const dy = y + h * 0.3 - dh / 2;
      ctx.drawImage(bmp, x, dy, w, dh);
      textTop = dy + dh + w * 0.08;
    }
    ctx.fillStyle = "#e6ebf1";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const size = Math.round(w * 0.1);
    ctx.font = font(size);
    wrapText(ctx, g.name, w * 0.86, 4).forEach((l, i) => ctx.fillText(l, x + w / 2, textTop + i * size * 1.2));
  }
  ctx.restore();
}

async function downloadSnapshot() {
  const items = filteredGames();
  if (!items.length) return;
  const btn = $("snapshot");
  const label = btn.textContent;
  btn.disabled = true;
  try {
    const n = items.length;
    const cols = n <= 3 ? n : Math.min(12, Math.max(3, Math.ceil(Math.sqrt(n * 0.85))));
    const rows = Math.ceil(n / cols);
    // Todas las medidas son proporcionales al ancho de la portada (w).
    const GAP = 0.06, PAD = 0.12, HEAD = 0.75;
    const kw = cols + (cols - 1) * GAP + 2 * PAD;
    const kh = HEAD + rows * 1.5 + (rows - 1) * GAP + 2 * PAD;
    const w = Math.floor(Math.min(300, Math.sqrt(MAX_PIXELS / (kw * kh)), MAX_SIDE / kw, MAX_SIDE / kh));
    const h = Math.round(w * 1.5), gap = Math.round(w * GAP), pad = Math.round(w * PAD), head = Math.round(w * HEAD);
    const W = cols * w + (cols - 1) * gap + 2 * pad;
    const H = head + rows * h + (rows - 1) * gap + 2 * pad;

    const bitmaps = await mapPool(items, 8, coverBitmap, (d) => { btn.textContent = `Cargando ${d}/${n}…`; });
    btn.textContent = "Generando…";

    const canvas = el("canvas", { width: W, height: H });
    const ctx = canvas.getContext("2d");
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#1b2838");
    bg.addColorStop(1, "#0e141b");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    const tabName = state.filter === "all" ? "Todos" : state.filter === NONE ? "Sin carpeta" : folderById(state.filter)?.nombre ?? "";
    const title = state.query.trim() ? `${tabName} · «${state.query.trim()}»` : tabName;
    const font = (size, weight) => `${weight} ${size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    ctx.fillStyle = "#ffffff";
    const tSize = Math.round(w * 0.24);
    ctx.font = font(tSize, 800);
    ctx.fillText(title, pad, pad + tSize);
    ctx.fillStyle = "#8f98a0";
    const sSize = Math.round(w * 0.12);
    ctx.font = font(sSize, 500);
    const date = new Date().toLocaleDateString("es", { dateStyle: "medium" });
    ctx.fillText(`${n} ${n === 1 ? "juego" : "juegos"} · ${date}`, pad, pad + tSize + sSize * 1.5);

    items.forEach((g, i) => {
      const x = pad + (i % cols) * (w + gap);
      const y = pad + head + Math.floor(i / cols) * (h + gap);
      drawTile(ctx, g, bitmaps[i], x, y, w, h);
      bitmaps[i]?.bmp.close?.();
    });

    const blob = await new Promise((ok) => canvas.toBlob(ok, "image/jpeg", 0.9));
    if (!blob) throw new Error("toBlob");
    const slug = title.normalize("NFD").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "juegos";
    const a = el("a", { href: URL.createObjectURL(blob), download: `backlog-${slug}.jpg` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  } catch (e) {
    alert("No se pudo generar la imagen. Revisa la conexión e inténtalo de nuevo.");
  } finally {
    btn.textContent = label;
    btn.disabled = false;
  }
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
  $("view-grid").addEventListener("click", () => setView("grid"));
  $("view-list").addEventListener("click", () => setView("list"));
  $("collapse").addEventListener("click", () => setCollapsed(!$("games-body").hidden));
  $("snapshot").addEventListener("click", downloadSnapshot);

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

// ---------- Barra de navegación: resalta la sección visible ----------
function bindDock() {
  const links = [...document.querySelectorAll(".dock a")];
  const byId = new Map(links.map((a) => [a.getAttribute("href").slice(1), a]));
  const visible = new Map();
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) visible.set(e.target.id, e.intersectionRatio);
    let best = null, bestRatio = 0;
    for (const [id, r] of visible) if (r > bestRatio) { best = id; bestRatio = r; }
    if (best) links.forEach((a) => a.classList.toggle("active", a === byId.get(best)));
  }, { threshold: [0, 0.25, 0.5, 0.75, 1], rootMargin: "-20% 0px -30% 0px" });
  for (const id of byId.keys()) { const s = $(id); if (s) io.observe(s); }
  links[0]?.classList.add("active");
}

// ---------- Inicio ----------
async function init() {
  bindEvents();
  bindDock();
  const saved = lsGet(LS_INSTALLED);
  if (saved !== null) $("installed").value = saved;
  state.view = lsGet(LS_VIEW) === "list" ? "list" : "grid";
  $("view-grid").classList.toggle("active", state.view === "grid");
  $("view-list").classList.toggle("active", state.view === "list");
  setCollapsed(lsGet(LS_COLLAPSED) === "1");

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
