import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useAuth } from './AuthContext';
import * as api from '../services/api';
import { Entitlements } from '../types';
import { userFacingError } from '../utils/userFacingError';

type EntitlementsContextValue = {
  entitlements: Entitlements | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  isPro: boolean;
  canBillScan: boolean;
  isMealCategoryFree: (categoryId: string) => boolean;
};

const EntitlementsContext = createContext<EntitlementsContextValue | null>(null);

export function useEntitlements() {
  const ctx = useContext(EntitlementsContext);
  if (!ctx) {
    throw new Error('useEntitlements must be used within EntitlementsProvider');
  }
  return ctx;
}

export function EntitlementsProvider({ children }: { children: React.ReactNode }) {
  const { token, loading: authLoading } = useAuth();
  const [entitlements, setEntitlements] = useState<Entitlements | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (authLoading) return;
    if (!token) {
      setEntitlements(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const ent = await api.getEntitlements();
      setEntitlements(ent);
    } catch (e) {
      console.warn('[entitlements] refresh failed:', e);
      setError(userFacingError(e, 'Could not load plan status.'));
    } finally {
      setLoading(false);
    }
  }, [token, authLoading]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const isPro = Boolean(entitlements?.is_pro);
  const canBillScan =
    isPro ||
    (entitlements?.bill_scans_remaining ?? 0) > 0 ||
    (entitlements?.bill_scan_limit ?? 2) < 0;

  const isMealCategoryFree = useCallback((_categoryId: string) => true, []);

  return (
    <EntitlementsContext.Provider
      value={{
        entitlements,
        loading,
        error,
        refresh,
        isPro,
        canBillScan,
        isMealCategoryFree,
      }}
    >
      {children}
    </EntitlementsContext.Provider>
  );
}
