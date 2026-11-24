/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useContext, useEffect, useState, useMemo, useRef } from 'react';
import {
  User,
  onAuthStateChanged,
  signInWithPopup,
  GoogleAuthProvider,
  OAuthProvider,
  signOut as fbSignOut,
  getIdTokenResult,
} from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from '../services/firebase/firebaseConfig';
import { AppUser, UserRole, SubscriptionTier } from '../types';
import { CacheService } from '../services/storage/cacheService';
import { FirestoreService } from '../services/firebase/firestoreService';

interface AuthContextType {
  firebaseUser: User | null;
  appUser: AppUser | null;
  loading: boolean;
  error: string | null;
  signInWithGoogle: () => Promise<void>;
  signInWithApple: () => Promise<void>;
  signInWithDemo: (role?: UserRole) => Promise<void>;
  signOut: () => Promise<void>;
  switchRole: (newRole: UserRole) => void;
  isAdmin: boolean;
  isDataEntry: boolean;
  isSubscriber: boolean;
  canEditFinancials: boolean;
  canAccessAdmin: boolean;
  canExecuteTrades: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Admin bootstrap emails
const ADMIN_EMAILS = ['maao2004@gmail.com'];

export interface SessionEpochToken {
  epoch: number;
  uid: string | null;
}

export function createSessionEpochGuard() {
  let currentEpoch = 0;
  let currentUid: string | null = null;
  return {
    begin(uid: string | null): SessionEpochToken {
      currentEpoch += 1;
      currentUid = uid;
      return { epoch: currentEpoch, uid };
    },
    isCurrent(token: SessionEpochToken): boolean {
      return token.epoch === currentEpoch && token.uid === currentUid;
    },
  };
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const sessionGuardRef = useRef(createSessionEpochGuard());
  const prevUidRef = useRef<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      const nextUid = user?.uid ?? null;
      const token = sessionGuardRef.current.begin(nextUid);

      if (prevUidRef.current !== null && prevUidRef.current !== nextUid) {
        CacheService.clearSessionUser();
        FirestoreService.clearSessionCaches();
      }
      prevUidRef.current = nextUid;

      setLoading(true);
      setError(null);
      if (user) {
        setFirebaseUser(user);
        try {
          // 1. Check custom claims & server-side admin grant
          const tokenResult = await getIdTokenResult(user, true);
          if (!sessionGuardRef.current.isCurrent(token)) return;

          const claimRole = (tokenResult.claims.role as UserRole) || undefined;
          const isAdminClaim = Boolean(tokenResult.claims.admin);
          let hasAdminGrant = false;
          try {
            const adminGrant = await getDoc(doc(db, 'admins', user.uid));
            if (!sessionGuardRef.current.isCurrent(token)) return;
            hasAdminGrant = adminGrant.exists();
          } catch (e) {
            console.warn('Admin grant lookup skipped/denied:', e);
          }

          // 2. Fetch or create Firestore user profile doc (/users/{uid})
          const userDocRef = doc(db, 'users', user.uid);
          let userDocSnap;
          try {
            userDocSnap = await getDoc(userDocRef);
            if (!sessionGuardRef.current.isCurrent(token)) return;
          } catch (e) {
            console.warn('Firestore user fetch offline/fallback', e);
          }

          let resolvedRole: UserRole = 'subscriber';
          let resolvedTier: SubscriptionTier = 'free';

          const isBootstrappedAdmin =
            isAdminClaim ||
            hasAdminGrant ||
            (user.emailVerified && !!user.email && ADMIN_EMAILS.includes(user.email.toLowerCase()));

          if (userDocSnap && userDocSnap.exists()) {
            const data = userDocSnap.data();
            resolvedRole =
              claimRole ||
              (isBootstrappedAdmin
                ? 'admin'
                : (data.role === 'admin' ? 'data_entry' : (data.role as UserRole)) || 'subscriber');
            resolvedTier = (data.tier as SubscriptionTier) || 'free';
            if (data.isActive === false) {
              throw new Error('الحساب معطل؛ تواصل مع الإدارة.');
            }
          } else {
            // Create user document in Firestore strictly as subscriber/free
            resolvedRole = claimRole || (isBootstrappedAdmin ? 'admin' : 'subscriber');
            resolvedTier = 'free';

            try {
              await setDoc(
                userDocRef,
                {
                  id: user.uid,
                  email: user.email || '',
                  displayName: user.displayName || user.email?.split('@')[0] || 'مستخدم ميزان',
                  photoURL: user.photoURL || '',
                  role: 'subscriber',
                  tier: 'free',
                  isActive: true,
                  createdAt: new Date().toISOString(),
                  lastLoginAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                },
                { merge: true }
              );
              if (!sessionGuardRef.current.isCurrent(token)) return;
            } catch (err) {
              console.warn('Could not write user profile to Firestore (using local state)', err);
            }
          }

          if (!sessionGuardRef.current.isCurrent(token)) return;

          const profile: AppUser = {
            id: user.uid,
            email: user.email || '',
            displayName: user.displayName || user.email?.split('@')[0] || 'مستخدم ميزان',
            role: resolvedRole,
            tier: resolvedTier,
            isActive: true,
            createdAt: user.metadata.creationTime || new Date().toISOString(),
            lastLoginAt: new Date().toISOString(),
          };

          setAppUser(profile);
          CacheService.setCurrentUser(profile);
        } catch (err: any) {
          if (!sessionGuardRef.current.isCurrent(token)) return;
          console.error('Error resolving user auth details:', err);
          setAppUser(null);
          setError(err.message || 'حدث خطأ أثناء تحميل بيانات المستخدم');
        }
      } else {
        setFirebaseUser(null);
        setAppUser(null);
        CacheService.clearSessionUser();
        FirestoreService.clearSessionCaches();
      }
      if (sessionGuardRef.current.isCurrent(token)) {
        setLoading(false);
      }
    });

    return () => {
      sessionGuardRef.current.begin(null);
      unsubscribe();
    };
  }, []);

  // Google Sign-In with Popup
  const signInWithGoogle = async () => {
    setError(null);
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(auth, provider);
    } catch (err: any) {
      console.error('Google Sign-In Error:', err);
      // Don't show error if user closed the popup
      if (err.code !== 'auth/popup-closed-by-user') {
        setError(err.message || 'تعذر تسجيل الدخول بواسطة Google');
      }
      throw err;
    }
  };

  // Apple Sign-In with Popup
  const signInWithApple = async () => {
    setError(null);
    try {
      const provider = new OAuthProvider('apple.com');
      provider.addScope('email');
      provider.addScope('name');
      await signInWithPopup(auth, provider);
    } catch (err: any) {
      console.error('Apple Sign-In Error:', err);
      if (err.code !== 'auth/popup-closed-by-user') {
        setError(err.message || 'تعذر تسجيل الدخول بواسطة Apple');
      }
      throw err;
    }
  };

  // Demo Sign-In (Local rapid switching for review & development)
  const signInWithDemo = async (role: UserRole = 'admin') => {
    if (!import.meta.env.DEV || auth.currentUser) {
      throw new Error('الوضع التجريبي متاح محلياً دون جلسة حقيقية فقط.');
    }
    setError(null);
    const demoUser: AppUser = {
      id: `demo_${role}_${Date.now()}`,
      email: role === 'admin' ? 'admin@mizan.eg' : role === 'data_entry' ? 'entry@mizan.eg' : 'subscriber@egx.eg',
      displayName:
        role === 'admin'
          ? 'مدير المنصة (Admin Demo)'
          : role === 'data_entry'
          ? 'مدخل بيانات (Data Entry Demo)'
          : 'مشترك استثماري (Subscriber Demo)',
      role,
      tier: role === 'admin' ? 'institutional' : 'gold',
      isActive: true,
      createdAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString(),
    };
    setAppUser(demoUser);
    CacheService.setCurrentUser(demoUser);
  };

  // Sign Out
  const signOut = async () => {
    sessionGuardRef.current.begin(null);
    prevUidRef.current = null;
    try {
      if (auth.currentUser) {
        await fbSignOut(auth);
      }
      setFirebaseUser(null);
      setAppUser(null);
      CacheService.clearSessionUser();
      FirestoreService.clearSessionCaches();
    } catch (err: any) {
      console.error('Sign Out Error:', err);
      setError(err.message || 'حدث خطأ أثناء تسجيل الخروج');
    }
  };

  // Switch role (Demo mode only)
  const switchRole = (newRole: UserRole) => {
    if (!import.meta.env.DEV || auth.currentUser || !appUser?.id.startsWith('demo_')) return;
    const updated: AppUser = { ...appUser, role: newRole };
    setAppUser(updated);
    CacheService.setCurrentUser(updated);
  };

  // Derived authorization permissions
  const isAdmin = useMemo(() => appUser?.role === 'admin', [appUser]);
  const isDataEntry = useMemo(() => appUser?.role === 'data_entry', [appUser]);
  const isSubscriber = useMemo(() => appUser?.role === 'subscriber' || appUser?.role === 'admin', [appUser]);
  const canEditFinancials = useMemo(() => appUser?.role === 'admin' || appUser?.role === 'data_entry', [appUser]);
  const canAccessAdmin = useMemo(() => appUser?.role === 'admin', [appUser]);
  const canExecuteTrades = useMemo(() => appUser?.role === 'admin', [appUser]);

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        appUser,
        loading,
        error,
        signInWithGoogle,
        signInWithApple,
        signInWithDemo,
        signOut,
        switchRole,
        isAdmin,
        isDataEntry,
        isSubscriber,
        canEditFinancials,
        canAccessAdmin,
        canExecuteTrades,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
