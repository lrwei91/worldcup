const DATA_URL = "./data.md";
const STORAGE_KEY = "worldcup-betting-v1";
const RESULT_OPTIONS = ["", "✅", "❌", "🟰", "⏳", "🚫"];

let state = {
  days: [],
  filters: {
    search: "",
    bettor: "",
    result: "",
    phase: ""
  }
};

const els = {};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindElements();
  bindEvents();

  const saved = loadSaved();
  if (saved) {
    state.days = saved;
  } else {
    const markdown = await fetch(DATA_URL).then((res) => {
      if (!res.ok) throw new Error(`无法读取数据源：${res.status}`);
      return res.text();
    });
    state.days = parseMarkdown(markdown);
  }

  refresh();
}

function bindElements() {
  els.playerSummary = document.querySelector("#playerSummary");
  els.matchesRoot = document.querySelector("#matchesRoot");
  els.dayTemplate = document.querySelector("#dayTemplate");
  els.searchInput = document.querySelector("#searchInput");
  els.bettorFilter = document.querySelector("#bettorFilter");
  els.resultFilter = document.querySelector("#resultFilter");
  els.phaseFilter = document.querySelector("#phaseFilter");
  els.visibleCount = document.querySelector("#visibleCount");
  els.exportJsonBtn = document.querySelector("#exportJsonBtn");
  els.exportMdBtn = document.querySelector("#exportMdBtn");
  els.resetBtn = document.querySelector("#resetBtn");
}

function bindEvents() {
  els.searchInput.addEventListener("input", () => {
    state.filters.search = els.searchInput.value.trim().toLowerCase();
    renderMatches();
  });

  els.bettorFilter.addEventListener("change", () => {
    state.filters.bettor = els.bettorFilter.value;
    renderMatches();
  });

  els.resultFilter.addEventListener("change", () => {
    state.filters.result = els.resultFilter.value;
    renderMatches();
  });

  els.phaseFilter.addEventListener("change", () => {
    state.filters.phase = els.phaseFilter.value;
    renderMatches();
  });

  els.exportJsonBtn.addEventListener("click", () => downloadText("worldcup-betting.json", JSON.stringify(state.days, null, 2)));
  els.exportMdBtn.addEventListener("click", () => downloadText("worldcup-betting.md", toMarkdown(state.days)));
  els.resetBtn.addEventListener("click", resetData);
}

function parseMarkdown(markdown) {
  const lines = markdown.split(/\r?\n/);
  const days = [];
  let current = null;
  let inTable = false;

  for (const line of lines) {
    const heading = line.match(/^##\s+📅\s+(.+?)\s+·\s+(.+?)\s*$/);
    if (heading) {
      current = {
        id: slug(`${heading[1]}-${heading[2]}`),
        dateText: heading[1].trim(),
        phase: heading[2].trim(),
        rows: [],
        collapsed: false
      };
      days.push(current);
      inTable = false;
      continue;
    }

    if (!current) continue;
    if (/^\|\s*:?-+/.test(line)) {
      inTable = true;
      continue;
    }
    if (!line.startsWith("|")) {
      inTable = false;
      continue;
    }
    if (!inTable || line.includes("时间") && line.includes("对阵")) continue;

    const cells = splitRow(line);
    if (cells.length < 8) continue;
    current.rows.push({
      id: slug(`${current.id}-${current.rows.length}-${cells[0]}-${cells[1]}`),
      time: cells[0],
      match: cells[1],
      bettor: normalizeEmoji(cells[2]),
      pick: cells[3],
      odds: cleanNumber(cells[4]),
      stake: cleanNumber(cells[5]),
      result: normalizeEmoji(cells[6])
    });
  }

  return days;
}

function splitRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function normalizeEmoji(value) {
  return String(value || "").replace(/[\uFE0E\uFE0F]/g, "").trim();
}

function cleanNumber(value) {
  const text = String(value || "").replace(/[,+¥\s]/g, "");
  if (!text) return "";
  const num = Number(text);
  return Number.isFinite(num) ? String(num) : "";
}

function calculateNet(row) {
  const stake = Number(row.stake);
  const odds = Number(row.odds);
  const result = normalizeEmoji(row.result);
  if (!Number.isFinite(stake) || stake <= 0) return null;
  if (result === "✅") return Number.isFinite(odds) ? stake * odds : 0;
  if (result === "❌") return -stake;
  if (result === "🟰" || result === "🚫") return 0;
  return null;
}

function isSettled(row) {
  return calculateNet(row) !== null && ["✅", "❌", "🟰", "🚫"].includes(normalizeEmoji(row.result));
}

function refresh() {
  renderFilterOptions();
  renderSummary();
  renderMatches();
}

function renderFilterOptions() {
  const bettors = new Set();
  const phases = new Set();
  state.days.forEach((day) => {
    phases.add(day.phase);
    day.rows.forEach((row) => {
      if (row.bettor) bettors.add(row.bettor);
    });
  });

  syncOptions(els.bettorFilter, ["", ...bettors], (value) => value || "全部");
  syncOptions(els.phaseFilter, ["", ...phases], (value) => value || "全部阶段");
}

function syncOptions(select, values, labelFn) {
  const current = select.value;
  select.innerHTML = "";
  values.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = labelFn(value);
    select.append(option);
  });
  select.value = values.includes(current) ? current : "";
}

