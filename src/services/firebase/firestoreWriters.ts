/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from './firebaseConfig';
import {
  BetaAssumptionRecord,
  Company,
  CompanyMetadataPatch,
  CompanyParameterOverride,
  DecisionItem,
  InvestmentStory,
  SectorDefinition,
  TradeLog,
} from '../../types/financial';
import {
  DailyTradingRecord,
  DailyTradingSchemaRecord,
  DividendRecord,
  DividendYearStatusRecord,
  MacroParameter,
  QuarterlyFinancialRecord,
  QuarterlyFinancialRecordWritePayload,
} from '../../types';
import { CacheService } from '../storage/cacheService';
import { FirestoreSyncManager } from './firestoreSync';
import {
  buildDividendYearStatusDocId,
  buildMacroParameterWritePayload,
  deriveSectorPEMapFromDefinitions,
  estimateJsonUtf8Bytes,
  getParameterDefinition,
  getSafeChunkSizeForSource,
  getValuationLabField,
  normalizeMacroParameterFromFirestore,
  MAX_BATCH_PAYLOAD_BYTES,
  normalizedTicker,
  ParameterConcurrencyConflictError,
  ParameterConcurrencyConflictItem,
  ParameterWritePrecondition,
  SavedParameterConfirmation,
  SectorDefinitionPayload,
  SectorDeletePayload,
  SectorMutationReport,
  SectorStatusTogglePayload,
  splitItemsIntoByteSafeChunks,
  validateSectorDefinitionPayload,
  validateSectorDeletePayload,
  validateSectorPEPayload,
  validateSectorStatusTogglePayload,
  validateValuationLabFieldValue,
} from '../../core/contracts';
import type { BatchWriteChunkResponse } from '../../core/imports';

export interface FinancialCallableResponse {
  success?: boolean;
  processedCount?: number;
  insertedCount?: number;
  updatedCount?: number;
  skippedUnchangedCount?: number;
  savedParameters?: SavedParameterConfirmation[];
  sectorReport?: SectorMutationReport;
  updatedAt?: string;
  serverEpochMs?: number;
}

export function extractParameterConcurrencyConflicts(
  error: unknown
): ParameterConcurrencyConflictItem[] | null {
  if (error instanceof ParameterConcurrencyConflictError) {
    return error.conflicts;
  }
  if (!error || typeof error !== 'object') return null;
  const details = (error as { details?: unknown }).details;
  if (!details || typeof details !== 'object') return null;
  const typed = details as { code?: unknown; conflicts?: unknown };
  if (
    typed.code === 'parameter-concurrency-conflict' &&
    Array.isArray(typed.conflicts) &&
    typed.conflicts.length > 0
  ) {
    return typed.conflicts as ParameterConcurrencyConflictItem[];
  }
  return null;
}

export interface ParameterSaveReceipt {
  docPath: string;
  scope: 'company' | 'global' | 'beta_assumptions';
  key: string;
  ticker?: string;
  value: number;
  response: FinancialCallableResponse;
}

export interface SaveCompanyOverrideInput {
  ticker: string;
  key: string;
  value: number;
  source?: string;
  asOfDate?: string;
  description?: string;
  unit?: string;
  currency?: string;
  forecastHorizonYears?: number | null;
  rfMethodology?: string;
}

export function sanitizeForFirestore<T extends Record<string, any>>(obj: T): Record<string, any> {
  const clean = (value: any): any => {
    if (Array.isArray(value)) return value.map((v) => (v === undefined ? null : clean(v)));
    if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
      return Object.fromEntries(
        Object.entries(value)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [k, clean(v)])
      );
    }
    return value;
  };
  return clean(obj);
}

/**
 * بوابة الكتابة الموثقة الوحيدة عبر Cloud Functions (updateFinancialData).
 * لا تُجري أي كتابة مباشرة على المجموعات المالية أو الإدارية من المتصفح،
 * ولا تقدم مؤشر الدلتا من ساعة العميل أو من استجابة الكتابة.
 */
