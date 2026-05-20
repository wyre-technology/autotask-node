// JS wrapper for Jest globalSetup.
// Jest loads globalSetup/globalTeardown in a process that bypasses the
// ts-jest transform, so a .ts entrypoint fails with ERR_UNKNOWN_FILE_EXTENSION.
// Register ts-node here so the real TypeScript setup module can be required.
require('ts-node/register/transpile-only');
module.exports = require('./setup.ts').default;
