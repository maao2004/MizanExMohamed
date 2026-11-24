/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  X,
  Shield,
  CheckCircle2,
  AlertCircle,
  Loader2,
  KeyRound,
  UserCheck,
  Building2,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { UserRole } from '../types';

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  requiredRole?: UserRole;
  titleMessage?: string;
}

export const LoginModal: React.FC<LoginModalProps> = ({
  isOpen,
  onClose,
  requiredRole,
  titleMessage,
}) => {
  const { signInWithGoogle, signInWithApple, signInWithDemo, error } = useAuth();
  const [loadingProvider, setLoadingProvider] = useState<'google' | 'apple' | 'demo' | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleGoogleLogin = async () => {
    setLoadingProvider('google');
    setLocalError(null);
    try {
      await signInWithGoogle();
      onClose();
    } catch (err: any) {
      if (err.code !== 'auth/popup-closed-by-user') {
        setLocalError(err.message || 'تعذر تسجيل الدخول بحساب Google');
      }
    } finally {
      setLoadingProvider(null);
    }
  };

  const handleAppleLogin = async () => {
    setLoadingProvider('apple');
    setLocalError(null);
    try {
      await signInWithApple();
      onClose();
    } catch (err: any) {
      if (err.code !== 'auth/popup-closed-by-user') {
        setLocalError(err.message || 'تعذر تسجيل الدخول بحساب Apple');
      }
    } finally {
      setLoadingProvider(null);
    }
  };

  const handleDemoLogin = async (role: UserRole) => {
    setLoadingProvider('demo');
    setLocalError(null);
    try {
      await signInWithDemo(role);
      onClose();
    } catch (err: any) {
      setLocalError(err.message || 'فشل تسجيل الدخول التجريبي');
    } finally {
      setLoadingProvider(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden text-slate-100 flex flex-col">
        
        {/* Header */}
        <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-950/90 border border-emerald-800/80 flex items-center justify-center text-emerald-400">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-white">تسجيل الدخول إلى منصة ميزان</h3>
              <p className="text-[11px] text-slate-400 font-mono">Firebase Authentication & RBAC</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 text-xs">
          {titleMessage ? (
            <div className="p-3 rounded-xl bg-amber-950/40 border border-amber-800/60 text-amber-300 flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 text-amber-400 mt-0.5" />
              <span>{titleMessage}</span>
            </div>
          ) : (
            <p className="text-slate-400 leading-relaxed text-xs">
              سجل الدخول بحسابك للوصول إلى أدوات التدقيق المحاسبي المتقدم، وحفظ التعديلات في قاعدة بيانات Firestore، وإدارة المحفظة الاستثمارية.
            </p>
          )}

          {(localError || error) && (
            <div className="p-3 rounded-xl bg-red-950/60 border border-red-800 text-red-300 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
              <span>{localError || error}</span>
            </div>
          )}

          {/* Provider Login Buttons */}
          <div className="space-y-2.5 pt-1">
            {/* Google Sign In */}
            <button
              type="button"
              onClick={handleGoogleLogin}
              disabled={loadingProvider !== null}
              className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-xl font-semibold bg-white text-slate-900 hover:bg-slate-100 transition-all shadow-md disabled:opacity-50"
            >
              {loadingProvider === 'google' ? (
                <Loader2 className="w-4 h-4 animate-spin text-slate-700" />
              ) : (
                <svg className="w-4 h-4" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                  />
                </svg>
              )}
              <span className="text-xs sm:text-sm font-bold">تسجيل الدخول بواسطة Google</span>
            </button>

            {/* Apple Sign In */}
            <button
              type="button"
              onClick={handleAppleLogin}
              disabled={loadingProvider !== null}
              className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-xl font-semibold bg-black text-white hover:bg-slate-900 border border-slate-700 transition-all shadow-md disabled:opacity-50"
            >
              {loadingProvider === 'apple' ? (
                <Loader2 className="w-4 h-4 animate-spin text-white" />
              ) : (
                <svg className="w-4 h-4 fill-current" viewBox="0 0 170 170">
                  <path d="M150.37 130.25c-2.45 5.66-5.35 10.87-8.71 15.66-4.58 6.53-8.33 11.05-11.22 13.56-4.48 4.12-9.28 6.23-14.42 6.35-3.69 0-8.14-1.05-13.32-3.18-5.19-2.12-9.97-3.17-14.34-3.17-4.58 0-9.49 1.05-14.75 3.17-5.26 2.13-9.5 3.24-12.74 3.35-4.35.13-9.16-1.9-14.42-6.08-3.69-3.04-7.69-7.84-12-14.41-6.19-9.46-11.03-20.2-14.52-32.22-3.48-12.02-5.23-23.36-5.23-34.02 0-16.14 4.08-29.35 12.24-39.63 8.16-10.28 18.25-15.5 30.27-15.66 4.9 0 10.15 1.25 15.75 3.76 5.6 2.5 9.4 3.81 11.4 3.92 1.62-.11 5.69-1.47 12.21-4.08 6.52-2.61 12.23-3.81 17.13-3.6 12.73.65 22.95 5.66 30.65 15.02-11.09 6.75-16.52 16.03-16.3 27.83.22 9.24 3.8 17.06 10.76 23.47 6.96 6.42 15.34 10.02 25.13 10.81-2.07 6.42-4.68 12.82-7.84 19.22zm-35.03-109.83c0-7.39 2.61-14.45 7.83-21.19 5.22-6.74 11.85-11.09 19.89-13.06.33 1.3.49 2.6.49 3.91 0 7.28-2.77 14.44-8.31 21.48-5.54 7.04-12.28 11.27-20.22 12.69-.43-1.3-.68-2.58-.68-3.83z" />
                </svg>
              )}
              <span className="text-xs sm:text-sm font-bold">تسجيل الدخول بواسطة Apple</span>
            </button>
          </div>

          {/* Quick Demo Switcher (For local testing & preview) */}
          {import.meta.env.DEV && (
            <div className="pt-3 border-t border-slate-800">
              <span className="text-[11px] text-slate-400 font-semibold block mb-2">
                أو تجربة سريعة بالأدوار المتاحة (Fast Demo Roles):
              </span>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => handleDemoLogin('admin')}
                  className="px-2.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-emerald-400 font-semibold text-center transition-colors"
                >
                  <KeyRound className="w-3.5 h-3.5 mx-auto mb-1" />
                  <span>مدير (Admin)</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleDemoLogin('data_entry')}
                  className="px-2.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-teal-400 font-semibold text-center transition-colors"
                >
                  <UserCheck className="w-3.5 h-3.5 mx-auto mb-1" />
                  <span>مدخل بيانات</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleDemoLogin('subscriber')}
                  className="px-2.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sky-400 font-semibold text-center transition-colors"
                >
                  <Building2 className="w-3.5 h-3.5 mx-auto mb-1" />
                  <span>مشترك</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 bg-slate-950/80 border-t border-slate-800 text-[10px] text-slate-400 flex items-center justify-between">
          <span className="flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            اتصال مشفر وآمن عبر Google Cloud & Firebase
          </span>
          <span className="font-mono text-slate-500">v2.5 Enterprise</span>
        </div>
      </div>
    </div>
  );
};
