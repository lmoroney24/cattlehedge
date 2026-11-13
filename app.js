// Cattle Hedge page logic for the LRP tool and the Coverage analysis page.
// Both pages share this file; each draws only the sections it has.

(() => {
  const DATA = window.LRP_DATA;
  const $ = id => document.getElementById(id);

  // --- Formatting ----------------------------------------------------------
  const money = v => (v < 0 ? "-$" : "$") + Math.round(Math.abs(v)).toLocaleString("en-US");
  const signed = v => (v > 0 ? "+" : "") + money(v);
  const cwtPrice = v => (v < 0 ? "-$" : "$") + Math.abs(v).toFixed(2);
  const pct = v => +(v * 100).toFixed(1) + "%";
  // USDA subsidy is set in 5-point steps (35%, 40%, 45%...); the published
  // premiums are rounded to the cent, so we round the computed share to match.
  const subsidyPct = plan => Math.round(CattleHedge.subsidyShare(plan) * 20) * 5 + "%";
  const longDate = iso => new Date(iso + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const shortDate = iso => new Date(iso + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });

  // --- State ---------------------------------------------------------------
  let selectedLevel = null;   // coverage level picked by the farmer; null = use the recommendation
  let unit = "total";         // how money is shown: "total", "head" or "cwt"
  let activeLot = null;       // the lot from My lots this page is working on
  let lastPlan = null, lastMatch = null;

  // The risk choice and budget are set on Coverage analysis and remembered,
  // so the LRP tool shows the same plan.
  const PREFS_KEY = "simhedge.prefs.v1";
  function loadPrefs() {
    try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch { return {}; }
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify({ tolerance: tolerance(), budget: $("budget").value })); } catch {}
  }
  const has = id => !!$(id);

  function readHerd() {
    const budget = Number(has("budget") ? $("budget").value : loadPrefs().budget);
    return {
      cattleClass: activeLot.cattleClass,
      head: Math.max(1, activeLot.head),
      weight: CattleHedge.clampWeight(activeLot.cattleClass, activeLot.weight),
      rawWeight: activeLot.weight,
      saleDate: activeLot.saleDate,
      breakeven: Number($("breakeven").value) || 0,
      basis: 0,   // local basis was removed from the form; the sale price is taken as the index price
      budgetPerHead: budget > 0 ? budget : null,
    };
  }
  const tolerance = () => {
    const r = document.querySelector("input[name=tolerance]:checked");
    return r ? r.value : (loadPrefs().tolerance || "cheapest");
  };

  // --- Money in the chosen unit ---------------------------------------------
  // Every amount is calculated for the whole herd, then divided for display.
  function per(herd) {
    const cwt = CattleHedge.herdCwt(herd.head, herd.weight);
    const div = unit === "head" ? herd.head : unit === "cwt" ? cwt : 1;
    const suffix = unit === "head" ? "/head" : unit === "cwt" ? "/cwt" : "";
    const fmt = v => unit === "total" ? money(v / div) : cwtPrice(v / div);
    return {
      v: total => fmt(total) + suffix,
      s: total => (total > 0 ? "+" : "") + fmt(total) + suffix,
      raw: total => total / div,
      name: unit === "head" ? "$ per head" : unit === "cwt" ? "$ per cwt" : "total $",
      short: unit === "head" ? "per head" : unit === "cwt" ? "per cwt" : "total",
      axis: x => {
        if (unit !== "total") return (x < 0 ? "-$" : "$") + Math.abs(x).toFixed(Math.abs(x) < 10 ? 2 : 0);
        return Math.abs(x) >= 1000 ? (x < 0 ? "-$" : "$") + +(Math.abs(x) / 1000).toFixed(1) + "k" : money(x);
      },
    };
  }

  // --- Main render ---------------------------------------------------------
  function render() {
    if (!activeLot) return;
    const herd = readHerd();
    const code = CattleHedge.typeCode(herd.cattleClass, herd.weight);
    const type = DATA.types[code];
    const options = CattleHedge.currentOptions(DATA, code);
    const best = CattleHedge.matchEndorsement(options, herd.saleDate);
    if (!best) return;
    const match = best;   // one plan length: the one that ends closest to the sale date

    const rec = CattleHedge.recommend(match.levels, herd, tolerance());
    let plan = rec.plan;
    if (selectedLevel != null) {
      plan = match.levels.find(p => Math.abs(p.level - selectedLevel) < 1e-6) || closestLevel(match.levels, selectedLevel);
    }
    if (!plan) plan = closestLevel(match.levels, 0.95);

    lastPlan = plan; lastMatch = match;
    syncUnitButtons();
    renderProfile(herd, type);
    if (has("lot-banner")) renderLotBanner(plan);
    if (has("market")) renderMarket(herd, options, best, match, plan);
    if (has("tolerance")) {
      renderProfiles(herd, match);
      renderRecommendation(herd, match, rec, plan);
      renderTradeoff(herd, match, plan);
      renderBreakdown(herd, match, rec, plan);
    }
    if (has("simulator")) renderSimulator(herd, match, plan);
  }

  function closestLevel(levels, level) {
    return levels.reduce((b, p) => Math.abs(p.level - level) < Math.abs(b.level - level) ? p : b);
  }

  // --- Buy box (demo) --------------------------------------------------------
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // "Buy this plan" is a demo until Cattle Hedge is licensed: it saves the plan
  // on the lot so it shows up on My coverage. Nothing is bought or sent.
  function renderLotBanner(plan, message) {
    const banner = $("lot-banner");
    if (!activeLot) { banner.hidden = true; return; }
    banner.hidden = false;
    banner.innerHTML = `
      <p><strong>Buy this plan for "${esc(activeLot.name)}"</strong> <span class="badge">Demo</span></p>
      <div class="form-actions">
        <button type="button" class="btn" id="record-plan">Buy the ${pct(plan.level)} plan</button>
        <a class="btn btn-quiet" href="coverage.html">See my coverage</a>
      </div>
      ${message ? `<p class="saved">${message}</p>` : ""}
      <p class="fine">Cattle Hedge isn't licensed yet: this adds the plan to My coverage as a demo, and nothing is bought.
        To buy today, use an approved agent (<a href="https://www.rma.usda.gov/tools-reports/agent-locator" target="_blank" rel="noopener">USDA agent locator</a>).</p>`;
    $("record-plan").addEventListener("click", recordPlan);
  }

  function recordPlan() {
    const herd = readHerd();
    const lot = Lots.find(activeLot.id) || activeLot;
    Object.assign(lot, {
      coverage: {
        level: lastPlan.level, coverage: lastPlan.coverage, premium: lastPlan.premium,
        cost: lastPlan.cost, endDate: lastMatch.endDate, weeks: lastMatch.weeks,
        effectiveDate: DATA.current.effectiveDate,
      },
    });
    activeLot = lot;
    const ok = Lots.upsert(lot);
    renderLotBanner(lastPlan, ok
      ? `✓ Added the ${pct(lastPlan.level)} plan for "${esc(lot.name)}" to My coverage (demo). <a href="coverage.html">See my coverage →</a>`
      : "This browser isn't letting Cattle Hedge save (private window or strict privacy settings).");
  }

  // --- Picking the lot ------------------------------------------------------
  // Example breakevens until the farmer calculates their own (labeled on the page).
  const EXAMPLE_BE = { feeder: 300, fat: 225 };

  function renderLotPicker() {
    const lots = Lots.load().filter(l => !l.keep);
    $("has-lots").hidden = !lots.length;
    $("no-lots").hidden = !!lots.length;
    for (const id of ["market", "tolerance", "simulator"]) if (has(id)) $(id).hidden = !activeLot;
    $("lot-select").innerHTML = lots.map(l => `<option value="${esc(l.id)}">${esc(l.name)}</option>`).join("");
    if (!activeLot) { if (has("lot-banner")) $("lot-banner").hidden = true; return; }
    $("lot-select").value = activeLot.id;
    const editHref = `lots.html?edit=${encodeURIComponent(activeLot.id)}`;
    const kind = { steers: "feeder steers", heifers: "feeder heifers", fat: "fat cattle" }[activeLot.cattleClass] || activeLot.cattleClass;
    $("lot-summary").innerHTML = `${activeLot.head} ${kind} · ${activeLot.weight.toLocaleString()} lbs <a href="${editHref}">Edit lot</a>`;
    $("sale-text").textContent = longDate(activeLot.saleDate);
    $("sale-edit").href = editHref;
  }

  function selectLot(lot) {
    activeLot = lot;
    selectedLevel = null;
    if (lot) {
      Lots.setActive(lot.id);
      const be = $("breakeven"), help = $("breakeven-help");
      const link = `<a href="breakeven.html?lot=${encodeURIComponent(lot.id)}">`;
      // The breakeven comes from the lot and can only be changed on the Breakeven page.
      if (lot.breakeven > 0) {
        be.value = lot.breakeven;
        help.innerHTML = `From this lot. ${link}Recalculate →</a>`;
      } else {
        be.value = EXAMPLE_BE[CattleHedge.isFat(lot.cattleClass) ? "fat" : "feeder"];
        help.innerHTML = `<em>Example value.</em> ${link}Calculate yours →</a>`;
      }
      $("breakeven-text").textContent = cwtPrice(Number(be.value));
      if (lot.coverage) selectedLevel = lot.coverage.level;
    }
    renderLotPicker();
    if (lot) render();
  }

  // --- 1. Profile ----------------------------------------------------------
  // Only speaks up when the lot's weight is outside what this LRP product covers.
  function renderProfile(herd) {
    const note = $("profile-note");
    const range = CattleHedge.weightRange(herd.cattleClass);
    const out = herd.rawWeight > range.max || herd.rawWeight < range.min;
    note.hidden = !out;
    if (!out) return;
    const fat = CattleHedge.isFat(herd.cattleClass);
    note.textContent = herd.rawWeight > range.max
      ? (fat ? `LRP Fed Cattle covers fat cattle up to ${range.max.toLocaleString()} lbs. Showing ${range.max.toLocaleString()} lbs.`
             : "Over 1,000 lbs, these are fat cattle, a different LRP product with different prices. Edit the lot and pick \"Fat cattle.\" Showing 1,000 lbs.")
      : (fat ? "Under 1,000 lbs, these are feeder cattle, a different LRP product with different prices. Edit the lot and pick feeder steers or heifers. Showing 1,000 lbs."
             : `LRP Feeder Cattle starts at ${range.min} lbs. Showing ${range.min} lbs.`);
  }

  // --- 2. Market -----------------------------------------------------------
  function renderMarket(herd, options, best, match, plan) {
    const u = per(herd);
    const cwt = CattleHedge.herdCwt(herd.head, herd.weight);
    const exp = match.levels[0].expEnd;
    $("market-summary").innerHTML = [
      stat("Expected price at your sale", cwtPrice(exp) + " /cwt", `≈ ${money(exp * herd.weight / 100)} per head`),
      stat("Your lot at that price", u.v(exp * cwt), u.short),
      stat("LRP coverage ends", longDate(match.endDate), `${match.weeks}-week plan`),
    ].join("");

    const index = CattleHedge.indexName(herd.cattleClass);
    if (has("index-callout")) $("index-callout").innerHTML =
      `<strong>LRP pays based on the ${index} ${CattleHedge.isFat(herd.cattleClass) ? "for the week of" : "on"} your contract end date.</strong>`;

    renderLengths(herd, match);

    $("levels-table").querySelector("tbody").innerHTML = match.levels.map(p => {
      const floor = CattleHedge.floorPrice(p, herd.basis);
      const safe = floor >= herd.breakeven;
      const isSel = p === plan;
      const over = herd.budgetPerHead && CattleHedge.costPerHead(p, herd.weight) > herd.budgetPerHead;
      return `<tr data-level="${p.level}" class="${isSel ? "selected" : ""}${over ? " over-budget" : ""}" tabindex="0">
        <td>${pct(p.level)}${isSel ? " · selected" : ""}${over ? ' <span class="badge">Over budget</span>' : ""}</td>
        <td>${cwtPrice(p.coverage)}</td>
        <td>${cwtPrice(floor)}</td>
        <td>${cwtPrice(p.cost)}</td>
        <td>${cwtPrice(p.cost - p.premium)} <span class="sub">(${subsidyPct(p)})</span></td>
        <td>${cwtPrice(p.premium)}</td>
        <td>${cwtPrice(CattleHedge.costPerHead(p, herd.weight))}</td>
        <td>${money(p.premium * cwt)}</td>
        <td class="${safe ? "yes" : "no"}">${safe ? "✓ Yes" : "✗ No"}</td>
      </tr>`;
    }).join("");

    const herdLbs = herd.head * herd.weight;
    const fut = CattleHedge.futuresContract(herd.cattleClass);
    const share = herdLbs / fut.lbs;
    if (has("futures-note")) $("futures-note").textContent =
      `Why not futures? One ${fut.name} contract is ${fut.lbs.toLocaleString()} lbs. Your herd is ${herdLbs.toLocaleString()} lbs, ` +
      `${share < 1 ? "only " : ""}${Math.round(share * 100)}% of ${share < 1 ? "one contract" : "a contract"}, so futures can't match it cleanly ` +
      `(and brokers usually want a margin account). LRP covers any number of head.`;

    $("data-source").innerHTML =
      `Source: <a href="${DATA.source}" target="_blank" rel="noopener">USDA Risk Management Agency</a>, ${DATA.state}, prices from ${longDate(DATA.current.effectiveDate)}.`;
  }

  // Plan lengths on sale today. Each one is a button, marked by where the
  // sale date falls against that plan's 60-day ownership window.
  const WINDOW_MARK = { window: ["ok", "✓"], close: ["ok", "✓"], early: ["early", "✗"], after: ["after", "◷"] };
  // A plan that ends a few days before the sale is fine: the farmer owns the
  // cattle through the end date. Only a gap of more than 3 weeks is flagged.
  function windowFor(endDate, saleDate) {
    const w = CattleHedge.saleWindow(endDate, saleDate);
    if (w.status === "after" && w.daysAfter <= 21) w.status = "close";
    return w;
  }

  // The plan length is set by the sale date: the one that ends closest to it.
  function renderLengths(herd, match) {
    const w = windowFor(match.endDate, herd.saleDate);
    const days = n => `${n} day${n === 1 ? "" : "s"}`;
    const text = {
      window: "✓ Your sale is in the plan's last 60 days, so coverage holds.",
      close: `✓ The plan ends ${days(w.daysAfter)} before your sale. Coverage holds.`,
      early: "✗ You'd sell more than 60 days before the plan ends, so LRP won't pay. Wait to sell, or skip LRP.",
      after: `◷ The plan ends ${days(w.daysAfter)} before your sale. Prices can still move after it ends.`,
    }[w.status];
    $("length-explain").innerHTML = `<span class="window-line ${WINDOW_MARK[w.status][0]}">${text}</span>`;
  }



  function stat(label, value, sub, color) {
    const sw = color ? `<span class="swatch" style="background:${color}"></span>` : "";
    return `<div class="stat"><div class="label">${sw}${label}</div><div class="value">${value}</div><div class="sub">${sub || ""}</div></div>`;
  }

  // --- 3. Recommendation ---------------------------------------------------
  function renderRecommendation(herd, match, rec, plan) {
    const cwt = CattleHedge.herdCwt(herd.head, herd.weight);
    const floor = CattleHedge.floorPrice(plan, herd.basis);
    const box = $("recommendation");
    const picked = selectedLevel != null && plan !== rec.plan;
    const perHead = CattleHedge.costPerHead(plan, herd.weight);
    let title;
    if (picked) title = `You're trying the ${pct(plan.level)} plan.`;
    else if (rec.reason === "opportunity") title = `More opportunity: the ${pct(plan.level)} plan.`;
    else if (rec.reason === "cheapest-safe") title = `Best fit: the ${pct(plan.level)} plan.`;
    else if (rec.reason === "max") title = `Most protection${herd.budgetPerHead ? " within your budget" : ""}: the ${pct(plan.level)} plan.`;
    else if (rec.reason === "none-safe") title = `No plan available today protects your breakeven. Closest: ${pct(plan.level)}.`;
    else if (rec.reason === "none-safe-budget") title = `No plan within your budget protects your breakeven. Best you can afford: ${pct(plan.level)}.`;
    else if (rec.reason === "over-budget") title = `Every plan costs more than ${money(herd.budgetPerHead)} per head. The cheapest is ${pct(plan.level)} at ${cwtPrice(perHead)} per head.`;
    else title = `Comparing every level. Showing the ${pct(plan.level)} plan; click any dot in the chart to switch.`;

    box.innerHTML = `<p><strong>${title}</strong></p>
      <p>Locks in ${cwtPrice(plan.coverage)}/cwt until ${longDate(match.endDate)}. Worst case after its cost:
      <strong>${cwtPrice(floor)}/cwt</strong> vs. your ${cwtPrice(herd.breakeven)} breakeven.
      Cost: <strong>${money(plan.premium * cwt)}</strong> (${cwtPrice(perHead)} per head).</p>` +
      (CattleHedge.soldTooEarly(match.endDate, herd.saleDate)
        ? `<p class="warn-line">⚠ Your sale date is more than 60 days before this plan ends, so LRP won't pay if you sell then.</p>`
        : "");
  }

  // What-you-want cards: No coverage, More opportunity, A mix, More security.
  // Each shows the plan that choice picks and what it does if prices move.
  // Amounts are for the whole lot, measured against breakeven.
  function renderProfiles(herd, match) {
    const cwt = CattleHedge.herdCwt(herd.head, herd.weight);
    const exp = match.levels[0].expEnd;
    const fall = exp * 0.8, rise = exp * 1.1;
    const row = (label, value, cls) => `<div><dt>${label}</dt><dd class="${cls || ""}">${value}</dd></div>`;
    const money0 = v => `${signed(v)}`;
    const tone = v => (v >= 0 ? "pos" : "neg");

    // What today's futures and options imply (read from USDA's premiums; not a forecast)
    const T = CattleHedge.daysBetween(DATA.current.effectiveDate, match.endDate) / 365;
    const volOf = p => CattleHedge.impliedVol(p.expEnd, p.coverage, p.cost, T);
    const atm = closestLevel(match.levels, 1);
    const vol = volOf(atm);
    const chanceText = c => c == null ? "–" : c < 0.01 ? "under 1%" : c > 0.99 ? "over 99%" : Math.round(c * 100) + "%";
    const belowBe = vol ? CattleHedge.chanceBelow(exp, herd.breakeven, vol, T) : null;
    renderMarketView(herd, match, exp, vol, T, belowBe, chanceText);

    const none = { down: CattleHedge.outcome(herd, fall, null), up: CattleHedge.outcome(herd, rise, null) };
    $("pc-none").innerHTML = `<dl>
        ${row("Cost", "$0")}
        ${row("Worst case", "No floor")}
        ${row("Chance below breakeven", chanceText(belowBe))}
        ${row("Prices fall 20%", money0(none.down.profit), tone(none.down.profit))}
        ${row("Prices rise 10%", money0(none.up.profit), tone(none.up.profit))}
      </dl>
      <p>Nothing to pay, but you carry the full price risk. A 20% drop puts the lot ${none.down.profit >= 0 ? "still above" : money(-none.down.profit) + " below"} breakeven.</p>`;

    for (const t of ["opportunity", "cheapest", "max"]) {
      const rec = CattleHedge.recommend(match.levels, herd, t);
      const p = rec.plan;
      const floor = CattleHedge.floorPrice(p, herd.basis);
      const vsBe = floor - herd.breakeven;
      const drop = CattleHedge.dropBeforePays(p, exp);
      const down = CattleHedge.outcome(herd, fall, p), up = CattleHedge.outcome(herd, rise, p);
      const giveUp = none.up.profit - up.profit;
      let why;
      if (t === "opportunity") why = `Costs the least, so you keep the most if prices rise. It only pays once prices fall ${pct(drop)} or more.`;
      else if (t === "max") why = `The highest floor${herd.budgetPerHead ? " within your budget" : ""}: it pays on ${drop > 0 ? `any drop past ${pct(drop)}` : "any drop at all"}. If prices rise, you give up its ${money(giveUp)} cost.`;
      else if (rec.reason === "cheapest-safe") why = `The cheapest plan whose worst case stays at or above your breakeven.`;
      else if (rec.reason === "over-budget") why = `Every plan is over your budget; this is the cheapest.`;
      else why = `No plan${rec.reason === "none-safe-budget" ? " within your budget" : ""} keeps you at breakeven today; this one gets closest.`;
      $("pc-" + t).innerHTML = `<dl>
          ${row("Plan", `${pct(p.level)} · ${cwtPrice(p.coverage)}/cwt`)}
          ${row("Cost", `${money(p.premium * cwt)} <span class="sub">(${cwtPrice(CattleHedge.costPerHead(p, herd.weight))}/head)</span>`)}
          ${row("Worst case", `${cwtPrice(floor)}/cwt`, tone(vsBe))}
          ${row("Pays after a drop of", drop > 0 ? pct(drop) : "any drop")}
          ${row("Chance it pays", (() => { const v = volOf(p); return chanceText(v ? CattleHedge.chanceBelow(exp, p.coverage, v, T) : null); })())}
          ${row("Prices fall 20%", money0(down.profit), tone(down.profit))}
          ${row("Prices rise 10%", money0(up.profit), tone(up.profit))}
        </dl>
        <p>${why}</p>`;
    }
  }

  // The box above the cards: the price swing today's options prices imply.
  function renderMarketView(herd, match, exp, vol, T, belowBe, chanceText) {
    const box = $("market-view");
    if (!vol) { box.hidden = true; return; }
    box.hidden = false;
    const r = CattleHedge.expectedRange(exp, vol, T);
    box.innerHTML = `<h3>What the market expects by ${longDate(match.endDate)}</h3>
      <div class="stat-row">
        ${stat("Expected price", cwtPrice(exp) + " /cwt", "from CME futures")}
        ${stat("Likely range", `$${Math.round(r.low)}–$${Math.round(r.high)}`, `per cwt (±${Math.round(r.pct * 100)}%), about 2 times in 3`)}
        ${stat("Expected swing", `${Math.round(vol * 100)}% a year`, "implied volatility, from options")}
        ${stat("Chance below your breakeven", chanceText(belowBe), `${cwtPrice(herd.breakeven)}/cwt, with no coverage`)}
      </div>
      <details>
        <summary>How we got these numbers</summary>
        <p>USDA sets each plan's expected price from CME ${CattleHedge.isFat(herd.cattleClass) ? "Live" : "Feeder"} Cattle futures, and prices its premium like a CME put option on the index.
          We take the full premium (before USDA's subsidy) and work the standard option formula (Black-76) backwards to find the price swing it implies.
          That swing gives the likely range and each plan's chance of paying.</p>
        <p>These are read from today's market prices. They are not a forecast, and they change every day.</p>
      </details>`;
  }

  // Protection vs. cost: one dot per coverage level.
  function renderTradeoff(herd, match, plan) {
    const u = per(herd);
    const cwt = CattleHedge.herdCwt(herd.head, herd.weight);
    const budgetTotal = herd.budgetPerHead ? herd.budgetPerHead * herd.head : null;
    Charts.scatter($("tradeoff-chart"), {
      color: Charts.cssVar("--series-lrp"),
      points: match.levels.map(p => {
        const floor = CattleHedge.floorPrice(p, herd.basis);
        return {
          id: p.level, x: u.raw(p.premium * cwt), y: floor, label: pct(p.level), selected: p === plan,
          tip: `<div class="t-head">${pct(p.level)} coverage</div>
            <div class="t-row"><span>Your cost</span><b>${u.v(p.premium * cwt)}</b></div>
            <div class="t-row"><span>Worst-case price</span><b>${cwtPrice(floor)}/cwt</b></div>
            <div class="t-row"><span>Covers breakeven?</span><b>${floor >= herd.breakeven ? "Yes" : "No"}</b></div>`,
        };
      }),
      hLine: { y: herd.breakeven, label: `Your breakeven ${cwtPrice(herd.breakeven)}` },
      vLine: budgetTotal ? { x: u.raw(budgetTotal), label: "Your budget" } : null,
      xFormat: u.axis,
      yFormat: v => "$" + Math.round(v),
      xTitle: `Your cost (${u.name})`,
      yTitle: "Worst-case price ($/cwt)",
      onPick: level => { selectedLevel = level; render(); },
    });
  }

  // --- 4. Simulator --------------------------------------------------------
  function renderSimulator(herd, match, plan) {
    const u = per(herd);
    const move = Number($("move").value) / 100;
    const exp = match.levels[0].expEnd;
    const price = exp * (1 + move);
    $("move-label").textContent =
      `${move > 0 ? "+" : ""}${Math.round(move * 100)}% → ${cwtPrice(price)}/cwt` + (move === 0 ? " (no change)" : "");

    // Coverage level picker (lowest to highest)
    const asc = match.levels.slice().sort((a, b) => a.level - b.level);
    $("level-chips").innerHTML = asc.map(p =>
      `<button type="button" class="len${p === plan ? " on" : ""}" data-level="${p.level}" aria-pressed="${p === plan}">${pct(p.level)}</button>`).join("");
    const i = asc.indexOf(plan);
    $("level-prev").disabled = i <= 0;
    $("level-next").disabled = i >= asc.length - 1;

    const none = CattleHedge.outcome(herd, price, null);
    const withPlan = CattleHedge.outcome(herd, price, plan);
    const gain = m => { const q = exp * (1 + m / 100); return CattleHedge.outcome(herd, q, plan).profit - CattleHedge.outcome(herd, q, null).profit; };
    // Gray, not red, for the premium: it's the price of insurance, not a loss.
    const posColor = Charts.cssVar("--good-ink"), negColor = Charts.cssVar("--ink-3");

    // The insurance trade in three numbers: the small cost, where it turns, the big save.
    const cost = withPlan.premium;
    const payBack = (exp - (plan.coverage - plan.premium)) / exp;   // drop where payout > premium
    const minMove = Number($("move").min);
    $("sim-tiles").innerHTML = [
      stat("If prices hold or rise", u.v(cost) + " premium", "what the coverage costs; no payout", negColor),
      stat("Starts paying you back", payBack > 0 ? `${pct(payBack)}+ drop` : "Any drop", `prices below ${cwtPrice(plan.coverage - plan.premium)}/cwt`),
      stat(`If prices fall ${Math.abs(minMove)}%`, "Saves " + u.v(gain(minMove)), "vs. no coverage", posColor),
    ].join("");

    const xs = [];
    for (let mv = minMove; mv <= Number($("move").max); mv++) xs.push(mv);   // -25% to +25%
    $("sim-legend").innerHTML = `<span style="--c:${posColor}">LRP pays you back</span><span style="--c:${negColor}">Premium only (no payout)</span>`;
    Charts.bars($("sim-chart"), {
      values: xs.map(mv => ({ x: mv, y: u.raw(gain(mv)) })),
      posColor, negColor,
      marker: Math.round(move * 100),
      xFormat: v => (v > 0 ? "+" : "") + v + "%",
      yFormat: (v, inTip) => inTip ? (v > 0 ? "+" : "") + u.axis(v) : u.axis(v),
      tipTitle: x => `Prices ${x > 0 ? "+" : ""}${x}% → ${cwtPrice(exp * (1 + x / 100))}/cwt`,
      xTitle: "Change in cattle price by your sale date",
      yTitle: `LRP vs. no coverage (${u.name})`,
      onPick: x => { $("move").value = x; render(); },   // drag across the chart = move the slider
    });

    const diff = withPlan.profit - none.profit;
    $("sim-pick").innerHTML =
      `At ${move > 0 ? "+" : ""}${Math.round(move * 100)}% (${cwtPrice(price)}/cwt): no coverage <strong>${u.s(none.profit)}</strong>, ` +
      `with ${pct(plan.level)} LRP <strong>${u.s(withPlan.profit)}</strong> vs. breakeven. ` +
      (withPlan.payout > 0
        ? `LRP ${diff >= 0 ? "adds" : "changes it by"} <strong>${u.s(diff)}</strong> (pays ${u.v(withPlan.payout)}, minus the ${u.v(withPlan.premium)} premium).`
        : `No payout at this price; you pay the <strong>${u.v(withPlan.premium)}</strong> premium for the protection.`);

    $("scenario-caption").textContent =
      `Every plan if prices end ${move > 0 ? "up" : move < 0 ? "down" : "flat"} ${Math.abs(Math.round(move * 100))}% ` +
      `(${cwtPrice(price)}/cwt), shown ${u.short}. Click a row to try that plan.`;
    const rows = [{ label: "No coverage", r: none }].concat(match.levels.map(p => ({ label: `LRP ${pct(p.level)}`, r: CattleHedge.outcome(herd, price, p), p })));
    $("scenario-table").querySelector("tbody").innerHTML = rows.map(({ label, r, p }) => `
      <tr class="${p === plan ? "selected" : ""}"${p ? ` data-level="${p.level}" tabindex="0"` : ""}>
        <td>${label}</td><td>${u.v(r.saleRevenue)}</td><td>${u.v(r.payout)}</td><td>${u.v(r.premium)}</td>
        <td class="${r.profit >= 0 ? "yes" : "no"}">${u.s(r.profit)}</td>
        <td>${p ? u.s(r.profit - none.profit) : "–"}</td>
      </tr>`).join("");
  }

  // --- Breakdown ------------------------------------------------------------
  // Built only from the numbers above. No forecasts. Always in whole-herd dollars.
  function renderBreakdown(herd, match, rec, plan) {
    const cwt = CattleHedge.herdCwt(herd.head, herd.weight);
    const exp = match.levels[0].expEnd;
    const floor = CattleHedge.floorPrice(plan, herd.basis);
    const cost = plan.premium * cwt;
    const p = [];

    p.push(`Your ${herd.head} ${herd.cattleClass} at ${herd.weight} lbs add up to ${cwt.toLocaleString()} cwt. ` +
      `Today the futures market expects these cattle to be worth about ${cwtPrice(exp)}/cwt around ${longDate(match.endDate)}, ` +
      `which is ${exp >= herd.breakeven ? "above" : "below"} your ${cwtPrice(herd.breakeven)} breakeven.`);

    const safe = match.levels.filter(l => CattleHedge.floorPrice(l, herd.basis) >= herd.breakeven);
    const userPicked = selectedLevel != null && plan !== rec.plan;

    if ((rec.reason === "none-safe" || rec.reason === "none-safe-budget") && !userPicked) {
      p.push(`No LRP plan ${rec.reason === "none-safe-budget" ? "within your budget" : "on sale today"} can guarantee your breakeven. ` +
        `The best worst-case price is ${cwtPrice(floor)}/cwt, ${cwtPrice(herd.breakeven - floor)} short. ` +
        `LRP can still limit how much you lose in a price drop, but it can't promise a profit at these prices.`);
    } else if (rec.reason === "over-budget" && !userPicked) {
      p.push(`Your budget is ${money(herd.budgetPerHead)} per head, and the cheapest plan costs ${cwtPrice(CattleHedge.costPerHead(plan, herd.weight))} per head. ` +
        `Raising the budget or choosing a different plan length may help.`);
    } else if (rec.reason === "max" && !userPicked) {
      const cheapest = safe.length ? safe.reduce((a, b) => a.premium < b.premium ? a : b) : null;
      p.push(`The ${pct(plan.level)} plan locks in the highest price ${herd.budgetPerHead ? "within your budget" : "available"}, ${cwtPrice(plan.coverage)}/cwt, for ${money(cost)}.` +
        (cheapest && cheapest !== plan && cheapest.premium < plan.premium
          ? ` That's ${money(cost - cheapest.premium * cwt)} more than the cheapest plan that still covers your breakeven (${pct(cheapest.level)} at ${money(cheapest.premium * cwt)}). The extra buys ${cwtPrice(plan.coverage - cheapest.coverage)}/cwt of additional price floor.`
          : ""));
    } else if (rec.reason === "compare" && !userPicked) {
      const costs = match.levels.map(l => l.premium * cwt);
      p.push(`Plans range from ${money(Math.min(...costs))} to ${money(Math.max(...costs))} for your herd. ` +
        `${safe.length} of ${match.levels.length} coverage levels keep your worst case at or above breakeven.`);
    } else {
      const cheaper = match.levels.filter(l => l.premium < plan.premium).sort((a, b) => b.premium - a.premium)[0];
      p.push(`The ${pct(plan.level)} plan locks in ${cwtPrice(plan.coverage)}/cwt. After its ${cwtPrice(plan.premium)}/cwt cost, ` +
        `the lowest you'd end up with is ${cwtPrice(floor)}/cwt, ${floor >= herd.breakeven ? cwtPrice(floor - herd.breakeven) + " above" : cwtPrice(herd.breakeven - floor) + " below"} breakeven. ` +
        `It costs ${money(cost)} total, and USDA pays ${subsidyPct(plan)} of the full premium.` +
        (cheaper && rec.reason === "cheapest-safe" && !userPicked
          ? ` The next cheaper plan (${pct(cheaper.level)}) would leave a worst case of ${cwtPrice(CattleHedge.floorPrice(cheaper, herd.basis))}, below breakeven, which is why it isn't the pick.`
          : ""));
    }

    const down = CattleHedge.outcome(herd, exp * 0.85, plan), downNone = CattleHedge.outcome(herd, exp * 0.85, null);
    const up = CattleHedge.outcome(herd, exp * 1.10, plan), upNone = CattleHedge.outcome(herd, exp * 1.10, null);
    p.push(`For scale: if prices fell 15%, doing nothing would leave you ${signed(downNone.profit)} vs. breakeven and this plan ${signed(down.profit)}. ` +
      `If prices rose 10%, the plan pays nothing and you'd give up its ${money(up.premium)} cost (${signed(upNone.profit)} without it vs. ${signed(up.profit)} with it). ` +
      `That cost is the price of the protection.`);

    $("breakdown-text").innerHTML = p.map(t => `<p>${t}</p>`).join("");
  }

  // --- Wiring --------------------------------------------------------------
  function syncUnitButtons() {
    document.querySelectorAll(".unit-toggle [data-unit]").forEach(b =>
      b.setAttribute("aria-pressed", String(b.dataset.unit === unit)));
  }

  function stepLevel(dir) {
    const asc = lastMatch.levels.slice().sort((a, b) => a.level - b.level);
    const i = asc.indexOf(lastPlan) + dir;
    if (i >= 0 && i < asc.length) { selectedLevel = asc[i].level; render(); }
  }

  function init() {
    if (!DATA) {
      document.querySelector("main").innerHTML = `<section class="card"><h2>Data missing</h2><p>Run <code>python3 site/tools/fetch_lrp.py</code> to download USDA LRP data.</p></section>`;
      return;
    }
    $("lot-select").addEventListener("change", () => selectLot(Lots.find($("lot-select").value)));

    // A new herd or priority resets the picks back to the recommendation.
    $("herd-form").addEventListener("submit", e => e.preventDefault());
    if (has("tolerance")) {
      const prefs = loadPrefs();
      // (An old saved "compare" choice no longer has a card, so it falls back to the mix.)
      const saved = document.querySelector(`input[name=tolerance][value="${prefs.tolerance}"]`);
      if (saved) saved.checked = true;
      if (prefs.budget) $("budget").value = prefs.budget;
      document.querySelectorAll("input[name=tolerance]").forEach(r =>
        r.addEventListener("change", () => { selectedLevel = null; savePrefs(); render(); }));
      $("budget").addEventListener("input", () => { selectedLevel = null; savePrefs(); render(); });
    }
    if (has("move")) $("move").addEventListener("input", render);

    // Picking a plan: table rows (sections 2 and 4) and level chips
    const pickRow = e => {
      const el = e.target.closest("[data-level]");
      if (!el) return;
      selectedLevel = Number(el.dataset.level);
      render();
    };
    for (const id of ["levels-table", "scenario-table", "level-chips"]) {
      if (!has(id)) continue;
      $(id).addEventListener("click", pickRow);
      $(id).addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pickRow(e); } });
    }
    if (has("level-prev")) {
      $("level-prev").addEventListener("click", () => stepLevel(-1));
      $("level-next").addEventListener("click", () => stepLevel(1));
    }


    // Total / per head / per cwt
    document.querySelectorAll(".unit-toggle").forEach(g => g.addEventListener("click", e => {
      const b = e.target.closest("[data-unit]");
      if (!b) return;
      unit = b.dataset.unit;
      render();
    }));

    // Redraw charts in the right colors if the device switches light/dark mode.
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", render);
    selectLot(Lots.pickActive(true));
  }
  init();
})();
