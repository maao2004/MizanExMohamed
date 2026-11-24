/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Central editing, draft protection, conflict reconciliation, and single-flight submission
 * controller for global `macro_params`.
 *
 * Strictly distinguishes per parameter key:
 * - `serverRecord` (latest server-confirmed record)
 * - `baseRecord` (snapshot captured when local editing started; drives optimistic precondition)
 * - `draft` (`draftValue`, `draftRfMethodology`, `draftCustomType`, `draftUnit`)
 * - `status` (`clean` | `dirty` | `saving` | `conflict` | `deleted_on_server` | `error`)
 *
 * Guarantees:
 * - Never auto-saves while typing.
 * - Never overwrites a locally dirty draft when unrelated server updates arrive.
 * - Flags explicit `conflict` when the SAME edited parameter changes on the server, preserving
 *   both the local draft and the newer server version for explicit user resolution.
 * - Flags explicit `deleted_on_server` when an edited parameter is deleted on the server,
 *   blocking silent recreation on save.
 * - Preserves new edits typed by the user while an earlier save request is in-flight.
 * - Clears all drafts cleanly on logout or user identity change (`userScopeKey`).
 */

import {
  buildParameterUpdatePrecondition,
  CanonicalRfMethodology,
  computeExistingParameterHash,
  extractParameterRevision,
  getParameterDefinition,
  normalizeRfMethodology,
  ParameterConcurrencyConflictItem,
  ParameterWritePrecondition,
  reconcileIncomingMacroParameterVersion,
} from '../contracts';
import type { MacroParameter } from '../../types';
import {
  getMacroParameterInputSpec,
  parseAndValidateMacroParameterDraft,
  storedValueToEditString,
} from './macroParameterInput';

const RF_METHODOLOGY_KEYS = new Set(['Rf_Egypt_10Y', 'Rf_USD_10Y']);

export type CustomParameterTypeChoice = 'unspecified' | 'number' | 'pct';

export type MacroParamEntryStatus =
  | 'clean'
  | 'dirty'
  | 'saving'
  | 'conflict'
  | 'deleted_on_server'
  | 'error';

export interface MacroParamDraftSnapshot {
  draftValue: string;
  draftRfMethodology?: CanonicalRfMethodology;
  draftCustomType: CustomParameterTypeChoice;
  draftUnit: string;
}

export interface MacroParamDraftEntry {
  key: string;
  serverRecord: MacroParameter | null;
  baseRecord: MacroParameter | null;
  draftValue: string;
  draftRfMethodology?: CanonicalRfMethodology;
  draftCustomType: CustomParameterTypeChoice;
  draftUnit: string;
  dirty: boolean;
  status: MacroParamEntryStatus;
  conflictServerRecord: MacroParameter | null;
  errorAr: string | null;
}

export interface MacroParamInFlightSubmission {
  requestId: string;
  userScopeKey: string;
  mode: 'update' | 'create';
  keys: string[];
  snapshots: Record<string, MacroParamDraftSnapshot>;
}

export interface SaveCompletionContext {
  requestId?: string;
  userScopeKey?: string;
  mode?: 'update' | 'create';
}

export interface MacroParamDraftControllerState {
  userScopeKey: string;
  nextRequestSeq: number;
  keyOrder: string[];
  entries: Record<string, MacroParamDraftEntry>;
  isSaving: boolean;
  inFlightSubmission: MacroParamInFlightSubmission | null;
  bannerErrorAr: string | null;
  lastSaveSuccessAt: string | null;
}

export interface MacroParamDraftSummary {
  dirtyKeys: string[];
  conflictKeys: string[];
  deletedKeys: string[];
  errorKeys: string[];
  hasUnsavedChanges: boolean;
  hasBlockingIssues: boolean;
}

export type PrepareDirtySaveResult =
  | {
      ok: true;
      requestId: string;
      userScopeKey: string;
      nextState: MacroParamDraftControllerState;
      paramsToSave: MacroParameter[];
      preconditionsByKey: Record<string, ParameterWritePrecondition>;
      submittedSnapshots: Record<string, MacroParamDraftSnapshot>;
    }
  | {
      ok: false;
      reason:
        | 'already_saving'
        | 'no_changes'
        | 'unresolved_conflict'
        | 'deleted_on_server'
        | 'validation_error';
      nextState: MacroParamDraftControllerState;
      fieldErrors: Record<string, string>;
      summaryErrorAr: string;
    };

export type PrepareCreateParamResult =
  | {
      ok: true;
      requestId: string;
      userScopeKey: string;
      precondition: ParameterWritePrecondition;
      nextState: MacroParamDraftControllerState;
    }
  | {
      ok: false;
      reason: 'already_saving' | 'already_exists';
      nextState: MacroParamDraftControllerState;
      errorAr: string;
    };

export type MacroParamSaveOutcomeStatus =
  | 'saved_clean'
  | 'saved_with_newer_draft'
  | 'saved_with_conflict'
  | 'ignored_stale'
  | 'failed'
  | 'blocked'
  | 'no_changes';

export interface MacroParamSaveOutcome {
  status: MacroParamSaveOutcomeStatus;
  /** True when the remote save call succeeded on the server. */
  serverWriteSucceeded: boolean;
  /** True when the outcome belongs to and was applied in the active session & request. */
  appliedToCurrentSession: boolean;
  /** True when local unsaved changes still exist after the transition completes. */
  hasRemainingUnsavedChanges: boolean;
  /** True when unresolved conflicts, deleted-on-server entries, or validation errors remain. */
  hasBlockingIssues: boolean;
  /** Deterministic permission to navigate away / switch tab / sign out safely. */
  safeToLeave: boolean;
  /** True when UI should display a single confirmation notice for this save. */
  shouldShowSuccessNotice: boolean;
  /** Human-readable Arabic confirmation notice (null when ignored, failed, or conflicted). */
  noticeAr: string | null;
  /** Human-readable Arabic error (null when clean or ignored_stale). */
  errorAr: string | null;
  /** Number of server-confirmed parameters applied in this request. */
  savedCount: number;
  /** Machine reason when blocked pre-flight. */
  blockedReason?:
    | 'already_saving'
    | 'no_changes'
    | 'unresolved_conflict'
    | 'deleted_on_server'
    | 'validation_error'
    | 'already_exists';
}

export interface MacroParamSaveTransitionResult {
  nextState: MacroParamDraftControllerState;
  outcome: MacroParamSaveOutcome;
}

export interface MacroParamDraftStore {
  getState: () => MacroParamDraftControllerState;
  subscribe: (listener: () => void) => () => void;
  reconcileServer: (
    serverParams: readonly MacroParameter[],
    userScopeKey: string
  ) => MacroParamDraftControllerState;
  editValue: (key: string, nextValueStr: string) => MacroParamDraftControllerState;
  editRfMethodology: (
    key: string,
    methodology: CanonicalRfMethodology
  ) => MacroParamDraftControllerState;
  editCustomType: (
    key: string,
    nextChoice: CustomParameterTypeChoice
  ) => MacroParamDraftControllerState;
  discardSingle: (key: string) => MacroParamDraftControllerState;
  discardAll: () => MacroParamDraftControllerState;
  discardDeleted: (key: string) => MacroParamDraftControllerState;
  resolveConflictAcceptServer: (key: string) => MacroParamDraftControllerState;
  resolveConflictKeepDraft: (key: string) => MacroParamDraftControllerState;
  prepareDirtySave: (
    customRequestId?: string
  ) =>
    | (Extract<PrepareDirtySaveResult, { ok: true }> & { outcome?: undefined })
    | (Extract<PrepareDirtySaveResult, { ok: false }> & { outcome: MacroParamSaveOutcome });
  prepareCreateParam: (
    param: MacroParameter,
    customRequestId?: string
  ) => PrepareCreateParamResult;
  completeSaveSuccess: (
    savedServerParams: readonly MacroParameter[],
    submittedSnapshots?: Record<string, MacroParamDraftSnapshot>,
    nowIso?: string,
    context?: SaveCompletionContext
  ) => MacroParamSaveOutcome;
  completeSaveFailure: (
    errorMessage: string,
    conflicts?: readonly ParameterConcurrencyConflictItem[],
    context?: SaveCompletionContext
  ) => MacroParamSaveOutcome;
}

