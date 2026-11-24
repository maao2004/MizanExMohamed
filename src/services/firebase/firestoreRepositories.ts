/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  collection,
  collectionGroup,
  doc as firestoreDoc,
  getDoc,
  getDocs,
  getDocsFromServer,
  query,
  Timestamp,
  where,
} from 'firebase/firestore';
import { db } from './firebaseConfig';
import {
  BetaAssumptionRecord,
  Company,
  CompanyParameterOverride,
  DecisionItem,
  ImportSourceType,
  InvestmentStory,
  QuarterlyFinancial,
  SectorDefinition,
  TombstoneRecord,
  TradeLog,
} from '../../types/financial';
import {
  AppUser,
  DailyTradingRecord,
  DailyTradingSchemaRecord,
  DividendRecord,
  DividendYearStatusRecord,
  MacroParameter,
  QuarterlyFinancialRecord,
} from '../../types';
import { CacheService } from '../storage/cacheService';
import { tryNormalizedTicker } from '../../core/contracts';
import {
  COLLECTIONS,
  mapBetaSnapshot,
  mapCompaniesSnapshot,
  mapCompanyOverridesSnapshot,
  mapDailySchemasSnapshot,
  mapDailySnapshot,
  mapDecisionsSnapshot,
  mapDividendsSnapshot,
  mapDividendYearStatusesSnapshot,
  mapFinancialsSnapshot,
  mapMacroSnapshot,
  mapQuarterlySnapshot,
  mapRealEstateDisclosuresSnapshot,
  mapSectorPESnapshot,
  mapStoriesSnapshot,
  mapTombstonesSnapshot,
  mapTradesSnapshot,
  type RealEstateDisclosuresSnapshotMapped,
} from './firestoreTransforms';
import type { RealEstateDisclosureReadRecord } from '../../core/domain/realEstateDisclosureRead';

export class FirestoreRepositories {
  public static async fetchDeltaDocsFromServer(colName: string, sinceMs: number) {
    const sinceTs = Timestamp.fromMillis(sinceMs);
    return getDocsFromServer(
      query(collection(db, colName), where('serverUpdatedAt', '>=', sinceTs))
    );
  }

  public static async fetchCompanyOverrideDeltasFromServer(sinceMs: number) {
    const sinceTs = Timestamp.fromMillis(sinceMs);
    return getDocsFromServer(
      query(collectionGroup(db, 'parameters'), where('serverUpdatedAt', '>=', sinceTs))
    );
  }

  public static async getCompany(id: string): Promise<Company | null> {
    const snap = await getDoc(firestoreDoc(db, COLLECTIONS.COMPANIES, id));
    return snap.exists() ? ({ ...snap.data(), id: snap.id } as Company) : null;
  }

  public static async getAllCompaniesWithMeta(
    fromServer = false
  ): Promise<{ records: Company[]; stamped: Array<{ serverUpdatedAt?: unknown }> }> {
    const ref = collection(db, COLLECTIONS.COMPANIES);
    const snap = fromServer ? await getDocsFromServer(ref) : await getDocs(ref);
    const records = mapCompaniesSnapshot(snap);
    CacheService.saveCompanies(records);
    return {
      records,
      stamped: records as unknown as Array<{ serverUpdatedAt?: unknown }>,
    };
  }

  public static async getAllCompanies(fromServer = false): Promise<Company[]> {
    const { records } = await this.getAllCompaniesWithMeta(fromServer);
    return records;
  }

  public static async getAllQuarterlyRecordsWithMeta(
    fromServer = false
  ): Promise<{ records: QuarterlyFinancialRecord[]; stamped: Array<{ serverUpdatedAt?: unknown }> }> {
    const ref = collection(db, COLLECTIONS.QUARTERLY_RECORDS);
    const snap = fromServer ? await getDocsFromServer(ref) : await getDocs(ref);
    const records = mapQuarterlySnapshot(snap);
    CacheService.saveQuarterlyFinancialRecords(records);
    return {
      records,
      stamped: records as unknown as Array<{ serverUpdatedAt?: unknown }>,
    };
  }

  public static async getAllQuarterlyRecords(
    fromServer = false
  ): Promise<QuarterlyFinancialRecord[]> {
    const { records } = await this.getAllQuarterlyRecordsWithMeta(fromServer);
    return records;
  }

