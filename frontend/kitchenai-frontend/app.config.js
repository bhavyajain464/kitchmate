const { loadAppEnv } = require('./loadEnv');

module.exports = ({ config }) => {
  loadAppEnv(__dirname);
  return config;
};