function normalizeServerMacroParam(param: MacroParameter): MacroParameter {
  return {
    ...param,
    ...(RF_METHODOLOGY_KEYS.has(param.key)
      ? { rfMethodology: normalizeRfMethodology(param.rfMethodology) }
      : {}),
  };
}

export function getCustomTypeChoiceForParam(param: MacroParameter): CustomParameterTypeChoice {
  const spec = getMacroParameterInputSpec(param.key, param);
  if (spec.isCataloged) {
    return spec.isPercentDecimal ? 'pct' : 'number';
  }
  if (spec.typeSource === 'unspecified') return 'unspecified';
  return spec.isPercentDecimal ? 'pct' : 'number';
}

export function buildEffectiveParamFromEntry(entry: MacroParamDraftEntry): MacroParameter | null {
  const ref = entry.serverRecord ?? entry.baseRecord;
  if (!ref) return null;
  const def = getParameterDefinition(entry.key);
  if (def) {
    return {
      ...ref,
      ...(RF_METHODOLOGY_KEYS.has(entry.key)
        ? { rfMethodology: normalizeRfMethodology(entry.draftRfMethodology ?? ref.rfMethodology) }
        : {}),
    };
  }
  if (entry.draftCustomType === 'unspecified') {
    return {
      ...ref,
      valueType: null,
      isPercentage: null,
      parameterTypeSource: 'unspecified',
      unit: entry.draftUnit || ref.unit || 'number',
      enabledInEngine: false,
    };
  }
  if (entry.draftCustomType === 'pct') {
    return {
      ...ref,
      valueType: 'pct',
      isPercentage: true,
      parameterTypeSource: 'explicit',
      unit: 'decimal',
      enabledInEngine: false,
    };
  }
  return {
    ...ref,
    valueType: 'number',
    isPercentage: false,
    parameterTypeSource: 'explicit',
    unit: entry.draftUnit === 'decimal' ? 'number' : entry.draftUnit || ref.unit || 'number',
    enabledInEngine: false,
  };
}

function captureDraftSnapshot(entry: MacroParamDraftEntry): MacroParamDraftSnapshot {
  return {
    draftValue: entry.draftValue,
    ...(RF_METHODOLOGY_KEYS.has(entry.key) ? { draftRfMethodology: entry.draftRfMethodology } : {}),
    draftCustomType: entry.draftCustomType,
    draftUnit: entry.draftUnit,
  };
}

function snapshotsEqual(a: MacroParamDraftSnapshot, b: MacroParamDraftSnapshot): boolean {
  return (
    a.draftValue === b.draftValue &&
    a.draftRfMethodology === b.draftRfMethodology &&
    a.draftCustomType === b.draftCustomType &&
    a.draftUnit === b.draftUnit
  );
}

function createCleanEntry(rawParam: MacroParameter): MacroParamDraftEntry {
  const param = normalizeServerMacroParam(rawParam);
  const spec = getMacroParameterInputSpec(param.key, param);
  return {
    key: param.key,
    serverRecord: param,
    baseRecord: param,
    draftValue: storedValueToEditString(param.key, param.value, param),
    ...(RF_METHODOLOGY_KEYS.has(param.key)
      ? { draftRfMethodology: normalizeRfMethodology(param.rfMethodology) }
      : {}),
    draftCustomType: getCustomTypeChoiceForParam(param),
    draftUnit: param.unit || spec.storageUnit,
    dirty: false,
    status: 'clean',
    conflictServerRecord: null,
    errorAr: null,
  };
}

function isDraftDifferentFromBase(entry: MacroParamDraftEntry, base: MacroParameter): boolean {
  const baseValueStr = storedValueToEditString(base.key, base.value, base);
  if (entry.draftValue !== baseValueStr) return true;

  if (RF_METHODOLOGY_KEYS.has(entry.key)) {
    const baseRf = normalizeRfMethodology(base.rfMethodology);
    const draftRf = normalizeRfMethodology(entry.draftRfMethodology);
    if (baseRf !== draftRf) return true;
  }

  if (!getParameterDefinition(entry.key)) {
    const baseCustomType = getCustomTypeChoiceForParam(base);
    if (entry.draftCustomType !== baseCustomType) return true;
  }

  return false;
}

export function haveSameServerMacroVersion(a: MacroParameter, b: MacroParameter): boolean {
  if (extractParameterRevision(a) !== extractParameterRevision(b)) return false;
  if (computeExistingParameterHash(a) !== computeExistingParameterHash(b)) return false;
  if (!Object.is(a.value, b.value)) return false;
  if ((a.valueType ?? null) !== (b.valueType ?? null)) return false;
  if ((a.isPercentage ?? null) !== (b.isPercentage ?? null)) return false;
  if ((a.unit ?? '') !== (b.unit ?? '')) return false;
  if (RF_METHODOLOGY_KEYS.has(a.key)) {
    if (normalizeRfMethodology(a.rfMethodology) !== normalizeRfMethodology(b.rfMethodology)) {
      return false;
    }
  }
  return true;
}

export function createMacroParamDraftControllerState(
  serverParams: readonly MacroParameter[],
  userScopeKey: string
): MacroParamDraftControllerState {
  const entries: Record<string, MacroParamDraftEntry> = {};
  const keyOrder: string[] = [];

  for (const raw of serverParams) {
    if (!raw?.key) continue;
    if (!Object.prototype.hasOwnProperty.call(entries, raw.key)) {
      keyOrder.push(raw.key);
    }
    entries[raw.key] = createCleanEntry(raw);
  }

  return {
    userScopeKey,
    nextRequestSeq: 1,
    keyOrder,
    entries,
    isSaving: false,
    inFlightSubmission: null,
    bannerErrorAr: null,
    lastSaveSuccessAt: null,
  };
}

/**
 * Reconciles incoming server `macroParams` updates with local drafts:
 * - Resets completely if `userScopeKey` changed (logout or user switch).
 * - Updates untouched/clean rows immediately.
 * - Preserves locally dirty drafts untouched when unrelated rows change on the server.
 * - Flags `conflict` when the SAME dirty row changed on the server, retaining BOTH versions.
 * - Flags `deleted_on_server` when a dirty row is deleted on the server, never auto-recreating it.
 */
