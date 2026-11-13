// Breakeven page: itemized all-in costs -> breakeven price per cwt, for one lot.
// The cattle (type, head, weights, sale date) come from the lot on My lots; this
// page only asks for costs. Costs are remembered per lot, in this browser only.

(() => {
  const DATA = window.LRP_DATA;
  const $ = id => document.getElementById(id);
  const KEY = "simhedge.breakeven.v2";   // { [lotId]: { values, per, result } }

  const money = v => (v < 0 ? "-$" : "$") + Math.round(Math.abs(v)).toLocaleString("en-US");
  const cwtPrice = v => (v < 0 ? "-$" : "$") + Math.abs(v).toFixed(2);
  const longDate = iso => new Date(iso + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  // Cost lines: input id -> label in the results table
  const LINES = {
    "c-cow": "Cost to raise the calf to weaning", "c-feed": "All-in feed costs", "c-vet": "Medical",
    "c-market": "Marketing", "c-other": "Other",
  };
  const ITEMS = ["c-feed", "c-vet", "c-market", "c-other"];   // only in "Itemize costs"
  const FIELDS = [...Object.keys(LINES), "c-cog", "b-rate", "b-months", "b-death", "b-profit"];
  let per = "head";
  let mode = "cog";        // "cog": one cost of gain ($/lb); "items": itemized costs
  let calculated = null;   // the inputs as of the last "Calculate breakeven" press
  let lastResult = null;   // what gets saved on the lot
  let lot = null;          // the lot this breakeven is for

  // Default itemized costs, $ per head (made-up example values, labeled on the page).
  // They add up to $275, the same as cost of gain $1.10/lb x 250 lbs for the sample lot,
  // so both modes give the same breakeven.
  const ITEM_DEFAULTS = { "c-feed": 200, "c-vet": 25, "c-market": 30, "c-other": 20 };
  // "Load example values": the defaults plus a cost to raise the calf (used only for raised calves)
  const EXAMPLE = { "c-cow": 1059, ...ITEM_DEFAULTS };

  // Fills the itemized boxes with the defaults when they're all empty
  function fillItemDefaults() {
    if (ITEMS.some(id => $(id).value !== "")) return;
    const scale = per === "total" && lot ? lot.head : 1;
    for (const [id, v] of Object.entries(ITEM_DEFAULTS)) $(id).value = v * scale;
    $("b-example-note").hidden = false;
  }

  // --- Saving inputs in this browser ------------------------------------------
  function loadAll() {
    try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch { return {}; }
  }
  function save() {
    if (!lot) return;
    try {
      const values = {};
      FIELDS.forEach(id => { values[id] = $(id).value; });
      const all = loadAll();
      all[lot.id] = { values, per, mode, result: lastResult };
      localStorage.setItem(KEY, JSON.stringify(all));
    } catch { /* storage blocked: the page still works, it just won't remember */ }
  }

  // --- Reading the form ---------------------------------------------------------
  const num = id => Number($(id).value) || 0;

  // Everything is converted to $ per head here, then the math runs per head.
  //   Bought cattle start from the lot's purchase price; raised calves from the cost to raise the calf to weaning.
  //   "Cost of gain" mode: cost of gain ($/lb) x pounds gained. "Itemize costs" mode: the itemized lines.
  function readInputs() {
    const head = lot.head;
    const toHead = v => (per === "total" ? v / head : v);
    const bought = lot.purchasePrice > 0;
    const weight = CattleHedge.clampWeight(lot.cattleClass, lot.weight);
    const gainLbs = Math.max(0, weight - (lot.startWeight || 0));
    const costs = {};
    if (!bought) costs["c-cow"] = toHead(num("c-cow"));
    if (mode === "cog") costs["c-cog"] = num("c-cog") * gainLbs;
    else for (const id of ITEMS) costs[id] = toHead(num(id));
    const purchasePerHead = bought ? lot.purchasePrice : 0;
    const purchaseWeight = bought ? (lot.startWeight || 0) : 0;
    return {
      cattleClass: lot.cattleClass, head, weight, saleDate: lot.saleDate,
      mode, cog: num("c-cog"), gainLbs,
      purchaseWeight, purchasePerHead,
      purchasePrice: CattleHedge.pricePerCwt(purchasePerHead, purchaseWeight),
      costs, purchase: purchasePerHead, per: "head",
      interestRate: num("b-rate") / 100, months: num("b-months"), deathLossPct: num("b-death"),
    };
  }

  // --- Calculate ----------------------------------------------------------------
  // The result only changes when the farmer presses "Calculate breakeven".
  function calculate() {
    if (!lot) return;
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
    // The result goes straight onto the lot, so Coverage analysis and the LRP tool always use it.
    if (lastResult) saveToLot();
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
    $("b-empty").innerHTML = !lot
      ? 'Add a lot on <a href="lots.html">My lots</a> first.'
      : calculated
        ? "Enter at least one cost above, then press <strong>Calculate breakeven</strong>."
        : "Enter your costs above, then press <strong>Calculate breakeven</strong>.";
    renderCowHelp();
    if (!hasCosts) return;

    const cog = CattleHedge.costOfGain(d, inp.purchaseWeight, inp.weight);
    $("b-tiles").innerHTML = [
      tile("Breakeven", cwtPrice(d.perCwt) + " /cwt", "the sale price that covers all your costs"),
      tile("Cost per head sold", money(d.perHead), `${(Math.round(d.soldHead * 10) / 10).toLocaleString()} of ${inp.head} head sold`),
      tile("Total all-in cost", money(d.totalCost), "for the whole group"),
      cog && inp.mode === "items" ? tile("Cost of gain", cwtPrice(cog.perLb) + " /lb", `${cog.gainLbs.toLocaleString()} lbs gained per head, purchase price not included`) : "",
    ].join("");

    // Where the money goes
    const rows = [];
    if (d.purchaseTotal) rows.push([inp.purchasePrice ? `Purchase price (${inp.purchaseWeight.toLocaleString()} lbs at ${cwtPrice(inp.purchasePrice)}/cwt)` : "Purchase price", d.purchaseTotal]);
    for (const l of d.lines) if (l.total) rows.push([l.name === "c-cog"
      ? `Cost of gain (${inp.gainLbs.toLocaleString()} lbs at ${cwtPrice(inp.cog)}/lb)` : LINES[l.name], l.total]);
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
  }

  // --- The lot ----------------------------------------------------------------
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function renderLotPicker() {
    const lots = Lots.load().filter(l => !l.keep);
    $("b-has-lots").hidden = lots.length === 0;
    $("b-no-lots").hidden = lots.length > 0;
    $("b-lot").innerHTML = lots.map(l => `<option value="${esc(l.id)}">${esc(l.name)}</option>`).join("");
    if (lot) $("b-lot").value = lot.id;
    $("b-lot-summary").innerHTML = lot
      ? `${esc(Lots.describe(lot))} <a href="lots.html?edit=${encodeURIComponent(lot.id)}">Edit lot</a>`
      : "";
  }

  // Switch to a lot: load its saved costs, or start fresh with months from its days on feed.
  function selectLot(newLot) {
    lot = newLot;
    calculated = null;
    lastResult = null;
    $("b-stale").hidden = true;
    $("b-lot-msg").hidden = true;
    $("b-example-note").hidden = true;
    if (!lot) { renderLotPicker(); render(); return; }
    Lots.setActive(lot.id);
    const saved = loadAll()[lot.id];
    document.querySelectorAll("[data-cost]").forEach(i => { i.value = ""; });
    $("b-rate").value = 8; $("b-death").value = 1; $("b-profit").value = 100;
    // Months you own them: from the purchase date (or today) to the lot's sale date
    const days = CattleHedge.daysBetween(lot.startDate || Lots.todayIso(), lot.saleDate);
    $("b-months").value = days > 0 ? Math.max(1, Math.round(days / 30.4)) : 7;
    $("c-cog").value = "";
    setPer("head");
    setMode("cog");
    if (saved && saved.values) {
      for (const [id, v] of Object.entries(saved.values)) if ($(id) && v !== undefined) $(id).value = v;
      setPer(saved.per || "head");
      setMode(saved.mode || "cog");
    }
    renderLotPicker();
    if (saved && saved.result) calculate(); else render();
  }

  function lotMessage(html, warn) {
    const msg = $("b-lot-msg");
    msg.hidden = false;
    msg.classList.toggle("warn", !!warn);
    msg.innerHTML = html;
  }

  // Saves the breakeven on the lot; returns true if it worked.
  function saveToLot() {
    if (!lot || !lastResult) return false;
    const fresh = Lots.find(lot.id) || lot;
    fresh.breakeven = lastResult.perCwt;
    if (!Lots.upsert(fresh)) {
      lotMessage("This browser isn't letting Cattle Hedge save (private window or strict privacy settings).", true);
      return false;
    }
    lot = fresh;
    lotMessage(`✓ Saved ${cwtPrice(lastResult.perCwt)}/cwt as the breakeven for "${esc(lot.name)}".`);
    return true;
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
    $("cow-result").innerHTML = perCalf > 0
      ? `Cost to raise each calf to weaning: <strong>${money(perCalf)}</strong>. <button type="button" class="btn btn-small" id="cow-apply">Use this number</button>`
      : "Enter your yearly cost per cow.";
  }

  // --- Wiring ---------------------------------------------------------------
  function setPer(value) {
    per = value;
    document.querySelectorAll("#b-per [data-per]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.per === per)));
    $("b-per-note").innerHTML = (per === "total"
      ? "Dollar amounts are <strong>for the whole group</strong>."
      : "Dollar amounts are <strong>per head</strong>.") + " Cost of gain is per lb.";
  }

  // Cost of gain (one number) or itemized costs. Bought lots use their purchase
  // price, so "Cost to raise the calf to weaning" only shows for calves you raised.
  function setMode(value) {
    mode = value;
    document.querySelectorAll("#b-mode [data-mode]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
    document.querySelectorAll(".mode-cog").forEach(el => { el.hidden = mode !== "cog"; });
    document.querySelectorAll(".mode-items").forEach(el => { el.hidden = mode !== "items"; });
    const bought = lot && lot.purchasePrice > 0;
    $("cow-field").hidden = bought;
    if (bought) $("cow-help").hidden = true;
  }

  function init() {
    if (!DATA) return;

    $("b-mode").addEventListener("click", e => {
      const b = e.target.closest("[data-mode]");
      if (!b || b.dataset.mode === mode) return;
      setMode(b.dataset.mode);
      if (mode === "items") fillItemDefaults();
      onInputChange();
    });

    document.querySelectorAll("#b-cost-form, .b-extra, #cow-help").forEach(el =>
      el.addEventListener("input", onInputChange));
    $("b-profit").addEventListener("input", () => { save(); render(); });
    $("b-calc").addEventListener("click", calculate);
    $("b-lot").addEventListener("change", () => selectLot(Lots.find($("b-lot").value)));

    // Switching per head <-> whole group converts the amounts already typed in
    $("b-per").addEventListener("click", e => {
      const b = e.target.closest("[data-per]");
      if (!b || b.dataset.per === per || !lot) return;
      const factor = b.dataset.per === "total" ? lot.head : 1 / lot.head;
      document.querySelectorAll("[data-cost]").forEach(i => {
        if (i.value !== "") i.value = Math.round(Number(i.value) * factor);
      });
      setPer(b.dataset.per);
      onInputChange();
    });

    $("b-example").addEventListener("click", () => {
      setPer("head");
      setMode("items");
      for (const [id, v] of Object.entries(EXAMPLE)) $(id).value = v;
      $("b-example-note").hidden = false;
      onInputChange();
    });
    $("b-clear").addEventListener("click", () => {
      document.querySelectorAll("[data-cost], #c-cog").forEach(i => { i.value = ""; });
      $("b-example-note").hidden = true;
      onInputChange();
    });

    $("cow-help-btn").addEventListener("click", () => { $("cow-help").hidden = !$("cow-help").hidden; renderCowHelp(); });
    $("cow-help").addEventListener("click", e => {
      if (e.target.id !== "cow-apply") return;
      const perCalf = CattleHedge.cowCostPerCalf(num("cow-cost"), num("cow-weaned"));
      $("c-cow").value = Math.round(per === "total" && lot ? perCalf * lot.head : perCalf);
      $("cow-help").hidden = true;
      onInputChange();
    });

    // The breakeven is already on the lot (saved when calculated): go find coverage for it
    $("b-use").addEventListener("click", () => {
      location.href = "lrp.html?lot=" + encodeURIComponent(lot.id);
    });
    $("b-analysis").addEventListener("click", () => {
      location.href = "analysis.html?lot=" + encodeURIComponent(lot.id);
    });

    selectLot(Lots.pickActive(true));
  }
  init();
})();
