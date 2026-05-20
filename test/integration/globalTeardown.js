// JS wrapper for Jest globalTeardown. See globalSetup.js for rationale.
require('ts-node/register/transpile-only');
module.exports = require('./teardown.ts').default;
