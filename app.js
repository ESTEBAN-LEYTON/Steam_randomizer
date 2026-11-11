"use strict";

// ---------- Criterios ----------
const PENDING_MINUTES = 120;      // menos de 2 h jugadas = pendiente
const LS_KEY = "steamBacklog.infinitos";
const LS_INSTALLED = "steamBacklog.installed";
const CATS = ["pend", "inf", "plat"];

const $ = (id) => document.getElementById(id);
const state = { games: [], infinite: new Set(), configInfinite: [], filter: "pend", query: "" };

// Cada juego cae en UNA sola categoría, por prioridad:
// 1) infinito (marcado a mano)  2) pendiente (< 2 h)  3) por platinar (con logros y < 100 %)
// El resto (jugado y platinado o sin logros) no cuenta en el backlog.
function category(g) {
  if (state.infinite.has(g.appid)) return "inf";
  if (g.playtime_min < PENDING_MINUTES) return "pend";
  if (g.ach_total > 0 && g.ach_done < g.ach_total) return "plat";
  return null;
}

// ---------- Utilidades matemáticas ----------
const gcd = (a, b) => (b ? gcd(b, a % b) : Math.abs(a));

/**
 * Método del mayor residuo (Hamilton).
 * Reparte `total` en proporción a `weights`, sin que ninguna parte supere su peso
 * (no puedes instalar más juegos de los que tienes en esa categoría).
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

// ---------- Infinitos (config.json + localStorage) ----------
function loadLocalInfinite() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function saveLocalInfinite() {
  try { localStorage.setItem(LS_KEY, JSON.stringify([...state.infinite])); } catch {}
}

async function fetchJSON(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

// ---------- Render ----------
function counts() {
  const c = { pend: 0, inf: 0, plat: 0, other: 0 };
  for (const g of state.games) c[category(g) || "other"]++;
  return c;
}

function renderCounters() {
  const c = counts();
  const values = CATS.map((k) => c[k]);
  const total = values.reduce((a, b) => a + b, 0);
  // Porcentajes en décimas con mayor residuo para que sumen exactamente 100 %
  const tenths = largestRemainder(total ? 1000 : 0, values.map((v) => v * 1000)).map((t) => t / 10);
  CATS.forEach((k, i) => {
    $(`n-${k}`).textContent = values[i];
    $(`p-${k}`).textContent = `${tenths[i].toLocaleString("es", { maximumFractionDigits: 1 })} %`;
    $(`b-${k}`).style.width = total ? `${(values[i] / total) * 100}%` : "0";
  });
  const g = values.reduce(gcd, 0);
  $("ratio").textContent = g ? values.map((v) => v / g).join(" : ") : "—";
  $("others").textContent = state.games.length
    ? `${total} en backlog de ${state.games.length} juegos. ${c.other} ya terminados (≥ 2 h y 100 % o sin logros).`
    : "";
  renderAllocation(values);
}

function renderAllocation(values = CATS.map((k) => counts()[k])) {
  const raw = parseInt($("installed").value, 10);
  const wanted = Number.isFinite(raw) && raw > 0 ? raw : 0;
  const alloc = largestRemainder(wanted, values);
  CATS.forEach((k, i) => ($(`a-${k}`).textContent = alloc[i]));
  const sum = values.reduce((a, b) => a + b, 0);
  $("alloc-note").textContent =
    wanted > sum
      ? `Solo tienes ${sum} juegos en el backlog, así que el reparto se limita a ${sum}.`
      : "Reparto proporcional con el método del mayor residuo.";
}

function hours(min) {
  const h = min / 60;
  return h < 10 ? h.toLocaleString("es", { maximumFractionDigits: 1 }) : Math.round(h).toString();
}

function renderList() {
  const q = state.query.trim().toLocaleLowerCase("es");
  const list = $("list");
  const items = state.games.filter((g) => {
    const cat = category(g);
    if (state.filter !== "all" && cat !== state.filter) return false;
    return !q || g.name.toLocaleLowerCase("es").includes(q);
  });
  list.replaceChildren();
  if (!items.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = state.games.length ? "No hay juegos aquí." : "Sin datos todavía.";
    list.append(li);
    return;
  }
  const frag = document.createDocumentFragment();
  for (const g of items.slice(0, 500)) {
    const cat = category(g);
    const li = document.createElement("li");
    const dot = document.createElement("span");
    dot.className = `dot ${cat ? "c-" + cat : ""}`;
    const info = document.createElement("div");
    info.className = "info";
    const name = document.createElement("div");
    name.className = "name";
    name.textContent = g.name;
    const meta = document.createElement("div");
    meta.className = "meta";
    const ach = g.ach_total
      ? ` · ${g.ach_done}/${g.ach_total} logros (${Math.floor((g.ach_done / g.ach_total) * 100)} %)`
      : " · sin logros";
    meta.textContent = `${hours(g.playtime_min)} h${ach}`;
    info.append(name, meta);
    const btn = document.createElement("button");
    btn.className = "inf-btn" + (state.infinite.has(g.appid) ? " on" : "");
    btn.textContent = "∞";
    btn.title = "Marcar como infinito";
    btn.setAttribute("aria-pressed", state.infinite.has(g.appid));
    btn.addEventListener("click", () => toggleInfinite(g.appid));
    li.append(dot, info, btn);
    frag.append(li);
  }
  list.append(frag);
}

function toggleInfinite(appid) {
  state.infinite.has(appid) ? state.infinite.delete(appid) : state.infinite.add(appid);
  saveLocalInfinite();
  renderCounters();
  renderList();
}

// ---------- Generador aleatorio ----------
function randInt(maxExclusive) {
  // Entero uniforme en [0, maxExclusive) sin sesgo de módulo
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
  out.textContent = nums.join(", ");
}

// ---------- Eventos ----------
function bindEvents() {
  $("installed").addEventListener("input", () => {
    try { localStorage.setItem(LS_INSTALLED, $("installed").value); } catch {}
    renderAllocation();
  });
  $("r-go").addEventListener("click", generate);
  $("search").addEventListener("input", (e) => { state.query = e.target.value; renderList(); });
  document.querySelectorAll(".tabs button").forEach((b) =>
    b.addEventListener("click", () => {
      document.querySelectorAll(".tabs button").forEach((x) => x.classList.toggle("active", x === b));
      state.filter = b.dataset.filter;
      renderList();
    })
  );
  $("export").addEventListener("click", () => {
    const body = JSON.stringify({ infinitos: [...state.infinite].sort((a, b) => a - b) }, null, 2) + "\n";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([body], { type: "application/json" }));
    a.download = "config.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $("reset").addEventListener("click", () => {
    if (!confirm("¿Descartar los cambios de este navegador y usar config.json?")) return;
    try { localStorage.removeItem(LS_KEY); } catch {}
    state.infinite = new Set(state.configInfinite);
    renderCounters();
    renderList();
  });
}

// ---------- Inicio ----------
async function init() {
  bindEvents();
  try {
    const saved = localStorage.getItem(LS_INSTALLED);
    if (saved !== null) $("installed").value = saved;
  } catch {}

  const [data, config] = await Promise.allSettled([fetchJSON("data.json"), fetchJSON("config.json")]);

  if (config.status === "fulfilled") {
    state.configInfinite = (config.value.infinitos || []).map(Number);
  }
  const local = loadLocalInfinite();
  state.infinite = new Set(local ?? state.configInfinite);

  if (data.status === "fulfilled") {
    state.games = data.value.games || [];
    const when = data.value.generated_at ? new Date(data.value.generated_at) : null;
    $("updated").textContent = when
      ? `Actualizado: ${when.toLocaleString("es", { dateStyle: "medium", timeStyle: "short" })}`
      : "Aún no hay datos: ejecuta el GitHub Action.";
  } else {
    $("updated").textContent = "No se pudo cargar data.json.";
  }
  renderCounters();
  renderList();
}

init();
