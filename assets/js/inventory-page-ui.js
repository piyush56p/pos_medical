let inventoryPageProducts = [];
let inventoryPageCategories = [];

function inventoryPageCategoryName(product) {
  const category = inventoryPageCategories.find((entry) => String(entry._id) === String(product.category));
  return category ? category.name : "Uncategorized";
}

function renderInventoryPage() {
  const query = String($("#inventorySearch").val() || "").trim().toLocaleLowerCase();
  const selectedCategory = String($("#inventoryCategoryFilter").val() || "");
  const count = inventoryPageProducts.length;
  const units = inventoryPageProducts.reduce((sum, item) => sum + (Number(item.stock) === 1 ? (Number(item.quantity) || 0) : 0), 0);
  const low = inventoryPageProducts.filter((item) => Number(item.stock) === 1 && Number(item.quantity) > 0 && Number(item.quantity) <= (Number(item.minStock) || 0)).length;
  const out = inventoryPageProducts.filter((item) => Number(item.stock) === 1 && Number(item.quantity) <= 0).length;
  $("#inventoryStatProducts").text(count.toLocaleString());
  $("#inventoryStatUnits").text(units.toLocaleString());
  $("#inventoryStatLow").text(low.toLocaleString());
  $("#inventoryStatOut").text(out.toLocaleString());

  const rows = $("#inventoryPageRows").empty();
  const visible = inventoryPageProducts
    .map((product, index) => ({ product, index }))
    .filter(({ product }) => {
      const name = String(product.name || "").toLocaleLowerCase();
      const barcode = String(product.barcodeValue || product.barcode || product._id || "").toLocaleLowerCase();
      const searchValues = [
        product.name, product.manufacturer, product.genericName, product.packSize,
        product.barcodeValue, product.barcode, product.supplierCode, product._id,
        ...(product.batches || []).map((batch) => batch.batch_number),
        ...(product.locations || []).map((location) => location.locationLabel),
      ].map((value) => String(value || "").toLocaleLowerCase());
      const matchesSearch = !query || name.includes(query) || barcode.includes(query) || searchValues.some((value) => value.includes(query));
      const matchesCategory = !selectedCategory || String(product.category) === selectedCategory;
      return matchesSearch && matchesCategory;
    });

  if (!visible.length) {
    rows.append($("<tr>").append($("<td>", {
      colspan: 8,
      class: "inventory-empty",
      text: count ? "No products match these filters." : "No products yet. Add a product or import a supplier CSV to begin.",
    })));
    return;
  }

  visible.forEach(({ product, index }) => {
    const quantity = Number(product.quantity) || 0;
    const minStock = Number(product.minStock) || 0;
    const tracked = Number(product.stock) === 1;
    const quantityClass = !tracked || quantity > minStock ? "" : quantity > 0 ? " is-low" : " is-empty";
    const initials = String(product.name || "?").trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
    const avatar = product.img
      ? $("<img>", { class: "inventory-product-avatar", alt: "", src: `/uploads/${encodeURIComponent(product.img)}` })
      : $("<span>", { class: "inventory-product-avatar inventory-product-initials", text: initials });
    const nameCell = $("<td>").append(
      $("<div>", { class: "inventory-product-cell" }).append(avatar, $("<div>").append(
        $("<span>", { class: "inventory-product-name", text: product.name || "Unnamed product" }),
        product.manufacturer ? $("<span>", { class: "inventory-product-meta", text: product.manufacturer }) : $(),
        $("<span>", { class: "inventory-product-meta", text: `Code ${product.barcodeValue || product.barcode || product._id}` }),
      )),
    );
    const quantityText = tracked ? quantity.toLocaleString() : "Not tracked";
    const row = $("<tr>").append(
      nameCell,
      $("<td>", { text: inventoryPageCategoryName(product) }),
      $("<td>", { text: product.supplier || "—" }),
      $("<td>").append($("<span>", { class: `inventory-qty-pill${quantityClass}`, text: quantityText })),
      $("<td>", { text: `₹${(Number(product.price) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }),
      $("<td>", { text: product.expirationDate || "—" }),
    );
    const locationLabels = [...new Set((product.locations || []).map((location) => location.locationLabel).filter(Boolean))];
    const locationCell = $("<td>", { class: "inventory-location-cell" });
    if (locationLabels.length) {
      locationCell.append($("<span>", { class: "inventory-location-label", text: locationLabels.slice(0, 2).join(" · ") }));
      if (locationLabels.length > 2) locationCell.append($("<small>", { class: "inventory-product-meta", text: `+${locationLabels.length - 2} more locations` }));
    } else {
      locationCell.append($("<span>", { class: "inventory-location-unassigned", text: "Location not assigned" }));
    }
    row.append(locationCell);
    const actions = $("<td>", { class: "inventory-row-actions" });
    actions.append($("<button>", {
      type: "button",
      class: "btn btn-default btn-xs inventory-locate-product",
      title: "Assign store locations",
      "aria-label": `Assign store locations for ${product.name || "product"}`,
      text: "Locate",
    }).data("product-index", index));
    actions.append($("<button>", {
      type: "button",
      class: "btn btn-default btn-xs inventory-edit-product",
      title: "Edit product",
      "aria-label": `Edit ${product.name || "product"}`,
      html: '<i class="fa fa-pencil" aria-hidden="true"></i>',
    }).data("product-index", index));
    actions.append($("<button>", {
      type: "button",
      class: "btn btn-default btn-xs inventory-delete-product",
      title: "Delete product",
      "aria-label": `Delete ${product.name || "product"}`,
      html: '<i class="fa fa-trash" aria-hidden="true"></i>',
    }).data("product-id", product._id));
    row.append(actions);
    rows.append(row);
  });
}

function updateInventoryCategoryOptions() {
  const select = $("#inventoryCategoryFilter");
  const selected = select.val();
  select.empty().append($("<option>", { value: "", text: "All categories" }));
  inventoryPageCategories.forEach((category) => {
    select.append($("<option>", { value: String(category._id), text: category.name }));
  });
  select.val(selected || "");
}

$(function () {
  $(document).on("pharmaspot:products-loaded", (_event, products) => {
    inventoryPageProducts = Array.isArray(products) ? products : [];
    renderInventoryPage();
  });
  $(document).on("pharmaspot:categories-loaded", (_event, categories) => {
    inventoryPageCategories = Array.isArray(categories) ? categories : [];
    updateInventoryCategoryOptions();
    renderInventoryPage();
  });

  $("#productModal").on("click", () => {
    $("#dashboard_view,#transactions_view,#pos_view").hide();
    $("#inventory_view").show();
    renderInventoryPage();
  });
  $("#inventoryPageAdd").on("click", () => $("#newProductModal").trigger("click"));
  $("#inventoryPageImport").on("click", () => $("#inventoryImportModal").modal("show"));
  $("#inventoryOverviewNav").on("click", () => $("#overview").trigger("click"));
  $("#inventoryCategoriesNav").on("click", () => $("#categoryModal").trigger("click"));
  $("#inventorySearch,#inventoryCategoryFilter").on("input change", renderInventoryPage);
  $("#inventoryPageRows").on("click", ".inventory-edit-product", function () {
    $(this).editProduct(Number($(this).data("product-index")));
  });
  $("#inventoryPageRows").on("click", ".inventory-locate-product", function () {
    const product = inventoryPageProducts[Number($(this).data("product-index"))];
    if (product) $(document).trigger("pharmaspot:manage-locations", [product]);
  });
  $("#inventoryPageRows").on("click", ".inventory-delete-product", function () {
    $(this).deleteProduct($(this).data("product-id"));
  });
  $(document).on("pharmaspot:inventory-saved", (_event, message) => {
    $("#inventoryPageMessage").text(message || "Inventory saved.");
  });
});
