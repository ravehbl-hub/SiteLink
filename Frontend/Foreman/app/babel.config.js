module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // reanimated 4 uses the react-native-worklets babel plugin (must be last).
    plugins: ['react-native-worklets/plugin'],
  };
};
