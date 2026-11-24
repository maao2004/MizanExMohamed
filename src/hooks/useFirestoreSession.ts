/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { User as FirebaseUser } from 'firebase/auth';
import {
  AppUser,
  BetaAssumptionRecord,
  Company,
  CompanyMetadataPatch,
  CompanyParameterOverride,
  DailyTradingRecord,
  DecisionItem,
  DividendRecord,
  DividendYearStatusRecord,
  InvestmentStory,
  MacroParameter,
  QuarterlyFinancialRecord,
  QuarterlyFinancialRecordWritePayload,
  TradeLog,
} from '../types';
import {
  classifyFirestoreError,
  createEmptySyncState,
  FirestoreSessionManager,
  isFirestorePermissionDeniedError,
  SessionToken,
  SyncCollectionState,
} from '../core/domain/firestoreSessionManager';
import {
  sanitizeQuarterlyReadRecord,
} from '../core/domain/quarterlyManualAudit';
import {
  canUserReadRealEstateDisclosures,
  evaluateRealEstateDisclosuresReadLinkage,
  type RealEstateDisclosuresLinkageSnapshot,
  type RealEstateDisclosuresReadState,
} from '../core/domain/realEstateDisclosureRead';
import {
  buildDividendDocId,
  buildDividendYearStatusDocId,
  companyMatchesSectorDefinition,
  deriveSectorPEMapFromDefinitions,
  ParameterWritePrecondition,
  REAL_ESTATE_DISCLOSURES_COLLECTION,
  SectorDefinitionPayload,
  SectorDeletePayload,
  SectorMutationReport,
  SectorStatusTogglePayload,
} from '../core/contracts';
import { tryNormalizedTicker } from '../core/domain/stockDerived';
import {
  FirestoreService,
  ParameterSaveReceipt,
  SaveCompanyOverrideInput,
  SyncStats,
} from '../services/firebase/firestoreService';
import { firebaseConfig, firestoreDatabaseId } from '../services/firebase/firebaseConfig';
import { CacheService } from '../services/storage/cacheService';

const createSyncStats = (
  status: SyncStats['status'],
  messageAr: string,
  extra?: Partial<SyncStats>
): SyncStats => ({
  lastSyncAt: extra?.lastSyncAt ?? '',
  lastCheckedAt: extra?.lastCheckedAt ?? CacheService.getLastCheckedAt(),
  lastUserWriteAt: extra?.lastUserWriteAt ?? CacheService.getLastUserWriteAt(),
  deltaCursorMs: extra?.deltaCursorMs ?? CacheService.getDeltaCursorMs(),
  collectionCursors: extra?.collectionCursors ?? CacheService.getAllCollectionDeltaCursors(),
  updatedEntitiesCount: extra?.updatedEntitiesCount ?? 0,
  collectionsChecked: extra?.collectionsChecked ?? 0,
  status,
  messageAr,
});

interface UseFirestoreSessionParams {
  firebaseUser: FirebaseUser | null;
  appUser: AppUser | null;
  canAccessAdmin: boolean;
  canEditFinancials: boolean;
  canExecuteTrades: boolean;
  isAdmin: boolean;
  onSelectTicker: (ticker: string | null) => void;
  onNavigateToTrades?: () => void;
}

