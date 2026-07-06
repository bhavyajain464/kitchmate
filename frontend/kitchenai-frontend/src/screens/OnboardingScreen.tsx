import React, { useEffect, useMemo, useState } from 'react';
import {
  StyleSheet,
  View,
  ScrollView,
  Pressable,
  Image,
  Switch,
} from 'react-native';
import {
  Text,
  TextInput,
  Icon,
} from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as api from '../services/api';
import { showAppError } from '../utils/alertMessage';
import { MAX_QTY } from '../utils/qty';
import { OnboardingPreferencesForm } from '../components/preferences/OnboardingPreferencesForm';
import { PREF } from '../components/preferences/preferenceStyles';
import {
  buildAutoStaples,
  buildOnboardingInventoryItems,
  buildRegionalStaples,
  getAutoStapleCategoryPills,
  getOnboardingStapleImage,
  type OnboardingStaple,
} from '../data/onboardingStaples';
import { BrandMark } from '../components/BrandMark';
import { BRAND_MOTTO_LINES } from '../constants/brand';
import { markPostOnboardingTourPending } from '../utils/productTourStorage';

const INTRO_STEPS = [
  {
    icon: 'silverware-fork-knife',
    title: 'How you eat',
    desc: 'Diet, spice level & the cuisines you cook at home.',
  },
  {
    icon: 'package-variant',
    title: 'Stock your kitchen',
    desc: 'We pre-add ~40 everyday staples — just confirm a few regional ones.',
    badge: 'Auto-filled for you',
  },
  {
    icon: 'pot-steam-outline',
    title: 'Meals that fit your kitchen',
    desc: 'Personalised ideas & expiry help from day one.',
  },
] as const;

const STEPS = ['Start', 'Preferences', 'Your Kitchen'];
const SETUP_ESTIMATE = '~2 min';

type KitchenSetupTab = 'fresh' | 'join';

function formatStapleQty(qty: number): string {
  return Number.isInteger(qty) ? String(qty) : qty.toFixed(1);
}

function stapleQtyStep(unit: string): number {
  switch (unit) {
    case 'kg':
    case 'L':
      return 0.5;
    case 'g':
    case 'ml':
      return 50;
    default:
      return 1;
  }
}

function stapleQtyMin(unit: string): number {
  return stapleQtyStep(unit);
}

function WelcomeProgress({ activeThrough }: { activeThrough: number }) {
  return (
    <View style={styles.welcomeProg}>
      {STEPS.map((_, i) => (
        <View key={i} style={[styles.welcomeProgSeg, i <= activeThrough && styles.welcomeProgSegOn]} />
      ))}
    </View>
  );
}

interface OnboardingScreenProps {
  onComplete: () => void;
}