export function reconcileServerMacroParams(
  state: MacroParamDraftControllerState,
  incomingServerParams: readonly MacroParameter[],
  nextUserScopeKey: string = state.userScopeKey
): MacroParamDraftControllerState {
  if (nextUserScopeKey !== state.userScopeKey) {
    return createMacroParamDraftControllerState(incomingServerParams, nextUserScopeKey);
  }

  const incomingByKey = new Map<string, MacroParameter>();
  const incomingOrder: string[] = [];
  for (const raw of incomingServerParams) {
    if (!raw?.key) continue;
    const norm = normalizeServerMacroParam(raw);
    if (!incomingByKey.has(norm.key)) {
      incomingOrder.push(norm.key);
    }
    incomingByKey.set(norm.key, norm);
  }

  const inFlightKeys = new Set(state.inFlightSubmission?.keys ?? []);
  const nextEntries: Record<string, MacroParamDraftEntry> = {};
  const nextKeyOrder: string[] = [];
  const seenKeys = new Set<string>();

  // Preserve existing order first, then append newly arrived server keys
  for (const key of state.keyOrder) {
    const existingEntry = state.entries[key];
    if (!existingEntry) continue;
    const incoming = incomingByKey.get(key);

    // Clean entry: directly adopt monotonic server update or drop if deleted on server
    if (
      !existingEntry.dirty &&
      existingEntry.status === 'clean' &&
      !inFlightKeys.has(key)
    ) {
      if (incoming) {
        const reconciled = reconcileIncomingMacroParameterVersion(
          existingEntry.serverRecord,
          incoming,
          { source: 'server_snapshot' }
        );
        const adopted =
          reconciled.decision === 'ignore_stale' || reconciled.decision === 'ignore_unverified'
            ? existingEntry.serverRecord ?? incoming
            : reconciled.record ?? incoming;
        nextEntries[key] = createCleanEntry(adopted);
        nextKeyOrder.push(key);
        seenKeys.add(key);
      }
      continue;
    }

    // Entry currently in-flight: track server deletions immediately and advance serverRecord monotonically
    // without prematurely wiping draft or rolling back to an older revision.
    if (state.isSaving && inFlightKeys.has(key)) {
      if (!incoming) {
        if (state.inFlightSubmission?.mode === 'create') {
          nextEntries[key] = existingEntry;
        } else {
          nextEntries[key] = {
            ...existingEntry,
            serverRecord: null,
            conflictServerRecord: null,
            dirty: true,
            status: 'deleted_on_server',
            errorAr:
              'تم حذف هذا المعامل على الخادم أثناء انتظار الحفظ؛ لا يُعاد إنشاؤه تلقائياً. تجاهل المسودة أو أعد إنشاءه صراحةً عبر زر الإضافة.',
          };
        }
        nextKeyOrder.push(key);
        seenKeys.add(key);
        continue;
      }

      const reconciled = reconcileIncomingMacroParameterVersion(
        existingEntry.serverRecord,
        incoming,
        { source: 'server_snapshot' }
      );
      const nextServer =
        reconciled.decision === 'ignore_stale' || reconciled.decision === 'ignore_unverified'
          ? existingEntry.serverRecord
          : reconciled.record ?? incoming;
      nextEntries[key] = {
        ...existingEntry,
        serverRecord: nextServer,
      };
      nextKeyOrder.push(key);
      seenKeys.add(key);
      continue;
    }

    // Locally dirty / conflicted / deleted_on_server / error entry
    if (!incoming) {
      nextEntries[key] = {
        ...existingEntry,
        serverRecord: null,
        conflictServerRecord: null,
        dirty: true,
        status: 'deleted_on_server',
        errorAr:
          'تم حذف هذا المعامل على الخادم أثناء التحرير؛ لا يُعاد إنشاؤه تلقائياً. تجاهل المسودة أو أعد إنشاءه صراحةً عبر زر الإضافة.',
      };
      nextKeyOrder.push(key);
      seenKeys.add(key);
      continue;
    }

    // Never downgrade serverRecord to an older snapshot revision
    if (existingEntry.serverRecord) {
      const reconciled = reconcileIncomingMacroParameterVersion(
        existingEntry.serverRecord,
        incoming,
        { source: 'server_snapshot' }
      );
      if (reconciled.decision === 'ignore_stale' || reconciled.decision === 'ignore_unverified') {
        nextEntries[key] = existingEntry;
        nextKeyOrder.push(key);
        seenKeys.add(key);
        continue;
      }
    }

    const reference = existingEntry.baseRecord ?? existingEntry.serverRecord;
    if (reference && !haveSameServerMacroVersion(reference, incoming)) {
      nextEntries[key] = {
        ...existingEntry,
        serverRecord: incoming,
        conflictServerRecord: incoming,
        dirty: true,
        status: 'conflict',
        errorAr:
          'تم تعديل هذا المعامل على الخادم بعد بدء تحريرك له؛ اختر اعتماد نسخة الخادم أو الإبقاء على مسودتك فوق النسخة الأحدث.',
      };
      nextKeyOrder.push(key);
      seenKeys.add(key);
      continue;
    }

    // Server version of this dirty parameter did NOT change (only other parameters changed)
    nextEntries[key] = {
      ...existingEntry,
      serverRecord: incoming,
    };
    nextKeyOrder.push(key);
    seenKeys.add(key);
  }

  for (const key of incomingOrder) {
    if (seenKeys.has(key)) continue;
    const incoming = incomingByKey.get(key)!;
    nextEntries[key] = createCleanEntry(incoming);
    nextKeyOrder.push(key);
    seenKeys.add(key);
  }

  return {
    ...state,
    keyOrder: nextKeyOrder,
    entries: nextEntries,
  };
}

export function editMacroParamDraftValue(
  state: MacroParamDraftControllerState,
  key: string,
  nextValueStr: string
): MacroParamDraftControllerState {
  const entry = state.entries[key];
  if (!entry) return state;

  const baseRecord = entry.baseRecord ?? entry.serverRecord;
  const draftEntryCandidate: MacroParamDraftEntry = {
    ...entry,
    baseRecord,
    draftValue: nextValueStr,
  };

  const effectiveParam = buildEffectiveParamFromEntry(draftEntryCandidate);
  const check = parseAndValidateMacroParameterDraft(key, nextValueStr, {
    fallbackParam: effectiveParam ?? undefined,
    scope: 'global',
  });

  const isInFlightForThisKey = Boolean(
    state.isSaving && state.inFlightSubmission?.keys.includes(key)
  );

  let nextDirty: boolean;
  let nextStatus: MacroParamEntryStatus;
  if (entry.status === 'conflict' || entry.status === 'deleted_on_server') {
    nextDirty = true;
    nextStatus = entry.status;
  } else if (isInFlightForThisKey) {
    // User typed a new edit while a previous save for this key is still in-flight
    nextDirty = true;
    nextStatus = 'saving';
  } else {
    nextDirty = baseRecord ? isDraftDifferentFromBase(draftEntryCandidate, baseRecord) : true;
    nextStatus = !check.ok ? 'error' : nextDirty ? 'dirty' : 'clean';
  }

  return {
    ...state,
    bannerErrorAr: null,
    entries: {
      ...state.entries,
      [key]: {
        ...draftEntryCandidate,
        dirty: nextDirty,
        status: nextStatus,
        errorAr:
          entry.status === 'conflict' || entry.status === 'deleted_on_server'
            ? entry.errorAr
            : check.ok
            ? null
            : check.errorAr,
      },
    },
  };
}

export function editMacroParamRfMethodology(
  state: MacroParamDraftControllerState,
  key: string,
  methodology: CanonicalRfMethodology
): MacroParamDraftControllerState {
  const entry = state.entries[key];
  if (!entry || !RF_METHODOLOGY_KEYS.has(key)) return state;

  const baseRecord = entry.baseRecord ?? entry.serverRecord;
  const candidate: MacroParamDraftEntry = {
    ...entry,
    baseRecord,
    draftRfMethodology: methodology,
  };
  const isInFlightForThisKey = Boolean(
    state.isSaving && state.inFlightSubmission?.keys.includes(key)
  );

  let nextDirty: boolean;
  let nextStatus: MacroParamEntryStatus;
  if (entry.status === 'conflict' || entry.status === 'deleted_on_server') {
    nextDirty = true;
    nextStatus = entry.status;
  } else if (isInFlightForThisKey) {
    nextDirty = true;
    nextStatus = 'saving';
  } else {
    nextDirty = baseRecord ? isDraftDifferentFromBase(candidate, baseRecord) : true;
    nextStatus = nextDirty ? 'dirty' : 'clean';
  }

  return {
    ...state,
    bannerErrorAr: null,
    entries: {
      ...state.entries,
      [key]: {
        ...candidate,
        dirty: nextDirty,
        status: nextStatus,
      },
    },
  };
}

