module.exports = {
  presets: ['module:@react-native/babel-preset'],
  // Required by react-native-worklets-core: transforms 'worklet'-tagged
  // frame processor functions (see useLiveHandGestures.ts) into a form the
  // native side can extract and compile on its own JS runtime. Without
  // this, the raw closure is sent through malformed, and Hermes fails with
  // "Compiling JS failed: 1:1:invalid empty parentheses '( )'" the moment
  // a frame actually reaches the worklet.
  plugins: ['react-native-worklets-core/plugin'],
};
