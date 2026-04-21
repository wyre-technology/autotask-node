'use strict';

// Minimal DOMPurify mock to avoid the ESM parse5 dependency chain in unit tests.
// Returns input unchanged — tests that require real XSS sanitization should use integration tests.
const DOMPurify = () => ({
  sanitize: input => (typeof input === 'string' ? input : ''),
  addHook: () => {},
  removeHook: () => {},
  removeHooks: () => {},
  clearConfig: () => {},
  setConfig: () => {},
  isValidAttribute: () => true,
});

DOMPurify.sanitize = input => (typeof input === 'string' ? input : '');
DOMPurify.addHook = () => {};
DOMPurify.removeHook = () => {};
DOMPurify.removeHooks = () => {};
DOMPurify.clearConfig = () => {};
DOMPurify.setConfig = () => {};
DOMPurify.isValidAttribute = () => true;

module.exports = DOMPurify;
module.exports.default = DOMPurify;