export class FirestoreWriters {
  private static async callFinancialWrite(
    operationType: string,
    data?: unknown,
    extra: Record<string, unknown> = {}
  ): Promise<FinancialCallableResponse> {
    const startScopeKey = CacheService.getScopeKey();
    const call = httpsCallable(getFunctions(app, 'us-central1'), 'updateFinancialData');
    let result;
    try {
      result = await call({
        operationType,
        ...(data === undefined ? {} : { data: sanitizeForFirestore({ value: data }).value }),
        ...extra,
      });
    } catch (error) {
      const conflicts = extractParameterConcurrencyConflicts(error);
      if (conflicts) {
        const msg = error instanceof Error ? error.message : undefined;
        throw new ParameterConcurrencyConflictError(conflicts, msg);
      }
      throw error;
    }
    const resData = (result.data || {}) as FinancialCallableResponse;
    if (!resData.success) {
      throw new Error('لم يؤكد الخادم حفظ البيانات.');
    }
    if (CacheService.getScopeKey() === startScopeKey) {
      FirestoreSyncManager.recordUserWriteNow();
    }
    return resData;
  }

  private static async financialWrite(
    operationType: string,
    data?: unknown,
    extra: Record<string, unknown> = {}
  ): Promise<void> {
    await this.callFinancialWrite(operationType, data, extra);
  }

  private static async bulkFinancialWrite(
    operationType: 'bulk_quarterly' | 'bulk_daily' | 'bulk_beta' | 'bulk_parameters' | 'bulk_dividend',
    records: unknown[]
  ): Promise<FinancialCallableResponse[]> {
    const chunkSize =
      operationType === 'bulk_quarterly'
        ? getSafeChunkSizeForSource('quarterly')
        : operationType === 'bulk_daily'
        ? getSafeChunkSizeForSource('daily')
        : operationType === 'bulk_beta'
        ? getSafeChunkSizeForSource('beta')
        : operationType === 'bulk_dividend'
        ? getSafeChunkSizeForSource('dividend')
        : getSafeChunkSizeForSource('parameters');

    const chunks = splitItemsIntoByteSafeChunks(records, {
      maxItemsPerChunk: chunkSize,
      maxPayloadBytes: MAX_BATCH_PAYLOAD_BYTES,
      estimateItemBytes: estimateJsonUtf8Bytes,
    });

    const responses: FinancialCallableResponse[] = [];
    let saved = 0;
    try {
      for (const chunk of chunks) {
        const res = await this.callFinancialWrite(operationType, chunk);
        responses.push(res);
        saved += chunk.length;
      }
      return responses;
    } catch (error) {
      if (error instanceof ParameterConcurrencyConflictError) {
        if (saved === 0) throw error;
        throw new ParameterConcurrencyConflictError(
          error.conflicts,
          `حُفظ ${saved} من ${records.length} سجلاً قبل رصد تعارض تزامن. أعد المزامنة قبل المحاولة. ${error.message}`
        );
      }
      throw new Error(
        `حُفظ ${saved} من ${records.length} سجلاً. أعد المزامنة قبل المحاولة. ${error instanceof Error ? error.message : ''}`
      );
    }
  }

  public static async bulkImportChunk(
    operationType: 'bulk_quarterly' | 'bulk_daily' | 'bulk_beta' | 'bulk_parameters' | 'bulk_dividend',
    records: unknown[],
    importMeta: {
      importId: string;
      sourceFile: string;
      sourceSheet: string;
      chunkIndex: number;
      dailySchema?: DailyTradingSchemaRecord | null;
    }
  ): Promise<BatchWriteChunkResponse> {
    const cleanMeta = sanitizeForFirestore(importMeta);
    const res = await this.callFinancialWrite(operationType, records, { importMeta: cleanMeta });
    return {
      insertedCount: res.insertedCount ?? 0,
      updatedCount: res.updatedCount ?? 0,
      skippedUnchangedCount: res.skippedUnchangedCount ?? 0,
    };
  }

