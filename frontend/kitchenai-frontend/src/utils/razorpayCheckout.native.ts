import { InteractionManager } from 'react-native';
import { paymentCheckoutRef } from '../context/PaymentCheckoutContext';
import { CheckoutOrderResponse, VerifyCheckoutRequest } from '../types';
import { userFacingError } from './userFacingError';

type RazorpayNativeError = {
  code?: number | string;
  description?: string;
  reason?: string;
};

function isPaymentCancelled(error: RazorpayNativeError): boolean {
  const code = Number(error?.code);
  if (code === 0 || code === 2) return true;
  const text = `${error?.description ?? ''} ${error?.reason ?? ''}`.toLowerCase();
  return text.includes('cancel') || text.includes('back');
}

function mapNativeSuccess(data: {
  razorpay_order_id?: string;
  razorpay_payment_id?: string;
  razorpay_signature?: string;
}): VerifyCheckoutRequest {
  if (!data?.razorpay_payment_id || !data?.razorpay_signature) {
    throw new Error('Payment failed');
  }
  return {
    razorpay_order_id: data.razorpay_order_id ?? '',
    razorpay_payment_id: data.razorpay_payment_id,
    razorpay_signature: data.razorpay_signature,
  };
}

function buildNativeOptions(order: CheckoutOrderResponse): Record<string, unknown> {
  const options: Record<string, unknown> = {
    key: order.key_id,
    amount: String(order.amount),
    currency: order.currency,
    name: order.name,
    description: order.description,
    order_id: order.order_id,
    theme: { color: '#2E7D32' },
  };
  if (order.prefill_email) {
    options.prefill = { email: order.prefill_email };
  }
  return options;
}

async function tryNativeCheckout(order: CheckoutOrderResponse): Promise<VerifyCheckoutRequest> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const RazorpayCheckout = require('react-native-razorpay').default;
  if (!RazorpayCheckout?.open) {
    throw new Error('NATIVE_MODULE_MISSING');
  }

  await new Promise<void>((resolve) => {
    InteractionManager.runAfterInteractions(() => resolve());
  });

  const options = buildNativeOptions(order);
  const checkoutPromise = RazorpayCheckout.open(options) as Promise<{
    razorpay_order_id?: string;
    razorpay_payment_id?: string;
    razorpay_signature?: string;
  }>;

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('NATIVE_CHECKOUT_TIMEOUT')), 6000);
  });

  try {
    const data = await Promise.race([checkoutPromise, timeoutPromise]);
    return mapNativeSuccess(data);
  } catch (e: unknown) {
    const err = (e ?? {}) as RazorpayNativeError;
    if (isPaymentCancelled(err)) {
      throw new Error('Payment cancelled');
    }
    throw e;
  }
}

async function openWebCheckout(order: CheckoutOrderResponse): Promise<VerifyCheckoutRequest> {
  const web = paymentCheckoutRef.current?.openWebCheckout;
  if (!web) {
    throw new Error('Payment screen is not ready. Close and reopen the app, then try again.');
  }
  return web(order);
}

export async function openRazorpayCheckout(
  order: CheckoutOrderResponse,
): Promise<VerifyCheckoutRequest> {
  try {
    return await tryNativeCheckout(order);
  } catch (nativeErr) {
    console.warn('[razorpay] native checkout unavailable, using in-app web checkout', nativeErr);
    try {
      return await openWebCheckout(order);
    } catch (webErr) {
      const msg =
        webErr instanceof Error ? webErr.message : 'Could not open payment';
      if (msg === 'Payment cancelled') throw webErr;
      throw new Error(userFacingError(webErr, 'Could not open payment.'));
    }
  }
}
