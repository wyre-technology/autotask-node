/** @type {import('jest').Config} */
const config = {
  preset: 'ts-jest',
  testEnvironment: 'node',

  // Force Jest to exit after tests complete, even if open handles remain
  // (AutotaskClient uses keepAlive HTTP agents that would otherwise block exit)
  forceExit: true,

  // Test patterns - exclude integration tests
  testMatch: ['<rootDir>/test/**/*.test.ts'],
  testPathIgnorePatterns: [
    '<rootDir>/test/integration/',
    '<rootDir>/node_modules/',
    // Integration-style tests that don't belong in the unit suite
    '<rootDir>/test/rate-limiting/ReliabilityIntegration.test.ts',
    // OOM crash: ValidationEngine test loads real jsdom→parse5(ESM) chain causing 4GB heap exhaustion
    '<rootDir>/test/validation/ValidationEngine.test.ts',
    // Timer/concurrency heavy tests that require real time — belong in integration suite
    '<rootDir>/test/queue/QueueManager.test.ts',
    '<rootDir>/test/rate-limiting/AutotaskRateLimiter.test.ts',
    '<rootDir>/test/caching/cache-system.test.ts',
  ],

  // Setup files - CRITICAL: Network blocking must come first
  setupFilesAfterEnv: [
    '<rootDir>/test/setup/networkBlock.ts',
    '<rootDir>/test/setup.ts',
  ],

  // Coverage settings
  collectCoverage: false,
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts', '!src/**/*.test.ts'],

  // Module resolution
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },

  // Transform settings
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.json',
        // Downgrade TS type errors in test files to warnings so tests can run
        diagnostics: { warnOnly: true },
      },
    ],
  },

  // Clear mocks between tests
  clearMocks: true,
  restoreMocks: true,

  // Error handling
  errorOnDeprecated: true,

  // Display name for this configuration
  displayName: {
    name: 'Unit Tests',
    color: 'green',
  },

  // Timeout for unit tests
  testTimeout: 10000,

  // CRITICAL: Single worker to prevent concurrent API calls
  maxWorkers: 1,

  // Verbose output
  verbose: false,
};

module.exports = config;