  // --- Companies ---

  public static async createCompany(company: Company): Promise<Company> {
    await this.financialWrite('create_company', company);
    const docId = company.id || normalizedTicker(company.ticker).toLowerCase();
    const current = CacheService.getCompanies();
    CacheService.saveCompanies([company, ...current.filter((c) => c.id !== docId)]);
    return company;
  }

  public static async patchCompanyMetadata(patch: CompanyMetadataPatch): Promise<void> {
    await this.financialWrite('company_metadata', patch);
    const docId = patch.id || normalizedTicker(patch.ticker).toLowerCase();
    const current = CacheService.getCompanies();
    CacheService.saveCompanies(
      current.some((c) => c.id === docId)
        ? current.map((c) => (c.id === docId ? ({ ...c, ...patch } as Company) : c))
        : current
    );
  }

  public static async updateCompany(company: Company): Promise<void> {
    const tk = normalizedTicker(company.ticker || company.id);
    await this.patchCompanyMetadata({ ...company, id: company.id || tk.toLowerCase(), ticker: tk });
  }

  public static async deleteCompany(id: string): Promise<void> {
    await this.financialWrite('delete_company', undefined, { id });
    const current = CacheService.getCompanies();
    CacheService.saveCompanies(current.filter((c) => c.id !== id));
  }

  public static async bulkSaveCompanies(companies: Company[]): Promise<void> {
    for (const comp of companies) {
      await this.updateCompany(comp);
    }
    CacheService.saveCompanies(companies);
  }

  // --- Quarterly & Daily ---

  public static async saveQuarterlyFinancialRecord(
    record: QuarterlyFinancialRecord | QuarterlyFinancialRecordWritePayload
  ): Promise<void> {
    await this.financialWrite('quarterly_record', record);
  }

  public static async saveStockAndQuarter(
    record: QuarterlyFinancialRecord,
    companyMetadata?: CompanyMetadataPatch
  ): Promise<void> {
    const extra = companyMetadata
      ? { companyMetadata: sanitizeForFirestore(companyMetadata) }
      : {};
    await this.financialWrite('quarterly_record', record, extra);
  }

  public static async bulkSaveQuarterlyRecords(
    records: QuarterlyFinancialRecord[]
  ): Promise<void> {
    await this.bulkFinancialWrite('bulk_quarterly', records);
  }

  public static async deleteQuarterlyFinancialRecord(
    ticker: string,
    year: number,
    quarter: string
  ): Promise<void> {
    await this.financialWrite('delete_quarterly', undefined, { ticker, year, quarter });
  }

  public static async bulkSaveDailyTradingRecords(records: DailyTradingRecord[]): Promise<void> {
    await this.bulkFinancialWrite('bulk_daily', records);
  }

  public static async saveDailyTradingRecord(record: DailyTradingRecord): Promise<void> {
    await this.financialWrite('daily_record', record);
  }

  public static async deleteDailyTradingRecord(ticker: string, tradeDate: string): Promise<void> {
    await this.financialWrite('delete_daily', undefined, { ticker, tradeDate });
  }

  // --- Dividends ---

  public static async bulkSaveDividendRecords(records: DividendRecord[]): Promise<void> {
    await this.bulkFinancialWrite('bulk_dividend', records);
  }

  public static async saveDividendRecord(record: DividendRecord): Promise<void> {
    await this.financialWrite('dividend_record', record);
  }

  public static async deleteDividendRecord(
    target:
      | string
      | { ticker: string; fiscalYear: number; recordType: 'regular' | 'special'; distributionId: string }
  ): Promise<void> {
    if (typeof target === 'string') {
      await this.financialWrite('delete_dividend', undefined, { id: target });
      return;
    }
    await this.financialWrite('delete_dividend', target);
  }

