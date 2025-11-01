/* ====================== CONFIG & URL PARAMS ====================== */
const JSON_FILE = "./WeatherAndPollution.json";
const params = Object.fromEntries(
  new URLSearchParams(window.location.search).entries()
);
const qCity = params.city?.trim();
const qCity1 = params.city1?.trim();
const qCity2 = params.city2?.trim();
const isSingle = !!qCity && !(qCity1 || qCity2);
const isCompare = !!qCity1 && !!qCity2;

/* ====================== STATE & DOM REFS ====================== */
const state = { raw: null, keys: null };

const statusEl = (t) => (document.getElementById("status").textContent = t);
const warnEl = (t) => (document.getElementById("warn").textContent = t || "");
const chartsRoot = document.getElementById("chartsRoot");

const suggestionBanner = document.getElementById("suggestionBanner");
const suggestionEl = document.getElementById("suggestion");

const compareSummaryWrap = document.getElementById("compareSummaryWrap");
const cmpLeft = document.getElementById("cmpLeft");
const cmpRight = document.getElementById("cmpRight");

const insightsEl = document.getElementById("insights");

document
  .getElementById("reloadBtn")
  .addEventListener("click", () => loadAndRender(true));
document
  .getElementById("backBtn")
  .addEventListener("click", () => history.back());
document
  .getElementById("filterRange")
  .addEventListener("change", () => applyFilterAndRender());

/* ——— HARD HIDE compare box up-front if not in compare mode ——— */
if (!isCompare) {
  // guarantee it's gone visually and takes no space
  compareSummaryWrap.style.display = "none";
  cmpLeft.innerHTML = "";
  cmpRight.innerHTML = "";
}

/* ====================== UTILITIES ====================== */
function parseTimeToMs(v) {
  if (v == null) return null;
  if (typeof v === "number" && !isNaN(v)) return v < 1e12 ? v * 1000 : v;
  const s = String(v).trim();
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    return n < 1e12 ? n * 1000 : n;
  }
  let t = Date.parse(s);
  if (isNaN(t)) t = Date.parse(s.replace(" ", "T"));
  return isNaN(t) ? null : t;
}
function detectKeys(sample) {
  const keys = Object.keys(sample || {}),
    low = (k) => k.toLowerCase(),
    find = (arr) => keys.find((k) => arr.some((s) => low(k).includes(s)));
  return {
    timeKey:
      find(["time", "timestamp", "date", "obs", "datetime"]) || keys[0] || null,
    cityKey:
      find(["city", "location", "place", "site", "station"]) ||
      keys.find((k) => low(k).includes("location")) ||
      null,
    tempKey:
      find(["temp", "temperature", "temperature_2m", "temperaturec"]) || null,
    humKey:
      find(["hum", "humidity", "relative_humidity", "relative_humidity_2m"]) ||
      null,
    pmKey: find(["pm2.5", "pm25", "pm_2_5", "pm2"]) || null,
    aqiKey: find(["aqi", "airquality", "aqi_index", "aqi"]) || null,
  };
}
function buildDailySeries(rows, keys) {
  const buckets = {};
  for (const r of rows) {
    const t = parseTimeToMs(r[keys.timeKey]);
    if (!t) continue;
    const d = new Date(t).toISOString().slice(0, 10);
    buckets[d] ||= { temp: [], hum: [], pm: [], aqi: [] };
    const add = (k, arr) => {
      if (k != null && r[k] != null) {
        const n = Number(String(r[k]).replace(/[^0-9.\-]/g, ""));
        if (!isNaN(n)) arr.push(n);
      }
    };
    add(keys.tempKey, buckets[d].temp);
    add(keys.humKey, buckets[d].hum);
    add(keys.pmKey, buckets[d].pm);
    add(keys.aqiKey, buckets[d].aqi);
  }
  const dates = Object.keys(buckets).sort();
  const avg = (a) =>
    a?.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
  const labels = dates.map((d) =>
    new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    })
  );
  return {
    rawDates: dates,
    labels,
    temperature: dates.map((d) => avg(buckets[d].temp)),
    humidity: dates.map((d) => avg(buckets[d].hum)),
    pm25: dates.map((d) => avg(buckets[d].pm)),
    aqi: dates.map((d) => avg(buckets[d].aqi)),
  };
} 
function mean(a) {
  const b = (a || []).filter((v) => v != null);
  return b.length ? b.reduce((s, v) => s + v, 0) / b.length : null;
}
function scoreTemp(x) {
  if (x == null) return 50;
  if (x <= 28 && x >= 18) return 100;
  if (x < 18) return Math.max(30, 60 + (x / 18) * 40);
  return Math.max(0, 100 - (x - 28) * 4);
}
function scoreHum(x) {
  if (x == null) return 50;
  if (x <= 70 && x >= 40) return 100;
  if (x < 40) return Math.max(30, 60 + (x / 40) * 40);
  return Math.max(0, 100 - (x - 70) * 2);
}
function scoreAQI(x) {
  if (x == null) return 50;
  if (x <= 50) return 100;
  if (x <= 100) return 80;
  if (x <= 200) return 60;
  if (x <= 300) return 40;
  return 20;
}
function scorePM(x) {
  if (x == null) return 50;
  if (x <= 12) return 100;
  if (x <= 35) return 80;
  if (x <= 55) return 60;
  if (x <= 150) return 40;
  return 20;
}
function buildSuggestionLines(avgs, name) {
  const sT = Math.round(scoreTemp(avgs.t)),
    sH = Math.round(scoreHum(avgs.h)),
    sA = Math.round(scoreAQI(avgs.a)),
    sP = Math.round(scorePM(avgs.p));
  const overall = Math.round((sT + sH + sA + sP) / 4),
    label = overall >= 80 ? "Good" : overall >= 60 ? "Moderate" : "Poor";
  return {
    summary: `${name}: overall ${overall}/100 — ${label}.`,
    details: `Temp: ${
      avgs.t == null ? "—" : avgs.t.toFixed(1) + " °C"
    } (score ${sT}). Hum: ${
      avgs.h == null ? "—" : avgs.h.toFixed(1) + " %"
    } (score ${sH}). AQI: ${
      avgs.a == null ? "—" : avgs.a.toFixed(1)
    } (score ${sA}). PM2.5: ${
      avgs.p == null ? "—" : avgs.p.toFixed(1)
    } (score ${sP}).`,
    overall,
  };
}

