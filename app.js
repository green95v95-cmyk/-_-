const SHEET_ID = '1iy4TBiLVl9qkmMyYdf7KvcJ4WyCmXzpxFJ2ddUO-JXc';
const GID = '1027075125';
// D = project_name, AG = calendar_month, AD = full_area (ОРП), AF = plan_labor_costs (Плановые ТРЗ)
// Excludes "УПД: Внепроект ДГП БКП СПБ" and floors the range at January 2026 per project scope.
const QUERY = "select D,AG,sum(AD),sum(AF) where D is not null and D <> 'УПД: Внепроект ДГП БКП СПБ' and AG is not null and AG >= date '2026-01-01' group by D,AG order by D,AG";
const AUTO_REFRESH_MS = 10 * 60 * 1000; // 10 minutes

const MONTH_NAMES = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

const state = {
  metric: 'area', // 'area' | 'labor'
  records: [],    // [{project, monthKey, monthLabel, area, labor}]
  projects: [],
  months: [],     // [{key, label}]
  sort: { key: 'project', dir: 1 },
  search: '',
};

const els = {
  status: document.getElementById('status'),
  refreshBtn: document.getElementById('refreshBtn'),
  errorBox: document.getElementById('errorBox'),
  errorText: document.getElementById('errorText'),
  content: document.getElementById('content'),
  metricToggle: document.getElementById('metricToggle'),
  searchInput: document.getElementById('searchInput'),
  heatmapTitle: document.getElementById('heatmapTitle'),
  heatmapTable: document.getElementById('heatmapTable'),
  legend: document.getElementById('legend'),
  dataTable: document.getElementById('dataTable'),
  dataTableBody: document.getElementById('dataTableBody'),
};

function parseGvizDate(v) {
  const m = /Date\((\d+),(\d+),(\d+)/.exec(v || '');
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]), Number(m[3]));
}

function monthKeyOf(date) {
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0');
}

function monthLabelOf(date) {
  return MONTH_NAMES[date.getMonth()] + ' ' + date.getFullYear();
}

async function fetchTable() {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?gid=${GID}&tqx=out:json&tq=${encodeURIComponent(QUERY)}&_=${Date.now()}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const text = await res.text();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('Некорректный ответ от Google Таблиц');
  const json = JSON.parse(text.slice(start, end + 1));
  if (json.status === 'error') {
    const msg = (json.errors && json.errors[0] && json.errors[0].detailed_message) || 'Ошибка запроса к таблице';
    throw new Error(msg);
  }
  return json.table;
}

function buildRecords(table) {
  const records = [];
  const projectSet = new Set();
  const monthMap = new Map();

  for (const row of table.rows || []) {
    const c = row.c || [];
    const project = c[0] && c[0].v;
    const dateCell = c[1] && c[1].v;
    if (!project || !dateCell) continue;
    const date = parseGvizDate(dateCell);
    if (!date) continue;
    const area = (c[2] && typeof c[2].v === 'number') ? c[2].v : 0;
    const labor = (c[3] && typeof c[3].v === 'number') ? c[3].v : 0;
    const monthKey = monthKeyOf(date);
    const monthLabel = monthLabelOf(date);

    records.push({ project, monthKey, monthLabel, area, labor });
    projectSet.add(project);
    if (!monthMap.has(monthKey)) monthMap.set(monthKey, monthLabel);
  }

  const projects = Array.from(projectSet).sort((a, b) => a.localeCompare(b, 'ru'));
  const months = Array.from(monthMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, label]) => ({ key, label }));

  return { records, projects, months };
}

function formatNumber(n) {
  if (n === null || n === undefined) return '';
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 1 });
}

function lerp(a, b, t) { return a + (b - a) * t; }

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function sequentialColor(t) {
  const c0 = hexToRgb('#f3dcee');
  const c1 = hexToRgb('#4a0e40');
  const r = Math.round(lerp(c0[0], c1[0], t));
  const g = Math.round(lerp(c0[1], c1[1], t));
  const b = Math.round(lerp(c0[2], c1[2], t));
  return `rgb(${r},${g},${b})`;
}

function textColorFor(t) {
  return t > 0.55 ? '#ffffff' : '#0b0b0b';
}

function renderLegend(min, max) {
  els.legend.innerHTML = `
    <span>${formatNumber(min)}</span>
    <span class="legend-bar"></span>
    <span>${formatNumber(max)}</span>
  `;
}

