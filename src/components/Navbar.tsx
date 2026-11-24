/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import {
  Menu,
  TrendingUp,
  PanelRightClose,
  PanelRightOpen,
  LayoutDashboard,
  Calculator,
  BookOpen,
  Target,
  History,
  Database,
  Sliders,
} from 'lucide-react';
import { Company } from '../types';

interface NavbarProps {
  companies: Company[];
  selectedCompanyId: string | null;
  activeTab: string;
  onToggleMobileSidebar: () => void;
  onToggleDesktopSidebar: () => void;
  isSidebarCollapsed: boolean;
  auditWarningCount: number;
}

const TAB_TITLES: Record<string, { label: string; icon: React.ElementType }> = {
  dashboard: { label: 'لوحة التحكم', icon: LayoutDashboard },
  valuation: { label: 'معمل التقييم والحساسية', icon: Calculator },
  story: { label: 'قصة السهم', icon: BookOpen },
  decision: { label: 'مصفوفة القرار', icon: Target },
  trades: { label: 'سجل الصفقات', icon: History },
  data: { label: 'مركز إدارة البيانات والتدقيق', icon: Database },
  admin: { label: 'لوحة المدير والمتغيرات', icon: Sliders },
};

export const Navbar: React.FC<NavbarProps> = ({
  companies,
  selectedCompanyId,
  activeTab,
  onToggleMobileSidebar,
  onToggleDesktopSidebar,
  isSidebarCollapsed,
  auditWarningCount,
}) => {
  const selectedCompany = selectedCompanyId
    ? companies.find((c) => c.id === selectedCompanyId || c.ticker === selectedCompanyId) || null
    : null;
  const activeTabMeta = TAB_TITLES[activeTab] || TAB_TITLES.dashboard;
  const ActiveTabIcon = activeTabMeta.icon;

  return (
    <header className="sticky top-0 z-30 bg-slate-900/95 backdrop-blur-md border-b border-slate-800 text-slate-100 shadow-sm">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14 sm:h-16 gap-2 sm:gap-3">
          {/* Right Section (in RTL): Sidebar Toggle & Active Tab Indicator */}
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            {/* Mobile Hamburger Drawer Trigger */}
            <button
              type="button"
              onClick={onToggleMobileSidebar}
              className="lg:hidden p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-200 border border-slate-700/80 transition-all flex items-center gap-1.5 group shadow-sm active:scale-95 shrink-0"
              aria-label="فتح القائمة الجانبية"
              title="فتح القائمة الجانبية"
            >
              <Menu className="w-5 h-5 text-emerald-400 group-hover:scale-110 transition-transform" />
              {auditWarningCount > 0 && (
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              )}
            </button>

            {/* Desktop Sidebar Collapse / Expand Button */}
            <button
              type="button"
              onClick={onToggleDesktopSidebar}
              className="hidden lg:flex p-2 rounded-xl bg-slate-800/60 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/60 transition-colors items-center gap-2 shrink-0"
              title={isSidebarCollapsed ? 'توسيع القائمة الجانبية' : 'طي القائمة الجانبية'}
              aria-label="تبديل عرض القائمة الجانبية"
            >
              {isSidebarCollapsed ? (
                <PanelRightOpen className="w-4 h-4 text-emerald-400" />
              ) : (
                <PanelRightClose className="w-4 h-4 text-slate-400" />
              )}
            </button>

            {/* Active Section Breadcrumb */}
            <div className="flex items-center gap-2 sm:gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-emerald-950/70 border border-emerald-800/50 flex items-center justify-center text-emerald-400 shrink-0">
                <ActiveTabIcon className="w-4 h-4" />
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-xs sm:text-sm font-bold text-white tracking-tight truncate">
                  {activeTabMeta.label}
                </span>
                {selectedCompany && (
                  <span className="text-[10px] text-slate-400 hidden sm:inline truncate">
                    {selectedCompany.nameAr}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Left Section (in RTL): Compact Active Stock Indicator */}
          {selectedCompany && (
            <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-slate-950/80 border border-slate-800/80 shrink-0 max-w-[46%] sm:max-w-xs">
              <TrendingUp className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span className="font-mono font-bold text-xs text-emerald-400 shrink-0">
                {selectedCompany.ticker}
              </span>
              <span className="text-slate-400 text-xs hidden md:inline truncate">
                {selectedCompany.nameAr}
              </span>
              <span className="text-[11px] font-mono text-slate-200 border-r border-slate-800 pr-2 shrink-0">
                {selectedCompany.marketPrice !== null ? `${selectedCompany.marketPrice.toFixed(2)} ج.م` : 'السعر غير متاح'}
              </span>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
