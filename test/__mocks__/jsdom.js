'use strict';

// Minimal JSDOM mock to avoid the ESM parse5 dependency chain in unit tests.
// InputSanitizer uses JSDOM only to create a DOMPurify instance for XSS sanitization.
class JSDOM {
  constructor() {
    this.window = {
      document: {
        createElement: () => ({ innerHTML: '' }),
        createTreeWalker: () => ({ nextNode: () => null }),
      },
      Node: { ELEMENT_NODE: 1 },
    };
  }
}

module.exports = { JSDOM };
