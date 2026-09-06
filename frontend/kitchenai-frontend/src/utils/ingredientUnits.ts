import type { CatalogIngredient, ItemCatalog } from '../types';
import { DEFAULT_UNIT, UNIT_OPTIONS, normalizeUnit } from './units';

export function toItemCatalog(item: CatalogIngredient): ItemCatalog {
  return {
    ingredient_id: item.ingredient_id,
    name: item.name,
    default_unit: item.default_unit,
    units: item.units,
    food_group: item.food_group,
  };
}

function normKey(s: string): string {
  return s.trim().toLowerCase();
}

export function resolveCatalogItem(
  catalog: CatalogIngredient[],
  ingredientId?: string,
  name?: string,
): CatalogIngredient | undefined {
  if (ingredientId) {
    const byId = catalog.find((c) => c.ingredient_id === ingredientId);
    if (byId) return byId;
  }
  const n = normKey(name ?? '');
  if (!n) return undefined;

  const byName = catalog.find((c) => normKey(c.name) === n);
  if (byName) return byName;

  for (const item of catalog) {
    if (item.synonyms?.some((syn) => normKey(syn) === n)) {
      return item;
    }
  }

  return undefined;
}

/** Units allowed for this catalog row; falls back to all units when unknown. */
export function unitsForCatalogItem(item?: CatalogIngredient | null): string[] {
  if (!item) return [...UNIT_OPTIONS];
  const raw = item.units?.length ? item.units : [item.default_unit];
  const canonical = new Set<string>(UNIT_OPTIONS);
  const normalized = raw.map((u) => normalizeUnit(u)).filter((u) => canonical.has(u));
  const unique = [...new Set(normalized)];
  return unique.length ? unique : [...UNIT_OPTIONS];
}

export function defaultUnitForCatalogItem(item: CatalogIngredient): string {
  const allowed = unitsForCatalogItem(item);
  const preferred = normalizeUnit(item.default_unit);
  if (allowed.includes(preferred)) return preferred;
  return allowed[0] ?? DEFAULT_UNIT;
}

export function coerceUnit(unit: string, allowed: readonly string[]): string {
  const normalized = normalizeUnit(unit);
  if (allowed.includes(normalized)) return normalized;
  return allowed[0] ?? DEFAULT_UNIT;
}

/** Whether two names are the same catalog ingredient (mirrors backend SameIngredient). */
export function sameIngredient(
  catalog: CatalogIngredient[],
  a: string,
  b: string,
): boolean {
  const ra = resolveCatalogItem(catalog, undefined, a.trim());
  const rb = resolveCatalogItem(catalog, undefined, b.trim());
  if (ra && rb) return ra.ingredient_id === rb.ingredient_id;
  if (ra) return normKey(ra.name) === normKey(b);
  if (rb) return normKey(a) === normKey(rb.name);
  const na = normKey(a);
  return na !== '' && na === normKey(b);
}

const COMPACT_SEGMENT_MIN_WIDTH = 32;

/** Width for compact unit pill strip given number of visible units. */
export function compactUnitStripWidth(unitCount: number): number {
  const n = Math.max(1, unitCount);
  return n * COMPACT_SEGMENT_MIN_WIDTH + (n - 1) + 8;
}

/** Flex weights for qty/unit row — equal by default; unit grows when more pills are shown. */
export function qtyUnitFlexWeights(unitCount: number): { qty: number; unit: number } {
  const n = Math.max(1, unitCount);
  if (n <= 2) return { qty: 1, unit: 1 };
  return { qty: 1, unit: 1 + (n - 2) * 0.45 };
}

export const QTY_FIELD_MIN_WIDTH = 48;
