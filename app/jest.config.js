module.exports = {
  preset: 'react-native',
  setupFiles: ['<rootDir>/jest.setup.js'],
  // The navigation and SVG packages ship ES modules, so they have to go through Babel.
  transformIgnorePatterns: [
    'node_modules/(?!(?:@react-native|react-native|@react-navigation|react-native-svg|react-native-screens|react-native-safe-area-context|react-native-vision-camera)/)',
  ],
};
