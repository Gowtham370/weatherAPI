/* ====================== CONFIG & URL PARAMS ====================== */
const JSON_FILE = "./WeatherAndPollution.json";
const params = Object.fromEntries(new URLSearchParams(window.location.search).entries());
const qCity  = params.city?.trim();
const qCity1 = params.city1?.trim();
const qCity2 = params.city2?.trim();
const isSingle  = !!qCity && !(qCity1 || qCity2);
const isCompare = !!qCity1 && !!qCity2;

/* ====================== STATE & DOM REFS ====================== */
const state = { raw: null, keys: null };

const statusEl = (t) => (document.getElementById("status").textContent = t);
const warnEl   = (t) => (document.getElementById("warn").textContent = t || "");

const chartsRoot  = document.getElementById("chartsRoot");
const insightsEl  = document.getElementById("insights");     // sidebar (compare)
const summaryZone = document.getElementById("summaryZone");  // cards above charts
const asideBox    = document.querySelector(".insight-box");

/* Controls */
document.getElementById("reloadBtn")?.addEventListener("click", () => loadAndRender(true));
document.getElementById("backBtn")?.addEventListener("click", () => history.back());
document.getElementById("filterRange")?.addEventListener("change", () => applyFilterAndRender());

/* ====================== UTILITIES ====================== */
function parseTimeToMs(v) {
  if (v == null) return null;
  if (typeof v === "number" && !isNaN(v)) return v < 1e12 ? v * 1000 : v; // unix secs → ms
  const s = String(v).trim();
  if (/^\d+$/.test(s)) { const n = Number(s); return n < 1e12 ? n * 1000 : n; }
  let t = Date.parse(s);
  if (isNaN(t)) t = Date.parse(s.replace(" ", "T"));
  return isNaN(t) ? null : t;
}

function detectKeys(sample) {
  const keys = Object.keys(sample || {});
  const low = (k) => k.toLowerCase();
  const find = (arr) => keys.find((k) => arr.some((s) => low(k).includes(s)));
  return {
    timeKey: find(["time","timestamp","date","obs","datetime"]) || keys[0] || null,
    cityKey: find(["city","location","place","site","station"]) || keys.find((k)=>low(k).includes("location")) || null,
    tempKey: find(["temp","temperature","temperature_2m","temperaturec"]) || null,
    humKey:  find(["hum","humidity","relative_humidity","relative_humidity_2m"]) || null,
    pmKey:   find(["pm2.5","pm25","pm_2_5","pm2"]) || null,
    aqiKey:  find(["aqi","airquality","aqi_index"]) || null,
  };
}

function buildDailySeries(rows, keys) {
  const buckets = {};
  for (const r of rows) {
    const t = parseTimeToMs(r[keys.timeKey]); if (!t) continue;
    const d = new Date(t).toISOString().slice(0,10);
    buckets[d] ||= { temp:[], hum:[], pm:[], aqi:[] };
    const add = (k, arr) => {
      if (k != null && r[k] != null) {
        const n = Number(String(r[k]).replace(/[^0-9.\-]/g,""));
        if (!isNaN(n)) arr.push(n);
      }
    };
    add(keys.tempKey, buckets[d].temp);
    add(keys.humKey,  buckets[d].hum);
    add(keys.pmKey,   buckets[d].pm);
    add(keys.aqiKey,  buckets[d].aqi);
  }
  const dates = Object.keys(buckets).sort();
  const avg = (a) => a?.length ? a.reduce((s,v)=>s+v,0)/a.length : null;
  const labels = dates.map((d)=>
    new Date(d+"T00:00:00Z").toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"})
  );
  return {
    rawDates: dates,
    labels,
    temperature: dates.map((d)=>avg(buckets[d].temp)),
    humidity:    dates.map((d)=>avg(buckets[d].hum)),
    pm25:        dates.map((d)=>avg(buckets[d].pm)),
    aqi:         dates.map((d)=>avg(buckets[d].aqi)),
  };
}

function mean(a){ const b=(a||[]).filter(v=>v!=null); return b.length? b.reduce((s,v)=>s+v,0)/b.length : null; }

