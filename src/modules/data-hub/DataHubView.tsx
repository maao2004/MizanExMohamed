/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Upload,
  FileSpreadsheet,
  Activity,
  Database,
  FileText,
  Clock,
  Coins,
  SlidersHorizontal,
  AlertTriangle,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  BetaAssumptionRecord,
  CompanyParameterOverride,
  DailyTradingRecord,
  DailyTradingSchemaRecord,
  DividendApprovalStatus,
  DividendDistributionSemantics,
  DividendRecord,
  DividendYearStatusRecord,
  HEALTH_CHECK_STATUS_META,
  HealthCheckStatus,
  ImportBatchReport,
  ImportPreviewItem,
  ImportPreviewResult,
  ImportSourceType,
  MacroParameter,
  QuarterlyFinancialRecord,
  QuarterlyFinancialRecordWritePayload,
  RequestedQuarterlyEditTarget,
  StockHealthCheckItem,
  UserRole,
} from '../../types';
import { AuditWarning } from '../../types/financial';
import {
  BatchWriteChunkResponse,
  buildImportPreview,
  downloadAllParametersTemplate,
  downloadBetaAssumptionsTemplate,
  downloadDpsActualTemplate,
  downloadQuarterlyFcffTemplate,
  executeChunkedImportBatches,
  parseAllParametersExcelFile,
  parseBetaAssumptionsExcelFile,
  parseDailyTradingExcelDetailed,
  parseDpsActualExcelFile,
  parseQuarterlyFinancialsExcelDetailed,
  ParsedParameterImportRow,
} from '../../core/imports';
import {
  buildParameterWritePayloadFromImport,
  tryNormalizedTicker,
} from '../../core/contracts';
import { HealthBadge } from '../../shared/ui/HealthBadge';
import { ConfirmDeleteModal } from '../../shared/ui/ConfirmDeleteModal';
import { EditQuarterlyRecordModal } from './EditQuarterlyRecordModal';
import { EditDailyRecordModal } from './EditDailyRecordModal';
import { EditDividendRecordModal } from './EditDividendRecordModal';
import { ImportWorkflowPanel } from './ImportWorkflowPanel';
import { BetaAssumptionsTable } from './BetaAssumptionsTable';
import { CompanyOverridesTable } from './CompanyOverridesTable';
import { DividendRecordsTable } from './DividendRecordsTable';
import { QuarterlyRecordsTable } from './QuarterlyRecordsTable';
import { DailyTradingTable } from './DailyTradingTable';
import { AccountingAuditWarningsPanel } from './AccountingAuditWarningsPanel';
import type { StockUniverseDiagnostics } from '../../core/domain/stockDerived';
import {
  exportAllParametersToExcel,
  exportDailyTradingToExcel,
  exportQuarterlyRecordsToExcel,
} from '../../utils/excelExport';

export type DataHubSubTab =
  | 'uploaders'
  | 'health'
  | 'audit_warnings'
  | 'quarterly_table'
  | 'daily_table'
  | 'dividend_table'
  | 'beta_table'
  | 'parameters_table';

type BulkOperationType =
  | 'bulk_quarterly'
  | 'bulk_daily'
  | 'bulk_beta'
  | 'bulk_parameters'
  | 'bulk_dividend';

interface DataHubViewProps {
  selectedTicker: string;
  onSelectTicker: (ticker: string) => void;
  availableTickers: string[];
  dailyRecords: DailyTradingRecord[];
  dailySchemas?: Record<string, DailyTradingSchemaRecord>;
  quarterlyRecords: QuarterlyFinancialRecord[];
  betaAssumptions?: BetaAssumptionRecord[];
  dividendRecords?: DividendRecord[];
  dividendYearStatuses?: DividendYearStatusRecord[];
  companyOverrides?: CompanyParameterOverride[];
  macroParams?: MacroParameter[];
  healthChecks: StockHealthCheckItem[];
  auditWarnings?: AuditWarning[];
  requestedSubTab?: DataHubSubTab | null;
  onClearRequestedSubTab?: () => void;
  universeDiagnostics?: StockUniverseDiagnostics;
  onImportDailyRecords: (records: DailyTradingRecord[], date: string) => void | Promise<void>;
  onImportQuarterlyRecords: (records: QuarterlyFinancialRecord[]) => void | Promise<void>;
  onImportDividendRecords?: (records: DividendRecord[]) => void | Promise<void>;
  onRequestPreviewDocs?: (sourceType: ImportSourceType) => Promise<Map<string, Record<string, any>>>;
  onExecuteImportChunk?: (
    operationType: BulkOperationType,
    chunkRecords: unknown[],
    importMeta: {
      importId: string;
      sourceFile: string;
      sourceSheet: string;
      chunkIndex: number;
      dailySchema?: DailyTradingSchemaRecord | null;
    }
  ) => Promise<BatchWriteChunkResponse>;
  onImportCompleted?: () => Promise<void> | void;
  onDeleteQuarterlyRecord: (ticker: string, year: number, quarter: string) => void | Promise<void>;
  onUpdateQuarterlyRecord?: (
    record: QuarterlyFinancialRecord,
    writePayload?: QuarterlyFinancialRecordWritePayload
  ) => void | Promise<void>;
  onUpdateDailyRecord?: (record: DailyTradingRecord) => void | Promise<void>;
  onDeleteDailyRecord?: (ticker: string, tradeDate: string) => void | Promise<void>;
  onUpdateDividendRecord?: (record: DividendRecord) => void | Promise<void>;
  onDeleteDividendRecord?: (
    record: Pick<DividendRecord, 'ticker' | 'fiscalYear' | 'recordType' | 'distributionId'>
  ) => void | Promise<void>;
  onSaveDividendYearStatus?: (record: DividendYearStatusRecord) => void | Promise<void>;
  onDeleteDividendYearStatus?: (ticker: string, fiscalYear: number) => void | Promise<void>;
  onDeleteBetaAssumption?: (ticker: string) => Promise<void>;
  onDeleteCompanyOverride?: (ticker: string, key: string) => Promise<void>;
  requestedEditTarget?: RequestedQuarterlyEditTarget | null;
  onClearRequestedEditTarget?: () => void;
  userRole: UserRole;
}

