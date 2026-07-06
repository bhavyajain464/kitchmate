import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  View,
  ScrollView,
  StyleSheet,
  Image,
  Pressable,
} from 'react-native';
import {
  Text,
  Button,
  TextInput,
  Chip,
  Divider,
  IconButton,
  ActivityIndicator,
  Surface,
  Snackbar,
} from 'react-native-paper';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { closeProfile } from '../navigation/rootNavigation';
import type { RootStackParamList } from '../navigation/types';
import { useUpgradePaywall } from '../context/UpgradePaywallContext';
import { useProductTour } from '../context/ProductTourContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppConfirmDialog } from '../components/AppConfirmDialog';
import { BottomSheet, bottomSheetPrimaryBtn } from '../components/BottomSheet';
import { useAuth } from '../context/AuthContext';
import { UserProfile, UserMemory, KitchenInfo } from '../types';
import * as api from '../services/api';
import { useEntitlements } from '../context/EntitlementsContext';
import { usePlanUpgrade } from '../hooks/usePlanUpgrade';
import { ProfileHeaderUpgrade } from '../components/profile/ProfileHeaderUpgrade';
import { ProfilePlanSettingsSection } from '../components/profile/ProfilePlanSettingsSection';
import { AppLanguageSection } from '../components/profile/AppLanguageSection';
import { AppUpdateSection } from '../components/profile/AppUpdateSection';
import { showAppError, showAppSuccess, showAppInfo } from '../utils/alertMessage';
import { snackbarLayoutStyles } from '../constants/snackbarLayout';
import { ProfilePreferencesEditor } from '../components/preferences/ProfilePreferencesEditor';
import { PREF } from '../components/preferences/preferenceStyles';
import {
  prefsSnapshot,
  type UserPreferencesFormValues,
} from '../constants/userPreferences';
import { copyToClipboard } from '../utils/copyToClipboard';

const MEMORY_DELETE_UNDO_MS = 5000;

type PendingMemoryDelete = {
  memory: UserMemory;
  index: number;
  timer: ReturnType<typeof setTimeout>;
};

type ProfileRouteParams = RootStackParamList['Profile'];