  public static async saveDividendYearStatus(
    record: Omit<DividendYearStatusRecord, 'id'> & { id?: string }
  ): Promise<void> {
    await this.financialWrite('save_dividend_year_status', record);
  }

  public static async deleteDividendYearStatus(
    target: string | { ticker: string; fiscalYear: number }
  ): Promise<void> {
    if (typeof target === 'string') {
      await this.financialWrite('delete_dividend_year_status', undefined, { id: target });
      return;
    }
    const id = buildDividendYearStatusDocId(target.ticker, target.fiscalYear);
    await this.financialWrite('delete_dividend_year_status', target, { id });
  }

  // --- Stories, Decisions & Trades ---

  public static async saveStory(story: InvestmentStory): Promise<void> {
    await this.financialWrite('save_story', story);
    const current = CacheService.getStories();
    current[story.companyId] = story;
    CacheService.saveStories({ ...current });
  }

  public static async deleteStory(companyId: string): Promise<void> {
    await this.financialWrite('delete_story', undefined, { companyId });
    const current = CacheService.getStories();
    delete current[companyId];
    CacheService.saveStories({ ...current });
  }

  public static async saveDecision(decision: DecisionItem): Promise<void> {
    await this.financialWrite('save_decision', decision);
    const current = CacheService.getDecisions();
    current[decision.companyId] = decision;
    CacheService.saveDecisions({ ...current });
  }

  public static async deleteDecision(companyId: string): Promise<void> {
    await this.financialWrite('delete_decision', undefined, { companyId });
    const current = CacheService.getDecisions();
    delete current[companyId];
    CacheService.saveDecisions({ ...current });
  }

  public static async createTrade(trade: TradeLog): Promise<TradeLog> {
    const docId = trade.id || `trade_${Date.now()}`;
    const payload = { ...trade, id: docId };
    await this.financialWrite('save_trade', payload);
    const current = CacheService.getTrades();
    CacheService.saveTrades([payload, ...current.filter((t) => t.id !== docId)]);
    return payload;
  }

  public static async updateTrade(trade: TradeLog): Promise<void> {
    await this.financialWrite('save_trade', trade);
    const current = CacheService.getTrades();
    CacheService.saveTrades(current.map((t) => (t.id === trade.id ? trade : t)));
  }

  public static async deleteTrade(id: string): Promise<void> {
    await this.financialWrite('delete_trade', undefined, { id });
    const current = CacheService.getTrades();
    CacheService.saveTrades(current.filter((t) => t.id !== id));
  }

  public static async bulkSaveTrades(trades: TradeLog[]): Promise<void> {
    await this.financialWrite('bulk_trades', trades);
    CacheService.saveTrades(trades);
  }

  // --- Parameters, Beta, Sector PE & Maintenance ---

