const locationParents = { section: null, rack: "section", shelf: "rack", bin: "shelf" };
let locationRecords = [];
let currentLocationProduct = null;

async function requestLocations(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) },
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Location request failed.");
  return result;
}

async function loadLocationRecords() {
  locationRecords = await requestLocations("/api/locations");
  renderLocationTree();
  updateLocationParents();
  return locationRecords;
}

function renderLocationTree() {
  const rows = $("#locationTreeRows").empty();
  if (!locationRecords.length) {
    rows.append($("<tr>").append($("<td>", { colspan: 5, class: "text-muted", text: "No store locations yet. Start by adding a section." })));
    return;
  }
  locationRecords.forEach((location) => {
    const actionCell = $("<td>");
    const row = $("<tr>").append(
      $("<td>").append($("<strong>", { text: location.path }), $("<small>", { class: "inventory-product-meta", text: location.location_type })),
      $("<td>", { text: location.product_count }),
      $("<td>", { text: Number(location.assigned_quantity).toLocaleString("en-IN") }),
      $("<td>").append($("<span>", { class: `location-status${location.active ? " is-active" : ""}`, text: location.active ? "Active" : "Archived" })),
      actionCell,
    );
    if (location.active) {
      actionCell.append($("<button>", {
        type: "button", class: "btn btn-default btn-xs location-archive", text: "Archive", "data-location-id": location.id,
      }));
    }
    rows.append(row);
  });
}

function updateLocationParents() {
  const type = $("#locationType").val();
  const requiredParent = locationParents[type];
  const group = $("#locationParentGroup");
  const select = $("#locationParent").empty();
  if (!requiredParent) {
    group.hide();
    return;
  }
  group.show();
  const parents = locationRecords.filter((location) => location.active && location.location_type === requiredParent);
  select.append($("<option>", { value: "", text: `Choose ${requiredParent}` }));
  parents.forEach((location) => select.append($("<option>", { value: location.id, text: location.path })));
}

function locationAssignmentRow(locationId = "", quantity = "") {
  const row = $("<div>", { class: "location-assignment-row" });
  const select = $("<select>", { class: "form-control location-assignment-select", "aria-label": "Physical store location" });
  select.append($("<option>", { value: "", text: "Choose a location" }));
  locationRecords.filter((location) => location.active).forEach((location) => {
    select.append($("<option>", { value: location.id, text: location.path }));
  });
  select.val(locationId);
  row.append(select, $("<input>", {
    type: "number", class: "form-control location-assignment-quantity", min: "0.001", step: "0.001",
    value: quantity, placeholder: "Units at this location", "aria-label": "Units at this location",
  }), $("<button>", { type: "button", class: "btn btn-default location-assignment-remove", text: "Remove", "aria-label": "Remove location" }));
  return row;
}

function selectedLocationBatch() {
  const value = $("#locationBatchSelect").val() || "";
  return value ? value : null;
}

function availableLocationQuantity() {
  if (!currentLocationProduct) return 0;
  const batchId = selectedLocationBatch();
  if (!batchId) return Number(currentLocationProduct.quantity) || 0;
  const batch = (currentLocationProduct.batches || []).find((entry) => String(entry.id) === batchId);
  return Number(batch && batch.quantity) || 0;
}

function renderProductLocationAssignments() {
  if (!currentLocationProduct) return;
  const batchId = selectedLocationBatch();
  const existing = (currentLocationProduct.locations || []).filter((location) => String(location.batchId || "") === String(batchId || ""));
  $("#locationAvailableStock").text(` · ${availableLocationQuantity().toLocaleString("en-IN")} units available`);
  const rows = $("#locationAssignmentRows").empty();
  if (!locationRecords.some((location) => location.active)) {
    rows.append($("<p>", { class: "text-muted", text: "No active locations have been created yet. Create a section and racks first." }));
    return;
  }
  if (!existing.length) rows.append(locationAssignmentRow());
  else existing.forEach((location) => rows.append(locationAssignmentRow(location.locationId, location.quantity)));
}

