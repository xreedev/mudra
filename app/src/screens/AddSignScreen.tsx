import React, { useRef, useState } from 'react';
import { Image, ScrollView, StyleSheet, View } from 'react-native';
import {
  AppHeader,
  Button,
  CameraStage,
  Card,
  GlossChips,
  Icon,
  IconButton,
  Screen,
  Text,
  TextField,
  type CameraStageHandle,
} from '../components';
import { SEED_SIGNS, type CustomSign } from '../data/mock';
import { useTheme } from '../theme';
import type { ScreenProps } from '../navigation/types';

/**
 * Add a custom sign: take a snapshot, label it underneath, save.
 *
 * The frame stays in place after capture and the label field appears directly below it, so the
 * photo and the word being attached to it are visible at the same time — you should never have
 * to remember what you just captured.
 *
 * Labels are upper-cased as you type because a gloss is a canonical token, not prose; showing it
 * as a chip makes that obvious without needing to explain it.
 */
export function AddSignScreen(_: ScreenProps<'AddSign'>) {
  const theme = useTheme();
  const camera = useRef<CameraStageHandle>(null);
  const [shot, setShot] = useState<string | null>(null);
  const [captured, setCaptured] = useState(false);
  const [label, setLabel] = useState('');
  const [signs, setSigns] = useState<CustomSign[]>(SEED_SIGNS);
  const [busy, setBusy] = useState(false);

  const gloss = label.trim().toUpperCase().replace(/\s+/g, '_');

  const capture = async () => {
    setBusy(true);
    const uri = await camera.current?.capture();
    setShot(uri ?? null);
    // With no real camera the frame still advances, so the labelling flow stays reviewable.
    setCaptured(true);
    setBusy(false);
  };

  const retake = () => {
    setShot(null);
    setCaptured(false);
  };

  const save = () => {
    if (gloss.length === 0) return;
    setSigns((current) => [{ id: String(Date.now()), label: gloss, samples: 1 }, ...current]);
    setLabel('');
    retake();
  };

  return (
    <Screen>
      <AppHeader title="Add custom sign" subtitle="Capture the sign, then name it" />

      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: theme.spacing['4xl'], gap: theme.spacing.xl }}
      >
        <View style={[styles.frame, { borderRadius: theme.radius.xl }]}>
          {captured && shot ? (
            <Image source={{ uri: shot }} style={styles.shot} resizeMode="cover" />
          ) : captured ? (
            <CapturedPlaceholder />
          ) : (
            <CameraStage ref={camera} facing="front" style={StyleSheet.absoluteFill}>
              <View style={styles.reticle}>
                <View style={[styles.reticleBox, { borderColor: 'rgba(255,255,255,0.5)' }]} />
              </View>
            </CameraStage>
          )}

          {captured ? (
            <View style={styles.frameBadge}>
              <Icon name="check" size={14} color="#FFFFFF" />
              <Text variant="caption" style={styles.onDark}>
                Captured
              </Text>
            </View>
          ) : null}
        </View>

        {captured ? (
          <View style={{ gap: theme.spacing.lg }}>
            <TextField
              label="Label this sign"
              placeholder="METFORMIN"
              autoCapitalize="characters"
              autoCorrect={false}
              value={label}
              onChangeText={setLabel}
              hint="One word. This becomes the gloss the recognizer emits."
            />

            {gloss.length > 0 ? (
              <View style={{ gap: theme.spacing.sm }}>
                <Text variant="label" tone="muted">
                  WILL BE SAVED AS
                </Text>
                <GlossChips tokens={[gloss]} tone="accent" />
              </View>
            ) : null}

            <View style={styles.actions}>
              <Button label="Retake" variant="secondary" icon="close" onPress={retake} />
              <Button
                label="Save sign"
                icon="check"
                disabled={gloss.length === 0}
                onPress={save}
                style={styles.grow}
              />
            </View>
          </View>
        ) : (
          <View style={styles.captureRow}>
            <View style={styles.captureHint}>
              <Text variant="caption" tone="muted">
                Hold the sign inside the frame, then capture. More samples make recognition
                steadier.
              </Text>
            </View>
            <IconButton
              name="shutter"
              accessibilityLabel="Capture sign"
              variant="accent"
              size={68}
              disabled={busy}
              onPress={capture}
            />
          </View>
        )}

        <View style={{ gap: theme.spacing.md }}>
          <Text variant="label" tone="muted">
            YOUR SIGNS · {signs.length}
          </Text>
          {signs.map((sign) => (
            <Card key={sign.id} tone="flat">
              <View style={styles.signRow}>
                <GlossChips tokens={[sign.label]} size="sm" />
                <Text variant="caption" tone="muted">
                  {sign.samples} {sign.samples === 1 ? 'sample' : 'samples'}
                </Text>
              </View>
            </Card>
          ))}
        </View>
      </ScrollView>
    </Screen>
  );
}

/** Shown when there is no real photo (no camera on this device) but the flow continues. */
function CapturedPlaceholder() {
  return (
    <View style={styles.placeholder}>
      <Icon name="sign" size={28} color="rgba(255,255,255,0.6)" />
      <Text variant="caption" style={[styles.onDark, styles.dim]}>
        Snapshot placeholder
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    aspectRatio: 3 / 4,
    overflow: 'hidden',
    backgroundColor: '#0B0C0E',
  },
  shot: { ...StyleSheet.absoluteFillObject },
  placeholder: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  reticle: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  reticleBox: {
    width: '62%',
    aspectRatio: 1,
    borderWidth: 1.5,
    borderRadius: 20,
    borderStyle: 'dashed',
  },
  frameBadge: {
    position: 'absolute',
    top: 12,
    left: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  onDark: { color: '#FFFFFF' },
  dim: { opacity: 0.7 },
  captureRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  captureHint: { flex: 1 },
  actions: { flexDirection: 'row', gap: 12 },
  grow: { flex: 1 },
  signRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