  public static async saveCompanyParameterOverride(
    input: SaveCompanyOverrideInput
  ): Promise<{ override: CompanyParameterOverride; receipt: ParameterSaveReceipt }> {
    const tk = normalizedTicker(input.ticker);
    const fieldDef = getValuationLabField(input.key);
    const regDef = getParameterDefinition(input.key);
    const key = fieldDef?.registryKey ?? regDef?.key ?? input.key;
    const allowedScopes = fieldDef?.allowedScopes ?? regDef?.allowedScopes ?? ['company', 'global'];

    if (!allowedScopes.includes('company')) {
      throw new Error(`المعامل ${key} مخصص للنطاق العام (macro_params) فقط ولا يُحفظ كمعامل شركة.`);
    }

    const validation = validateValuationLabFieldValue(key, input.value);
    if (!validation.valid) {
      throw new Error(validation.reasonAr || `قيمة غير صالحة للمعامل ${key}.`);
    }

    const asOfDate =
      (input.asOfDate && input.asOfDate.trim()) || new Date().toISOString().slice(0, 10);
    const source = (input.source && input.source.trim()) || 'معمل التقييم';

    if (fieldDef?.validationRules.requiresSource && !input.source?.trim()) {
      throw new Error(`المعامل ${key} يتطلب توثيق المصدر الصريح قبل الحفظ.`);
    }

    const unit = input.unit || fieldDef?.unit || regDef?.unit || 'decimal';
    const description =
      input.description || fieldDef?.descriptionAr || regDef?.descriptionAr || key;

    const payload = {
      key,
      value: input.value,
      description,
      scope: 'company' as const,
      ticker: tk,
      unit,
      asOfDate,
      source,
      ...(input.currency ? { currency: input.currency } : {}),
      ...(input.forecastHorizonYears != null
        ? { forecastHorizonYears: input.forecastHorizonYears }
        : {}),
      ...(input.rfMethodology ? { rfMethodology: input.rfMethodology } : {}),
    };

    const response = await this.callFinancialWrite('bulk_parameters', [payload]);
    const updatedAt = response.updatedAt || new Date().toISOString();
    const override: CompanyParameterOverride = {
      ticker: tk,
      key,
      value: input.value,
      description,
      scope: 'company',
      unit,
      asOfDate,
      source,
      updatedAt,
      isDeleted: false,
    };

    const docPath = `company_assumptions/${tk}/parameters/${key}`;
    return {
      override,
      receipt: {
        docPath,
        scope: 'company',
        key,
        ticker: tk,
        value: input.value,
        response,
      },
    };
  }

  public static async saveBetaAssumption(
    record: BetaAssumptionRecord
  ): Promise<{ record: BetaAssumptionRecord; receipt: ParameterSaveReceipt }> {
    const tk = normalizedTicker(record.ticker);
    if (typeof record.beta !== 'number' || !Number.isFinite(record.beta) || record.beta < -10 || record.beta > 10) {
      throw new Error('قيمة بيتا التاريخية يجب أن تكون رقماً منتهياً ضمن النطاق [-10, 10].');
    }
    const source = String(record.source || '').trim();
    const asOfDate = String(record.asOfDate || '').trim();
    if (!source) {
      throw new Error('يجب إدخال مصدر موثق لسجل بيتا التاريخية (beta_assumptions).');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) {
      throw new Error('يجب إدخال تاريخ قياس صالح بصيغة YYYY-MM-DD لسجل بيتا التاريخية.');
    }

    const payload = {
      ticker: tk,
      beta: record.beta,
      asOfDate,
      source,
    };
    const response = await this.callFinancialWrite('bulk_beta', [payload]);
    const savedRecord: BetaAssumptionRecord = {
      ticker: tk,
      beta: record.beta,
      asOfDate,
      source,
      updatedAt: response.updatedAt || new Date().toISOString(),
      isDeleted: false,
    };

    return {
      record: savedRecord,
      receipt: {
        docPath: `beta_assumptions/${tk}`,
        scope: 'beta_assumptions',
        key: 'Beta',
        ticker: tk,
        value: record.beta,
        response,
      },
    };
  }

  public static async deleteBetaAssumption(
    ticker: string
  ): Promise<{ docPath: string; response: FinancialCallableResponse }> {
    const tk = normalizedTicker(ticker);
    const response = await this.callFinancialWrite('delete_beta', undefined, { ticker: tk });
    return { docPath: `beta_assumptions/${tk}`, response };
  }

  public static async deleteParameter(
    key: string,
    scope: 'global' | 'company',
    ticker?: string
  ): Promise<{ docPath: string; response: FinancialCallableResponse }> {
    const startScopeKey = CacheService.getScopeKey();
    const tk = scope === 'company' && ticker ? normalizedTicker(ticker) : undefined;
    const response = await this.callFinancialWrite('delete_parameter', undefined, {
      key,
      scope,
      ...(tk ? { ticker: tk } : {}),
    });
    if (scope === 'global') {
      CacheService.markMacroParameterDeleted(key, startScopeKey);
    }
    const docPath =
      scope === 'company' && tk
        ? `company_assumptions/${tk}/parameters/${key}`
        : `macro_params/${key}`;
    return { docPath, response };
  }