export function editMacroParamCustomType(
  state: MacroParamDraftControllerState,
  key: string,
  nextChoice: CustomParameterTypeChoice
): MacroParamDraftControllerState {
  if (getParameterDefinition(key)) return state; // Registry is authoritative for cataloged params.
  const entry = state.entries[key];
  if (!entry) return state;

  const baseRecord = entry.baseRecord ?? entry.serverRecord;
  const currentEffective = buildEffectiveParamFromEntry(entry);
  const parsedPrev = parseAndValidateMacroParameterDraft(key, entry.draftValue, {
    fallbackParam: currentEffective ?? undefined,
    scope: 'global',
  });
  const underlyingStoredValue = parsedPrev.ok
    ? parsedPrev.storedValue
    : (currentEffective?.value ?? 0);

  const nextUnit =
    nextChoice === 'pct'
      ? 'decimal'
      : nextChoice === 'number'
      ? entry.draftUnit === 'decimal'
        ? 'number'
        : entry.draftUnit || 'number'
      : entry.draftUnit || 'number';

  const tempEntry: MacroParamDraftEntry = {
    ...entry,
    baseRecord,
    draftCustomType: nextChoice,
    draftUnit: nextUnit,
  };
  const nextEffective = buildEffectiveParamFromEntry(tempEntry);
  const reformattedDraftValue = storedValueToEditString(
    key,
    underlyingStoredValue,
    nextEffective ?? undefined
  );

  const candidate: MacroParamDraftEntry = {
    ...tempEntry,
    draftValue: reformattedDraftValue,
  };

  const isInFlightForThisKey = Boolean(
    state.isSaving && state.inFlightSubmission?.keys.includes(key)
  );

  let nextDirty: boolean;
  let nextStatus: MacroParamEntryStatus;
  if (entry.status === 'conflict' || entry.status === 'deleted_on_server') {
    nextDirty = true;
    nextStatus = entry.status;
  } else if (isInFlightForThisKey) {
    nextDirty = true;
    nextStatus = 'saving';
  } else {
    nextDirty = baseRecord ? isDraftDifferentFromBase(candidate, baseRecord) : true;
    nextStatus = nextDirty ? 'dirty' : 'clean';
  }

  return {
    ...state,
    bannerErrorAr: null,
    entries: {
      ...state.entries,
      [key]: {
        ...candidate,
        dirty: nextDirty,
        status: nextStatus,
        errorAr:
          entry.status === 'conflict' || entry.status === 'deleted_on_server' ? entry.errorAr : null,
      },
    },
  };
}

/**
 * Explicit conflict resolution #1: Discard local draft and adopt the newer server version.
 */
export function resolveConflictAcceptServer(
  state: MacroParamDraftControllerState,
  key: string
): MacroParamDraftControllerState {
  const entry = state.entries[key];
  if (!entry) return state;
  const serverVersion = entry.conflictServerRecord ?? entry.serverRecord;
  if (!serverVersion) {
    return discardDeletedDraft(state, key);
  }
  return {
    ...state,
    bannerErrorAr: null,
    entries: {
      ...state.entries,
      [key]: createCleanEntry(serverVersion),
    },
  };
}

/**
 * Explicit conflict resolution #2: Rebase local draft onto the latest confirmed server version
 * so the user can intentionally re-save their draft against the new server revision.
 */
export function resolveConflictKeepDraftOnLatestBase(
  state: MacroParamDraftControllerState,
  key: string
): MacroParamDraftControllerState {
  const entry = state.entries[key];
  if (!entry) return state;
  const latestServer = entry.conflictServerRecord ?? entry.serverRecord;
  if (!latestServer) return state;

  const rebasedCandidate: MacroParamDraftEntry = {
    ...entry,
    serverRecord: latestServer,
    baseRecord: latestServer,
    conflictServerRecord: null,
    errorAr: null,
  };
  const effectiveParam = buildEffectiveParamFromEntry(rebasedCandidate);
  const check = parseAndValidateMacroParameterDraft(key, rebasedCandidate.draftValue, {
    fallbackParam: effectiveParam ?? undefined,
    scope: 'global',
  });
  const dirty = isDraftDifferentFromBase(rebasedCandidate, latestServer);

  return {
    ...state,
    bannerErrorAr: null,
    entries: {
      ...state.entries,
      [key]: {
        ...rebasedCandidate,
        dirty,
        status: !check.ok ? 'error' : dirty ? 'dirty' : 'clean',
        errorAr: check.ok ? null : check.errorAr,
      },
    },
  };
}

/**
 * Discards a draft whose underlying parameter was deleted on the server.
 */
export function discardDeletedDraft(
  state: MacroParamDraftControllerState,
  key: string
): MacroParamDraftControllerState {
  if (!state.entries[key]) return state;
  const nextEntries = { ...state.entries };
  delete nextEntries[key];
  return {
    ...state,
    bannerErrorAr: null,
    keyOrder: state.keyOrder.filter((k) => k !== key),
    entries: nextEntries,
  };
}

/**
 * Discards a single dirty draft and restores its latest confirmed server record.
 */
export function discardSingleDraft(
  state: MacroParamDraftControllerState,
  key: string
): MacroParamDraftControllerState {
  const entry = state.entries[key];
  if (!entry) return state;
  if (!entry.serverRecord) {
    return discardDeletedDraft(state, key);
  }
  return {
    ...state,
    bannerErrorAr: null,
    entries: {
      ...state.entries,
      [key]: createCleanEntry(entry.serverRecord),
    },
  };
}

/**
 * Discards all unsaved drafts and restores every row to its latest server-confirmed state.
 */
export function discardAllMacroParamDrafts(
  state: MacroParamDraftControllerState
): MacroParamDraftControllerState {
  const nextEntries: Record<string, MacroParamDraftEntry> = {};
  const nextKeyOrder: string[] = [];

  for (const key of state.keyOrder) {
    const entry = state.entries[key];
    if (!entry || !entry.serverRecord) continue;
    nextEntries[key] = createCleanEntry(entry.serverRecord);
    nextKeyOrder.push(key);
  }

  return {
    ...state,
    keyOrder: nextKeyOrder,
    entries: nextEntries,
    bannerErrorAr: null,
  };
}

export function getMacroParamDraftSummary(
  state: MacroParamDraftControllerState
): MacroParamDraftSummary {
  const dirtyKeys: string[] = [];
  const conflictKeys: string[] = [];
  const deletedKeys: string[] = [];
  const errorKeys: string[] = [];

  for (const key of state.keyOrder) {
    const entry = state.entries[key];
    if (!entry) continue;
    if (entry.status === 'conflict') conflictKeys.push(key);
    else if (entry.status === 'deleted_on_server') deletedKeys.push(key);
    else if (entry.status === 'error') errorKeys.push(key);
    if (entry.dirty) dirtyKeys.push(key);
  }

  return {
    dirtyKeys,
    conflictKeys,
    deletedKeys,
    errorKeys,
    hasUnsavedChanges:
      dirtyKeys.length > 0 || conflictKeys.length > 0 || deletedKeys.length > 0,
    hasBlockingIssues: conflictKeys.length > 0 || deletedKeys.length > 0,
  };
}

/**
 * Prepares an intentional save submission containing ONLY locally dirty parameters
 * along with each parameter's `baseRecord` optimistic concurrency precondition,
 * bound to a fixed `(userScopeKey, requestId)` pair.
 */
