import React, { useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, Platform, Linking } from 'react-native';
import { Portal, Modal, Text, Button, IconButton, Icon } from 'react-native-paper';
import * as api from '../services/api';
import { CommercePartner, UserShoppingItem } from '../types';
import { showAppError, showAppSuccess } from '../utils/alertMessage';
import { userFacingError } from '../utils/userFacingError';

type Props = {
  visible: boolean;
  onClose: () => void;
  items: UserShoppingItem[];
  partners: CommercePartner[];
  source?: string;
};

function orderPayload(items: UserShoppingItem[]) {
  return items
    .filter((it) => it.name?.trim())
    .map((it) => ({ name: it.name.trim(), qty: it.qty, unit: it.unit }));
}

export function OrderOnlineSheet({ visible, onClose, items, partners, source = 'shopping_list' }: Props) {
  const [partner, setPartner] = useState<CommercePartner | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);

  const orderItems = useMemo(() => orderPayload(items), [items]);
  const currentItem = orderItems[currentIndex];
  const totalItems = orderItems.length;

  const reset = () => {
    setPartner(null);
    setBusy(null);
    setCurrentIndex(0);
  };

  const close = () => {
    reset();
    onClose();
  };

  useEffect(() => {
    if (!visible) reset();
  }, [visible]);

  const openUrl = async (url: string) => {
    if (Platform.OS === 'web') {
      window.open(url, '_blank');
      return;
    }
    const ok = await Linking.canOpenURL(url).catch(() => true);
    if (ok) await Linking.openURL(url);
  };

  const openItemSearch = async (index: number, partnerId: string) => {
    const line = orderItems[index];
    if (!line) return;
    const res = await api.createOrderLink(partnerId, [line], 'shopping_item');
    await openUrl(res.url);
    setCurrentIndex(index);
  };

  const startOrdering = async (p: CommercePartner) => {
    if (!orderItems.length || busy) return;
    setPartner(p);
    setBusy('start');
    setCurrentIndex(0);
    try {
      const res = await api.createOrderLink(p.id, orderItems, source);
      await openUrl(res.url);
      const label = orderItems.length === 1
        ? orderItems[0].name
        : `${orderItems[0].name} (1 of ${orderItems.length})`;
      showAppSuccess(`Opened ${label} on ${p.name}.`);
    } catch (e) {
      setPartner(null);
      showAppError(userFacingError(e, 'Could not open ordering. Try again.'));
    } finally {
      setBusy(null);
    }
  };

  const handleOpenCurrent = async () => {
    if (!partner || busy || !currentItem) return;
    setBusy('open');
    try {
      await openItemSearch(currentIndex, partner.id);
    } catch (e) {
      showAppError(userFacingError(e, 'Could not open this item. Try again.'));
    } finally {
      setBusy(null);
    }
  };

  const handleNext = async () => {
    if (!partner || busy || currentIndex >= totalItems - 1) return;
    setBusy('next');
    try {
      await openItemSearch(currentIndex + 1, partner.id);
    } catch (e) {
      showAppError(userFacingError(e, 'Could not open next item. Try again.'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Portal>
      <Modal visible={visible} onDismiss={close} contentContainerStyle={styles.modal}>
        {!partner ? (
          <>
            <Text variant="titleMedium" style={styles.title}>Order online</Text>
            <Text variant="bodySmall" style={styles.sub}>
              {totalItems === 1
                ? 'Pick a store — we’ll open the search for your item.'
                : `Pick a store — we’ll open the first of ${totalItems} items.`}
            </Text>
            <View style={styles.partners}>
              {partners.map((p) => (
                <Button
                  key={p.id}
                  mode="outlined"
                  icon={() => <Icon source="storefront-outline" size={18} color="#2E7D32" />}
                  onPress={() => void startOrdering(p)}
                  loading={busy === 'start'}
                  disabled={!!busy}
                  style={styles.partnerBtn}
                  contentStyle={styles.partnerBtnContent}
                  textColor="#1B5E20"
                >
                  {p.eta ? `${p.name} · ${p.eta}` : p.name}
                </Button>
              ))}
            </View>
            <Button onPress={close} textColor="#888" style={{ marginTop: 4 }}>Cancel</Button>
          </>
        ) : (
          <>
            <View style={styles.headerRow}>
              <IconButton icon="arrow-left" size={20} onPress={reset} style={{ margin: 0 }} />
              <Text variant="titleMedium" style={styles.titleInline}>Ordering on {partner.name}</Text>
            </View>
            <Text variant="bodySmall" style={styles.sub}>
              Your shopping list is already loaded. Search and add each item in {partner.name}, then tap Next.
            </Text>

            {currentItem ? (
              <View style={styles.currentCard}>
                <Text variant="labelSmall" style={styles.progress}>
                  Item {currentIndex + 1} of {totalItems}
                </Text>
                <Text variant="titleMedium" style={styles.currentName}>{currentItem.name}</Text>
                {currentItem.qty ? (
                  <Text variant="bodySmall" style={styles.currentQty}>
                    {currentItem.qty} {currentItem.unit}
                  </Text>
                ) : null}
              </View>
            ) : null}

            <Button
              mode="contained-tonal"
              icon="magnify"
              onPress={() => void handleOpenCurrent()}
              loading={busy === 'open'}
              disabled={!!busy || !currentItem}
              style={styles.primaryBtn}
              textColor="#1B5E20"
            >
              Open search for this item
            </Button>

            {totalItems > 1 ? (
              <Button
                mode="contained"
                icon="arrow-right"
                onPress={() => void handleNext()}
                loading={busy === 'next'}
                disabled={!!busy || currentIndex >= totalItems - 1}
                buttonColor="#2E7D32"
                style={styles.nextBtn}
              >
                {currentIndex >= totalItems - 1 ? 'Last item' : 'Next item'}
              </Button>
            ) : null}

            <Button onPress={close} textColor="#888">Done</Button>
          </>
        )}
      </Modal>
    </Portal>
  );
}

const styles = StyleSheet.create({
  modal: { backgroundColor: '#fff', marginHorizontal: 20, borderRadius: 16, padding: 20 },
  title: { color: '#1A1A1A', fontWeight: '600' },
  titleInline: { color: '#1A1A1A', fontWeight: '600', flex: 1 },
  sub: { color: '#666', marginTop: 4, marginBottom: 14 },
  partners: { gap: 10 },
  partnerBtn: { borderColor: '#A5D6A7', borderRadius: 12 },
  partnerBtnContent: { height: 46, justifyContent: 'flex-start' },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 2 },
  currentCard: {
    backgroundColor: '#F1F8E9',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  progress: { color: '#558B2F', marginBottom: 4 },
  currentName: { color: '#1A1A1A' },
  currentQty: { color: '#666', marginTop: 2 },
  primaryBtn: { marginBottom: 8, borderRadius: 12 },
  nextBtn: { marginBottom: 8, borderRadius: 12 },
});
