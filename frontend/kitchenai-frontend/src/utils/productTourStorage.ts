import AsyncStorage from '@react-native-async-storage/async-storage';

const APP_TOUR_KEY = 'productTour_app_v2_completed';
const POST_ONBOARDING_TOUR_KEY = 'productTour_pending_after_onboarding';

export async function isAppTourCompleted(): Promise<boolean> {
  try {
    const value = await AsyncStorage.getItem(APP_TOUR_KEY);
    return value === 'true';
  } catch {
    return false;
  }
}

export async function markAppTourCompleted(): Promise<void> {
  try {
    await AsyncStorage.setItem(APP_TOUR_KEY, 'true');
  } catch {
    // Non-critical — tour may replay on next launch if storage fails.
  }
}

/** Set when onboarding finishes; consumed once when the main app shell mounts. */
export async function markPostOnboardingTourPending(): Promise<void> {
  try {
    await AsyncStorage.setItem(POST_ONBOARDING_TOUR_KEY, 'true');
  } catch {
    // Best-effort — Profile replay remains available.
  }
}

export async function consumePostOnboardingTourPending(): Promise<boolean> {
  try {
    const value = await AsyncStorage.getItem(POST_ONBOARDING_TOUR_KEY);
    if (value !== 'true') return false;
    await AsyncStorage.removeItem(POST_ONBOARDING_TOUR_KEY);
    return true;
  } catch {
    return false;
  }
}
