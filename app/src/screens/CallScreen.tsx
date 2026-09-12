import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Button,
  CameraStage,
  Card,
  GlossChips,
  Icon,
  IconButton,
  Screen,
  Text,
} from '../components';
import { DEMO_DRAFT, DEMO_RECOGNIZED, SEED_CONTACTS } from '../data/mock';
import { useTheme } from '../theme';
import type { ScreenProps } from '../navigation/types';

/**
 * Call someone.
 *
 * Two states, one screen: pick who to call, then the live call. Live layout is
 * camera-first — signing is the input method, so the preview gets the room — with the
 * recognized glosses and the draft sentence stacked directly under it, and the call controls
 * pinned where the thumb already is.
 *
 * The draft is never spoken until "Confirm & speak" is pressed. That gate is the whole safety
 * model of the product, so it is a full-width primary button and nothing sits near it.
 */
export function CallScreen({ navigation }: ScreenProps<'Call'>) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [contact, setContact] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [facing, setFacing] = useState<'front' | 'back'>('front');
  const [draft, setDraft] = useState(DEMO_DRAFT);

  const active = SEED_CONTACTS.find((entry) => entry.id === contact);

  if (!active) {
    return <ContactPicker onSelect={setContact} />;
  }

  return (
    <Screen dark edgeToEdge>
      <View style={[styles.callBar, { paddingHorizontal: theme.spacing.lg }]}>
        <IconButton
          name="chevron-left"
          accessibilityLabel="End and go back"
          variant="translucent"
          size={38}
          onPress={() => navigation.goBack()}
        />
        <View style={styles.callBarTitle}>
          <Text variant="bodyStrong" style={styles.onDark}>
            {active.name}
          </Text>
          <Text variant="caption" style={[styles.onDark, styles.dim]}>
            Connected · 00:42
          </Text>
        </View>
        <View style={styles.liveBadge}>
          <View style={[styles.liveDot, { backgroundColor: theme.colors.danger }]} />
          <Text variant="caption" style={styles.onDark}>
            LIVE
          </Text>
        </View>
      </View>

      <CameraStage facing={facing} rounded={false} style={styles.preview}>
        <View style={[styles.previewOverlay, { padding: theme.spacing.lg }]}>
          <View style={styles.overlayTop}>
            <View style={styles.pill}>
              <Text variant="caption" style={styles.onDark}>
                Signing · on device
              </Text>
            </View>
          </View>
          <View style={styles.overlayBottom}>
            <IconButton
              name="flip"
              accessibilityLabel="Switch camera"
              variant="translucent"
              size={40}
              onPress={() => setFacing(facing === 'front' ? 'back' : 'front')}
            />
          </View>
        </View>
      </CameraStage>

      <View
        style={[
          styles.sheet,
          {
            backgroundColor: theme.colors.background,
            borderTopLeftRadius: theme.radius['2xl'],
            borderTopRightRadius: theme.radius['2xl'],
            padding: theme.spacing.xl,
            paddingBottom: insets.bottom + theme.spacing.lg,
            gap: theme.spacing.lg,
          },
        ]}
      >
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="label" tone="muted">
            RECOGNIZED
          </Text>
          <GlossChips tokens={DEMO_RECOGNIZED} tone="accent" />
        </View>

        <Card tone="flat">
          <Text variant="label" tone="muted">
            WILL BE SPOKEN
          </Text>
          <Text variant="heading" style={{ marginTop: theme.spacing.sm }}>
            {draft}
          </Text>
          <View style={[styles.draftActions, { marginTop: theme.spacing.md }]}>
            <Pressable onPress={() => setDraft(DEMO_DRAFT)} hitSlop={8}>
              <Text variant="caption" tone="accent">
                Reset
              </Text>
            </Pressable>
            <Text variant="caption" tone="muted">
              ·
            </Text>
            <Pressable onPress={() => setDraft('')} hitSlop={8}>
              <Text variant="caption" tone="accent">
                Clear
              </Text>
            </Pressable>
          </View>
        </Card>

        <Button
          label="Confirm & speak"
          icon="check"
          size="lg"
          block
          disabled={draft.trim().length === 0}
          onPress={() => undefined}
        />

        <View style={styles.controls}>
          <IconButton
            name="mic-off"
            accessibilityLabel={muted ? 'Unmute' : 'Mute'}
            variant={muted ? 'accent' : 'surface'}
            size={52}
            onPress={() => setMuted(!muted)}
          />
          <IconButton
            name="close"
            accessibilityLabel="End call"
            variant="danger"
            size={64}
            onPress={() => navigation.goBack()}
          />
          <IconButton
            name="chat"
            accessibilityLabel="Show transcript"
            variant="surface"
            size={52}
            onPress={() => undefined}
          />
        </View>
      </View>
    </Screen>
  );
}