function renderSummary() {
  const summary = summarizeByBettor();
  els.playerSummary.innerHTML = "";

  if (!summary.length) {
    els.playerSummary.innerHTML = '<div class="player-row">暂无已填写投注人。</div>';
    return;
  }

  summary.forEach((item) => {
    const row = document.createElement("article");
    row.className = `player-row ${item.net < 0 ? "loss" : ""}`;
    row.innerHTML = `
      <div class="player-main">
        <div class="player-name">${escapeHtml(item.bettor)}</div>
        <div class="profit ${item.net < 0 ? "loss" : ""}">${formatMoney(item.net)}</div>
      </div>
      <div class="metric-grid">
        <div class="metric"><span>ROI</span><strong>${formatPercent(item.roi)}</strong></div>
        <div class="metric"><span>命中率</span><strong>${formatPercent(item.hitRate)}（${item.wins}/${item.settled}）</strong></div>
        <div class="metric"><span>总投入</span><strong>${formatCurrency(item.stake)}</strong></div>
      </div>
    `;
    els.playerSummary.append(row);
  });
}

function summarizeByBettor() {
  const map = new Map();
  state.days.flatMap((day) => day.rows).forEach((row) => {
    if (!row.bettor) return;
    if (!map.has(row.bettor)) {
      map.set(row.bettor, { bettor: row.bettor, net: 0, stake: 0, wins: 0, settled: 0 });
    }
    const item = map.get(row.bettor);
    const stake = Number(row.stake);
    if (Number.isFinite(stake) && stake > 0) item.stake += stake;
    const net = calculateNet(row);
    if (net !== null) item.net += net;
    if (isSettled(row)) item.settled += 1;
    if (normalizeEmoji(row.result) === "✅") item.wins += 1;
  });

  return [...map.values()]
    .map((item) => ({
      ...item,
      roi: item.stake > 0 ? item.net / item.stake : 0,
      hitRate: item.settled > 0 ? item.wins / item.settled : 0
    }))
    .sort((a, b) => b.net - a.net);
}

function renderMatches() {
  els.matchesRoot.innerHTML = "";
  let visible = 0;

  state.days.forEach((day) => {
    const rows = day.rows.filter((row) => rowMatches(row, day));
    if (!rows.length) return;
    visible += rows.length;

    const node = els.dayTemplate.content.firstElementChild.cloneNode(true);
    node.classList.toggle("collapsed", day.collapsed);
    node.querySelector(".day-meta").textContent = `${day.dateText} · ${day.phase}`;
    node.querySelector(".day-total").textContent = daySummaryText(rows);
    const title = node.querySelector(".day-title");
    title.setAttribute("aria-expanded", String(!day.collapsed));
    title.addEventListener("click", () => {
      day.collapsed = !day.collapsed;
      save();
      renderMatches();
    });

    const tbody = node.querySelector("tbody");
    rows.forEach((row) => tbody.append(renderRow(row, rows)));
    els.matchesRoot.append(node);
  });

  els.visibleCount.textContent = `${visible} 条`;
}

function rowMatches(row, day) {
  const { search, bettor, result, phase } = state.filters;
  if (bettor && row.bettor !== bettor) return false;
  if (phase && day.phase !== phase) return false;
  if (result === "blank" && row.result) return false;
  if (result && result !== "blank" && row.result !== result) return false;
  if (!search) return true;
  return [day.dateText, day.phase, row.time, row.match, row.bettor, row.pick, row.odds, row.stake, row.result]
    .join(" ")
    .toLowerCase()
    .includes(search);
}

function daySummaryText(rows) {
  const stake = rows.reduce((sum, row) => sum + (Number(row.stake) || 0), 0);
  const net = rows.reduce((sum, row) => sum + (calculateNet(row) || 0), 0);
  return `${rows.length} 条 · 投入 ${formatCurrency(stake)} · 净盈亏 ${formatMoney(net)}`;
}

