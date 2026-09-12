import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Button,
  CameraStage,
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
 * Two states, one screen: pick who to call, then the live call. Live layout is a
 * full-bleed camera behind everything — signing is the input method, so the preview
 * gets the whole screen — with the call bar, recognized glosses, draft sentence, and
 * call controls floating on top of it as translucent overlays, the way a normal video
 * call's chrome floats over the video rather than displacing it.
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
      <CameraStage
        facing={facing}
        rounded={false}
        placeholderAlign="top"
        style={StyleSheet.absoluteFill}
      >
        <View
          style={[
            styles.overlay,
            { paddingTop: insets.top, paddingBottom: insets.bottom },
          ]}
        >
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
            <IconButton
              name="flip"
              accessibilityLabel="Switch camera"
              variant="translucent"
              size={38}
              onPress={() => setFacing(facing === 'front' ? 'back' : 'front')}
            />
          </View>

          <View style={styles.spacer} />

          <View
            style={[
              styles.chrome,
              {
                paddingHorizontal: theme.spacing.lg,
                paddingTop: theme.spacing.xl,
                borderTopLeftRadius: theme.radius['2xl'],
                borderTopRightRadius: theme.radius['2xl'],
                gap: theme.spacing.md,
              },
            ]}
          >
            <View style={{ gap: theme.spacing.sm }}>
              <Text variant="label" style={[styles.onDark, styles.dim]}>
                RECOGNIZED
              </Text>
              <GlossChips tokens={DEMO_RECOGNIZED} tone="accent" />
            </View>

            <View
              style={[
                styles.draftPanel,
                { borderRadius: theme.radius.lg, padding: theme.spacing.lg },
              ]}
            >
              <Text variant="label" style={[styles.onDark, styles.dim]}>
                WILL BE SPOKEN
              </Text>
              <Text variant="heading" style={[styles.onDark, { marginTop: theme.spacing.sm }]}>
                {draft}
              </Text>
              <View style={[styles.draftActions, { marginTop: theme.spacing.md }]}>
                <Pressable onPress={() => setDraft(DEMO_DRAFT)} hitSlop={8}>
                  <Text variant="caption" tone="accent">
                    Reset
                  </Text>
                </Pressable>
                <Text variant="caption" style={[styles.onDark, styles.dim]}>
                  ·
                </Text>
                <Pressable onPress={() => setDraft('')} hitSlop={8}>
                  <Text variant="caption" tone="accent">
                    Clear
                  </Text>
                </Pressable>
              </View>
            </View>

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
                variant={muted ? 'accent' : 'translucent'}
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
                variant="translucent"
                size={52}
                onPress={() => undefined}
              />
            </View>
          </View>
        </View>
      </CameraStage>
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
  /** Everything floats over the full-bleed camera: call bar pinned top, chrome
   *  pinned bottom, the middle left empty so the live preview stays visible. */
  overlay: { flex: 1, justifyContent: 'flex-start' },
  spacer: { flex: 1 },
  /** A translucent scrim behind ALL the floating bottom chrome, not just the
   *  draft text — bare text over unpredictable live video is unreadable, the
   *  same reason every real video-call UI (FaceTime, WhatsApp) scrims its
   *  overlay chrome rather than relying on per-element panels. Still shows
   *  the camera through it, unlike the old opaque bottom sheet. */
  chrome: { paddingBottom: 8, backgroundColor: 'rgba(0,0,0,0.4)' },
  /** A slightly darker panel just for the draft text, so the sentence that's
   *  about to be spoken reads as the clear focal point of the chrome. */
  draftPanel: { backgroundColor: 'rgba(0,0,0,0.35)' },
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
