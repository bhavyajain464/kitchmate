import { useEffect, useState } from 'react';
import { fetchIngredientsCatalog } from '../services/api';
import type { CatalogIngredient } from '../types';

/** Debounced ingredient lookup via GET /ingredients?q= (no full-catalog preload). */
export function useIngredientSearch(query: string, enabled: boolean) {
  const [debouncedQuery, setDebouncedQuery] = useState(query.trim());
  const [results, setResults] = useState<CatalogIngredient[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!enabled) {
      setResults([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void fetchIngredientsCatalog(debouncedQuery || undefined)
      .then((items) => {
        if (!cancelled) setResults(items ?? []);
      })
      .catch(() => {
        if (!cancelled) setResults([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, debouncedQuery]);

  return { results, loading, debouncedQuery };
}
