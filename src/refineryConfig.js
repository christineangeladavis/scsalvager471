// =============================================================================
// Refinery Configuration
// -----------------------------------------------------------------------------
// All data and helpers for the Refinery Bonus Yield Calculator live here.
//
// To update the calculator with new game data, edit ONLY this file:
//   • Add/remove a refinery location → edit `refineryLocations`
//   • Adjust per-location bonuses    → edit the `bonuses` object on a location
//   • Add/remove a material          → edit `refineryMaterials`
//   • Adjust a material's max yield  → edit its `maxBaseRate`
//   • Add/remove a refinery method   → edit `refineryMethods`
//   • Tune yield/cost/time per method→ edit `yieldPer240`/`costPer240`/`timeSeconds`
//
// All numbers in `refineryMethods` are baselined to a 240 SCU input of
// Construction Salvage. The calculator scales linearly from there.
// =============================================================================


// -----------------------------------------------------------------------------
// Refinery locations
// -----------------------------------------------------------------------------
// `bonuses` maps a material name (must match an entry in `refineryMaterials`)
// to a percentage point bonus added to the base yield rate. Materials not
// listed in `bonuses` get +0%.
export const refineryLocations = [
  { name: "Levski",                  system: "Nyx",     bonuses: { "Construction Salvage": 9, "Construction Pieces": 0, "Construction Rubble": 8 } },
  { name: "Checkmate",               system: "Pyro",    bonuses: { "Construction Salvage": 0, "Construction Pieces": 0, "Construction Rubble": 0 } },
  { name: "Nyx Gateway (Pyro)",      system: "Pyro",    bonuses: { "Construction Salvage": 0, "Construction Pieces": 0, "Construction Rubble": 0 } },
  { name: "Orbituary",               system: "Pyro",    bonuses: { "Construction Salvage": 0, "Construction Pieces": 0, "Construction Rubble": 0 } },
  { name: "Pyro Gateway (Nyx)",      system: "Nyx",     bonuses: { "Construction Salvage": 0, "Construction Pieces": 0, "Construction Rubble": 0 } },
  { name: "Ruin Station",            system: "Pyro",    bonuses: { "Construction Salvage": 0, "Construction Pieces": 0, "Construction Rubble": 0 } },
  { name: "Stanton Gateway (Nyx)",   system: "Nyx",     bonuses: { "Construction Salvage": 0, "Construction Pieces": 0, "Construction Rubble": 0 } },
  { name: "ARC-L1",                  system: "Stanton", bonuses: { "Construction Salvage": 0, "Construction Pieces": 0, "Construction Rubble": 0 } },
  { name: "ARC-L2",                  system: "Stanton", bonuses: { "Construction Salvage": 0, "Construction Pieces": 0, "Construction Rubble": 0 } },
  { name: "ARC-L4",                  system: "Stanton", bonuses: { "Construction Salvage": 0, "Construction Pieces": 0, "Construction Rubble": 0 } },
  { name: "CRU-L1",                  system: "Stanton", bonuses: { "Construction Salvage": 0, "Construction Pieces": 0, "Construction Rubble": 0 } },
  { name: "HUR-L1",                  system: "Stanton", bonuses: { "Construction Salvage": 0, "Construction Pieces": 0, "Construction Rubble": 0 } },
  { name: "HUR-L2",                  system: "Stanton", bonuses: { "Construction Salvage": 0, "Construction Pieces": 0, "Construction Rubble": 0 } },
  { name: "MIC-L1",                  system: "Stanton", bonuses: { "Construction Salvage": 0, "Construction Pieces": 0, "Construction Rubble": 0 } },
  { name: "MIC-L2",                  system: "Stanton", bonuses: { "Construction Salvage": 0, "Construction Pieces": 0, "Construction Rubble": 0 } },
  { name: "MIC-L5",                  system: "Stanton", bonuses: { "Construction Salvage": 0, "Construction Pieces": 0, "Construction Rubble": 0 } },
  { name: "Nyx Gateway (Stanton)",   system: "Stanton", bonuses: { "Construction Salvage": 0, "Construction Pieces": 0, "Construction Rubble": 0 } },
  { name: "Pyro Gateway (Stanton)",  system: "Stanton", bonuses: { "Construction Salvage": 0, "Construction Pieces": 0, "Construction Rubble": 0 } },
  { name: "Stanton Gateway (Pyro)",  system: "Pyro",    bonuses: { "Construction Salvage": 0, "Construction Pieces": 0, "Construction Rubble": 0 } },
  { name: "Terra Gateway (Stanton)", system: "Stanton", bonuses: { "Construction Salvage": 0, "Construction Pieces": 0, "Construction Rubble": 0 } },
];


