/** @type {import('jest').Config} */
const config = {
  // Use the same preset as main tests
  preset: 'ts-jest',
  testEnvironment: 'node',

  // Only run integration tests
  testMatch: ['<rootDir>/test/integration/**/*.test.ts'],

  // Exclude stale legacy integration suites that pre-date the v2 SDK and
  // no longer compile/run against the current client. They have been
  // superseded by test/integration/suites/* and the per-entity suites.
  testPathIgnorePatterns: [
    '<rootDir>/node_modules/',
    // Calls setupIntegrationTest() at module load — throws SKIP_INTEGRATION_TESTS
    '<rootDir>/test/integration/debug-response.test.ts',
    // Stale mock server expectations (now returns 401) and removed type shapes
    '<rootDir>/test/integration/mock-server.test.ts',
    '<rootDir>/test/integration/sdk-integration.test.ts',
  ],

  // Global setup and teardown
  // JS wrappers register ts-node so the TS modules load in Jest's
  // globalSetup process (which bypasses the ts-jest transform).
  globalSetup: '<rootDir>/test/integration/globalSetup.js',
  globalTeardown: '<rootDir>/test/integration/globalTeardown.js',

  // Setup after environment
  setupFilesAfterEnv: ['<rootDir>/test/integration/setupAfterEnv.ts'],

  // Optimized timeout for integration tests
  testTimeout: 15000, // Reduced from 30000

  // Coverage settings
  collectCoverage: false, // Disable coverage for integration tests

  // Module resolution
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^uuid$': '<rootDir>/test/__mocks__/uuid.js',
  },

  // Transform settings
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.json',
        // Downgrade TS type errors in test files to warnings so tests can
        // run (matches jest.config.js for the unit suite). Several legacy
        // integration suites have stale type signatures.
        diagnostics: { warnOnly: true },
      },
    ],
  },

  // Optimize output for integration tests
  verbose: false, // Reduced verbosity for speed
  silent: !process.env.DEBUG_INTEGRATION_TESTS,

  // Allow parallel execution for independent tests
  maxWorkers: 1, // Force serial execution to avoid circular reference issues

  // Clear mocks between tests
  clearMocks: true,
  restoreMocks: true,

  // Error handling
  errorOnDeprecated: true,

  // Display name for this configuration
  displayName: {
    name: 'Integration Tests',
    color: 'blue',
  },

  // Optimized reporters
  reporters: [
    'default',
    [
      'jest-junit',
      {
        outputDirectory: './test/integration/reports',
        outputName: 'integration-test-results.xml',
        suiteName: 'Autotask API Integration Tests',
      },
    ],
  ],

  // Performance optimizations
  cache: true,
  detectLeaks: false, // Disable for performance
  forceExit: true, // Force exit after tests complete
};

module.exports = config;
