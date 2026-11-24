/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Company,
  CompanyMetadataPatch,
  DecisionItem,
  InvestmentStory,
  QuarterlyFinancial,
  TradeLog,
} from '../../types/financial';
import {
  DailyTradingRecord,
  DailyTradingSchemaRecord,
  DividendRecord,
  DividendYearStatusRecord,
  MacroParameter,
  QuarterlyFinancialRecord,
} from '../../types';
import { CacheService } from '../storage/cacheService';
import {
  COLLECTIONS,
  FirestoreSyncManager,
  RealEstateDisclosuresFetchPort,
  SyncAllResult,
  SyncRealEstateDisclosuresResult,
  SyncStats,
} from './firestoreSync';
import {
  FinancialCallableResponse,
  FirestoreWriters,
  ParameterSaveReceipt,
  SaveCompanyOverrideInput,
} from './firestoreWriters';
import type { RealEstateDisclosureReadRecord } from '../../core/domain/realEstateDisclosureRead';

export { COLLECTIONS };
export type {
  SyncStats,
  SyncAllResult,
  RealEstateDisclosuresFetchPort,
  SyncRealEstateDisclosuresResult,
  FinancialCallableResponse,
  ParameterSaveReceipt,
  SaveCompanyOverrideInput,
};

/**
 * واجهة موحدة لخدمات Firestore تفوض القراءة والمزامنة إلى FirestoreSyncManager
 * والكتابة الموثقة حصراً إلى FirestoreWriters (عبر Cloud Functions).
 */
export class FirestoreService {
  // --- Sync & Cursors ---
  public static getLastSyncTimestamp = FirestoreSyncManager.getLastSyncTimestamp.bind(FirestoreSyncManager);
  public static getLastCheckedAt = FirestoreSyncManager.getLastCheckedAt.bind(FirestoreSyncManager);
  public static getLastUserWriteAt = FirestoreSyncManager.getLastUserWriteAt.bind(FirestoreSyncManager);
  public static getDeltaCursorMs = FirestoreSyncManager.getDeltaCursorMs.bind(FirestoreSyncManager);
  public static getSyncStats = FirestoreSyncManager.getSyncStats.bind(FirestoreSyncManager);
  public static syncAllIncrementalDeltas = FirestoreSyncManager.syncAllIncrementalDeltas.bind(FirestoreSyncManager);
  public static syncRealEstateDisclosuresIncremental =
    FirestoreSyncManager.syncRealEstateDisclosuresIncremental.bind(FirestoreSyncManager);
  public static subscribeToAll = FirestoreSyncManager.subscribeToAll.bind(FirestoreSyncManager);
  public static unsubscribeAll = FirestoreSyncManager.unsubscribeAll.bind(FirestoreSyncManager);

  // --- Reads ---
  public static getCompany = FirestoreSyncManager.getCompany.bind(FirestoreSyncManager);
  public static getAllCompanies = FirestoreSyncManager.getAllCompanies.bind(FirestoreSyncManager);
  public static getAllQuarterlyRecords = FirestoreSyncManager.getAllQuarterlyRecords.bind(FirestoreSyncManager);
  public static getAllDailyTradingRecords = FirestoreSyncManager.getAllDailyTradingRecords.bind(FirestoreSyncManager);
  public static getAllDailyTradingSchemas = FirestoreSyncManager.getAllDailyTradingSchemas.bind(FirestoreSyncManager);
  public static getAllFinancials = FirestoreSyncManager.getAllFinancials.bind(FirestoreSyncManager);
  public static getStory = FirestoreSyncManager.getStory.bind(FirestoreSyncManager);
  public static getAllStories = FirestoreSyncManager.getAllStories.bind(FirestoreSyncManager);
  public static getDecision = FirestoreSyncManager.getDecision.bind(FirestoreSyncManager);
  public static getAllDecisions = FirestoreSyncManager.getAllDecisions.bind(FirestoreSyncManager);
  public static getAllTrades = FirestoreSyncManager.getAllTrades.bind(FirestoreSyncManager);
  public static getAllBetaAssumptions = FirestoreSyncManager.getAllBetaAssumptions.bind(FirestoreSyncManager);
  public static getAllDividendRecords = FirestoreSyncManager.getAllDividendRecords.bind(FirestoreSyncManager);
  public static getAllDividendYearStatuses = FirestoreSyncManager.getAllDividendYearStatuses.bind(FirestoreSyncManager);
  public static getAllRealEstateDisclosures =
    FirestoreSyncManager.getAllRealEstateDisclosures.bind(FirestoreSyncManager);
  public static getAllRealEstateDisclosuresWithMeta =
    FirestoreSyncManager.getAllRealEstateDisclosuresWithMeta.bind(FirestoreSyncManager);
  public static getAllCompanyOverrides = FirestoreSyncManager.getAllCompanyOverrides.bind(FirestoreSyncManager);
  public static fetchExistingDocsForPreview = FirestoreSyncManager.fetchExistingDocsForPreview.bind(FirestoreSyncManager);
  public static getAllMacroParameters = FirestoreSyncManager.getAllMacroParameters.bind(FirestoreSyncManager);
  public static getAllSectorPE = FirestoreSyncManager.getAllSectorPE.bind(FirestoreSyncManager);
  public static getAllSectorDefinitions = FirestoreSyncManager.getAllSectorDefinitions.bind(FirestoreSyncManager);
  public static getAllUsers = FirestoreSyncManager.getAllUsers.bind(FirestoreSyncManager);

