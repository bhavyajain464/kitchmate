import { useCallback, useState } from 'react';
import * as api from '../services/api';
import { CheckoutOrderResponse } from '../types';
import { openRazorpayCheckout } from '../utils/razorpayCheckout';
import { useEntitlements } from '../context/EntitlementsContext';
import { showAppError, showAppInfo, showAppSuccess } from '../utils/alertMessage';
import { userFacingError } from '../utils/userFacingError';

async function completeCheckout(order: CheckoutOrderResponse): Promise<void> {
  const payment = await openRazorpayCheckout(order);
  await api.verifySubscribePayment(payment);
}

function checkoutErrorMessage(e: unknown): string {
  if (e instanceof Error && e.message === 'Payment cancelled') return 'Payment cancelled';
  return userFacingError(e, 'Could not complete checkout. Please try again.');
}

export function planCheckoutKey(tier: string, interval: string) {
  return `${tier}-${interval}`;
}

export function usePlanUpgrade() {
  const { entitlements, isPro, refresh } = useEntitlements();
  /** Which plan button is active, or "sync" during payment sync. */
  const [busyPlanKey, setBusyPlanKey] = useState<string | null>(null);

  const subscribe = useCallback(
    async (planTier: string, planInterval: string) => {
      setBusyPlanKey(planCheckoutKey(planTier, planInterval));
      try {
        const config = await api.getBillingConfig();
        if (!config.enabled) {
          showAppError('Checkout is not available yet. Please try again later.');
          return;
        }
        const order = await api.createSubscribeOrder(planTier, planInterval);
        try {
          await completeCheckout(order);
        } catch (e) {
          const msg = checkoutErrorMessage(e);
          if (msg === 'Payment cancelled') return;
          try {
            const synced = await api.syncSubscribeOrder(order.order_id);
            if (synced.is_pro) {
              await refresh();
              showAppSuccess('Your plan is active.');
              return;
            }
          } catch {
            /* ignore sync failure */
          }
          showAppError(msg);
          return;
        }
        await refresh();
        const creditNote =
          order.credit_paise && order.credit_paise > 0
            ? ` ${order.credit_summary}`
            : '';
        showAppSuccess(`Your plan is active — ${order.price_label}${creditNote}`);
      } catch (e) {
        const msg = checkoutErrorMessage(e);
        if (msg === 'Payment cancelled') return;
        showAppError(msg);
      } finally {
        setBusyPlanKey(null);
      }
    },
    [refresh],
  );

  const startUpgrade = useCallback(() => subscribe('pro', 'monthly'), [subscribe]);

  const syncLastPayment = useCallback(
    async () => {
      setBusyPlanKey('sync');
      try {
        const synced = await api.syncSubscribeOrder('');
        await refresh();
        if (synced.is_pro) {
          showAppSuccess('Your subscription is active.');
        } else {
          showAppInfo('No completed payment found yet.');
        }
      } catch {
        showAppError('Could not sync payment. Try again in a moment.');
      } finally {
        setBusyPlanKey(null);
      }
    },
    [refresh],
  );

  const planLabel = () => {
    if (!entitlements?.is_pro) return 'Free';
    const tier = entitlements.is_elite ? 'Elite' : 'Pro';
    const interval =
      entitlements.plan_interval === 'yearly' ? 'Yearly' : entitlements.plan_interval === 'monthly' ? 'Monthly' : '';
    return interval ? `${tier} · ${interval}` : tier;
  };

  return {
    subscribe,
    startUpgrade,
    syncLastPayment,
    busy: busyPlanKey != null,
    busyPlanKey,
    isPro,
    entitlements,
    planLabel,
  };
}
