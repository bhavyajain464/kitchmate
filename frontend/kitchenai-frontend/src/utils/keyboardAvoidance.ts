import { Platform, type ScrollViewProps } from 'react-native';

export function keyboardAvoidingBehavior(): 'padding' | 'height' | undefined {
  if (Platform.OS === 'ios' || Platform.OS === 'android') return 'padding';
  return undefined;
}

/** Spread onto ScrollViews that contain text inputs. */
export const keyboardAwareScrollViewProps = {
  keyboardShouldPersistTaps: 'handled',
  keyboardDismissMode: 'on-drag',
  automaticallyAdjustKeyboardInsets: true,
} satisfies Pick<
  ScrollViewProps,
  'keyboardShouldPersistTaps' | 'keyboardDismissMode' | 'automaticallyAdjustKeyboardInsets'
>;