  // --- Authoritative Writes (Cloud Functions) ---
  public static bulkImportChunk = FirestoreWriters.bulkImportChunk.bind(FirestoreWriters);
  public static createCompany = FirestoreWriters.createCompany.bind(FirestoreWriters);
  public static patchCompanyMetadata = FirestoreWriters.patchCompanyMetadata.bind(FirestoreWriters);
  public static updateCompany = FirestoreWriters.updateCompany.bind(FirestoreWriters);
  public static deleteCompany = FirestoreWriters.deleteCompany.bind(FirestoreWriters);
  public static bulkSaveCompanies = FirestoreWriters.bulkSaveCompanies.bind(FirestoreWriters);
  public static saveQuarterlyFinancialRecord = FirestoreWriters.saveQuarterlyFinancialRecord.bind(FirestoreWriters);
  public static saveStockAndQuarter = FirestoreWriters.saveStockAndQuarter.bind(FirestoreWriters);
  public static bulkSaveQuarterlyRecords = FirestoreWriters.bulkSaveQuarterlyRecords.bind(FirestoreWriters);
  public static deleteQuarterlyFinancialRecord = FirestoreWriters.deleteQuarterlyFinancialRecord.bind(FirestoreWriters);
  public static bulkSaveDailyTradingRecords = FirestoreWriters.bulkSaveDailyTradingRecords.bind(FirestoreWriters);
  public static saveDailyTradingRecord = FirestoreWriters.saveDailyTradingRecord.bind(FirestoreWriters);
  public static deleteDailyTradingRecord = FirestoreWriters.deleteDailyTradingRecord.bind(FirestoreWriters);
  public static bulkSaveDividendRecords = FirestoreWriters.bulkSaveDividendRecords.bind(FirestoreWriters);
  public static saveDividendRecord = FirestoreWriters.saveDividendRecord.bind(FirestoreWriters);
  public static deleteDividendRecord = FirestoreWriters.deleteDividendRecord.bind(FirestoreWriters);
  public static saveDividendYearStatus = FirestoreWriters.saveDividendYearStatus.bind(FirestoreWriters);
  public static deleteDividendYearStatus = FirestoreWriters.deleteDividendYearStatus.bind(FirestoreWriters);
  public static saveStory = FirestoreWriters.saveStory.bind(FirestoreWriters);
  public static deleteStory = FirestoreWriters.deleteStory.bind(FirestoreWriters);
  public static saveDecision = FirestoreWriters.saveDecision.bind(FirestoreWriters);
  public static deleteDecision = FirestoreWriters.deleteDecision.bind(FirestoreWriters);
  public static createTrade = FirestoreWriters.createTrade.bind(FirestoreWriters);
  public static updateTrade = FirestoreWriters.updateTrade.bind(FirestoreWriters);
  public static deleteTrade = FirestoreWriters.deleteTrade.bind(FirestoreWriters);
  public static bulkSaveTrades = FirestoreWriters.bulkSaveTrades.bind(FirestoreWriters);
  public static deleteBetaAssumption = FirestoreWriters.deleteBetaAssumption.bind(FirestoreWriters);
  public static saveBetaAssumption = FirestoreWriters.saveBetaAssumption.bind(FirestoreWriters);
  public static saveCompanyParameterOverride = FirestoreWriters.saveCompanyParameterOverride.bind(FirestoreWriters);
  public static deleteParameter = FirestoreWriters.deleteParameter.bind(FirestoreWriters);
  public static runAdminMaintenance = FirestoreWriters.runAdminMaintenance.bind(FirestoreWriters);
  public static saveSectorPE = FirestoreWriters.saveSectorPE.bind(FirestoreWriters);
  public static upsertSectorDefinition = FirestoreWriters.upsertSectorDefinition.bind(FirestoreWriters);
  public static toggleSectorStatus = FirestoreWriters.toggleSectorStatus.bind(FirestoreWriters);
  public static deleteSectorDefinition = FirestoreWriters.deleteSectorDefinition.bind(FirestoreWriters);
  public static saveMacroParameter = FirestoreWriters.saveMacroParameter.bind(FirestoreWriters);
  public static bulkSaveMacroParameters = FirestoreWriters.bulkSaveMacroParameters.bind(FirestoreWriters);