  public static async runAdminMaintenance(
    operationType:
      | 'migrate_legacy_beta'
      | 'migrate_legacy_company_overrides'
      | 'backfill_server_timestamps'
      | 'cleanup_expired_tombstones'
  ): Promise<FinancialCallableResponse> {
    return this.callFinancialWrite(operationType);
  }

  public static async saveSectorPE(values: Record<string, number>): Promise<void> {
    const validated = validateSectorPEPayload(values);
    await this.financialWrite('sector_pe', validated);
    CacheService.saveSectorPE(validated);
  }

  public static async upsertSectorDefinition(
    payload: SectorDefinitionPayload
  ): Promise<{ definition: SectorDefinition; response: FinancialCallableResponse }> {
    const validated = validateSectorDefinitionPayload(payload);
    const response = await this.callFinancialWrite('upsert_sector', validated);
    const definition: SectorDefinition = {
      sectorId: validated.sectorId,
      nameAr: validated.nameAr,
      aliases: validated.aliases,
      classification: validated.classification,
      multiple: validated.multiple,
      multipleSource: validated.multipleSource ?? null,
      multipleAsOfDate: validated.multipleAsOfDate ?? null,
      status: validated.status,
      notes: validated.notes ?? null,
      legacyDocId: null,
      isLegacyFormat: false,
      updatedAt: response.updatedAt || new Date().toISOString(),
    };
    const existing = CacheService.getSectorDefinitions();
    const filtered = existing.filter((d) => d.sectorId !== definition.sectorId);
    const nextDefs = [...filtered, definition].sort((a, b) => a.nameAr.localeCompare(b.nameAr, 'ar'));
    CacheService.saveSectorDefinitions(nextDefs);
    CacheService.saveSectorPE(deriveSectorPEMapFromDefinitions(nextDefs));
    return { definition, response };
  }

  public static async toggleSectorStatus(
    payload: SectorStatusTogglePayload
  ): Promise<FinancialCallableResponse> {
    const validated = validateSectorStatusTogglePayload(payload);
    const response = await this.callFinancialWrite('toggle_sector_status', validated);
    const completed = response.sectorReport ? response.sectorReport.completed : true;
    const existing = CacheService.getSectorDefinitions();
    if (completed && existing.length > 0) {
      const nextDefs = existing.map((d) =>
        d.sectorId === validated.sectorId
          ? { ...d, status: validated.status, updatedAt: response.updatedAt || d.updatedAt }
          : d
      );
      CacheService.saveSectorDefinitions(nextDefs);
      CacheService.saveSectorPE(deriveSectorPEMapFromDefinitions(nextDefs));
    }
    return response;
  }

  public static async deleteSectorDefinition(
    payload: SectorDeletePayload
  ): Promise<FinancialCallableResponse> {
    const validated = validateSectorDeletePayload(payload);
    const response = await this.callFinancialWrite('delete_sector', validated);
    const completed = response.sectorReport ? response.sectorReport.completed : true;
    const existing = CacheService.getSectorDefinitions();
    if (completed && existing.length > 0) {
      const nextDefs = existing.filter((d) => d.sectorId !== validated.sectorId);
      CacheService.saveSectorDefinitions(nextDefs);
      CacheService.saveSectorPE(deriveSectorPEMapFromDefinitions(nextDefs));
    }
    return response;
  }

