import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Button } from './Button';
import { Icon } from './Icon';
import { Text } from './Text';
import { useTheme } from '../theme';

/**
 * The camera viewport, shared by the call screen and the add-a-sign screen.
 *
 * `react-native-vision-camera` is loaded lazily and defensively: a fresh clone has not run
 * `pod install` or an Android build yet, and a UI scaffold that red-screens on launch is useless
 * for reviewing the design. When the native module is missing, or permission is refused, or the
 * app runs in a simulator with no camera, this renders a designed placeholder in the same frame
 * instead — so every other screen stays reviewable.
 */

type CameraModule = typeof import('react-native-vision-camera');

let cameraModule: CameraModule | null | undefined;

function loadCamera(): CameraModule | null {
  if (cameraModule === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      cameraModule = require('react-native-vision-camera') as CameraModule;
    } catch {
      cameraModule = null;
    }
  }
  return cameraModule;
}

type Status = 'loading' | 'ready' | 'no-permission' | 'no-device' | 'unavailable';

export interface CameraStageHandle {
  /**
   * Takes a photo. Returns a displayable URI, or `null` when there is no real camera — the
   * caller then shows its placeholder state.
   */
  capture(): Promise<string | null>;
}

export interface CameraStageProps {
  facing?: 'front' | 'back';
  /**
   * A VisionCamera frame processor (from `useFrameProcessor`) — runs
   * real-time detection (e.g. hand-landmark recognition) on every camera
   * frame. Requires `newArchEnabled=false` in this build: VisionCamera's
   * Frame Processor JSI proxy doesn't yet support Bridgeless mode, which
   * RN 0.76's stock Android template otherwise couples to New Architecture.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  frameProcessor?: any;
  /** Overlay content rendered on top of the preview. */
  children?: React.ReactNode;
  /** Rounded corners for an inset preview; square for a full-bleed one. */
  rounded?: boolean;
  /**
   * Where the "camera access needed" placeholder sits when there's no live
   * preview yet. Default `'center'` (unchanged, used by AddSignScreen's
   * framed capture box). Pass `'top'` when `children` renders a large fixed
   * bottom panel over the stage (e.g. CallScreen's floating call chrome) —
   * otherwise the centered placeholder's own "Allow camera" button can end
   * up sitting underneath that panel, unreachable.
   */
  placeholderAlign?: 'center' | 'top';
  style?: StyleProp<ViewStyle>;
}

export const CameraStage = forwardRef<CameraStageHandle, CameraStageProps>(function CameraStage(
  { facing = 'front', frameProcessor, children, rounded = true, placeholderAlign = 'center', style },
  ref,
) {
  const theme = useTheme();
  const [status, setStatus] = useState<Status>('loading');
  const cameraRef = useRef<unknown>(null);
  const module = loadCamera();
  const device = useDevice(module, facing);

  const requestPermission = useCallback(async () => {
    if (!module) {
      setStatus('unavailable');
      return;
    }
    try {
      const granted = await module.Camera.requestCameraPermission();
      if (granted !== 'granted') {
        setStatus('no-permission');
        return;
      }
      setStatus(device ? 'ready' : 'no-device');
    } catch {
      setStatus('unavailable');
    }
  }, [module, device]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!module) {
        if (!cancelled) setStatus('unavailable');
        return;
      }
      try {
        const permission = module.Camera.getCameraPermissionStatus();
        if (permission !== 'granted') {
          if (!cancelled) setStatus('no-permission');
          return;
        }
        if (!cancelled) setStatus(device ? 'ready' : 'no-device');
      } catch {
        if (!cancelled) setStatus('unavailable');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [module, device]);

  useImperativeHandle(
    ref,
    () => ({
      async capture() {
        const camera = cameraRef.current as { takePhoto?: () => Promise<{ path: string }> } | null;
        if (status !== 'ready' || !camera?.takePhoto) return null;
        try {
          const photo = await camera.takePhoto();
          return Platform.OS === 'android' ? `file://${photo.path}` : photo.path;
        } catch {
          return null;
        }
      },
    }),
    [status],
  );

  const Camera = module?.Camera;

  return (
    <View
      style={[
        styles.stage,
        {
          backgroundColor: theme.colors.viewport,
          borderRadius: rounded ? theme.radius.xl : 0,
        },
        style,
      ]}
    >
      {status === 'ready' && Camera && device ? (
        <Camera
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ref={cameraRef as any}
          style={StyleSheet.absoluteFill}
          device={device}
          isActive
          photo
          frameProcessor={frameProcessor}
          pixelFormat="yuv"
        />
      ) : (
        <Placeholder status={status} onRequestPermission={requestPermission} align={placeholderAlign} />
      )}
      {children ? <View style={StyleSheet.absoluteFill}>{children}</View> : null}
    </View>
  );
});

/** Resolves a camera device without a hook, so a missing native module cannot break render. */
function useDevice(module: CameraModule | null, facing: 'front' | 'back') {
  const [device, setDevice] = useState<unknown>(null);

  useEffect(() => {
    if (!module) {
      setDevice(null);
      return;
    }
    try {
      const devices = module.Camera.getAvailableCameraDevices();
      const match = devices.find((candidate) => candidate.position === facing) ?? devices[0];
      setDevice(match ?? null);
    } catch {
      setDevice(null);
    }
  }, [module, facing]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return device as any;
}

const COPY: Record<Exclude<Status, 'ready'>, { title: string; body: string }> = {
  loading: { title: 'Starting camera', body: 'One moment.' },
  'no-permission': {
    title: 'Camera access needed',
    body: 'MUDRA+ reads your signs on the device. Nothing is recorded or uploaded.',
  },
  'no-device': {
    title: 'No camera found',
    body: 'This device has no camera available to the app.',
  },
  unavailable: {
    title: 'Camera preview unavailable',
    body: 'Run the app on a device to see the live preview. The rest of the screen is live.',
  },
};

function Placeholder({
  status,
  onRequestPermission,
  align,
}: {
  status: Status;
  onRequestPermission: () => void;
  align: 'center' | 'top';
}) {
  const theme = useTheme();
  if (status === 'ready') return null;
  const copy = COPY[status];

  return (
    <View
      style={[
        styles.placeholder,
        align === 'top' ? styles.placeholderTop : styles.placeholderCenter,
        { padding: theme.spacing['2xl'] },
      ]}
    >
      <View style={styles.placeholderBadge}>
        <Icon name="sign" size={24} color="#FFFFFF" />
      </View>
      <Text variant="heading" style={styles.placeholderText}>
        {copy.title}
      </Text>
      <Text variant="body" style={[styles.placeholderText, styles.placeholderBody]}>
        {copy.body}
      </Text>
      {status === 'no-permission' ? (
        <Button
          label="Allow camera"
          variant="primary"
          onPress={onRequestPermission}
          style={{ marginTop: theme.spacing.lg }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stage: { flex: 1, overflow: 'hidden' },
  placeholder: { ...StyleSheet.absoluteFillObject, alignItems: 'center', gap: 8 },
  placeholderCenter: { justifyContent: 'center' },
  /** Sits in the upper third instead of dead-center, so it can never end up
   *  underneath a large bottom overlay panel rendered as `children`. */
  placeholderTop: { justifyContent: 'flex-start', paddingTop: '18%' },
  placeholderBadge: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
    marginBottom: 6,
  },
  placeholderText: { color: '#FFFFFF', textAlign: 'center' },
  placeholderBody: { opacity: 0.72, maxWidth: 280 },
});