  public static async getAllDailyTradingRecordsWithMeta(
    fromServer = false
  ): Promise<{ records: DailyTradingRecord[]; stamped: Array<{ serverUpdatedAt?: unknown }> }> {
    const ref = collection(db, COLLECTIONS.DAILY_TRADING);
    const snap = fromServer ? await getDocsFromServer(ref) : await getDocs(ref);
    const records = mapDailySnapshot(snap);
    CacheService.saveDailyTradingRecords(records);
    return {
      records,
      stamped: records as unknown as Array<{ serverUpdatedAt?: unknown }>,
    };
  }

  public static async getAllDailyTradingRecords(fromServer = false): Promise<DailyTradingRecord[]> {
    const { records } = await this.getAllDailyTradingRecordsWithMeta(fromServer);
    return records;
  }

  public static async getAllDailyTradingSchemasWithMeta(fromServer = false): Promise<{
    values: Record<string, DailyTradingSchemaRecord>;
    stamped: Array<{ serverUpdatedAt?: unknown }>;
  }> {
    const ref = collection(db, COLLECTIONS.DAILY_SCHEMAS);
    const snap = fromServer ? await getDocsFromServer(ref) : await getDocs(ref);
    const { map, stamped } = mapDailySchemasSnapshot(snap);
    CacheService.saveDailyTradingSchemas(map);
    return { values: map, stamped };
  }

  public static async getAllDailyTradingSchemas(
    fromServer = false
  ): Promise<Record<string, DailyTradingSchemaRecord>> {
    const { values } = await this.getAllDailyTradingSchemasWithMeta(fromServer);
    return values;
  }

  public static async getAllFinancials(fromServer = false): Promise<QuarterlyFinancial[]> {
    const ref = collection(db, COLLECTIONS.FINANCIALS);
    const snap = fromServer ? await getDocsFromServer(ref) : await getDocs(ref);
    const list = mapFinancialsSnapshot(snap);
    CacheService.saveFinancials(list);
    return list;
  }

  public static async getStory(companyId: string): Promise<InvestmentStory | null> {
    const snap = await getDoc(firestoreDoc(db, COLLECTIONS.STORIES, companyId));
    return snap.exists() ? ({ ...snap.data(), companyId: snap.id } as InvestmentStory) : null;
  }

  public static async getAllStoriesWithMeta(fromServer = false): Promise<{
    values: Record<string, InvestmentStory>;
    stamped: Array<{ serverUpdatedAt?: unknown }>;
  }> {
    const ref = collection(db, COLLECTIONS.STORIES);
    const snap = fromServer ? await getDocsFromServer(ref) : await getDocs(ref);
    const { map, stamped } = mapStoriesSnapshot(snap);
    CacheService.saveStories(map);
    return { values: map, stamped };
  }

  public static async getAllStories(fromServer = false): Promise<Record<string, InvestmentStory>> {
    const { values } = await this.getAllStoriesWithMeta(fromServer);
    return values;
  }

  public static async getDecision(companyId: string): Promise<DecisionItem | null> {
    const snap = await getDoc(firestoreDoc(db, COLLECTIONS.DECISIONS, companyId));
    return snap.exists() ? ({ ...snap.data(), companyId: snap.id } as DecisionItem) : null;
  }

  public static async getAllDecisionsWithMeta(fromServer = false): Promise<{
    values: Record<string, DecisionItem>;
    stamped: Array<{ serverUpdatedAt?: unknown }>;
  }> {
    const ref = collection(db, COLLECTIONS.DECISIONS);
    const snap = fromServer ? await getDocsFromServer(ref) : await getDocs(ref);
    const { map, stamped } = mapDecisionsSnapshot(snap);
    CacheService.saveDecisions(map);
    return { values: map, stamped };
  }

  public static async getAllDecisions(fromServer = false): Promise<Record<string, DecisionItem>> {
    const { values } = await this.getAllDecisionsWithMeta(fromServer);
    return values;
  }

  public static async getAllTradesWithMeta(
    fromServer = false
  ): Promise<{ records: TradeLog[]; stamped: Array<{ serverUpdatedAt?: unknown }> }> {
    const ref = collection(db, COLLECTIONS.TRADES);
    const snap = fromServer ? await getDocsFromServer(ref) : await getDocs(ref);
    const records = mapTradesSnapshot(snap);
    CacheService.saveTrades(records);
    return {
      records,
      stamped: records as unknown as Array<{ serverUpdatedAt?: unknown }>,
    };
  }

