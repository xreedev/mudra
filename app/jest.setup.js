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

jest.mock('react-native-vision-camera', () => ({
  Camera: {
    getCameraPermissionStatus: () => 'denied',
    requestCameraPermission: async () => 'denied',
    getAvailableCameraDevices: () => [],
  },
}));

jest.mock('react-native-screens', () => require('react-native-screens/mock'));