export function useFirestoreSession({
  firebaseUser,
  appUser,
  canAccessAdmin,
  canEditFinancials,
  canExecuteTrades,
  isAdmin,
  onSelectTicker,
  onNavigateToTrades,
}: UseFirestoreSessionParams) {
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [retryCounter, setRetryCounter] = useState(0);

  const sessionManagerRef = useRef<FirestoreSessionManager>(new FirestoreSessionManager());
  const activeTokenRef = useRef<SessionToken | null>(null);
  const activePersistReqIdRef = useRef<number>(0);
  const [syncState, setSyncState] = useState<SyncCollectionState>(() => createEmptySyncState());
  const [syncStats, setSyncStats] = useState<SyncStats>(() =>
    createSyncStats('idle', 'في انتظار تأكيد الاتصال بخادم Firestore')
  );
  const canReadRealEstateDisclosures = Boolean(
    firebaseUser &&
      canUserReadRealEstateDisclosures(appUser) &&
      (canEditFinancials || isAdmin)
  );

  const persistResult = useCallback(async <T,>(operation: () => Promise<T>): Promise<T> => {
    const startToken = activeTokenRef.current;
    const reqId = ++activePersistReqIdRef.current;
    setSaving(true);
    setSaveError(null);
    try {
      return await operation();
    } catch (error) {
      const isStillCurrent =
        activeTokenRef.current === startToken && activePersistReqIdRef.current === reqId;
      if (isStillCurrent) {
        const message = error instanceof Error ? error.message : 'تعذر الحفظ في السحابة.';
        setSaveError(message);
      }
      throw error;
    } finally {
      const isStillCurrent =
        activeTokenRef.current === startToken && activePersistReqIdRef.current === reqId;
      if (isStillCurrent) {
        setSaving(false);
      }
    }
  }, []);

  const persist = useCallback(
    async (operation: () => Promise<void>): Promise<void> => {
      await persistResult(operation);
    },
    [persistResult]
  );

  useEffect(() => {
    CacheService.invalidateLegacyCachesIfNeeded();
  }, []);

  const clearInMemorySessionState = useCallback(() => {
    CacheService.setScope({
      projectId: firebaseConfig.projectId,
      databaseId: firestoreDatabaseId || 'default',
      uid: null,
    });
    const token = sessionManagerRef.current.beginSession(null);
    activeTokenRef.current = token;
    activePersistReqIdRef.current += 1;
    setSyncState(sessionManagerRef.current.getState());
    onSelectTicker(null);
    setSaving(false);
    setSaveError(null);
    setSyncStats(createSyncStats('idle', 'تتطلب المزامنة تسجيل الدخول'));
  }, [onSelectTicker]);

  useEffect(() => {
    let isMounted = true;
    const isNavigatorOnline = () =>
      typeof navigator === 'undefined' ? true : navigator.onLine !== false;

    const uid = firebaseUser && appUser?.isActive ? firebaseUser.uid : null;
    CacheService.setScope({
      projectId: firebaseConfig.projectId,
      databaseId: firestoreDatabaseId || 'default',
      uid,
    });

    const token = sessionManagerRef.current.beginSession(uid, {
      canReadRealEstateDisclosures,
    });
    activeTokenRef.current = token;
    activePersistReqIdRef.current += 1;
    setSyncState(sessionManagerRef.current.getState());
    onSelectTicker(null);
    setSaving(false);
    setSaveError(null);

    if (uid && !canReadRealEstateDisclosures) {
      // Wipe any previously cached real_estate_disclosures for this user scope on role revocation
      CacheService.clearRealEstateDisclosuresCache();
    }

    if (!uid) {
      FirestoreService.unsubscribeAll();
      setSyncStats(createSyncStats('idle', 'تتطلب المزامنة تسجيل الدخول'));
      return () => {
        isMounted = false;
      };
    }

    setSyncStats((prev) => ({
      ...prev,
      status: 'syncing',
      messageAr: 'جارٍ انتظار تأكيد الخادم من Firestore...',
    }));

    const handleCollectionSnapshot = <
      K extends keyof Pick<
        SyncCollectionState,
        | 'companiesMeta'
        | 'stories'
        | 'decisions'
        | 'trades'
        | 'macroParams'
        | 'sectorPEMap'
        | 'dailyRecords'
        | 'dailySchemas'
        | 'dividendRecords'
        | 'dividendYearStatuses'
        | 'users'
      >,
    >(
      key: K,
      data: SyncCollectionState[K],
      meta: { fromCache: boolean; hasPendingWrites: boolean }
    ) => {
      if (!isMounted) return;
      const res = sessionManagerRef.current.applyNonQuarterlySnapshot(token, key, data, meta);
      if (res.accepted) {
        setSyncState(res.state);
      }
    };

    const unsubscribe = FirestoreService.subscribeToAll({
      onCompanies: (updated, meta) => handleCollectionSnapshot('companiesMeta', updated, meta),
      onStories: (updated, meta) => handleCollectionSnapshot('stories', updated, meta),
      onDecisions: (updated, meta) => handleCollectionSnapshot('decisions', updated, meta),
      onTrades: (updated, meta) => handleCollectionSnapshot('trades', updated, meta),
      onDailyTrading: (updated, meta) => handleCollectionSnapshot('dailyRecords', updated, meta),
      onDailySchemas: (updated, meta) => handleCollectionSnapshot('dailySchemas', updated, meta),
      onDividendRecords: (updated, meta) => handleCollectionSnapshot('dividendRecords', updated, meta),
      onDividendYearStatuses: (updated, meta) => handleCollectionSnapshot('dividendYearStatuses', updated, meta),
      onSectorPE: (values, meta, definitions) => {
        if (!isMounted) return;
        if (definitions) {
          const res = sessionManagerRef.current.applySectorPESnapshot(token, definitions, values, meta);
          if (res.accepted) {
            setSyncState(res.state);
          }
          return;
        }
        handleCollectionSnapshot('sectorPEMap', values, meta);
      },
      onMacroParams: (updated, meta) => handleCollectionSnapshot('macroParams', updated, meta),
      onBetaAssumptions: (updated, meta) => {
        if (!isMounted) return;
        const res = sessionManagerRef.current.applyBetaSnapshot(token, updated, meta);
        if (res.accepted) {
          setSyncState(res.state);
        }
      },
      onCompanyOverrides: (updated, meta) => {
        if (!isMounted) return;
        const res = sessionManagerRef.current.applyCompanyOverridesSnapshot(token, updated, meta);
        if (res.accepted) {
          setSyncState(res.state);
        }
      },
      canReadRealEstateDisclosures,
      onRealEstateDisclosures: canReadRealEstateDisclosures
        ? (updated, meta) => {
            if (!isMounted) return false;
            const res = sessionManagerRef.current.applyRealEstateDisclosuresSnapshot(
              token,
              updated,
              meta,
              isNavigatorOnline()
            );
            if (res.accepted) {
              setSyncState(res.state);
            }
            return res.accepted;
          }
        : undefined,
      onUsers: canAccessAdmin
        ? (updated, meta) => handleCollectionSnapshot('users', updated, meta)
        : undefined,
      onQuarterlyRecords: (updated, meta) => {
        if (!isMounted) return;
        const res = sessionManagerRef.current.applyQuarterlySnapshot(
          token,
          updated,
          meta,
          isNavigatorOnline()
        );
        if (!res.accepted) return;
        setSyncState(res.state);
        if (!meta.fromCache) {
          const nowIso = new Date().toISOString();
          CacheService.setLastCheckedAt(nowIso);
          const currentStats = FirestoreService.getSyncStats();
          setSyncStats({
            lastSyncAt: nowIso,
            lastCheckedAt: nowIso,
            lastUserWriteAt: currentStats.lastUserWriteAt,
            deltaCursorMs: currentStats.deltaCursorMs,
            collectionCursors: currentStats.collectionCursors,
            updatedEntitiesCount: updated.length,
            collectionsChecked:
              13 + (canAccessAdmin ? 1 : 0) + (canReadRealEstateDisclosures ? 1 : 0),
            status: 'synced',
            messageAr: `مؤكد من الخادم (${updated.length} سجل مالي فصلي)`,
          });
        } else if (res.reason === 'cached_offline') {
          setSyncStats((prev) => ({
            ...prev,
            status: 'offline',
            messageAr: 'غير متصل بالإنترنت — بانتظار تأكيد الخادم',
          }));
        }
      },
      onError: (collectionName, err) => {
        if (!isMounted) return;
        if (
          collectionName === REAL_ESTATE_DISCLOSURES_COLLECTION &&
          isFirestorePermissionDeniedError(err) &&
          sessionManagerRef.current.isTokenActive(token)
        ) {
          CacheService.clearRealEstateDisclosuresCache();
        }
        const res = sessionManagerRef.current.applyConnectionError(
          token,
          collectionName,
          err,
          canAccessAdmin,
          isNavigatorOnline()
        );
        if (!res.accepted) return;
        setSyncState(res.state);
        if (res.state.connectionError) {
          setSyncStats((prev) => ({
            ...prev,
            status: res.state.connectionError?.type === 'offline' ? 'offline' : 'error',
            messageAr:
              res.state.connectionError?.type === 'permission_denied'
                ? 'لا توجد صلاحية لقراءة البيانات'
                : res.state.connectionError?.type === 'offline'
                ? 'تعذر الاتصال بالإنترنت أو بخادم Firestore'
                : 'تعذر الاتصال بـ Firestore',
          }));
        }
      },
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [
    firebaseUser?.uid,
    appUser?.isActive,
    canAccessAdmin,
    canReadRealEstateDisclosures,
    retryCounter,
    onSelectTicker,
  ]);

  const handleManualSync = useCallback(async () => {
    const token = activeTokenRef.current;
    if (!firebaseUser || !appUser?.isActive || !token) return;
    const latestState = sessionManagerRef.current.getState();
    const canAttemptRealEstate =
      canReadRealEstateDisclosures && latestState.realEstateDisclosuresAuthorized;
    setSyncState((prev) => ({ ...prev, connectionError: null }));
    setSyncStats((prev) => ({
      ...prev,
      status: 'syncing',
      messageAr: 'جارٍ جلب البيانات المؤكدة من خادم Firestore...',
    }));
    try {
      let mergeApplied = false;
      const { stats, data, abortedReason } = await FirestoreService.syncAllIncrementalDeltas({
        hasFullBaseline: latestState.quarterlyConfirmed,
        canReadRealEstateDisclosures: canAttemptRealEstate,
        existingRealEstateDisclosures: latestState.realEstateDisclosures,
        isOperationValid: () => sessionManagerRef.current.isTokenActive(token),
        isRealEstateStillAuthorized: () =>
          sessionManagerRef.current.isTokenActive(token) &&
          sessionManagerRef.current.getState().realEstateDisclosuresAuthorized,
        confirmedBaselines: {
          quarterly: latestState.quarterlyConfirmed,
          companies: latestState.companiesConfirmed,
          dailySchemas:
            latestState.quarterlyConfirmed || Object.keys(latestState.dailySchemas).length > 0,
          betaAssumptions: latestState.betaConfirmed,
          sectorPE: latestState.sectorPeConfirmed,
          companyOverrides: latestState.companyOverridesConfirmed,
          dividendRecords: latestState.dividendConfirmed,
          dividendYearStatuses: latestState.dividendYearStatusesConfirmed,
          realEstateDisclosures:
            canAttemptRealEstate && latestState.realEstateDisclosuresConfirmed,
        },
        onConfirmedMerge: (payload) => {
          if (
            payload.realEstateDisclosuresSyncOutcome?.status === 'error' &&
            isFirestorePermissionDeniedError(payload.realEstateDisclosuresSyncOutcome.error) &&
            sessionManagerRef.current.isTokenActive(token)
          ) {
            CacheService.clearRealEstateDisclosuresCache();
          }
          const res = sessionManagerRef.current.applyManualSyncResult(token, payload);
          if (!res.accepted) return false;
          mergeApplied = true;
          setSyncState(res.state);
          return true;
        },
      });
      if (
        data.realEstateDisclosuresSyncOutcome?.status === 'error' &&
        isFirestorePermissionDeniedError(data.realEstateDisclosuresSyncOutcome.error) &&
        sessionManagerRef.current.isTokenActive(token)
      ) {
        CacheService.clearRealEstateDisclosuresCache();
      }
      if (
        !mergeApplied ||
        abortedReason === 'stale_scope' ||
        !sessionManagerRef.current.isTokenActive(token)
      ) {
        return;
      }
      setSyncStats(stats);
    } catch (err: any) {
      if (!sessionManagerRef.current.isTokenActive(token)) return;
      const isOnline = typeof navigator === 'undefined' ? true : navigator.onLine !== false;
      const classified = classifyFirestoreError('quarterly_financial_records', err, isOnline);
      setSyncState((prev) => ({
        ...prev,
        connectionError: classified,
      }));
      setSyncStats((prev) => ({
        ...prev,
        status: classified.type === 'offline' ? 'offline' : 'error',
        messageAr:
          classified.type === 'permission_denied'
            ? 'لا توجد صلاحية للمزامنة'
            : classified.type === 'offline'
            ? 'غير متصل بخادم Firestore'
            : 'تعذر الاتصال بـ Firestore',
      }));
    }
  }, [firebaseUser, appUser?.isActive, canReadRealEstateDisclosures]);

  const mergeQuarterly = useCallback((records: QuarterlyFinancialRecord[]) => {
    setSyncState((prev) => {
      const map = new Map<string, QuarterlyFinancialRecord>(
        prev.quarterlyRecords.map((r) => [`${tryNormalizedTicker(r.ticker) ?? r.ticker}_${r.year}_${r.quarter}`, r])
      );
      records.forEach((r) => {
        const tk = tryNormalizedTicker(r.ticker) ?? r.ticker;
        map.set(`${tk}_${r.year}_${r.quarter}`, sanitizeQuarterlyReadRecord({ ...r, ticker: tk }));
      });
      return {
        ...prev,
        quarterlyRecords: [...map.values()],
        quarterlyConfirmed: true,
      };
    });
  }, []);

  const mergeDaily = useCallback((records: DailyTradingRecord[]) => {
    setSyncState((prev) => {
      const map = new Map<string, DailyTradingRecord>(
        prev.dailyRecords.map((r) => [`${tryNormalizedTicker(r.ticker) ?? r.ticker}_${r.tradeDate}`, r])
      );
      records.forEach((r) => {
        const tk = tryNormalizedTicker(r.ticker) ?? r.ticker;
        map.set(`${tk}_${r.tradeDate}`, { ...r, ticker: tk });
      });
      return {
        ...prev,
        dailyRecords: [...map.values()].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate)),
      };
    });
  }, []);

  const mergeDividends = useCallback((records: DividendRecord[]) => {
    const safeId = (r: DividendRecord) => {
      const tk = tryNormalizedTicker(r.ticker) ?? r.ticker;
      try {
        return buildDividendDocId({
          ticker: tk,
          fiscalYear: r.fiscalYear,
          recordType: r.recordType,
          distributionId: r.distributionId,
        });
      } catch {
        return `${tk}_${r.fiscalYear}_${r.recordType}_${r.distributionId}`;
      }
    };
    setSyncState((prev) => {
      const map = new Map<string, DividendRecord>(prev.dividendRecords.map((r) => [safeId(r), r]));
      records.forEach((r) => {
        const tk = tryNormalizedTicker(r.ticker) ?? r.ticker;
        const normalized = { ...r, ticker: tk };
        map.set(safeId(normalized), normalized);
      });
      return {
        ...prev,
        dividendRecords: [...map.values()],
        dividendConfirmed: true,
      };
    });
  }, []);

  const handleAddStockAndQuarter = useCallback(
    async (payload: {
      quarterlyRecord: QuarterlyFinancialRecord;
      companyMetadata?: CompanyMetadataPatch;
    }) => {
      if (!canEditFinancials) {
        throw new Error('ليست لديك صلاحية لإضافة الأسهم والسجلات المالية.');
      }

      await persist(async () => {
        await FirestoreService.saveStockAndQuarter(payload.quarterlyRecord, payload.companyMetadata);
        if (payload.companyMetadata) {
          const metaPatch = payload.companyMetadata;
          setSyncState((prev) => {
            const existing = prev.companiesMeta.find((c) => c.id === metaPatch.id);
            if (existing) {
              const merged: Company = { ...existing, ...metaPatch, id: existing.id, ticker: existing.ticker };
              return {
                ...prev,
                companiesMeta: prev.companiesMeta.map((c) => (c.id === existing.id ? merged : c)),
              };
            }
            const created: Company = {
              id: metaPatch.id,
              ticker: metaPatch.ticker,
              nameAr: metaPatch.nameAr ?? payload.quarterlyRecord.stockName ?? metaPatch.ticker,
              nameEn: metaPatch.nameEn ?? metaPatch.nameAr ?? metaPatch.ticker,
              sector: metaPatch.sector ?? '',
              sectorClassification: metaPatch.sectorClassification,
              marketPrice: null,
              sharesOutstanding: payload.quarterlyRecord.shares,
              beta: null,
              riskFreeRate: null,
              equityRiskPremium: null,
              costOfDebt: null,
              taxRate: null,
              targetDebtRatio: null,
              sustainableGrowthRate: null,
              shortTermGrowthRate: null,
              targetPE: null,
              targetPB: null,
              currency:
                metaPatch.currency ??
                (payload.quarterlyRecord.financialCurrency
                  ? String(payload.quarterlyRecord.financialCurrency)
                  : ''),
              description: metaPatch.description ?? '',
            };
            return {
              ...prev,
              companiesMeta: [created, ...prev.companiesMeta],
            };
          });
        }
        mergeQuarterly([payload.quarterlyRecord]);
        onSelectTicker(tryNormalizedTicker(payload.quarterlyRecord.ticker) ?? payload.quarterlyRecord.ticker);
      });
    },
    [canEditFinancials, persist, mergeQuarterly, onSelectTicker]
  );

  const handleUpdateCompanyParams = useCallback(
    (selectedCompany: Company | null, updates: Partial<Company>) => {
      if (!canEditFinancials || !selectedCompany) return;
      const patch: CompanyMetadataPatch = {
        id: selectedCompany.id,
        ticker: selectedCompany.ticker,
        ...updates,
      };
      persist(async () => {
        await FirestoreService.patchCompanyMetadata(patch);
        setSyncState((prev) => {
          const existingMeta = prev.companiesMeta.find((c) => c.id === selectedCompany.id);
          const updated: Company = {
            ...(existingMeta ?? selectedCompany),
            ...updates,
            id: selectedCompany.id,
            ticker: selectedCompany.ticker,
          };
          const nextCompanies = existingMeta
            ? prev.companiesMeta.map((c) => (c.id === updated.id ? updated : c))
            : [...prev.companiesMeta, updated];
          return { ...prev, companiesMeta: nextCompanies };
        });
      }).catch(() => undefined);
    },
    [canEditFinancials, persist]
  );

  const handlePatchCompanyMetadata = useCallback(
    async (patch: CompanyMetadataPatch) => {
      if (!canEditFinancials && !isAdmin) {
        throw new Error('ليست لديك صلاحية لتعديل بيانات الشركة.');
      }
      await persist(async () => {
        await FirestoreService.patchCompanyMetadata(patch);
        setSyncState((prev) => {
          const normTk = tryNormalizedTicker(patch.ticker) ?? patch.ticker;
          const existingMeta = prev.companiesMeta.find(
            (c) => c.id === patch.id || (tryNormalizedTicker(c.ticker) ?? c.ticker) === normTk
          );
          if (existingMeta) {
            const updated: Company = {
              ...existingMeta,
              ...patch,
              id: existingMeta.id,
              ticker: existingMeta.ticker,
            };
            return {
              ...prev,
              companiesMeta: prev.companiesMeta.map((c) => (c.id === existingMeta.id ? updated : c)),
            };
          }
          const created: Company = {
            id: patch.id,
            ticker: normTk,
            nameAr: patch.nameAr ?? normTk,
            nameEn: patch.nameEn ?? patch.nameAr ?? normTk,
            sector: patch.sector ?? '',
            sectorId: patch.sectorId,
            sectorSource: patch.sectorSource,
            sectorDate: patch.sectorDate,
            sectorClassification: patch.sectorClassification,
            marketPrice: null,
            sharesOutstanding: null,
            beta: null,
            riskFreeRate: null,
            equityRiskPremium: null,
            costOfDebt: null,
            taxRate: null,
            targetDebtRatio: null,
            sustainableGrowthRate: null,
            shortTermGrowthRate: null,
            targetPE: null,
            targetPB: null,
            currency: patch.currency ?? 'EGP',
            description: patch.description ?? '',
          };
          return {
            ...prev,
            companiesMeta: [...prev.companiesMeta, created],
          };
        });
      });
    },
    [canEditFinancials, isAdmin, persist]
  );

  const handleImportDailyRecords = useCallback(
    (records: DailyTradingRecord[], _date: string) =>
      persist(async () => {
        await FirestoreService.bulkSaveDailyTradingRecords(records);
        mergeDaily(records);
      }),
    [persist, mergeDaily]
  );

  const handleImportQuarterlyRecords = useCallback(
    (records: QuarterlyFinancialRecord[]) =>
      persist(async () => {
        await FirestoreService.bulkSaveQuarterlyRecords(records);
        mergeQuarterly(records);
      }),
    [persist, mergeQuarterly]
  );

  const handleUpdateQuarterlyRecord = useCallback(
    (
      record: QuarterlyFinancialRecord,
      writePayload?: QuarterlyFinancialRecordWritePayload
    ) =>
      persist(async () => {
        await FirestoreService.saveQuarterlyFinancialRecord(writePayload ?? record);
        mergeQuarterly([sanitizeQuarterlyReadRecord(record)]);
      }),
    [persist, mergeQuarterly]
  );

  const handleDeleteQuarterlyRecord = useCallback(
    (ticker: string, year: number, quarter: string) =>
      persist(async () => {
        const normalized = tryNormalizedTicker(ticker) ?? ticker;
        await FirestoreService.deleteQuarterlyFinancialRecord(normalized, year, quarter);
        setSyncState((prev) => ({
          ...prev,
          quarterlyRecords: prev.quarterlyRecords.filter(
            (r) =>
              !((tryNormalizedTicker(r.ticker) ?? r.ticker) === normalized && r.year === year && r.quarter === quarter)
          ),
        }));
      }),
    [persist]
  );

  const handleUpdateDailyRecord = useCallback(
    (record: DailyTradingRecord) =>
      persist(async () => {
        await FirestoreService.saveDailyTradingRecord(record);
        mergeDaily([record]);
      }),
    [persist, mergeDaily]
  );

  const handleDeleteDailyRecord = useCallback(
    (ticker: string, tradeDate: string) =>
      persist(async () => {
        const normalized = tryNormalizedTicker(ticker) ?? ticker;
        await FirestoreService.deleteDailyTradingRecord(normalized, tradeDate);
        setSyncState((prev) => ({
          ...prev,
          dailyRecords: prev.dailyRecords.filter(
            (r) => !((tryNormalizedTicker(r.ticker) ?? r.ticker) === normalized && r.tradeDate === tradeDate)
          ),
        }));
      }),
    [persist]
  );

  const handleImportDividendRecords = useCallback(
    (records: DividendRecord[]) =>
      persist(async () => {
        await FirestoreService.bulkSaveDividendRecords(records);
        mergeDividends(records);
      }),
    [persist, mergeDividends]
  );

  const handleUpdateDividendRecord = useCallback(
    (record: DividendRecord) =>
      persist(async () => {
        await FirestoreService.saveDividendRecord(record);
        mergeDividends([record]);
      }),
    [persist, mergeDividends]
  );

  const handleDeleteDividendRecord = useCallback(
    (record: Pick<DividendRecord, 'ticker' | 'fiscalYear' | 'recordType' | 'distributionId'>) =>
      persist(async () => {
        const tk = tryNormalizedTicker(record.ticker) ?? record.ticker;
        const targetId = buildDividendDocId({
          ticker: tk,
          fiscalYear: record.fiscalYear,
          recordType: record.recordType,
          distributionId: record.distributionId,
        });
        await FirestoreService.deleteDividendRecord(targetId);
        setSyncState((prev) => {
          const remainingDividends = prev.dividendRecords.filter((r) => {
            const rTk = tryNormalizedTicker(r.ticker) ?? r.ticker;
            return !(
              rTk === tk &&
              r.fiscalYear === record.fiscalYear &&
              r.recordType === record.recordType &&
              r.distributionId === record.distributionId
            );
          });
          return {
            ...prev,
            dividendRecords: remainingDividends,
          };
        });
      }),
    [persist]
  );

  const handleSaveDividendYearStatus = useCallback(
    (record: DividendYearStatusRecord) =>
      persist(async () => {
        const tk = tryNormalizedTicker(record.ticker) ?? record.ticker;
        const docId = buildDividendYearStatusDocId(tk, record.fiscalYear);
        const normalizedRecord: DividendYearStatusRecord = {
          ...record,
          id: docId,
          ticker: tk,
          updatedAt: new Date().toISOString(),
        };
        await FirestoreService.saveDividendYearStatus(normalizedRecord);
        setSyncState((prev) => {
          const filtered = prev.dividendYearStatuses.filter((item) => {
            const itemTk = tryNormalizedTicker(item.ticker) ?? item.ticker;
            return !(itemTk === tk && item.fiscalYear === record.fiscalYear);
          });
          return {
            ...prev,
            dividendYearStatuses: [...filtered, normalizedRecord],
            dividendYearStatusesConfirmed: true,
          };
        });
      }),
    [persist]
  );

  const handleDeleteDividendYearStatus = useCallback(
    (ticker: string, fiscalYear: number) =>
      persist(async () => {
        const tk = tryNormalizedTicker(ticker) ?? ticker;
        await FirestoreService.deleteDividendYearStatus({ ticker: tk, fiscalYear });
        setSyncState((prev) => ({
          ...prev,
          dividendYearStatuses: prev.dividendYearStatuses.filter((item) => {
            const itemTk = tryNormalizedTicker(item.ticker) ?? item.ticker;
            return !(itemTk === tk && item.fiscalYear === fiscalYear);
          }),
        }));
      }),
    [persist]
  );

  const handleSaveCompanyOverride = useCallback(
    (input: SaveCompanyOverrideInput): Promise<ParameterSaveReceipt> =>
      persistResult(async () => {
        if (!canEditFinancials && !isAdmin) {
          throw new Error('ليست لديك صلاحية لتعديل افتراضات الشركة.');
        }
        const { override, receipt } = await FirestoreService.saveCompanyParameterOverride(input);
        const tk = override.ticker;
        setSyncState((prev) => {
          const filtered = prev.companyOverrides.filter(
            (o) => !((tryNormalizedTicker(o.ticker) ?? o.ticker) === tk && o.key === override.key)
          );
          return {
            ...prev,
            companyOverrides: [...filtered, override],
            companyOverridesConfirmed: true,
          };
        });
        return receipt;
      }),
    [canEditFinancials, isAdmin, persistResult]
  );

  const handleSaveBetaAssumption = useCallback(
    (record: BetaAssumptionRecord): Promise<ParameterSaveReceipt> =>
      persistResult(async () => {
        if (!canEditFinancials && !isAdmin) {
          throw new Error('ليست لديك صلاحية لتعديل سجل بيتا التاريخية.');
        }
        const { record: savedRecord, receipt } = await FirestoreService.saveBetaAssumption(record);
        const tk = savedRecord.ticker;
        setSyncState((prev) => {
          const filtered = prev.betaAssumptions.filter(
            (b) => (tryNormalizedTicker(b.ticker) ?? b.ticker) !== tk
          );
          return {
            ...prev,
            betaAssumptions: [...filtered, savedRecord],
            betaConfirmed: true,
          };
        });
        return receipt;
      }),
    [canEditFinancials, isAdmin, persistResult]
  );

  const handleDeleteBetaAssumption = useCallback(
    (ticker: string): Promise<{ docPath: string }> =>
      persistResult(async () => {
        if (!isAdmin && !canEditFinancials) {
          throw new Error('ليست لديك صلاحية لحذف سجل بيتا.');
        }
        const res = await FirestoreService.deleteBetaAssumption(ticker);
        const tk = tryNormalizedTicker(ticker) ?? ticker;
        setSyncState((prev) => ({
          ...prev,
          betaAssumptions: prev.betaAssumptions.filter(
            (b) => (tryNormalizedTicker(b.ticker) ?? b.ticker) !== tk
          ),
          betaConfirmed: true,
        }));
        return { docPath: res.docPath };
      }),
    [canEditFinancials, isAdmin, persistResult]
  );

  const handleDeleteCompanyOverride = useCallback(
    (ticker: string, key: string): Promise<{ docPath: string }> =>
      persistResult(async () => {
        if (!canEditFinancials && !isAdmin) {
          throw new Error('ليست لديك صلاحية لمسح تخصيص الشركة.');
        }
        const res = await FirestoreService.deleteParameter(key, 'company', ticker);
        const tk = tryNormalizedTicker(ticker) ?? ticker;
        setSyncState((prev) => ({
          ...prev,
          companyOverrides: prev.companyOverrides.filter(
            (o) => !((tryNormalizedTicker(o.ticker) ?? o.ticker) === tk && o.key === key)
          ),
          companyOverridesConfirmed: true,
        }));
        return { docPath: res.docPath };
      }),
    [canEditFinancials, isAdmin, persistResult]
  );

  const handleSaveSingleMacroParam = useCallback(
    (
      param: MacroParameter,
      precondition: ParameterWritePrecondition
    ): Promise<ParameterSaveReceipt> =>
      persistResult(async () => {
        if (!isAdmin) {
          throw new Error('تعديل المعاملات العامة (macro_params) للمدير فقط.');
        }
        const startToken = activeTokenRef.current;
        const { param: savedParam, receipt } = await FirestoreService.saveMacroParameter(
          param,
          precondition
        );
        if (startToken) {
          const createdKeys =
            precondition.mode === 'create' ? new Set<string>([savedParam.key]) : undefined;
          const res = sessionManagerRef.current.applyMacroParamSaveConfirmation(
            startToken,
            [savedParam],
            { createdKeys }
          );
          if (res.accepted) {
            setSyncState(res.state);
          }
        }
        return receipt;
      }),
    [isAdmin, persistResult]
  );

  const handleSaveMacroParams = useCallback(
    (
      params: MacroParameter[],
      preconditionsByKey: Record<string, ParameterWritePrecondition>
    ): Promise<MacroParameter[]> =>
      persistResult(async () => {
        if (params.length === 0) return [];
        const startToken = activeTokenRef.current;
        const savedParams = await FirestoreService.bulkSaveMacroParameters(
          params,
          preconditionsByKey
        );
        if (startToken) {
          const createdKeys = new Set<string>(
            Object.entries(preconditionsByKey)
              .filter(([, pre]) => pre?.mode === 'create')
              .map(([k]) => k)
          );
          const res = sessionManagerRef.current.applyMacroParamSaveConfirmation(
            startToken,
            savedParams,
            { createdKeys: createdKeys.size > 0 ? createdKeys : undefined }
          );
          if (res.accepted) {
            setSyncState(res.state);
          }
        }
        return savedParams;
      }),
    [persistResult]
  );

  const handleDeleteMacroParam = useCallback(
    (key: string) =>
      persist(async () => {
        const startToken = activeTokenRef.current;
        await FirestoreService.deleteParameter(key, 'global');
        if (startToken) {
          const res = sessionManagerRef.current.applyMacroParamDeletion(startToken, key);
          if (res.accepted) {
            setSyncState(res.state);
          }
        }
      }),
    [persist]
  );

  const handleSaveSectorPE = useCallback(
    (values: Record<string, number>) => {
      persist(async () => {
        await FirestoreService.saveSectorPE(values);
        setSyncState((prev) => ({
          ...prev,
          sectorPEMap: values,
          sectorPeConfirmed: true,
          sectorPeStatus: 'ready',
          sectorPeError: null,
        }));
      }).catch(() => undefined);
    },
    [persist]
  );

  const handleUpsertSector = useCallback(
    (payload: SectorDefinitionPayload) =>
      persistResult(async () => {
        if (!isAdmin) {
          throw new Error('إدارة القطاعات (sectorPE) مخصصة للمدير فقط.');
        }
        const { definition, response } = await FirestoreService.upsertSectorDefinition(payload);
        setSyncState((prev) => {
          const prevTarget = prev.sectorDefinitions.find((d) => d.sectorId === definition.sectorId) ?? null;
          const nextDefs = [
            ...prev.sectorDefinitions.filter((d) => d.sectorId !== definition.sectorId),
            definition,
          ].sort((a, b) => a.nameAr.localeCompare(b.nameAr, 'ar'));
          const shouldPropagate =
            payload.propagateToCompanies !== false &&
            (response.sectorReport ? response.sectorReport.completed : true);
          const nextCompanies = shouldPropagate
            ? prev.companiesMeta.map((c) =>
                companyMatchesSectorDefinition(
                  c,
                  definition.sectorId,
                  prevTarget ?? definition,
                  prev.sectorDefinitions
                )
                  ? {
                      ...c,
                      sectorId: definition.sectorId,
                      sector: definition.nameAr,
                      sectorClassification: definition.classification,
                      sectorSource: 'sector_registry_sync',
                    }
                  : c
              )
            : prev.companiesMeta;
          return {
            ...prev,
            sectorDefinitions: nextDefs,
            sectorPEMap: deriveSectorPEMapFromDefinitions(nextDefs),
            companiesMeta: nextCompanies,
            sectorPeConfirmed: true,
            sectorPeStatus: 'ready',
            sectorPeError: null,
          };
        });
        return { definition, report: response.sectorReport };
      }),
    [isAdmin, persistResult]
  );

  const handleToggleSectorStatus = useCallback(
    (payload: SectorStatusTogglePayload): Promise<SectorMutationReport | undefined> =>
      persistResult(async () => {
        if (!isAdmin) {
          throw new Error('إدارة القطاعات (sectorPE) مخصصة للمدير فقط.');
        }
        const response = await FirestoreService.toggleSectorStatus(payload);
        const completed = response.sectorReport ? response.sectorReport.completed : true;
        if (completed) {
          setSyncState((prev) => {
            const target = prev.sectorDefinitions.find((d) => d.sectorId === payload.sectorId) ?? null;
            const reassignTarget = payload.reassignToSectorId
              ? prev.sectorDefinitions.find((d) => d.sectorId === payload.reassignToSectorId) ?? null
              : null;
            const nextDefs = prev.sectorDefinitions.map((d) =>
              d.sectorId === payload.sectorId ? { ...d, status: payload.status } : d
            );
            const nextCompanies =
              payload.status === 'disabled' && reassignTarget
                ? prev.companiesMeta.map((c) =>
                    companyMatchesSectorDefinition(
                      c,
                      payload.sectorId,
                      target,
                      prev.sectorDefinitions
                    )
                      ? {
                          ...c,
                          sectorId: reassignTarget.sectorId,
                          sector: reassignTarget.nameAr,
                          sectorClassification: reassignTarget.classification,
                          sectorSource: 'sector_registry_reassign',
                        }
                      : c
                  )
                : prev.companiesMeta;
            return {
              ...prev,
              sectorDefinitions: nextDefs,
              sectorPEMap: deriveSectorPEMapFromDefinitions(nextDefs),
              companiesMeta: nextCompanies,
            };
          });
        }
        return response.sectorReport;
      }),
    [isAdmin, persistResult]
  );

  const handleDeleteSector = useCallback(
    (payload: SectorDeletePayload): Promise<SectorMutationReport | undefined> =>
      persistResult(async () => {
        if (!isAdmin) {
          throw new Error('إدارة القطاعات (sectorPE) مخصصة للمدير فقط.');
        }
        const response = await FirestoreService.deleteSectorDefinition(payload);
        const completed = response.sectorReport ? response.sectorReport.completed : true;
        if (completed) {
          setSyncState((prev) => {
            const target = prev.sectorDefinitions.find((d) => d.sectorId === payload.sectorId) ?? null;
            const reassignTarget = payload.reassignToSectorId
              ? prev.sectorDefinitions.find((d) => d.sectorId === payload.reassignToSectorId) ?? null
              : null;
            const nextDefs = prev.sectorDefinitions.filter((d) => d.sectorId !== payload.sectorId);
            const nextCompanies =
              reassignTarget
                ? prev.companiesMeta.map((c) =>
                    companyMatchesSectorDefinition(
                      c,
                      payload.sectorId,
                      target,
                      prev.sectorDefinitions
                    )
                      ? {
                          ...c,
                          sectorId: reassignTarget.sectorId,
                          sector: reassignTarget.nameAr,
                          sectorClassification: reassignTarget.classification,
                          sectorSource: 'sector_registry_reassign',
                        }
                      : c
                  )
                : prev.companiesMeta;
            return {
              ...prev,
              sectorDefinitions: nextDefs,
              sectorPEMap: deriveSectorPEMapFromDefinitions(nextDefs),
              companiesMeta: nextCompanies,
            };
          });
        }
        return response.sectorReport;
      }),
    [isAdmin, persistResult]
  );

  const handleUpdateStory = useCallback(
    (story: InvestmentStory) => {
      if (!isAdmin) return;
      persist(async () => {
        await FirestoreService.saveStory(story);
        setSyncState((prev) => ({ ...prev, stories: { ...prev.stories, [story.companyId]: story } }));
      }).catch(() => undefined);
    },
    [isAdmin, persist]
  );

  const handleUpdateDecision = useCallback(
    (decision: DecisionItem) => {
      if (!isAdmin) return;
      persist(async () => {
        await FirestoreService.saveDecision(decision);
        setSyncState((prev) => ({ ...prev, decisions: { ...prev.decisions, [decision.companyId]: decision } }));
      }).catch(() => undefined);
    },
    [isAdmin, persist]
  );

  const handleCreateTradeFromDecision = useCallback(
    (selectedCompany: Company | null, compositeFairValue: number | null, decisionItem: DecisionItem) => {
      if (!canExecuteTrades || !selectedCompany || compositeFairValue === null) {
        setSaveError('لا يمكن إنشاء صفقة دون صلاحية وقيمة عادلة متاحة.');
        return;
      }
      if (selectedCompany.marketPrice === null) {
        setSaveError('لا يمكن ترحيل صفقة دون سعر سوقي حالي متاح في التداول اليومي.');
        return;
      }
      const newTrade: TradeLog = {
        id: `trade_${Date.now()}`,
        companyId: selectedCompany.id,
        ticker: selectedCompany.ticker,
        companyName: selectedCompany.nameAr,
        action: decisionItem.finalDecision.includes('شراء') ? 'شراء' : 'تجميع',
        plannedEntryPrice: selectedCompany.marketPrice,
        targetFairValue: decisionItem.targetExitPrice || compositeFairValue,
        stopLoss: decisionItem.stopLossPrice,
        portfolioWeightPct: 10,
        status: 'مخطط',
        entryDate: new Date().toISOString().split('T')[0],
        notes: `ترحيل من مصفوفة القرار: ${decisionItem.finalDecision}`,
      };
      persist(async () => {
        await FirestoreService.createTrade(newTrade);
        setSyncState((prev) => ({ ...prev, trades: [newTrade, ...prev.trades] }));
        onNavigateToTrades?.();
      }).catch(() => undefined);
    },
    [canExecuteTrades, persist, onNavigateToTrades]
  );

  const handleAddTrade = useCallback(
    (newTrade: TradeLog) => {
      if (!canExecuteTrades) return;
      persist(async () => {
        await FirestoreService.createTrade(newTrade);
        setSyncState((prev) => ({ ...prev, trades: [newTrade, ...prev.trades] }));
      }).catch(() => undefined);
    },
    [canExecuteTrades, persist]
  );

  const handleUpdateTrade = useCallback(
    (id: string, updates: Partial<TradeLog>) => {
      if (!canExecuteTrades) return;
      const trade = syncState.trades.find((t) => t.id === id);
      if (!trade) return;
      const updated = { ...trade, ...updates };
      persist(async () => {
        await FirestoreService.updateTrade(updated);
        setSyncState((prev) => ({
          ...prev,
          trades: prev.trades.map((t) => (t.id === id ? updated : t)),
        }));
      }).catch(() => undefined);
    },
    [canExecuteTrades, syncState.trades, persist]
  );

  const handleDeleteTrade = useCallback(
    (id: string) => {
      if (!canExecuteTrades) return;
      persist(async () => {
        await FirestoreService.deleteTrade(id);
        setSyncState((prev) => ({ ...prev, trades: prev.trades.filter((t) => t.id !== id) }));
      }).catch(() => undefined);
    },
    [canExecuteTrades, persist]
  );

  const realEstateDisclosuresLinkage: RealEstateDisclosuresLinkageSnapshot = useMemo(
    () =>
      evaluateRealEstateDisclosuresReadLinkage(syncState.realEstateDisclosures, {
        companies: syncState.companiesMeta,
        companiesConfirmed: syncState.companiesConfirmed,
        companiesFromCache: syncState.fromCache,
        companiesError: syncState.companiesError,
        quarterlyRecords: syncState.quarterlyRecords,
        quarterlyConfirmed: syncState.quarterlyConfirmed,
        quarterlyFromCache: syncState.fromCache,
        quarterlyError:
          syncState.connectionError && !syncState.quarterlyConfirmed
            ? syncState.connectionError.message
            : null,
      }),
    [
      syncState.realEstateDisclosures,
      syncState.companiesMeta,
      syncState.companiesConfirmed,
      syncState.companiesError,
      syncState.quarterlyRecords,
      syncState.quarterlyConfirmed,
      syncState.fromCache,
      syncState.connectionError,
    ]
  );

  const realEstateDisclosuresState: RealEstateDisclosuresReadState & {
    linkage: RealEstateDisclosuresLinkageSnapshot;
  } = useMemo(
    () => ({
      records: syncState.realEstateDisclosures,
      status: syncState.realEstateDisclosuresStatus,
      confirmed: syncState.realEstateDisclosuresConfirmed,
      fromCache: syncState.realEstateDisclosuresFromCache,
      hasPendingWrites: syncState.realEstateDisclosuresHasPendingWrites,
      authorized: syncState.realEstateDisclosuresAuthorized,
      error: syncState.realEstateDisclosuresError,
      errorCode: syncState.realEstateDisclosuresErrorCode,
      lastSyncedAt: syncState.realEstateDisclosuresLastSyncedAt,
      linkage: realEstateDisclosuresLinkage,
    }),
    [
      syncState.realEstateDisclosures,
      syncState.realEstateDisclosuresStatus,
      syncState.realEstateDisclosuresConfirmed,
      syncState.realEstateDisclosuresFromCache,
      syncState.realEstateDisclosuresHasPendingWrites,
      syncState.realEstateDisclosuresAuthorized,
      syncState.realEstateDisclosuresError,
      syncState.realEstateDisclosuresErrorCode,
      syncState.realEstateDisclosuresLastSyncedAt,
      realEstateDisclosuresLinkage,
    ]
  );

  return {
    syncState,
    syncStats,
    realEstateDisclosuresState,
    saving,
    saveError,
    setSaveError,
    triggerRetry: () => setRetryCounter((c) => c + 1),
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
  };
}
