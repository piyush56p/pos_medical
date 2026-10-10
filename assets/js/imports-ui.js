const importState = { file: null, importId: null, preview: null };
const formatBytes = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

function showImportMessage(message, kind = "info") {
  $("#inventoryImportMessage")
    .removeClass("alert-info alert-success alert-warning alert-danger")
    .addClass(`alert-${kind}`)
    .text(message)
    .show();
}

function updateSelectedImportFile(file) {
  importState.file = file || null;
  importState.importId = null;
  importState.preview = null;
  $("#inventoryImportPreview").hide();
  $("#inventoryImportCommit").show().prop("disabled", true);
  $("#inventoryImportUpload").prop("disabled", !file);
  $("#inventoryImportFileInfo").text(file ? `${file.name} · ${formatBytes(file.size)}` : "No file selected");
}

function appendImportSummary(summary) {
  const entries = [
    ["CSV rows", summary.totalRows],
    ["Valid rows", summary.validRows],
    ["New products", summary.newProducts],
    ["Existing matches", summary.existingProducts],
    ["Matching batches", summary.matchingBatches],
    ["Duplicate lines", summary.duplicateRows],
    ["Invalid rows", summary.invalidRows],
  ];
  const container = $("#inventoryImportSummary").empty();
  entries.forEach(([label, value]) => {
    const column = $("<div>", { class: "col-xs-6 col-sm-4 m-b-10" });
    column.append($("<strong>", { text: Number(value) || 0 }), " ", $("<span>", { text: label }));
    container.append(column);
  });
}

function renderImportPreview(data, importId) {
  importState.importId = importId;
  importState.preview = data;
  $("#inventoryImportPreview").show();
  appendImportSummary(data.summary || {});
  const rows = $("#inventoryImportRows").empty();
  (data.rows || []).forEach((row) => {
    const result = row.errors && row.errors.length ? row.errors.join("; ") : (row.duplicate ? "Duplicate · will skip" : "Ready");
    const tr = $("<tr>");
    [row.rowNumber, row.name, [row.code, row.barcode].filter(Boolean).join(" / "), row.batch, row.expiryDate || "No expiry", row.quantity, row.saleRate, row.match, result].forEach((value) => {
      tr.append($("<td>", { text: value ?? "" }));
    });
    rows.append(tr);
  });
  const readyRows = Number(data.summary && data.summary.validRows) || 0;
  const canCommit = readyRows > 0 && !data.error;
  $("#inventoryImportCommit")
    .show()
    .prop("disabled", !canCommit)
    .text(canCommit ? `Save ${readyRows} product${readyRows === 1 ? "" : "s"} to inventory` : "No valid products to save")
    .attr("title", canCommit ? "Save the valid products and batches in this preview." : (data.error || "Correct the CSV errors before saving."));
  if (data.error) showImportMessage(data.error, "danger");
  else if (!canCommit) showImportMessage("No rows are ready to save. Review the validation errors or duplicates in the preview.", "warning");
  const errorsUrl = `/api/imports/${encodeURIComponent(importId)}/errors.csv`;
  $("#inventoryImportErrors").attr("href", errorsUrl).toggle(Number(data.summary && data.summary.invalidRows) > 0);
}

async function previewImport(importId) {
  showImportMessage("Reading and validating the CSV…");
  try {
    const response = await fetch(`/api/imports/${encodeURIComponent(importId)}/preview`, { credentials: "same-origin" });
    const data = await response.json();
    renderImportPreview(data, importId);
    if (response.ok && Number(data.summary && data.summary.validRows) > 0) showImportMessage("Preview ready. Check the matches, then save the valid rows to inventory.", "success");
    else if (response.ok) showImportMessage("No rows are ready to save. Review the validation errors in the preview.", "warning");
    else showImportMessage(data.error || "Preview failed.", "danger");
  } catch (error) {
    showImportMessage("Unable to preview this file. Check the connection and retry.", "danger");
  }
}

