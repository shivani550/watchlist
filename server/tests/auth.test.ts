import http from 'http';
import app from '../src/app.js';
import { pool } from '../src/db/pool.js';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];

async function assert(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    results.push({ name, passed: true });
    console.log(`  ✅ PASS: ${name}`);
  } catch (err: any) {
    results.push({ name, passed: false, error: err.message });
    console.error(`  ❌ FAIL: ${name} -> ${err.message}`);
  }
}

const TEST_PORT = 5009;

async function request(
  method: string,
  path: string,
  body?: any,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const jsonBody = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        hostname: 'localhost',
        port: TEST_PORT,
        path,
        method,
        headers: {
          ...(jsonBody
            ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(jsonBody),
              }
            : {}),
          ...headers,
        },
      },
      (res) => {
        let rawData = '';
        res.on('data', (chunk) => (rawData += chunk));
        res.on('end', () => {
          let parsedBody: any;
          try {
            parsedBody = rawData ? JSON.parse(rawData) : {};
          } catch {
            parsedBody = rawData;
          }
          resolve({ status: res.statusCode || 500, body: parsedBody });
        });
      }
    );

    req.on('error', reject);
    if (jsonBody) req.write(jsonBody);
    req.end();
  });
}

async function runTests() {
  console.log('\n🧪 Running Batch 2 Authentication Test Suite...\n');

  const randomSuffix = Math.floor(Math.random() * 1000000);
  const userAEmail = `alice_${randomSuffix}@example.com`;
  const userAPassword = 'Password123!';
  const userBEmail = `bob_${randomSuffix}@example.com`;
  const userBPassword = 'SecurePassword456!';

  let tokenA = '';
  let userAId = '';
  let tokenB = '';
  let userBId = '';

  // 1. Validation error: Malformed email
  await assert('Reject registration with malformed email', async () => {
    const res = await request('POST', '/api/auth/register', {
      email: 'not-an-email',
      password: 'ValidPassword123!',
    });
    if (res.status !== 400) throw new Error(`Expected status 400, got ${res.status}`);
  });

  // 2. Validation error: Password too short
  await assert('Reject registration with password under 8 characters', async () => {
    const res = await request('POST', '/api/auth/register', {
      email: `valid_${randomSuffix}@example.com`,
      password: 'short',
    });
    if (res.status !== 400) throw new Error(`Expected status 400, got ${res.status}`);
  });

  // 3. User Registration (User A)
  await assert('Register User A successfully with valid credentials', async () => {
    const res = await request('POST', '/api/auth/register', {
      email: userAEmail,
      password: userAPassword,
    });
    if (res.status !== 201) throw new Error(`Expected status 201, got ${res.status} (${JSON.stringify(res.body)})`);
    if (!res.body.token) throw new Error('Missing token in registration response');
    if (!res.body.user || !res.body.user.id) throw new Error('Missing user object or id in registration response');
    if (res.body.user.password_hash || res.body.user.password) {
      throw new Error('Security violation: password or password_hash leaked in response!');
    }
    tokenA = res.body.token;
    userAId = res.body.user.id;
  });

  // 4. Duplicate Email Registration
  await assert('Reject duplicate email registration with 409 Conflict', async () => {
    const res = await request('POST', '/api/auth/register', {
      email: userAEmail,
      password: 'AnotherPassword123!',
    });
    if (res.status !== 409) throw new Error(`Expected status 409, got ${res.status}`);
  });

  // 5. User Login with valid credentials
  await assert('Login User A with valid credentials', async () => {
    const res = await request('POST', '/api/auth/login', {
      email: userAEmail,
      password: userAPassword,
    });
    if (res.status !== 200) throw new Error(`Expected status 200, got ${res.status}`);
    if (!res.body.token) throw new Error('Missing token in login response');
    if (res.body.user.id !== userAId) throw new Error('User ID mismatch in login response');
    if (res.body.user.password_hash) throw new Error('Security violation: password_hash leaked in response!');
  });

  // 6. User Login with invalid password
  await assert('Reject login with invalid password (401)', async () => {
    const res = await request('POST', '/api/auth/login', {
      email: userAEmail,
      password: 'WrongPassword!',
    });
    if (res.status !== 401) throw new Error(`Expected status 401, got ${res.status}`);
  });

  // 7. User Login with non-existent email
  await assert('Reject login with non-existent email (401)', async () => {
    const res = await request('POST', '/api/auth/login', {
      email: `nonexistent_${randomSuffix}@example.com`,
      password: 'AnyPassword123!',
    });
    if (res.status !== 401) throw new Error(`Expected status 401, got ${res.status}`);
  });

  // 8. Access protected endpoint with valid token
  await assert('Access GET /api/auth/me with valid Bearer token', async () => {
    const res = await request('GET', '/api/auth/me', undefined, {
      Authorization: `Bearer ${tokenA}`,
    });
    if (res.status !== 200) throw new Error(`Expected status 200, got ${res.status}`);
    if (res.body.user.id !== userAId) throw new Error('Returned profile ID does not match User A');
    if (res.body.user.email !== userAEmail) throw new Error('Returned profile email does not match User A');
    if (res.body.user.password_hash) throw new Error('Security violation: password_hash leaked in me response!');
  });

  // 9. Reject unauthenticated request (missing token)
  await assert('Reject GET /api/auth/me when unauthenticated (missing token)', async () => {
    const res = await request('GET', '/api/auth/me');
    if (res.status !== 401) throw new Error(`Expected status 401, got ${res.status}`);
  });

  // 10. Reject corrupted/tampered token
  await assert('Reject GET /api/auth/me with tampered token', async () => {
    const res = await request('GET', '/api/auth/me', undefined, {
      Authorization: `Bearer ${tokenA}tampered`,
    });
    if (res.status !== 401) throw new Error(`Expected status 401, got ${res.status}`);
  });

  // 11. Register User B and verify strict resource isolation between User A and User B
  await assert('Register User B and verify multi-user resource isolation', async () => {
    const resB = await request('POST', '/api/auth/register', {
      email: userBEmail,
      password: userBPassword,
    });
    if (resB.status !== 201) throw new Error(`User B register failed: ${resB.status}`);
    tokenB = resB.body.token;
    userBId = resB.body.user.id;

    // Verify User B's token returns User B
    const meB = await request('GET', '/api/auth/me', undefined, {
      Authorization: `Bearer ${tokenB}`,
    });
    if (meB.body.user.id !== userBId) throw new Error('User B profile mismatch');

    // Verify User A's token returns User A, NOT User B
    const meA = await request('GET', '/api/auth/me', undefined, {
      Authorization: `Bearer ${tokenA}`,
    });
    if (meA.body.user.id !== userAId) throw new Error('User A profile mismatch');
    if (meA.body.user.id === userBId) throw new Error('Cross-user isolation failure: User A resolved as User B!');
  });

  // 12. Direct Database Check: Verify password is encrypted with bcrypt and never stored as plaintext
  await assert('Verify in PostgreSQL that password is stored as salted bcrypt hash and never plaintext', async () => {
    const { rows } = await pool.query(
      'SELECT email, password_hash FROM users WHERE id = $1;',
      [userAId]
    );
    if (rows.length === 0) throw new Error('User A not found in database');
    const hash = rows[0].password_hash;
    if (hash === userAPassword) {
      throw new Error('CRITICAL SECURITY FLAW: Password stored in plaintext!');
    }
    if (!hash.startsWith('$2a$') && !hash.startsWith('$2b$')) {
      throw new Error(`Expected bcrypt hash prefix ($2a$ or $2b$), got: ${hash.substring(0, 10)}`);
    }
  });

  // 13. Stateless Logout
  await assert('Verify stateless logout endpoint responds with 200 OK', async () => {
    const res = await request('POST', '/api/auth/logout');
    if (res.status !== 200) throw new Error(`Expected status 200, got ${res.status}`);
  });

  console.log('\n--- Test Summary ---');
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log(`Total: ${results.length} | Passed: ${passed} | Failed: ${failed}\n`);

  if (failed > 0) {
    process.exit(1);
  } else {
    console.log('🎉 All Batch 2 authentication tests passed successfully!\n');
    process.exit(0);
  }
}

// Start server on test port and run tests
const server = app.listen(TEST_PORT, async () => {
  try {
    await runTests();
  } catch (err) {
    console.error('Test run failed:', err);
    process.exit(1);
  } finally {
    server.close();
    await pool.end();
  }
});