/* Scores */
function scoreTemp(x){ if(x==null) return 50; if(x<=28 && x>=18) return 100; if(x<18) return Math.max(30,60+(x/18)*40); return Math.max(0,100-(x-28)*4); }
function scoreHum(x){ if(x==null) return 50; if(x<=70 && x>=40) return 100; if(x<40) return Math.max(30,60+(x/40)*40); return Math.max(0,100-(x-70)*2); }
function scoreAQI(x){ if(x==null) return 50; if(x<=50) return 100; if(x<=100) return 80; if(x<=200) return 60; if(x<=300) return 40; return 20; }
function scorePM(x){  if(x==null) return 50; if(x<=12) return 100; if(x<=35)  return 80; if(x<=55)  return 60; if(x<=150) return 40; return 20; }

function buildSuggestionLines(avgs, name) {
  const sT = Math.round(scoreTemp(avgs.t));
  const sH = Math.round(scoreHum(avgs.h));
  const sA = Math.round(scoreAQI(avgs.a));
  const sP = Math.round(scorePM(avgs.p));
  const overall = Math.round((sT + sH + sA + sP) / 4);
  const label = overall >= 80 ? "Good" : overall >= 60 ? "Moderate" : "Poor";
  return {
    summary: `${name}: overall ${overall}/100 — ${label}.`,
    details: `Temp: ${avgs.t==null?"—":avgs.t.toFixed(1)+" °C"} (score ${sT}). Hum: ${avgs.h==null?"—":avgs.h.toFixed(1)+" %"} (score ${sH}). AQI: ${avgs.a==null?"—":avgs.a.toFixed(1)} (score ${sA}). PM2.5: ${avgs.p==null?"—":avgs.p.toFixed(1)} (score ${sP}).`,
    overall
  };
}

/* Trend helpers (for 2×2 grid inside card) */
function firstLastDelta(arr){
  const a = (arr||[]).filter(v=>v!=null);
  if (a.length<2) return null;
  return a[a.length-1] - a[0];
}
function deltaText(delta, unit){
  if (delta==null) return "≈ same";
  const abs = Math.abs(delta);
  const tiny = unit==="%" ? abs < 1 : abs < 0.5;
  if (tiny) return "≈ same";
  const arrow = delta > 0 ? "↑" : "↓";
  const minus = abs.toFixed(unit==="" ? 1 : 1);       // compact formatting
  return `${arrow} −${minus}${unit ? " "+unit : ""}`;
}
function buildTrendGrid(series){
  return {
    temp: deltaText(firstLastDelta(series.temperature), "°C"),
    hum:  deltaText(firstLastDelta(series.humidity), "%"),
    pm:   deltaText(firstLastDelta(series.pm25), ""),
    aqi:  deltaText(firstLastDelta(series.aqi), "")
  };
}

/* ====================== CHART HELPERS ====================== */
const CHARTS = {};
function clearCharts(){
  for (const k in CHARTS){ try{ CHARTS[k].destroy(); } catch{} delete CHARTS[k]; }
  chartsRoot.innerHTML = "";
}
function createChartCard(id, title, labels, datasets){
  const wrap = document.createElement("div");
  wrap.className = "chart-card";
  wrap.innerHTML = `
    <div class="chart-title">${title}</div>
    <canvas id="${id}"></canvas>
    <div class="axis-label">X: Date — Y (${title.split("—").pop().trim()})</div>`;
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
          zoom: { wheel: { enabled:true }, pinch: { enabled:true }, mode: "x" },
          pan:  { enabled:true, mode: "x" }
        }
      },
      scales: {
        x: { ticks: { color: "#9fb6c3", maxRotation:0, autoSkip:true, maxTicksLimit:12 } },
        y: { ticks: { color: "#9fb6c3" } }
      }
    }
  });
}

/* ====================== DATA LOADING ====================== */
async function loadJSON(){
  statusEl("Loading JSON…");
  const res = await fetch(JSON_FILE);
  if (!res.ok) throw new Error(`Failed to load JSON (${res.status})`);
  const j = await res.json();
  state.raw = Array.isArray(j) ? j : j.records || [];
  if (!state.raw?.length) throw new Error("JSON is empty or not an array");
  state.keys = detectKeys(state.raw.find(r=>Object.keys(r||{}).length>0) || state.raw[0]);
  statusEl(`Loaded ${state.raw.length} rows`);
}