/* ====================== CHART HELPERS ====================== */
const CHARTS = {};
function clearCharts() {
  for (const k in CHARTS) {
    try {
      CHARTS[k].destroy();
    } catch {}
    delete CHARTS[k];
  }
  chartsRoot.innerHTML = "";
}
function createChartCard(id, title, labels, datasets) {
  const wrap = document.createElement("div");
  wrap.className = "chart-card";
  wrap.innerHTML = `<div class="chart-title">${title}</div><canvas id="${id}"></canvas><div class="axis-label">X: Date — Y (${title
    .split("—")
    .pop()
    .trim()})</div>`;
  chartsRoot.appendChild(wrap);
  const ctx = document.getElementById(id).getContext("2d");
  CHARTS[id] = new Chart(ctx, {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "top", labels: { color: "#ddd" } },
        zoom: {
          zoom: {
            wheel: { enabled: true },
            pinch: { enabled: true },
            mode: "x",
          },
          pan: { enabled: true, mode: "x" },
        },
      },
      scales: {
        x: {
          ticks: {
            color: "#9fb6c3",
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 12,
          },
        },
        y: { ticks: { color: "#9fb6c3" } },
      },
    },
  });
}

/* ====================== DATA LOADING ====================== */
async function loadJSON() {
  statusEl("Loading JSON…");
  const res = await fetch(JSON_FILE);
  if (!res.ok) throw new Error(`Failed to load JSON (${res.status})`);
  const j = await res.json();
  state.raw = Array.isArray(j) ? j : j.records || [];
  if (!state.raw?.length) throw new Error("JSON is empty or not an array");
  state.keys = detectKeys(
    state.raw.find((r) => Object.keys(r || {}).length > 0) || state.raw[0]
  );
  statusEl(`Loaded ${state.raw.length} rows`);
}

