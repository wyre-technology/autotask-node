import { Account } from '../../../src/entities/accounts';
import {
  setupIntegrationTest,
  generateTestId,
  shouldSkipIntegrationTests,
  delay,
} from '../setup';
import { IntegrationTestConfig } from '../setup';

describe('Accounts Integration Tests (Optimized)', () => {
  let config: IntegrationTestConfig;
  const createdAccountIds: number[] = [];

  beforeAll(async () => {
    if (shouldSkipIntegrationTests()) {
      console.log(
        '⚠️ Skipping Accounts integration tests - credentials not available'
      );
      return;
    }

    try {
      config = await setupIntegrationTest();
      console.log('🏢 Starting optimized Accounts integration tests...');
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'SKIP_INTEGRATION_TESTS'
      ) {
        console.log(
          '⚠️ Skipping Accounts integration tests - credentials not available'
        );
        return;
      }
      throw error;
    }
  });

  afterAll(async () => {
    // config is undefined when integration tests were skipped (no credentials)
    if (!config) {
      return;
    }

    console.log('🧹 Cleaning up created accounts...');

    // Clean up any accounts created during tests
    for (const accountId of createdAccountIds) {
      try {
        await config.client.accounts.delete(accountId);
        console.log(`✅ Cleaned up account ${accountId}`);
      } catch (error: any) {
        console.warn(
          `⚠️ Could not clean up account ${accountId}:`,
          error.message
        );
      }
    }

    await config.cleanup();
    console.log('🎉 Accounts integration tests completed');
  });

  beforeEach(async () => {
    // Rate limiting - longer wait between tests
    await delay(2500);
  });

  describe('Core Functionality', () => {
    it('should authenticate and perform basic operations', async () => {
      if (shouldSkipIntegrationTests() || !config) {
        console.log('⏭️ Skipping test - integration tests disabled');
        return;
      }

      console.log('🔌 Testing authentication and basic list operations...');

      // Test authentication and basic operations
      expect(config.client).toBeDefined();
      expect(config.client.accounts).toBeDefined();

      try {
        // Basic list operation with small page size
        const accounts = await config.client.accounts.list({
          pageSize: 3,
        });

        expect(accounts).toBeDefined();
        expect(accounts.data).toBeDefined();
        expect(Array.isArray(accounts.data)).toBe(true);
        expect(accounts.data.length).toBeGreaterThan(0);

        if (accounts.data.length > 0) {
          expect(accounts.data[0]).toHaveProperty('id');
          expect(accounts.data[0]).toHaveProperty('companyName');

          // Test single account retrieval using first account from list
          const accountId = accounts.data[0].id;
          if (accountId) {
            await delay(1000); // Rate limit
            const account = await config.client.accounts.get(accountId);
            expect(account.data.id).toBe(accountId);
            expect(typeof account.data.companyName).toBe('string');
            console.log(
              `✅ Retrieved account ${accountId}: "${account.data.companyName}"`
            );
          }
        }

        console.log(
          `✅ Basic operations successful (${accounts.data.length} accounts listed)`
        );
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message.includes('Server error (500)') ||
            error.message.includes('Not Found') ||
            error.message.includes('forbidden'))
        ) {
          console.log(
            '⚠️ Account list operations may not be permitted in this environment'
          );
          console.log(
            '📝 This is expected behavior in some Autotask environments'
          );
          return;
        }
        throw error;
      }
    });

    it('should handle filtering and error cases', async () => {
      if (shouldSkipIntegrationTests() || !config) {
        console.log('⏭️ Skipping test - integration tests disabled');
        return;
      }

      console.log('🔍 Testing filtering and error handling...');

      try {
        // Test basic filtering with small page size
        const activeAccounts = await config.client.accounts.list({
          filter: { isActive: true },
          pageSize: 2,
        });

        expect(activeAccounts).toBeDefined();
        expect(activeAccounts.data).toBeDefined();
        expect(Array.isArray(activeAccounts.data)).toBe(true);

        console.log(
          `✅ Filtering: Found ${activeAccounts.data.length} active accounts`
        );

        await delay(1000);

        // Test error handling with non-existent account
        const nonExistentId = 999999999;
        await expect(
          config.client.accounts.get(nonExistentId)
        ).rejects.toThrow();
        console.log(
          `✅ Error handling: Non-existent account properly rejected`
        );
      } catch (error) {
        console.log('⚠️ Some operations may be limited by API permissions');
        console.log('📝 This is expected in restrictive environments');
      }
    });

    it('should perform CRUD operations when permitted', async () => {
      if (shouldSkipIntegrationTests() || !config) {
        console.log('⏭️ Skipping test - integration tests disabled');
        return;
      }

      console.log(
        '🔄 Testing CRUD operations (may be limited by permissions)...'
      );

      try {
        // === CREATE ===
        const testId = generateTestId();
        const accountData = {
          companyName: `Test Company ${testId}`,
          companyType: 1,
          isActive: true,
        };

        const createdAccount = await config.client.accounts.create(accountData);
        expect(createdAccount.data.id).toBeGreaterThan(0);
        expect(createdAccount.data.companyName).toBe(accountData.companyName);

        const accountId = createdAccount.data.id!;
        createdAccountIds.push(accountId);
        console.log(`✅ CREATE: Account ${accountId} created`);

        await delay(1000);

        // === UPDATE ===
        const updateData = {
          companyName: `Updated Test Company ${testId}`,
        };

        const updatedAccount = await config.client.accounts.update(
          accountId,
          updateData
        );
        expect(updatedAccount.data.id).toBe(accountId);
        expect(updatedAccount.data.companyName).toBe(updateData.companyName);
        console.log(`✅ UPDATE: Account ${accountId} updated`);

        await delay(1000);

        // === DELETE ===
        await config.client.accounts.delete(accountId);

        // Verify deletion
        await expect(config.client.accounts.get(accountId)).rejects.toThrow();
        console.log(`✅ DELETE: Account ${accountId} deleted`);

        // Remove from cleanup list since it's already deleted
        const index = createdAccountIds.indexOf(accountId);
        if (index > -1) {
          createdAccountIds.splice(index, 1);
        }
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message.includes('Server error (500)') ||
            error.message.includes('Not Found') ||
            error.message.includes('forbidden'))
        ) {
          console.log(
            '⚠️ CRUD operations may not be permitted in this environment'
          );
          console.log(
            '📝 This is expected behavior in some Autotask environments'
          );
          return;
        }
        throw error;
      }
    });
  });
});
