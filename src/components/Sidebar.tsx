/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  Scale,
  LayoutDashboard,
  Calculator,
  BookOpen,
  Target,
  History,
  Database,
  Sliders,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  Check,
  TrendingUp,
  X,
  Shield,
  FileSpreadsheet,
  Printer,
  PlusCircle,
  Cloud,
  RefreshCw,
  User as UserIcon,
  LogIn,
  LogOut,
} from 'lucide-react';
import { Company, UserRole, AppUser } from '../types';
import { SyncStats } from '../services/firebase/firestoreService';

export interface SidebarProps {
  companies: Company[];
  selectedCompanyId: string | null;
  onSelectCompany: (ticker: string) => void;
  activeTab: string;
  onSelectTab: (tab: string) => void;
  auditWarningCount: number;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  isMobileOpen: boolean;
  onCloseMobile: () => void;
  userRole?: UserRole;
  onSwitchRole?: (role: UserRole) => void;
  onExportExcel?: () => void;
  onPrintReport?: () => void;
  onOpenAddCompany?: () => void;
  syncStats?: SyncStats;
  onManualSync?: () => void;
  currentCompany?: Company | null;
  currentUser?: AppUser | null;
  isLoggedIn?: boolean;
  onOpenLogin?: () => void;
  onSignOut?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  companies,
  selectedCompanyId,
  onSelectCompany,
  activeTab,
  onSelectTab,
  auditWarningCount,
  isCollapsed,
  onToggleCollapse,
  isMobileOpen,
  onCloseMobile,
  userRole = 'subscriber',
  onSwitchRole,
  onExportExcel,
  onPrintReport,
  onOpenAddCompany,
  syncStats,
  onManualSync,
  currentCompany,
  currentUser,
  isLoggedIn = false,
  onOpenLogin,
  onSignOut,
}) => {
  const [isStockListOpen, setIsStockListOpen] = useState(false);

  const selectedCompany =
    currentCompany ??
    (selectedCompanyId ? companies.find((c) => c.id === selectedCompanyId || c.ticker === selectedCompanyId) || null : null);

  const navItems = [
    {
      id: 'dashboard',
      label: 'لوحة التحكم',
      enLabel: 'Dashboard',
      icon: LayoutDashboard,
      description: 'نظرة شاملة ومؤشرات TTM',
    },
    {
      id: 'valuation',
      label: 'معمل التقييم والحساسية',
      enLabel: 'Valuation & Sensitivity',
      icon: Calculator,
      description: 'نماذج DCF, DDM, RIM, Relative',
    },
    {
      id: 'story',
      label: 'قصة السهم',
      enLabel: 'Investment Story',
      icon: BookOpen,
      description: 'الخندق الاقتصادي وأطروحة الاستثمار',
    },
    {
      id: 'decision',
      label: 'مصفوفة القرار',
      enLabel: 'Decision Matrix',
      icon: Target,
      description: 'الحكم الاستثماري ونطاق الدخول',
    },
    {
      id: 'trades',
      label: 'سجل الصفقات',
      enLabel: 'Trade Log',
      icon: History,
      description: 'متابعة الصفقات المنفذة والمخططة',
    },
    {
      id: 'data',
      label: 'مركز إدارة البيانات والتدقيق',
      enLabel: 'Data Hub & Audit',
      icon: Database,
      badge: auditWarningCount > 0 ? auditWarningCount : undefined,
      description: 'استيراد إكسل وتدقيق الجودة الـ 9',
    },
    {
      id: 'admin',
      label: 'لوحة المدير والمتغيرات',
      enLabel: 'Admin & Macro',
      icon: Sliders,
      description: 'الـ 29 متغيراً ومضاعفات القطاعات',
    },
  ];

  const handleTabClick = (tabId: string) => {
    onSelectTab(tabId);
    if (isMobileOpen) {
      onCloseMobile();
    }
  };

  const showFullContent = !isCollapsed || isMobileOpen;

  return (
    <>
      {/* Mobile Backdrop Overlay */}
      {isMobileOpen && (
        <div
          onClick={onCloseMobile}
          className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-40 lg:hidden transition-opacity"
          aria-hidden="true"
        />
      )}

      {/* Main Sidebar Element */}
      <aside
        className={`fixed lg:sticky top-0 right-0 z-50 lg:z-30 h-[100dvh] lg:h-screen w-72 sm:w-80 max-w-[85vw] lg:max-w-none bg-slate-900 border-l border-slate-800 text-slate-100 flex flex-col transition-all duration-300 ease-in-out shadow-2xl lg:shadow-none select-none ${
          isMobileOpen
            ? 'translate-x-0 pointer-events-auto visible'
            : 'translate-x-full pointer-events-none invisible lg:translate-x-0 lg:pointer-events-auto lg:visible'
        } ${isCollapsed ? 'lg:w-20' : 'lg:w-64 xl:w-72'}`}
      >
        {/* Header: Logo, App Title, and Collapse/Close Button */}
        <div className="h-14 sm:h-16 flex items-center justify-between px-4 border-b border-slate-800/80 bg-slate-950/50 shrink-0">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-700 flex items-center justify-center shadow-lg shadow-emerald-500/20 text-white shrink-0">
              <Scale className="w-5 h-5" />
            </div>

            {showFullContent && (
              <div className="flex flex-col truncate">
                <div className="flex items-center gap-1.5">
                  <span className="text-base sm:text-lg font-bold tracking-tight text-white font-mono">
                    ميزان
                  </span>
                  <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-950/90 text-emerald-400 border border-emerald-800/70 font-semibold font-mono">
                    EGX
                  </span>
                </div>
                <span className="text-[10px] text-slate-400 truncate">
                  منظومة تقييم ومراجعة الأسهم
                </span>
              </div>
            )}
          </div>

          {/* Desktop Collapse Toggle Button */}
          <button
            type="button"
            onClick={onToggleCollapse}
            className="hidden lg:flex p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/80 transition-colors"
            title={isCollapsed ? 'توسيع القائمة الجانبية' : 'طي القائمة الجانبية'}
            aria-label={isCollapsed ? 'توسيع القائمة' : 'طي القائمة'}
          >
            {isCollapsed ? (
              <ChevronLeft className="w-5 h-5 text-emerald-400" />
            ) : (
              <ChevronRight className="w-5 h-5 text-slate-400 hover:text-emerald-400" />
            )}
          </button>

          {/* Mobile Close Button */}
          <button
            type="button"
            onClick={onCloseMobile}
            className="lg:hidden p-2 rounded-lg text-slate-300 hover:text-white bg-slate-800/70 hover:bg-slate-700 transition-colors"
            aria-label="إغلاق القائمة"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Navigation & Tools Area */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-2.5 py-4 space-y-5 scrollbar-thin scrollbar-thumb-slate-800">
          {/* Stock Selector Section (Moved from Top Navbar) */}
          {showFullContent ? (
            <div className="bg-slate-950/75 p-2.5 rounded-2xl border border-slate-800/90 space-y-2">
              <div className="flex items-center justify-between px-1 text-[11px] font-bold text-slate-400">
                <span>اختر السهم للتقييم</span>
                <span className="font-mono text-[10px] text-slate-400">
                  ({companies.length} أسهم)
                </span>
              </div>

              {selectedCompany ? (
                <button
                  type="button"
                  onClick={() => setIsStockListOpen((prev) => !prev)}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 bg-slate-900 hover:bg-slate-800/90 rounded-xl border border-slate-800 hover:border-emerald-600/60 transition-all text-right group"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-7 h-7 rounded-lg bg-emerald-950/70 border border-emerald-800/40 flex items-center justify-center text-emerald-400 shrink-0">
                      <TrendingUp className="w-3.5 h-3.5" />
                    </div>
                    <div className="min-w-0 text-right">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-bold text-xs text-emerald-400 shrink-0">
                          {selectedCompany.ticker}
                        </span>
                        <span className="text-slate-300 text-xs truncate">
                          {selectedCompany.nameAr}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-400 font-mono">
                        {selectedCompany.marketPrice !== null
                          ? `${selectedCompany.marketPrice.toFixed(2)} ج.م`
                          : 'السعر غير متاح'}
                      </div>
                    </div>
                  </div>
                  <ChevronDown
                    className={`w-4 h-4 text-slate-400 group-hover:text-emerald-400 transition-transform shrink-0 ${
                      isStockListOpen ? 'rotate-180 text-emerald-400' : ''
                    }`}
                  />
                </button>
              ) : (
                <div className="px-3 py-2.5 rounded-xl bg-slate-900/70 border border-slate-800 text-[11px] text-slate-400 text-center space-y-2">
                  <div>لا يوجد أسهم لها بيانات مالية</div>
                  {onOpenAddCompany && (
                    <button
                      type="button"
                      onClick={() => {
                        onOpenAddCompany();
                        if (isMobileOpen) onCloseMobile();
                      }}
                      className="w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-emerald-400 hover:text-emerald-300 bg-emerald-950/50 hover:bg-emerald-900/40 border border-emerald-800/50 rounded-lg transition-colors"
                    >
                      <PlusCircle className="w-3.5 h-3.5" />
                      <span>إضافة سهم وبيانات مالية</span>
                    </button>
                  )}
                </div>
              )}

              {isStockListOpen && companies.length > 0 && (
                <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
                  <div className="max-h-52 overflow-y-auto divide-y divide-slate-800/60">
                    {companies.map((comp) => {
                      const isSelected = comp.id === selectedCompanyId || comp.ticker === selectedCompanyId;
                      return (
                        <button
                          key={comp.ticker}
                          type="button"
                          onClick={() => {
                            onSelectCompany(comp.ticker);
                            setIsStockListOpen(false);
                          }}
                          className={`w-full text-right px-3 py-2 flex items-center justify-between gap-2 transition-colors ${
                            isSelected
                              ? 'bg-emerald-950/60 text-emerald-300 font-medium'
                              : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold text-xs text-emerald-400 shrink-0">
                                {comp.ticker}
                              </span>
                              <span className="text-xs truncate">{comp.nameAr}</span>
                            </div>
                            <div className="text-[10px] text-slate-400 flex items-center gap-1.5 mt-0.5 truncate">
                              <span>{comp.sector || 'غير محدد'}</span>
                              <span>·</span>
                              <span className="font-mono font-semibold text-slate-300">
                                {comp.marketPrice !== null ? `${comp.marketPrice.toFixed(2)} ج.م` : 'السعر غير متاح'}
                              </span>
                            </div>
                          </div>
                          {isSelected && <Check className="w-4 h-4 text-emerald-400 shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                  {onOpenAddCompany && (
                    <div className="p-2 border-t border-slate-800 bg-slate-950/70">
                      <button
                        type="button"
                        onClick={() => {
                          setIsStockListOpen(false);
                          onOpenAddCompany();
                          if (isMobileOpen) onCloseMobile();
                        }}
                        className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-emerald-400 hover:text-emerald-300 bg-emerald-950/50 hover:bg-emerald-900/40 border border-emerald-800/50 rounded-lg transition-colors"
                      >
                        <PlusCircle className="w-4 h-4" />
                        <span>إضافة سهم وبيانات مالية</span>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                onToggleCollapse();
                setIsStockListOpen(true);
              }}
              title={
                selectedCompany
                  ? `${selectedCompany.ticker.replace('.CA', '')} - ${selectedCompany.nameAr}`
                  : 'اختيار السهم'
              }
              className="w-full flex items-center justify-center p-2.5 rounded-xl bg-slate-950/80 border border-slate-800 text-emerald-400 hover:border-emerald-600/60 transition-colors"
            >
              <TrendingUp className="w-5 h-5" />
            </button>
          )}

          {/* Main Navigation Links */}
          <div>
            {showFullContent && (
              <div className="px-2 mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                أقسام التحليل والتقييم
              </div>
            )}

            <nav className="space-y-1.5">
              {navItems.map((item) => {
                const isActive = activeTab === item.id;
                const Icon = item.icon;

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleTabClick(item.id)}
                    title={!showFullContent ? item.label : undefined}
                    className={`w-full group flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs sm:text-sm font-medium transition-all relative ${
                      isActive
                        ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-semibold shadow-md shadow-emerald-950/40 ring-1 ring-emerald-500/50'
                        : 'text-slate-300 hover:bg-slate-800/70 hover:text-white'
                    }`}
                  >
                    {/* Active Accent Bar */}
                    {isActive && (
                      <span className="absolute right-0 top-2 bottom-2 w-1 bg-emerald-300 rounded-l" />
                    )}

                    <div className="relative shrink-0 flex items-center justify-center">
                      <Icon
                        className={`w-5 h-5 transition-transform group-hover:scale-105 ${
                          isActive ? 'text-white' : 'text-emerald-400'
                        }`}
                      />
                      {item.badge !== undefined && !showFullContent && (
                        <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-red-500 ring-2 ring-slate-900" />
                      )}
                    </div>

                    {showFullContent && (
                      <div className="flex-1 flex items-center justify-between min-w-0 text-right">
                        <div className="truncate">
                          <div className="truncate leading-snug">{item.label}</div>
                          <div
                            className={`text-[10px] truncate ${
                              isActive ? 'text-emerald-100' : 'text-slate-400'
                            }`}
                          >
                            {item.description}
                          </div>
                        </div>

                        {item.badge !== undefined && (
                          <span className="inline-flex items-center justify-center px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-red-950 text-red-400 border border-red-800 shrink-0 mr-1.5">
                            {item.badge}
                          </span>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
            </nav>
          </div>

          {/* Quick Tools & Export Actions (Expanded or Collapsed Icons) */}
          {(onExportExcel || onPrintReport || onOpenAddCompany) && (
            showFullContent ? (
              <div>
                <div className="px-2 mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  أدوات التقرير والعمليات
                </div>
                <div className="space-y-1.5">
                  {onExportExcel && (
                    <button
                      type="button"
                      onClick={() => {
                        onExportExcel();
                        if (isMobileOpen) onCloseMobile();
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-slate-300 bg-slate-800/50 hover:bg-slate-800 hover:text-white border border-slate-700/50 transition-colors"
                    >
                      <FileSpreadsheet className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span>تصدير تقرير Excel متكامل</span>
                    </button>
                  )}

                  {onPrintReport && (
                    <button
                      type="button"
                      onClick={() => {
                        onPrintReport();
                        if (isMobileOpen) onCloseMobile();
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-slate-300 bg-slate-800/50 hover:bg-slate-800 hover:text-white border border-slate-700/50 transition-colors"
                    >
                      <Printer className="w-4 h-4 text-teal-400 shrink-0" />
                      <span>طباعة / حفظ PDF</span>
                    </button>
                  )}

                  {onOpenAddCompany && (
                    <button
                      type="button"
                      onClick={() => {
                        onOpenAddCompany();
                        if (isMobileOpen) onCloseMobile();
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-emerald-300 bg-emerald-950/40 hover:bg-emerald-900/40 border border-emerald-800/40 transition-colors"
                    >
                      <PlusCircle className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span>إضافة سهم وبيانات مالية</span>
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-1.5 pt-2 border-t border-slate-800/80">
                {onExportExcel && (
                  <button
                    type="button"
                    onClick={onExportExcel}
                    title="تصدير تقرير Excel متكامل"
                    className="w-full flex items-center justify-center p-2.5 rounded-xl text-emerald-400 hover:bg-slate-800/70 transition-colors"
                  >
                    <FileSpreadsheet className="w-4 h-4" />
                  </button>
                )}
                {onPrintReport && (
                  <button
                    type="button"
                    onClick={onPrintReport}
                    title="طباعة تقرير PDF"
                    className="w-full flex items-center justify-center p-2.5 rounded-xl text-teal-400 hover:bg-slate-800/70 transition-colors"
                  >
                    <Printer className="w-4 h-4" />
                  </button>
                )}
                {onOpenAddCompany && (
                  <button
                    type="button"
                    onClick={onOpenAddCompany}
                    title="إضافة شركة مقيدة جديدة"
                    className="w-full flex items-center justify-center p-2.5 rounded-xl text-emerald-400 hover:bg-emerald-950/50 transition-colors"
                  >
                    <PlusCircle className="w-4 h-4" />
                  </button>
                )}
              </div>
            )
          )}

          {/* Firestore Incremental Sync Status */}
          {syncStats && (
            showFullContent ? (
              <div className="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/70 text-xs space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-slate-300 flex items-center gap-1.5 text-[11px] font-medium">
                    <span className="relative flex items-center justify-center">
                      <Cloud className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    </span>
                    تزامن Firestore ⚡
                  </span>
                  {onManualSync && (
                    <button
                      type="button"
                      onClick={onManualSync}
                      className="text-emerald-400 hover:text-emerald-300 flex items-center gap-1 text-[11px] font-medium"
                      title="فحص تزايدي يدوي"
                    >
                      <span>تحديث</span>
                      <RefreshCw
                        className={`w-3 h-3 ${
                          syncStats.status === 'syncing' ? 'animate-spin' : ''
                        }`}
                      />
                    </button>
                  )}
                </div>
                <p className="text-[10px] text-slate-400 font-mono truncate">
                  {syncStats.messageAr}
                </p>
              </div>
            ) : (
              onManualSync && (
                <button
                  type="button"
                  onClick={onManualSync}
                  title={`${syncStats.messageAr} — اضغط للتحديث`}
                  className="w-full flex items-center justify-center p-2.5 rounded-xl text-emerald-400 hover:bg-slate-800/70 transition-colors"
                >
                  <RefreshCw
                    className={`w-4 h-4 ${syncStats.status === 'syncing' ? 'animate-spin' : ''}`}
                  />
                </button>
              )
            )
          )}

          {/* User Profile & Auth Card (When expanded) */}
          {showFullContent && (
            <div className="bg-slate-950/80 p-3 rounded-2xl border border-slate-800/80 space-y-2.5">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span className="flex items-center gap-1.5 font-medium text-slate-300">
                  <Shield className="w-3.5 h-3.5 text-emerald-400" />
                  حساب المستخدم (Auth)
                </span>
                <span
                  className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-semibold border ${
                    userRole === 'admin'
                      ? 'bg-emerald-950/90 text-emerald-300 border-emerald-800'
                      : userRole === 'data_entry'
                      ? 'bg-teal-950/90 text-teal-300 border-teal-800'
                      : 'bg-sky-950/90 text-sky-300 border-sky-800'
                  }`}
                >
                  {userRole === 'admin'
                    ? 'مسؤول (Admin)'
                    : userRole === 'data_entry'
                    ? 'مدخل بيانات'
                    : 'مشترك (Subscriber)'}
                </span>
              </div>

              {/* User Identity Info */}
              <div className="flex items-center gap-2.5 pt-1">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-600 to-teal-800 flex items-center justify-center text-white font-bold text-xs shrink-0 shadow-md">
                  {currentUser?.displayName ? (
                    currentUser.displayName.slice(0, 1).toUpperCase()
                  ) : (
                    <UserIcon className="w-4 h-4" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-xs text-white truncate">
                    {currentUser?.displayName || 'مستخدم المنصة'}
                  </div>
                  <div className="text-[10px] text-slate-400 truncate font-mono">
                    {currentUser?.email || (isLoggedIn ? 'مسجل الدخول' : 'وضع المعاينة (Guest)')}
                  </div>
                </div>
              </div>

              {/* Role Switcher for Testing (Admin / Dev) */}
              {onSwitchRole && (
                <div className="pt-1">
                  <label className="text-[10px] text-slate-400 block mb-1">
                    تبديل الصلاحية للمعاينة (RBAC Simulation):
                  </label>
                  <select
                    value={userRole}
                    onChange={(e) => onSwitchRole(e.target.value as UserRole)}
                    className="w-full bg-slate-900 border border-slate-700/80 rounded-lg px-2 py-1.5 text-xs text-slate-200 font-semibold focus:outline-none focus:border-emerald-500 cursor-pointer"
                  >
                    <option value="admin">مدير المنصة (Admin)</option>
                    <option value="data_entry">مدخل بيانات (Data Entry)</option>
                    <option value="subscriber">مشترك تجاري (Subscriber)</option>
                    <option value="assistant">مساند / سكرتارية</option>
                  </select>
                </div>
              )}

              {/* Auth Actions: Sign In or Sign Out */}
              <div className="pt-1 border-t border-slate-800/80">
                {isLoggedIn ? (
                  <button
                    type="button"
                    onClick={() => {
                      onSignOut?.();
                      if (isMobileOpen) onCloseMobile();
                    }}
                    className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-300 hover:text-red-300 hover:bg-red-950/30 border border-slate-800 hover:border-red-900/50 transition-colors"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>تسجيل الخروج</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      onOpenLogin?.();
                      if (isMobileOpen) onCloseMobile();
                    }}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 shadow-md shadow-emerald-950/40 transition-all"
                  >
                    <LogIn className="w-3.5 h-3.5" />
                    <span>تسجيل الدخول (Google / Apple)</span>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar Footer: Active Company Quick Badge */}
        {selectedCompany && showFullContent && (
          <div className="p-3 border-t border-slate-800/80 bg-slate-950/80 shrink-0">
            <div className="flex items-center justify-between text-xs">
              <div className="truncate">
                <span className="text-[10px] text-slate-400 block">السهم النشط:</span>
                <span className="font-bold text-white truncate block">
                  {selectedCompany.nameAr}
                </span>
              </div>
              <div className="text-left font-mono font-bold text-emerald-400 text-xs shrink-0 mr-2">
                {selectedCompany.marketPrice !== null ? `${selectedCompany.marketPrice.toFixed(2)} ج.م` : 'غير متاح'}
              </div>
            </div>
          </div>
        )}
      </aside>
    </>
  );
};
