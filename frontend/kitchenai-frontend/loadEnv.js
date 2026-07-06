const path = require('path');
const fs = require('fs');

/** Load prod.env (or DOTENV_CONFIG_PATH) into process.env for Expo CLI + Metro. */
function loadAppEnv(projectRoot = __dirname) {
  const envFile = process.env.DOTENV_CONFIG_PATH || 'prod.env';
  const envPath = path.resolve(projectRoot, envFile);
  if (!fs.existsSync(envPath)) {
    return envPath;
  }
  require('dotenv').config({ path: envPath });
  return envPath;
}

module.exports = { loadAppEnv };