/* ====================== FILTERING ====================== */
function filterRowsByCity(city){
  const ck = state.keys?.cityKey; if (!ck) return [];
  const q = (city||"").toLowerCase();
  return state.raw.filter(r => String(r[ck]||"").toLowerCase().includes(q));
}
function applyDaysFilterToRows(rows, days){
  if (!rows?.length) return [];
  if (!days || days==="all") return rows;
  const nd = Number(days);
  if (isNaN(nd) || nd<=0) return rows;
  const times = rows.map(r=>parseTimeToMs(r[state.keys.timeKey])).filter(Boolean);
  if (!times.length) return rows;
  const cutoff = Math.max(...times) - nd*24*60*60*1000;
  const filtered = rows.filter(r=>{
    const t = parseTimeToMs(r[state.keys.timeKey]);
    return t && t >= cutoff;
  });
  if (filtered.length) return filtered;
  const sorted = rows
    .map(r=>({ r, t:parseTimeToMs(r[state.keys.timeKey]) }))
    .filter(x=>x.t)
    .sort((a,b)=>b.t-a.t);
  return sorted.slice(0, Math.min(Math.max(7,nd), sorted.length)).map(x=>x.r);
}

/* ====================== SUMMARY UI ====================== */
function deltaChip(a, b, unit){
  if (a==null || b==null) return "—";
  const d = a - b;
  const sign = d>0 ? "+" : d<0 ? "–" : "±";
  const abs = Math.abs(d);
  const threshold = unit==="%" ? 1 : 0.5;
  if (abs < threshold) return "≈ same";
  const arrow = d>0 ? "↑" : "↓";
  return `${arrow} ${sign}${abs.toFixed(1)}${unit?(" "+unit):""}`;
}

function cityCardHtml({ name, overall, tag, color, avg, opponentAvg, trendGrid }) {
  const vs = opponentAvg ? `
    <div class="cc-vs">
      <div>Temp: ${deltaChip(avg.t, opponentAvg.t, "°C")}</div>
      <div>Hum: ${deltaChip(avg.h, opponentAvg.h, "%")}</div>
      <div>PM2.5: ${deltaChip(avg.p, opponentAvg.p, "")}</div>
      <div>AQI: ${deltaChip(avg.a, opponentAvg.a, "")}</div>
    </div>` : "";

  const trend = trendGrid ? `
    <div class="cc-trend-grid">
      <div class="t-item"><span class="m-label">Temp:</span> <span class="m-val">${trendGrid.temp}</span></div>
      <div class="t-item"><span class="m-label">Hum:</span>  <span class="m-val">${trendGrid.hum}</span></div>
      <div class="t-item"><span class="m-label">PM2.5:</span><span class="m-val">${trendGrid.pm}</span></div>
      <div class="t-item"><span class="m-label">AQI:</span>  <span class="m-val">${trendGrid.aqi}</span></div>
    </div>` : "";

  return `
  <div class="city-card">
    <div class="cc-head">
      <span class="cc-dot" style="background:${color}"></span>
      <div class="cc-title">
        <div class="cc-name">${name}</div>
        <div class="cc-tag">${tag} — ${overall}/100</div>
      </div>
    </div>

    <div class="cc-metrics">
      <div><span class="m-label">Avg Temp</span><span class="m-val">${avg.t==null?"—":avg.t.toFixed(1)+" °C"}</span></div>
      <div><span class="m-label">Avg Hum</span><span class="m-val">${avg.h==null?"—":avg.h.toFixed(1)+" %"}</span></div>
      <div><span class="m-label">Avg PM2.5</span><span class="m-val">${avg.p==null?"—":avg.p.toFixed(1)}</span></div>
      <div><span class="m-label">Avg AQI</span><span class="m-val">${avg.a==null?"—":avg.a.toFixed(1)}</span></div>
    </div>

    ${vs}
    ${trend}
  </div>`;
}