// -----------------------------------------------------------------------------
// Refinery materials
// -----------------------------------------------------------------------------
// `maxBaseRate` is the highest yield rate (as a decimal, e.g. 0.15 = 15%) that
// the material can produce — achieved when paired with a high-yield refinery
// method. Lower-yield methods scale this rate down via `methodYieldMultiplier`.
export const refineryMaterials = [
  { name: "Construction Salvage", maxBaseRate: 0.15 },
  { name: "Construction Pieces",  maxBaseRate: 0.20 },
  { name: "Construction Rubble",  maxBaseRate: 0.30 },
];


// -----------------------------------------------------------------------------
// Refinery methods
// -----------------------------------------------------------------------------
// Data baseline collected from a 240 SCU Construction Salvage input.
//   yieldPer240   : SCU output for 240 SCU input on Construction Salvage.
//                   Used as a yield tier — divided by MAX_YIELD_PER_240 to get
//                   a 0..1 multiplier that's applied to each material's
//                   maxBaseRate. Update this if game balance changes.
//   timeSeconds   : refining duration for 240 SCU input. Scales linearly with
//                   actual SCU input.
//   costPer240    : aUEC cost for 240 SCU input. Scales linearly with actual
//                   SCU input.
//   speed/cost/yieldRating : informational ratings shown in the dropdown.
//                   H=High, M=Moderate, L=Low, V=Very Low.
export const refineryMethods = [
  { name: "Cormack Method",         yieldPer240: 25.2, timeSeconds:    20 * 60,           costPer240:  3839, speed: "H", cost: "M", yieldRating: "L" },
  { name: "Dinyx Solventation",     yieldPer240: 36.0, timeSeconds:    16 * 3600,         costPer240:  1919, speed: "L", cost: "H", yieldRating: "H" },
  { name: "Thermonatic Deposition", yieldPer240: 30.6, timeSeconds:     4 * 3600,         costPer240:  1919, speed: "H", cost: "H", yieldRating: "M" },
  { name: "XCR Reaction",           yieldPer240: 25.2, timeSeconds:    10 * 60,           costPer240: 11519, speed: "H", cost: "H", yieldRating: "L" },
  { name: "Gaskin Process",         yieldPer240: 30.6, timeSeconds:    40 * 60,           costPer240: 11519, speed: "L", cost: "M", yieldRating: "H" },
  { name: "Kazen Winnowing",        yieldPer240: 25.2, timeSeconds:     1 * 3600,         costPer240:  1919, speed: "M", cost: "M", yieldRating: "M" },
  { name: "Pyrometric Chromalysis", yieldPer240: 36.0, timeSeconds: 2 * 3600 + 40 * 60,   costPer240: 11519, speed: "V", cost: "L", yieldRating: "H" },
  { name: "Ferron Exchange",        yieldPer240: 36.0, timeSeconds: 5 * 3600 + 20 * 60,   costPer240:  3839, speed: "L", cost: "L", yieldRating: "M" },
  { name: "Electrostarolysis",      yieldPer240: 30.6, timeSeconds: 1 * 3600 + 20 * 60,   costPer240:  3939, speed: "M", cost: "L", yieldRating: "L" },
];


// -----------------------------------------------------------------------------
// Derived constants
// -----------------------------------------------------------------------------
// Maximum SCU yield observed per 240 SCU input across all methods. Computed
// from the data above so adding a new high-yield method updates this
// automatically. Used as the denominator for per-method yield multipliers.
export const MAX_YIELD_PER_240 = refineryMethods.reduce(
  (max, m) => (m.yieldPer240 > max ? m.yieldPer240 : max),
  0
);

// SCU input baseline that costPer240 and timeSeconds are calibrated to.
export const METHOD_BASELINE_SCU = 240;


// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/**
 * Format a duration in seconds into a compact string ("16h 0m", "20m 0s", "1h 20m", "0s").
 */
