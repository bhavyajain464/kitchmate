import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  View,
  ScrollView,
  RefreshControl,
  Pressable,
  Dimensions,
} from 'react-native';
import {
  Text,
  Surface,
  Avatar,
  ActivityIndicator,
  Badge,
  IconButton,
} from 'react-native-paper';
import { useAuth } from '../context/AuthContext';
import * as api from '../services/api';
import { InventoryItem, ExpiringItem } from '../types';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good Morning';
  if (h < 17) return 'Good Afternoon';
  return 'Good Evening';
}

function getDaysLeft(expiry: string | undefined): number | null {
  if (!expiry) return null;
  const e = new Date(expiry);
  const t = new Date();
  e.setHours(0, 0, 0, 0);
  t.setHours(0, 0, 0, 0);
  return Math.round((e.getTime() - t.getTime()) / 86400000);
}

export function HomeScreen({ navigation }: any) {
  const { user } = useAuth();
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [expiringItems, setExpiringItems] = useState<ExpiringItem[]>([]);
  const [expiredItems, setExpiredItems] = useState<ExpiringItem[]>([]);
  const [shoppingCount, setShoppingCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const [inv, exp, expd, shop] = await Promise.all([
        api.fetchInventory().catch(() => []),
        api.fetchExpiringItems().catch(() => []),
        api.fetchExpiredItems().catch(() => []),
        api.getShoppingItems().catch(() => []),
      ]);
      setInventory(inv || []);
      setExpiringItems(exp || []);
      setExpiredItems(expd || []);
      setShoppingCount(Array.isArray(shop) ? shop.filter((s: any) => !s.bought).length : 0);
    } catch {
      setInventory([]);
      setExpiringItems([]);
      setExpiredItems([]);
      setShoppingCount(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  const firstName = user?.name?.split(' ')[0] || 'there';

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      showsVerticalScrollIndicator={false}
    >
      {/* ── Hero Header ──────────────────────────────────── */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View style={styles.headerText}>
            <Text variant="bodyMedium" style={styles.greeting}>{getGreeting()},</Text>
            <Text variant="headlineMedium" style={styles.heroName}>{firstName}</Text>
          </View>
          <Pressable onPress={() => navigation.navigate('Profile')}>
            <Avatar.Text
              size={48}
              label={user?.name?.charAt(0).toUpperCase() || 'U'}
              style={styles.avatar}
              labelStyle={{ fontSize: 20, fontWeight: '700' }}
            />
          </Pressable>
        </View>

        {/* Summary pills */}
        <View style={styles.pillRow}>
          <Surface style={styles.pill} elevation={0}>
            <Text style={styles.pillValue}>{inventory.length}</Text>
            <Text style={styles.pillLabel}>items in stock</Text>
          </Surface>
          {expiringItems.length > 0 && (
            <Surface style={[styles.pill, styles.pillWarn]} elevation={0}>
              <Text style={[styles.pillValue, { color: '#E65100' }]}>{expiringItems.length}</Text>
              <Text style={[styles.pillLabel, { color: '#E65100' }]}>expiring soon</Text>
            </Surface>
          )}
          {expiredItems.length > 0 && (
            <Surface style={[styles.pill, styles.pillDanger]} elevation={0}>
              <Text style={[styles.pillValue, { color: '#C62828' }]}>{expiredItems.length}</Text>
              <Text style={[styles.pillLabel, { color: '#C62828' }]}>expired</Text>
            </Surface>
          )}
        </View>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} size="large" />
      ) : (
        <>
          {/* ── Quick Actions Grid ────────────────────────── */}
          <Text variant="titleMedium" style={styles.sectionTitle}>Quick Actions</Text>
          <View style={styles.grid}>
            <ActionCard
              icon="package-variant"
              label="Inventory"
              subtitle={`${inventory.length} items`}
              color="#4CAF50"
              bg="#E8F5E9"
              onPress={() => navigation.navigate('Inventory')}
            />
            <ActionCard
              icon="silverware-fork-knife"
              label="Meal Ideas"
              subtitle="AI powered"
              color="#FF9800"
              bg="#FFF3E0"
              onPress={() => navigation.navigate('Meals')}
            />
            <ActionCard
              icon="cart-outline"
              label="Shopping"
              subtitle={shoppingCount > 0 ? `${shoppingCount} items` : 'List empty'}
              color="#2196F3"
              bg="#E3F2FD"
              badge={shoppingCount > 0 ? shoppingCount : undefined}
              onPress={() => navigation.navigate('Shopping')}
            />
            <ActionCard
              icon="chef-hat"
              label="Cook"
              subtitle="Send instructions"
              color="#9C27B0"
              bg="#F3E5F5"
              onPress={() => navigation.navigate('Cook')}
            />
          </View>

          {/* ── Expiring Soon ─────────────────────────────── */}
          {expiringItems.length > 0 && (
            <>
              <View style={styles.sectionHeader}>
                <Text variant="titleMedium" style={styles.sectionTitle}>Expiring Soon</Text>
                <Pressable onPress={() => navigation.navigate('Inventory')}>
                  <Text style={styles.seeAll}>See all</Text>
                </Pressable>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.hScroll} contentContainerStyle={styles.hScrollContent}>
                {expiringItems.map((item) => (
                  <Surface key={item.item_id} style={styles.expiryCard} elevation={2}>
                    <View style={styles.expiryBadge}>
                      <Text style={styles.expiryBadgeText}>
                        {item.days_until_expiry <= 0 ? 'Today' : `${item.days_until_expiry}d`}
                      </Text>
                    </View>
                    <Text variant="titleSmall" style={styles.expiryName} numberOfLines={1}>{item.canonical_name}</Text>
                    <Text variant="bodySmall" style={styles.expiryQty}>{item.qty} {item.unit}</Text>
                  </Surface>
                ))}
              </ScrollView>
            </>
          )}

          {/* ── Expired Items Alert ───────────────────────── */}
          {expiredItems.length > 0 && (
            <Pressable onPress={() => navigation.navigate('Inventory')} style={styles.expiredBanner}>
              <View style={styles.expiredBannerIcon}>
                <IconButton icon="alert-circle" iconColor="#C62828" size={24} style={{ margin: 0 }} />
              </View>
              <View style={styles.expiredBannerText}>
                <Text variant="titleSmall" style={{ color: '#C62828', fontWeight: '700' }}>
                  {expiredItems.length} expired item{expiredItems.length !== 1 ? 's' : ''}
                </Text>
                <Text variant="bodySmall" style={{ color: '#D32F2F' }}>
                  Tap to review & reorder
                </Text>
              </View>
              <IconButton icon="chevron-right" iconColor="#C62828" size={20} style={{ margin: 0 }} />
            </Pressable>
          )}

          {/* ── Recent Inventory ──────────────────────────── */}
          <View style={styles.sectionHeader}>
            <Text variant="titleMedium" style={styles.sectionTitle}>Recent Items</Text>
            <Pressable onPress={() => navigation.navigate('Inventory')}>
              <Text style={styles.seeAll}>View all</Text>
            </Pressable>
          </View>

          {inventory.length === 0 ? (
            <Surface style={styles.emptyCard} elevation={1}>
              <IconButton icon="fridge-outline" size={36} iconColor="#bbb" style={{ margin: 0 }} />
              <Text variant="bodyMedium" style={styles.emptyText}>
                Your kitchen is empty!
              </Text>
              <Text variant="bodySmall" style={styles.emptySubtext}>
                Scan a grocery bill or add items manually
              </Text>
            </Surface>
          ) : (
            <View style={styles.recentList}>
              {inventory.slice(0, 6).map((item) => {
                const dl = getDaysLeft(item.estimated_expiry);
                const urgent = dl !== null && dl <= 2;
                return (
                  <Surface key={item.item_id} style={styles.recentItem} elevation={1}>
                    <View style={[styles.recentDot, { backgroundColor: urgent ? '#FF9800' : '#4CAF50' }]} />
                    <View style={styles.recentInfo}>
                      <Text variant="bodyMedium" style={styles.recentName}>{item.canonical_name}</Text>
                      <Text variant="bodySmall" style={styles.recentQty}>{item.qty} {item.unit}</Text>
                    </View>
                    {dl !== null && (
                      <View style={[styles.daysChip, urgent && styles.daysChipUrgent]}>
                        <Text style={[styles.daysChipText, urgent && styles.daysChipTextUrgent]}>
                          {dl === 0 ? 'Today' : dl === 1 ? '1d' : `${dl}d`}
                        </Text>
                      </View>
                    )}
                  </Surface>
                );
              })}
            </View>
          )}

          <View style={styles.bottomSpacer} />
        </>
      )}
    </ScrollView>
  );
}