export function prepareDirtySaveSubmission(
  state: MacroParamDraftControllerState,
  customRequestId?: string
): PrepareDirtySaveResult {
  if (state.isSaving) {
    return {
      ok: false,
      reason: 'already_saving',
      nextState: state,
      fieldErrors: {},
      summaryErrorAr: 'عملية حفظ جارية بالفعل؛ انتظر اكتمال الطلب الحالي.',
    };
  }

  const summary = getMacroParamDraftSummary(state);

  if (summary.deletedKeys.length > 0) {
    const summaryErrorAr = `لا يمكن الحفظ قبل معالجة المعاملات المحذوفة على الخادم (${summary.deletedKeys.join('، ')})؛ تجاهل المسودة أو أعد إنشاءها صراحةً عبر زر الإضافة.`;
    return {
      ok: false,
      reason: 'deleted_on_server',
      nextState: { ...state, bannerErrorAr: summaryErrorAr },
      fieldErrors: {},
      summaryErrorAr,
    };
  }

  if (summary.conflictKeys.length > 0) {
    const summaryErrorAr = `توجد تعارضات تزامن غير محلولة للمعاملات (${summary.conflictKeys.join('، ')})؛ اختر اعتماد نسخة الخادم أو الإبقاء على مسودتك فوق النسخة الأحدث قبل الحفظ.`;
    return {
      ok: false,
      reason: 'unresolved_conflict',
      nextState: { ...state, bannerErrorAr: summaryErrorAr },
      fieldErrors: {},
      summaryErrorAr,
    };
  }

  const dirtyEntries = state.keyOrder
    .map((k) => state.entries[k])
    .filter((e): e is MacroParamDraftEntry => Boolean(e && e.dirty && e.serverRecord));

  if (dirtyEntries.length === 0) {
    return {
      ok: false,
      reason: 'no_changes',
      nextState: state,
      fieldErrors: {},
      summaryErrorAr: 'لا توجد تعديلات محلية غير محفوظة لحفظها.',
    };
  }

  const fieldErrors: Record<string, string> = {};
  const paramsToSave: MacroParameter[] = [];
  const preconditionsByKey: Record<string, ParameterWritePrecondition> = {};
  const submittedSnapshots: Record<string, MacroParamDraftSnapshot> = {};

  for (const entry of dirtyEntries) {
    const effectiveParam = buildEffectiveParamFromEntry(entry);
    if (!effectiveParam) continue;

    const validation = parseAndValidateMacroParameterDraft(entry.key, entry.draftValue, {
      fallbackParam: effectiveParam,
      scope: 'global',
    });

    if (!validation.ok) {
      fieldErrors[entry.key] = validation.errorAr;
      continue;
    }

    const spec = validation.spec;
    const baseForPrecondition = entry.baseRecord ?? entry.serverRecord!;
    preconditionsByKey[entry.key] = buildParameterUpdatePrecondition(baseForPrecondition);
    submittedSnapshots[entry.key] = captureDraftSnapshot(entry);

    paramsToSave.push({
      ...effectiveParam,
      value: validation.storedValue,
      valueType: spec.resolvedValueType,
      isPercentage: spec.resolvedIsPercentage,
      parameterTypeSource: spec.typeSource,
      unit: effectiveParam.unit || spec.storageUnit,
      enabledInEngine: spec.isCataloged
        ? (effectiveParam.enabledInEngine ?? spec.definition?.enabledInEngine ?? true)
        : false,
      ...(RF_METHODOLOGY_KEYS.has(entry.key)
        ? { rfMethodology: normalizeRfMethodology(entry.draftRfMethodology) }
        : {}),
    });
  }

  const errorKeys = Object.keys(fieldErrors);
  if (errorKeys.length > 0) {
    const summaryErrorAr =
      errorKeys.length === 1
        ? fieldErrors[errorKeys[0]]
        : `تعذر الحفظ لوجود ${errorKeys.length} حقول غير صالحة (${errorKeys.join('، ')}). راجع الأخطاء المحددة بجانب كل متغير قبل إعادة المحاولة.`;

    const nextEntries = { ...state.entries };
    for (const errKey of errorKeys) {
      const e = nextEntries[errKey];
      if (e) {
        nextEntries[errKey] = { ...e, status: 'error', errorAr: fieldErrors[errKey] };
      }
    }

    return {
      ok: false,
      reason: 'validation_error',
      nextState: {
        ...state,
        entries: nextEntries,
        bannerErrorAr: summaryErrorAr,
      },
      fieldErrors,
      summaryErrorAr,
    };
  }

  const nextEntries = { ...state.entries };
  const submittedKeys: string[] = [];
  for (const param of paramsToSave) {
    submittedKeys.push(param.key);
    const e = nextEntries[param.key];
    if (e) {
      nextEntries[param.key] = {
        ...e,
        status: 'saving',
        errorAr: null,
      };
    }
  }

  const seq = state.nextRequestSeq ?? 1;
  const requestId = customRequestId || `${state.userScopeKey}#save_${seq}`;

  return {
    ok: true,
    requestId,
    userScopeKey: state.userScopeKey,
    paramsToSave,
    preconditionsByKey,
    submittedSnapshots,
    nextState: {
      ...state,
      nextRequestSeq: seq + 1,
      isSaving: true,
      inFlightSubmission: {
        requestId,
        userScopeKey: state.userScopeKey,
        mode: 'update',
        keys: submittedKeys,
        snapshots: submittedSnapshots,
      },
      bannerErrorAr: null,
      entries: nextEntries,
    },
  };
}

/**
 * Prepares an explicit single-parameter creation submission (`mode: 'create'`)
 * bound to a fixed `(userScopeKey, requestId)` pair.
 */
export function prepareCreateParamSubmission(
  state: MacroParamDraftControllerState,
  param: MacroParameter,
  customRequestId?: string
): PrepareCreateParamResult {
  if (state.isSaving) {
    return {
      ok: false,
      reason: 'already_saving',
      nextState: state,
      errorAr: 'عملية حفظ أو إضافة جارية بالفعل؛ انتظر اكتمال الطلب الحالي.',
    };
  }

  const existingEntry = state.entries[param.key];
  if (existingEntry && existingEntry.serverRecord !== null) {
    return {
      ok: false,
      reason: 'already_exists',
      nextState: state,
      errorAr: `المتغير "${param.key}" موجود بالفعل على الخادم؛ عدّله مباشرةً في الجدول بدلاً من إعادة إنشائه.`,
    };
  }

  const seq = state.nextRequestSeq ?? 1;
  const requestId = customRequestId || `${state.userScopeKey}#create_${seq}`;

  return {
    ok: true,
    requestId,
    userScopeKey: state.userScopeKey,
    precondition: { mode: 'create' },
    nextState: {
      ...state,
      nextRequestSeq: seq + 1,
      isSaving: true,
      inFlightSubmission: {
        requestId,
        userScopeKey: state.userScopeKey,
        mode: 'create',
        keys: [param.key],
        snapshots: {},
      },
      bannerErrorAr: null,
    },
  };
}

/**
 * Reconciles confirmed server records after a save succeeds:
 * - Ignores late responses completely if `userScopeKey` changed or `requestId` no longer matches `inFlightSubmission`.
 * - Enforces monotonic version reconciliation via `reconcileIncomingMacroParameterVersion` so an older
 *   confirmation (e.g. rev=2) NEVER replaces a newer confirmed version (e.g. rev=3) or clears a newer conflict/deletion.
 * - Refuses to revive a parameter marked `deleted_on_server` on a stale `update` confirmation.
 * - Preserves ANY newer edit typed by the user while the previous request was in-flight.
 */