  public static async getAllTrades(fromServer = false): Promise<TradeLog[]> {
    const { records } = await this.getAllTradesWithMeta(fromServer);
    return records;
  }

  public static async getAllBetaAssumptionsWithMeta(
    fromServer = false
  ): Promise<{ records: BetaAssumptionRecord[]; stamped: Array<{ serverUpdatedAt?: unknown }> }> {
    const ref = collection(db, COLLECTIONS.BETA_ASSUMPTIONS);
    const snap = fromServer ? await getDocsFromServer(ref) : await getDocs(ref);
    return mapBetaSnapshot(snap);
  }

  public static async getAllBetaAssumptions(fromServer = false): Promise<BetaAssumptionRecord[]> {
    const { records } = await this.getAllBetaAssumptionsWithMeta(fromServer);
    return records;
  }

  public static async getAllDividendRecordsWithMeta(
    fromServer = false
  ): Promise<{ records: DividendRecord[]; stamped: Array<{ serverUpdatedAt?: unknown }> }> {
    const ref = collection(db, COLLECTIONS.DIVIDEND_RECORDS);
    const snap = fromServer ? await getDocsFromServer(ref) : await getDocs(ref);
    const { records, stamped } = mapDividendsSnapshot(snap);
    CacheService.saveDividendRecords(records);
    return { records, stamped };
  }

  public static async getAllDividendRecords(fromServer = false): Promise<DividendRecord[]> {
    const { records } = await this.getAllDividendRecordsWithMeta(fromServer);
    return records;
  }

  public static async getAllDividendYearStatusesWithMeta(
    fromServer = false
  ): Promise<{ records: DividendYearStatusRecord[]; stamped: Array<{ serverUpdatedAt?: unknown }> }> {
    const ref = collection(db, COLLECTIONS.DIVIDEND_YEAR_STATUSES);
    const snap = fromServer ? await getDocsFromServer(ref) : await getDocs(ref);
    const { records, stamped } = mapDividendYearStatusesSnapshot(snap);
    CacheService.saveDividendYearStatuses(records);
    return { records, stamped };
  }

  public static async getAllDividendYearStatuses(
    fromServer = false
  ): Promise<DividendYearStatusRecord[]> {
    const { records } = await this.getAllDividendYearStatusesWithMeta(fromServer);
    return records;
  }

  public static async getAllRealEstateDisclosuresWithMeta(
    fromServer = false
  ): Promise<RealEstateDisclosuresSnapshotMapped> {
    const ref = collection(db, COLLECTIONS.REAL_ESTATE_DISCLOSURES);
    const snap = fromServer ? await getDocsFromServer(ref) : await getDocs(ref);
    return mapRealEstateDisclosuresSnapshot(snap);
  }

  public static async getAllRealEstateDisclosures(
    fromServer = false
  ): Promise<RealEstateDisclosureReadRecord[]> {
    const { records } = await this.getAllRealEstateDisclosuresWithMeta(fromServer);
    return records;
  }

  public static async fetchRealEstateDisclosureDeltasFromServer(
    sinceMs: number
  ): Promise<RealEstateDisclosuresSnapshotMapped> {
    const snap = await this.fetchDeltaDocsFromServer(COLLECTIONS.REAL_ESTATE_DISCLOSURES, sinceMs);
    return mapRealEstateDisclosuresSnapshot(snap);
  }

  public static async getAllCompanyOverridesWithMeta(
    fromServer = false
  ): Promise<{ records: CompanyParameterOverride[]; stamped: Array<{ serverUpdatedAt?: unknown }> }> {
    const ref = collectionGroup(db, 'parameters');
    const snap = fromServer ? await getDocsFromServer(ref) : await getDocs(ref);
    return mapCompanyOverridesSnapshot(snap);
  }

  public static async getAllCompanyOverrides(
    fromServer = false
  ): Promise<CompanyParameterOverride[]> {
    const { records } = await this.getAllCompanyOverridesWithMeta(fromServer);
    return records;
  }

  public static async getAllMacroParametersWithMeta(
    fromServer = false
  ): Promise<{ records: MacroParameter[]; stamped: Array<{ serverUpdatedAt?: unknown }> }> {
    const ref = collection(db, COLLECTIONS.MACRO_PARAMS);
    const snap = fromServer ? await getDocsFromServer(ref) : await getDocs(ref);
    const records = mapMacroSnapshot(snap);
    CacheService.saveMacroParameters(records);
    return { records, stamped: records };
  }

