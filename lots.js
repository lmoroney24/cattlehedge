// Saves the farmer's lots in this browser (localStorage).
// No accounts, no server: the lots stay on this one device and disappear if
// the browser's site data is cleared. Every access is wrapped in try/catch
// because some browsers (private windows, strict settings) block storage.

const Lots = (() => {
  const KEY = "simhedge.lots.v1";

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || "[]");
      return Array.isArray(saved) ? saved : [];
    } catch {
      return [];
    }
  }

  // Returns false if the browser wouldn't let us save.
  function save(lots) {
    try {
      localStorage.setItem(KEY, JSON.stringify(lots));
      return true;
    } catch {
      return false;
    }
  }

  function find(id) {
    return load().find(l => l.id === id) || null;
  }

  function upsert(lot) {
    const lots = load();
    const i = lots.findIndex(l => l.id === lot.id);
    if (i >= 0) lots[i] = lot; else lots.push(lot);
    return save(lots);
  }

  function remove(id) {
    return save(load().filter(l => l.id !== id));
  }

  // A recorded LRP plan only fits the cattle type and weight class it was bought
  // for. When a lot is edited, keep its plan only if it still fits.
  function fittingCoverage(old, lot) {
    if (!old || !old.coverage || lot.keep) return null;
    const code = l => CattleHedge.typeCode(l.cattleClass, CattleHedge.clampWeight(l.cattleClass, l.weight));
    return code(old) === code(lot) ? old.coverage : null;
  }

  function newId() {
    return "lot-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
  }

  // Today's date in the farmer's own time zone, as YYYY-MM-DD.
  function todayIso() {
    return new Date().toLocaleDateString("en-CA");
  }

  // The lot picked on My lots, Breakeven, or the LRP tool, remembered so the
  // next page opens on the same lot.
  const ACTIVE_KEY = "simhedge.activeLot.v1";
  function activeId() {
    try { return localStorage.getItem(ACTIVE_KEY); } catch { return null; }
  }
  function setActive(id) {
    try { localStorage.setItem(ACTIVE_KEY, id); } catch { /* storage blocked */ }
  }
  // The lot to show: ?lot=... in the link, else the last one picked, else the first sellable lot.
  function pickActive(sellableOnly) {
    const lots = load().filter(l => !(sellableOnly && l.keep));
    const fromUrl = new URLSearchParams(location.search).get("lot");
    return lots.find(l => l.id === fromUrl) || lots.find(l => l.id === activeId()) || lots[0] || null;
  }

  // One-line description of a lot, e.g. "40 feeder steers · 550 → 800 lbs at 2.5 lbs/day · bought for $2,227.50/head · sell Feb 13, 2027".
  const CLASS_WORDS = { steers: "feeder steers", heifers: "feeder heifers", fat: "fat cattle" };
  function describe(lot) {
    const date = new Date(lot.saleDate + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    const weights = lot.startWeight
      ? `${lot.startWeight.toLocaleString()} → ${lot.weight.toLocaleString()} lbs` + (lot.adg ? ` at ${lot.adg} lbs/day` : "")
      : `${lot.weight.toLocaleString()} lbs`;
    const bought = lot.purchasePrice > 0
      ? ` · bought for $${lot.purchasePrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/head`
      : "";
    return `${lot.head} ${CLASS_WORDS[lot.cattleClass] || lot.cattleClass} · ${weights}${bought} · sell ${date}`;
  }

  return { load, save, find, upsert, remove, fittingCoverage, newId, todayIso, activeId, setActive, pickActive, describe };
})();
