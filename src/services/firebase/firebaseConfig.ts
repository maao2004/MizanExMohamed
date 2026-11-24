/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  getFirestore,
  Firestore,
} from 'firebase/firestore';
import { getAuth, Auth } from 'firebase/auth';

const viteEnv: Record<string, string | undefined> =
  (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

export const firebaseConfig = {
  apiKey: viteEnv.VITE_FIREBASE_API_KEY || "AIzaSyAIvHwzpUhvkDoaxfSuFbyaeDJGmw6Tq_s",
  authDomain: viteEnv.VITE_FIREBASE_AUTH_DOMAIN || "mizanex.firebaseapp.com",
  projectId: viteEnv.VITE_FIREBASE_PROJECT_ID || "mizanex",
  storageBucket: viteEnv.VITE_FIREBASE_STORAGE_BUCKET || "mizanex.firebasestorage.app",
  messagingSenderId: viteEnv.VITE_FIREBASE_MESSAGING_SENDER_ID || "331975443501",
  appId: viteEnv.VITE_FIREBASE_APP_ID || "1:331975443501:web:ba08df497b61f859cce4a4",
  measurementId: viteEnv.VITE_FIREBASE_MEASUREMENT_ID || "G-0H25YGXDFF"
};

// Optional custom Firestore database ID (defaults to standard '(default)' database)
export const firestoreDatabaseId: string | undefined =
  viteEnv.VITE_FIREBASE_DATABASE_ID &&
  viteEnv.VITE_FIREBASE_DATABASE_ID !== '(default)'
    ? viteEnv.VITE_FIREBASE_DATABASE_ID
    : undefined;

// Initialize Firebase App singleton
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// Initialize Firestore with Persistent Local Cache (offline support; server confirmation uses SnapshotMetadata.fromCache)
let db: Firestore;
try {
  if (firestoreDatabaseId) {
    db = initializeFirestore(
      app,
      {
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager(),
        }),
      },
      firestoreDatabaseId
    );
  } else {
    db = initializeFirestore(app, {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
      }),
    });
  }
} catch (e) {
  // If already initialized, retrieve existing instance
  db = firestoreDatabaseId ? getFirestore(app, firestoreDatabaseId) : getFirestore(app);
}

const auth: Auth = getAuth(app);

export { app, db, auth };

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}