export function completeSaveSuccess(
  state: MacroParamDraftControllerState,
  savedServerParams: readonly MacroParameter[],
  submittedSnapshots?: Record<string, MacroParamDraftSnapshot>,
  nowIso: string = new Date().toISOString(),
  context?: SaveCompletionContext
): MacroParamDraftControllerState {
  // 1. Session isolation guard: NEVER apply a late response from another user/session!
  if (context?.userScopeKey !== undefined && context.userScopeKey !== state.userScopeKey) {
    return state;
  }

  // 2. Request ID guard: NEVER let a stale/superseded request mutate state or clear a newer request's saving lock!
  if (context?.requestId !== undefined) {
    if (!state.inFlightSubmission || state.inFlightSubmission.requestId !== context.requestId) {
      return state;
    }
  }

  const effectiveMode = context?.mode ?? state.inFlightSubmission?.mode ?? 'update';
  const effectiveSnapshots = submittedSnapshots ?? state.inFlightSubmission?.snapshots ?? {};
  const submittedKeys = new Set(state.inFlightSubmission?.keys ?? []);
  const nextEntries = { ...state.entries };
  const nextKeyOrder = [...state.keyOrder];
  const keySet = new Set(nextKeyOrder);
  const handledKeys = new Set<string>();
  let staleOrDeletedNoticeAr: string | null = null;

  for (const rawSaved of savedServerParams) {
    const saved = normalizeServerMacroParam(rawSaved);
    handledKeys.add(saved.key);
    const currentEntry = nextEntries[saved.key];

    if (!currentEntry) {
      // Do NOT revive a deleted/discarded parameter on a stale update confirmation.
      if (effectiveMode !== 'create' && context?.mode === 'update') {
        staleOrDeletedNoticeAr =
          staleOrDeletedNoticeAr ??
          `تم تجاهل تأكيد حفظ قديم للمعامل (${saved.key}) لأنه لم يعد موجوداً على الخادم.`;
        continue;
      }
      nextEntries[saved.key] = createCleanEntry(saved);
      if (!keySet.has(saved.key)) {
        nextKeyOrder.push(saved.key);
        keySet.add(saved.key);
      }
      continue;
    }

    // Never clear `deleted_on_server` or revive a deleted doc from a stale update confirmation!
    if (
      effectiveMode !== 'create' &&
      (currentEntry.status === 'deleted_on_server' || currentEntry.serverRecord === null)
    ) {
      nextEntries[saved.key] = {
        ...currentEntry,
        serverRecord: null,
        conflictServerRecord: null,
        dirty: true,
        status: 'deleted_on_server',
        errorAr:
          currentEntry.errorAr ||
          'تم حذف هذا المعامل على الخادم؛ تم تجاهل تأكيد الحفظ القديم وعدم إعادة إظهاره كمستند مؤكد حي.',
      };
      staleOrDeletedNoticeAr =
        staleOrDeletedNoticeAr ??
        `تم حذف المعامل (${saved.key}) على الخادم؛ لم يُعد إظهاره كمستند مؤكد من تأكيد الحفظ القديم.`;
      continue;
    }

    // Monotonic version reconciliation against latest confirmed serverRecord
    if (currentEntry.serverRecord) {
      const reconciled = reconcileIncomingMacroParameterVersion(
        currentEntry.serverRecord,
        saved,
        { source: 'save_confirmation' }
      );

      const isStaleOrUnverified =
        reconciled.decision === 'ignore_stale' ||
        reconciled.decision === 'ignore_unverified' ||
        (reconciled.decision === 'same_version' &&
          !haveSameServerMacroVersion(currentEntry.serverRecord, saved));

      if (isStaleOrUnverified) {
        const latestServer = currentEntry.serverRecord;
        const msgAr =
          reconciled.decision === 'ignore_stale'
            ? `وصل تأكيد حفظ قديم (إصدار ${reconciled.incomingRevision ?? '?'}) بعد استلام نسخة أحدث على الخادم (إصدار ${reconciled.currentRevision ?? '?'})؛ تم الإبقاء على النسخة الأحدث وحفظ مسودتك للمراجعة.`
            : `تم تجاهل تأكيد حفظ غير موثّق الإصدار لأن النسخة المؤكدة الحالية أحدث (إصدار ${reconciled.currentRevision ?? '?'})؛ تم الإبقاء على مسودتك للمراجعة.`;

        nextEntries[saved.key] = {
          ...currentEntry,
          serverRecord: latestServer,
          conflictServerRecord: latestServer,
          dirty: true,
          status: 'conflict',
          errorAr: msgAr,
        };
        staleOrDeletedNoticeAr = staleOrDeletedNoticeAr ?? msgAr;
        continue;
      }
    }

    const submittedSnap = effectiveSnapshots[saved.key];
    const currentSnap = captureDraftSnapshot(currentEntry);

    if (submittedSnap && !snapshotsEqual(currentSnap, submittedSnap)) {
      // User typed a NEW edit while the earlier save was in-flight!
      // Advance baseRecord & serverRecord to the newly committed version,
      // but KEEP the user's new draft intact as dirty.
      const updatedEntry: MacroParamDraftEntry = {
        ...currentEntry,
        serverRecord: saved,
        baseRecord: saved,
        conflictServerRecord: null,
      };
      const effectiveParam = buildEffectiveParamFromEntry(updatedEntry);
      const check = parseAndValidateMacroParameterDraft(saved.key, updatedEntry.draftValue, {
        fallbackParam: effectiveParam ?? undefined,
        scope: 'global',
      });
      const stillDirty = isDraftDifferentFromBase(updatedEntry, saved);
      nextEntries[saved.key] = {
        ...updatedEntry,
        dirty: stillDirty,
        status: !check.ok ? 'error' : stillDirty ? 'dirty' : 'clean',
        errorAr: check.ok ? null : check.errorAr,
      };
      continue;
    }

    // No newer edit during in-flight save and confirmed version is monotonically current -> adopt clean record
    nextEntries[saved.key] = createCleanEntry(saved);
  }

  // Restore status on any submitted keys not present in savedServerParams without erasing conflicts/deletions
  for (const key of submittedKeys) {
    if (handledKeys.has(key)) continue;
    const entry = nextEntries[key];
    if (entry && entry.status === 'saving') {
      nextEntries[key] = {
        ...entry,
        status: entry.dirty ? 'dirty' : 'clean',
      };
    }
  }

  return {
    ...state,
    keyOrder: nextKeyOrder,
    entries: nextEntries,
    isSaving: false,
    inFlightSubmission: null,
    bannerErrorAr: staleOrDeletedNoticeAr,
    lastSaveSuccessAt: staleOrDeletedNoticeAr ? state.lastSaveSuccessAt : nowIso,
  };
}

/**
 * Handles a failed save attempt:
 * - Ignores late failures completely if `userScopeKey` changed or `requestId` no longer matches `inFlightSubmission`.
 * - Releases the `isSaving` lock ONLY for the active matching request.
 * - Preserves ALL user drafts intact for retry.
 * - Transitions conflicted or deleted-on-server keys directly into explicit conflict/deleted states
 *   without ever downgrading `serverRecord` to an older revision.
 */