export function ProfileScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList, 'Profile'>>();
  const route = useRoute<RouteProp<RootStackParamList, 'Profile'>>();
  const { openUpgrade } = useUpgradePaywall();
  const { startTour } = useProductTour();
  const insets = useSafeAreaInsets();
  const { user, signOut } = useAuth();
  const {
    entitlements,
    loading: entitlementsLoading,
    error: entitlementsError,
    refresh: refreshEntitlements,
  } = useEntitlements();
  const {
    syncLastPayment,
    busy: upgradeBusy,
    busyPlanKey: upgradeBusyPlanKey,
    planLabel,
  } = usePlanUpgrade();

  const openProfileUpgrade = useCallback(() => {
    openUpgrade({ source: 'profile' });
  }, [openUpgrade]);

  const handleTakeTour = useCallback(() => {
    void startTour('app', { force: true });
  }, [startTour]);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('settings');

  const [householdSize, setHouseholdSize] = useState(2);
  const [allergies, setAllergies] = useState<string[]>([]);
  const [dislikes, setDislikes] = useState<string[]>([]);
  const [dietaryTags, setDietaryTags] = useState<string[]>([]);
  const [favCuisines, setFavCuisines] = useState<string[]>([]);
  const [spiceLevel, setSpiceLevel] = useState('medium');
  const [cookingSkill, setCookingSkill] = useState('intermediate');

  const [addingMemory, setAddingMemory] = useState(false);
  const [kitchen, setKitchen] = useState<KitchenInfo | null>(null);
  const [kitchenLoading, setKitchenLoading] = useState(false);
  const [creatingKitchen, setCreatingKitchen] = useState(false);
  const [joiningKitchen, setJoiningKitchen] = useState(false);
  const [leavingKitchen, setLeavingKitchen] = useState(false);
  const [joinKitchenSheetVisible, setJoinKitchenSheetVisible] = useState(false);
  const [joinKitchenSheetStep, setJoinKitchenSheetStep] = useState<'enter' | 'confirm'>('enter');
  const [kitchenName, setKitchenName] = useState('');
  const [inviteCodeInput, setInviteCodeInput] = useState('');

  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    destructive?: boolean;
    icon?: string;
    onConfirm: () => void | Promise<void>;
  } | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);

  const [snackVisible, setSnackVisible] = useState(false);
  const [snackMsg, setSnackMsg] = useState('');
  const snackUndoRef = useRef<(() => Promise<void>) | null>(null);
  const pendingMemoryDeletesRef = useRef<Map<string, PendingMemoryDelete>>(new Map());
  const savedPrefsRef = useRef('');

  const prefValues = useMemo<UserPreferencesFormValues>(
    () => ({
      householdSize,
      allergies,
      dislikes,
      dietaryTags,
      favCuisines,
      spiceLevel,
      cookingSkill,
    }),
    [householdSize, allergies, dislikes, dietaryTags, favCuisines, spiceLevel, cookingSkill],
  );

  const prefsDirty = useMemo(
    () => savedPrefsRef.current !== '' && prefsSnapshot(prefValues) !== savedPrefsRef.current,
    [prefValues],
  );

  const patchPrefValues = (patch: Partial<UserPreferencesFormValues>) => {
    if (patch.householdSize !== undefined) setHouseholdSize(patch.householdSize);
    if (patch.allergies !== undefined) setAllergies(patch.allergies);
    if (patch.dislikes !== undefined) setDislikes(patch.dislikes);
    if (patch.dietaryTags !== undefined) setDietaryTags(patch.dietaryTags);
    if (patch.favCuisines !== undefined) setFavCuisines(patch.favCuisines);
    if (patch.spiceLevel !== undefined) setSpiceLevel(patch.spiceLevel);
    if (patch.cookingSkill !== undefined) setCookingSkill(patch.cookingSkill);
  };

  useEffect(() => {
    return () => {
      pendingMemoryDeletesRef.current.forEach((p) => clearTimeout(p.timer));
      pendingMemoryDeletesRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!route.params?.upgradePlan) return;
    openUpgrade({ source: 'profile' });
    navigation.setParams({ upgradePlan: undefined });
  }, [route.params?.upgradePlan, navigation, openUpgrade]);

  const loadProfile = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.fetchProfile();
      setProfile(data);
      setHouseholdSize(data.household_size || 2);
      setAllergies(data.allergies || []);
      setDislikes(data.dislikes || []);
      setDietaryTags(data.dietary_tags || []);
      setFavCuisines(data.fav_cuisines || []);
      setSpiceLevel(data.spice_level || 'medium');
      setCookingSkill(data.cooking_skill || 'intermediate');
      savedPrefsRef.current = prefsSnapshot({
        householdSize: data.household_size || 2,
        allergies: data.allergies || [],
        dislikes: data.dislikes || [],
        dietaryTags: data.dietary_tags || [],
        favCuisines: data.fav_cuisines || [],
        spiceLevel: data.spice_level || 'medium',
        cookingSkill: data.cooking_skill || 'intermediate',
      });
    } catch (e) {
      console.error('Failed to load profile:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadKitchen = useCallback(async () => {
    setKitchenLoading(true);
    try {
      const data = await api.getKitchen();
      setKitchen(data);
      setKitchenName(data.name || '');
    } catch {
      setKitchen(null);
    } finally {
      setKitchenLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProfile();
    void loadKitchen();
  }, [loadProfile, loadKitchen]);

  useEffect(() => {
    void refreshEntitlements();
  }, [refreshEntitlements]);

  const handleSave = async () => {
    try {
      setSaving(true);
      await api.updateProfile({
        household_size: householdSize,
        allergies, dislikes,
        dietary_tags: dietaryTags,
        fav_cuisines: favCuisines,
        spice_level: spiceLevel,
        cooking_skill: cookingSkill,
      });
      savedPrefsRef.current = prefsSnapshot(prefValues);
      showAppSuccess('Profile saved. Meal suggestions will reflect your preferences.');
    } catch {
      showAppError('Failed to save profile');
    } finally {
      setSaving(false);
    }
  };

  const handleAddMemoryNote = async (content: string) => {
    try {
      setAddingMemory(true);
      const newMem = await api.addMemory('general', content.trim());
      setProfile(prev => prev ? { ...prev, memories: [newMem, ...prev.memories] } : prev);
    } catch {
      showAppError('Failed to add memory');
      throw new Error('add memory failed');
    } finally {
      setAddingMemory(false);
    }
  };

  const commitMemoryDelete = useCallback((memoryId: string) => {
    const pending = pendingMemoryDeletesRef.current.get(memoryId);
    if (!pending) return;
    pendingMemoryDeletesRef.current.delete(memoryId);
    void api.deleteMemory(memoryId).catch(() => {
      setProfile((prev) => {
        if (!prev || prev.memories.some((m) => m.id === memoryId)) return prev;
        const list = [...prev.memories];
        list.splice(Math.min(pending.index, list.length), 0, pending.memory);
        return { ...prev, memories: list };
      });
      showAppError('Failed to delete memory');
    });
  }, []);

  const showMemoryDeleteSnack = useCallback((memory: UserMemory, undo: () => void) => {
    const preview =
      memory.content.length > 48 ? `${memory.content.slice(0, 48).trim()}…` : memory.content;
    snackUndoRef.current = async () => {
      undo();
      return Promise.resolve();
    };
    setSnackMsg(`"${preview}" removed.`);
    setSnackVisible(true);
  }, []);

  const handleDeleteMemory = useCallback(
    (memory: UserMemory) => {
      const existing = pendingMemoryDeletesRef.current.get(memory.id);
      if (existing) {
        clearTimeout(existing.timer);
        pendingMemoryDeletesRef.current.delete(memory.id);
      }

      let removedIndex = 0;
      setProfile((prev) => {
        if (!prev) return prev;
        removedIndex = prev.memories.findIndex((m) => m.id === memory.id);
        if (removedIndex < 0) return prev;
        return { ...prev, memories: prev.memories.filter((m) => m.id !== memory.id) };
      });

      const timer = setTimeout(() => commitMemoryDelete(memory.id), MEMORY_DELETE_UNDO_MS);
      pendingMemoryDeletesRef.current.set(memory.id, { memory, index: removedIndex, timer });

      showMemoryDeleteSnack(memory, () => {
        const pending = pendingMemoryDeletesRef.current.get(memory.id);
        if (!pending) return;
        clearTimeout(pending.timer);
        pendingMemoryDeletesRef.current.delete(memory.id);
        setProfile((prev) => {
          if (!prev || prev.memories.some((m) => m.id === memory.id)) return prev;
          const list = [...prev.memories];
          list.splice(Math.min(pending.index, list.length), 0, pending.memory);
          return { ...prev, memories: list };
        });
      });
    },
    [commitMemoryDelete, showMemoryDeleteSnack],
  );

  const handleConfirmDialog = async () => {
    if (!confirmDialog) return;
    setConfirmLoading(true);
    try {
      await confirmDialog.onConfirm();
      setConfirmDialog(null);
    } catch {
      showAppError('Something went wrong. Try again.');
    } finally {
      setConfirmLoading(false);
    }
  };

  const handleSignOut = () => {
    setConfirmDialog({
      title: 'Sign out?',
      message: 'You can sign back in anytime with your Google account.',
      confirmLabel: 'Sign out',
      destructive: true,
      icon: 'logout',
      onConfirm: () => {
        signOut();
      },
    });
  };

  const handleCreateKitchen = async () => {
    try {
      setCreatingKitchen(true);
      const data = await api.createKitchen(kitchenName);
      setKitchen(data);
      setKitchenName(data.name || '');
      showAppSuccess('Kitchen created. Share your invite code with family members.');
    } catch (e) {
      console.error('Create kitchen failed:', e);
      showAppError('Could not create kitchen.');
    } finally {
      setCreatingKitchen(false);
    }
  };

  const closeJoinKitchenSheet = () => {
    setJoinKitchenSheetVisible(false);
    setJoinKitchenSheetStep('enter');
  };

  const openJoinKitchenSheet = () => {
    setJoinKitchenSheetStep('enter');
    setJoinKitchenSheetVisible(true);
  };

  const performJoinKitchen = async (code: string) => {
    setJoiningKitchen(true);
    try {
      const data = await api.joinKitchen(code);
      setKitchen(data);
      setKitchenName(data.name || '');
      setInviteCodeInput('');
      closeJoinKitchenSheet();
      showAppSuccess(`Joined ${data.name}. Shared inventory is now enabled.`);
    } catch (e) {
      console.error('Join kitchen failed:', e);
      showAppError('Could not join kitchen. Check the invite code and try again.');
    } finally {
      setJoiningKitchen(false);
    }
  };

  const handleJoinKitchenContinue = () => {
    const code = inviteCodeInput.trim().toUpperCase();
    if (!code) {
      showAppInfo('Enter an invite code to join a kitchen.');
      return;
    }
    if (kitchen?.invite_code === code) {
      showAppInfo('You are already in this kitchen.');
      return;
    }
    if (kitchen) {
      setJoinKitchenSheetStep('confirm');
      return;
    }
    void performJoinKitchen(code);
  };

  const handleJoinKitchenConfirm = () => {
    const code = inviteCodeInput.trim().toUpperCase();
    if (!code) return;
    void performJoinKitchen(code);
  };

  const joinKitchenSwitchMessage = kitchen && (kitchen.member_count ?? 1) <= 1
    ? 'Your current kitchen and all its inventory will be permanently removed. You will join the new kitchen and share its inventory.'
    : 'You will leave your current kitchen. Other members keep the shared inventory there.';

  const handleCopyInviteCode = async () => {
    if (!kitchen?.invite_code) return;
    try {
      await copyToClipboard(kitchen.invite_code);
      showAppSuccess('Invite code copied');
    } catch {
      showAppError('Could not copy invite code');
    }
  };

  const handleLeaveAndCreateKitchen = async () => {
    setConfirmDialog({
      title: 'Leave current kitchen?',
      message: 'You will leave this shared kitchen and move to a new personal kitchen.',
      confirmLabel: 'Leave & Create',
      destructive: true,
      icon: 'home-plus',
      onConfirm: async () => {
        setLeavingKitchen(true);
        try {
          await api.leaveKitchen();
          await loadKitchen();
          setInviteCodeInput('');
          closeJoinKitchenSheet();
          showAppSuccess('Created a new personal kitchen.');
        } finally {
          setLeavingKitchen(false);
        }
      },
    });
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#2E7D32" />
      </View>
    );
  }

  return (
    <>
    <View style={styles.screenRoot}>
    <ScrollView
      style={styles.container}
      contentContainerStyle={[
        styles.scrollContent,
        {
          paddingBottom:
            insets.bottom + 24 + (activeTab === 'preferences' && prefsDirty ? 88 : 0),
        },
      ]}
      showsVerticalScrollIndicator={false}
    >
      {/* Profile Header */}
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <View style={styles.headerRow}>
          <IconButton
            icon="arrow-left"
            iconColor="#fff"
            size={22}
            onPress={closeProfile}
            style={styles.headerBack}
          />
          <View style={styles.headerLeft}>
            {user?.picture_url ? (
              <Image source={{ uri: user.picture_url }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarFallback]}>
                <Text style={styles.avatarText}>{user?.name?.[0] || '?'}</Text>
              </View>
            )}
            <View style={styles.headerText}>
              <Text variant="titleMedium" style={styles.userName} numberOfLines={1}>
                {user?.name}
              </Text>
              <Text variant="bodySmall" style={styles.userEmail} numberOfLines={1}>
                {user?.email}
              </Text>
            </View>
          </View>
          <ProfileHeaderUpgrade
            entitlements={entitlements}
            planLabel={planLabel()}
            onPress={openProfileUpgrade}
          />
        </View>
      </View>

      {/* Tabs */}
      <View style={styles.profileTabs}>
        {[
          { value: 'settings', label: t('profile.settings') },
          { value: 'preferences', label: t('profile.preferences') },
        ].map(tab => (
          <Pressable
            key={tab.value}
            onPress={() => setActiveTab(tab.value)}
            style={[styles.profileTabBtn, activeTab === tab.value && styles.profileTabBtnOn]}
          >
            <Text style={[styles.profileTabText, activeTab === tab.value && styles.profileTabTextOn]}>
              {tab.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* ── PREFERENCES ─────────────────────────────────── */}
      {activeTab === 'preferences' && (
        <View style={styles.tabContentPrefs}>
          <ProfilePreferencesEditor
            values={prefValues}
            onChange={patchPrefValues}
            memories={profile?.memories ?? []}
            onDeleteMemory={handleDeleteMemory}
            onAddMemory={handleAddMemoryNote}
            addingMemory={addingMemory}
          />
        </View>
      )}

      {/* ── SETTINGS ─────────────────────────────────────── */}
      {activeTab === 'settings' && (
        <View style={styles.tabContent}>
          <ProfilePlanSettingsSection
            entitlements={entitlements}
            planLabel={planLabel()}
            onOpenUpgrade={openProfileUpgrade}
            onSyncPayment={() => void syncLastPayment()}
            busy={upgradeBusy}
            busyPlanKey={upgradeBusyPlanKey}
            loading={entitlementsLoading}
            loadError={entitlementsError}
            onRetry={() => void refreshEntitlements()}
          />

          <AppLanguageSection />

          <Surface style={styles.section} elevation={1}>
            <Text variant="titleSmall" style={styles.secTitle}>{t('profile.help')}</Text>
            <Pressable
              onPress={handleTakeTour}
              style={({ pressed }) => [styles.tourRow, pressed && { opacity: 0.88 }]}
              accessibilityRole="button"
              accessibilityLabel="Take a tour of the home screen"
            >
              <View style={styles.tourRowLeft}>
                <IconButton icon="map-marker-path" size={20} iconColor="#2E7D32" style={styles.tourRowIcon} />
                <View style={styles.tourRowText}>
                  <Text variant="bodyMedium" style={styles.tourRowTitle}>{t('profile.takeTour')}</Text>
                  <Text variant="bodySmall" style={styles.tourRowSub}>
                    {t('profile.takeTourSub')}
                  </Text>
                </View>
              </View>
              <IconButton icon="chevron-right" size={20} iconColor="#888" style={styles.tourRowChevron} />
            </Pressable>
          </Surface>

          <Surface style={styles.section} elevation={1}>
            <Text variant="titleSmall" style={styles.secTitle}>Shared Kitchen</Text>
            {kitchenLoading ? (
              <ActivityIndicator size="small" />
            ) : kitchen ? (
              <>
                <View style={styles.settRow}>
                  <Text variant="bodyMedium" style={styles.settLabel}>Kitchen name</Text>
                  <Text variant="bodyMedium" style={styles.settVal}>{kitchen.name}</Text>
                </View>
                <Divider style={styles.settDivider} />
                <View style={styles.settRow}>
                  <Text variant="bodyMedium" style={styles.settLabel}>Invite code</Text>
                  <Chip
                    compact
                    icon="content-copy"
                    style={styles.inviteChip}
                    onPress={() => void handleCopyInviteCode()}
                    accessibilityLabel="Copy invite code"
                  >
                    {kitchen.invite_code}
                  </Chip>
                </View>
                <View style={styles.kitchenActionRow}>
                  <Button
                    mode="outlined"
                    onPress={openJoinKitchenSheet}
                    style={[
                      styles.kitchenBtn,
                      (kitchen.member_count ?? 1) > 1 ? styles.kitchenActionBtn : styles.kitchenActionBtnFull,
                    ]}
                    disabled={leavingKitchen || joiningKitchen}
                  >
                    Join another kitchen
                  </Button>
                  {(kitchen.member_count ?? 1) > 1 ? (
                    <Button
                      mode="outlined"
                      onPress={() => void handleLeaveAndCreateKitchen()}
                      loading={leavingKitchen}
                      disabled={leavingKitchen || joiningKitchen}
                      style={[styles.kitchenBtn, styles.kitchenActionBtn]}
                    >
                      Leave + create new
                    </Button>
                  ) : null}
                </View>
              </>
            ) : (
              <>
                <Text variant="bodySmall" style={styles.reminderHint}>
                  Create a kitchen or join one using an invite code. All members can add, edit, and delete inventory items.
                </Text>
                <TextInput
                  mode="outlined"
                  label="Kitchen name"
                  value={kitchenName}
                  onChangeText={setKitchenName}
                  style={styles.kitchenInput}
                  outlineColor="#E0E0E0"
                  activeOutlineColor="#2E7D32"
                />
                <Button
                  mode="contained"
                  onPress={() => void handleCreateKitchen()}
                  loading={creatingKitchen}
                  disabled={creatingKitchen}
                  style={styles.kitchenBtn}
                >
                  Create Kitchen
                </Button>
                <Divider style={{ marginVertical: 10 }} />
                <TextInput
                  mode="outlined"
                  label="Invite code"
                  value={inviteCodeInput}
                  onChangeText={setInviteCodeInput}
                  autoCapitalize="characters"
                  style={styles.kitchenInput}
                  outlineColor="#E0E0E0"
                  activeOutlineColor="#2E7D32"
                />
                <Button
                  mode="outlined"
                  onPress={() => void handleJoinKitchenContinue()}
                  loading={joiningKitchen}
                  disabled={joiningKitchen}
                  style={styles.kitchenBtn}
                >
                  Join with Code
                </Button>
              </>
            )}
          </Surface>

          <Surface style={styles.section} elevation={1}>
            <Text variant="titleSmall" style={styles.secTitle}>Account</Text>
            <View style={styles.settRow}>
              <Text variant="bodyMedium" style={styles.settLabel}>Name</Text>
              <Text variant="bodyMedium" style={styles.settVal}>{user?.name}</Text>
            </View>
            <Divider style={styles.settDivider} />
            <View style={styles.settRow}>
              <Text variant="bodyMedium" style={styles.settLabel}>Email</Text>
              <Text variant="bodyMedium" style={styles.settVal}>{user?.email}</Text>
            </View>
            <Divider style={styles.settDivider} />
            <View style={styles.settRow}>
              <Text variant="bodyMedium" style={styles.settLabel}>Provider</Text>
              <Chip compact icon="google" style={{ backgroundColor: '#E3F2FD' }} textStyle={{ fontSize: 12 }}>Google</Chip>
            </View>
          </Surface>

          <AppUpdateSection />

          <Button mode="contained" onPress={handleSignOut} style={styles.signOutBtn} buttonColor="#F44336" contentStyle={{ paddingVertical: 4 }}>
            Sign Out
          </Button>
        </View>
      )}

      <View style={{ height: 40 }} />
    </ScrollView>

    {activeTab === 'preferences' && prefsDirty ? (
      <View style={[styles.saveBar, { paddingBottom: insets.bottom + 14 }]}>
        <View style={styles.saveBarHint}>
          <View style={styles.saveBarDot} />
          <Text style={styles.saveBarText}>Unsaved changes</Text>
        </View>
        <Pressable
          onPress={() => void handleSave()}
          disabled={saving}
          style={[styles.saveBarBtn, saving && { opacity: 0.7 }]}
        >
          <Text style={styles.saveBarBtnText}>{saving ? 'Saving…' : 'Save'}</Text>
        </Pressable>
      </View>
    ) : null}
    </View>

    <AppConfirmDialog
      visible={confirmDialog != null}
      title={confirmDialog?.title ?? ''}
      message={confirmDialog?.message ?? ''}
      confirmLabel={confirmDialog?.confirmLabel}
      destructive={confirmDialog?.destructive}
      icon={confirmDialog?.icon}
      loading={confirmLoading}
      onDismiss={() => !confirmLoading && setConfirmDialog(null)}
      onConfirm={() => void handleConfirmDialog()}
    />
    <BottomSheet
      visible={joinKitchenSheetVisible}
      onDismiss={closeJoinKitchenSheet}
      title={joinKitchenSheetStep === 'confirm' ? 'Switch kitchen?' : 'Join Another Kitchen'}
      subtitle={
        joinKitchenSheetStep === 'confirm'
          ? undefined
          : 'Enter invite code to switch to another kitchen.'
      }
      dismissDisabled={joiningKitchen}
    >
      {joinKitchenSheetStep === 'enter' ? (
        <>
          <TextInput
            mode="outlined"
            label="Invite code"
            value={inviteCodeInput}
            onChangeText={setInviteCodeInput}
            autoCapitalize="characters"
            style={styles.kitchenInput}
            outlineColor="#E0E0E0"
            activeOutlineColor="#2E7D32"
          />
          <Button
            mode="contained"
            onPress={handleJoinKitchenContinue}
            disabled={joiningKitchen}
            style={bottomSheetPrimaryBtn.button}
            contentStyle={bottomSheetPrimaryBtn.content}
            labelStyle={bottomSheetPrimaryBtn.label}
          >
            Continue
          </Button>
        </>
      ) : (
        <>
          <Text variant="bodyMedium" style={styles.joinKitchenConfirmText}>
            {joinKitchenSwitchMessage}
          </Text>
          <Text variant="bodySmall" style={styles.joinKitchenConfirmCode}>
            Joining with code: {inviteCodeInput.trim().toUpperCase()}
          </Text>
          <Button
            mode="contained"
            onPress={() => void handleJoinKitchenConfirm()}
            loading={joiningKitchen}
            disabled={joiningKitchen}
            buttonColor="#C62828"
            style={bottomSheetPrimaryBtn.button}
            contentStyle={bottomSheetPrimaryBtn.content}
            labelStyle={bottomSheetPrimaryBtn.label}
          >
            Switch kitchen
          </Button>
          <Button
            mode="outlined"
            onPress={() => setJoinKitchenSheetStep('enter')}
            disabled={joiningKitchen}
            style={styles.kitchenBtn}
          >
            Back
          </Button>
        </>
      )}
    </BottomSheet>

    <Snackbar
      visible={snackVisible}
      onDismiss={() => {
        setSnackVisible(false);
        snackUndoRef.current = null;
      }}
      duration={MEMORY_DELETE_UNDO_MS}
      wrapperStyle={[snackbarLayoutStyles.host, { marginBottom: insets.bottom + 16 }]}
      style={snackbarLayoutStyles.surface}
      contentStyle={snackbarLayoutStyles.paperContent}
      action={
        snackUndoRef.current
          ? {
              label: 'Undo',
              onPress: () => {
                const undo = snackUndoRef.current;
                snackUndoRef.current = null;
                setSnackVisible(false);
                if (undo) void undo().catch(() => showAppError('Could not undo.'));
              },
            }
          : { label: 'OK', onPress: () => setSnackVisible(false) }
      }
    >
      {snackMsg}
    </Snackbar>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FAFAFA' },
  scrollContent: { paddingBottom: 24 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  header: {
    backgroundColor: '#2E7D32',
    paddingHorizontal: 20,
    paddingBottom: 24,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
  },
  headerBack: {
    margin: 0,
    marginLeft: -8,
    marginRight: -4,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
    marginRight: 12,
    gap: 12,
  },
  headerText: { flex: 1, minWidth: 0 },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.3)',
    flexShrink: 0,
  },
  avatarFallback: { backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center' },
  avatarText: { fontSize: 26, color: '#fff', fontWeight: '700' },
  userName: { color: '#fff', fontWeight: '800' },
  userEmail: { color: 'rgba(255,255,255,0.85)', marginTop: 2 },

  profileTabs: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 4,
    borderRadius: 14,
    padding: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  profileTabBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  profileTabBtnOn: {
    backgroundColor: PREF.ring,
  },
  profileTabText: {
    fontWeight: '700',
    fontSize: 14,
    color: PREF.muted,
  },
  profileTabTextOn: {
    color: PREF.greenDark,
  },
  tabContent: { paddingHorizontal: 20, paddingTop: 8 },
  tabContentPrefs: { paddingTop: 8, paddingBottom: 8 },
  screenRoot: { flex: 1 },
  saveBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 14,
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: PREF.line,
  },
  saveBarHint: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 7 },
  saveBarDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: PREF.warn },
  saveBarText: { fontSize: 13, color: PREF.warn, fontWeight: '600' },
  saveBarBtn: {
    backgroundColor: PREF.green,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 30,
    shadowColor: PREF.greenDark,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 18,
    elevation: 3,
  },
  saveBarBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },

  section: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  secTitle: { fontWeight: '700', color: '#333', marginBottom: 12 },

  tourRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  tourRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
  },
  tourRowIcon: { margin: 0, marginRight: 4 },
  tourRowText: { flex: 1, minWidth: 0 },
  tourRowTitle: { fontWeight: '600', color: '#333' },
  tourRowSub: { color: '#888', marginTop: 2 },
  tourRowChevron: { margin: 0 },

  settRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12 },
  settLabel: { color: '#888' },
  settVal: { color: '#555', fontWeight: '500' },
  settDivider: { marginVertical: 2 },
  reminderHint: { color: '#666', marginBottom: 12, lineHeight: 18 },
  inviteChip: { backgroundColor: '#E8F5E9' },
  kitchenInput: { marginBottom: 10, backgroundColor: '#fff' },
  joinKitchenConfirmText: { color: '#424242', lineHeight: 22, marginBottom: 8 },
  joinKitchenConfirmCode: { color: '#757575', marginBottom: 16 },
  kitchenBtn: { borderRadius: 12, marginBottom: 4 },
  kitchenActionRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  kitchenActionBtn: { flex: 1 },
  kitchenActionBtnFull: { flex: 1, width: '100%' },
  signOutBtn: { borderRadius: 14, marginTop: 8 },
});
