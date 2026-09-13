module.exports = {
  preset: 'react-native',
  setupFiles: ['<rootDir>/jest.setup.js'],
  // The navigation and SVG packages ship ES modules, so they have to go through Babel.
  // whisper.rn/@fugood are here because LocalWhisperTranscriber imports its
  // realtime-transcription/ subpath by relative path straight into node_modules (see the
  // comment on that import) — Jest, unlike Metro, still needs this package's raw TS
  // transformed rather than skipped.
  transformIgnorePatterns: [
    'node_modules/(?!(?:@react-native|react-native|@react-navigation|react-native-svg|react-native-screens|react-native-safe-area-context|react-native-vision-camera|react-native-fs|whisper\\.rn|@fugood)/)',
  ],
  // react-native's own jest-preset transform, plus `.bin` for LOCAL_WHISPER_MODEL_ASSET
  // (metro.config.js registers `bin` as an assetExt for the same reason; Jest doesn't read
  // that config, so it needs its own entry) — same asset-descriptor stub RN uses for images.
  transform: {
    '^.+\\.(js|ts|tsx)$': 'babel-jest',
    '^.+\\.(bmp|gif|jpg|jpeg|mp4|png|psd|svg|webp|bin)$': require.resolve(
      'react-native/jest/assetFileTransformer.js',
    ),
  },
};
