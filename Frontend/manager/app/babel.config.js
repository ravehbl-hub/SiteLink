module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // react-native-worklets/plugin replaces the old react-native-reanimated/plugin
    // in Reanimated 4 (Expo SDK 54). It must be the last plugin in the list.
    plugins: ['react-native-worklets/plugin'],
  };
};
