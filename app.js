const SHEET_ID = '1iy4TBiLVl9qkmMyYdf7KvcJ4WyCmXzpxFJ2ddUO-JXc';
const GID = '1027075125';
// D = project_name, AG = calendar_month, AD = full_area (ОРП), AF = plan_labor_costs (Плановые ТРЗ)
// Excludes "УПД: Внепроект ДГП БКП СПБ" and floors the range at January 2026 per project scope.
const QUERY = "select D,AG,sum(AD),sum(AF) where D is not null and D <> 'УПД: Внепроект ДГП БКП СПБ' and AG is not null and AG >= date '2026-01-01' group by D,AG order by D,AG";
const AUTO_REFRESH_MS = 10 * 60 * 1000; // 10 minutes

const MONTH_NAMES = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

const state = {
  metric: 'labor', // 'area' | 'labor'
  records: [],    // [{project, monthKey, monthLabel, area, labor}]
  projects: [],
  months: [],       // [{key, label}]
  monthValues: new Map(),  // "project||monthKey" -> {area, labor}
  qyPeriods: [],    // [{key, label, type: 'quarter'|'year'}]
  qyValues: new Map(),      // "project||periodKey" -> {area, labor}
  sort: { key: 'project', dir: 1 },
  search: '',
  years: [],          // distinct years present, ascending
  selectedYear: null,
  selectedProject: null,
};

const MONTH_SHORT = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];

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
  qyTitle: document.getElementById('qyTitle'),
  qyTable: document.getElementById('qyTable'),
  qyLegend: document.getElementById('qyLegend'),
  yearTabs: document.getElementById('yearTabs'),
  projectPicker: document.getElementById('projectPicker'),
  radialWrap: document.getElementById('radialWrap'),
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
  const monthValues = new Map();

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
    monthValues.set(project + '||' + monthKey, { area, labor });
  }

  const projects = Array.from(projectSet).sort((a, b) => a.localeCompare(b, 'ru'));
  const months = Array.from(monthMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, label]) => ({ key, label }));

  return { records, projects, months, monthValues };
}

function addValue(map, key, area, labor) {
  const cur = map.get(key) || { area: 0, labor: 0 };
  cur.area += area;
  cur.labor += labor;
  map.set(key, cur);
}

function buildQuarterYearAggregation(records) {
  const years = new Set();
  for (const r of records) years.add(Number(r.monthKey.slice(0, 4)));
  const sortedYears = Array.from(years).sort((a, b) => a - b);

  const periods = [];
  for (const y of sortedYears) {
    for (let q = 1; q <= 4; q++) {
      periods.push({ key: y + '-Q' + q, label: q + ' кв ' + y, type: 'quarter' });
    }
    periods.push({ key: y + '-Y', label: String(y), type: 'year' });
  }

  const values = new Map();
  for (const r of records) {
    const year = Number(r.monthKey.slice(0, 4));
    const month = Number(r.monthKey.slice(5, 7));
    const quarter = Math.ceil(month / 3);
    addValue(values, r.project + '||' + year + '-Q' + quarter, r.area, r.labor);
    addValue(values, r.project + '||' + year + '-Y', r.area, r.labor);
  }

  return { periods, values };
}

function shortProjectName(project) {
  return project.replace(/^УПД:\s*/, '');
}

function computeYears(months) {
  const years = new Set();
  for (const m of months) years.add(Number(m.key.slice(0, 4)));
  return Array.from(years).sort((a, b) => a - b);
}

