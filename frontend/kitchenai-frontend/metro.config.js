const { getDefaultConfig } = require('expo/metro-config');
const { loadAppEnv } = require('./loadEnv');

// Defaults to prod.env; override with DOTENV_CONFIG_PATH=staging.env for staging.
loadAppEnv(__dirname);

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Google Identity Services popup/postMessage needs COOP that allows popups (local web dev).
config.server = {
  ...config.server,
  enhanceMiddleware: (middleware) => (req, res, next) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    const path = req.url?.split('?')[0] ?? '';
    if (path === '/privacy' || path === '/privacy/') {
      const query = req.url?.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
      req.url = `/privacy.html${query}`;
    }
    return middleware(req, res, next);
  },
};

module.exports = config;
