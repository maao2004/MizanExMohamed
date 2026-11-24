/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Real Firestore Security Rules Emulator Test Suite (`@firebase/rules-unit-testing`).
 *
 * Verifies `/firestore.rules` directly against the local Firestore Emulator with
 * real authenticated & unauthenticated client contexts aligned with `src/context/AuthContext.tsx`:
 * - Unauthenticated client
 * - Active subscriber (`role: 'subscriber', tier: 'free', isActive: true`)
 * - Active data_entry (`role: 'data_entry', tier: 'free', isActive: true`)
 * - Active admin (`role: 'admin', isActive: true` + `admins/{uid}` + custom claim `admin: true`)
 * - Inactive user (`role: 'subscriber', isActive: false`)
 *
 * Policy notes verified against `firestore.rules` and `src/context/AuthContext.tsx`:
 * - `users/{userId}` uses `id` (matching `userId`), NOT `uid`.
 *   Allowed keys on self-create: `id`, `email`, `displayName`, `photoURL`, `role`, `tier`,
 *   `isActive`, `createdAt`, `lastLoginAt`, `updatedAt`.
 * - `admins/{adminId}` currently allows `read` for any active authenticated user (`isAuthenticated()`)
 *   because `AuthContext.tsx` performs `getDoc(doc(db, 'admins', user.uid))` during sign-in;
 *   `write` is strictly restricted to `isAdmin()`.
 *   (Tightening `admins/{adminId}` read to `request.auth.uid == adminId || isAdmin()` is tracked
 *   separately as a future security-hardening proposal and is intentionally NOT altered in this batch.)
 * - Client SDK writes & reads ARE strictly governed by `firestore.rules` and verified here.
 * - Admin SDK (used by Cloud Functions & administrative scripts) bypasses client rules by design.
 * - Deployed Cloud Functions authorization (`onCall` role checks) requires separate Functions testing.
 */

import { after, before, beforeEach, describe, it } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { assertFirestoreEmulatorReady } from './emulatorHarness';

const PROTECTED_FINANCIAL_AND_GOVERNANCE_PATHS: Array<{ label: string; segments: string[] }> = [
  { label: 'companies', segments: ['companies', 'comi'] },
  { label: 'financials', segments: ['financials', 'comi_2025_FY'] },
  { label: 'quarterly_financial_records', segments: ['quarterly_financial_records', 'COMI_2025_FY'] },
  { label: 'daily_trading_records', segments: ['daily_trading_records', 'COMI_2026-04-20'] },
  { label: 'daily_trading_schemas', segments: ['daily_trading_schemas', 'schema_v1'] },
  { label: 'stories', segments: ['stories', 'comi'] },
  { label: 'decisions', segments: ['decisions', 'comi'] },
  { label: 'trades', segments: ['trades', 'trade_1'] },
  { label: 'macro_params', segments: ['macro_params', 'Rf_Egypt_10Y'] },
  { label: 'sectorPE', segments: ['sectorPE', 'banks'] },
  { label: 'beta_assumptions', segments: ['beta_assumptions', 'COMI'] },
  { label: 'dividend_records', segments: ['dividend_records', 'COMI_2025_1'] },
  { label: 'dividend_year_statuses', segments: ['dividend_year_statuses', 'COMI_2025'] },
  { label: 'dividend_year_locks', segments: ['dividend_year_locks', 'COMI_2025'] },
  { label: 'company_assumptions', segments: ['company_assumptions', 'COMI'] },
  {
    label: 'company_assumptions/{ticker}/parameters/{key}',
    segments: ['company_assumptions', 'COMI', 'parameters', 'Target_PE'],
  },
  { label: 'import_batches', segments: ['import_batches', 'batch_1'] },
  {
    label: 'real_estate_disclosures',
    segments: ['real_estate_disclosures', 'TMGH_2025_FY_consolidated_inv_prop_total'],
  },
  { label: 'tombstones', segments: ['tombstones', 'sectorPE__old'] },
];

const SUBSCRIBER_READABLE_PATHS = PROTECTED_FINANCIAL_AND_GOVERNANCE_PATHS.filter(
  (p) =>
    p.label !== 'import_batches' &&
    p.label !== 'real_estate_disclosures' &&
    p.label !== 'dividend_year_locks'
);

/**
 * Builds a valid user profile document matching the exact contract written by
 * `src/context/AuthContext.tsx` and validated by `firestore.rules` (`match /users/{userId}`).
 */
