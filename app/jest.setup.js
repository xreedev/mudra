/* eslint-env jest */
// Native modules the UI scaffold touches but a JS test environment has no host for.
jest.mock('react-native-safe-area-context', () => {
  const actual = jest.requireActual('react-native-safe-area-context');
  return {
    ...actual,
    SafeAreaProvider: ({ children }) => children,
    useSafeAreaInsets: () => ({ top: 44, bottom: 24, left: 0, right: 0 }),
  };
});

jest.mock('react-native-vision-camera', () => {
  const React = require('react');
  return {
    Camera: {
      getCameraPermissionStatus: () => 'denied',
      requestCameraPermission: async () => 'denied',
      getAvailableCameraDevices: () => [],
    },
    // No real camera/native plugin host in Jest — CameraStage never gets far
    // enough (permission is 'denied' above) to actually invoke either of
    // these, so a trivial passthrough is enough to satisfy the imports.
    // The real hook's deps array is caller-provided, so eslint can't
    // statically verify it here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useFrameProcessor: (worklet, deps) => React.useCallback(worklet, deps),
    VisionCameraProxy: { initFrameProcessorPlugin: () => null },
  };
});

jest.mock('react-native-screens', () => require('react-native-screens/mock'));

jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/mock-documents',
  exists: async () => false,
  readFile: async () => '{}',
  writeFile: async () => undefined,
}));

jest.mock('react-native-worklets-core', () => {
  const React = require('react');
  return {
    // Same caller-provided-deps situation as useFrameProcessor above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useRunOnJS: (callback, deps) => React.useCallback((...args) => Promise.resolve(callback(...args)), deps),
  };
});