export type RequestedEditTargetResolution =
  | {
      status: 'open';
      record: QuarterlyFinancialRecord;
      normalizedTicker: string;
      focusField: string;
    }
  | {
      status: 'unauthorized' | 'not_found';
      messageAr: string;
    };

export function resolveRequestedQuarterlyEditTarget(input: {
  target: RequestedQuarterlyEditTarget;
  quarterlyRecords: QuarterlyFinancialRecord[];
  userRole: UserRole;
}): RequestedEditTargetResolution {
  const { target, quarterlyRecords, userRole } = input;
  const normTk = tryNormalizedTicker(target.ticker) ?? target.ticker.trim().toUpperCase();
  const fieldDesc = target.labelAr ? `${target.labelAr} (${target.field})` : target.field;
  const periodLabel = `${target.quarter} ${target.year}`;

  if (userRole !== 'admin' && userRole !== 'data_entry') {
    return {
      status: 'unauthorized',
      messageAr: `لا تملك صلاحية تعديل السجل المالي (${normTk} · ${periodLabel}) لاستكمال الحقل: ${fieldDesc}. يلزم دور مدير النظام أو مدخل البيانات.`,
    };
  }

  const matched = quarterlyRecords.find(
    (r) =>
      (tryNormalizedTicker(r.ticker) ?? r.ticker.trim().toUpperCase()) === normTk &&
      r.year === target.year &&
      r.quarter === target.quarter
  );

  if (!matched) {
    return {
      status: 'not_found',
      messageAr: `تعذر العثور على السجل المالي المطابق (${normTk} · ${periodLabel}) لتعديل الحقل: ${fieldDesc}. لم يُنشأ سجل بديل ولم يُبدَّل السهم المختار.`,
    };
  }

  return {
    status: 'open',
    record: matched,
    normalizedTicker: normTk,
    focusField: target.field,
  };
}