  public static async getAllMacroParameters(fromServer = false): Promise<MacroParameter[]> {
    const { records } = await this.getAllMacroParametersWithMeta(fromServer);
    return records;
  }

  public static async getAllSectorPEWithMeta(
    fromServer = false
  ): Promise<{
    definitions: SectorDefinition[];
    values: Record<string, number>;
    stamped: Array<{ serverUpdatedAt?: unknown }>;
  }> {
    const ref = collection(db, COLLECTIONS.SECTOR_PE);
    const snap = fromServer ? await getDocsFromServer(ref) : await getDocs(ref);
    const { definitions, values, stamped } = mapSectorPESnapshot(snap);
    CacheService.saveSectorDefinitions(definitions);
    CacheService.saveSectorPE(values);
    return { definitions, values, stamped };
  }

  public static async getAllSectorPE(fromServer = false): Promise<Record<string, number>> {
    const { values } = await this.getAllSectorPEWithMeta(fromServer);
    return values;
  }

  public static async getAllSectorDefinitions(fromServer = false): Promise<SectorDefinition[]> {
    const { definitions } = await this.getAllSectorPEWithMeta(fromServer);
    return definitions;
  }

  public static async getAllTombstones(fromServer = false): Promise<TombstoneRecord[]> {
    const ref = collection(db, COLLECTIONS.TOMBSTONES);
    const snap = fromServer ? await getDocsFromServer(ref) : await getDocs(ref);
    return mapTombstonesSnapshot(snap);
  }

  public static async fetchExistingDocsForPreview(
    sourceType: ImportSourceType
  ): Promise<Map<string, Record<string, any>>> {
    const map = new Map<string, Record<string, any>>();
    if (sourceType === 'quarterly') {
      const snap = await getDocsFromServer(collection(db, COLLECTIONS.QUARTERLY_RECORDS));
      snap.forEach((d) => map.set(d.id, d.data() as Record<string, any>));
      return map;
    }
    if (sourceType === 'daily') {
      const snap = await getDocsFromServer(collection(db, COLLECTIONS.DAILY_TRADING));
      snap.forEach((d) => map.set(d.id, d.data() as Record<string, any>));
      return map;
    }
    if (sourceType === 'beta') {
      const snap = await getDocsFromServer(collection(db, COLLECTIONS.BETA_ASSUMPTIONS));
      snap.forEach((d) => map.set(d.id, { ...d.data(), ticker: d.id } as Record<string, any>));
      return map;
    }
    if (sourceType === 'dividend') {
      const [divSnap, yearStatusSnap] = await Promise.all([
        getDocsFromServer(collection(db, COLLECTIONS.DIVIDEND_RECORDS)),
        getDocsFromServer(collection(db, COLLECTIONS.DIVIDEND_YEAR_STATUSES)),
      ]);
      divSnap.forEach((d) => map.set(d.id, d.data() as Record<string, any>));
      yearStatusSnap.forEach((d) => map.set(`year_status::${d.id}`, d.data() as Record<string, any>));
      return map;
    }
    const [macroSnap, overridesSnap] = await Promise.all([
      getDocsFromServer(collection(db, COLLECTIONS.MACRO_PARAMS)),
      getDocsFromServer(collectionGroup(db, 'parameters')),
    ]);
    macroSnap.forEach((d) => {
      const data = d.data() as Record<string, any>;
      map.set(d.id, {
        ...data,
        key: d.id,
        scope: 'global',
        ticker: null,
        description: data.descriptionAr ?? data.description ?? '',
      });
    });
    overridesSnap.forEach((d) => {
      const data = d.data() as Record<string, any>;
      const tk = tryNormalizedTicker(data.ticker || d.ref.parent.parent?.id);
      if (tk) {
        map.set(`${tk}__${d.id}`, {
          ...data,
          key: d.id,
          scope: 'company',
          ticker: tk,
          description: data.description ?? '',
        });
      }
    });
    return map;
  }

  public static async getAllUsers(): Promise<AppUser[]> {
    const snap = await getDocs(collection(db, COLLECTIONS.USERS));
    const list: AppUser[] = [];
    snap.forEach((d) => list.push({ ...d.data(), id: d.id } as AppUser));
    CacheService.saveUsersList(list);
    return list;
  }
}
