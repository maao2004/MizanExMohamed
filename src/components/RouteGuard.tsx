/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Lock, ShieldAlert, LogIn, ArrowRight } from 'lucide-react';
import { UserRole } from '../types';

interface RouteGuardProps {
  requiredRoleName: string;
  requiredRole: UserRole;
  currentRole?: UserRole;
  isLoggedIn: boolean;
  onOpenLogin: () => void;
  onSwitchToRequired?: () => void;
  onNavigateHome: () => void;
}

export const RouteGuard: React.FC<RouteGuardProps> = ({
  requiredRoleName,
  requiredRole,
  currentRole,
  isLoggedIn,
  onOpenLogin,
  onSwitchToRequired,
  onNavigateHome,
}) => {
  return (
    <div className="min-h-[60vh] flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 max-w-lg w-full text-center shadow-2xl space-y-6">
        <div className="w-16 h-16 rounded-2xl bg-amber-950/60 border border-amber-800/80 flex items-center justify-center text-amber-400 mx-auto shadow-lg shadow-amber-950/30">
          <Lock className="w-8 h-8" />
        </div>

        <div className="space-y-2">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-950/80 text-amber-300 border border-amber-800 text-xs font-semibold">
            <ShieldAlert className="w-3.5 h-3.5" />
            حماية المسارات (Route Protection)
          </div>
          <h2 className="text-xl sm:text-2xl font-bold text-white">
            هذا القسم محمي ويتطلب صلاحية ({requiredRoleName})
          </h2>
          <p className="text-xs text-slate-400 leading-relaxed">
            {isLoggedIn
              ? `أنت مسجل حالياً بصلاحية [${currentRole || 'مستخدم'}]، بينما تتطلب هذه الشاشة صلاحية [${requiredRoleName}] لضمان سلامة العمليات المحاسبية والتعديل السحابي.`
              : 'الوصول إلى هذه الشاشة الحساسة مقصور على الحسابات المصرح لها. يرجى تسجيل الدخول بحساب Google أو Apple لمتابعة العمل.'}
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
          {!isLoggedIn ? (
            <button
              type="button"
              onClick={onOpenLogin}
              className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-lg shadow-emerald-950/50 transition-all"
            >
              <LogIn className="w-4 h-4" />
              <span>تسجيل الدخول الآن</span>
            </button>
          ) : onSwitchToRequired ? (
            <button
              type="button"
              onClick={onSwitchToRequired}
              className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-lg shadow-emerald-950/50 transition-all"
            >
              <span>الترقية إلى صلاحية {requiredRoleName} (تجريبي)</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onOpenLogin}
              className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-lg shadow-emerald-950/50 transition-all"
            >
              <LogIn className="w-4 h-4" />
              <span>تبديل الحساب</span>
            </button>
          )}

          <button
            type="button"
            onClick={onNavigateHome}
            className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs border border-slate-700 transition-colors"
          >
            <ArrowRight className="w-4 h-4" />
            <span>العودة للوحة التحكم</span>
          </button>
        </div>
      </div>
    </div>
  );
};