export const DataHubView: React.FC<DataHubViewProps> = ({
  selectedTicker,
  onSelectTicker,
  availableTickers,
  dailyRecords,
  dailySchemas = {},
  quarterlyRecords,
  betaAssumptions = [],
  dividendRecords = [],
  dividendYearStatuses = [],
  companyOverrides = [],
  macroParams = [],
  healthChecks,
  auditWarnings = [],
  requestedSubTab = null,
  onClearRequestedSubTab,
  universeDiagnostics,
  onImportDailyRecords,
  onImportQuarterlyRecords,
  onImportDividendRecords,
  onRequestPreviewDocs,
  onExecuteImportChunk,
  onImportCompleted,
  onDeleteQuarterlyRecord,
  onUpdateQuarterlyRecord,
  onUpdateDailyRecord,
  onDeleteDailyRecord,
  onUpdateDividendRecord,
  onDeleteDividendRecord,
  onSaveDividendYearStatus,
  onDeleteDividendYearStatus,
  onDeleteBetaAssumption,
  onDeleteCompanyOverride,
  requestedEditTarget = null,
  onClearRequestedEditTarget,
  userRole,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<DataHubSubTab>(
    requestedSubTab ?? (availableTickers.length === 0 ? 'uploaders' : 'health')
  );
  const [dailyUploadMsg, setDailyUploadMsg] = useState<string | null>(null);
  const [quarterlyUploadMsg, setQuarterlyUploadMsg] = useState<string | null>(null);
  const [dividendUploadMsg, setDividendUploadMsg] = useState<string | null>(null);
  const [generalUploadMsg, setGeneralUploadMsg] = useState<string | null>(null);

  // Import Preview & Chunked Batch State (Non-mutating until explicit confirm)
  const [previewBusy, setPreviewBusy] = useState(false);
  const [activePreview, setActivePreview] = useState<ImportPreviewResult<any> | null>(null);
  const [batchExecuting, setBatchExecuting] = useState(false);
  const [batchReport, setBatchReport] = useState<ImportBatchReport | null>(null);
  const [showAllRejected, setShowAllRejected] = useState(false);
  const [paramFilterScope, setParamFilterScope] = useState<'selected' | 'all'>('selected');
  const [dividendSemantics, setDividendSemantics] =
    useState<DividendDistributionSemantics>('standalone_event');
  const [dividendSemanticsConfirmed, setDividendSemanticsConfirmed] = useState(false);
  const [dividendApprovalDefault, setDividendApprovalDefault] =
    useState<DividendApprovalStatus>('proposed');
  const [dividendApprovalConfirmed, setDividendApprovalConfirmed] = useState(false);
  const [lastDividendFile, setLastDividendFile] = useState<File | null>(null);
  const [lastDividendExistingDocs, setLastDividendExistingDocs] = useState<Map<
    string,
    Record<string, any>
  > | null>(null);

  // Edit & Delete modal states
  const [editingRecord, setEditingRecord] = useState<QuarterlyFinancialRecord | null>(null);
  const [editingFocusField, setEditingFocusField] = useState<string | null>(null);
  const [editTargetNotice, setEditTargetNotice] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ ticker: string; year: number; quarter: string } | null>(null);
  const [editingDailyRecord, setEditingDailyRecord] = useState<DailyTradingRecord | null>(null);
  const [deleteDailyTarget, setDeleteDailyTarget] = useState<{ ticker: string; tradeDate: string } | null>(null);
  const [editingDividendRecord, setEditingDividendRecord] = useState<DividendRecord | null>(null);
  const [isAddingNewDividend, setIsAddingNewDividend] = useState(false);
  const [deleteDividendTarget, setDeleteDividendTarget] = useState<Pick<
    DividendRecord,
    'ticker' | 'fiscalYear' | 'recordType' | 'distributionId'
  > | null>(null);
  const [deleteBetaTarget, setDeleteBetaTarget] = useState<string | null>(null);
  const [deleteOverrideTarget, setDeleteOverrideTarget] = useState<{ ticker: string; key: string } | null>(null);

  const canEditQuarterly = userRole === 'admin' || userRole === 'data_entry';

  // Handle requestedSubTab routed from DashboardView -> App -> DataHubView
  useEffect(() => {
    if (!requestedSubTab) return;
    setActiveSubTab(requestedSubTab);
    onClearRequestedSubTab?.();
  }, [requestedSubTab, onClearRequestedSubTab]);

  const applyRequestedEditTarget = (
    target: RequestedQuarterlyEditTarget,
    options?: { switchToQuarterlyTableOnOpen?: boolean }
  ) => {
    const resolution = resolveRequestedQuarterlyEditTarget({
      target,
      quarterlyRecords,
      userRole,
    });
    if (resolution.status === 'open') {
      const currentNorm = tryNormalizedTicker(selectedTicker) ?? selectedTicker;
      if (currentNorm !== resolution.normalizedTicker) {
        onSelectTicker(resolution.normalizedTicker);
      }
      if (options?.switchToQuarterlyTableOnOpen) {
        setActiveSubTab('quarterly_table');
      }
      setEditTargetNotice(null);
      setEditingRecord(resolution.record);
      setEditingFocusField(resolution.focusField);
    } else {
      setEditingRecord(null);
      setEditingFocusField(null);
      setEditTargetNotice(resolution.messageAr);
    }
  };

  // Handle requestedEditTarget routed from MetricAuditCard / ValuationView -> App -> DataHubView
  useEffect(() => {
    if (!requestedEditTarget) return;
    setActiveSubTab('quarterly_table');
    applyRequestedEditTarget(requestedEditTarget, { switchToQuarterlyTableOnOpen: true });
    onClearRequestedEditTarget?.();
  }, [
    requestedEditTarget,
    quarterlyRecords,
    userRole,
    selectedTicker,
    onSelectTicker,
    onClearRequestedEditTarget,
  ]);

  // Filter records for selected ticker
  const selectedBaseTicker = tryNormalizedTicker(selectedTicker) ?? selectedTicker;
  const stockQuarterly = quarterlyRecords.filter(
    (q) => (tryNormalizedTicker(q.ticker) ?? q.ticker) === selectedBaseTicker
  );
  const stockDaily = dailyRecords.filter(
    (d) => (tryNormalizedTicker(d.ticker) ?? d.ticker) === selectedBaseTicker
  );
  const stockAuditWarnings = useMemo(() => {
    if (!selectedBaseTicker) return [];
    return auditWarnings.filter(
      (w) =>
        (tryNormalizedTicker(w.companyTicker) ?? w.companyTicker.trim().toUpperCase()) ===
        selectedBaseTicker
    );
  }, [auditWarnings, selectedBaseTicker]);

  const healthStatusCounts = useMemo(() => {
    const counts: Record<HealthCheckStatus, number> = {
      pass: 0,
      fail: 0,
      incomplete: 0,
      not_applicable: 0,
      warning: 0,
    };
    for (const item of healthChecks) {
      counts[item.status] = (counts[item.status] ?? 0) + 1;
    }
    return counts;
  }, [healthChecks]);

  const sortedBetaAssumptions = useMemo(
    () => [...betaAssumptions].sort((a, b) => a.ticker.localeCompare(b.ticker)),
    [betaAssumptions]
  );

  const visibleCompanyOverrides = useMemo(() => {
    const filtered =
      paramFilterScope === 'selected' && selectedBaseTicker
        ? companyOverrides.filter(
            (o) => (tryNormalizedTicker(o.ticker) ?? o.ticker) === selectedBaseTicker
          )
        : companyOverrides;
    return [...filtered].sort((a, b) =>
      a.ticker === b.ticker ? a.key.localeCompare(b.key) : a.ticker.localeCompare(b.ticker)
    );
  }, [companyOverrides, paramFilterScope, selectedBaseTicker]);

  const toBulkOpType = (sourceType: ImportSourceType): BulkOperationType => {
    if (sourceType === 'quarterly') return 'bulk_quarterly';
    if (sourceType === 'daily') return 'bulk_daily';
    if (sourceType === 'beta') return 'bulk_beta';
    if (sourceType === 'dividend') return 'bulk_dividend';
    return 'bulk_parameters';
  };

  const toChunkPayload = (
    sourceType: ImportSourceType,
    items: ImportPreviewItem<any>[]
  ): unknown[] => {
    if (sourceType !== 'parameters') {
      return items.map((i) => i.record);
    }
    return items.map((i) => {
      const p = i.record as ParsedParameterImportRow;
      const precondition =
        i.status === 'insert'
          ? ({ mode: 'create' } as const)
          : ({
              mode: 'update',
              expectedRevision: typeof i.baseRevision === 'number' ? i.baseRevision : null,
              expectedContentHash: i.existingHash ?? null,
            } as const);
      return buildParameterWritePayloadFromImport({
        key: p.key,
        nameAr: p.nameAr,
        value: p.value,
        valueType: p.valueType,
        isPercentage: p.isPercentage,
        description: p.description,
        scope: p.scope,
        ticker: p.ticker,
        unit: p.unit,
        currency: p.currency,
        forecastHorizonYears: p.forecastHorizonYears,
        rfMethodology: p.rfMethodology,
        asOfDate: p.asOfDate,
        source: p.source,
        sourceRow: p.sourceRow,
        precondition,
      });
    });
  };

  const prepareSourcePreview = async (
    sourceType: ImportSourceType,
    file: File,
    overrideSemantics?: DividendDistributionSemantics,
    cachedExistingDocs?: Map<string, Record<string, any>> | null,
    overrideApproval?: DividendApprovalStatus
  ) => {
    setPreviewBusy(true);
    setGeneralUploadMsg(null);
    setDividendUploadMsg(null);
    setBatchReport(null);
    setShowAllRejected(false);
    if (sourceType === 'dividend') {
      setDividendSemanticsConfirmed(false);
      setDividendApprovalConfirmed(false);
    }

    try {
      let sheetName = '';
      let totalRows = 0;
      let tradeDate: string | null | undefined = null;
      let dailySchema: DailyTradingSchemaRecord | null = null;
      let parsedRecords: any[] = [];
      let rejected: ImportPreviewResult<any>['rejected'] = [];
      let warnings: string[] = [];
      let requiresSemanticsConfirmation: boolean | undefined;
      let defaultSemanticsUsed: DividendDistributionSemantics | undefined;
      let requiresApprovalConfirmation: boolean | undefined;
      let rowsMissingApprovalCount: number | undefined;

      if (sourceType === 'daily') {
        const res = await parseDailyTradingExcelDetailed(file);
        sheetName = res.sheetName;
        totalRows = res.totalRows;
        tradeDate = res.tradeDate;
        dailySchema = res.dailySchema ?? null;
        parsedRecords = res.records;
        rejected = res.rejected;
        warnings = res.warnings;
      } else if (sourceType === 'quarterly') {
        const res = await parseQuarterlyFinancialsExcelDetailed(file);
        sheetName = res.sheetName;
        totalRows = res.totalRows;
        parsedRecords = res.records;
        rejected = res.rejected;
        warnings = res.warnings;
      } else if (sourceType === 'beta') {
        const res = await parseBetaAssumptionsExcelFile(file);
        sheetName = res.sheetName;
        totalRows = res.totalRows;
        parsedRecords = res.records;
        rejected = res.rejected;
        warnings = res.warnings;
      } else if (sourceType === 'dividend') {
        const effSemantics = overrideSemantics ?? dividendSemantics;
        const effApproval = overrideApproval ?? dividendApprovalDefault;
        setLastDividendFile(file);
        const res = await parseDpsActualExcelFile(file, {
          defaultSemantics: effSemantics,
          defaultApprovalStatus: effApproval,
        });
        sheetName = res.sheetName;
        totalRows = res.totalRows;
        parsedRecords = res.records;
        rejected = res.rejected;
        warnings = res.warnings;
        requiresSemanticsConfirmation = res.requiresSemanticsConfirmation;
        defaultSemanticsUsed = res.defaultSemanticsUsed ?? effSemantics;
        requiresApprovalConfirmation = res.requiresApprovalConfirmation;
        rowsMissingApprovalCount = res.rowsMissingApprovalCount;
      } else {
        const res = await parseAllParametersExcelFile(file);
        sheetName = res.sheetName;
        totalRows = res.totalRows;
        parsedRecords = res.records;
        rejected = res.rejected;
        warnings = res.warnings;
      }

      // مسار المعاينة والتنفيذ بالدفعات إذا توفرت خدمات Firestore
      if (onRequestPreviewDocs && onExecuteImportChunk) {
        const existingDocsMap =
          sourceType === 'dividend' && cachedExistingDocs
            ? cachedExistingDocs
            : await onRequestPreviewDocs(sourceType);
        if (sourceType === 'dividend') {
          setLastDividendExistingDocs(existingDocsMap);
        }
        const preview = buildImportPreview({
          sourceType,
          fileName: file.name,
          sheetName,
          tradeDate,
          dailySchema,
          totalRows,
          parsedRecords,
          rejected,
          warnings,
          existingDocsMap,
          requiresSemanticsConfirmation,
          defaultSemanticsUsed,
          requiresApprovalConfirmation,
          rowsMissingApprovalCount,
        });
        setActivePreview(preview);
        return;
      }

      // مسار توافق قديم إذا لم تُمرر دوال المعاينة
      if (rejected.length > 0) {
        const first = rejected[0];
        throw new Error(`صف ${first.rowNumber} (${first.column}): ${first.reasonAr}`);
      }
      if (sourceType === 'daily' && parsedRecords.length > 0) {
        await onImportDailyRecords(parsedRecords, tradeDate || '');
        setDailyUploadMsg(`تم استيراد ${parsedRecords.length} شركة لتاريخ تداول (${tradeDate}) بنجاح!`);
      } else if (sourceType === 'quarterly' && parsedRecords.length > 0) {
        await onImportQuarterlyRecords(parsedRecords);
        setQuarterlyUploadMsg(`تم استيراد وتحديث ${parsedRecords.length} فترة ربع سنوية بنجاح!`);
      } else if (sourceType === 'dividend' && parsedRecords.length > 0 && onImportDividendRecords) {
        await onImportDividendRecords(parsedRecords);
        setDividendUploadMsg(`تم استيراد وتحديث ${parsedRecords.length} سجل توزيع نقدي بنجاح!`);
      } else {
        setGeneralUploadMsg('تتطلب عملية استيراد بيتا والمعاملات والتوزيعات تفعيل مسار المعاينة السحابي.');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'تعذر تحليل الملف أو مقارنته مع Firestore.';
      if (sourceType === 'daily') setDailyUploadMsg(msg);
      else if (sourceType === 'quarterly') setQuarterlyUploadMsg(msg);
      else if (sourceType === 'dividend') setDividendUploadMsg(msg);
      else setGeneralUploadMsg(msg);
    } finally {
      setPreviewBusy(false);
    }
  };

  const handleChangeDividendSemantics = async (nextSemantics: DividendDistributionSemantics) => {
    setDividendSemantics(nextSemantics);
    setDividendSemanticsConfirmed(false);
    if (lastDividendFile && activePreview?.sourceType === 'dividend') {
      await prepareSourcePreview(
        'dividend',
        lastDividendFile,
        nextSemantics,
        lastDividendExistingDocs,
        dividendApprovalDefault
      );
    }
  };

  const handleChangeDividendApprovalDefault = async (nextApproval: DividendApprovalStatus) => {
    setDividendApprovalDefault(nextApproval);
    setDividendApprovalConfirmed(false);
    if (lastDividendFile && activePreview?.sourceType === 'dividend') {
      await prepareSourcePreview(
        'dividend',
        lastDividendFile,
        dividendSemantics,
        lastDividendExistingDocs,
        nextApproval
      );
    }
  };

  const handleSourceFileChange =
    (sourceType: ImportSourceType) => async (e: React.ChangeEvent<HTMLInputElement>) => {
      const inputEl = e.target;
      const file = inputEl.files?.[0];
      if (!file) return;
      await prepareSourcePreview(sourceType, file);
      inputEl.value = '';
    };

  const handleConfirmOrResumeBatches = async (resumeFromFailed: boolean) => {
    if (!activePreview || !onExecuteImportChunk) return;
    setBatchExecuting(true);
    setGeneralUploadMsg(null);
    const opType = toBulkOpType(activePreview.sourceType);
    const startIdx = resumeFromFailed ? (batchReport?.failedBatchIndex ?? 0) : 0;
    const prior = resumeFromFailed ? batchReport : null;

    try {
      const report = await executeChunkedImportBatches({
        preview: activePreview,
        startChunkIndex: startIdx,
        priorReport: prior,
        sendChunk: async (chunkItems, chunkIndex) => {
          const payload = toChunkPayload(activePreview.sourceType, chunkItems);
          return onExecuteImportChunk(opType, payload, {
            importId: activePreview.importId,
            sourceFile: activePreview.fileName,
            sourceSheet: activePreview.sheetName,
            chunkIndex,
            dailySchema: chunkIndex === startIdx ? (activePreview.dailySchema ?? null) : null,
          });
        },
        onProgress: (r) => setBatchReport(r),
      });
      setBatchReport(report);
      if (report.failedBatchIndex === null) {
        setGeneralUploadMsg(
          `اكتمل اعتماد ${activePreview.fileName}: إضافة ${report.insertedCount} · تحديث ${report.updatedCount} · تجاهل ${report.skippedUnchangedCount} دون تغيير.`
        );
        await onImportCompleted?.();
      }
    } finally {
      setBatchExecuting(false);
    }
  };

  const confirmDelete = async () => {
    try {
      if (!deleteTarget) return;
      await onDeleteQuarterlyRecord(deleteTarget.ticker, deleteTarget.year, deleteTarget.quarter);
      setDeleteTarget(null);
    } catch (err) {
      setQuarterlyUploadMsg(err instanceof Error ? err.message : 'تعذر الحذف.');
    }
  };

  return (
    <div className="space-y-6">
      {editTargetNotice && (
        <div
          role="alert"
          data-testid="edit-target-notice"
          className="flex items-start justify-between gap-3 text-xs text-red-200 bg-red-950/60 border border-red-800/70 rounded-xl p-3"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <span>{editTargetNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => setEditTargetNotice(null)}
            className="text-red-300 hover:text-white p-0.5"
            aria-label="إغلاق التنبيه"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      {dailyUploadMsg && (
        <p role="status" className="text-xs text-amber-300 bg-slate-900 border border-slate-800 rounded-xl p-3">
          {dailyUploadMsg}
        </p>
      )}
      {quarterlyUploadMsg && (
        <p role="status" className="text-xs text-amber-300 bg-slate-900 border border-slate-800 rounded-xl p-3">
          {quarterlyUploadMsg}
        </p>
      )}
      {generalUploadMsg && (
        <p role="status" className="text-xs text-emerald-300 bg-slate-900 border border-emerald-800/70 rounded-xl p-3">
          {generalUploadMsg}
        </p>
      )}
      {/* 1. Header Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Database className="w-5 h-5 text-emerald-400" />
              <h2 className="text-xl font-bold text-white">
                مركز إدارة البيانات ومحرك الفحص الـ 9 (Data Hub & Health Engine)
              </h2>
            </div>
            <p className="text-xs text-slate-400 mt-1 max-w-3xl leading-relaxed">
              استيراد ومعاينة المصادر الخمسة المعتمدة (التداول اليومي، القوائم الربع سنوية، التوزيعات الفعلية DPS_Actual، Beta_Assumptions، وAll_Parameters) مع التحقق الصارم والتنفيذ المجزأ الخادمي.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => void downloadQuarterlyFcffTemplate()}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-teal-400" />
              قالب القوائم FCFF
            </button>
            <button
              type="button"
              onClick={() => void downloadDpsActualTemplate()}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
              قالب DPS_Actual
            </button>
            <button
              type="button"
              onClick={() => void downloadBetaAssumptionsTemplate()}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-sky-400" />
              قالب Beta
            </button>
            <button
              type="button"
              onClick={() => void downloadAllParametersTemplate()}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-amber-400" />
              قالب All_Parameters
            </button>
            <button
              type="button"
              disabled={(macroParams?.length ?? 0) + (companyOverrides?.length ?? 0) === 0}
              onClick={() => void exportAllParametersToExcel({ macroParams, companyOverrides })}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-amber-200 border border-slate-700"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-amber-300" />
              تصدير المعاملات
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex flex-wrap items-center gap-2 mt-4 pt-3 border-t border-slate-800 text-xs">
          <button
            type="button"
            data-testid="datahub-tab-health"
            onClick={() => setActiveSubTab('health')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg font-semibold transition-all ${
              activeSubTab === 'health'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            فحص جودة واكتمال بيانات السهم ({healthChecks.length} قواعد)
          </button>

          <button
            type="button"
            data-testid="datahub-tab-audit-warnings"
            onClick={() => setActiveSubTab('audit_warnings')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg font-semibold transition-all ${
              activeSubTab === 'audit_warnings'
                ? 'bg-amber-600 text-white shadow-sm'
                : stockAuditWarnings.length > 0
                ? 'text-amber-300 bg-amber-950/30 border border-amber-800/60 hover:bg-amber-950/60'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>ملاحظات التدقيق المحاسبي</span>
            <span
              data-testid="datahub-tab-audit-warnings-count"
              className={`font-mono px-1.5 py-0.5 rounded text-[11px] ${
                activeSubTab === 'audit_warnings'
                  ? 'bg-amber-900/70 text-white'
                  : stockAuditWarnings.length > 0
                  ? 'bg-amber-900/70 text-amber-200'
                  : 'bg-slate-800 text-slate-300'
              }`}
            >
              {stockAuditWarnings.length}
            </span>
          </button>

          <button
            onClick={() => setActiveSubTab('uploaders')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg font-semibold transition-all ${
              activeSubTab === 'uploaders'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <Upload className="w-3.5 h-3.5" />
            استيراد المصادر الخمسة (معاينة + دفعات)
          </button>

          <button
            onClick={() => setActiveSubTab('quarterly_table')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg font-semibold transition-all ${
              activeSubTab === 'quarterly_table'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            جدول القوائم الربع سنوية ({stockQuarterly.length})
          </button>

          <button
            onClick={() => setActiveSubTab('daily_table')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg font-semibold transition-all ${
              activeSubTab === 'daily_table'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            سجل التداول اليومي ({stockDaily.length})
          </button>

          <button
            onClick={() => setActiveSubTab('dividend_table')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg font-semibold transition-all ${
              activeSubTab === 'dividend_table'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <Coins className="w-3.5 h-3.5" />
            سجل التوزيعات DPS_Actual ({dividendRecords.length})
          </button>

          <button
            onClick={() => setActiveSubTab('beta_table')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg font-semibold transition-all ${
              activeSubTab === 'beta_table'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            افتراضات بيتا ({betaAssumptions.length})
          </button>

          <button
            onClick={() => setActiveSubTab('parameters_table')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg font-semibold transition-all ${
              activeSubTab === 'parameters_table'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            تخصيصات الشركات ({companyOverrides.length})
          </button>
        </div>
      </div>

      {/* 2. SUBTAB 1: 9-Pillar Data Health Scorecard */}
      {activeSubTab === 'health' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-800 pb-3 gap-2">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Activity className="w-4 h-4 text-emerald-400" />
                <span>مصفوفة فحص جودة واكتمال بيانات السهم — {selectedTicker}</span>
              </h3>
              <p className="text-[11px] text-slate-400 mt-0.5">
                تطبيق دقيق لمعادلات الفحص المحاسبي التسع المعتمدة: السلامة · الاكتمال · الاتساق · المنطق · التقييم
              </p>
            </div>

            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-400">السهم المحدد:</span>
              <select
                value={selectedTicker}
                onChange={(e) => onSelectTicker(e.target.value)}
                disabled={availableTickers.length === 0}
                className="bg-slate-950 border border-slate-700 rounded-lg p-1.5 font-mono text-emerald-400 font-bold disabled:opacity-60"
              >
                {availableTickers.length === 0 ? (
                  <option value="">لا يوجد أسهم مسجلة</option>
                ) : (
                  availableTickers.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))
                )}
              </select>
            </div>
          </div>

          {/* Separate Cross-Link Notice when Accounting Audit Warnings exist */}
          {stockAuditWarnings.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-800/70 bg-amber-950/25 px-3.5 py-2.5 text-xs text-amber-200">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-amber-400 shrink-0" />
                <span>
                  رصد محرك التدقيق المحاسبي{' '}
                  <strong className="font-mono">{stockAuditWarnings.length}</strong> ملاحظة مستقلة عن قواعد الفحص الـ 9 أعلاه.
                </span>
              </div>
              <button
                type="button"
                onClick={() => setActiveSubTab('audit_warnings')}
                className="px-3 py-1 rounded-lg bg-amber-900/60 hover:bg-amber-800/80 text-amber-100 border border-amber-700/80 font-semibold"
              >
                فتح قسم ملاحظات التدقيق ←
              </button>
            </div>
          )}

          {/* Central Health Status Summary Strip */}
          <div className="flex flex-wrap items-center gap-2 text-[11px] bg-slate-950/70 border border-slate-800 rounded-xl px-3.5 py-2">
            <span className="text-slate-400 font-semibold">
              ملخص قواعد الفحص ({healthChecks.length}):
            </span>
            {(['pass', 'fail', 'incomplete', 'not_applicable', 'warning'] as HealthCheckStatus[]).map(
              (st) => (
                <span
                  key={st}
                  className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-300"
                >
                  {HEALTH_CHECK_STATUS_META[st].shortLabelAr}:{' '}
                  <strong className="font-mono text-white">{healthStatusCounts[st]}</strong>
                </span>
              )
            )}
          </div>

          {/* Health Checks Grid Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-start">
              <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="p-3 text-start">م</th>
                  <th className="p-3 text-start">اسم الفحص المحاسبي</th>
                  <th className="p-3 text-center">البعد المالي</th>
                  <th className="p-3 text-center font-mono">الشرط المحاسبي (DAX Rule)</th>
                  <th className="p-3 text-end font-mono">القيمة الحالية المرصودة</th>
                  <th className="p-3 text-center">حالة الفحص</th>
                  <th className="p-3 text-start">التفسير والنتيجة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 bg-slate-900/60">
                {healthChecks.map((check) => (
                  <tr key={check.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="p-3 font-mono text-slate-500">{check.order}</td>
                    <td className="p-3 font-bold text-slate-100">{check.name}</td>
                    <td className="p-3 text-center">
                      <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300 text-[10px]">
                        {check.category}
                      </span>
                    </td>
                    <td className="p-3 text-center font-mono text-slate-400 text-[11px]">
                      {check.expectedRule}
                    </td>
                    <td className="p-3 text-end font-mono text-slate-200 font-semibold">
                      {check.actualValue}
                    </td>
                    <td className="p-3 text-center">
                      <HealthBadge status={check.status} />
                    </td>
                    <td className="p-3 text-slate-400 text-[11px] leading-relaxed">
                      {check.detailsAr}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 2B. SUBTAB: Independent Accounting Audit Warnings Panel */}
      {activeSubTab === 'audit_warnings' && (
        <AccountingAuditWarningsPanel
          selectedTicker={selectedTicker}
          availableTickers={availableTickers}
          onSelectTicker={onSelectTicker}
          warnings={auditWarnings}
          quarterlyRecords={quarterlyRecords}
          userRole={userRole}
          onRequestEditTarget={(target) =>
            applyRequestedEditTarget(target, { switchToQuarterlyTableOnOpen: false })
          }
        />
      )}

      {/* 3. SUBTAB 2: 5-Source Excel Uploaders + Non-Mutating Preview & Chunked Batch Runner */}
      {activeSubTab === 'uploaders' && (
        <ImportWorkflowPanel
          userRole={userRole}
          previewBusy={previewBusy}
          batchExecuting={batchExecuting}
          activePreview={activePreview}
          batchReport={batchReport}
          showAllRejected={showAllRejected}
          dailyUploadMsg={dailyUploadMsg}
          quarterlyUploadMsg={quarterlyUploadMsg}
          dividendUploadMsg={dividendUploadMsg}
          dividendSemantics={dividendSemantics}
          dividendSemanticsConfirmed={dividendSemanticsConfirmed}
          dividendApprovalDefault={dividendApprovalDefault}
          dividendApprovalConfirmed={dividendApprovalConfirmed}
          onChangeDividendSemantics={(sem) => void handleChangeDividendSemantics(sem)}
          onChangeDividendSemanticsConfirmed={setDividendSemanticsConfirmed}
          onChangeDividendApprovalDefault={(st) => void handleChangeDividendApprovalDefault(st)}
          onChangeDividendApprovalConfirmed={setDividendApprovalConfirmed}
          onToggleShowAllRejected={() => setShowAllRejected((p) => !p)}
          onClosePreview={() => {
            setActivePreview(null);
            setBatchReport(null);
            setDividendSemanticsConfirmed(false);
            setDividendApprovalConfirmed(false);
          }}
          onSelectFile={handleSourceFileChange}
          onConfirmOrResumeBatches={(resumeFromFailed) => void handleConfirmOrResumeBatches(resumeFromFailed)}
        />
      )}

      {universeDiagnostics &&
        (universeDiagnostics.excludedNonEquity.length > 0 ||
          universeDiagnostics.metadataConflicts.length > 0 ||
          universeDiagnostics.unmappedSectors.length > 0) && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 text-[11px] text-slate-300 flex flex-wrap items-center justify-between gap-2">
            <span>
              تشخيص سجل الأوراق المالية: مستبعد غير أسهم ({universeDiagnostics.excludedNonEquity.length}) · تعارضات وصفية/ISIN ({universeDiagnostics.metadataConflicts.length}) · قطاعات غير مربوطة ({universeDiagnostics.unmappedSectors.length})
            </span>
          </div>
        )}

      {/* 4. SUBTAB 3: Quarterly Records Grid */}
      {activeSubTab === 'quarterly_table' && (
        <QuarterlyRecordsTable
          selectedTicker={selectedTicker}
          records={stockQuarterly}
          userRole={userRole}
          onRequestEdit={(rec) => {
            if (!canEditQuarterly) {
              setEditTargetNotice(
                `لا تملك صلاحية تعديل القوائم الربع سنوية (${rec.ticker} · ${rec.quarter} ${rec.year}). يلزم دور مدير النظام أو مدخل البيانات.`
              );
              return;
            }
            setEditTargetNotice(null);
            setEditingFocusField(null);
            setEditingRecord(rec);
          }}
          onRequestDelete={setDeleteTarget}
          onExportQuarterlyExcel={() =>
            void exportQuarterlyRecordsToExcel(stockQuarterly, selectedBaseTicker || selectedTicker)
          }
        />
      )}

      {/* 5. SUBTAB 4: Daily Trading Records Table */}
      {activeSubTab === 'daily_table' && (
        <DailyTradingTable
          selectedTicker={selectedTicker}
          records={stockDaily}
          dailySchemas={dailySchemas}
          userRole={userRole}
          onRequestEdit={setEditingDailyRecord}
          onRequestDelete={setDeleteDailyTarget}
          onExportDailyExcel={() =>
            void exportDailyTradingToExcel(stockDaily, dailySchemas, selectedBaseTicker || selectedTicker)
          }
        />
      )}

      {/* 5b. SUBTAB 4b: Dividend Records Table (DPS_Actual) */}
      {activeSubTab === 'dividend_table' && (
        <DividendRecordsTable
          records={dividendRecords}
          dividendYearStatuses={dividendYearStatuses}
          availableTickers={availableTickers}
          selectedBaseTicker={selectedBaseTicker}
          userRole={userRole}
          canEdit={Boolean(onUpdateDividendRecord) && (userRole === 'admin' || userRole === 'data_entry')}
          onRequestAdd={() => {
            setEditingDividendRecord(null);
            setIsAddingNewDividend(true);
          }}
          onRequestEdit={(rec) => {
            setIsAddingNewDividend(false);
            setEditingDividendRecord(rec);
          }}
          onRequestDelete={(target) => setDeleteDividendTarget(target)}
          onSaveDividendYearStatus={onSaveDividendYearStatus}
          onDeleteDividendYearStatus={onDeleteDividendYearStatus}
        />
      )}

      {/* 6. SUBTAB 5: Beta Assumptions Table */}
      {activeSubTab === 'beta_table' && (
        <BetaAssumptionsTable
          records={sortedBetaAssumptions}
          selectedBaseTicker={selectedBaseTicker}
          userRole={userRole}
          canDelete={Boolean(onDeleteBetaAssumption)}
          onRequestDelete={(tk) => setDeleteBetaTarget(tk)}
        />
      )}

      {/* 7. SUBTAB 6: Company Parameter Overrides Table */}
      {activeSubTab === 'parameters_table' && (
        <CompanyOverridesTable
          visibleOverrides={visibleCompanyOverrides}
          totalCount={companyOverrides.length}
          selectedBaseTicker={selectedBaseTicker}
          filterScope={paramFilterScope}
          userRole={userRole}
          canDelete={Boolean(onDeleteCompanyOverride)}
          onChangeFilterScope={setParamFilterScope}
          onRequestDelete={(target) => setDeleteOverrideTarget(target)}
        />
      )}

      {/* Confirm Delete Quarterly Record Modal */}
      <ConfirmDeleteModal
        isOpen={!!deleteTarget}
        title="تأكيد حذف القائمة الربع سنوية"
        itemName={deleteTarget ? `${deleteTarget.ticker} (${deleteTarget.quarter} ${deleteTarget.year})` : ''}
        cascadeImpacts={[
          'إلغاء احتساب مؤشرات TTM التراكمية المعتمدة على هذا الربع فوراً.',
          'تحديث نتائج نماذج DCF و RIM و Graham المرتبطة بأرباح وتدفقات هذا الربع.',
          'حذف السجل نهائياً من الذاكرة المحلية وقاعدة البيانات السحابية.',
        ]}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* Confirm Delete Daily Record Modal */}
      <ConfirmDeleteModal
        isOpen={!!deleteDailyTarget}
        title="تأكيد حذف سجل التداول اليومي"
        itemName={deleteDailyTarget ? `${deleteDailyTarget.ticker} (${deleteDailyTarget.tradeDate})` : ''}
        cascadeImpacts={[
          'إلغاء بيانات السيولة وأحجام التداول المسجلة لهذا اليوم.',
          'تحديث حسابات متوسطات الأحجام لـ 5 و 30 و 90 يوماً.',
          'حذف السجل نهائياً من قاعدة البيانات السحابية والكاش المحلي.',
        ]}
        onConfirm={async () => {
          try {
            if (deleteDailyTarget && onDeleteDailyRecord) {
              await onDeleteDailyRecord(deleteDailyTarget.ticker, deleteDailyTarget.tradeDate);
            }
            setDeleteDailyTarget(null);
          } catch (err) {
            setDailyUploadMsg(err instanceof Error ? err.message : 'تعذر الحذف.');
          }
        }}
        onCancel={() => setDeleteDailyTarget(null)}
      />

      {/* Edit Quarterly Record Modal */}
      {editingRecord && (
        <EditQuarterlyRecordModal
          key={`${editingRecord.ticker}_${editingRecord.year}_${editingRecord.quarter}`}
          isOpen={true}
          record={editingRecord}
          focusField={editingFocusField}
          onClose={() => {
            setEditingRecord(null);
            setEditingFocusField(null);
          }}
          onSave={async (updated, writePayload) => {
            try {
              if (onUpdateQuarterlyRecord) {
                await onUpdateQuarterlyRecord(updated, writePayload);
              }
              setEditingRecord(null);
              setEditingFocusField(null);
            } catch (err) {
              setQuarterlyUploadMsg(err instanceof Error ? err.message : 'تعذر الحفظ.');
              throw err;
            }
          }}
        />
      )}

      {/* Edit Daily Record Modal (Dynamic Columns) */}
      {editingDailyRecord && (
        <EditDailyRecordModal
          isOpen={true}
          record={editingDailyRecord}
          dailySchema={editingDailyRecord.schemaId ? dailySchemas[editingDailyRecord.schemaId] ?? null : null}
          onClose={() => setEditingDailyRecord(null)}
          onSave={async (updated) => {
            try {
              if (onUpdateDailyRecord) {
                await onUpdateDailyRecord(updated);
              }
              setEditingDailyRecord(null);
            } catch (err) {
              setDailyUploadMsg(err instanceof Error ? err.message : 'تعذر الحفظ.');
            }
          }}
        />
      )}

      {/* Edit / Add Dividend Record Modal */}
      {(editingDividendRecord || isAddingNewDividend) && (
        <EditDividendRecordModal
          isOpen={true}
          record={editingDividendRecord}
          defaultTicker={selectedBaseTicker}
          isNew={isAddingNewDividend}
          onClose={() => {
            setEditingDividendRecord(null);
            setIsAddingNewDividend(false);
          }}
          onSave={async (saved) => {
            try {
              if (onUpdateDividendRecord) {
                await onUpdateDividendRecord(saved);
              }
              setEditingDividendRecord(null);
              setIsAddingNewDividend(false);
            } catch (err) {
              setDividendUploadMsg(err instanceof Error ? err.message : 'تعذر حفظ سجل التوزيع.');
              throw err;
            }
          }}
        />
      )}

      {/* Confirm Delete Dividend Modal */}
      <ConfirmDeleteModal
        isOpen={!!deleteDividendTarget}
        title="تأكيد حذف سجل التوزيع النقدي"
        itemName={
          deleteDividendTarget
            ? `${deleteDividendTarget.ticker} (${deleteDividendTarget.fiscalYear} · ${deleteDividendTarget.recordType} · ${deleteDividendTarget.distributionId})`
            : ''
        }
        cascadeImpacts={[
          'حذف سجل التوزيع من مجموعة dividend_records وإنشاء شاهد حذف (tombstone).',
          'إعادة احتساب التوزيع العادي/الاستثنائي ونموذج DDM ونسبة الاحتجاز التاريخية للسهم فوراً.',
        ]}
        onConfirm={async () => {
          try {
            if (deleteDividendTarget && onDeleteDividendRecord) {
              await onDeleteDividendRecord(deleteDividendTarget);
            }
            setDeleteDividendTarget(null);
          } catch (err) {
            setGeneralUploadMsg(err instanceof Error ? err.message : 'تعذر حذف سجل التوزيع.');
          }
        }}
        onCancel={() => setDeleteDividendTarget(null)}
      />

      {/* Confirm Delete Beta Modal */}
      <ConfirmDeleteModal
        isOpen={!!deleteBetaTarget}
        title="تأكيد حذف سجل بيتا التاريخية"
        itemName={deleteBetaTarget ?? ''}
        cascadeImpacts={[
          'حذف سجل بيتا من مجموعة beta_assumptions وإنشاء شاهد حذف (tombstone).',
          'عند غياب السجل بعد التأكيد من الخادم قد تعود السياسة إلى Beta_Default (1.00) أو يتغير Ke/WACC.',
        ]}
        onConfirm={async () => {
          try {
            if (deleteBetaTarget && onDeleteBetaAssumption) {
              await onDeleteBetaAssumption(deleteBetaTarget);
            }
            setDeleteBetaTarget(null);
          } catch (err) {
            setGeneralUploadMsg(err instanceof Error ? err.message : 'تعذر حذف سجل بيتا.');
          }
        }}
        onCancel={() => setDeleteBetaTarget(null)}
      />

      {/* Confirm Delete Company Override Modal */}
      <ConfirmDeleteModal
        isOpen={!!deleteOverrideTarget}
        title="تأكيد حذف تخصيص معامل الشركة"
        itemName={deleteOverrideTarget ? `${deleteOverrideTarget.ticker} / ${deleteOverrideTarget.key}` : ''}
        cascadeImpacts={[
          'حذف تخصيص الشركة من company_assumptions وإرجاع التقييم إلى المعامل العام المعتمد في macro_params إن وُجد.',
        ]}
        onConfirm={async () => {
          try {
            if (deleteOverrideTarget && onDeleteCompanyOverride) {
              await onDeleteCompanyOverride(deleteOverrideTarget.ticker, deleteOverrideTarget.key);
            }
            setDeleteOverrideTarget(null);
          } catch (err) {
            setGeneralUploadMsg(err instanceof Error ? err.message : 'تعذر حذف تخصيص المعامل.');
          }
        }}
        onCancel={() => setDeleteOverrideTarget(null)}
      />
    </div>
  );
};
