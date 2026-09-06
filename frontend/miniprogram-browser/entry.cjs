const { installPlatform, startPages } = require('./platform.cjs');
installPlatform();
const compiled = require('./.generated/index.js');
const config = require('./.generated/browser-config.json');
startPages(compiled, config);