export function completeSaveFailure(
  state: MacroParamDraftControllerState,
  errorMessage: string,
  conflicts?: readonly ParameterConcurrencyConflictItem[],
  context?: SaveCompletionContext
): MacroParamDraftControllerState {
  // 1. Session isolation guard
  if (context?.userScopeKey !== undefined && context.userScopeKey !== state.userScopeKey) {
    return state;
  }

  // 2. Request ID guard
  if (context?.requestId !== undefined) {
    if (!state.inFlightSubmission || state.inFlightSubmission.requestId !== context.requestId) {
      return state;
    }
  }

  const conflictsByKey = new Map<string, ParameterConcurrencyConflictItem>();
  if (conflicts) {
    for (const c of conflicts) {
      conflictsByKey.set(c.key, c);
    }
  }

  const submittedKeys = new Set(state.inFlightSubmission?.keys ?? []);
  const nextEntries = { ...state.entries };

  for (const key of Object.keys(nextEntries)) {
    const entry = nextEntries[key];
    const conflict = conflictsByKey.get(key);
    if (conflict) {
      if (conflict.reason === 'DELETED_ON_SERVER') {
        nextEntries[key] = {
          ...entry,
          serverRecord: null,
          conflictServerRecord: null,
          dirty: true,
          status: 'deleted_on_server',
          errorAr: conflict.messageAr,
        };
      } else if (entry.status === 'deleted_on_server') {
        // Keep newer deletion marker intact
        nextEntries[key] = entry;
      } else {
        const refRecord = entry.serverRecord ?? entry.baseRecord;
        const synthesizedServerRecord: MacroParameter | null = refRecord
          ? {
              ...refRecord,
              ...(typeof conflict.serverValue === 'number' ? { value: conflict.serverValue } : {}),
              ...(typeof conflict.serverRevision === 'number'
                ? { revision: conflict.serverRevision }
                : {}),
              ...(conflict.serverContentHash ? { contentHash: conflict.serverContentHash } : {}),
              ...(conflict.serverUpdatedAt ? { updatedAt: conflict.serverUpdatedAt } : {}),
            }
          : null;

        let chosenServerRecord = entry.serverRecord;
        if (synthesizedServerRecord) {
          const reconciled = reconcileIncomingMacroParameterVersion(
            entry.serverRecord,
            synthesizedServerRecord,
            { source: 'server_snapshot' }
          );
          if (reconciled.decision !== 'ignore_stale' && reconciled.decision !== 'ignore_unverified') {
            chosenServerRecord = reconciled.record ?? synthesizedServerRecord;
          }
        }

        nextEntries[key] = {
          ...entry,
          serverRecord: chosenServerRecord ?? entry.serverRecord,
          conflictServerRecord: chosenServerRecord ?? entry.conflictServerRecord,
          dirty: true,
          status: 'conflict',
          errorAr: conflict.messageAr,
        };
      }
      continue;
    }

    if (submittedKeys.has(key) && entry.status === 'saving') {
      nextEntries[key] = {
        ...entry,
        status: entry.dirty ? 'dirty' : 'clean',
      };
    }
  }

  return {
    ...state,
    entries: nextEntries,
    isSaving: false,
    inFlightSubmission: null,
    bannerErrorAr: errorMessage,
  };
}

function isStaleCompletionContext(
  state: MacroParamDraftControllerState,
  context?: SaveCompletionContext
): boolean {
  if (context?.userScopeKey !== undefined && context.userScopeKey !== state.userScopeKey) {
    return true;
  }
  if (context?.requestId !== undefined) {
    if (!state.inFlightSubmission || state.inFlightSubmission.requestId !== context.requestId) {
      return true;
    }
  }
  return false;
}

/**
 * Pure deterministic evaluator for pre-flight blocked `prepareDirtySaveSubmission` results.
 */
export function evaluateBlockedDirtySaveOutcome(
  prep: Extract<PrepareDirtySaveResult, { ok: false }>
): MacroParamSaveOutcome {
  const summary = getMacroParamDraftSummary(prep.nextState);
  if (prep.reason === 'no_changes') {
    const safeToLeave =
      !summary.hasUnsavedChanges && !summary.hasBlockingIssues && !prep.nextState.isSaving;
    return {
      status: safeToLeave ? 'no_changes' : 'blocked',
      serverWriteSucceeded: false,
      appliedToCurrentSession: true,
      hasRemainingUnsavedChanges: summary.hasUnsavedChanges,
      hasBlockingIssues: summary.hasBlockingIssues,
      safeToLeave,
      shouldShowSuccessNotice: false,
      noticeAr: null,
      errorAr: safeToLeave ? null : prep.summaryErrorAr,
      savedCount: 0,
      blockedReason: 'no_changes',
    };
  }

  return {
    status: 'blocked',
    serverWriteSucceeded: false,
    appliedToCurrentSession: true,
    hasRemainingUnsavedChanges: summary.hasUnsavedChanges,
    hasBlockingIssues: summary.hasBlockingIssues,
    safeToLeave: false,
    shouldShowSuccessNotice: false,
    noticeAr: null,
    errorAr: prep.summaryErrorAr,
    savedCount: 0,
    blockedReason: prep.reason,
  };
}

/**
 * Pure deterministic state transition + structured outcome for a completed remote save.
 *
 * Explicitly separates:
 * - `serverWriteSucceeded` (remote write succeeded)
 * - `appliedToCurrentSession` (accepted in the active session/request vs `ignored_stale`)
 * - `hasRemainingUnsavedChanges` (e.g., newer edit typed while save was in-flight)
 * - `safeToLeave` (true ONLY when applied cleanly with zero remaining unsaved drafts or blocking issues)
 */
export function evaluateSaveSuccessTransition(
  state: MacroParamDraftControllerState,
  savedServerParams: readonly MacroParameter[],
  submittedSnapshots?: Record<string, MacroParamDraftSnapshot>,
  nowIso: string = new Date().toISOString(),
  context?: SaveCompletionContext
): MacroParamSaveTransitionResult {
  if (isStaleCompletionContext(state, context)) {
    return {
      nextState: state,
      outcome: {
        status: 'ignored_stale',
        serverWriteSucceeded: true,
        appliedToCurrentSession: false,
        hasRemainingUnsavedChanges: false,
        hasBlockingIssues: false,
        safeToLeave: false,
        shouldShowSuccessNotice: false,
        noticeAr: null,
        errorAr: null,
        savedCount: 0,
      },
    };
  }

  const effectiveMode = context?.mode ?? state.inFlightSubmission?.mode ?? 'update';
  const nextState = completeSaveSuccess(
    state,
    savedServerParams,
    submittedSnapshots,
    nowIso,
    context
  );
  const summary = getMacroParamDraftSummary(nextState);

  if (
    nextState.bannerErrorAr ||
    summary.conflictKeys.length > 0 ||
    summary.deletedKeys.length > 0
  ) {
    return {
      nextState,
      outcome: {
        status: 'saved_with_conflict',
        serverWriteSucceeded: true,
        appliedToCurrentSession: true,
        hasRemainingUnsavedChanges: summary.hasUnsavedChanges,
        hasBlockingIssues: true,
        safeToLeave: false,
        shouldShowSuccessNotice: false,
        noticeAr: null,
        errorAr:
          nextState.bannerErrorAr ||
          'تم اكتشاف تعارض تزامن أو حذف على الخادم أثناء الحفظ؛ راجع الفروق قبل المغادرة.',
        savedCount: savedServerParams.length,
      },
    };
  }

  if (summary.hasUnsavedChanges || summary.hasBlockingIssues) {
    const noticeAr =
      effectiveMode === 'create'
        ? `تم إنشاء المتغير ${savedServerParams[0]?.key ?? ''} وتأكيده في Firestore، وما زالت لديك تعديلات محلية أخرى غير محفوظة.`
        : `تم حفظ ${savedServerParams.length} تعديلاً في Firestore، وما زالت لديك تعديلات محلية أحدث لم تُحفظ بعد.`;
    return {
      nextState,
      outcome: {
        status: 'saved_with_newer_draft',
        serverWriteSucceeded: true,
        appliedToCurrentSession: true,
        hasRemainingUnsavedChanges: true,
        hasBlockingIssues: summary.hasBlockingIssues,
        safeToLeave: false,
        shouldShowSuccessNotice: true,
        noticeAr,
        errorAr: null,
        savedCount: savedServerParams.length,
      },
    };
  }

  const noticeAr =
    effectiveMode === 'create'
      ? `تم إنشاء المتغير ${savedServerParams[0]?.key ?? ''} وتأكيده في Firestore`
      : `تم تأكيد حفظ ${savedServerParams.length} تعديلاً في Firestore`;

  return {
    nextState,
    outcome: {
      status: 'saved_clean',
      serverWriteSucceeded: true,
      appliedToCurrentSession: true,
      hasRemainingUnsavedChanges: false,
      hasBlockingIssues: false,
      safeToLeave: true,
      shouldShowSuccessNotice: true,
      noticeAr,
      errorAr: null,
      savedCount: savedServerParams.length,
    },
  };
}

