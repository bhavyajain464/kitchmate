import React, { useState } from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Icon, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FilterPill, FilterPillRow } from '../components/FilterPill';
import { keyboardAwareScrollViewProps } from '../utils/keyboardAvoidance';
import { useAuth } from '../context/AuthContext';
import { AdminPushSection } from '../components/admin/AdminPushSection';
import { AdminAliasesSection } from '../components/admin/AdminAliasesSection';
import { AdminDishSection } from '../components/admin/AdminDishSection';
import { palette } from '../theme';

type AdminTab = 'push' | 'aliases' | 'dishes';

const TABS: { id: AdminTab; label: string; icon: string }[] = [
  { id: 'push', label: 'Push', icon: 'bell-outline' },
  { id: 'aliases', label: 'Aliases', icon: 'link-variant' },
  { id: 'dishes', label: 'Dishes', icon: 'food-variant' },
];

export function AdminPanelScreen() {
  const insets = useSafeAreaInsets();
  const { user, signOut } = useAuth();
  const [tab, setTab] = useState<AdminTab>('push');

  return (
    <View style={styles.root}>
      <View
        style={[
          styles.topBar,
          {
            paddingTop: insets.top + 12,
            paddingLeft: Math.max(insets.left, 16),
            paddingRight: Math.max(insets.right, 16),
          },
        ]}
      >
        <View style={styles.brandRow}>
          <View style={styles.brandIcon}>
            <Icon source="shield-account-outline" size={22} color={palette.primary} />
          </View>
          <View style={styles.brandText}>
            <Text style={styles.title}>Ops panel</Text>
            <Text style={styles.subtitle} numberOfLines={1}>
              {user?.email ?? 'Signed in'}
            </Text>
          </View>
          <Button mode="outlined" onPress={() => void signOut()} compact style={styles.signOut}>
            Sign out
          </Button>
        </View>

        <FilterPillRow style={styles.tabs}>
          {TABS.map((item) => (
            <FilterPill
              key={item.id}
              label={item.label}
              icon={item.icon}
              selected={tab === item.id}
              onPress={() => setTab(item.id)}
            />
          ))}
        </FilterPillRow>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          {
            paddingBottom: insets.bottom + 32,
            paddingLeft: Math.max(insets.left, 16),
            paddingRight: Math.max(insets.right, 16),
          },
        ]}
        {...keyboardAwareScrollViewProps}
      >
        {tab === 'push' ? <AdminPushSection /> : null}
        {tab === 'aliases' ? <AdminAliasesSection /> : null}
        {tab === 'dishes' ? <AdminDishSection /> : null}

        {Platform.OS === 'web' ? (
          <Text style={styles.footerNote}>
            Hidden admin route — bookmark this URL for quick access.
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: palette.background,
  },
  topBar: {
    backgroundColor: palette.surface,
    borderBottomWidth: 1,
    borderBottomColor: palette.borderLight,
    paddingBottom: 12,
    gap: 14,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    maxWidth: 800,
    width: '100%',
    alignSelf: 'center',
  },
  brandIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: palette.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandText: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: palette.text,
  },
  subtitle: {
    color: palette.textMuted,
    fontSize: 13,
    marginTop: 2,
  },
  signOut: {
    borderRadius: 10,
  },
  tabs: {
    marginHorizontal: 0,
    maxWidth: 800,
    width: '100%',
    alignSelf: 'center',
  },
  scroll: {
    flex: 1,
  },
  content: {
    maxWidth: 800,
    width: '100%',
    alignSelf: 'center',
    paddingTop: 20,
    gap: 16,
  },
  footerNote: {
    color: palette.textMuted,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 8,
  },
});