async function loadImportHistory() {
  const body = $("#inventoryImportHistory").empty();
  try {
    const response = await fetch("/api/imports", { credentials: "same-origin" });
    if (!response.ok) throw new Error("History request failed");
    const imports = await response.json();
    if (!imports.length) {
      body.append($('<tr><td colspan="6">No CSV uploads yet.</td></tr>'));
      return;
    }
    imports.forEach((item) => {
      const summary = item.summary || {};
      const details = `Rows ${summary.totalRows ?? "—"}; imported ${summary.importedRows ?? "—"}; skipped ${summary.skippedRows ?? "—"}; errors ${summary.failedRows ?? "—"}`;
      const actions = $("<td>");
      actions.append($("<a>", { class: "btn btn-xs btn-default", href: `/api/imports/${encodeURIComponent(item.id)}/file`, text: "Original" }));
      if (!item.processedAt || ["uploaded", "processing", "failed", "completed_with_errors"].includes(item.status)) {
        actions.append(" ", $("<button>", { type: "button", class: "btn btn-xs btn-primary js-preview-import", text: "Preview / Retry" }).data("import-id", item.id));
      }
      if (Number(summary.failedRows) > 0 || Number(summary.invalidRows) > 0) {
        actions.append(" ", $("<a>", { class: "btn btn-xs btn-warning", href: `/api/imports/${encodeURIComponent(item.id)}/errors.csv`, text: "Errors" }));
      }
      const row = $("<tr>");
      row.append(
        $("<td>", { text: item.originalFilename }),
        $("<td>", { text: formatBytes(item.fileSize) }),
        $("<td>", { text: item.uploadedAt ? new Date(item.uploadedAt).toLocaleString() : "" }),
        $("<td>", { text: item.status }),
        $("<td>", { text: details }),
        actions,
      );
      body.append(row);
    });
  } catch (error) {
    body.append($('<tr><td colspan="6">Unable to load import history.</td></tr>'));
  }
}

$(function () {
  const input = $("#inventoryImportFile");
  const zone = $("#inventoryImportDropZone");
  $("#inventoryImportBrowse").on("click", () => input.trigger("click"));
  zone.on("click", (event) => {
    if (event.target === zone[0] || event.target.closest("p")) input.trigger("click");
  });
  zone.on("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      input.trigger("click");
    }
  });
  input.on("change", () => updateSelectedImportFile(input[0].files[0]));
  zone.on("dragover", (event) => { event.preventDefault(); zone.addClass("bg-info"); });
  zone.on("dragleave", () => zone.removeClass("bg-info"));
  zone.on("drop", (event) => {
    event.preventDefault();
    zone.removeClass("bg-info");
    const file = event.originalEvent.dataTransfer.files[0];
    if (file && file.name.toLowerCase().endsWith(".csv")) updateSelectedImportFile(file);
    else showImportMessage("Choose a .csv file.", "warning");
  });
  $("#inventoryImportModal").on("shown.bs.modal", loadImportHistory);

  $("#inventoryImportUpload").on("click", async function () {
    if (!importState.file) return;
    const form = new FormData();
    form.append("file", importState.file);
    $(this).prop("disabled", true);
    showImportMessage("Uploading original CSV…");
    try {
      const response = await fetch("/api/imports", { method: "POST", body: form, credentials: "same-origin" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Upload failed.");
      importState.importId = result.id;
      await previewImport(result.id);
      await loadImportHistory();
    } catch (error) {
      showImportMessage(error.message || "Unable to upload CSV.", "danger");
    } finally {
      $(this).prop("disabled", !importState.file);
    }
  });

  $("#inventoryImportHistory").on("click", ".js-preview-import", function () {
    previewImport($(this).data("import-id"));
  });

  $("#inventoryImportCommit").on("click", async function () {
    if (!importState.importId || !importState.preview) return;
    if (!window.confirm("Import the valid rows shown in this preview? Existing batch stock will be updated only once for this supplier invoice.")) return;
    $(this).prop("disabled", true);
    showImportMessage("Importing products and batches in a database transaction…");
    try {
      const response = await fetch(`/api/imports/${encodeURIComponent(importState.importId)}/commit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ confirm: true }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Import failed.");
      const summary = result.summary || {};
      const saved = Number(summary.importedRows) || 0;
      const errors = Number(summary.failedRows) || 0;
      showImportMessage(`${result.status}: saved ${saved} rows (${Number(summary.productsCreated) || 0} new products, ${Number(summary.productsMatched) || 0} matched). Added ${Number(summary.quantityAdded) || 0} units; ${errors} rows need attention.`, result.status === "completed" ? "success" : "warning");
      if (result.status === "completed") $("#inventoryImportCommit").hide();
      else await previewImport(importState.importId);
      await loadImportHistory();
      $(document).trigger("pharmaspot:refresh-products");
    } catch (error) {
      showImportMessage(error.message || "Import failed. No partial database changes were committed.", "danger");
      $("#inventoryImportCommit").prop("disabled", false);
    }
  });
});
