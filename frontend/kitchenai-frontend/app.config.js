const fs = require('fs');
const path = require('path');
const { loadAppEnv } = require('./loadEnv');

const GOOGLE_SERVICES_FILE = './google-services.json';

module.exports = ({ config }) => {
  loadAppEnv(__dirname);
  const googleServicesPath = path.join(__dirname, 'google-services.json');
  if (!fs.existsSync(googleServicesPath)) {
    return config;
  }
  return {
    ...config,
    android: {
      ...config.android,
      googleServicesFile: GOOGLE_SERVICES_FILE,
    },
  };
};
