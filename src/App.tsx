/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, lazy, Suspense, useCallback, useEffect, useRef } from 'react';
import {
  AlertTriangle,
  Database,
  Lock,
  PlusCircle,
  RefreshCw,
  ShieldAlert,
  WifiOff,
} from 'lucide-react';
import {
  AppUser,
  TerminalValueMethod,
  UserRole,
} from './types';
import { AssumptionPriority, RequestedQuarterlyEditTarget } from './types/financial';
import { FirestoreService } from './utils/storage';
import { classifyAppDataState, tryNormalizedTicker } from './core/domain/stockDerived';
import { useFirestoreSession } from './hooks/useFirestoreSession';
import { useStockValuation } from './hooks/useStockValuation';

// Components & Modules
import { Navbar } from './components/Navbar';
import { Sidebar } from './components/Sidebar';
import { DashboardView } from './components/DashboardView';
const ValuationView = lazy(() => import('./components/ValuationView').then((m) => ({ default: m.ValuationView })));
const InvestmentStoryView = lazy(() =>
  import('./components/InvestmentStoryView').then((m) => ({ default: m.InvestmentStoryView }))
);
const DecisionMatrixView = lazy(() =>
  import('./components/DecisionMatrixView').then((m) => ({ default: m.DecisionMatrixView }))
);
const TradeLogView = lazy(() => import('./components/TradeLogView').then((m) => ({ default: m.TradeLogView })));
import { AddCompanyModal } from './components/AddCompanyModal';
const AdminDashboard = lazy(() =>
  import('./modules/admin/AdminDashboard').then((m) => ({ default: m.AdminDashboard }))
);
import type { MacroDraftNavigationGuard } from './modules/admin/AdminDashboard';
const DataHubView = lazy(() =>
  import('./modules/data-hub/DataHubView').then((m) => ({ default: m.DataHubView }))
);
import { useAuth } from './context/AuthContext';
import { LoginModal } from './components/LoginModal';
import { RouteGuard } from './components/RouteGuard';

