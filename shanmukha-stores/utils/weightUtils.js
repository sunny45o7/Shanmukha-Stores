const DEFAULT_WEIGHT_OPTIONS = [
  "10gm",
  "20gm",
  "50gm",
  "100gm",
  "150gm",
  "200gm",
  "250gm",
  "500gm",
  "750gm",
  "1kg",
];

const LEGACY_DEFAULT_WEIGHT_OPTIONS = ["100g", "250g", "500g", "750g", "1kg"];

const toArray = (value) => {
  if (!value && value !== 0) return [];
  return Array.isArray(value) ? value : [value];
};

const normalizeWeightLabel = (value) => {
  const raw = String(value || "").trim().toLowerCase().replace(/\s+/g, "");
  if (!raw) return null;

  const match = raw.match(/^(\d+(?:\.\d+)?)(kg|g|gm)$/);
  if (!match) return null;

  const qty = Number(match[1]);
  const unit = match[2];
  if (!Number.isFinite(qty) || qty <= 0) return null;

  if (unit === "kg") {
    if (Number.isInteger(qty)) return `${qty}kg`;
    return `${qty}kg`;
  }

  const grams = qty;
  if (grams % 1000 === 0) {
    const kgValue = grams / 1000;
    if (Number.isInteger(kgValue)) return `${kgValue}kg`;
    return `${kgValue}kg`;
  }
  return `${grams}gm`;
};

const parseWeightToKg = (value) => {
  const normalized = normalizeWeightLabel(value);
  if (!normalized) return null;

  if (normalized.endsWith("kg")) {
    const qty = Number(normalized.slice(0, -2));
    return Number.isFinite(qty) && qty > 0 ? qty : null;
  }

  if (normalized.endsWith("gm")) {
    const qty = Number(normalized.slice(0, -2));
    return Number.isFinite(qty) && qty > 0 ? qty / 1000 : null;
  }

  return null;
};

const parseCustomWeights = (value) => {
  if (!value) return [];
  return String(value)
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
};

const sanitizeWeightList = (list, fallbackToDefaults = true) => {
  const normalizedUnique = new Map();

  for (const raw of toArray(list)) {
    const normalized = normalizeWeightLabel(raw);
    if (!normalized) continue;
    const kg = parseWeightToKg(normalized);
    if (!kg) continue;
    normalizedUnique.set(normalized, kg);
  }

  let entries = Array.from(normalizedUnique.entries());
  if (!entries.length && fallbackToDefaults) {
    entries = DEFAULT_WEIGHT_OPTIONS.map((w) => [w, parseWeightToKg(w)]);
  }

  return entries
    .filter(([, kg]) => Number.isFinite(kg) && kg > 0)
    .sort((a, b) => a[1] - b[1])
    .map(([label]) => label);
};

const getProductWeightOptions = (product) => {
  if (!product || product.price_type !== "kg") return [];

  const rawOptions = product.available_weights;
  const list = Array.isArray(rawOptions)
    ? rawOptions
    : typeof rawOptions === "string"
      ? (() => {
          try {
            const parsed = JSON.parse(rawOptions);
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            return [];
          }
        })()
      : [];

  if (list.length) {
    return sanitizeWeightList(list, false);
  }

  return sanitizeWeightList(LEGACY_DEFAULT_WEIGHT_OPTIONS, false);
};

module.exports = {
  DEFAULT_WEIGHT_OPTIONS,
  LEGACY_DEFAULT_WEIGHT_OPTIONS,
  normalizeWeightLabel,
  parseWeightToKg,
  parseCustomWeights,
  sanitizeWeightList,
  getProductWeightOptions,
};