  public static async saveMacroParameter(
    param: MacroParameter,
    precondition: ParameterWritePrecondition
  ): Promise<{ param: MacroParameter; receipt: ParameterSaveReceipt }> {
    if (!precondition) {
      throw new Error(
        `شرط التزامن (precondition) إلزامي عند حفظ المعامل العام (${param.key}) في macro_params.`
      );
    }
    const regDef = getParameterDefinition(param.key);
    const fieldDef = getValuationLabField(param.key);
    if (regDef && !regDef.allowedScopes.includes('global')) {
      throw new Error(`المعامل ${param.key} مخصص لنطاق الشركة فقط ولا يُحفظ في macro_params العامة.`);
    }
    if (fieldDef) {
      const validation = validateValuationLabFieldValue(param.key, param.value);
      if (!validation.valid) {
        throw new Error(validation.reasonAr || `قيمة غير صالحة للمعامل ${param.key}.`);
      }
    }
    const startScopeKey = CacheService.getScopeKey();
    const payload = buildMacroParameterWritePayload(param, precondition);
    const response = await this.callFinancialWrite('macro_parameter', payload);
    const confirmation = response.savedParameters?.find(
      (item) => item.scope === 'global' && item.key === payload.key
    );
    const canonicalParam = normalizeMacroParameterFromFirestore(payload.key, {
      ...param,
      ...payload,
      descriptionAr: payload.description,
      ...(confirmation
        ? {
            revision: confirmation.revision,
            contentHash: confirmation.contentHash,
            updatedAt: confirmation.updatedAt,
          }
        : response.updatedAt
        ? { updatedAt: response.updatedAt }
        : {}),
    }) as MacroParameter;
    const createdKeys =
      precondition.mode === 'create' ? new Set<string>([canonicalParam.key]) : undefined;
    CacheService.mergeMacroParameters([canonicalParam], {
      expectedScopeKey: startScopeKey,
      createdKeys,
    });
    return {
      param: canonicalParam,
      receipt: {
        docPath: `macro_params/${canonicalParam.key}`,
        scope: 'global',
        key: canonicalParam.key,
        value: canonicalParam.value,
        response,
      },
    };
  }

  public static async bulkSaveMacroParameters(
    params: MacroParameter[],
    preconditionsByKey: Record<string, ParameterWritePrecondition>
  ): Promise<MacroParameter[]> {
    if (params.length === 0) {
      return [];
    }
    const startScopeKey = CacheService.getScopeKey();
    const payload = params.map((p) => {
      const pre = preconditionsByKey?.[p.key];
      if (!pre) {
        throw new Error(
          `شرط التزامن (precondition) إلزامي عند حفظ المعامل العام (${p.key}) في macro_params.`
        );
      }
      return buildMacroParameterWritePayload(p, pre);
    });
    const responses = await this.bulkFinancialWrite('bulk_parameters', payload);
    const confirmationsByKey = new Map<string, SavedParameterConfirmation>();
    let fallbackUpdatedAt: string | undefined;
    for (const res of responses) {
      if (res.updatedAt) fallbackUpdatedAt = res.updatedAt;
      if (Array.isArray(res.savedParameters)) {
        for (const item of res.savedParameters) {
          if (item.scope === 'global') {
            confirmationsByKey.set(item.key, item);
          }
        }
      }
    }
    const createdKeys = new Set<string>();
    const canonicalParams = params.map((p, idx) => {
      const itemPayload = payload[idx];
      if (itemPayload.precondition?.mode === 'create') {
        createdKeys.add(itemPayload.key);
      }
      const conf = confirmationsByKey.get(itemPayload.key);
      return normalizeMacroParameterFromFirestore(itemPayload.key, {
        ...p,
        ...itemPayload,
        descriptionAr: itemPayload.description,
        ...(conf
          ? {
              revision: conf.revision,
              contentHash: conf.contentHash,
              updatedAt: conf.updatedAt,
            }
          : fallbackUpdatedAt
          ? { updatedAt: fallbackUpdatedAt }
          : {}),
      }) as MacroParameter;
    });
    // Merge ONLY saved keys into CacheService under startScopeKey — NEVER replace full cache or leak across sessions.
    CacheService.mergeMacroParameters(canonicalParams, {
      expectedScopeKey: startScopeKey,
      createdKeys: createdKeys.size > 0 ? createdKeys : undefined,
    });
    return canonicalParams;
  }
}