/* ── Action Card Component ────────────────────────────────── */

function ActionCard({ icon, label, subtitle, color, bg, badge, onPress }: {
  icon: string;
  label: string;
  subtitle: string;
  color: string;
  bg: string;
  badge?: number;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.actionCard, pressed && { opacity: 0.85 }]}>
      <Surface style={[styles.actionSurface, { backgroundColor: bg }]} elevation={1}>
        <View style={styles.actionIconWrap}>
          <IconButton icon={icon} iconColor={color} size={28} style={{ margin: 0 }} />
          {badge !== undefined && (
            <Badge style={styles.actionBadge}>{badge}</Badge>
          )}
        </View>
        <Text variant="titleSmall" style={[styles.actionLabel, { color }]}>{label}</Text>
        <Text variant="bodySmall" style={styles.actionSub}>{subtitle}</Text>
      </Surface>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F9FA',
  },
  scrollContent: {
    paddingBottom: 20,
  },

  // Header
  header: {
    backgroundColor: '#4CAF50',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 24,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerText: {
    flex: 1,
  },
  greeting: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 14,
  },
  heroName: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 26,
    marginTop: 2,
  },
  avatar: {
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  pillRow: {
    flexDirection: 'row',
    marginTop: 18,
    gap: 8,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  pillWarn: {
    backgroundColor: '#FFF3E0',
  },
  pillDanger: {
    backgroundColor: '#FFEBEE',
  },
  pillValue: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 16,
  },
  pillLabel: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 12,
  },

  // Sections
  sectionTitle: {
    fontWeight: '700',
    marginLeft: 20,
    marginTop: 20,
    marginBottom: 4,
    color: '#333',
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingRight: 20,
  },
  seeAll: {
    color: '#4CAF50',
    fontWeight: '600',
    fontSize: 13,
    marginTop: 20,
  },

  // Action grid
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 14,
    marginTop: 8,
    gap: 0,
  },
  actionCard: {
    width: '50%',
    padding: 6,
  },
  actionSurface: {
    borderRadius: 18,
    padding: 16,
    minHeight: 120,
    justifyContent: 'center',
  },
  actionIconWrap: {
    position: 'relative',
    alignSelf: 'flex-start',
    marginBottom: 8,
  },
  actionBadge: {
    position: 'absolute',
    top: -4,
    right: -8,
    backgroundColor: '#F44336',
  },
  actionLabel: {
    fontWeight: '700',
    fontSize: 15,
  },
  actionSub: {
    color: '#888',
    fontSize: 12,
    marginTop: 2,
  },

  // Expiring horizontal
  hScroll: {
    marginTop: 8,
  },
  hScrollContent: {
    paddingHorizontal: 20,
    gap: 10,
  },
  expiryCard: {
    width: 130,
    padding: 14,
    borderRadius: 16,
    backgroundColor: '#fff',
    position: 'relative',
  },
  expiryBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: '#FFF3E0',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  expiryBadgeText: {
    color: '#E65100',
    fontSize: 11,
    fontWeight: '800',
  },
  expiryName: {
    fontWeight: '600',
    marginTop: 4,
    color: '#333',
  },
  expiryQty: {
    color: '#888',
    marginTop: 4,
  },

  // Expired banner
  expiredBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    marginTop: 16,
    backgroundColor: '#FFEBEE',
    borderRadius: 16,
    padding: 12,
  },
  expiredBannerIcon: {
    marginRight: 4,
  },
  expiredBannerText: {
    flex: 1,
  },

  // Recent items
  recentList: {
    paddingHorizontal: 20,
    marginTop: 8,
    gap: 6,
  },
  recentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
  },
  recentDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 12,
  },
  recentInfo: {
    flex: 1,
  },
  recentName: {
    fontWeight: '600',
    color: '#333',
  },
  recentQty: {
    color: '#888',
    marginTop: 1,
  },
  daysChip: {
    backgroundColor: '#E8F5E9',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  daysChipUrgent: {
    backgroundColor: '#FFF3E0',
  },
  daysChipText: {
    color: '#2E7D32',
    fontSize: 12,
    fontWeight: '700',
  },
  daysChipTextUrgent: {
    color: '#E65100',
  },

  // Empty state
  emptyCard: {
    marginHorizontal: 20,
    marginTop: 8,
    borderRadius: 18,
    padding: 28,
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  emptyText: {
    color: '#888',
    marginTop: 8,
    fontWeight: '600',
  },
  emptySubtext: {
    color: '#bbb',
    marginTop: 4,
  },

  bottomSpacer: {
    height: 24,
  },
});