function renderHeatmap() {
  const metricKey = state.metric;
  els.heatmapTitle.textContent = (metricKey === 'area' ? 'ОРП, м²' : 'Плановые ТРЗ, ч') + ' — по проектам и месяцам';

  const filteredProjects = state.projects.filter(p =>
    p.toLowerCase().includes(state.search.toLowerCase())
  );

  const valueMap = new Map();
  let max = 0;
  for (const r of state.records) {
    valueMap.set(r.project + '||' + r.monthKey, r[metricKey]);
    if (r[metricKey] > max) max = r[metricKey];
  }
  if (max === 0) max = 1;

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  headRow.appendChild(document.createElement('th')).textContent = 'Проект';
  for (const m of state.months) {
    const th = document.createElement('th');
    th.textContent = m.label;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);

  const tbody = document.createElement('tbody');
  for (const project of filteredProjects) {
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.textContent = project;
    tr.appendChild(th);
    for (const m of state.months) {
      const td = document.createElement('td');
      const val = valueMap.get(project + '||' + m.key);
      if (val === undefined) {
        td.className = 'empty';
        td.textContent = '—';
      } else {
        const t = val / max;
        td.className = 'cell';
        td.style.background = sequentialColor(t);
        td.style.color = textColorFor(t);
        td.textContent = formatNumber(val);
      }
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }

  els.heatmapTable.innerHTML = '';
  els.heatmapTable.appendChild(thead);
  els.heatmapTable.appendChild(tbody);

  renderLegend(0, max);
}

function renderDataTable() {
  const search = state.search.toLowerCase();
  let rows = state.records.filter(r => r.project.toLowerCase().includes(search));

  const { key, dir } = state.sort;
  rows = rows.slice().sort((a, b) => {
    let av, bv;
    if (key === 'project') { av = a.project; bv = b.project; }
    else if (key === 'month') { av = a.monthKey; bv = b.monthKey; }
    else { av = a[key]; bv = b[key]; }
    if (typeof av === 'string') return av.localeCompare(bv, 'ru') * dir;
    return (av - bv) * dir;
  });

  els.dataTableBody.innerHTML = '';
  for (const r of rows) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${r.project}</td>
      <td>${r.monthLabel}</td>
      <td class="num">${formatNumber(r.area)}</td>
      <td class="num">${formatNumber(r.labor)}</td>
    `;
    els.dataTableBody.appendChild(tr);
  }

  els.dataTable.querySelectorAll('th.sortable').forEach(th => {
    th.classList.toggle('sort-active', th.dataset.key === key);
  });
}

function renderAll() {
  renderHeatmap();
  renderDataTable();
}

function setStatus(text) {
  els.status.textContent = text;
}

async function loadData({ silent } = {}) {
  if (!silent) setStatus('Загрузка…');
  els.errorBox.hidden = true;
  try {
    const table = await fetchTable();
    const { records, projects, months } = buildRecords(table);
    state.records = records;
    state.projects = projects;
    state.months = months;
    els.content.hidden = false;
    renderAll();
    setStatus('Обновлено: ' + new Date().toLocaleTimeString('ru-RU'));
  } catch (err) {
    console.error(err);
    els.errorText.textContent = 'Не удалось загрузить данные из Google Таблиц: ' + err.message;
    els.errorBox.hidden = false;
    setStatus('Ошибка загрузки');
  }
}

els.metricToggle.addEventListener('click', (e) => {
  const btn = e.target.closest('.seg-btn');
  if (!btn) return;
  state.metric = btn.dataset.metric;
  els.metricToggle.querySelectorAll('.seg-btn').forEach(b => {
    const active = b === btn;
    b.classList.toggle('is-active', active);
    b.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  renderHeatmap();
});

els.searchInput.addEventListener('input', (e) => {
  state.search = e.target.value;
  renderAll();
});

els.dataTable.querySelector('thead').addEventListener('click', (e) => {
  const th = e.target.closest('th.sortable');
  if (!th) return;
  const key = th.dataset.key;
  if (state.sort.key === key) {
    state.sort.dir *= -1;
  } else {
    state.sort.key = key;
    state.sort.dir = 1;
  }
  renderDataTable();
});

els.refreshBtn.addEventListener('click', () => loadData());

loadData();
setInterval(() => loadData({ silent: true }), AUTO_REFRESH_MS);
