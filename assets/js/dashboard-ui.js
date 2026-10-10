const Chart = require("chart.js/auto");
const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
let salesChart = null;
let paymentChart = null;
let requestSequence = 0;
let latestDashboard = null;

function dashboardMoney(value) {
  return inr.format(Number(value) || 0);
}

function displayDashboardError(message) {
  $("#dashboardError").text(message).show();
}

function renderSalesChart(trend) {
  const canvas = document.getElementById("dashboardSalesChart");
  const labels = trend.map((point) => point.date.slice(5));
  const values = trend.map((point) => point.sales);
  $("#dashboardEmptySales").toggle(!values.some((value) => value > 0));
  if (salesChart) salesChart.destroy();
  salesChart = new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [{ label: "Sales revenue", data: values, backgroundColor: "#17685e", borderRadius: 3 }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (context) => dashboardMoney(context.raw) } } },
      scales: { y: { beginAtZero: true, ticks: { callback: (value) => dashboardMoney(value) } } },
    },
  });
}

function renderPaymentChart(methods) {
  const canvas = document.getElementById("dashboardPaymentsChart");
  const values = methods.map((entry) => entry.amount);
  $("#dashboardEmptyPayments").toggle(!values.some((value) => value > 0));
  if (paymentChart) paymentChart.destroy();
  paymentChart = new Chart(canvas, {
    type: "doughnut",
    data: {
      labels: methods.map((entry) => entry.method.toUpperCase()),
      datasets: [{ data: values, backgroundColor: ["#17685e", "#ed7738", "#c2d63c", "#77868b"] }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: "bottom" }, tooltip: { callbacks: { label: (context) => `${context.label}: ${dashboardMoney(context.raw)}` } } },
    },
  });
}

function renderDashboardActivity(data) {
  const activity = $("#dashboardActivity").empty();
  const events = [];
  (data.recent.transactions || []).slice(0, 5).forEach((transaction) => {
    events.push({
      date: transaction.date,
      text: `Bill ${transaction.order || transaction._id} · ${transaction.billStatus || (Number(transaction.status) ? "paid" : "open")} · ${dashboardMoney(transaction.total)}`,
    });
  });
  (data.recent.payments || []).slice(0, 5).forEach((payment) => {
    events.push({
      date: payment.received_at,
      text: `Payment received · ${String(payment.method || "other").toUpperCase()} · ${dashboardMoney(payment.amount)}`,
    });
  });
  (data.recent.imports || []).slice(0, 5).forEach((file) => {
    events.push({ date: file.uploaded_at, text: `Import ${file.original_filename} · ${file.status}` });
  });
  events.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  if (!events.length) activity.append($("<li>", { class: "text-muted", text: "No sales or inventory imports yet." }));
  events.slice(0, 8).forEach((event) => {
    const item = $("<li>");
    item.append($("<span>", { text: event.text }), $("<small>", { class: "text-muted", text: event.date ? new Date(event.date).toLocaleString() : "" }));
    activity.append(item);
  });
}