export function OnboardingScreen({ onComplete }: OnboardingScreenProps) {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [joiningKitchen, setJoiningKitchen] = useState(false);
  const [onboardingInviteCode, setOnboardingInviteCode] = useState('');
  const [kitchenTab, setKitchenTab] = useState<KitchenSetupTab>('fresh');

  // Preferences
  const [householdSize, setHouseholdSize] = useState(2);
  const [dietaryTags, setDietaryTags] = useState<string[]>([]);
  const [favCuisines, setFavCuisines] = useState<string[]>([]);
  const [spiceLevel, setSpiceLevel] = useState('medium');
  const [cookingSkill, setCookingSkill] = useState('intermediate');
  const [allergies, setAllergies] = useState<string[]>([]);
  const [dislikes, setDislikes] = useState<string[]>([]);
  const [newAllergy, setNewAllergy] = useState('');
  const [newDislike, setNewDislike] = useState('');
  const [onboardingNote, setOnboardingNote] = useState('');

  // Staples — ~40 auto essentials + regional toggles (no perishables)
  const onboardingPrefs = useMemo(
    () => ({ householdSize, dietaryTags, favCuisines }),
    [householdSize, dietaryTags, favCuisines],
  );
  const autoStaples = useMemo(
    () => buildAutoStaples(onboardingPrefs),
    [onboardingPrefs],
  );
  const [regionalStaples, setRegionalStaples] = useState<OnboardingStaple[]>([]);

  useEffect(() => {
    if (step !== 2) return;
    setRegionalStaples(prev => {
      const prevSelected = Object.fromEntries(prev.map(s => [s.id, s.selected]));
      const prevQty = Object.fromEntries(prev.map(s => [s.id, s.qty]));
      return buildRegionalStaples(onboardingPrefs, prevSelected).map(s => ({
        ...s,
        qty: prevQty[s.id] ?? s.qty,
      }));
    });
  }, [step, onboardingPrefs]);

  const toggleRegionalStaple = (idx: number) =>
    setRegionalStaples(prev => prev.map((s, i) => i === idx ? { ...s, selected: !s.selected } : s));

  const adjustRegionalStapleQty = (idx: number, direction: 1 | -1) => {
    setRegionalStaples(prev =>
      prev.map((s, i) => {
        if (i !== idx) return s;
        const step = stapleQtyStep(s.unit);
        const min = stapleQtyMin(s.unit);
        const next = Math.min(
          MAX_QTY,
          Math.max(min, Math.round((s.qty + direction * step) * 100) / 100),
        );
        return { ...s, qty: next };
      }),
    );
  };

  const toggleCuisine = (c: string) =>
    setFavCuisines(prev => prev.includes(c) ? prev.filter(t => t !== c) : [...prev, c]);

  const buildOnboardingPayload = (items: { name: string; qty: number; unit: string }[]) => ({
    household_size: householdSize,
    dietary_tags: dietaryTags,
    fav_cuisines: favCuisines,
    spice_level: spiceLevel,
    cooking_skill: cookingSkill,
    allergies,
    dislikes,
    items,
  });

  const handleComplete = async () => {
    setSaving(true);
    try {
      const items = buildOnboardingInventoryItems(autoStaples, regionalStaples);
      await api.completeOnboarding(buildOnboardingPayload(items));
      const note = onboardingNote.trim();
      if (note) {
        try {
          await api.addMemory('general', note);
        } catch {
          // onboarding already saved — note is optional
        }
      }
      await markPostOnboardingTourPending();
      onComplete();
    } catch (e: any) {
      showAppError('Failed to complete setup. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleJoinSharedKitchen = async () => {
    const code = onboardingInviteCode.trim().toUpperCase();
    if (!code) {
      showAppError('Enter an invite code to join a kitchen.');
      return;
    }
    setJoiningKitchen(true);
    try {
      await api.joinKitchen(code);
      await api.completeOnboarding(buildOnboardingPayload([]));
      await markPostOnboardingTourPending();
      onComplete();
    } catch (e) {
      console.error('Onboarding join kitchen failed:', e);
      showAppError('Could not join kitchen. Invite code may be invalid, or your current kitchen cannot be switched yet.');
    } finally {
      setJoiningKitchen(false);
    }
  };

  const regionalSelectedCount = regionalStaples.filter(s => s.selected).length;
  const totalInventoryCount = autoStaples.length + regionalSelectedCount;
  const autoCategoryPills = useMemo(() => getAutoStapleCategoryPills(autoStaples), [autoStaples]);

  return (
    <View style={[styles.container, styles.containerWelcome]}>
      {step === 0 && (
        <View
          style={[
            styles.welcomePage,
            { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 16 },
          ]}
        >
          <View style={styles.welcomeCardFlex}>
            <View style={styles.cardHeader}>
              <BrandMark compact style={styles.welcomeBrand} />
              <WelcomeProgress activeThrough={0} />
              <Text style={styles.welcomeEyebrow}>Welcome · Takes {SETUP_ESTIMATE}</Text>
              <View style={styles.welcomeMottoBlock} accessibilityRole="header">
                {BRAND_MOTTO_LINES.map((line) => (
                  <Text key={line} style={styles.welcomeMottoLine}>
                    {line}
                  </Text>
                ))}
              </View>
            </View>

            <ScrollView
              style={styles.cardBodyScroll}
              contentContainerStyle={styles.cardBodyContent}
              showsVerticalScrollIndicator={false}
            >
              <Text style={styles.introLead}>
                Here&apos;s what we&apos;ll set up together — you can change any of it later.
              </Text>
              <View style={styles.welcomeFeatureList}>
                {INTRO_STEPS.map((item) => (
                  <View key={item.title} style={styles.welcomeFeatureCard}>
                    <View style={styles.welcomeFeatureRow}>
                      <View style={styles.welcomeFeatureIconWrap}>
                        <Icon source={item.icon} size={20} color={PREF.green} />
                      </View>
                      <View style={styles.welcomeFeatureCopy}>
                        <Text style={styles.welcomeFeatureTitle}>{item.title}</Text>
                        <Text style={styles.welcomeFeatureDesc}>{item.desc}</Text>
                        {'badge' in item && item.badge ? (
                          <View style={styles.welcomeBadge}>
                            <Icon source="lightning-bolt-outline" size={12} color={PREF.green} />
                            <Text style={styles.welcomeBadgeText}>{item.badge}</Text>
                          </View>
                        ) : null}
                      </View>
                    </View>
                  </View>
                ))}
              </View>
            </ScrollView>

            <View style={styles.cardFooter}>
              <View style={styles.trustRow}>
                <Icon source="lock-outline" size={14} color="#9CA3AF" />
                <Text style={styles.trustText}>Free to start · No spam, ever</Text>
              </View>
              <Pressable
                onPress={() => setStep(1)}
                style={styles.welcomeCta}
                accessibilityRole="button"
              >
                <Text style={styles.welcomeCtaText}>Set up my kitchen →</Text>
              </Pressable>
            </View>
          </View>
        </View>
      )}

      {step === 1 && (
        <View
          style={[
            styles.welcomePage,
            { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 16 },
          ]}
        >
          <View style={styles.welcomeCardFlex}>
            <View style={styles.cardHeader}>
              <BrandMark compact style={styles.welcomeBrand} />
              <WelcomeProgress activeThrough={1} />
              <Text style={styles.prefsEyebrow}>Step 2 of 3 · How you eat</Text>
              <Text style={styles.kitchenTitle}>How do you like to eat?</Text>
              <Text style={styles.prefsSub}>
                We&apos;ll tailor every meal idea to this. Change it anytime.
              </Text>
            </View>

            <ScrollView
              style={styles.cardBodyScroll}
              contentContainerStyle={styles.cardBodyContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              <OnboardingPreferencesForm
                householdSize={householdSize}
                onHouseholdSize={setHouseholdSize}
                spiceLevel={spiceLevel}
                onSpiceLevel={setSpiceLevel}
                cookingSkill={cookingSkill}
                onCookingSkill={setCookingSkill}
                dietaryTags={dietaryTags}
                onDietaryTags={setDietaryTags}
                favCuisines={favCuisines}
                onToggleCuisine={toggleCuisine}
                allergies={allergies}
                onAllergies={setAllergies}
                dislikes={dislikes}
                onDislikes={setDislikes}
                newAllergy={newAllergy}
                onNewAllergy={setNewAllergy}
                newDislike={newDislike}
                onNewDislike={setNewDislike}
                note={onboardingNote}
                onNote={setOnboardingNote}
              />
            </ScrollView>

            <View style={styles.cardFooter}>
              <View style={styles.kitchenFooter}>
                <Pressable
                  onPress={() => setStep(2)}
                  style={styles.obSkipBtn}
                  accessibilityRole="button"
                >
                  <Text style={styles.obSkipText}>Skip</Text>
                </Pressable>
                <Pressable
                  onPress={() => setStep(2)}
                  style={styles.obNextBtn}
                  accessibilityRole="button"
                >
                  <Text style={styles.obNextText}>Continue →</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </View>
      )}

      {step === 2 && (
        <View
          style={[
            styles.welcomePage,
            { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 16 },
          ]}
        >
          <View style={styles.welcomeCardFlex}>
            <View style={styles.cardHeader}>
              <BrandMark compact style={styles.welcomeBrand} />
              <WelcomeProgress activeThrough={2} />
              <Text style={styles.kitchenEyebrow}>Step 3 of 3 · Your kitchen</Text>
              <Text style={styles.kitchenTitle}>Set up your kitchen</Text>
              <Text style={styles.kitchenSub}>
                Start a new kitchen or join a family member.
              </Text>
              <View style={styles.kitchenTabs}>
                <Pressable
                  onPress={() => setKitchenTab('fresh')}
                  style={[styles.kitchenTab, kitchenTab === 'fresh' && styles.kitchenTabOn]}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: kitchenTab === 'fresh' }}
                >
                  <Icon
                    source="plus-circle-outline"
                    size={16}
                    color={kitchenTab === 'fresh' ? '#fff' : PREF.muted}
                  />
                  <Text style={[styles.kitchenTabText, kitchenTab === 'fresh' && styles.kitchenTabTextOn]}>
                    Start fresh
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setKitchenTab('join')}
                  style={[styles.kitchenTab, kitchenTab === 'join' && styles.kitchenTabOn]}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: kitchenTab === 'join' }}
                >
                  <Icon
                    source="account-group-outline"
                    size={16}
                    color={kitchenTab === 'join' ? '#fff' : PREF.muted}
                  />
                  <Text style={[styles.kitchenTabText, kitchenTab === 'join' && styles.kitchenTabTextOn]}>
                    Join a kitchen
                  </Text>
                </Pressable>
              </View>
            </View>

            <ScrollView
              style={styles.cardBodyScroll}
              contentContainerStyle={styles.cardBodyContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {kitchenTab === 'fresh' ? (
                <>
                  <View style={styles.staplesBanner}>
                    <View style={styles.staplesBannerHead}>
                      <View style={styles.staplesCheckCircle}>
                        <Icon source="check" size={14} color="#fff" />
                      </View>
                      <Text style={styles.staplesBannerTitle}>
                        {autoStaples.length} staples added — no input needed
                      </Text>
                    </View>
                    <View style={styles.staplesPillRow}>
                      {autoCategoryPills.map((pill) => (
                        <View key={pill} style={styles.staplesPill}>
                          <Text style={styles.staplesPillText}>{pill}</Text>
                        </View>
                      ))}
                    </View>
                  </View>

                  <Text style={styles.regionalTitle}>Regional staples</Text>
                  <Text style={styles.regionalSub}>
                    From your cuisines — switch off what you don&apos;t keep.
                  </Text>

                  <View style={styles.regionalList}>
                    {regionalStaples.map((item, idx) => {
                      const image = getOnboardingStapleImage(item.id);
                      return (
                        <View
                          key={item.id}
                          style={[
                            styles.regionalRow,
                            idx < regionalStaples.length - 1 && styles.regionalRowBorder,
                          ]}
                        >
                          {image ? (
                            <Image
                              source={image}
                              style={[styles.regionalThumb, !item.selected && styles.stapleThumbMuted]}
                              accessibilityIgnoresInvertColors
                            />
                          ) : (
                            <View style={[styles.regionalThumb, styles.stapleThumbPlaceholder]} />
                          )}
                          <View style={styles.regionalInfo}>
                            <Text style={[styles.regionalName, !item.selected && styles.regionalNameOff]}>
                              {item.name}
                            </Text>
                            <View
                              style={[
                                styles.stapleQtyControls,
                                !item.selected && styles.stapleQtyControlsOff,
                              ]}
                              pointerEvents={item.selected ? 'auto' : 'none'}
                            >
                              <Pressable
                                onPress={() => adjustRegionalStapleQty(idx, -1)}
                                style={styles.qtySquareBtn}
                                accessibilityLabel={`Decrease ${item.name}`}
                                disabled={!item.selected}
                              >
                                <Text style={styles.qtySquareBtnText}>−</Text>
                              </Pressable>
                              <Text style={styles.qtyValueText}>
                                {formatStapleQty(item.qty)} {item.unit}
                              </Text>
                              <Pressable
                                onPress={() => adjustRegionalStapleQty(idx, 1)}
                                style={styles.qtySquareBtn}
                                accessibilityLabel={`Increase ${item.name}`}
                                disabled={!item.selected}
                              >
                                <Text style={styles.qtySquareBtnText}>+</Text>
                              </Pressable>
                            </View>
                          </View>
                          <Switch
                            value={item.selected}
                            onValueChange={() => toggleRegionalStaple(idx)}
                            trackColor={{ false: '#D1D5DB', true: '#A5D6A7' }}
                            thumbColor={item.selected ? PREF.green : '#f4f4f4'}
                            ios_backgroundColor="#D1D5DB"
                          />
                        </View>
                      );
                    })}
                  </View>
                </>
              ) : (
                <>
                  <Text style={styles.joinTitle}>Enter invite code</Text>
                  <Text style={styles.joinDesc}>
                    Share one kitchen&apos;s inventory, shopping list &amp; meals with your family.
                  </Text>
                  <Text style={styles.joinFieldLabel}>6-character code</Text>
                  <TextInput
                    mode="outlined"
                    placeholder="e.g. KM4F9X"
                    value={onboardingInviteCode}
                    onChangeText={(t) => setOnboardingInviteCode(t.toUpperCase())}
                    autoCapitalize="characters"
                    maxLength={12}
                    style={styles.joinCodeInput}
                    outlineStyle={styles.joinCodeOutline}
                    outlineColor="#E5E7EB"
                    activeOutlineColor={PREF.green}
                    contentStyle={styles.joinCodeContent}
                  />
                  <Text style={styles.joinHint}>
                    Ask whoever set up the kitchen — it&apos;s in their{' '}
                    <Text style={styles.joinHintBold}>Profile → Kitchen</Text>.
                  </Text>
                  <View style={styles.joinInfoBox}>
                    <Icon source="information-outline" size={16} color="#B45309" />
                    <Text style={styles.joinInfoText}>
                      Joining uses the existing kitchen&apos;s stock, so we won&apos;t add staples for you.
                    </Text>
                  </View>
                </>
              )}
            </ScrollView>

            <View style={styles.cardFooter}>
              <View style={styles.kitchenFooter}>
                <Pressable
                  onPress={() => setStep(1)}
                  style={styles.kitchenBackBtn}
                  accessibilityRole="button"
                >
                  <Text style={styles.kitchenBackText}>Back</Text>
                </Pressable>
                {kitchenTab === 'fresh' ? (
                  <Pressable
                    onPress={() => void handleComplete()}
                    style={styles.kitchenFinishBtn}
                    disabled={saving}
                    accessibilityRole="button"
                  >
                    <Text style={styles.kitchenFinishText}>
                      {saving ? 'Setting up...' : `Finish · stock ${totalInventoryCount} items`}
                    </Text>
                  </Pressable>
                ) : (
                  <Pressable
                    onPress={() => void handleJoinSharedKitchen()}
                    style={styles.kitchenFinishBtn}
                    disabled={joiningKitchen}
                    accessibilityRole="button"
                  >
                    <Text style={styles.kitchenFinishText}>
                      {joiningKitchen ? 'Joining...' : 'Join kitchen'}
                    </Text>
                  </Pressable>
                )}
              </View>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FAFAFA' },
  containerWelcome: { backgroundColor: '#ECEFF1' },
  progressWrap: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 },
  obProg: { flexDirection: 'row', gap: 6, marginBottom: 18 },
  obProgSeg: { height: 5, borderRadius: 3, backgroundColor: '#E2E7E3', flex: 1 },
  obProgSegOn: { backgroundColor: PREF.green },
  obStepLabel: {
    fontSize: 12.5,
    fontWeight: '700',
    color: PREF.green,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  obHd: { paddingHorizontal: 22, paddingTop: 8, paddingBottom: 4 },
  obTitle: { fontSize: 25, fontWeight: '800', color: PREF.ink, lineHeight: 30, marginBottom: 6 },
  obSub: { fontSize: 14, color: PREF.muted, lineHeight: 20 },
  obSkipBtn: { paddingVertical: 14, paddingHorizontal: 8 },
  obSkipText: { fontWeight: '700', color: PREF.muted, fontSize: 14 },
  obNextBtn: {
    flex: 1,
    backgroundColor: PREF.green,
    borderRadius: 999,
    paddingVertical: 15,
    alignItems: 'center',
    shadowColor: PREF.greenDark,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 18,
    elevation: 3,
  },
  obNextText: { color: '#fff', fontWeight: '800', fontSize: 16 },

  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 24 },
  welcomePage: { flex: 1, paddingHorizontal: 16 },
  welcomeCardFlex: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 28,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.06,
    shadowRadius: 28,
    elevation: 4,
    overflow: 'hidden',
  },
  cardHeader: {
    paddingHorizontal: 22,
    paddingTop: 22,
  },
  cardBodyScroll: { flex: 1 },
  cardBodyContent: {
    paddingHorizontal: 22,
    paddingTop: 0,
    paddingBottom: 12,
  },
  cardFooter: {
    paddingHorizontal: 22,
    paddingBottom: 22,
    paddingTop: 4,
  },
  stepWrap: { paddingHorizontal: 20 },

  welcomeCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 28,
    paddingHorizontal: 22,
    paddingTop: 22,
    paddingBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.06,
    shadowRadius: 28,
    elevation: 4,
  },
  welcomeBrand: { marginBottom: 18 },
  welcomeProg: { flexDirection: 'row', gap: 4, marginBottom: 12 },
  welcomeProgSeg: { height: 3, flex: 1, borderRadius: 2, backgroundColor: '#E5E7EB' },
  welcomeProgSegOn: { backgroundColor: PREF.green },
  welcomeEyebrow: {
    fontSize: 11,
    fontWeight: '700',
    color: '#66BB6A',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    marginBottom: 18,
  },
  welcomeMottoBlock: { marginBottom: 2 },
  welcomeMottoLine: {
    fontSize: 32,
    fontWeight: '800',
    color: '#1B5E20',
    letterSpacing: -0.5,
    lineHeight: 38,
  },
  introLead: { color: '#6B7280', fontSize: 15, lineHeight: 22 },
  welcomeFeatureList: { marginTop: 16, gap: 12 },
  welcomeFeatureCard: {
    backgroundColor: '#F4F5F4',
    borderRadius: 16,
    padding: 16,
  },
  welcomeFeatureRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  welcomeFeatureIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#EEF2EE',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  welcomeFeatureCopy: { flex: 1 },
  welcomeFeatureTitle: { color: '#1A1A1A', fontSize: 15, fontWeight: '800' },
  welcomeFeatureDesc: { color: '#6B7280', fontSize: 14, marginTop: 4, lineHeight: 20 },
  welcomeBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 8,
    backgroundColor: '#E8F5E9',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  welcomeBadgeText: { color: '#2E7D32', fontSize: 12, fontWeight: '700' },
  trustRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 0,
  },
  trustText: { color: '#9CA3AF', fontSize: 13 },
  welcomeCta: {
    backgroundColor: PREF.green,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 14,
    shadowColor: PREF.greenDark,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.28,
    shadowRadius: 16,
    elevation: 3,
  },
  welcomeCtaText: { color: '#fff', fontWeight: '800', fontSize: 16 },

  kitchenEyebrow: {
    fontSize: 11,
    fontWeight: '700',
    color: PREF.green,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    marginBottom: 14,
  },
  prefsEyebrow: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9CA3AF',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    marginBottom: 14,
  },
  prefsSub: {
    fontSize: 14,
    color: PREF.muted,
    lineHeight: 20,
    marginBottom: 4,
  },
  kitchenTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: PREF.ink,
    lineHeight: 32,
    marginBottom: 6,
  },
  kitchenSub: {
    fontSize: 14,
    color: PREF.muted,
    lineHeight: 20,
    marginBottom: 14,
  },
  kitchenTabs: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  kitchenTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: '#F4F5F4',
  },
  kitchenTabOn: {
    backgroundColor: PREF.green,
  },
  kitchenTabText: {
    fontSize: 14,
    fontWeight: '700',
    color: PREF.ink,
  },
  kitchenTabTextOn: {
    color: '#fff',
  },
  staplesBanner: {
    backgroundColor: '#F4F5F4',
    borderRadius: 16,
    padding: 16,
    marginBottom: 22,
  },
  staplesBannerHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 6,
  },
  staplesCheckCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: PREF.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  staplesBannerTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '800',
    color: PREF.ink,
    lineHeight: 20,
  },
  staplesPillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  staplesPill: {
    backgroundColor: '#fff',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  staplesPillText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: '#6B7280',
  },
  regionalTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: PREF.ink,
    marginBottom: 4,
  },
  regionalSub: {
    fontSize: 14,
    color: PREF.muted,
    lineHeight: 20,
    marginBottom: 12,
  },
  regionalList: {
    backgroundColor: '#F4F5F4',
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 8,
  },
  regionalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 12,
  },
  regionalRowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  regionalThumb: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#fff',
  },
  regionalInfo: { flex: 1, minWidth: 0 },
  regionalName: {
    fontSize: 15,
    fontWeight: '700',
    color: PREF.ink,
  },
  regionalNameOff: { color: '#9CA3AF' },
  regionalQty: {
    fontSize: 13,
    color: '#9CA3AF',
    marginTop: 2,
  },

  // Quantity controls (regional staples)
  stapleQtyControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 8,
  },
  stapleQtyControlsOff: {
    opacity: 0.35,
  },
  qtySquareBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#E5E7EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtySquareBtnText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    lineHeight: 20,
  },
  qtyValueText: {
    minWidth: 64,
    textAlign: 'center',
    fontSize: 13.5,
    fontWeight: '700',
    color: '#111827',
  },
  joinTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: PREF.ink,
    marginBottom: 6,
  },
  joinDesc: {
    fontSize: 14,
    color: PREF.muted,
    lineHeight: 20,
    marginBottom: 18,
  },
  joinFieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9CA3AF',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  joinCodeInput: {
    backgroundColor: '#fff',
    marginBottom: 10,
  },
  joinCodeOutline: { borderRadius: 14 },
  joinCodeContent: {
    fontSize: 18,
    fontWeight: '600',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  joinHint: {
    fontSize: 13,
    color: PREF.muted,
    lineHeight: 19,
    marginBottom: 14,
  },
  joinHintBold: { fontWeight: '800', color: '#4B5563' },
  joinInfoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#FFF8E7',
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
  },
  joinInfoText: {
    flex: 1,
    fontSize: 13,
    color: '#92400E',
    lineHeight: 19,
  },
  kitchenFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 0,
    paddingTop: 0,
  },
  kitchenBackBtn: { paddingVertical: 14, paddingHorizontal: 4 },
  kitchenBackText: { fontWeight: '700', color: PREF.muted, fontSize: 15 },
  kitchenFinishBtn: {
    flex: 1,
    maxWidth: 260,
    backgroundColor: PREF.green,
    borderRadius: 14,
    paddingVertical: 15,
    paddingHorizontal: 16,
    alignItems: 'center',
    shadowColor: PREF.greenDark,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.28,
    shadowRadius: 16,
    elevation: 3,
  },
  kitchenFinishText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 15,
    textAlign: 'center',
  },

  // Steps
  stepTitle: { fontWeight: '800', color: '#333', marginTop: 12 },
  stepSub: { color: '#888', marginTop: 4, marginBottom: 16 },
  staplesSelectSub: { color: '#444', marginBottom: 8, fontWeight: '700' },

  section: { backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 12 },
  secLabel: { fontWeight: '700', color: '#333', marginBottom: 12 },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { backgroundColor: '#F5F5F5' },
  chipActive: { backgroundColor: '#2E7D32' },
  grayChip: { backgroundColor: '#F5F5F5' },

  spicePill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#F5F5F5', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12 },
  spicePillActive: { backgroundColor: '#2E7D32' },
  spiceEmoji: { fontSize: 14 },
  spiceText: { fontSize: 13, color: '#666', fontWeight: '600' },

  counterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 20 },
  counterBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#F5F5F5', justifyContent: 'center', alignItems: 'center' },
  counterVal: { fontWeight: '800', minWidth: 40, textAlign: 'center', color: '#333' },

  addRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  addInput: { flex: 1, marginRight: 4, backgroundColor: '#fff' },

  // Staples
  catSection: { backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 12 },
  catHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  catLabel: { fontWeight: '700', color: '#333' },
  selectAllText: { color: '#2E7D32', fontWeight: '600', fontSize: 13 },
  selectAllTextMuted: { color: '#A5D6A7' },
  staplesBulkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    paddingHorizontal: 2,
  },
  staplesBulkCount: { color: '#666' },
  staplesBulkActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  staplesBulkSep: { color: '#CCC', fontSize: 13 },
  stapleRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, gap: 8 },
  stapleMain: { flex: 1, flexDirection: 'row', alignItems: 'center', minWidth: 0 },
  stapleThumb: {
    width: 44,
    height: 44,
    borderRadius: 10,
    marginLeft: 2,
    backgroundColor: '#F3F4F2',
  },
  stapleThumbMuted: { opacity: 0.45 },
  stapleThumbPlaceholder: { backgroundColor: '#E8E8E8' },
  stapleInfo: { flex: 1, marginLeft: 10 },
  stapleName: { fontWeight: '500', color: '#333' },
  stapleQty: { color: '#999', marginTop: 1 },

  // Bottom
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: '#fff',
    borderTopWidth: 0,
  },
  bottomBarPrefs: {
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: PREF.line,
    gap: 12,
  },
  backBtn: { borderRadius: 12 },
  nextBtn: { borderRadius: 12, backgroundColor: '#2E7D32', minWidth: 140 },
  sharedHint: { color: '#666', marginBottom: 8, lineHeight: 18 },
  joinKitchenBtn: { borderRadius: 12, marginTop: 8 },
  joinDividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 4,
    marginBottom: 16,
  },
  joinDividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#C5C5C5',
  },
  joinDividerLabel: {
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    fontWeight: '600',
  },
  joinSection: {
    backgroundColor: '#F8FAF8',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#D8E8D8',
  },
  autoStaplesBanner: {
    backgroundColor: '#E8F5E9',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#C8E6C9',
  },
  autoStaplesTitle: { fontWeight: '700', color: '#1B5E20', marginBottom: 6 },
  autoStaplesDesc: { color: '#2E7D32', lineHeight: 20 },
  regionalHint: { color: '#666', marginBottom: 10, lineHeight: 18 },
  perishableNote: { color: '#888', marginTop: 4, lineHeight: 18, fontStyle: 'italic' },
});