function monthValuesForProjectYear(project, year, metricKey) {
  const vals = [];
  for (let m = 1; m <= 12; m++) {
    const key = project + '||' + year + '-' + String(m).padStart(2, '0');
    const entry = state.monthValues.get(key);
    vals.push(entry ? entry[metricKey] : 0);
  }
  return vals;
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

function metricLabel(metricKey) {
  return metricKey === 'area' ? 'ОРП, м²' : 'Плановые ТРЗ, ч';
}

function renderGrid(tableEl, legendEl, periods, valueMap, metricKey, filteredProjects) {
  let max = 0;
  for (const project of filteredProjects) {
    for (const period of periods) {
      const entry = valueMap.get(project + '||' + period.key);
      if (entry && entry[metricKey] > max) max = entry[metricKey];
    }
  }
  if (max === 0) max = 1;

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  headRow.appendChild(document.createElement('th')).textContent = 'Проект';
  for (const period of periods) {
    const th = document.createElement('th');
    th.textContent = period.label;
    if (period.type === 'year') th.classList.add('period-year');
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);

  const tbody = document.createElement('tbody');
  for (const project of filteredProjects) {
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.textContent = project;
    tr.appendChild(th);
    for (const period of periods) {
      const td = document.createElement('td');
      if (period.type === 'year') td.classList.add('period-year');
      const entry = valueMap.get(project + '||' + period.key);
      const val = entry ? entry[metricKey] : undefined;
      if (!val) {
        td.classList.add('empty');
        td.textContent = '—';
      } else {
        const t = val / max;
        td.classList.add('cell');
        td.style.background = sequentialColor(t);
        td.style.color = textColorFor(t);
        td.textContent = formatNumber(val);
      }
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }

  tableEl.innerHTML = '';
  tableEl.appendChild(thead);
  tableEl.appendChild(tbody);

  legendEl.innerHTML = `
    <span>${formatNumber(0)}</span>
    <span class="legend-bar"></span>
    <span>${formatNumber(max)}</span>
  `;
}

function renderHeatmap() {
  const metricKey = state.metric;
  els.heatmapTitle.textContent = metricLabel(metricKey) + ' — по проектам и месяцам';

  const filteredProjects = state.projects.filter(p =>
    p.toLowerCase().includes(state.search.toLowerCase())
  );

  renderGrid(els.heatmapTable, els.legend, state.months, state.monthValues, metricKey, filteredProjects);
}

function renderQuarterYear() {
  const metricKey = state.metric;
  els.qyTitle.textContent = metricLabel(metricKey) + ' — по кварталам и годам';

  const filteredProjects = state.projects.filter(p =>
    p.toLowerCase().includes(state.search.toLowerCase())
  );

  renderGrid(els.qyTable, els.qyLegend, state.qyPeriods, state.qyValues, metricKey, filteredProjects);
}

function renderProjectPicker() {
  const search = state.search.toLowerCase();
  els.projectPicker.innerHTML = '';
  for (const project of state.projects) {
    if (!project.toLowerCase().includes(search)) continue;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'project-pill' + (project === state.selectedProject ? ' is-active' : '');
    btn.textContent = shortProjectName(project);
    btn.title = project;
    btn.addEventListener('click', () => {
      state.selectedProject = (state.selectedProject === project) ? null : project;
      renderProjectPicker();
      renderRadial();
    });
    els.projectPicker.appendChild(btn);
  }
}

function renderYearTabs() {
  els.yearTabs.innerHTML = '';
  for (const year of state.years) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'seg-btn' + (year === state.selectedYear ? ' is-active' : '');
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', year === state.selectedYear ? 'true' : 'false');
    btn.textContent = String(year);
    btn.addEventListener('click', () => {
      state.selectedYear = year;
      renderYearTabs();
      renderRadial();
    });
    els.yearTabs.appendChild(btn);
  }
}

function animateCount(el, target, duration) {
  const start = performance.now();
  function tick(now) {
    const p = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = formatNumber(target * eased);
    if (p < 1) requestAnimationFrame(tick);
    else el.textContent = formatNumber(target);
  }
  requestAnimationFrame(tick);
}

function renderRadial() {
  const wrap = els.radialWrap;
  if (!state.selectedProject || !state.selectedYear) {
    wrap.innerHTML = '<p class="radial-placeholder">Выберите проект, чтобы увидеть динамику по месяцам</p>';
    return;
  }

  const metricKey = state.metric;
  const values = monthValuesForProjectYear(state.selectedProject, state.selectedYear, metricKey);
  const max = Math.max(...values, 0) || 1;
  const total = values.reduce((a, b) => a + b, 0);

  const size = 340;
  const cx = size / 2, cy = size / 2;
  const minR = 22, maxR = 130, labelR = 152;
  const svgNS = 'http://www.w3.org/2000/svg';

  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('class', 'radial-svg');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', metricLabel(metricKey) + ' по месяцам, ' + state.selectedProject + ', ' + state.selectedYear);

  for (const frac of [0.33, 0.66, 1]) {
    const c = document.createElementNS(svgNS, 'circle');
    c.setAttribute('cx', cx);
    c.setAttribute('cy', cy);
    c.setAttribute('r', minR + (maxR - minR) * frac);
    c.setAttribute('class', 'radial-grid');
    svg.appendChild(c);
  }

  for (let i = 0; i < 12; i++) {
    const angle = (-90 + i * 30) * Math.PI / 180;
    const val = values[i];
    const r = val > 0 ? minR + (maxR - minR) * (val / max) : minR * 0.4;
    const x2 = cx + r * Math.cos(angle);
    const y2 = cy + r * Math.sin(angle);
    const t = val / max;

    const line = document.createElementNS(svgNS, 'line');
    line.setAttribute('x1', cx);
    line.setAttribute('y1', cy);
    line.setAttribute('x2', x2);
    line.setAttribute('y2', y2);
    line.setAttribute('class', 'radial-spoke');
    line.style.stroke = val > 0 ? sequentialColor(0.35 + t * 0.65) : 'var(--gridline)';
    line.style.transformOrigin = `${cx}px ${cy}px`;
    line.style.transitionDelay = (i * 45) + 'ms';
    svg.appendChild(line);

    const lx = cx + labelR * Math.cos(angle);
    const ly = cy + labelR * Math.sin(angle);
    const text = document.createElementNS(svgNS, 'text');
    text.setAttribute('x', lx);
    text.setAttribute('y', ly);
    text.setAttribute('class', 'radial-month-label');
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'middle');
    text.textContent = MONTH_SHORT[i];
    svg.appendChild(text);
  }

  const centerValue = document.createElementNS(svgNS, 'text');
  centerValue.setAttribute('x', cx);
  centerValue.setAttribute('y', cy - 8);
  centerValue.setAttribute('text-anchor', 'middle');
  centerValue.setAttribute('class', 'radial-center-value');
  centerValue.textContent = '0';
  svg.appendChild(centerValue);

  const centerSub = document.createElementNS(svgNS, 'text');
  centerSub.setAttribute('x', cx);
  centerSub.setAttribute('y', cy + 16);
  centerSub.setAttribute('text-anchor', 'middle');
  centerSub.setAttribute('class', 'radial-center-sub');
  centerSub.textContent = metricLabel(metricKey) + ', ' + state.selectedYear;
  svg.appendChild(centerSub);

  wrap.innerHTML = '';
  const title = document.createElement('div');
  title.className = 'radial-project-name';
  title.textContent = state.selectedProject;
  wrap.appendChild(title);
  wrap.appendChild(svg);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => svg.classList.add('is-visible'));
  });
  animateCount(centerValue, total, 700);
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
  renderQuarterYear();
  renderProjectPicker();
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
    const { records, projects, months, monthValues } = buildRecords(table);
    const { periods, values } = buildQuarterYearAggregation(records);
    state.records = records;
    state.projects = projects;
    state.months = months;
    state.monthValues = monthValues;
    state.qyPeriods = periods;
    state.qyValues = values;
    state.years = computeYears(months);
    if (state.selectedYear === null || !state.years.includes(state.selectedYear)) {
      state.selectedYear = state.years[0] || null;
    }
    if (state.selectedProject && !projects.includes(state.selectedProject)) {
      state.selectedProject = null;
    }
    els.content.hidden = false;
    renderYearTabs();
    renderRadial();
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
  renderQuarterYear();
  renderRadial();
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