/* ====================== FILTERING ====================== */
function filterRowsByCity(city) {
  const ck = state.keys?.cityKey;
  if (!ck) return [];
  const q = (city || "").toLowerCase();
  return state.raw.filter((r) =>
    String(r[ck] || "")
      .toLowerCase()
      .includes(q)
  );
}
function applyDaysFilterToRows(rows, days) {
  if (!rows?.length) return [];
  if (!days || days === "all") return rows;
  const nd = Number(days);
  if (isNaN(nd) || nd <= 0) return rows;
  const times = rows
    .map((r) => parseTimeToMs(r[state.keys.timeKey]))
    .filter(Boolean);
  if (!times.length) return rows;
  const cutoff = Math.max(...times) - nd * 24 * 60 * 60 * 1000;
  const filtered = rows.filter((r) => {
    const t = parseTimeToMs(r[state.keys.timeKey]);
    return t && t >= cutoff;
  });
  if (filtered.length) return filtered;
  const sorted = rows
    .map((r) => ({ r, t: parseTimeToMs(r[state.keys.timeKey]) }))
    .filter((x) => x.t)
    .sort((a, b) => b.t - a.t);
  return sorted
    .slice(0, Math.min(Math.max(7, nd), sorted.length))
    .map((x) => x.r);
}

/* ====================== COMPARE SUMMARY (only when needed) ====================== */
function renderCompareCards(avg1, name1, avg2, name2) {
  compareSummaryWrap.style.display = "flex"; // show ONLY here
  cmpLeft.innerHTML = `
    <div class="cmp-city">${name1}</div>
    <div class="cmp-metric"><div class="m-title">Avg Temp</div><div class="m-value">${
      avg1.t == null ? "—" : avg1.t.toFixed(1) + " °C"
    }</div></div>
    <div class="cmp-metric"><div class="m-title">Avg Hum</div><div class="m-value">${
      avg1.h == null ? "—" : avg1.h.toFixed(1) + " %"
    }</div></div>
    <div class="cmp-metric"><div class="m-title">Avg PM2.5</div><div class="m-value">${
      avg1.p == null ? "—" : avg1.p.toFixed(1)
    }</div></div>
    <div class="cmp-metric"><div class="m-title">Avg AQI</div><div class="m-value">${
      avg1.a == null ? "—" : avg1.a.toFixed(1)
    }</div></div>
  `;
  cmpRight.innerHTML = `
    <div class="cmp-city">${name2}</div>
    <div class="cmp-metric"><div class="m-title">Avg Temp</div><div class="m-value">${
      avg2.t == null ? "—" : avg2.t.toFixed(1) + " °C"
    }</div></div>
    <div class="cmp-metric"><div class="m-title">Avg Hum</div><div class="m-value">${
      avg2.h == null ? "—" : avg2.h.toFixed(1) + " %"
    }</div></div>
    <div class="cmp-metric"><div class="m-title">Avg PM2.5</div><div class="m-value">${
      avg2.p == null ? "—" : avg2.p.toFixed(1)
    }</div></div>
    <div class="cmp-metric"><div class="m-title">Avg AQI</div><div class="m-value">${
      avg2.a == null ? "—" : avg2.a.toFixed(1)
    }</div></div>
  `;
}