export function formatRefineryDuration(totalSeconds) {
  if (!isFinite(totalSeconds) || totalSeconds <= 0) return "0s";
  const totalSecondsRounded = Math.round(totalSeconds);
  const hours = Math.floor(totalSecondsRounded / 3600);
  const minutes = Math.floor((totalSecondsRounded % 3600) / 60);
  const seconds = totalSecondsRounded % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/**
 * Convert a duration in seconds to whole minutes (rounded to nearest).
 * Used when storing/displaying refinery job times in the ledger.
 */
export function secondsToMinutes(totalSeconds) {
  if (!isFinite(totalSeconds) || totalSeconds <= 0) return 0;
  return Math.round(totalSeconds / 60);
}

/**
 * Compute just the cost (aUEC) and time (seconds) for a refining job, scaled
 * linearly from the method's per-240 SCU baseline. Doesn't depend on material
 * or location — useful when only the operational cost/duration is needed.
 */
export function computeMethodCostAndTime({ scu, methodName }) {
  const method = getRefineryMethod(methodName);
  const safeScu = Number.isFinite(scu) && scu > 0 ? scu : 0;
  const scaleFactor = safeScu / METHOD_BASELINE_SCU;
  return {
    method,
    cost: scaleFactor * method.costPer240,
    timeSeconds: scaleFactor * method.timeSeconds,
    timeMinutes: secondsToMinutes(scaleFactor * method.timeSeconds),
  };
}

/**
 * Look up a refinery location by name, falling back to the first entry.
 */
export function getRefineryLocation(name) {
  return (
    refineryLocations.find((loc) => loc.name === name) ?? refineryLocations[0]
  );
}

/**
 * Look up a refinery material by name, falling back to the first entry.
 */
export function getRefineryMaterial(name) {
  return (
    refineryMaterials.find((m) => m.name === name) ?? refineryMaterials[0]
  );
}

/**
 * Look up a refinery method by name, falling back to the first entry.
 */
export function getRefineryMethod(name) {
  return refineryMethods.find((m) => m.name === name) ?? refineryMethods[0];
}

/**
 * The maximum base yield rate for a material (decimal, e.g. 0.15 for 15%).
 * Returns 0 if the material is unknown.
 */
export function getMaterialMaxBaseRate(name) {
  const material = refineryMaterials.find((m) => m.name === name);
  return material ? material.maxBaseRate : 0;
}

/**
 * The location bonus rate for a (location, material) pair, as a decimal.
 * Returns 0 if no bonus applies.
 */
export function getLocationBonusRate(location, materialName) {
  if (!location || !location.bonuses) return 0;
  const percent = location.bonuses[materialName] ?? 0;
  return percent / 100;
}

/**
 * The yield multiplier for a method (0..1), relative to the highest-yielding method.
 */
export function getMethodYieldMultiplier(method) {
  if (!method || !MAX_YIELD_PER_240) return 0;
  return method.yieldPer240 / MAX_YIELD_PER_240;
}

/**
 * Compute the full yield/cost/time breakdown for a refining job.
 *
 * @param {object} args
 * @param {number} args.scu               - SCU of raw material being refined.
 * @param {string} args.materialName      - name of the material (must exist in refineryMaterials).
 * @param {string} args.methodName        - name of the refinery method (must exist in refineryMethods).
 * @param {string} args.locationName      - name of the refinery location (must exist in refineryLocations).
 * @returns {{
 *   baseYieldRate: number,        // decimal, includes method multiplier (no location bonus)
 *   locationBonusRate: number,    // decimal, location-specific bonus only
 *   baseYield: number,            // SCU
 *   refineryBonusYield: number,   // SCU
 *   totalYield: number,           // SCU
 *   cost: number,                 // aUEC
 *   timeSeconds: number,          // seconds
 *   method: object,               // resolved method record
 *   material: object,             // resolved material record
 *   location: object,             // resolved location record
 * }}
 */
export function computeRefineryJob({ scu, materialName, methodName, locationName }) {
  const material = getRefineryMaterial(materialName);
  const method = getRefineryMethod(methodName);
  const location = getRefineryLocation(locationName);

  const methodMultiplier = getMethodYieldMultiplier(method);
  const baseYieldRate = material.maxBaseRate * methodMultiplier;
  const locationBonusRate = getLocationBonusRate(location, material.name);

  const safeScu = Number.isFinite(scu) && scu > 0 ? scu : 0;
  const scaleFactor = safeScu / METHOD_BASELINE_SCU;

  const baseYield = safeScu * baseYieldRate;
  const refineryBonusYield = safeScu * locationBonusRate;
  const totalYield = baseYield + refineryBonusYield;

  return {
    baseYieldRate,
    locationBonusRate,
    baseYield,
    refineryBonusYield,
    totalYield,
    cost: scaleFactor * method.costPer240,
    timeSeconds: scaleFactor * method.timeSeconds,
    method,
    material,
    location,
  };
}
