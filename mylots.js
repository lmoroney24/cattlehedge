// My lots page: the one place the farmer describes their cattle, and the place
// to see how much of their value has a price floor.
// Sale date = purchase date + (sale weight - starting weight) / average daily gain,
// unless the farmer picks a date themselves. Breakeven and the LRP tool read
// these lots instead of asking again.

(() => {
  const DATA = window.LRP_DATA;
  const $ = id => document.getElementById(id);

  const longDate = iso => new Date(iso + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const cwtPrice = v => "$" + v.toFixed(2);
  const money = v => (v < 0 ? "-$" : "$") + Math.round(Math.abs(v)).toLocaleString("en-US");
  const pct = v => +(v * 100).toFixed(1) + "%";
  const money2 = v => "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // Lot names are typed by the user, so escape them before putting them in HTML.
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const CLASS_NAMES = { steers: "Feeder steers", heifers: "Feeder heifers", fat: "Fat cattle" };

  let editingId = null;
  let dateSet = false;   // true once the farmer picks their own sale date

  const num = id => Number($(id).value);

  // --- Input checks ---------------------------------------------------------
  function inputErrors() {
    const errors = {};
    const keep = $("f-keep").checked;
    if (!$("f-name").value.trim()) errors["f-name"] = "Give the lot a name.";
    if (!(num("f-head") >= 1)) errors["f-head"] = "Enter how many head are in this lot.";
    if (keep) return errors;   // replacements aren't sold: no weights or sale date needed

    const cls = $("f-class").value, r = CattleHedge.weightRange(cls), fat = CattleHedge.isFat(cls);
    const start = num("f-start"), sale = num("f-weight"), adg = num("f-adg");
    if (!(start > 0)) errors["f-start"] = "Enter the starting weight.";
    if (!(sale > 0)) errors["f-weight"] = "Enter the sale weight.";
    else if (sale > r.max) errors["f-weight"] = fat
      ? `Fat cattle can't weigh more than ${r.max.toLocaleString()} lbs.`
      : `Feeder cattle can't weigh more than ${r.max.toLocaleString()} lbs. Heavier cattle are fat cattle: pick "Fat cattle" above.`;
    else if (sale < r.min) errors["f-weight"] = fat
      ? `Fat cattle must weigh at least ${r.min.toLocaleString()} lbs. Lighter cattle are feeder cattle: pick feeder steers or heifers above.`
      : `Feeder cattle must weigh at least ${r.min} lbs.`;
    if (start > 0 && sale > 0 && start >= sale) errors["f-start"] = `Starting weight must be less than the sale weight (${sale.toLocaleString()} lbs).`;
    if (!(adg > 0)) errors["f-adg"] = "Enter the average daily gain.";
    else if (adg > 10) errors["f-adg"] = "That's more than 10 lbs a day. Check the number.";
    return errors;
  }

  function showErrors(all) {
    const errors = inputErrors();
    for (const id of ["f-name", "f-head", "f-start", "f-weight", "f-adg"]) {
      // While typing, only flag fields that have something in them; on save, flag everything.
      const msg = (all || $(id).value !== "") ? errors[id] : null;
      $(id + "-err").hidden = !msg;
      $(id + "-err").textContent = msg || "";
      $(id).setAttribute("aria-invalid", String(!!msg));
    }
    return Object.keys(errors).length === 0;
  }

  // --- Sale date from weights and ADG ----------------------------------------
  const startDate = () => $("f-start-date").value || Lots.todayIso();
  function calcSale() {
    return CattleHedge.saleDateFromGain(num("f-start"), num("f-weight"), num("f-adg"), startDate());
  }

  function renderSaleDate() {
    const keep = $("f-keep").checked;
    const box = $("sale-calc");
    box.hidden = keep;
    $("sale-override").hidden = keep || !dateSet;
    if (keep) return;
    const c = calcSale();
    if (!c) {
      box.innerHTML = `<strong>Sale date:</strong> enter the weights and average daily gain to calculate it.`;
      return;
    }
    box.innerHTML = dateSet
      ? `You picked your own sale date below. Calculated: ${longDate(c.date)}.`
      : `<strong>Sale date: ${longDate(c.date)}</strong> <button type="button" class="link" id="change-date">Change</button>`;
  }

  // --- Summary + lots table -------------------------------------------------
  function render() {
    const lots = Lots.load();
    const sum = CattleHedge.inventorySummary(DATA, lots);
    renderSummary(sum);
    renderLots(lots);
  }

  function renderSummary(sum) {
    const bar = $("protect-bar");
    if (!sum.lots) {
      $("summary-headline").textContent = "";
      $("summary-tiles").innerHTML = "";
      bar.hidden = true;
      return;
    }
    const share = sum.expectedValue ? sum.protectedValue / sum.expectedValue : 0;
    $("summary-headline").innerHTML = sum.protectedValue > 0
      ? `<strong>${money(sum.protectedValue)}</strong> of your <strong>${money(sum.expectedValue)}</strong> in cattle has a price floor.`
      : `None of your <strong>${money(sum.expectedValue)}</strong> in cattle has a price floor yet.`;
    $("summary-tiles").innerHTML = [
      tile("Head to sell", sum.head.toLocaleString(), `${sum.lots} lot${sum.lots === 1 ? "" : "s"}`),
      tile("Value at today's expected price", money(sum.expectedValue), `USDA prices from ${longDate(DATA.current.effectiveDate)}`),
      tile("Protected", pct(share), `${sum.coveredLots} of ${sum.lots} lots covered`),
      tile("Premium you'll owe", money(sum.premiumTotal), sum.premiumTotal ? "billed when each plan ends" : "no plans recorded"),
    ].join("");
    bar.hidden = false;
    $("protect-fill").style.width = (share * 100).toFixed(1) + "%";
  }

  function tile(label, value, sub) {
    return `<div class="stat"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></div>`;
  }

  function renderLots(lots) {
    $("empty-state").hidden = lots.length > 0;
    $("lots-wrap").hidden = lots.length === 0;
    const warnings = [];
    $("lots-table").querySelector("tbody").innerHTML = lots.map(lot => {
      const actions = `<button type="button" class="link" data-edit="${lot.id}">Edit</button>
        <button type="button" class="link danger" data-delete="${lot.id}">Delete</button>`;
      if (lot.keep) {
        return `<tr class="kept"><td><strong>${esc(lot.name)}</strong><div class="sub">Replacements, not for sale</div></td>
          <td>${lot.head}</td><td>–</td><td>Not sold</td><td>–</td><td>–</td>
          <td><span class="badge">Not insurable</span></td><td class="actions">${actions}</td></tr>`;
      }
      const id = encodeURIComponent(lot.id);
      const s = CattleHedge.lotStatus(DATA, lot);
      s.warnings.forEach(w => warnings.push(`<strong>${esc(lot.name)}:</strong> ${w}`));
      const c = lot.coverage;
      const coverage = c
        ? `<span class="badge good">✓ Covered ${pct(c.level)}</span>
           <div class="sub">${cwtPrice(c.coverage)} floor · ends ${longDate(c.endDate)}<br>
           Premium ${money(s.premiumTotal)}, billed ${longDate(c.endDate)}<br>
           <a href="coverage.html">Details on My coverage →</a></div>`
        : `<span class="badge bad">Unprotected</span>`;
      return `<tr>
        <td><strong>${esc(lot.name)}</strong><div class="sub">${CLASS_NAMES[lot.cattleClass] || lot.cattleClass}</div>
          <div class="sub">${lot.purchasePrice ? "Bought at " + money2(lot.purchasePrice) + "/head" : "Raised"}</div></td>
        <td>${lot.head}</td>
        <td><span class="nowrap">${lot.startWeight ? `${lot.startWeight.toLocaleString()} → ` : ""}${lot.weight.toLocaleString()} lbs</span>
          ${lot.adg ? `<div class="sub">Gains ${lot.adg} lbs/day</div>` : ""}</td>
        <td>${longDate(lot.saleDate)}${lot.saleDateSet ? '<div class="sub">picked by you</div>' : ""}
          ${s.planWeeks ? `<div class="sub">${s.planWeeks}-week plan, ends ${longDate(s.planEnd)}</div>` : ""}
          ${s.tooEarly ? `<div class="sub warn-text">⚠ Sells too early: LRP won't pay</div>` : ""}</td>
        <td>${lot.breakeven ? cwtPrice(lot.breakeven) + "/cwt" : '<span class="sub">not set</span>'}</td>
        <td>${money(s.expectedValue)}<div class="sub">${s.cwt.toLocaleString()} cwt</div></td>
        <td>${coverage}</td>
        <td class="actions">
          <a class="btn btn-small" href="breakeven.html?lot=${id}">Breakeven</a>
          <a class="btn btn-small" href="lrp.html?lot=${id}">${c ? "Change coverage" : "Find coverage"}</a>
          ${c ? `<button type="button" class="link" data-uncover="${lot.id}">Remove coverage</button>` : ""}
          ${actions}
        </td></tr>`;
    }).join("");
    $("lot-warnings").innerHTML = warnings.length
      ? `<div class="warn-box"><h3>Check these</h3><ul>${warnings.map(w => `<li>${w}</li>`).join("")}</ul></div>`
      : "";
  }

  // --- Add / edit ------------------------------------------------------------
  function syncWeightRange() {
    const cls = $("f-class").value, r = CattleHedge.weightRange(cls), w = $("f-weight");
    w.min = r.min; w.max = r.max;
  }

  function resetForm() {
    editingId = null;
    dateSet = false;
    for (const id of ["f-name", "f-head", "f-start", "f-weight", "f-adg", "f-date", "f-price"]) $(id).value = "";
    $("f-start-date").value = Lots.todayIso();
    $("f-class").value = "steers";
    $("f-keep").checked = false;
    $("form-title").textContent = "Add a lot";
    $("f-submit").textContent = "Add lot";
    $("f-cancel").hidden = true;
    $("f-submit-err").hidden = true;
    syncWeightRange();
    showErrors(false);
    renderSaleDate();
    renderPriceCwt();
  }

  // Shows the purchase price as $ per cwt, the way cattle are quoted (only once a price is entered)
  function renderPriceCwt() {
    const cwt = CattleHedge.pricePerCwt(num("f-price"), num("f-start"));
    $("f-price-cwt").hidden = !cwt;
    $("f-price-cwt").textContent = cwt ? `= ${cwtPrice(cwt)} per cwt at ${num("f-start").toLocaleString()} lbs.` : "";
  }

  function startEdit(id) {
    const lot = Lots.find(id);
    if (!lot) return;
    editingId = id;
    $("f-name").value = lot.name;
    $("f-class").value = lot.cattleClass;
    $("f-head").value = lot.head;
    $("f-start").value = lot.startWeight || "";
    $("f-weight").value = lot.keep ? "" : lot.weight;
    $("f-adg").value = lot.adg || "";
    $("f-price").value = lot.purchasePrice || "";
    $("f-start-date").value = lot.startDate || Lots.todayIso();
    $("f-keep").checked = !!lot.keep;
    // Lots saved before ADG existed keep their sale date as one the farmer picked.
    dateSet = !lot.keep && (lot.saleDateSet || !lot.adg);
    $("f-date").value = lot.saleDate;
    $("form-title").textContent = `Edit "${lot.name}"`;
    $("f-submit").textContent = "Save changes";
    $("f-cancel").hidden = false;
    syncWeightRange();
    showErrors(false);
    renderSaleDate();
    renderPriceCwt();
    $("lot-entry").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function onSave() {
    if (!showErrors(true)) { $("f-submit-err").hidden = false; return; }
    $("f-submit-err").hidden = true;
    const old = editingId ? Lots.find(editingId) : null;
    const keep = $("f-keep").checked;
    const c = keep ? null : calcSale();
    const lot = {
      ...(old || {}),
      id: editingId || Lots.newId(),
      name: $("f-name").value.trim(),
      cattleClass: $("f-class").value,
      head: Math.round(num("f-head")),
      startWeight: keep ? null : num("f-start"),
      weight: keep ? (old ? old.weight : 0) : num("f-weight"),
      adg: keep ? null : num("f-adg"),
      startDate: keep ? null : startDate(),
      purchasePrice: keep ? 0 : Math.max(0, num("f-price") || 0),
      saleDate: keep ? Lots.todayIso() : (dateSet && $("f-date").value ? $("f-date").value : c.date),
      saleDateSet: !keep && dateSet && !!$("f-date").value,
      breakeven: old ? old.breakeven || 0 : 0,
      keep,
    };
    lot.coverage = Lots.fittingCoverage(old, lot);
    if (!Lots.upsert(lot)) showStorageProblem();
    Lots.setActive(lot.id);
    resetForm();
    render();
  }

  function showStorageProblem() {
    const note = $("storage-note");
    note.classList.add("warn");
    note.textContent = "This browser isn't letting Cattle Hedge save your lots (private window or strict privacy settings). They'll be lost when you leave the page.";
  }

  // --- Wiring ----------------------------------------------------------------
  function init() {
    if (!DATA) {
      document.querySelector("main").innerHTML = `<section class="card"><h2>Data missing</h2><p>Run <code>python3 site/tools/fetch_lrp.py</code> to download USDA LRP data.</p></section>`;
      return;
    }
    resetForm();
    $("lot-form").addEventListener("input", () => { showErrors(false); renderSaleDate(); renderPriceCwt(); });
    $("lot-form").addEventListener("submit", e => e.preventDefault());
    $("f-class").addEventListener("change", () => { syncWeightRange(); showErrors(false); });
    $("f-weight").addEventListener("input", syncWeightRange);
    $("f-keep").addEventListener("change", () => { showErrors(false); renderSaleDate(); });
    $("sale-calc").addEventListener("click", e => {
      if (e.target.id !== "change-date") return;
      dateSet = true;
      $("f-date").value = calcSale().date;
      renderSaleDate();
      $("f-date").focus();
    });
    $("use-calc").addEventListener("click", () => { dateSet = false; renderSaleDate(); });
    $("f-submit").addEventListener("click", onSave);
    $("f-cancel").addEventListener("click", resetForm);
    $("load-example").addEventListener("click", () => {
      if (!Lots.save(Lots.exampleLots())) showStorageProblem();
      render();
    });
    $("lots-table").addEventListener("click", e => {
      const b = e.target.closest("button");
      if (!b) return;
      if (b.dataset.edit) startEdit(b.dataset.edit);
      if (b.dataset.delete) {
        // Two clicks to delete, so a slip of the finger doesn't lose a lot.
        if (b.dataset.armed) { Lots.remove(b.dataset.delete); render(); }
        else { b.dataset.armed = "1"; b.textContent = "Click again to delete"; }
      }
      if (b.dataset.uncover) {
        const lot = Lots.find(b.dataset.uncover);
        if (lot) { lot.coverage = null; Lots.upsert(lot); render(); }
      }
    });
    // Opened as lots.html?edit=... from another page
    const editId = new URLSearchParams(location.search).get("edit");
    if (editId) startEdit(editId);
    render();
  }
  init();
})();