function renderRow(row, visibleRows) {
  const tr = document.createElement("tr");
  tr.append(cellText(row.time));
  tr.append(cellText(row.match));
  tr.append(cellInput(row, "bettor", "text", "", visibleRows));
  tr.append(cellInput(row, "pick", "text", "", visibleRows));
  tr.append(cellInput(row, "odds", "number", "0.01", visibleRows));
  tr.append(cellInput(row, "stake", "number", "1", visibleRows));
  tr.append(cellSelect(row, "result", visibleRows));
  tr.append(cellNet(row));
  return tr;
}

function cellText(value) {
  const td = document.createElement("td");
  td.textContent = value || "";
  return td;
}

function cellInput(row, key, type, step, visibleRows) {
  const td = document.createElement("td");
  const input = document.createElement("input");
  input.type = type;
  if (step) input.step = step;
  input.value = row[key] || "";
  input.addEventListener("input", () => {
    row[key] = type === "number" ? cleanNumber(input.value) : normalizeEmoji(input.value);
    save();
    renderSummary();
    updateRowNet(input.closest("tr"), row);
    updateDayTotal(input.closest(".day-block"), visibleRows);
  });
  if (key === "bettor") {
    input.addEventListener("change", renderFilterOptions);
  }
  td.append(input);
  return td;
}

function cellSelect(row, key, visibleRows) {
  const td = document.createElement("td");
  const select = document.createElement("select");
  RESULT_OPTIONS.forEach((result) => {
    const option = document.createElement("option");
    option.value = result;
    option.textContent = result || "未填写";
    select.append(option);
  });
  select.value = row[key] || "";
  select.addEventListener("change", () => {
    row[key] = select.value;
    save();
    renderSummary();
    updateRowNet(select.closest("tr"), row);
    updateDayTotal(select.closest(".day-block"), visibleRows);
  });
  td.append(select);
  return td;
}

function updateRowNet(tr, row) {
  if (!tr) return;
  const existing = tr.querySelector(".net");
  if (!existing) return;
  const replacement = cellNet(row);
  existing.replaceWith(replacement);
}

function updateDayTotal(dayBlock, rows) {
  if (!dayBlock) return;
  const target = dayBlock.querySelector(".day-total");
  if (target) target.textContent = daySummaryText(rows);
}

function cellNet(row) {
  const td = document.createElement("td");
  const net = calculateNet(row);
  td.className = "net";
  if (net === null) {
    td.textContent = "";
  } else {
    td.textContent = formatMoney(net);
    td.classList.add(net > 0 ? "good" : net < 0 ? "bad" : "flat");
  }
  return td;
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.days));
}

function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function resetData() {
  if (!confirm("恢复初始数据会清除当前浏览器里的本地编辑，确认继续？")) return;
  localStorage.removeItem(STORAGE_KEY);
  const markdown = await fetch(DATA_URL).then((res) => res.text());
  state.days = parseMarkdown(markdown);
  refresh();
}

function toMarkdown(days) {
  const lines = [
    "---",
    "share_link:",
    `share_updated: ${new Date().toISOString()}`,
    "---",
    "> UTC+8 (北京时间) · 静态页面导出",
    "> 结果字段：✅ 胜 | ❌ 负 | 🟰 平 | ⏳ 待开 | 🚫 取消",
    "",
    "---",
    "",
    "## 🏆 战绩总览",
    ""
  ];

  summarizeByBettor().forEach((item) => {
    lines.push(`- ${item.bettor}：净盈亏 ${formatMoney(item.net)}；ROI ${formatPercent(item.roi)}；命中率 ${formatPercent(item.hitRate)}（${item.wins}/${item.settled}）；总投入 ${formatCurrency(item.stake)}`);
  });

  days.forEach((day) => {
    lines.push("", `## 📅 ${day.dateText} · ${day.phase}`, "");
    lines.push("| 时间 | 对阵 | 投注人 | 选择 | 赔率 | 投入(¥) | 结果 | 净盈亏(¥) |");
    lines.push("| :-- | :-- | :-: | :-- | :-: | --: | :-: | :--: |");
    day.rows.forEach((row) => {
      const net = calculateNet(row);
      lines.push(`| ${row.time} | ${row.match} | ${row.bettor || ""} | ${row.pick || ""} | ${row.odds || ""} | ${row.stake || ""} | ${row.result || ""} | ${net === null ? "" : formatMoney(net)} |`);
    });
  });

  return `${lines.join("\n")}\n`;
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function formatCurrency(value) {
  return `¥${Math.round(value)}`;
}

function formatMoney(value) {
  const rounded = Math.round(value);
  return `${rounded > 0 ? "+" : ""}${rounded}`;
}

function formatPercent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function slug(value) {
  let hash = 0;
  const text = String(value);
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return `id-${Math.abs(hash)}`;
}
