#!/usr/bin/env node
/**
 * Integration connectivity probe.
 *
 * The presence of AUTOTASK_* secrets is not enough to know integration
 * tests can run: credentials may be stale/invalid, or the Autotask
 * sandbox may be returning 500s. This script performs one real
 * authenticated API call and exits:
 *   - 0  -> credentials work, integration tests should run
 *   - 1  -> credentials missing/invalid/unreachable, tests should skip
 *
 * It is intentionally dependency-light and tolerant: any failure means
 * "skip", never "fail the build".
 */
require('ts-node/register/transpile-only');

async function main() {
  const required = ['AUTOTASK_USERNAME', 'AUTOTASK_INTEGRATION_CODE', 'AUTOTASK_SECRET'];
  const missing = required.filter(v => !process.env[v]);
  if (missing.length > 0) {
    console.log(`Integration secrets not configured (missing: ${missing.join(', ')})`);
    process.exit(1);
  }

  try {
    const { AutotaskClient } = require('../src/client/AutotaskClient');
    const client = await AutotaskClient.create(
      {
        username: process.env.AUTOTASK_USERNAME,
        integrationCode: process.env.AUTOTASK_INTEGRATION_CODE,
        secret: process.env.AUTOTASK_SECRET,
        apiUrl: process.env.AUTOTASK_API_URL,
      },
      { timeout: 10000 }
    );

    // One lightweight authenticated call. If credentials are invalid the
    // Autotask API responds with a non-JSON 500/4xx and this throws.
    await client.accounts.list({ pageSize: 1 });
    console.log('Integration API connectivity OK');
    process.exit(0);
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    console.log(`Integration API not reachable with these credentials: ${msg}`);
    process.exit(1);
  }
}

main().catch(err => {
  console.log(`Integration connectivity probe error: ${err && err.message}`);
  process.exit(1);
});