/* ====================== MAIN RENDER ====================== */
async function loadAndRender(force=false){
  try{
    if (force || !state.raw) await loadJSON();

    // Reset
    warnEl("");
    clearCharts();
    summaryZone.innerHTML = "";
    if (insightsEl) insightsEl.textContent = "Waiting for analysis…";
    if (asideBox) asideBox.style.display = ""; // default visible (compare)

    if (!isSingle && !isCompare){
      statusEl("No city query. Use ?city=Delhi or ?city1=Delhi&city2=Mumbai");
      return;
    }

    const chosen = document.getElementById("filterRange")?.value;

    /* ---------- SINGLE CITY ---------- */
    if (isSingle){
      statusEl(`Filtering rows for ${qCity}`);
      const matched = filterRowsByCity(qCity);
      if (!matched.length){ statusEl(`No rows found for "${qCity}"`); return; }

      const used = applyDaysFilterToRows(matched, chosen);
      if (!used.length) warnEl(`No rows in chosen time range for ${qCity}. Showing full available data instead.`);

      const series = buildDailySeries(used.length ? used : matched, state.keys);
      const avg = { t: mean(series.temperature), h: mean(series.humidity), p: mean(series.pm25), a: mean(series.aqi) };
      const S = buildSuggestionLines(avg, qCity);

      // Hide right sidebar for single view
      if (asideBox) asideBox.style.display = "none";

      const singleColor = S.overall>=80 ? "#33d17a" : S.overall>=60 ? "#ff9f40" : "#ff5c5c";
      const trendGrid = buildTrendGrid(series);

      // One centered wide card
      const grid = document.createElement("div");
      grid.className = "summary-grid single";
      grid.innerHTML = `
        <div class="single-center">
          ${cityCardHtml({
            name: qCity,
            overall: S.overall,
            tag: (S.overall>=80 ? "Best overall" : "Good"),
            color: singleColor,
            avg,
            trendGrid
          })}
        </div>`;
      summaryZone.appendChild(grid);

      // Charts
      createChartCard("chartTemp","Daily Avg Temperature (°C)",series.labels,[{
        label:"Temperature", data:series.temperature, borderColor:"#44a7c0", backgroundColor:"#44a7c022", fill:true, pointRadius:1.5, tension:0.25
      }]);
      if (series.humidity.some(v=>v!=null))
        createChartCard("chartHum","Daily Avg Humidity (%)",series.labels,[{
          label:"Humidity", data:series.humidity, borderColor:"#6fbf73", pointRadius:1.5, tension:0.25
        }]);
      if (series.pm25.some(v=>v!=null))
        createChartCard("chartPm25","Daily Avg PM2.5 (µg/m³)",series.labels,[{
          label:"PM2.5", data:series.pm25, borderColor:"#b85c9e", backgroundColor:"#b85c9e22", fill:true, pointRadius:1.5, tension:0.25
        }]);
      if (series.aqi.some(v=>v!=null))
        createChartCard("chartAqi","Daily Avg AQI (index)",series.labels,[{
          label:"AQI", data:series.aqi, borderColor:"#d17760", backgroundColor:"#d1776022", fill:true, pointRadius:1.5, tension:0.25
        }]);

      statusEl(`Analysis ready for ${qCity}`);
      return;
    }

    /* ---------- COMPARE MODE (unchanged look) ---------- */
    if (isCompare){
      statusEl(`Preparing comparison ${qCity1} vs ${qCity2}…`);
      const m1 = filterRowsByCity(qCity1), m2 = filterRowsByCity(qCity2);
      if (!m1.length || !m2.length){
        statusEl(`Missing data for ${!m1.length?qCity1:""} ${!m2.length?qCity2:""}`);
        return;
      }

      const f1 = applyDaysFilterToRows(m1, chosen);
      const f2 = applyDaysFilterToRows(m2, chosen);
      if (!f1.length || !f2.length) warnEl("No rows in chosen time range for one or both cities. Showing available full data fallback.");

      const s1 = buildDailySeries(f1.length?f1:m1, state.keys);
      const s2 = buildDailySeries(f2.length?f2:m2, state.keys);

      const avg1 = { t:mean(s1.temperature), h:mean(s1.humidity), p:mean(s1.pm25), a:mean(s1.aqi) };
      const avg2 = { t:mean(s2.temperature), h:mean(s2.humidity), p:mean(s2.pm25), a:mean(s2.aqi) };

      const su1 = buildSuggestionLines(avg1, qCity1);
      const su2 = buildSuggestionLines(avg2, qCity2);

      const winner = su1.overall >= su2.overall
        ? { name:qCity1, score:su1.overall, avg:avg1 }
        : { name:qCity2, score:su2.overall, avg:avg2 };
      const loser  = su1.overall >= su2.overall
        ? { name:qCity2, score:su2.overall, avg:avg2 }
        : { name:qCity1, score:su1.overall, avg:avg1 };

      const GREEN  = "#33d17a";
      const ORANGE = "#ff9f40";

      const grid = document.createElement("div");
      grid.className = "summary-grid";
      grid.innerHTML = `
        <div>
          ${cityCardHtml({ name:winner.name, overall:winner.score, tag:"Best overall", color:GREEN,  avg:winner.avg, opponentAvg:loser.avg })}
        </div>
        <div>
          ${cityCardHtml({ name:loser.name,  overall:loser.score,  tag:"Runner-up",    color:ORANGE, avg:loser.avg,  opponentAvg:winner.avg })}
        </div>`;
      summaryZone.appendChild(grid);

      if (asideBox) asideBox.style.display = ""; // sidebar visible

      // union timeline
      const unionDates = Array.from(new Set([...(s1.rawDates||[]), ...(s2.rawDates||[])])).sort();
      const labels = unionDates.map(d =>
        new Date(d+"T00:00:00Z").toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"})
      );
      const mapS = (s)=>{ const m={}; (s.rawDates||[]).forEach((d,i)=>(m[d]={t:s.temperature[i],h:s.humidity[i],p:s.pm25[i],a:s.aqi[i]})); return m; };
      const m1map = mapS(s1), m2map = mapS(s2);
      const t1 = unionDates.map(d => m1map[d]?.t ?? null), t2 = unionDates.map(d => m2map[d]?.t ?? null);
      const h1 = unionDates.map(d => m1map[d]?.h ?? null), h2 = unionDates.map(d => m2map[d]?.h ?? null);
      const p1 = unionDates.map(d => m1map[d]?.p ?? null), p2 = unionDates.map(d => m2map[d]?.p ?? null);
      const a1 = unionDates.map(d => m1map[d]?.a ?? null), a2 = unionDates.map(d => m2map[d]?.a ?? null);

      createChartCard("cmpTemp",`${qCity1} vs ${qCity2} — Temperature (°C)`,labels,[
        { label:qCity1, data:t1, borderColor:"#44a7c0", pointRadius:1.2, tension:0.22, borderWidth:2 },
        { label:qCity2, data:t2, borderColor:"#ff9f40", pointRadius:1.2, tension:0.22, borderWidth:2 },
      ]);
      createChartCard("cmpHum",`${qCity1} vs ${qCity2} — Humidity (%)`,labels,[
        { label:qCity1, data:h1, borderColor:"#66c58a", pointRadius:1.2, tension:0.22, borderWidth:2 },
        { label:qCity2, data:h2, borderColor:"#ff8270", pointRadius:1.2, tension:0.22, borderWidth:2 },
      ]);
      if (p1.some(v=>v!=null) || p2.some(v=>v!=null)){
        createChartCard("cmpPm25",`${qCity1} vs ${qCity2} — PM2.5 (µg/m³)`,labels,[
          { label:qCity1, data:p1, borderColor:"#b85c9e", pointRadius:1.2, tension:0.22, borderWidth:2 },
          { label:qCity2, data:p2, borderColor:"#9b6bb8", pointRadius:1.2, tension:0.22, borderWidth:2 },
        ]);
      }
      if (a1.some(v=>v!=null) || a2.some(v=>v!=null)){
        createChartCard("cmpAqi",`${qCity1} vs ${qCity2} — AQI (index)`,labels,[
          { label:qCity1, data:a1, borderColor:"#d17760", pointRadius:1.2, tension:0.22, borderWidth:2 },
          { label:qCity2, data:a2, borderColor:"#f7a96b", pointRadius:1.2, tension:0.22, borderWidth:2 },
        ]);
      }

      // Sidebar quick info
      const higherTemp = (avg1.t||0)>(avg2.t||0) ? qCity1 : (avg2.t||0)>(avg1.t||0) ? qCity2 : "Similar";
      const betterAir  = (avg1.a!=null && avg2.a!=null)
        ? ((avg1.a<avg2.a)? qCity1 : (avg2.a<avg1.a)? qCity2 : "Similar")
        : "N/A";
      const lowerPm    = (avg1.p!=null && avg2.p!=null)
        ? ((avg1.p<avg2.p)? qCity1 : (avg2.p<avg1.p)? qCity2 : "Similar")
        : "N/A";

      insightsEl.innerHTML = `
        <div><strong>Best overall:</strong> ${winner.name} (${winner.score}/100)</div>
        <div style="margin-top:8px"><strong>Cleaner air (lower AQI):</strong> ${betterAir}</div>
        <div style="margin-top:8px"><strong>Lower PM2.5:</strong> ${lowerPm}</div>
        <div style="margin-top:8px"><strong>Temp higher:</strong> ${higherTemp}</div>
        <div style="margin-top:10px;color:var(--muted);font-size:.95rem">Tip: zoom & pan on charts; adjust the range above.</div>
      `;

      statusEl(`Comparison ready: ${qCity1} vs ${qCity2}`);
      return;
    }
  } catch(err){
    console.error(err);
    statusEl("Error: " + (err?.message || err));
  }
}