  // --- Scoped Cache Accessors ---
  public static getCachedCompanies(): Company[] {
    return CacheService.getCompanies();
  }
  public static setCachedCompanies(companies: Company[]): void {
    CacheService.saveCompanies(companies);
  }
  public static getCachedFinancials(): QuarterlyFinancial[] {
    return CacheService.getFinancials();
  }
  public static setCachedFinancials(financials: QuarterlyFinancial[]): void {
    CacheService.saveFinancials(financials);
  }
  public static getCachedStories(): Record<string, InvestmentStory> {
    return CacheService.getStories();
  }
  public static setCachedStories(stories: Record<string, InvestmentStory>): void {
    CacheService.saveStories(stories);
  }
  public static getCachedDecisions(): Record<string, DecisionItem> {
    return CacheService.getDecisions();
  }
  public static setCachedDecisions(decisions: Record<string, DecisionItem>): void {
    CacheService.saveDecisions(decisions);
  }
  public static getCachedTrades(): TradeLog[] {
    return CacheService.getTrades();
  }
  public static setCachedTrades(trades: TradeLog[]): void {
    CacheService.saveTrades(trades);
  }
  public static getCachedMacroParameters(): MacroParameter[] {
    return CacheService.getMacroParameters();
  }
  public static setCachedMacroParameters(params: MacroParameter[]): void {
    CacheService.saveMacroParameters(params);
  }
  public static getCachedQuarterlyRecords(): QuarterlyFinancialRecord[] {
    return CacheService.getQuarterlyFinancialRecords();
  }
  public static setCachedQuarterlyRecords(records: QuarterlyFinancialRecord[]): void {
    CacheService.saveQuarterlyFinancialRecords(records);
  }
  public static getCachedDailyTradingRecords(): DailyTradingRecord[] {
    return CacheService.getDailyTradingRecords();
  }
  public static setCachedDailyTradingRecords(records: DailyTradingRecord[]): void {
    CacheService.saveDailyTradingRecords(records);
  }
  public static getCachedDailyTradingSchemas(): Record<string, DailyTradingSchemaRecord> {
    return CacheService.getDailyTradingSchemas();
  }
  public static setCachedDailyTradingSchemas(schemas: Record<string, DailyTradingSchemaRecord>): void {
    CacheService.saveDailyTradingSchemas(schemas);
  }
  public static getCachedDividendRecords(): DividendRecord[] {
    return CacheService.getDividendRecords();
  }
  public static setCachedDividendRecords(records: DividendRecord[]): void {
    CacheService.saveDividendRecords(records);
  }
  public static getCachedDividendYearStatuses(): DividendYearStatusRecord[] {
    return CacheService.getDividendYearStatuses();
  }
  public static setCachedDividendYearStatuses(records: DividendYearStatusRecord[]): void {
    CacheService.saveDividendYearStatuses(records);
  }
  public static getCachedRealEstateDisclosures(): RealEstateDisclosureReadRecord[] {
    return CacheService.getRealEstateDisclosures();
  }
  public static setCachedRealEstateDisclosures(records: RealEstateDisclosureReadRecord[]): void {
    CacheService.saveRealEstateDisclosures(records);
  }
  public static clearSessionCaches(): void {
    CacheService.clearScopedCache();
    CacheService.clearAllMizanCaches();
  }
}

export type { CompanyMetadataPatch };
