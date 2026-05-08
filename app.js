const storageKey = "reportes-cobradores-v1";
const localAdminPassword = "1234";
const usesLocalFile = window.location.protocol === "file:";

const form = document.querySelector("#reportForm");
const currentDate = document.querySelector("#currentDate");
const adminAccess = document.querySelector("#adminAccess");
const adminPanel = document.querySelector("#adminPanel");
const fields = {
  collector: document.querySelector("#collector"),
  cash: document.querySelector("#cash"),
  transfer: document.querySelector("#transfer"),
  expenses: document.querySelector("#expenses"),
  expenseDetail: document.querySelector("#expenseDetail"),
  notes: document.querySelector("#notes"),
};

const previewTotal = document.querySelector("#previewTotal");
const previewNet = document.querySelector("#previewNet");
const reportRows = document.querySelector("#reportRows");
const emptyState = document.querySelector("#emptyState");
const dateFromFilter = document.querySelector("#dateFromFilter");
const dateToFilter = document.querySelector("#dateToFilter");
const collectorFilter = document.querySelector("#collectorFilter");
const exportCsv = document.querySelector("#exportCsv");
const clearReports = document.querySelector("#clearReports");
const formTitle = document.querySelector("#formTitle");
const submitReport = document.querySelector("#submitReport");
const filterNetTotal = document.querySelector("#filterNetTotal");
const filterExpenseTotal = document.querySelector("#filterExpenseTotal");

const summary = {
  cash: document.querySelector("#sumCash"),
  transfer: document.querySelector("#sumTransfer"),
  expenses: document.querySelector("#sumExpenses"),
  total: document.querySelector("#sumTotal"),
  net: document.querySelector("#sumNet"),
};

let reports = [];
let isAdmin = sessionStorage.getItem("reportes-admin") === "true";
let adminPassword = sessionStorage.getItem("reportes-admin-password") || "";
let editingId = null;

function loadLocalReports() {
  try {
    return (JSON.parse(localStorage.getItem(storageKey)) || []).map(normalizeReport);
  } catch {
    return [];
  }
}

function saveLocalReports() {
  localStorage.setItem(storageKey, JSON.stringify(reports));
}

async function apiRequest(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  if (adminPassword) headers["x-admin-password"] = adminPassword;

  const response = await fetch(path, { ...options, headers });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "No se pudo completar la accion");
  }
  return response.status === 204 ? {} : response.json();
}

async function loadServerReports() {
  if (!isAdmin) return [];
  const data = await apiRequest("/api/reports");
  return (data.reports || []).map(normalizeReport);
}

async function refreshReports() {
  reports = usesLocalFile ? loadLocalReports() : await loadServerReports();
  render();
}

async function persistNewReport(report) {
  if (usesLocalFile) {
    reports.unshift(report);
    saveLocalReports();
    return report;
  }

  const data = await apiRequest("/api/reports", {
    method: "POST",
    body: JSON.stringify(report),
  });
  return data.report;
}

