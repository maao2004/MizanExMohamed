/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Strict safety harness for Firestore Emulator integration and security-rules tests.
 *
 * Invariants:
 * 1. MUST verify `FIRESTORE_EMULATOR_HOST` BEFORE instantiating any SDK/client.
 * 2. MUST refuse any non-`demo-*` project ID to make production fallback impossible.
 * 3. NEVER skips silently when invoked — missing emulator is a hard test failure.
 * 4. Cleans up ONLY the isolated emulator database and closes all apps/clients.
 */

import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { FieldPath, FieldValue, getFirestore, type Firestore } from 'firebase-admin/firestore';

export interface EmulatorHostInfo {
  raw: string;
  host: string;
  port: number;
  projectId: string;
}

export function assertFirestoreEmulatorReady(preferredProjectId?: string): EmulatorHostInfo {
  const raw = (process.env.FIRESTORE_EMULATOR_HOST || '').trim();
  if (!raw) {
    throw new Error(
      '[EMULATOR_BLOCKER] FIRESTORE_EMULATOR_HOST is not set. ' +
        'Run via `npm run test:emulator` with Java + Firestore Emulator installed. ' +
        'Refusing to fall back to production or report a fake pass.'
    );
  }

  const lastColon = raw.lastIndexOf(':');
  const host = lastColon > 0 ? raw.slice(0, lastColon).trim() : '';
  const port = lastColon > 0 ? Number(raw.slice(lastColon + 1).trim()) : NaN;
  if (!host || !Number.isInteger(port) || port <= 0) {
    throw new Error(
      `[EMULATOR_BLOCKER] Invalid FIRESTORE_EMULATOR_HOST="${raw}". Expected "<host>:<port>" (e.g. 127.0.0.1:8080).`
    );
  }

  const projectId = (
    preferredProjectId ||
    process.env.MIZANEX_EMULATOR_PROJECT_ID ||
    'demo-mizanex-test'
  ).trim();
  if (!projectId.startsWith('demo-')) {
    throw new Error(
      `[EMULATOR_SAFETY] Refusing to run emulator test against non-demo projectId "${projectId}". Project ID MUST start with "demo-".`
    );
  }

  return { raw, host, port, projectId };
}

export async function clearEmulatorFirestoreData(info: EmulatorHostInfo): Promise<void> {
  if (!info.projectId.startsWith('demo-')) {
    throw new Error(`[EMULATOR_SAFETY] Refusing to clear non-demo project "${info.projectId}".`);
  }
  const url = `http://${info.host}:${info.port}/emulator/v1/projects/${encodeURIComponent(
    info.projectId
  )}/databases/(default)/documents`;
  const res = await fetch(url, { method: 'DELETE' });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `Failed to clear Firestore Emulator data at ${url}: HTTP ${res.status} ${body}`
    );
  }
}

export interface EmulatorAdminContext {
  info: EmulatorHostInfo;
  app: App;
  db: Firestore;
  FieldPath: typeof FieldPath;
  FieldValue: typeof FieldValue;
  resetDatabase: () => Promise<void>;
  cleanup: () => Promise<void>;
}

export function createEmulatorAdminContext(suiteSlug: string): EmulatorAdminContext {
  const info = assertFirestoreEmulatorReady(`demo-mizanex-${suiteSlug}`);
  const appName = `mizanex-emu-${suiteSlug}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const app = initializeApp({ projectId: info.projectId }, appName);
  const db = getFirestore(app);

  return {
    info,
    app,
    db,
    FieldPath,
    FieldValue,
    resetDatabase: async () => {
      await clearEmulatorFirestoreData(info);
    },
    cleanup: async () => {
      try {
        await clearEmulatorFirestoreData(info);
      } finally {
        await deleteApp(app);
      }
    },
  };
}