/* ====================== FILTER RE-APPLY ====================== */
async function applyFilterAndRender(){
  if (!state.raw){ await loadAndRender(true); return; }
  await loadAndRender(false);
}

/* ====================== BOOT ====================== */
(async function boot(){
  try { await loadAndRender(false); }
  catch(e){ console.error(e); statusEl("Startup error: " + (e.message || e)); }
})();

/* ====================== OPTIONAL: ENHANCED SELECT ====================== */
(function enhanceSelect(id){
  const sel = document.getElementById(id.replace("#","")) || document.querySelector(id);
  if (!sel) return;
  if (sel.dataset.enhanced === "1") return;
  sel.dataset.enhanced = "1";
  sel.classList.add("native-hidden");

  const wrap = document.createElement("div");
  wrap.className = "enhanced-select"; wrap.setAttribute("role","combobox"); wrap.setAttribute("aria-expanded","false");

  const btn = document.createElement("button");
  btn.type = "button"; btn.className = "es-button";
  btn.innerHTML = `<span class="es-label"></span><span class="es-chevron">▾</span>`;

  const menu = document.createElement("div");
  menu.className = "es-menu"; menu.innerHTML = `<ul class="es-list" role="listbox"></ul>`;
  const list = menu.querySelector(".es-list");

  [...sel.options].forEach(opt=>{
    const li = document.createElement("li");
    li.className = "es-item"; li.setAttribute("role","option"); li.dataset.value = opt.value;
    li.innerHTML = `<span class="es-dot"></span><span>${opt.textContent}</span>`;
    if (opt.selected) li.setAttribute("aria-selected","true");
    list.appendChild(li);
  });

  sel.insertAdjacentElement("beforebegin", wrap);
  wrap.append(btn, menu);

  const setLabel = ()=>{
    const current = [...list.children].find(li=>li.getAttribute("aria-selected")==="true");
    btn.querySelector(".es-label").textContent = current ? current.textContent.trim() : sel.options[sel.selectedIndex]?.text || "Select";
  };
  setLabel();

  const open = ()=>{ wrap.classList.add("open"); wrap.setAttribute("aria-expanded","true"); };
  const close = ()=>{ wrap.classList.remove("open"); wrap.setAttribute("aria-expanded","false"); };
  btn.addEventListener("click",(e)=>{ e.stopPropagation(); wrap.classList.contains("open") ? close() : open(); });
  document.addEventListener("click",(e)=>{ if (!wrap.contains(e.target)) close(); });

  list.addEventListener("click",(e)=>{
    const li = e.target.closest(".es-item"); if (!li) return;
    [...list.children].forEach(n=>n.removeAttribute("aria-selected"));
    li.setAttribute("aria-selected","true");
    sel.value = li.dataset.value;
    sel.dispatchEvent(new Event("change",{bubbles:true}));
    setLabel(); close();
  });

  let idx = [...list.children].findIndex(li=>li.getAttribute("aria-selected")==="true");
  const move = (d)=>{ idx = (idx + d + list.children.length) % list.children.length;
    [...list.children].forEach((n,i)=>n.classList.toggle("es-active", i===idx));
    list.children[idx].scrollIntoView({ block:"nearest" });
  };
  btn.addEventListener("keydown",(e)=>{
    if (e.key==="ArrowDown"){ e.preventDefault(); if(!wrap.classList.contains("open")) open(); move(1); }
    if (e.key==="ArrowUp"){   e.preventDefault(); if(!wrap.classList.contains("open")) open(); move(-1); }
    if (e.key==="Enter"){     e.preventDefault(); if (wrap.classList.contains("open")) { list.children[idx]?.click(); } else { open(); } }
    if (e.key==="Escape"){    close(); }
  });

  sel.addEventListener("change",()=>setLabel());
})("#filterRange");