/* ====================== MAIN RENDER ====================== */
async function loadAndRender(force = false) {
  try {
    if (force || !state.raw) await loadJSON();

    // reset common UI
    suggestionBanner.style.display = "none";
    suggestionEl.textContent = "";
    warnEl("");
    clearCharts();
    insightsEl.textContent = "Waiting for analysis…";

    // ensure compare widgets are hidden unless explicitly enabled
    compareSummaryWrap.style.display = "none";
    cmpLeft.innerHTML = "";
    cmpRight.innerHTML = "";

    if (!isSingle && !isCompare) {
      statusEl("No city query. Use ?city=Delhi or ?city1=Delhi&city2=Mumbai");
      return;
    }

    const chosen = document.getElementById("filterRange").value;

    /* ---------- SINGLE CITY ---------- */
    if (isSingle) {
      statusEl(`Filtering rows for ${qCity}`);
      const matched = filterRowsByCity(qCity);
      if (!matched.length) {
        statusEl(`No rows found for "${qCity}"`);
        return;
      }

      const used = applyDaysFilterToRows(matched, chosen);
      if (!used.length)
        warnEl(
          `No rows in chosen time range for ${qCity}. Showing full available data for this city instead.`
        );

      const series = buildDailySeries(used.length ? used : matched, state.keys);
      const avg = {
        t: mean(series.temperature),
        h: mean(series.humidity),
        p: mean(series.pm25),
        a: mean(series.aqi),
      };

      const S = buildSuggestionLines(avg, qCity);
      suggestionEl.textContent = `${S.summary} ${S.details}`;
      suggestionBanner.style.display = "flex";

      createChartCard(
        "chartTemp",
        "Daily Avg Temperature (°C)",
        series.labels,
        [
          {
            label: "Temperature",
            data: series.temperature,
            borderColor: "#44a7c0",
            backgroundColor: "#44a7c022",
            fill: true,
            pointRadius: 1.5,
            tension: 0.25,
          },
        ]
      );
      if (series.humidity.some((v) => v != null))
        createChartCard("chartHum", "Daily Avg Humidity (%)", series.labels, [
          {
            label: "Humidity",
            data: series.humidity,
            borderColor: "#6fbf73",
            pointRadius: 1.5,
            tension: 0.25,
          },
        ]);
      if (series.pm25.some((v) => v != null))
        createChartCard("chartPm25", "Daily Avg PM2.5 (µg/m³)", series.labels, [
          {
            label: "PM2.5",
            data: series.pm25,
            borderColor: "#b85c9e",
            backgroundColor: "#b85c9e22",
            fill: true,
            pointRadius: 1.5,
            tension: 0.25,
          },
        ]);
      if (series.aqi.some((v) => v != null))
        createChartCard("chartAqi", "Daily Avg AQI (index)", series.labels, [
          {
            label: "AQI",
            data: series.aqi,
            borderColor: "#d17760",
            backgroundColor: "#d1776022",
            fill: true,
            pointRadius: 1.5,
            tension: 0.25,
          },
        ]);

      const overall = Math.round(
        (scoreTemp(avg.t) +
          scoreHum(avg.h) +
          scoreAQI(avg.a) +
          scorePM(avg.p)) /
          4
      );
      insightsEl.innerHTML = `
        <div><strong>Quick insight:</strong> ${qCity}: overall ${overall}/100 — ${
        overall >= 80 ? "Good" : overall >= 60 ? "Moderate" : "Poor"
      }.</div>
        <div style="margin-top:8px"><strong>Temperature:</strong> ${
          avg.t != null ? avg.t.toFixed(1) + " °C" : "—"
        }</div>
        <div style="margin-top:6px"><strong>Humidity:</strong> ${
          avg.h != null ? avg.h.toFixed(1) + " %" : "—"
        }</div>
        <div style="margin-top:6px"><strong>AQI:</strong> ${
          avg.a != null ? avg.a.toFixed(1) : "—"
        }</div>
        <div style="margin-top:6px"><strong>PM2.5:</strong> ${
          avg.p != null ? avg.p.toFixed(1) : "—"
        }</div>
        <div style="margin-top:10px;color:var(--muted);font-size:.9rem">Tip: use the filter to view the last week/month/year (relative to dataset max date).</div>
      `;
      statusEl(`Analysis ready for ${qCity}`);
      return;
    }

    /* ---------- COMPARE MODE ---------- */
    if (isCompare) {
      statusEl(`Preparing comparison ${qCity1} vs ${qCity2}…`);
      const m1 = filterRowsByCity(qCity1),
        m2 = filterRowsByCity(qCity2);
      if (!m1.length || !m2.length) {
        statusEl(
          `Missing data for ${!m1.length ? qCity1 : ""} ${
            !m2.length ? qCity2 : ""
          }`
        );
        return;
      }

      const f1 = applyDaysFilterToRows(m1, chosen),
        f2 = applyDaysFilterToRows(m2, chosen);
      if (!f1.length || !f2.length)
        warnEl(
          "No rows in chosen time range for one or both cities. Showing available full data fallback."
        );
      const s1 = buildDailySeries(f1.length ? f1 : m1, state.keys);
      const s2 = buildDailySeries(f2.length ? f2 : m2, state.keys);

      const avg1 = {
        t: mean(s1.temperature),
        h: mean(s1.humidity),
        p: mean(s1.pm25),
        a: mean(s1.aqi),
      };
      const avg2 = {
        t: mean(s2.temperature),
        h: mean(s2.humidity),
        p: mean(s2.pm25),
        a: mean(s2.aqi),
      };

      const su1 = buildSuggestionLines(avg1, qCity1),
        su2 = buildSuggestionLines(avg2, qCity2);
      suggestionEl.textContent = `${su1.summary} ${su1.details}\n\n${su2.summary} ${su2.details}`;
      suggestionBanner.style.display = "flex";

      // show compare cards now
      renderCompareCards(avg1, qCity1, avg2, qCity2);

      // union timeline
      const unionDates = Array.from(
        new Set([...(s1.rawDates || []), ...(s2.rawDates || [])])
      ).sort();
      const labels = unionDates.map((d) =>
        new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        })
      );
      const mapS = (s) => {
        const m = {};
        (s.rawDates || []).forEach(
          (d, i) =>
            (m[d] = {
              t: s.temperature[i],
              h: s.humidity[i],
              p: s.pm25[i],
              a: s.aqi[i],
            })
        );
        return m;
      };
      const m1map = mapS(s1),
        m2map = mapS(s2);
      const t1 = unionDates.map((d) => m1map[d]?.t ?? null),
        t2 = unionDates.map((d) => m2map[d]?.t ?? null);
      const h1 = unionDates.map((d) => m1map[d]?.h ?? null),
        h2 = unionDates.map((d) => m2map[d]?.h ?? null);
      const p1 = unionDates.map((d) => m1map[d]?.p ?? null),
        p2 = unionDates.map((d) => m2map[d]?.p ?? null);
      const a1 = unionDates.map((d) => m1map[d]?.a ?? null),
        a2 = unionDates.map((d) => m2map[d]?.a ?? null);

      createChartCard(
        "cmpTemp",
        `${qCity1} vs ${qCity2} — Temperature (°C)`,
        labels,
        [
          {
            label: qCity1,
            data: t1,
            borderColor: "#44a7c0",
            pointRadius: 1.2,
            tension: 0.22,
            borderWidth: 2,
          },
          {
            label: qCity2,
            data: t2,
            borderColor: "#ff6b6b",
            pointRadius: 1.2,
            tension: 0.22,
            borderWidth: 2,
          },
        ]
      );
      createChartCard(
        "cmpHum",
        `${qCity1} vs ${qCity2} — Humidity (%)`,
        labels,
        [
          {
            label: qCity1,
            data: h1,
            borderColor: "#66c58a",
            pointRadius: 1.2,
            tension: 0.22,
            borderWidth: 2,
          },
          {
            label: qCity2,
            data: h2,
            borderColor: "#ff8270",
            pointRadius: 1.2,
            tension: 0.22,
            borderWidth: 2,
          },
        ]
      );
      if (p1.some((v) => v != null) || p2.some((v) => v != null)) {
        createChartCard(
          "cmpPm25",
          `${qCity1} vs ${qCity2} — PM2.5 (µg/m³)`,
          labels,
          [
            {
              label: qCity1,
              data: p1,
              borderColor: "#b85c9e",
              pointRadius: 1.2,
              tension: 0.22,
              borderWidth: 2,
            },
            {
              label: qCity2,
              data: p2,
              borderColor: "#9b6bb8",
              pointRadius: 1.2,
              tension: 0.22,
              borderWidth: 2,
            },
          ]
        );
      }
      if (a1.some((v) => v != null) || a2.some((v) => v != null)) {
        createChartCard(
          "cmpAqi",
          `${qCity1} vs ${qCity2} — AQI (index)`,
          labels,
          [
            {
              label: qCity1,
              data: a1,
              borderColor: "#d17760",
              pointRadius: 1.2,
              tension: 0.22,
              borderWidth: 2,
            },
            {
              label: qCity2,
              data: a2,
              borderColor: "#f7a96b",
              pointRadius: 1.2,
              tension: 0.22,
              borderWidth: 2,
            },
          ]
        );
      }

      const higherTemp =
        (avg1.t || 0) > (avg2.t || 0)
          ? qCity1
          : (avg2.t || 0) > (avg1.t || 0)
          ? qCity2
          : "Both similar";
      const lowerPm =
        avg1.p == null || avg2.p == null
          ? "N/A"
          : avg1.p < avg2.p
          ? qCity1
          : avg2.p < avg1.p
          ? qCity2
          : "Both similar";
      const betterAir =
        avg1.a == null || avg2.a == null
          ? "N/A"
          : avg1.a < avg2.a
          ? qCity1
          : avg2.a < avg1.a
          ? qCity2
          : "Both similar";
      insightsEl.innerHTML = `
        <div><strong>Temperature higher:</strong> ${higherTemp}</div>
        <div style="margin-top:8px"><strong>Cleaner air (lower AQI):</strong> ${betterAir}</div>
        <div style="margin-top:8px"><strong>Lower PM2.5:</strong> ${lowerPm}</div>
        <div style="margin-top:10px;color:var(--muted);font-size:.95rem">Tip: zoom & pan on charts; use the filter to limit timeframe.</div>
      `;
      statusEl(`Comparison ready: ${qCity1} vs ${qCity2}`);
      return;
    }
  } catch (err) {
    console.error(err);
    statusEl("Error: " + (err?.message || err));
  }
}

