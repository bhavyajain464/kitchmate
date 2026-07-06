const { loadAppEnv } = require('./loadEnv');

loadAppEnv(__dirname);

module.exports = require('./app.json');