function buildValidSelfCreateUserDoc(
  userId: string,
  email: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: userId,
    email,
    displayName: 'Fresh User',
    photoURL: '',
    role: 'subscriber',
    tier: 'free',
    isActive: true,
    createdAt: '2026-05-10T00:00:00.000Z',
    lastLoginAt: '2026-05-10T00:00:00.000Z',
    updatedAt: '2026-05-10T00:00:00.000Z',
    ...overrides,
  };
}

describe('Real Firestore Emulator — firestore.rules Security Enforcement (@firebase/rules-unit-testing)', () => {
  let testEnv: RulesTestEnvironment;

  before(async () => {
    const info = assertFirestoreEmulatorReady('demo-mizanex-rules');
    const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
    const rules = fs.readFileSync(rulesPath, 'utf8');

    testEnv = await initializeTestEnvironment({
      projectId: info.projectId,
      firestore: {
        host: info.host,
        port: info.port,
        rules,
      },
    });
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();

    // Seed accounts & baseline docs via rules-disabled setup (mirrors Admin SDK seeding without weakening rules)
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'users', 'sub-uid'), {
        id: 'sub-uid',
        email: 'sub@example.com',
        displayName: 'Subscriber',
        photoURL: '',
        role: 'subscriber',
        tier: 'free',
        isActive: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        lastLoginAt: '2026-05-01T00:00:00.000Z',
        updatedAt: '2026-05-01T00:00:00.000Z',
      });
      await setDoc(doc(db, 'users', 'entry-uid'), {
        id: 'entry-uid',
        email: 'entry@example.com',
        displayName: 'Data Entry',
        photoURL: '',
        role: 'data_entry',
        tier: 'free',
        isActive: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        lastLoginAt: '2026-05-01T00:00:00.000Z',
        updatedAt: '2026-05-01T00:00:00.000Z',
      });
      await setDoc(doc(db, 'users', 'admin-uid'), {
        id: 'admin-uid',
        email: 'admin@example.com',
        displayName: 'Admin',
        photoURL: '',
        role: 'admin',
        tier: 'institutional',
        isActive: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        lastLoginAt: '2026-05-01T00:00:00.000Z',
        updatedAt: '2026-05-01T00:00:00.000Z',
      });
      await setDoc(doc(db, 'admins', 'admin-uid'), {
        id: 'admin-uid',
        email: 'admin@example.com',
        grantedAt: '2026-01-01T00:00:00.000Z',
      });
      await setDoc(doc(db, 'users', 'inactive-uid'), {
        id: 'inactive-uid',
        email: 'inactive@example.com',
        displayName: 'Suspended User',
        photoURL: '',
        role: 'subscriber',
        tier: 'free',
        isActive: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        lastLoginAt: '2026-05-01T00:00:00.000Z',
        updatedAt: '2026-05-01T00:00:00.000Z',
      });

      for (const entry of PROTECTED_FINANCIAL_AND_GOVERNANCE_PATHS) {
        await setDoc(doc(db, ...(entry.segments as [string, ...string[]])), {
          seeded: true,
          updatedAt: '2026-05-01T00:00:00.000Z',
        });
      }
    });
  });

  after(async () => {
    if (testEnv) {
      await testEnv.cleanup();
    }
  });

  it('denies direct client writes (create, update, delete) across ALL financial and governance collections — even for admin and data_entry clients', async () => {
    const clients = [
      { name: 'unauthenticated', db: testEnv.unauthenticatedContext().firestore() },
      { name: 'subscriber', db: testEnv.authenticatedContext('sub-uid').firestore() },
      {
        name: 'data_entry',
        db: testEnv.authenticatedContext('entry-uid', { role: 'data_entry' }).firestore(),
      },
      {
        name: 'admin',
        db: testEnv.authenticatedContext('admin-uid', { admin: true, role: 'admin' }).firestore(),
      },
      { name: 'inactive', db: testEnv.authenticatedContext('inactive-uid').firestore() },
    ];

    for (const client of clients) {
      for (const target of PROTECTED_FINANCIAL_AND_GOVERNANCE_PATHS) {
        const ref = doc(client.db, ...(target.segments as [string, ...string[]]));
        await assertFails(
          setDoc(ref, { tamperedBy: client.name }, { merge: true })
        );
        await assertFails(
          updateDoc(ref, { tamperedBy: client.name })
        );
        await assertFails(deleteDoc(ref));
      }
    }
  });

  it('enforces read access: active subscribers read financial collections; unauthenticated & inactive users denied; import_batches restricted to data_entry/admin; dividend_year_locks denied to all clients', async () => {
    const unauthDb = testEnv.unauthenticatedContext().firestore();
    const subDb = testEnv.authenticatedContext('sub-uid').firestore();
    const entryDb = testEnv.authenticatedContext('entry-uid', { role: 'data_entry' }).firestore();
    const adminDb = testEnv.authenticatedContext('admin-uid', { admin: true, role: 'admin' }).firestore();
    const inactiveDb = testEnv.authenticatedContext('inactive-uid').firestore();

    for (const target of SUBSCRIBER_READABLE_PATHS) {
      const segs = target.segments as [string, ...string[]];
      await assertFails(getDoc(doc(unauthDb, ...segs)));
      await assertFails(getDoc(doc(inactiveDb, ...segs)));
      await assertSucceeds(getDoc(doc(subDb, ...segs)));
      await assertSucceeds(getDoc(doc(entryDb, ...segs)));
      await assertSucceeds(getDoc(doc(adminDb, ...segs)));
    }

    // import_batches: data_entry and admin ONLY (subscriber, inactive, unauthenticated denied)
    await assertFails(getDoc(doc(unauthDb, 'import_batches', 'batch_1')));
    await assertFails(getDoc(doc(inactiveDb, 'import_batches', 'batch_1')));
    await assertFails(getDoc(doc(subDb, 'import_batches', 'batch_1')));
    await assertSucceeds(getDoc(doc(entryDb, 'import_batches', 'batch_1')));
    await assertSucceeds(getDoc(doc(adminDb, 'import_batches', 'batch_1')));

    // real_estate_disclosures: data_entry and admin ONLY (subscriber, inactive, unauthenticated denied)
    const reDocId = 'TMGH_2025_FY_consolidated_inv_prop_total';
    await assertFails(getDoc(doc(unauthDb, 'real_estate_disclosures', reDocId)));
    await assertFails(getDoc(doc(inactiveDb, 'real_estate_disclosures', reDocId)));
    await assertFails(getDoc(doc(subDb, 'real_estate_disclosures', reDocId)));
    await assertSucceeds(getDoc(doc(entryDb, 'real_estate_disclosures', reDocId)));
    await assertSucceeds(getDoc(doc(adminDb, 'real_estate_disclosures', reDocId)));

    // dividend_year_locks: server-only (DENIED to every client including admin)
    await assertFails(getDoc(doc(unauthDb, 'dividend_year_locks', 'COMI_2025')));
    await assertFails(getDoc(doc(subDb, 'dividend_year_locks', 'COMI_2025')));
    await assertFails(getDoc(doc(entryDb, 'dividend_year_locks', 'COMI_2025')));
    await assertFails(getDoc(doc(adminDb, 'dividend_year_locks', 'COMI_2025')));
  });

  it('allows valid self-create on users/{userId} matching AuthContext contract (using id == userId) and rejects single-field privilege escalation, mismatched id/email, or unexpected keys', async () => {
    const email = 'fresh@example.com';
    const newUserDb = testEnv
      .authenticatedContext('fresh-uid', { email })
      .firestore();

    // 1) Single-field privilege escalation attempts on OTHERWISE 100% VALID documents MUST be denied:
    //    Only the single targeted field differs from `buildValidSelfCreateUserDoc`.
    await assertFails(
      setDoc(
        doc(newUserDb, 'users', 'fresh-uid'),
        buildValidSelfCreateUserDoc('fresh-uid', email, { role: 'admin' })
      )
    );
    await assertFails(
      setDoc(
        doc(newUserDb, 'users', 'fresh-uid'),
        buildValidSelfCreateUserDoc('fresh-uid', email, { role: 'data_entry' })
      )
    );
    await assertFails(
      setDoc(
        doc(newUserDb, 'users', 'fresh-uid'),
        buildValidSelfCreateUserDoc('fresh-uid', email, { tier: 'institutional' })
      )
    );
    await assertFails(
      setDoc(
        doc(newUserDb, 'users', 'fresh-uid'),
        buildValidSelfCreateUserDoc('fresh-uid', email, { isActive: false })
      )
    );

    // 2) Independent test for mismatched `id` field (even when role/tier/isActive/email are valid)
    await assertFails(
      setDoc(
        doc(newUserDb, 'users', 'fresh-uid'),
        buildValidSelfCreateUserDoc('fresh-uid', email, { id: 'other-uid' })
      )
    );

    // 3) Independent test for mismatched `email` or unexpected key (e.g. legacy `uid` or `subscriptionExpiresAt`)
    await assertFails(
      setDoc(
        doc(newUserDb, 'users', 'fresh-uid'),
        buildValidSelfCreateUserDoc('fresh-uid', 'spoofed@example.com')
      )
    );
    await assertFails(
      setDoc(
        doc(newUserDb, 'users', 'fresh-uid'),
        buildValidSelfCreateUserDoc('fresh-uid', email, { uid: 'fresh-uid' })
      )
    );

    // 4) Exact valid self-create document (matching AuthContext.tsx) MUST succeed — proving the
    //    denials above were caused strictly by each targeted rule violation, not a malformed fixture!
    await assertSucceeds(
      setDoc(
        doc(newUserDb, 'users', 'fresh-uid'),
        buildValidSelfCreateUserDoc('fresh-uid', email)
      )
    );
  });

  it('enforces self-update restrictions on users/{userId} and current admins/{adminId} read/write policy', async () => {
    const unauthDb = testEnv.unauthenticatedContext().firestore();
    const inactiveDb = testEnv.authenticatedContext('inactive-uid').firestore();
    const subDb = testEnv.authenticatedContext('sub-uid', { email: 'sub@example.com' }).firestore();
    const entryDb = testEnv
      .authenticatedContext('entry-uid', { email: 'entry@example.com', role: 'data_entry' })
      .firestore();
    const adminDb = testEnv
      .authenticatedContext('admin-uid', { email: 'admin@example.com', admin: true, role: 'admin' })
      .firestore();

    // 1) Self-update allowed ONLY on displayName / photoURL / lastLoginAt / updatedAt
    await assertSucceeds(
      updateDoc(doc(subDb, 'users', 'sub-uid'), {
        displayName: 'Updated Name',
        lastLoginAt: '2026-05-10T12:00:00.000Z',
        updatedAt: '2026-05-10T12:00:00.000Z',
      })
    );

    // 2) Self-update escalation on single targeted fields (role / tier / isActive / id) MUST be denied
    await assertFails(updateDoc(doc(subDb, 'users', 'sub-uid'), { role: 'admin' }));
    await assertFails(updateDoc(doc(subDb, 'users', 'sub-uid'), { tier: 'institutional' }));
    await assertFails(updateDoc(doc(subDb, 'users', 'sub-uid'), { isActive: false }));
    await assertFails(updateDoc(doc(subDb, 'users', 'sub-uid'), { id: 'admin-uid' }));

    // 3) Non-admin CANNOT read other users or delete own/other user profiles
    await assertFails(getDoc(doc(subDb, 'users', 'entry-uid')));
    await assertFails(deleteDoc(doc(subDb, 'users', 'sub-uid')));

    // 4) Current `admins/{adminId}` policy (`allow read: if isAuthenticated(); allow write: if isAdmin();`):
    //    - Active authenticated users (subscriber / data_entry / admin) CAN read (AuthContext checks admins/{uid} on login).
    //    - Unauthenticated and inactive (`isActive: false`) users CANNOT read.
    //    - Non-admins (subscriber / data_entry / unauthenticated / inactive) CANNOT write/delete.
    await assertSucceeds(getDoc(doc(subDb, 'admins', 'sub-uid')));
    await assertSucceeds(getDoc(doc(subDb, 'admins', 'admin-uid')));
    await assertSucceeds(getDoc(doc(entryDb, 'admins', 'admin-uid')));
    await assertFails(getDoc(doc(unauthDb, 'admins', 'admin-uid')));
    await assertFails(getDoc(doc(inactiveDb, 'admins', 'admin-uid')));

    await assertFails(setDoc(doc(subDb, 'admins', 'sub-uid'), { id: 'sub-uid' }));
    await assertFails(setDoc(doc(entryDb, 'admins', 'entry-uid'), { id: 'entry-uid' }));
    await assertFails(deleteDoc(doc(subDb, 'admins', 'admin-uid')));

    // 5) Admin CAN read/manage users and write/read admins collection
    await assertSucceeds(getDoc(doc(adminDb, 'users', 'sub-uid')));
    await assertSucceeds(updateDoc(doc(adminDb, 'users', 'sub-uid'), { role: 'data_entry' }));
    await assertSucceeds(
      setDoc(doc(adminDb, 'admins', 'new-admin'), {
        id: 'new-admin',
        grantedAt: '2026-05-10T12:00:00.000Z',
      })
    );
    await assertSucceeds(getDoc(doc(adminDb, 'admins', 'new-admin')));
  });
});