$(function () {
  $("#inventoryLocationsNav,#dashboardLocationsNav").on("click", async function () {
    $("#locationManagerMessage").text("");
    $("#locationManagerModal").modal("show");
    try { await loadLocationRecords(); }
    catch (error) { $("#locationManagerMessage").text(error.message); }
  });
  $("#locationType").on("change", updateLocationParents);
  $("#saveLocationForm").on("submit", async function (event) {
    event.preventDefault();
    const button = $(this).find("[type=submit]").prop("disabled", true);
    $("#locationManagerMessage").text("Saving location…");
    try {
      await requestLocations("/api/locations", {
        method: "POST",
        body: JSON.stringify({
          name: $("#locationName").val(),
          type: $("#locationType").val(),
          parentId: $("#locationParent").val() || null,
        }),
      });
      this.reset();
      $("#locationType").val("section");
      await loadLocationRecords();
      $("#locationManagerMessage").text("Location created.");
    } catch (error) {
      $("#locationManagerMessage").text(error.message);
    } finally { button.prop("disabled", false); }
  });
  $("#locationTreeRows").on("click", ".location-archive", async function () {
    const button = $(this).prop("disabled", true);
    try {
      await requestLocations(`/api/locations/${encodeURIComponent($(this).attr("data-location-id"))}`, {
        method: "PUT", body: JSON.stringify({ active: false }),
      });
      await loadLocationRecords();
      $("#locationManagerMessage").text("Location archived.");
    } catch (error) {
      $("#locationManagerMessage").text(error.message);
      button.prop("disabled", false);
    }
  });

  $(document).on("pharmaspot:manage-locations", async (_event, product) => {
    currentLocationProduct = product;
    $("#productLocationsMessage").text("");
    $("#locationProductId").val(product._id);
    $("#locationProductName").text(product.name || "Medicine");
    try {
      await loadLocationRecords();
      const batches = product.batches || [];
      const select = $("#locationBatchSelect").empty();
      if (batches.length) {
        batches.forEach((batch) => select.append($("<option>", {
          value: batch.id,
          text: `${batch.batch_number} · expires ${String(batch.expiry_date || "not set").slice(0, 10)} · ${Number(batch.quantity)} units`,
        })));
      } else {
        select.append($("<option>", { value: "", text: "Product stock" }));
      }
      renderProductLocationAssignments();
      $("#productLocationsModal").modal("show");
    } catch (error) {
      $("#productLocationsMessage").text(error.message);
      $("#productLocationsModal").modal("show");
    }
  });
  $("#locationBatchSelect").on("change", renderProductLocationAssignments);
  $("#addLocationAssignment").on("click", () => $("#locationAssignmentRows").append(locationAssignmentRow()));
  $("#locationAssignmentRows").on("click", ".location-assignment-remove", function () { $(this).closest(".location-assignment-row").remove(); });
  $("#productLocationsForm").on("submit", async function (event) {
    event.preventDefault();
    const button = $(this).find("[type=submit]").prop("disabled", true);
    const assignments = $("#locationAssignmentRows .location-assignment-row").map(function () {
      return {
        locationId: $(this).find(".location-assignment-select").val(),
        quantity: Number($(this).find(".location-assignment-quantity").val()),
      };
    }).get().filter((entry) => entry.locationId && entry.quantity > 0);
    $("#productLocationsMessage").text("Saving stock locations…");
    try {
      const result = await requestLocations(`/api/locations/product/${encodeURIComponent($("#locationProductId").val())}/stock`, {
        method: "PUT", body: JSON.stringify({ batchId: selectedLocationBatch(), assignments }),
      });
      $("#productLocationsMessage").text(`${result.assigned.length} location(s) saved · ${result.unassignedQuantity.toLocaleString("en-IN")} units have no location assigned.`);
      $(document).trigger("pharmaspot:refresh-products");
    } catch (error) {
      $("#productLocationsMessage").text(error.message);
    } finally { button.prop("disabled", false); }
  });
});
