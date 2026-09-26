// The arithmetic behind a day in the food journal.
//
// This is the one file that knows how a serving scales and how a day adds up,
// and it is deliberately a module rather than part of validation.mjs: the
// server needs it to total a day, the unit tests need to call it directly, and
// the browser needs it to fill the serving fields as somebody types. Three
// consumers, one definition. index.html loads it with `type="module"`, which
// runs after the classic scripts, so app.js only ever reaches for it from
// inside an event handler - never at parse time.
//
// Two rules run through all of it, and both exist because the old code broke
// them. Missing is not zero. A quantity nobody has typed is not a quantity of
// zero, and a nutrient nobody recorded is not zero grams of it.

// A serving of a packaged food, scaled from its per-100g figures.
//
// The rule that matters here is what happens when the person has not said how
// much they ate yet. The previous version multiplied by a factor of 0, so
// picking a food wrote a confident "0 kcal / 0 g protein" into every field,
// and saving it stored those zeros as though they were measured. A missing
// quantity is not a quantity of zero: it returns nulls, and the form leaves
// the fields empty until there is a real serving to scale by.
//
// A nutrient the source itself does not carry stays null at every serving
// size, for the same reason.
const MAX_SERVING_G = 100000;
function servingMacros(per100g, quantityG) {
  const quantity = quantityG === '' || quantityG == null ? null : Number(quantityG);
  const usable = quantity !== null && Number.isFinite(quantity) && quantity > 0 && quantity <= MAX_SERVING_G;
  const blank = { calories: null, proteinG: null, carbsG: null, fatG: null };
  if (!usable || !per100g) return blank;
  const factor = quantity / 100;
  const scale = (value, decimals) => {
    if (value === '' || value == null) return null;
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) return null;
    const rounded = Math.round(number * factor * 10 ** decimals) / 10 ** decimals;
    return Number.isFinite(rounded) ? rounded : null;
  };
  return {
    calories: scale(per100g.calories, 0),
    proteinG: scale(per100g.proteinG, 1),
    carbsG:   scale(per100g.carbsG, 1),
    fatG:     scale(per100g.fatG, 1)
  };
}

// Day totals that can tell "nothing eaten" apart from "nobody wrote it down".
//
// Summing with `Number(value || 0)` makes those two cases identical: a day of
// three meals nobody put calories against reported a confident 0 kcal, which
// reads as a fast rather than as missing data. So the total counts only the
// entries that actually carry a figure, and reports how many did not. A total
// of null means no entry carried one at all, and the view shows a dash.
const NUTRIENT_KEYS = ['calories', 'protein_g', 'carbs_g', 'fat_g', 'water_ml'];
function nutritionTotals(entries) {
  const rows = Array.isArray(entries) ? entries : [];
  const totals = {};
  for (const key of NUTRIENT_KEYS) {
    let sum = 0, known = 0;
    for (const entry of rows) {
      const raw = entry?.[key];
      if (raw === '' || raw == null) continue;
      const value = Number(raw);
      if (!Number.isFinite(value)) continue;
      sum += value; known += 1;
    }
    totals[key] = {
      total: known ? Math.round(sum * 10) / 10 : null,
      known,
      missing: rows.length - known,
      entries: rows.length
    };
  }
  return totals;
}

// Share of a daily target, for the progress bar. Returns null when either side
// is unknown, so the bar can be absent rather than sitting at a confident zero.
function targetProgress(total, goal) {
  if (total == null || goal === '' || goal == null) return null;
  const target = Number(goal), value = Number(total);
  if (!Number.isFinite(target) || target <= 0 || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round((value / target) * 100)));
}

export { servingMacros, nutritionTotals, targetProgress, MAX_SERVING_G, NUTRIENT_KEYS };

// The browser loads this as a module and reads it off the window, because
// app.js is a classic script and cannot import.
if (typeof window !== 'undefined') {
  window.NutritionMath = { servingMacros, nutritionTotals, targetProgress, MAX_SERVING_G, NUTRIENT_KEYS };
}