async function persistUpdatedReport(id, reportData) {
  if (usesLocalFile) {
    reports = reports.map((report) => {
      if (report.id !== id) return report;
      return { ...report, ...reportData, updatedAt: new Date().toISOString() };
    });
    saveLocalReports();
    return;
  }

  await apiRequest(`/api/reports/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(reportData),
  });
  await refreshReports();
}

async function persistDeletedReport(id) {
  if (usesLocalFile) {
    reports = reports.filter((report) => report.id !== id);
    saveLocalReports();
    return;
  }

  await apiRequest(`/api/reports/${encodeURIComponent(id)}`, { method: "DELETE" });
  await refreshReports();
}

async function persistClearReports() {
  if (usesLocalFile) {
    reports = [];
    saveLocalReports();
    return;
  }

  await apiRequest("/api/reports", { method: "DELETE" });
  await refreshReports();
}

function parseMoney(value) {
  if (!value) return 0;
  const normalized = String(value)
    .trim()
    .replace(/\s/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const number = Number(normalized);
  return Number.isFinite(number) ? number : 0;
}

function formatMoney(value) {
  return new Intl.NumberFormat("es-AR", {
    maximumFractionDigits: 0,
    style: "currency",
    currency: "ARS",
  }).format(value);
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("es-AR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatDateInput(value) {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function calculate(cash, transfer, expenses) {
  const total = cash + transfer;
  const net = total - expenses;
  return { total, net };
}

function makeId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeReport(report) {
  const cash = Number(report.cash) || 0;
  const transfer = Number(report.transfer) || 0;
  const expenses = Number(report.expenses) || 0;
  const { total, net } = calculate(cash, transfer, expenses);
  return { ...report, cash, transfer, expenses, total, net };
}

function updatePreview() {
  const cash = parseMoney(fields.cash.value);
  const transfer = parseMoney(fields.transfer.value);
  const expenses = parseMoney(fields.expenses.value);
  const { total, net } = calculate(cash, transfer, expenses);

  previewTotal.textContent = formatMoney(total);
  previewNet.textContent = formatMoney(net);
}

function getFilteredReports() {
  return reports.filter((report) => {
    const reportDate = formatDateInput(report.createdAt);
    const matchesFrom = !dateFromFilter.value || reportDate >= dateFromFilter.value;
    const matchesTo = !dateToFilter.value || reportDate <= dateToFilter.value;
    const matchesCollector = !collectorFilter.value || report.collector === collectorFilter.value;
    return matchesFrom && matchesTo && matchesCollector;
  });
}

function renderCollectorFilter() {
  const selected = collectorFilter.value;
  const names = [...new Set(reports.map((report) => report.collector).filter(Boolean))].sort();

  collectorFilter.innerHTML = '<option value="">Todos</option>';
  for (const name of names) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    collectorFilter.append(option);
  }
  collectorFilter.value = names.includes(selected) ? selected : "";
}

function renderSummary(visibleReports) {
  const totals = visibleReports.reduce(
    (acc, report) => {
      acc.cash += report.cash;
      acc.transfer += report.transfer;
      acc.expenses += report.expenses;
      acc.total += report.total;
      acc.net += report.net;
      return acc;
    },
    { cash: 0, transfer: 0, expenses: 0, total: 0, net: 0 },
  );

  summary.cash.textContent = formatMoney(totals.cash);
  summary.transfer.textContent = formatMoney(totals.transfer);
  summary.expenses.textContent = formatMoney(totals.expenses);
  summary.total.textContent = formatMoney(totals.total);
  summary.net.textContent = formatMoney(totals.net);
  filterNetTotal.textContent = formatMoney(totals.net);
  filterExpenseTotal.textContent = formatMoney(totals.expenses);
}

function renderRows(visibleReports) {
  reportRows.innerHTML = "";
  emptyState.style.display = visibleReports.length ? "none" : "flex";

  for (const report of visibleReports) {
    const row = document.createElement("tr");
    row.dataset.reportId = report.id;

    if (editingId === report.id) {
      row.innerHTML = `
        <td>${formatDateTime(report.createdAt)}</td>
        <td><input class="table-input" name="collector" value="${escapeAttribute(report.collector)}"></td>
        <td><input class="table-input money-input" inputmode="decimal" name="cash" value="${report.cash || ""}"></td>
        <td><input class="table-input money-input" inputmode="decimal" name="transfer" value="${report.transfer || ""}"></td>
        <td><input class="table-input money-input" inputmode="decimal" name="expenses" value="${report.expenses || ""}"></td>
        <td class="money">${formatMoney(report.total)}</td>
        <td class="money">${formatMoney(report.net)}</td>
        <td><textarea class="table-textarea" name="expenseDetail">${escapeHtml(report.expenseDetail || "")}</textarea></td>
        <td><textarea class="table-textarea" name="notes">${escapeHtml(report.notes || "")}</textarea></td>
        <td class="row-actions">
          <button class="secondary row-edit" type="button" data-action="save" data-id="${report.id}">Guardar</button>
          <button class="secondary" type="button" data-action="cancel" data-id="${report.id}">Cancelar</button>
        </td>
      `;
    } else {
      row.innerHTML = `
        <td>${formatDateTime(report.createdAt)}</td>
        <td>${escapeHtml(report.collector)}</td>
        <td class="money">${formatMoney(report.cash)}</td>
        <td class="money">${formatMoney(report.transfer)}</td>
        <td class="money">${formatMoney(report.expenses)}</td>
        <td class="money">${formatMoney(report.total)}</td>
        <td class="money">${formatMoney(report.net)}</td>
        <td>${escapeHtml(report.expenseDetail || "")}</td>
        <td>${escapeHtml(report.notes || "")}</td>
        <td class="row-actions">
          <button class="secondary row-edit" type="button" data-action="edit" data-id="${report.id}">Editar</button>
          <button class="secondary row-delete" type="button" data-action="delete" data-id="${report.id}">Borrar</button>
        </td>
      `;
    }
    reportRows.append(row);
  }
}

function render() {
  adminPanel.classList.toggle("is-hidden", !isAdmin);
  adminAccess.textContent = isAdmin ? "Salir admin" : "Administrador";
  formTitle.textContent = "Nuevo reporte";
  submitReport.textContent = "Guardar reporte";
  renderCollectorFilter();
  const visibleReports = getFilteredReports();
  renderSummary(visibleReports);
  renderRows(visibleReports);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const replacements = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return replacements[char];
  });
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

function buildCsv(visibleReports) {
  const headers = [
    "Marca temporal",
    "Efectivo",
    "Transferencia",
    "Gastos",
    "Seleccionar Nombre",
    "Especificacion de gastos",
    "Total de cobro",
    "Cobro Neto",
    "Diferencias u observaciones",
  ];

  const rows = visibleReports.map((report) => [
    formatDateTime(report.createdAt),
    report.cash,
    report.transfer,
    report.expenses,
    report.collector,
    report.expenseDetail,
    report.total,
    report.net,
    report.notes,
  ]);

  return [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(";"))
    .join("\n");
}

function downloadCsv() {
  const visibleReports = getFilteredReports();
  const csv = buildCsv(visibleReports);
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `reportes-cobradores-${formatDateInput(new Date())}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

form.addEventListener("input", updatePreview);

adminAccess.addEventListener("click", async () => {
  if (isAdmin) {
    isAdmin = false;
    adminPassword = "";
    editingId = null;
    sessionStorage.removeItem("reportes-admin");
    sessionStorage.removeItem("reportes-admin-password");
    reports = usesLocalFile ? loadLocalReports() : [];
    render();
    return;
  }

  const password = prompt("Clave de administrador");
  if (!password) return;

  if (usesLocalFile) {
    if (password !== localAdminPassword) {
      alert("Clave incorrecta");
      return;
    }
  } else {
    try {
      adminPassword = password;
      await apiRequest("/api/admin/check", { method: "POST" });
    } catch {
      adminPassword = "";
      alert("Clave incorrecta");
      return;
    }
  }

  isAdmin = true;
  sessionStorage.setItem("reportes-admin", "true");
  sessionStorage.setItem("reportes-admin-password", password);
  await refreshReports();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const cash = parseMoney(fields.cash.value);
  const transfer = parseMoney(fields.transfer.value);
  const expenses = parseMoney(fields.expenses.value);
  const { total, net } = calculate(cash, transfer, expenses);

  const report = {
    id: makeId(),
    createdAt: new Date().toISOString(),
    collector: fields.collector.value.trim(),
    cash,
    transfer,
    expenses,
    expenseDetail: fields.expenseDetail.value.trim(),
    notes: fields.notes.value.trim(),
    total,
    net,
  };

  try {
    await persistNewReport(report);
    if (!usesLocalFile && isAdmin) await refreshReports();
    form.reset();
    updatePreview();
    render();
    alert("Reporte guardado");
  } catch (error) {
    alert(error.message);
  }
});

form.addEventListener("reset", () => {
  setTimeout(updatePreview, 0);
});

dateFromFilter.addEventListener("input", render);
dateToFilter.addEventListener("input", render);
collectorFilter.addEventListener("input", render);
exportCsv.addEventListener("click", downloadCsv);

clearReports.addEventListener("click", async () => {
  const confirmed = confirm("Esto borra todos los reportes guardados. ¿Seguro?");
  if (!confirmed) return;

  try {
    editingId = null;
    await persistClearReports();
    render();
  } catch (error) {
    alert(error.message);
  }
});

reportRows.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-id]");
  if (!button) return;

  const id = button.dataset.id;

  if (button.dataset.action === "edit") {
    editingId = id;
    render();
    return;
  }

  if (button.dataset.action === "cancel") {
    editingId = null;
    render();
    return;
  }

  if (button.dataset.action === "save") {
    const row = button.closest("[data-report-id]");
    if (!row) return;

    const cash = parseMoney(row.querySelector('[name="cash"]').value);
    const transfer = parseMoney(row.querySelector('[name="transfer"]').value);
    const expenses = parseMoney(row.querySelector('[name="expenses"]').value);
    const { total, net } = calculate(cash, transfer, expenses);

    const reportData = {
      collector: row.querySelector('[name="collector"]').value.trim(),
      cash,
      transfer,
      expenses,
      expenseDetail: row.querySelector('[name="expenseDetail"]').value.trim(),
      notes: row.querySelector('[name="notes"]').value.trim(),
      total,
      net,
    };

    try {
      await persistUpdatedReport(id, reportData);
      editingId = null;
      render();
    } catch (error) {
      alert(error.message);
    }
    return;
  }

  if (button.dataset.action === "delete") {
    try {
      await persistDeletedReport(id);
      if (editingId === id) editingId = null;
      render();
    } catch (error) {
      alert(error.message);
    }
  }
});

currentDate.textContent = new Intl.DateTimeFormat("es-AR", {
  weekday: "long",
  day: "2-digit",
  month: "long",
  year: "numeric",
}).format(new Date());

updatePreview();
refreshReports().catch((error) => {
  console.error(error);
  render();
});