/** Who to call. An emergency contact is visually separated so it cannot be hit by accident. */
function ContactPicker({ onSelect }: { onSelect: (id: string) => void }) {
  const theme = useTheme();

  return (
    <Screen scroll>
      <View style={{ paddingTop: theme.spacing.lg }}>
        <Text variant="title">Call someone</Text>
        <Text variant="body" tone="muted" style={{ marginTop: theme.spacing.xs }}>
          Pick who to reach. You will confirm every sentence before it is spoken.
        </Text>
      </View>

      <View style={{ gap: theme.spacing.md, marginTop: theme.spacing['2xl'] }}>
        {SEED_CONTACTS.filter((entry) => !entry.emergency).map((entry) => (
          <Pressable
            key={entry.id}
            accessibilityRole="button"
            accessibilityLabel={`Call ${entry.name}`}
            onPress={() => onSelect(entry.id)}
            style={({ pressed }) => [
              styles.contactRow,
              {
                backgroundColor: theme.colors.surfaceRaised,
                borderColor: theme.colors.border,
                borderRadius: theme.radius.lg,
                padding: theme.spacing.lg,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <View
              style={[
                styles.avatar,
                { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md },
              ]}
            >
              <Text variant="bodyStrong">{entry.name.slice(0, 1)}</Text>
            </View>
            <View style={styles.contactText}>
              <Text variant="bodyStrong">{entry.name}</Text>
              <Text variant="caption" tone="muted">
                {entry.detail}
              </Text>
            </View>
            <Icon name="chevron-right" size={20} color={theme.colors.textMuted} />
          </Pressable>
        ))}
      </View>

      {SEED_CONTACTS.filter((entry) => entry.emergency).map((entry) => (
        <View key={entry.id} style={{ marginTop: theme.spacing['3xl'] }}>
          <Text variant="label" tone="muted">
            EMERGENCY
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Call ${entry.name}`}
            onPress={() => onSelect(entry.id)}
            style={({ pressed }) => [
              styles.contactRow,
              {
                marginTop: theme.spacing.sm,
                backgroundColor: theme.colors.dangerSoft,
                borderColor: theme.colors.danger,
                borderRadius: theme.radius.lg,
                padding: theme.spacing.lg,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <View style={styles.contactText}>
              <Text variant="bodyStrong" tone="danger">
                {entry.name}
              </Text>
              <Text variant="caption" tone="muted">
                {entry.detail} · asks you to confirm twice
              </Text>
            </View>
            <Icon name="chevron-right" size={20} color={theme.colors.danger} />
          </Pressable>
        </View>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  callBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
  },
  callBarTitle: { flex: 1 },
  onDark: { color: '#FFFFFF' },
  dim: { opacity: 0.7 },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  liveDot: { width: 7, height: 7, borderRadius: 4 },
  preview: { flex: 1 },
  previewOverlay: { flex: 1, justifyContent: 'space-between' },
  overlayTop: { flexDirection: 'row' },
  overlayBottom: { flexDirection: 'row', justifyContent: 'flex-end' },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: { marginTop: -24 },
  draftActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 28,
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  avatar: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  contactText: { flex: 1, gap: 2 },
});