function renderDashboard(data, sequence) {
  if (sequence !== requestSequence) return;
  latestDashboard = data;
  $("#dashboardError").hide();
  $("#dashboardRangeLabel").text(`${data.range.from} to ${data.range.to} · ${data.timeZone} timezone`);
  $("#dashboardTodaySales").text(dashboardMoney(data.sales.todayRevenue));
  $("#dashboardTodayBills").text(data.sales.todayBills);
  $("#dashboardTodayCollected").text(dashboardMoney(data.sales.todayCollected));
  $("#dashboardCredit").text(dashboardMoney(data.sales.creditOutstanding));
  $("#dashboardRangeSales").text(dashboardMoney(data.sales.revenue));
  $("#dashboardBills").text(data.sales.billCount);
  $("#dashboardAverage").text(dashboardMoney(data.sales.averageBill));
  $("#dashboardWeekSales").text(dashboardMoney(data.sales.last7Days));
  $("#dashboardMonthSales").text(dashboardMoney(data.sales.thisMonth));
  $("#dashboardProductCount").text(data.inventory.products);
  $("#dashboardBatchCount").text(data.inventory.trackedBatches);
  $("#dashboardLowStock").text(data.inventory.lowStock);
  $("#dashboardOutStock").text(data.inventory.outOfStock);
  $("#dashboardExpirySummary").text(`${data.inventory.nearExpiryBatches} batches expire within ${data.inventory.nearExpiryThresholdDays} days · ${data.inventory.expiredBatches} expired batches`);
  $("#dashboardLowStockOpen").text(`Low stock (${data.inventory.lowStock})`);
  $("#dashboardOutStockOpen").text(`Out of stock (${data.inventory.outOfStock})`);
  $("#dashboardNearExpiryOpen").text(`Near expiry (${data.inventory.nearExpiryBatches})`);
  $("#dashboardExpiredOpen").text(`Expired (${data.inventory.expiredBatches})`);
  $("#dashboardProfitNote").text(data.sales.grossProfit === null ? data.sales.grossProfitUnavailableReason : `Gross profit: ${dashboardMoney(data.sales.grossProfit)}`);
  const bestSellers = $("#dashboardBestSellers").empty();
  if (!data.charts.bestSellers.length) bestSellers.append($("<tr>").append($("<td>", { colspan: 3, class: "text-muted", text: "No sales in this range." })));
  data.charts.bestSellers.forEach((product) => {
    bestSellers.append($("<tr>").append(
      $("<td>", { text: product.name }),
      $("<td>", { text: product.quantity }),
      $("<td>", { text: dashboardMoney(product.revenue) }),
    ));
  });
  const categories = $("#dashboardCategorySales").empty();
  if (!data.charts.categorySales.length) categories.append($("<tr>").append($("<td>", { colspan: 2, class: "text-muted", text: "No categorized sales in this range." })));
  data.charts.categorySales.forEach((category) => {
    categories.append($("<tr>").append(
      $("<td>", { text: category.category }),
      $("<td>", { text: dashboardMoney(category.revenue) }),
    ));
  });
  const customerCredit = $("#dashboardCustomerCredit").empty();
  if (!data.charts.outstandingByCustomer.length) customerCredit.append($("<tr>").append($("<td>", { colspan: 3, class: "text-muted", text: "No outstanding customer balances." })));
  data.charts.outstandingByCustomer.forEach((customer) => {
    customerCredit.append($("<tr>").append(
      $("<td>", { text: customer.customerName }),
      $("<td>", { text: customer.bills }),
      $("<td>", { text: dashboardMoney(customer.outstanding) }),
    ));
  });
  renderSalesChart(data.charts.dailyTrend);
  renderPaymentChart(data.charts.paymentMethods);
  renderDashboardActivity(data);
}

async function loadDashboard() {
  const sequence = ++requestSequence;
  const period = $("#dashboardPeriod").val() || "30d";
  const params = new URLSearchParams({ period });
  if (period === "custom") {
    params.set("from", $("#dashboardFrom").val());
    params.set("to", $("#dashboardTo").val());
  }
  $("#dashboardRangeLabel").text("Loading pharmacy activity…");
  try {
    const response = await fetch(`/api/dashboard/summary?${params}`, { credentials: "same-origin" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Dashboard request failed.");
    renderDashboard(data, sequence);
  } catch (error) {
    if (sequence === requestSequence) displayDashboardError(error.message || "Unable to load dashboard.");
  }
}

$(function () {
  $("#dashboardPeriod").on("change", function () {
    const custom = $(this).val() === "custom";
    $("#dashboardCustomRange").toggle(custom);
    if (!custom) loadDashboard();
  });
  $("#dashboardApplyRange").on("click", loadDashboard);
  $("#transactions").on("click", function () {
    $("#dashboard_view").hide();
    $("#transactions_view").show();
    $("#pos_view").hide();
    $("#pointofsale,#overview").show();
    loadDashboard();
  });
  $("#pointofsale").on("click", function () {
    $("#dashboard_view,#transactions_view").hide();
    $("#pos_view").show();
    $("#transactions,#overview").show();
  });
  $("#overview").on("click", function () {
    $("#pos_view,#transactions_view").hide();
    $("#dashboard_view").show();
    $("#transactions,#pointofsale").show();
    loadDashboard();
  });
  $("#dashboardInventoryButtons").on("click", "button[data-inventory-list]", function () {
    if (!latestDashboard) return;
    const key = $(this).data("inventory-list");
    const entries = latestDashboard.inventory.attention[key] || [];
    const rows = $("#dashboardInventoryRows").empty();
    if (!entries.length) {
      rows.append($("<tr>").append($("<td>", { colspan: 3, class: "text-muted", text: "No medicines require attention in this category." })));
    }
    entries.forEach((entry) => {
      const batchAndStock = entry.batchNumber ? `${entry.batchNumber} · ${entry.quantity}` : `${entry.quantity} on hand${entry.minStock === undefined ? "" : ` · minimum ${entry.minStock}`}`;
      const expiry = entry.expiryDate || "Threshold: 30 days";
      rows.append($("<tr>").append($("<td>", { text: entry.name }), $("<td>", { text: batchAndStock }), $("<td>", { text: expiry })));
    });
    $("#dashboardInventoryDetails").show();
  });
  if (localStorage.getItem("auth")) {
    $("#dashboard_view").show();
    $("#pos_view,#transactions_view").hide();
    $("#overview,#transactions,#pointofsale").show();
    loadDashboard();
  }
});

module.exports = { dashboardMoney, renderDashboard };