/**
 * Pure deterministic state transition + structured outcome for a failed remote save.
 * Never records a failure in the current session when an older session/request fails late.
 */
export function evaluateSaveFailureTransition(
  state: MacroParamDraftControllerState,
  errorMessage: string,
  conflicts?: readonly ParameterConcurrencyConflictItem[],
  context?: SaveCompletionContext
): MacroParamSaveTransitionResult {
  if (isStaleCompletionContext(state, context)) {
    return {
      nextState: state,
      outcome: {
        status: 'ignored_stale',
        serverWriteSucceeded: false,
        appliedToCurrentSession: false,
        hasRemainingUnsavedChanges: false,
        hasBlockingIssues: false,
        safeToLeave: false,
        shouldShowSuccessNotice: false,
        noticeAr: null,
        errorAr: null,
        savedCount: 0,
      },
    };
  }

  const nextState = completeSaveFailure(state, errorMessage, conflicts, context);
  const summary = getMacroParamDraftSummary(nextState);

  return {
    nextState,
    outcome: {
      status: 'failed',
      serverWriteSucceeded: false,
      appliedToCurrentSession: true,
      hasRemainingUnsavedChanges: summary.hasUnsavedChanges,
      hasBlockingIssues: summary.hasBlockingIssues,
      safeToLeave: false,
      shouldShowSuccessNotice: false,
      noticeAr: null,
      errorAr: errorMessage,
      savedCount: 0,
    },
  };
}

function areMacroRecordsEquivalent(
  a: MacroParameter | null,
  b: MacroParameter | null
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.key === b.key &&
    a.value === b.value &&
    a.revision === b.revision &&
    a.contentHash === b.contentHash &&
    a.updatedAt === b.updatedAt &&
    a.valueType === b.valueType &&
    a.isPercentage === b.isPercentage &&
    a.unit === b.unit &&
    a.rfMethodology === b.rfMethodology &&
    a.nameAr === b.nameAr &&
    a.descriptionAr === b.descriptionAr &&
    a.source === b.source &&
    a.asOfDate === b.asOfDate
  );
}

function areDraftStatesEquivalent(
  a: MacroParamDraftControllerState,
  b: MacroParamDraftControllerState
): boolean {
  if (a === b) return true;
  if (
    a.userScopeKey !== b.userScopeKey ||
    a.nextRequestSeq !== b.nextRequestSeq ||
    a.isSaving !== b.isSaving ||
    a.bannerErrorAr !== b.bannerErrorAr ||
    a.lastSaveSuccessAt !== b.lastSaveSuccessAt ||
    a.inFlightSubmission?.requestId !== b.inFlightSubmission?.requestId ||
    a.keyOrder.length !== b.keyOrder.length
  ) {
    return false;
  }
  for (let i = 0; i < a.keyOrder.length; i++) {
    const key = a.keyOrder[i];
    if (key !== b.keyOrder[i]) return false;
    const ea = a.entries[key];
    const eb = b.entries[key];
    if (!ea || !eb) return false;
    if (
      ea.dirty !== eb.dirty ||
      ea.status !== eb.status ||
      ea.draftValue !== eb.draftValue ||
      ea.draftRfMethodology !== eb.draftRfMethodology ||
      ea.draftCustomType !== eb.draftCustomType ||
      ea.draftUnit !== eb.draftUnit ||
      ea.errorAr !== eb.errorAr ||
      !areMacroRecordsEquivalent(ea.serverRecord, eb.serverRecord) ||
      !areMacroRecordsEquivalent(ea.baseRecord, eb.baseRecord) ||
      !areMacroRecordsEquivalent(ea.conflictServerRecord, eb.conflictServerRecord)
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Single-source-of-truth store wrapping the pure `macroParameterDraftController` transitions.
 *
 * Designed for React's `useSyncExternalStore`:
 * - Eliminates dual `useState` + `ref` lag and eliminates all side effects inside React updaters.
 * - Every transition commits synchronously and returns deterministic outcomes directly to callers.
 * - Safe and idempotent under `<React.StrictMode>` double renders and double effect mounts.
 */
export function createMacroParamDraftStore(
  initialServerParams: readonly MacroParameter[],
  initialUserScopeKey: string
): MacroParamDraftStore {
  let state = createMacroParamDraftControllerState(initialServerParams, initialUserScopeKey);
  const listeners = new Set<() => void>();

  const commit = (nextState: MacroParamDraftControllerState): MacroParamDraftControllerState => {
    if (nextState === state || areDraftStatesEquivalent(state, nextState)) {
      return state;
    }
    state = nextState;
    for (const listener of listeners) {
      listener();
    }
    return state;
  };

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    reconcileServer: (serverParams, userScopeKey) =>
      commit(reconcileServerMacroParams(state, serverParams, userScopeKey)),
    editValue: (key, nextValueStr) =>
      commit(editMacroParamDraftValue(state, key, nextValueStr)),
    editRfMethodology: (key, methodology) =>
      commit(editMacroParamRfMethodology(state, key, methodology)),
    editCustomType: (key, nextChoice) =>
      commit(editMacroParamCustomType(state, key, nextChoice)),
    discardSingle: (key) => commit(discardSingleDraft(state, key)),
    discardAll: () => commit(discardAllMacroParamDrafts(state)),
    discardDeleted: (key) => commit(discardDeletedDraft(state, key)),
    resolveConflictAcceptServer: (key) =>
      commit(resolveConflictAcceptServer(state, key)),
    resolveConflictKeepDraft: (key) =>
      commit(resolveConflictKeepDraftOnLatestBase(state, key)),
    prepareDirtySave: (customRequestId) => {
      const prep = prepareDirtySaveSubmission(state, customRequestId);
      commit(prep.nextState);
      if (!prep.ok) {
        return {
          ...prep,
          outcome: evaluateBlockedDirtySaveOutcome(prep),
        };
      }
      return prep;
    },
    prepareCreateParam: (param, customRequestId) => {
      const prep = prepareCreateParamSubmission(state, param, customRequestId);
      if (prep.ok) {
        commit(prep.nextState);
      }
      return prep;
    },
    completeSaveSuccess: (savedServerParams, submittedSnapshots, nowIso, context) => {
      const { nextState, outcome } = evaluateSaveSuccessTransition(
        state,
        savedServerParams,
        submittedSnapshots,
        nowIso,
        context
      );
      commit(nextState);
      return outcome;
    },
    completeSaveFailure: (errorMessage, conflicts, context) => {
      const { nextState, outcome } = evaluateSaveFailureTransition(
        state,
        errorMessage,
        conflicts,
        context
      );
      commit(nextState);
      return outcome;
    },
  };
}

