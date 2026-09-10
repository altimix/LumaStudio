const base = require('../package.json').build;
const { ffprobeExclusions } = require('./platform.cjs');
module.exports = { ...base, files: [...base.files, ...ffprobeExclusions()] };