/* ====================== FILTER RE-APPLY ====================== */
async function applyFilterAndRender() {
  if (!state.raw) {
    await loadAndRender(true);
    return;
  }
  await loadAndRender(false);
}

/* ====================== BOOT ====================== */
(async function boot() {
  try {
    await loadAndRender(false);
  } catch (e) {
    console.error(e);
    statusEl("Startup error: " + (e.message || e));
  }
})();

/* ====================== (OPTIONAL) NICE SELECT (kept working) ====================== */
(function enhanceSelect(id) {
  const sel =
    document.getElementById(id.replace("#", "")) || document.querySelector(id);
  if (!sel) return;

  /* ✅ Prevent double-enhance */
  if (sel.dataset.enhanced === "1") return;
  sel.dataset.enhanced = "1";

  /* ✅ Hide native select */
  sel.style.position = "absolute";
  sel.style.opacity = "0";
  sel.style.pointerEvents = "none";
  sel.style.width = "0";
  sel.style.height = "0";

  // Build shell
  const wrap = document.createElement("div");
  wrap.className = "enhanced-select";
  wrap.setAttribute("role", "combobox");
  wrap.setAttribute("aria-expanded", "false");

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "es-button";
  btn.innerHTML = `
    <span class="es-label"></span>
    <span class="es-chevron">▾</span>
  `;

  const menu = document.createElement("div");
  menu.className = "es-menu";
  menu.innerHTML = `<ul class="es-list" role="listbox"></ul>`;
  const list = menu.querySelector(".es-list");

  // Build items from native options
  [...sel.options].forEach((opt) => {
    const li = document.createElement("li");
    li.className = "es-item";
    li.setAttribute("role", "option");
    li.dataset.value = opt.value;
    li.innerHTML = `<span class="es-dot"></span><span>${opt.textContent}</span>`;
    if (opt.selected) li.setAttribute("aria-selected", "true");
    list.appendChild(li);
  });

  sel.insertAdjacentElement("beforebegin", wrap);
  wrap.append(btn, menu);

  const setLabel = () => {
    const current = [...list.children].find(
      (li) => li.getAttribute("aria-selected") === "true"
    );
    btn.querySelector(".es-label").textContent = current
      ? current.textContent.trim()
      : sel.options[sel.selectedIndex]?.text || "Select";
  };
  setLabel();

  // Toggle
  const open = () => {
    wrap.classList.add("open");
    wrap.setAttribute("aria-expanded", "true");
  };
  const close = () => {
    wrap.classList.remove("open");
    wrap.setAttribute("aria-expanded", "false");
  };
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    wrap.classList.contains("open") ? close() : open();
  });
  document.addEventListener("click", (e) => {
    if (!wrap.contains(e.target)) close();
  });

  // Select item
  list.addEventListener("click", (e) => {
    const li = e.target.closest(".es-item");
    if (!li) return;
    [...list.children].forEach((n) => n.removeAttribute("aria-selected"));
    li.setAttribute("aria-selected", "true");
    sel.value = li.dataset.value;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    setLabel();
    close();
  });

  // Keyboard support
  let idx = [...list.children].findIndex(
    (li) => li.getAttribute("aria-selected") === "true"
  );
  const move = (d) => {
    idx = (idx + d + list.children.length) % list.children.length;
    [...list.children].forEach((n, i) =>
      n.classList.toggle("es-active", i === idx)
    );
    list.children[idx].scrollIntoView({ block: "nearest" });
  };
  btn.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!wrap.classList.contains("open")) open();
      move(1);
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!wrap.classList.contains("open")) open();
      move(-1);
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (wrap.classList.contains("open")) {
        list.children[idx]?.click();
      } else {
        open();
      }
    }
    if (e.key === "Escape") {
      close();
    }
  });

  sel.addEventListener("change", () => {
    const v = sel.value;
    [...list.children].forEach((n) =>
      n.setAttribute("aria-selected", n.dataset.value === v ? "true" : "false")
    );
    setLabel();
  });
})("#filterRange");
