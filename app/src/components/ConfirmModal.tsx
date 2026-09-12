import React from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { Button, type ButtonVariant } from './Button';
import { Card } from './Card';
import { Text } from './Text';
import { useTheme } from '../theme';

export interface ConfirmModalProps {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** `danger` for a destructive confirm action (e.g. overwriting a saved
   *  sign); `primary` for a routine one. */
  confirmVariant?: Extract<ButtonVariant, 'primary' | 'danger'>;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * A themed yes/no dialog — the app has no native-Alert usage anywhere else,
 * and Alert can't be styled to match the dark call/camera screens, so this
 * is the one place a blocking confirmation is needed (gesture label/shape
 * collisions in Add custom sign).
 */
export function ConfirmModal({
  visible,
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancel',
  confirmVariant = 'primary',
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const theme = useTheme();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={[styles.backdrop, { backgroundColor: theme.colors.overlay }]}>
        <Card tone="raised" style={styles.panel}>
          <Text variant="heading">{title}</Text>
          <Text variant="body" tone="muted" style={{ marginTop: theme.spacing.sm }}>
            {message}
          </Text>
          <View style={[styles.actions, { marginTop: theme.spacing.xl, gap: theme.spacing.md }]}>
            <Button label={cancelLabel} variant="secondary" onPress={onCancel} style={styles.grow} />
            <Button label={confirmLabel} variant={confirmVariant} onPress={onConfirm} style={styles.grow} />
          </View>
        </Card>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  panel: { width: '100%', maxWidth: 380 },
  actions: { flexDirection: 'row' },
  grow: { flex: 1 },
});
