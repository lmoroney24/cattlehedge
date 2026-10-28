// Breakeven page: itemized all-in costs -> breakeven price per cwt.
// Inputs are remembered in this browser only, and can be sent to the LRP tool.

(() => {
  const DATA = window.LRP_DATA;
  const $ = id => document.getElementById(id);
  const KEY = "simhedge.breakeven.v1";

  const money = v => (v < 0 ? "-$" : "$") + Math.round(Math.abs(v)).toLocaleString("en-US");
  const cwtPrice = v => (v < 0 ? "-$" : "$") + Math.abs(v).toFixed(2);
  const longDate = iso => new Date(iso + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  // Cost lines: input id -> label in the results table
  const LINES = {
    "c-cow": "Cost to raise the calf", "c-feed": "All-in feed costs", "c-vet": "Medical",
    "c-market": "Marketing", "c-other": "Other",
  };
  const FIELDS = ["b-class", "b-head", "b-weight", "b-date", "p-weight", "c-purchase", ...Object.keys(LINES),
    "b-rate", "b-months", "b-death", "b-profit"];
  let per = "head";
  let calculated = null;   // the inputs as of the last "Calculate breakeven" press
  let lastResult = null;   // what gets sent to the LRP tool or saved on a lot

  // Example: 40-head cow-calf herd selling 550-lb steers (made-up, labeled on the page)
  const EXAMPLE = {
    "b-class": "steers", "b-head": 40, "b-weight": 550, "p-weight": "", "c-purchase": "", "c-cow": 1059, "c-feed": 60,
    "c-vet": 25, "c-market": 45, "c-other": 70,
    "b-rate": 8, "b-months": 7, "b-death": 1.5,
  };

  // --- Saving inputs in this browser ------------------------------------------
  function save() {
    try {
      const values = {};
      FIELDS.forEach(id => { values[id] = $(id).value; });
      localStorage.setItem(KEY, JSON.stringify({ values, per, result: lastResult }));
    } catch { /* storage blocked: the page still works, it just won't remember */ }
  }
  function load() {
    try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; }
  }

  // --- Reading the form ---------------------------------------------------------
  const num = id => Number($(id).value) || 0;

  function readInputs() {
    const cattleClass = $("b-class").value;
    const head = Math.max(1, Math.round(num("b-head")) || 1);
    const costs = {};
    for (const id of Object.keys(LINES)) costs[id] = num(id);
    // Purchase price follows the per head / whole group switch like every other cost
    const purchasePerHead = per === "total" ? num("c-purchase") / head : num("c-purchase");
    return {
      cattleClass, head,
      weight: CattleHedge.clampWeight(cattleClass, $("b-weight").value),
      saleDate: $("b-date").value,
      purchaseWeight: num("p-weight"), purchasePerHead,
      purchasePrice: CattleHedge.pricePerCwt(purchasePerHead, num("p-weight")),
      costs, purchase: num("c-purchase"), per,
      interestRate: num("b-rate") / 100, months: num("b-months"), deathLossPct: num("b-death"),
    };
  }

  // --- Calculate ----------------------------------------------------------------
  // The result only changes when the farmer presses "Calculate breakeven".
  function calculate() {
    calculated = readInputs();
    const d = CattleHedge.breakevenDetail(calculated);
    lastResult = d.totalCost > 0
      ? { perCwt: Math.round(d.perCwt * 100) / 100, cattleClass: calculated.cattleClass, head: calculated.head,
          weight: calculated.weight, saleDate: calculated.saleDate }
      : null;
    $("b-stale").hidden = true;
    $("b-lot-msg").hidden = true;
    save();
    render();
  }

  // Any change to the inputs after calculating: remember it, and say the result is out of date.
  function onInputChange() {
    renderCowHelp();
    if (calculated) $("b-stale").hidden = false;
    save();
  }

  // --- Render -----------------------------------------------------------------
  function render() {
    const inp = calculated;
    const d = inp && CattleHedge.breakevenDetail(inp);
    const hasCosts = !!d && d.totalCost > 0;
    $("b-empty").hidden = hasCosts;
    $("b-out").hidden = !hasCosts;
    $("b-empty").innerHTML = calculated
      ? "Enter at least one cost above, then press <strong>Calculate breakeven</strong>."
      : "Enter your costs above, then press <strong>Calculate breakeven</strong>.";
    renderCowHelp();
    if (!hasCosts) return;

    const cog = CattleHedge.costOfGain(d, inp.purchaseWeight, inp.weight);
    $("b-tiles").innerHTML = [
      tile("Breakeven", cwtPrice(d.perCwt) + " /cwt", "the sale price that covers all your costs"),
      tile("Cost per head sold", money(d.perHead), `${(Math.round(d.soldHead * 10) / 10).toLocaleString()} of ${inp.head} head sold`),
      tile("Total all-in cost", money(d.totalCost), "for the whole group"),
      cog ? tile("Cost of gain", cwtPrice(cog.perLb) + " /lb", `${cog.gainLbs.toLocaleString()} lbs gained per head, purchase price not included`) : "",
    ].join("");

    // Where the money goes
    const rows = [];
    if (d.purchaseTotal) rows.push([inp.purchasePrice ? `Purchase price (${inp.purchaseWeight.toLocaleString()} lbs at ${cwtPrice(inp.purchasePrice)}/cwt)` : "Purchase price", d.purchaseTotal]);
    for (const l of d.lines) if (l.total) rows.push([LINES[l.name], l.total]);
    if (d.interest) rows.push([`Interest (${(inp.interestRate * 100).toFixed(2).replace(/\.?0+$/, "")}% for ${inp.months} months)`, d.interest]);
    rows.sort((a, b) => b[1] - a[1]);
    $("b-table").querySelector("tbody").innerHTML = rows.map(([name, total]) => {
      const share = total / d.totalCost;
      return `<tr><td>${name}</td><td>${money(total / d.soldHead)}</td><td>${cwtPrice(total / d.soldCwt)}</td>
        <td><span class="share-bar"><i style="width:${(share * 100).toFixed(1)}%"></i></span> ${Math.round(share * 100)}%</td></tr>`;
    }).join("") + `<tr class="total-row"><td>Total</td><td>${money(d.perHead)}</td><td>${cwtPrice(d.perCwt)}</td><td>100%</td></tr>`;

    // Profit target
    const profit = num("b-profit");
    $("b-target-line").innerHTML = `To make <strong>${money(profit)}</strong> per head, you need to sell for ` +
      `<strong>${cwtPrice(CattleHedge.targetPrice(d, profit, inp.weight))}/cwt</strong>.`;

    // Today's market for these cattle
    const code = CattleHedge.typeCode(inp.cattleClass, inp.weight);
    const match = CattleHedge.matchEndorsement(CattleHedge.currentOptions(DATA, code), inp.saleDate);
    if (match) {
      const exp = match.levels[0].expEnd, gap = exp - d.perCwt;
      $("b-market").innerHTML = `<strong>Today's market expects ${cwtPrice(exp)}/cwt</strong> for these cattle around ` +
        `${longDate(match.endDate)}: <strong>${cwtPrice(Math.abs(gap))} ${gap >= 0 ? "above" : "below"}</strong> your breakeven. ` +
        `This is USDA's estimate from ${longDate(DATA.current.effectiveDate)}, not a prediction.`;
    }
    renderRoom(match, inp, d);
    renderLotPicker();
  }

  // --- Save the breakeven to a lot (shows up on the Inventory page) -----------
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const CLASS_NAMES = { steers: "steers", heifers: "heifers", fat: "fat cattle" };

  function renderLotPicker(selectId) {
    const lots = Lots.load().filter(l => !l.keep);
    $("b-existing").hidden = lots.length === 0;
    const sel = $("b-lot-select"), keep = selectId || sel.value;
    sel.innerHTML = lots.map(l => `<option value="${esc(l.id)}">${esc(l.name)} (${l.head} ${CLASS_NAMES[l.cattleClass] || l.cattleClass})</option>`).join("");
    if (lots.some(l => l.id === keep)) sel.value = keep;
  }

  function lotMessage(html, warn) {
    const msg = $("b-lot-msg");
    msg.hidden = false;
    msg.classList.toggle("warn", !!warn);
    msg.innerHTML = html;
  }

  const SEE_INVENTORY = ` <a href="inventory.html">See your inventory →</a>`;
  const STORAGE_PROBLEM = "This browser isn't letting Cattle Hedge save (private window or strict privacy settings).";

  function saveToExistingLot() {
    const lot = Lots.find($("b-lot-select").value);
    if (!lot || !lastResult) return;
    lot.breakeven = lastResult.perCwt;
    if (!Lots.upsert(lot)) { lotMessage(STORAGE_PROBLEM, true); return; }
    let text = `✓ Saved ${cwtPrice(lastResult.perCwt)}/cwt as the breakeven for "${esc(lot.name)}".`;
    if (CattleHedge.isFat(lot.cattleClass) !== CattleHedge.isFat(lastResult.cattleClass)) {
      text += ` Note: this lot is ${CattleHedge.isFat(lot.cattleClass) ? "fat" : "feeder"} cattle, but you calculated for ${CattleHedge.isFat(lastResult.cattleClass) ? "fat" : "feeder"} cattle.`;
    }
    lotMessage(text + SEE_INVENTORY);
    renderLotPicker(lot.id);
  }

  function saveToNewLot() {
    const name = $("b-lot-name").value.trim();
    if (!name) { lotMessage("Give the new lot a name first.", true); $("b-lot-name").focus(); return; }
    if (!lastResult) return;
    const r = lastResult;
    const lot = {
      id: Lots.newId(), name, cattleClass: r.cattleClass, head: r.head, weight: r.weight,
      saleDate: r.saleDate || defaultSaleDate(), breakeven: r.perCwt, keep: false, coverage: null,
    };
    if (!Lots.upsert(lot)) { lotMessage(STORAGE_PROBLEM, true); return; }
    $("b-lot-name").value = "";
    lotMessage(`✓ Created "${esc(name)}" (${r.head} head, breakeven ${cwtPrice(r.perCwt)}/cwt).` +
      ` <a href="lrp.html?lot=${encodeURIComponent(lot.id)}">Find LRP coverage for it →</a>` + SEE_INVENTORY);
    renderLotPicker(lot.id);
  }

  // Room for other costs: what each animal sells for at today's market, minus what it cost to buy
  function renderRoom(match, inp, d) {
    const el = $("b-room");
    el.hidden = !(match && inp.purchasePerHead > 0);
    if (el.hidden) return;
    const r = CattleHedge.roomForCosts(match.levels[0].expEnd, inp.weight, inp.purchasePerHead, inp.purchaseWeight);
    const other = (d.totalCost - d.purchaseTotal) / inp.head;   // everything but the purchase, per head bought
    const gain = inp.weight - inp.purchaseWeight;
    let text = `<strong>Room for other costs:</strong> at that price, each head at ${inp.weight.toLocaleString()} lbs sells for ` +
      `${money2(r.saleValue)}. After the ${money2(inp.purchasePerHead)} purchase price, that leaves <strong>${money2(r.room)} per head</strong> ` +
      `for everything else` + (r.perLbGain != null ? `, or ${cwtPrice(r.perLbGain)} per lb of gain` : "") + `.`;
    if (r.room > 0) {
      const gap = r.room - other;
      text += ` Your other costs are ${money2(other)} per head` + (gain > 0 ? ` (${cwtPrice(other / gain)} per lb of gain)` : "") +
        `: <strong>${money2(Math.abs(gap))} ${gap >= 0 ? "under" : "over"}</strong> that.`;
    } else {
      text += " The purchase price alone is more than they'd sell for at that price.";
    }
    el.innerHTML = text + ` <span class="fine">Doesn't count death loss.</span>`;
  }
  const money2 = v => (v < 0 ? "-$" : "$") + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function tile(label, value, sub) {
    return `<div class="stat"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></div>`;
  }

  // Cow herd cost helper: yearly cost per cow ÷ share of cows that wean a calf
  function renderCowHelp() {
    const perCalf = CattleHedge.cowCostPerCalf(num("cow-cost"), num("cow-weaned"));
    // Show the purchase price as $ per cwt, the way cattle are quoted
    const head = Math.max(1, Math.round(num("b-head")) || 1);
    const perHead = per === "total" ? num("c-purchase") / head : num("c-purchase");
    const cwt = CattleHedge.pricePerCwt(perHead, num("p-weight"));
    $("p-cost").textContent = cwt
      ? `= ${cwtPrice(cwt)} per cwt at ${num("p-weight").toLocaleString()} lbs` + (per === "total" ? ` (${money2(perHead)} per head)` : "")
      : "What you paid. Only if you bought them.";
    $("cow-result").innerHTML = perCalf > 0
      ? `Cost to raise each calf: <strong>${money(perCalf)}</strong>. <button type="button" class="btn btn-small" id="cow-apply">Use this number</button>`
      : "Enter your yearly cost per cow.";
  }

  // --- Wiring ---------------------------------------------------------------
  function setPer(value) {
    per = value;
    document.querySelectorAll("#b-per [data-per]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.per === per)));
    $("b-per-note").innerHTML = per === "total"
      ? "All dollar amounts are <strong>for the whole group</strong>. Weights are still in lbs per head."
      : "All amounts are <strong>per head</strong>: dollars per head and weights in lbs per head.";
  }

  function syncWeightRange() {
    const cls = $("b-class").value, r = CattleHedge.weightRange(cls), w = $("b-weight");
    w.min = r.min; w.max = r.max;
    const v = Number(w.value);
    if (!(v >= r.min && v <= r.max)) w.value = CattleHedge.isFat(cls) ? 1350 : 550;
    $("b-weight-hint").textContent = CattleHedge.weightHint(cls, w.value);
  }

  function defaultSaleDate() {
    const d = new Date(DATA.current.effectiveDate + "T12:00:00");
    d.setDate(d.getDate() + 120);
    return d.toISOString().slice(0, 10);
  }

  function init() {
    if (!DATA) return;
    $("b-date").value = defaultSaleDate();

    const saved = load();
    if (saved && saved.values) {
      for (const [id, v] of Object.entries(saved.values)) if ($(id) && v !== undefined) $(id).value = v;
      setPer(saved.per || "head");
    }
    syncWeightRange();

    document.querySelectorAll("#b-form, #b-cost-form, .b-extra, #cow-help").forEach(el =>
      el.addEventListener("input", onInputChange));
    $("b-class").addEventListener("change", () => { syncWeightRange(); onInputChange(); });
    $("b-weight").addEventListener("input", () => { $("b-weight-hint").textContent = CattleHedge.weightHint($("b-class").value, $("b-weight").value); });
    $("b-profit").addEventListener("input", () => { save(); render(); });
    $("b-calc").addEventListener("click", calculate);

    // Switching per head <-> whole group converts the amounts already typed in
    $("b-per").addEventListener("click", e => {
      const b = e.target.closest("[data-per]");
      if (!b || b.dataset.per === per) return;
      const head = Math.max(1, Math.round(num("b-head")) || 1);
      const factor = b.dataset.per === "total" ? head : 1 / head;
      document.querySelectorAll("[data-cost]").forEach(i => {
        if (i.value !== "") i.value = Math.round(Number(i.value) * factor);
      });
      setPer(b.dataset.per);
      onInputChange();
    });

    $("b-example").addEventListener("click", () => {
      setPer("head");
      for (const [id, v] of Object.entries(EXAMPLE)) $(id).value = v;
      syncWeightRange();
      $("b-example-note").hidden = false;
      onInputChange();
    });
    $("b-clear").addEventListener("click", () => {
      document.querySelectorAll("[data-cost], #p-weight").forEach(i => { i.value = ""; });
      $("b-example-note").hidden = true;
      onInputChange();
    });

    $("cow-help-btn").addEventListener("click", () => { $("cow-help").hidden = !$("cow-help").hidden; renderCowHelp(); });
    $("cow-help").addEventListener("click", e => {
      if (e.target.id !== "cow-apply") return;
      const perCalf = CattleHedge.cowCostPerCalf(num("cow-cost"), num("cow-weaned"));
      const head = Math.max(1, Math.round(num("b-head")) || 1);
      $("c-cow").value = Math.round(per === "total" ? perCalf * head : perCalf);
      $("cow-help").hidden = true;
      onInputChange();
    });

    // Send the breakeven (and the cattle) to the LRP tool
    $("b-use").addEventListener("click", () => { save(); location.href = "lrp.html?from=breakeven"; });

    // Save the breakeven to an existing lot or a new one
    $("b-lot-update").addEventListener("click", saveToExistingLot);
    $("b-lot-new").addEventListener("click", saveToNewLot);
    $("b-lot-name").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); saveToNewLot(); } });

    // Coming back to the page: show the last result again
    if (saved && saved.result) calculate(); else render();
  }
  init();
})();