function MainApp() {
  const {
    firebaseUser,
    appUser,
    loading: authLoading,
    isAdmin,
    canEditFinancials,
    canAccessAdmin,
    canExecuteTrades,
    signOut,
    switchRole,
  } = useAuth();

  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [assumptionPriority, setAssumptionPriority] = useState<AssumptionPriority>('company_first');
  const [terminalValueMethod, setTerminalValueMethod] = useState<TerminalValueMethod>('perpetuity_growth');
  const [valuationDate, setValuationDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [isAddCompanyOpen, setIsAddCompanyOpen] = useState(false);
  const [requestedEditTarget, setRequestedEditTarget] = useState<RequestedQuarterlyEditTarget | null>(null);
  const [requestedDataHubSubTab, setRequestedDataHubSubTab] = useState<'audit_warnings' | 'dividend_table' | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [adminMacroGuard, setAdminMacroGuard] = useState<MacroDraftNavigationGuard | null>(null);
  const [pendingLeaveAction, setPendingLeaveAction] = useState<
    { kind: 'tab'; targetTab: string } | { kind: 'signout' } | null
  >(null);
  const [leaveGuardSaving, setLeaveGuardSaving] = useState(false);
  const [leaveGuardFeedback, setLeaveGuardFeedback] = useState<{
    kind: 'error' | 'info';
    text: string;
  } | null>(null);
  const leaveGuardReqIdRef = useRef(0);
  const activeUserScopeRef = useRef<string>(appUser?.id || 'guest');
  activeUserScopeRef.current = appUser?.id || 'guest';

  useEffect(() => {
    leaveGuardReqIdRef.current += 1;
    setPendingLeaveAction(null);
    setLeaveGuardSaving(false);
    setLeaveGuardFeedback(null);
  }, [appUser?.id]);

  const requestSelectTab = useCallback(
    (nextTab: string) => {
      if (nextTab === activeTab) return;
      if (activeTab === 'admin' && adminMacroGuard?.hasUnsavedChanges) {
        setLeaveGuardFeedback(null);
        setPendingLeaveAction({ kind: 'tab', targetTab: nextTab });
        return;
      }
      setActiveTab(nextTab);
    },
    [activeTab, adminMacroGuard]
  );

  const navigateToTrades = useCallback(() => setActiveTab('trades'), []);
  const handleOpenAuditWarnings = useCallback(() => {
    setRequestedDataHubSubTab('audit_warnings');
    setActiveTab('data');
  }, []);
  const handleRequestQuarterlyEditTarget = useCallback((target: RequestedQuarterlyEditTarget) => {
    const normTk = tryNormalizedTicker(target.ticker) ?? target.ticker;
    setRequestedEditTarget({ ...target, ticker: normTk });
    setActiveTab('data');
  }, []);

  const session = useFirestoreSession({
    firebaseUser,
    appUser,
    canAccessAdmin,
    canEditFinancials,
    canExecuteTrades,
    isAdmin,
    onSelectTicker: setSelectedTicker,
    onNavigateToTrades: navigateToTrades,
  });

  const {
    syncState,
    syncStats,
    saving,
    saveError,
    setSaveError,
    triggerRetry,
    clearInMemorySessionState,
    handleManualSync,
    handleAddStockAndQuarter,
    handleUpdateCompanyParams,
    handlePatchCompanyMetadata,
    handleImportDailyRecords,
    handleImportQuarterlyRecords,
    handleUpdateQuarterlyRecord,
    handleDeleteQuarterlyRecord,
    handleUpdateDailyRecord,
    handleDeleteDailyRecord,
    handleImportDividendRecords,
    handleUpdateDividendRecord,
    handleDeleteDividendRecord,
    handleSaveDividendYearStatus,
    handleDeleteDividendYearStatus,
    handleSaveCompanyOverride,
    handleSaveBetaAssumption,
    handleDeleteBetaAssumption,
    handleDeleteCompanyOverride,
    handleSaveSingleMacroParam,
    handleSaveMacroParams,
    handleDeleteMacroParam,
    handleSaveSectorPE,
    handleUpsertSector,
    handleToggleSectorStatus,
    handleDeleteSector,
    handleUpdateStory,
    handleUpdateDecision,
    handleCreateTradeFromDecision,
    handleAddTrade,
    handleUpdateTrade,
    handleDeleteTrade,
  } = session;

  const {
    stocks,
    universeDiagnostics,
    financials,
    selectedCompany,
    selectedLatestDaily,
    selectedStockQuarterly,
    selectedBetaRecord,
    companyOverridesMap,
    paramsMap,
    macroMetaMap,
    sectorPEMap,
    betaConfirmed,
    betaError,
    effectiveRimRetentionPolicy,
    metricsTTM,
    valuation,
    engineOutputs,
    auditWarnings,
    healthChecks,
    currentStory,
    currentDecision,
  } = useStockValuation({
    syncState,
    selectedTicker,
    onChangeSelectedTicker: setSelectedTicker,
    assumptionPriority,
    terminalValueMethod,
    valuationDate,
  });

  const handleExportExcel = async () => {
    if (!selectedCompany || !metricsTTM || !valuation || !engineOutputs || valuation.compositeFairValue === null) {
      setSaveError('التقييم غير متاح؛ أكمل البيانات قبل تصدير تقرير التقييم.');
      return;
    }
    const { exportCompanyValuationToExcel } = await import('./utils/excelExport');
    exportCompanyValuationToExcel(
      selectedCompany,
      financials.filter((f) => f.companyId === selectedCompany.id),
      { ...metricsTTM, wacc: engineOutputs.wacc, costOfEquity: engineOutputs.costOfEquity },
      valuation,
      auditWarnings
    );
  };

  const handlePrintReport = () => {
    window.print();
  };

  const executeSignOut = async () => {
    clearInMemorySessionState();
    await signOut();
  };

  const handleSignOut = async () => {
    if (activeTab === 'admin' && adminMacroGuard?.hasUnsavedChanges) {
      setLeaveGuardFeedback(null);
      setPendingLeaveAction({ kind: 'signout' });
      return;
    }
    await executeSignOut();
  };

  const effectiveUser: AppUser = appUser || {
    id: 'guest',
    email: '',
    displayName: 'زائر',
    role: 'subscriber' as UserRole,
    tier: 'free',
    isActive: false,
    createdAt: '',
    lastLoginAt: '',
  };
  const effectiveRole = effectiveUser.role;

  const dataState = classifyAppDataState({
    authLoading,
    isAuthenticated: Boolean(firebaseUser && appUser?.isActive),
    connectionError: syncState.connectionError,
    quarterlyConfirmed: syncState.quarterlyConfirmed,
    stocksCount: stocks.length,
  });

  const stockRequiredTabs = new Set(['dashboard', 'valuation', 'story', 'decision']);
  const canRenderProtectedTab = !stockRequiredTabs.has(activeTab);

  const renderBlockingState = () => {
    if (dataState === 'loading') {
      return (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-10 text-center space-y-3">
          <RefreshCw className="w-7 h-7 text-emerald-400 animate-spin mx-auto" />
          <h2 className="text-base font-bold text-white">جارٍ تحميل البيانات من Firestore...</h2>
          <p className="text-xs text-slate-400">يتم جلب السجلات المالية وأسعار التداول والافتراضات المعتمدة.</p>
        </div>
      );
    }

    if (dataState === 'unauthenticated') {
      return (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-10 text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-slate-950 border border-slate-800 text-emerald-400 flex items-center justify-center mx-auto">
            <Lock className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-white">يلزم تسجيل الدخول</h2>
            <p className="text-xs text-slate-400 max-w-md mx-auto">
              تعتمد منصة ميزان على Firestore كمصدر وحيد معتمد للبيانات؛ سجّل الدخول للوصول إلى السجلات المالية والتقييمات.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setIsLoginModalOpen(true)}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-sm transition-colors"
          >
            تسجيل الدخول إلى المنصة
          </button>
        </div>
      );
    }

    if (dataState === 'permission_denied') {
      return (
        <div className="bg-slate-900 border border-red-900/60 rounded-2xl p-10 text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-red-950/60 border border-red-800/60 text-red-400 flex items-center justify-center mx-auto">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-white">لا توجد صلاحية للوصول إلى البيانات</h2>
            <p className="text-xs text-red-300 max-w-md mx-auto">
              {syncState.connectionError?.message || 'حسابك الحالي لا يملك صلاحية قراءة السجلات المالية في Firestore.'}
            </p>
          </div>
          <button
            type="button"
            onClick={triggerRetry}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>إعادة المحاولة</span>
          </button>
        </div>
      );
    }

    if (dataState === 'offline') {
      return (
        <div className="bg-slate-900 border border-amber-900/60 rounded-2xl p-10 text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-amber-950/60 border border-amber-800/60 text-amber-400 flex items-center justify-center mx-auto">
            <WifiOff className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-white">أنت غير متصل بخادم Firestore</h2>
            <p className="text-xs text-amber-200 max-w-md mx-auto">
              {syncState.connectionError?.message ||
                'الاتصال بالإنترنت أو خادم Firestore غير متاح حالياً؛ لا تُعرض بيانات كاش محلية قديمة كحالة قاعدة البيانات الحالية.'}
            </p>
          </div>
          <button
            type="button"
            onClick={triggerRetry}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>إعادة التحقق من الخادم</span>
          </button>
        </div>
      );
    }

    if (dataState === 'error') {
      return (
        <div className="bg-slate-900 border border-amber-900/60 rounded-2xl p-10 text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-amber-950/60 border border-amber-800/60 text-amber-400 flex items-center justify-center mx-auto">
            <WifiOff className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-white">تعذر الاتصال بقاعدة البيانات</h2>
            <p className="text-xs text-amber-200 max-w-md mx-auto">
              {syncState.connectionError?.message || 'حدث خطأ أثناء الاتصال بـ Firestore. تحقق من الشبكة ثم أعد المحاولة.'}
            </p>
          </div>
          <button
            type="button"
            onClick={triggerRetry}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>إعادة المحاولة</span>
          </button>
        </div>
      );
    }

    if (dataState === 'empty' && !canRenderProtectedTab) {
      return (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-10 text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-slate-950 border border-slate-800 text-slate-400 flex items-center justify-center mx-auto">
            <Database className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-white">لا يوجد أسهم لها بيانات مالية</h2>
            <p className="text-xs text-slate-400 max-w-lg mx-auto leading-relaxed">
              تُشتق قائمة الأسهم حصرياً من مجموعة{' '}
              <span className="font-mono text-emerald-400">quarterly_financial_records</span> في Firestore. أضف أول سهم وسجل مالي أو استورد ملف قوائم ربع سنوية للبدء.
            </p>
          </div>
          {canEditFinancials && (
            <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setIsAddCompanyOpen(true)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold"
              >
                <PlusCircle className="w-4 h-4" />
                <span>إضافة سهم وأول سجل مالي</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('data')}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700"
              >
                <Database className="w-4 h-4 text-emerald-400" />
                <span>الانتقال إلى مركز البيانات (استيراد Excel)</span>
              </button>
            </div>
          )}
        </div>
      );
    }

    return null;
  };

  const blockingNode = renderBlockingState();

  return (
    <div className="min-h-screen overflow-x-clip bg-slate-950 text-slate-100 flex flex-row font-sans selection:bg-emerald-500/30 selection:text-emerald-200">
      {/* 1. Modular Collapsible Sidebar */}
      <Sidebar
        companies={stocks}
        selectedCompanyId={selectedTicker}
        onSelectCompany={(tk) => setSelectedTicker(tryNormalizedTicker(tk) ?? tk)}
        activeTab={activeTab}
        onSelectTab={requestSelectTab}
        auditWarningCount={auditWarnings.length}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed((prev) => !prev)}
        isMobileOpen={isMobileSidebarOpen}
        onCloseMobile={() => setIsMobileSidebarOpen(false)}
        userRole={effectiveRole}
        onSwitchRole={switchRole}
        onExportExcel={handleExportExcel}
        onPrintReport={handlePrintReport}
        onOpenAddCompany={canEditFinancials ? () => setIsAddCompanyOpen(true) : undefined}
        syncStats={syncStats}
        onManualSync={handleManualSync}
        currentCompany={selectedCompany}
        currentUser={appUser}
        isLoggedIn={!!firebaseUser}
        onOpenLogin={() => setIsLoginModalOpen(true)}
        onSignOut={handleSignOut}
      />

      {/* 2. Main Content Viewport */}
      <div className="flex-1 flex flex-col min-w-0 min-h-screen">
        <Navbar
          companies={stocks}
          selectedCompanyId={selectedTicker}
          activeTab={activeTab}
          onToggleMobileSidebar={() => setIsMobileSidebarOpen(true)}
          onToggleDesktopSidebar={() => setIsSidebarCollapsed((prev) => !prev)}
          isSidebarCollapsed={isSidebarCollapsed}
          auditWarningCount={auditWarnings.length}
        />

        <div role="status" className="px-6 py-2 text-xs text-slate-300 flex flex-wrap items-center gap-2">
          {saving ? (
            <span className="text-amber-300">جارٍ الحفظ في Firestore…</span>
          ) : saveError ? (
            <span className="text-red-400 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" />
              فشل الحفظ: {saveError}
            </span>
          ) : (
            <span className="text-slate-400">
              المصدر المعتمد: Firestore (<span className="font-mono">quarterly_financial_records</span> و{' '}
              <span className="font-mono">daily_trading_records</span>) — لا تُعرض إلا البيانات الفعلية.
            </span>
          )}
        </div>

        {engineOutputs && engineOutputs.modelNotes.length > 0 && (
          <div className="px-6 text-xs text-amber-300 pb-1">{engineOutputs.modelNotes.join(' • ')}</div>
        )}

        {/* Main Viewport Container */}
        <Suspense fallback={<p role="status" className="p-6 text-xs text-slate-400">جارٍ تحميل الصفحة…</p>}>
          <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
            {blockingNode ? (
              blockingNode
            ) : (
              <>
                {activeTab === 'dashboard' && selectedCompany && metricsTTM && valuation && engineOutputs && (
                  <DashboardView
                    company={selectedCompany}
                    metrics={{ ...metricsTTM, wacc: engineOutputs.wacc, costOfEquity: engineOutputs.costOfEquity }}
                    valuation={valuation}
                    warnings={auditWarnings}
                    onNavigateToTab={setActiveTab}
                    onOpenAuditWarnings={handleOpenAuditWarnings}
                  />
                )}

                {activeTab === 'valuation' && selectedCompany && metricsTTM && valuation && engineOutputs && (
                  <ValuationView
                    company={selectedCompany}
                    metrics={{ ...metricsTTM, wacc: engineOutputs.wacc, costOfEquity: engineOutputs.costOfEquity }}
                    valuation={valuation}
                    assumptionPriority={assumptionPriority}
                    onChangePriority={setAssumptionPriority}
                    terminalValueMethod={terminalValueMethod}
                    onChangeTerminalValueMethod={setTerminalValueMethod}
                    rimRetentionPolicy={effectiveRimRetentionPolicy}
                    onChangeRimRetentionPolicy={
                      canEditFinancials
                        ? (policy) =>
                            handleUpdateCompanyParams(selectedCompany, {
                              rimRetentionPolicy: policy,
                              rimRetentionPolicySource: 'تخصيص سياسة احتجاز RIM للسهم',
                            })
                        : undefined
                    }
                    valuationDate={valuationDate}
                    onChangeValuationDate={setValuationDate}
                    onUpdateCompanyParams={(updates) => handleUpdateCompanyParams(selectedCompany, updates)}
                    companyOverridesMap={companyOverridesMap}
                    companyOverridesConfirmed={syncState.companyOverridesConfirmed}
                    paramsMap={paramsMap}
                    macroParams={syncState.macroParams}
                    macroParamsConfirmed={syncState.macroParamsConfirmed}
                    macroMetaMap={macroMetaMap}
                    sectorPEMap={sectorPEMap}
                    sectorDefinitions={syncState.sectorDefinitions}
                    sectorPeConfirmed={syncState.sectorPeConfirmed}
                    sectorPeStatus={syncState.sectorPeStatus}
                    sectorPeError={syncState.sectorPeError}
                    selectedBetaRecord={selectedBetaRecord}
                    betaConfirmed={betaConfirmed}
                    betaError={betaError}
                    selectedStockQuarterly={selectedStockQuarterly}
                    selectedLatestDaily={selectedLatestDaily}
                    isAdmin={isAdmin}
                    canEditFinancials={canEditFinancials}
                    onSaveCompanyOverride={handleSaveCompanyOverride}
                    onDeleteCompanyOverride={handleDeleteCompanyOverride}
                    onSaveBetaAssumption={handleSaveBetaAssumption}
                    onDeleteBetaAssumption={handleDeleteBetaAssumption}
                    onSaveGlobalMacroParam={handleSaveSingleMacroParam}
                    onRequestEditTarget={handleRequestQuarterlyEditTarget}
                    onOpenDividendRecords={() => {
                      setRequestedDataHubSubTab('dividend_table');
                      setActiveTab('data');
                    }}
                    userScopeKey={effectiveUser?.id || 'guest'}
                  />
                )}

                {activeTab === 'story' && selectedCompany && (
                  <InvestmentStoryView
                    company={selectedCompany}
                    story={currentStory}
                    canEdit={isAdmin}
                    onUpdateStory={handleUpdateStory}
                  />
                )}

                {activeTab === 'decision' && selectedCompany && valuation && (
                  <DecisionMatrixView
                    company={selectedCompany}
                    valuation={valuation}
                    decision={currentDecision}
                    canEdit={isAdmin}
                    onUpdateDecision={handleUpdateDecision}
                    onCreateTradeFromDecision={(decisionItem) =>
                      handleCreateTradeFromDecision(selectedCompany, valuation.compositeFairValue, decisionItem)
                    }
                  />
                )}

                {activeTab === 'trades' &&
                  (canExecuteTrades ? (
                    <TradeLogView
                      companies={stocks}
                      trades={syncState.trades}
                      onAddTrade={handleAddTrade}
                      onUpdateTrade={handleUpdateTrade}
                      onDeleteTrade={handleDeleteTrade}
                    />
                  ) : (
                    <RouteGuard
                      requiredRoleName="مدير المنصة (Admin)"
                      requiredRole="admin"
                      currentRole={effectiveRole}
                      isLoggedIn={!!firebaseUser}
                      onOpenLogin={() => setIsLoginModalOpen(true)}
                      onSwitchToRequired={() => switchRole('admin')}
                      onNavigateHome={() => setActiveTab('dashboard')}
                    />
                  ))}

                {activeTab === 'data' && (
                  <DataHubView
                    selectedTicker={selectedCompany ? selectedCompany.ticker : ''}
                    onSelectTicker={(tk) => setSelectedTicker(tryNormalizedTicker(tk) ?? tk)}
                    availableTickers={stocks.map((c) => c.ticker)}
                    dailyRecords={syncState.dailyRecords}
                    dailySchemas={syncState.dailySchemas}
                    quarterlyRecords={syncState.quarterlyRecords}
                    betaAssumptions={syncState.betaAssumptions}
                    dividendRecords={syncState.dividendRecords}
                    dividendYearStatuses={syncState.dividendYearStatuses}
                    companyOverrides={syncState.companyOverrides}
                    macroParams={syncState.macroParams}
                    healthChecks={healthChecks}
                    auditWarnings={auditWarnings}
                    requestedSubTab={requestedDataHubSubTab}
                    onClearRequestedSubTab={() => setRequestedDataHubSubTab(null)}
                    universeDiagnostics={universeDiagnostics}
                    onImportDailyRecords={handleImportDailyRecords}
                    onImportQuarterlyRecords={handleImportQuarterlyRecords}
                    onImportDividendRecords={handleImportDividendRecords}
                    onRequestPreviewDocs={(sourceType) => FirestoreService.fetchExistingDocsForPreview(sourceType)}
                    onExecuteImportChunk={(opType, chunkRecords, importMeta) =>
                      FirestoreService.bulkImportChunk(opType, chunkRecords, importMeta)
                    }
                    onImportCompleted={() => handleManualSync()}
                    onDeleteQuarterlyRecord={handleDeleteQuarterlyRecord}
                    onUpdateQuarterlyRecord={handleUpdateQuarterlyRecord}
                    onUpdateDailyRecord={handleUpdateDailyRecord}
                    onDeleteDailyRecord={handleDeleteDailyRecord}
                    onUpdateDividendRecord={handleUpdateDividendRecord}
                    onDeleteDividendRecord={handleDeleteDividendRecord}
                    onSaveDividendYearStatus={handleSaveDividendYearStatus}
                    onDeleteDividendYearStatus={handleDeleteDividendYearStatus}
                    onDeleteBetaAssumption={async (tk) => {
                      await handleDeleteBetaAssumption(tk);
                    }}
                    onDeleteCompanyOverride={async (tk, key) => {
                      await handleDeleteCompanyOverride(tk, key);
                    }}
                    requestedEditTarget={requestedEditTarget}
                    onClearRequestedEditTarget={() => setRequestedEditTarget(null)}
                    userRole={effectiveRole}
                  />
                )}

                {activeTab === 'admin' &&
                  (canAccessAdmin ? (
                    <AdminDashboard
                      macroParams={syncState.macroParams}
                      onSaveMacroParams={handleSaveMacroParams}
                      onDeleteMacroParam={handleDeleteMacroParam}
                      onMacroDraftGuardChange={setAdminMacroGuard}
                      onRunMaintenance={async (operationType) => {
                        const res = await FirestoreService.runAdminMaintenance(operationType);
                        await handleManualSync();
                        return res;
                      }}
                      sectorDefinitions={syncState.sectorDefinitions}
                      sectorPeConfirmed={syncState.sectorPeConfirmed}
                      sectorPeStatus={syncState.sectorPeStatus}
                      sectorPeError={syncState.sectorPeError}
                      sectorPEMap={syncState.sectorPEMap}
                      onSaveSectorPE={handleSaveSectorPE}
                      onUpsertSector={handleUpsertSector}
                      onToggleSectorStatus={handleToggleSectorStatus}
                      onDeleteSector={handleDeleteSector}
                      stocks={stocks}
                      companiesMeta={syncState.companiesMeta}
                      quarterlyRecords={syncState.quarterlyRecords}
                      dailyRecords={syncState.dailyRecords}
                      companyOverrides={syncState.companyOverrides}
                      betaAssumptions={syncState.betaAssumptions}
                      universeDiagnostics={universeDiagnostics}
                      onPatchCompanyMetadata={handlePatchCompanyMetadata}
                      users={syncState.users}
                      onSaveUsers={() =>
                        setSaveError('إدارة أدوار المستخدمين محلياً معطلة؛ يلزم مسار إدارة موثوق على الخادم.')
                      }
                      currentUser={effectiveUser}
                      onSwitchUser={() => setSaveError('لا يمكن تبديل هوية المستخدم من قائمة محلية.')}
                    />
                  ) : (
                    <RouteGuard
                      requiredRoleName="مدير المنصة (Admin)"
                      requiredRole="admin"
                      currentRole={effectiveRole}
                      isLoggedIn={!!firebaseUser}
                      onOpenLogin={() => setIsLoginModalOpen(true)}
                      onSwitchToRequired={() => switchRole('admin')}
                      onNavigateHome={() => setActiveTab('dashboard')}
                    />
                  ))}
              </>
            )}
          </main>
        </Suspense>

        {/* Footer */}
        <footer className="border-t border-slate-900 bg-slate-950 py-6 text-center text-xs text-slate-400 no-print mt-auto">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-2">
            <span>منصة ميزان (Mizan) — تقييم ومراجعة وتدقيق الأسهم المقيدة في البورصة المصرية</span>
            <span className="font-mono text-slate-400 text-[11px]">
              Firestore Single Source of Truth · Zero Unsourced Fallbacks
            </span>
          </div>
        </footer>
      </div>

      {/* Add Stock + First Quarterly Record Modal */}
      <AddCompanyModal
        isOpen={isAddCompanyOpen}
        onClose={() => setIsAddCompanyOpen(false)}
        onSaveStockAndQuarter={handleAddStockAndQuarter}
        sectorDefinitions={syncState.sectorDefinitions}
        sectorPeConfirmed={syncState.sectorPeConfirmed}
        sectorPeStatus={syncState.sectorPeStatus}
        sectorPeError={syncState.sectorPeError}
      />

      {/* Firebase Authentication Modal */}
      <LoginModal
        isOpen={isLoginModalOpen}
        onClose={() => setIsLoginModalOpen(false)}
        requiredRole="admin"
      />

      {/* Unsaved Macro Parameter Drafts Leave-View Guard Modal */}
      {pendingLeaveAction && adminMacroGuard && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div className="bg-slate-900 border border-amber-700/70 rounded-2xl w-full max-w-md shadow-2xl p-5 space-y-4">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-white">
                  توجد مسودات غير محفوظة للمعاملات العامة
                </h3>
                <p className="text-xs text-slate-300 leading-relaxed">
                  لديك {adminMacroGuard.dirtyCount} تعديل محلي لم يُحفظ بعد في Firestore. اختر الإجراء المطلوب قبل{' '}
                  {pendingLeaveAction.kind === 'signout' ? 'تسجيل الخروج' : 'مغادرة لوحة الإدارة'}:
                </p>
              </div>
            </div>
            {adminMacroGuard.hasBlockingIssues && (
              <div className="p-2.5 rounded-lg bg-red-950/50 border border-red-800/70 text-[11px] text-red-200">
                لا يمكن الحفظ الآن لوجود تعارض تزامن أو معامل محذوف على الخادم؛ اختر البقاء لمعالجته أو التخلي عن المسودات.
              </div>
            )}
            {leaveGuardFeedback && (
              <div
                role="alert"
                className={`p-2.5 rounded-lg border text-[11px] ${
                  leaveGuardFeedback.kind === 'error'
                    ? 'bg-red-950/50 border-red-800/70 text-red-200'
                    : 'bg-amber-950/50 border-amber-700/70 text-amber-200'
                }`}
              >
                {leaveGuardFeedback.text}
              </div>
            )}
            <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-slate-800 text-xs">
              <button
                type="button"
                disabled={leaveGuardSaving}
                onClick={() => {
                  setLeaveGuardFeedback(null);
                  setPendingLeaveAction(null);
                }}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700"
              >
                البقاء
              </button>
              <button
                type="button"
                disabled={leaveGuardSaving}
                onClick={async () => {
                  const action = pendingLeaveAction;
                  adminMacroGuard.discardDrafts();
                  setLeaveGuardFeedback(null);
                  setPendingLeaveAction(null);
                  if (action.kind === 'signout') {
                    await executeSignOut();
                  } else {
                    setActiveTab(action.targetTab);
                  }
                }}
                className="px-3 py-1.5 rounded-lg bg-rose-900/70 hover:bg-rose-800 text-rose-100 border border-rose-700/70 font-semibold"
              >
                التخلي عن المسودات
              </button>
              <button
                type="button"
                disabled={leaveGuardSaving || adminMacroGuard.hasBlockingIssues}
                onClick={async () => {
                  const action = pendingLeaveAction;
                  const startUserScope = activeUserScopeRef.current;
                  const reqId = ++leaveGuardReqIdRef.current;
                  setLeaveGuardFeedback(null);
                  setLeaveGuardSaving(true);
                  try {
                    const outcome = await adminMacroGuard.saveDirtyDrafts();
                    if (
                      activeUserScopeRef.current !== startUserScope ||
                      leaveGuardReqIdRef.current !== reqId
                    ) {
                      return;
                    }
                    if (outcome.safeToLeave) {
                      setPendingLeaveAction(null);
                      if (action.kind === 'signout') {
                        await executeSignOut();
                      } else {
                        setActiveTab(action.targetTab);
                      }
                      return;
                    }
                    if (outcome.status === 'ignored_stale') {
                      return;
                    }
                    if (outcome.errorAr) {
                      setLeaveGuardFeedback({ kind: 'error', text: outcome.errorAr });
                    } else if (outcome.status === 'saved_with_newer_draft') {
                      setLeaveGuardFeedback({
                        kind: 'info',
                        text:
                          outcome.noticeAr ||
                          'تم حفظ التعديل السابق، ولكن توجد تعديلات محلية أحدث غير محفوظة؛ لن تتم المغادرة قبل حفظها أو تجاهلها.',
                      });
                    }
                  } finally {
                    if (
                      activeUserScopeRef.current === startUserScope &&
                      leaveGuardReqIdRef.current === reqId
                    ) {
                      setLeaveGuardSaving(false);
                    }
                  }
                }}
                className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold"
              >
                {leaveGuardSaving ? 'جارٍ الحفظ...' : 'حفظ التعديلات والمتابعة'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  return <MainApp />;
}
