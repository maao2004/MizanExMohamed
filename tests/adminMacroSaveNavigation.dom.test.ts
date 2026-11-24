/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Real DOM interactive tests for `AdminDashboard` macro_params save flow, notices,
 * navigation guards ("حفظ التعديلات والمتابعة"), and `<React.StrictMode>` purity.
 *
 * Uses `happy-dom` + `react-dom/client` (`createRoot`) + `React.act` with an isolated
 * in-memory save stub (ZERO connection to production Firebase).
 */

import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { Window } from 'happy-dom';

import {
  buildMacroParameterWritePayload,
  computeRecordBusinessHash,
  normalizeMacroParameterFromFirestore,
  type ParameterWritePrecondition,
} from '../src/core/contracts';
import type { MacroParamSaveOutcome } from '../src/core/domain/macroParameterDraftController';
import type { MacroDraftNavigationGuard } from '../src/modules/admin/AdminDashboard';
import type { AppUser, MacroParameter } from '../src/types';

// Bootstrap happy-dom globals BEFORE importing react-dom/client so React detects DOM capabilities.
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const bootWindow = new Window({ url: 'http://localhost:3000/' });
function installDomGlobals(win: Window): void {
  (globalThis as any).window = win;
  (globalThis as any).document = win.document;
  (globalThis as any).HTMLElement = win.HTMLElement;
  (globalThis as any).HTMLInputElement = win.HTMLInputElement;
  (globalThis as any).HTMLButtonElement = win.HTMLButtonElement;
  (globalThis as any).Element = win.Element;
  (globalThis as any).Node = win.Node;
  (globalThis as any).Event = win.Event;
  (globalThis as any).InputEvent = win.InputEvent;
  (globalThis as any).MouseEvent = win.MouseEvent;
  (globalThis as any).CustomEvent = win.CustomEvent;
  (globalThis as any).localStorage = win.localStorage;
  Object.defineProperty(globalThis, 'navigator', {
    value: win.navigator,
    configurable: true,
  });
}
installDomGlobals(bootWindow);

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeMacroParam(
  overrides: Partial<MacroParameter> & { key: string; value: number }
): MacroParameter {
  const base = normalizeMacroParameterFromFirestore(overrides.key, {
    nameAr: overrides.nameAr ?? overrides.key,
    descriptionAr: overrides.descriptionAr ?? '',
    value: overrides.value,
    valueType: overrides.valueType,
    isPercentage: overrides.isPercentage,
    unit: overrides.unit,
    asOfDate: overrides.asOfDate ?? '2026-05-01',
    source: overrides.source ?? 'لوحة الإدارة',
    revision: overrides.revision ?? 1,
    updatedAt: overrides.updatedAt ?? '2026-05-01T10:00:00.000Z',
  }) as MacroParameter;
  const contentHash =
    overrides.contentHash ??
    computeRecordBusinessHash('parameter', buildMacroParameterWritePayload(base));
  return { ...base, contentHash };
}

function makeAdminUser(id: string, displayName: string): AppUser {
  return {
    id,
    email: `${id}@mizan.test`,
    displayName,
    role: 'admin',
    tier: 'pro',
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    lastLoginAt: '2026-05-12T00:00:00.000Z',
  };
}

function setReactInputValue(win: Window, input: HTMLInputElement, nextValue: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value');
  if (descriptor?.set) {
    descriptor.set.call(input, nextValue);
  } else {
    input.value = nextValue;
  }
  input.dispatchEvent(new win.Event('input', { bubbles: true }));
}

function findButtonByText(rootEl: HTMLElement, textSnippet: string): HTMLButtonElement {
  const buttons = Array.from(rootEl.querySelectorAll('button'));
  const found = buttons.find((b) => (b.textContent || '').includes(textSnippet));
  assert.ok(found, `Expected button containing "${textSnippet}" to exist in DOM`);
  return found as HTMLButtonElement;
}

function findDialog(rootEl: HTMLElement): HTMLElement | null {
  return rootEl.querySelector('[role="dialog"]') as HTMLElement | null;
}

describe('AdminDashboard Interactive DOM — Deterministic Save Outcome & Navigation Guard', () => {
  let createRootFn: typeof import('react-dom/client').createRoot;
  let AdminDashboardComp: typeof import('../src/modules/admin/AdminDashboard').AdminDashboard;
  let container: HTMLDivElement;
  let root: import('react-dom/client').Root;

  before(async () => {
    const reactDomClient = await import('react-dom/client');
    createRootFn = reactDomClient.createRoot;
    const adminMod = await import('../src/modules/admin/AdminDashboard');
    AdminDashboardComp = adminMod.AdminDashboard;
  });

  beforeEach(() => {
    bootWindow.document.body.innerHTML = '';
    bootWindow.localStorage.clear();
    container = bootWindow.document.createElement('div') as unknown as HTMLDivElement;
    bootWindow.document.body.appendChild(container as any);
    root = createRootFn(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  after(async () => {
    await bootWindow.happyDOM.close();
  });

  function renderAdmin(options: {
    macroParams: MacroParameter[];
    currentUser: AppUser;
    onSaveMacroParams: (
      params: MacroParameter[],
      preconditionsByKey: Record<string, ParameterWritePrecondition>
    ) => Promise<MacroParameter[] | void>;
    onMacroDraftGuardChange?: (guard: MacroDraftNavigationGuard | null) => void;
    strictMode?: boolean;
  }) {
    const adminEl = React.createElement(AdminDashboardComp, {
      macroParams: options.macroParams,
      onSaveMacroParams: options.onSaveMacroParams,
      onMacroDraftGuardChange: options.onMacroDraftGuardChange,
      sectorPEMap: {},
      onSaveSectorPE: () => {},
      users: [options.currentUser],
      onSaveUsers: () => {},
      currentUser: options.currentUser,
      onSwitchUser: () => {},
    });
    return options.strictMode
      ? React.createElement(React.StrictMode, null, adminEl)
      : adminEl;
  }

  it('1) Clean save produces a single notice and deterministic saved_clean outcome', async () => {
    const adminA = makeAdminUser('admin_A', 'مدير أ');
    const taxV1 = makeMacroParam({ key: 'TaxRate', value: 0.225, revision: 1 });
    const rimV1 = makeMacroParam({ key: 'RIM_Retention', value: 0.5, revision: 1 });

    const saveCalls: Array<{
      params: MacroParameter[];
      preconditions: Record<string, ParameterWritePrecondition>;
    }> = [];
    let latestGuard: MacroDraftNavigationGuard | null = null;

    const onSaveMacroParams = async (
      params: MacroParameter[],
      preconditions: Record<string, ParameterWritePrecondition>
    ) => {
      saveCalls.push({ params, preconditions });
      return params.map((p) => makeMacroParam({ ...p, revision: 2 }));
    };

    await act(async () => {
      root.render(
        renderAdmin({
          macroParams: [taxV1, rimV1],
          currentUser: adminA,
          onSaveMacroParams,
          onMacroDraftGuardChange: (g) => {
            latestGuard = g;
          },
        })
      );
    });

    const taxInput = container.querySelector('input[aria-label="قيمة TaxRate"]') as HTMLInputElement;
    assert.ok(taxInput);
    assert.equal(taxInput.value, '22.5');

    await act(async () => {
      setReactInputValue(bootWindow, taxInput, '25');
    });
    assert.equal(taxInput.value, '25');
    assert.equal(latestGuard?.hasUnsavedChanges, true);

    const saveBtn = findButtonByText(container, 'حفظ التعديلات (1)');
    await act(async () => {
      saveBtn.click();
    });

    assert.equal(saveCalls.length, 1);
    assert.equal(saveCalls[0].params.length, 1);
    assert.equal(saveCalls[0].params[0].key, 'TaxRate');
    assert.equal(saveCalls[0].params[0].value, 0.25);
    assert.equal(saveCalls[0].preconditions.TaxRate.mode, 'update');
    assert.equal(saveCalls[0].preconditions.TaxRate.expectedRevision, 1);

    // Exactly ONE confirmation notice in the DOM
    const notices = container.querySelectorAll('[data-testid="macro-save-notice"]');
    assert.equal(notices.length, 1);
    assert.match(notices[0].textContent || '', /تم تأكيد حفظ 1 تعديلاً في Firestore/);
    assert.equal(latestGuard?.hasUnsavedChanges, false);
    assert.equal(taxInput.value, '25');
  });

  it('2) Save & Continue waits until confirmation completes and navigates ONLY when safeToLeave is true (internal tab & external leave/signout guard)', async () => {
    const adminA = makeAdminUser('admin_A', 'مدير أ');
    const taxV1 = makeMacroParam({ key: 'TaxRate', value: 0.225, revision: 1 });
    const deferred = createDeferred<MacroParameter[]>();
    let latestGuard: MacroDraftNavigationGuard | null = null;

    await act(async () => {
      root.render(
        renderAdmin({
          macroParams: [taxV1],
          currentUser: adminA,
          onSaveMacroParams: () => deferred.promise,
          onMacroDraftGuardChange: (g) => {
            latestGuard = g;
          },
        })
      );
    });

    // Edit TaxRate -> attempt switching to Sectors tab
    const taxInput = container.querySelector('input[aria-label="قيمة TaxRate"]') as HTMLInputElement;
    await act(async () => {
      setReactInputValue(bootWindow, taxInput, '24');
    });

    const sectorsTabBtn = findButtonByText(container, 'مضاعفات P/E القطاعية');
    await act(async () => {
      sectorsTabBtn.click();
    });

    // Unsaved-changes dialog must open; still on params tab
    const dialog = findDialog(container);
    assert.ok(dialog, 'Expected unsaved changes dialog before tab switch');
    assert.ok(container.querySelector('input[aria-label="قيمة TaxRate"]'));

    // Click "حفظ التعديلات والمتابعة" -> while save is pending, MUST NOT navigate yet!
    const saveAndContinueBtn = findButtonByText(dialog, 'حفظ التعديلات والمتابعة');
    await act(async () => {
      saveAndContinueBtn.click();
    });
    assert.ok(findDialog(container), 'Dialog must stay open while save is in-flight');
    assert.ok(
      container.querySelector('input[aria-label="قيمة TaxRate"]'),
      'Must remain on params tab while save is in-flight'
    );

    // Resolve server write cleanly -> dialog closes & switches to Sectors tab
    await act(async () => {
      deferred.resolve([makeMacroParam({ key: 'TaxRate', value: 0.24, revision: 2 })]);
      await deferred.promise;
    });

    assert.equal(findDialog(container), null);
    assert.equal(
      container.querySelector('input[aria-label="قيمة TaxRate"]'),
      null,
      'Should have navigated to Sectors tab after clean save'
    );
    assert.equal(latestGuard?.hasUnsavedChanges, false);

    // Also verify external guard contract (used by App.tsx for leaving AdminDashboard & Sign Out)
    const paramsTabBtn = findButtonByText(container, 'المتغيرات الكلية');
    await act(async () => {
      paramsTabBtn.click();
    });

    const deferredExternal = createDeferred<MacroParameter[]>();
    await act(async () => {
      root.render(
        renderAdmin({
          macroParams: [makeMacroParam({ key: 'TaxRate', value: 0.24, revision: 2 })],
          currentUser: adminA,
          onSaveMacroParams: () => deferredExternal.promise,
          onMacroDraftGuardChange: (g) => {
            latestGuard = g;
          },
        })
      );
    });
    const taxInput2 = container.querySelector('input[aria-label="قيمة TaxRate"]') as HTMLInputElement;
    await act(async () => {
      setReactInputValue(bootWindow, taxInput2, '26');
    });

    let externalOutcome: MacroParamSaveOutcome | null = null;
    let externalPromise!: Promise<MacroParamSaveOutcome>;
    await act(async () => {
      externalPromise = latestGuard!.saveDirtyDrafts();
    });
    await act(async () => {
      deferredExternal.resolve([makeMacroParam({ key: 'TaxRate', value: 0.26, revision: 3 })]);
      externalOutcome = await externalPromise;
    });

    assert.equal(externalOutcome!.status, 'saved_clean');
    assert.equal(externalOutcome!.serverWriteSucceeded, true);
    assert.equal(externalOutcome!.appliedToCurrentSession, true);
    assert.equal(externalOutcome!.hasRemainingUnsavedChanges, false);
    assert.equal(externalOutcome!.safeToLeave, true);
  });

  it('3) Save failure preserves draft, shows error, and blocks Save & Continue navigation', async () => {
    const adminA = makeAdminUser('admin_A', 'مدير أ');
    const taxV1 = makeMacroParam({ key: 'TaxRate', value: 0.225, revision: 1 });
    let latestGuard: MacroDraftNavigationGuard | null = null;

    await act(async () => {
      root.render(
        renderAdmin({
          macroParams: [taxV1],
          currentUser: adminA,
          onSaveMacroParams: async () => {
            throw new Error('انقطع الاتصال بالخادم أثناء الحفظ.');
          },
          onMacroDraftGuardChange: (g) => {
            latestGuard = g;
          },
        })
      );
    });

    const taxInput = container.querySelector('input[aria-label="قيمة TaxRate"]') as HTMLInputElement;
    await act(async () => {
      setReactInputValue(bootWindow, taxInput, '27');
    });

    await act(async () => {
      findButtonByText(container, 'مضاعفات P/E القطاعية').click();
    });
    const dialog = findDialog(container);
    assert.ok(dialog);

    await act(async () => {
      findButtonByText(dialog, 'حفظ التعديلات والمتابعة').click();
    });

    // Must NOT navigate away; error shown; draft "27" preserved; no success notice!
    assert.ok(container.querySelector('input[aria-label="قيمة TaxRate"]'));
    assert.equal(
      (container.querySelector('input[aria-label="قيمة TaxRate"]') as HTMLInputElement).value,
      '27'
    );
    assert.equal(container.querySelectorAll('[data-testid="macro-save-notice"]').length, 0);
    assert.match(container.textContent || '', /انقطع الاتصال بالخادم أثناء الحفظ/);
    assert.equal(latestGuard?.hasUnsavedChanges, true);
  });

  it('4) Newer edit typed while save is in-flight is preserved and blocks Save & Continue navigation', async () => {
    const adminA = makeAdminUser('admin_A', 'مدير أ');
    const taxV1 = makeMacroParam({ key: 'TaxRate', value: 0.225, revision: 1 });
    const deferred = createDeferred<MacroParameter[]>();
    let latestGuard: MacroDraftNavigationGuard | null = null;

    await act(async () => {
      root.render(
        renderAdmin({
          macroParams: [taxV1],
          currentUser: adminA,
          onSaveMacroParams: () => deferred.promise,
          onMacroDraftGuardChange: (g) => {
            latestGuard = g;
          },
        })
      );
    });

    const taxInput = container.querySelector('input[aria-label="قيمة TaxRate"]') as HTMLInputElement;
    await act(async () => {
      setReactInputValue(bootWindow, taxInput, '24');
    });

    // Open Save & Continue modal and start saving 24%
    await act(async () => {
      findButtonByText(container, 'مضاعفات P/E القطاعية').click();
    });
    const dialog = findDialog(container);
    assert.ok(dialog);
    await act(async () => {
      findButtonByText(dialog, 'حفظ التعديلات والمتابعة').click();
    });

    // WHILE the save for 24% is in-flight, user types a NEWER edit "29"
    await act(async () => {
      setReactInputValue(bootWindow, taxInput, '29');
    });

    // Earlier save (24%, rev 2) now resolves on server
    await act(async () => {
      deferred.resolve([makeMacroParam({ key: 'TaxRate', value: 0.24, revision: 2 })]);
      await deferred.promise;
    });

    // MUST NOT navigate over the newer edit "29"!
    const inputAfter = container.querySelector(
      'input[aria-label="قيمة TaxRate"]'
    ) as HTMLInputElement | null;
    assert.ok(inputAfter, 'Must stay on params tab because newer draft "29" is unsaved');
    assert.equal(inputAfter.value, '29');
    assert.equal(latestGuard?.hasUnsavedChanges, true);

    // Also verify external guard outcome explicitly distinguishes serverWriteSucceeded vs safeToLeave
    const deferred2 = createDeferred<MacroParameter[]>();
    await act(async () => {
      root.render(
        renderAdmin({
          macroParams: [makeMacroParam({ key: 'TaxRate', value: 0.24, revision: 2 })],
          currentUser: adminA,
          onSaveMacroParams: () => deferred2.promise,
          onMacroDraftGuardChange: (g) => {
            latestGuard = g;
          },
        })
      );
    });
    let outcomePromise!: Promise<MacroParamSaveOutcome>;
    await act(async () => {
      outcomePromise = latestGuard!.saveDirtyDrafts();
    });
    await act(async () => {
      setReactInputValue(
        bootWindow,
        container.querySelector('input[aria-label="قيمة TaxRate"]') as HTMLInputElement,
        '31'
      );
    });
    let outcome!: MacroParamSaveOutcome;
    await act(async () => {
      deferred2.resolve([makeMacroParam({ key: 'TaxRate', value: 0.29, revision: 3 })]);
      outcome = await outcomePromise;
    });
    assert.equal(outcome.status, 'saved_with_newer_draft');
    assert.equal(outcome.serverWriteSucceeded, true);
    assert.equal(outcome.appliedToCurrentSession, true);
    assert.equal(outcome.hasRemainingUnsavedChanges, true);
    assert.equal(outcome.safeToLeave, false);
  });

  it('5) Newer server revision arriving during an in-flight save surfaces conflict and blocks navigation without a success notice', async () => {
    const adminA = makeAdminUser('admin_A', 'مدير أ');
    const taxV1 = makeMacroParam({ key: 'TaxRate', value: 0.225, revision: 1 });
    const taxV3Server = makeMacroParam({ key: 'TaxRate', value: 0.27, revision: 3 });
    const deferred = createDeferred<MacroParameter[]>();
    let latestGuard: MacroDraftNavigationGuard | null = null;

    const renderWith = (params: MacroParameter[]) =>
      renderAdmin({
        macroParams: params,
        currentUser: adminA,
        onSaveMacroParams: () => deferred.promise,
        onMacroDraftGuardChange: (g) => {
          latestGuard = g;
        },
      });

    await act(async () => {
      root.render(renderWith([taxV1]));
    });

    const taxInput = container.querySelector('input[aria-label="قيمة TaxRate"]') as HTMLInputElement;
    await act(async () => {
      setReactInputValue(bootWindow, taxInput, '24');
    });

    await act(async () => {
      findButtonByText(container, 'مضاعفات P/E القطاعية').click();
    });
    await act(async () => {
      findButtonByText(findDialog(container)!, 'حفظ التعديلات والمتابعة').click();
    });

    // Newer server revision (rev 3 = 27%) arrives via props while rev 2 confirmation is still in-flight
    await act(async () => {
      root.render(renderWith([taxV3Server]));
    });

    // Delayed rev 2 confirmation arrives
    await act(async () => {
      deferred.resolve([makeMacroParam({ key: 'TaxRate', value: 0.24, revision: 2 })]);
      await deferred.promise;
    });

    // MUST stay on params tab, show conflict, preserve local draft "24", and show ZERO success notice
    assert.ok(container.querySelector('input[aria-label="قيمة TaxRate"]'));
    assert.equal(
      (container.querySelector('input[aria-label="قيمة TaxRate"]') as HTMLInputElement).value,
      '24'
    );
    assert.equal(container.querySelectorAll('[data-testid="macro-save-notice"]').length, 0);
    assert.match(container.textContent || '', /تعارض تزامن/);
    assert.equal(latestGuard?.hasBlockingIssues, true);
  });

  it('6) User switch isolates late save success AND late save failure without polluting the new session or recording a failure', async () => {
    const adminA = makeAdminUser('admin_A', 'مدير أ');
    const adminB = makeAdminUser('admin_B', 'مدير ب');
    const taxV1 = makeMacroParam({ key: 'TaxRate', value: 0.225, revision: 1 });
    const deferredA1 = createDeferred<MacroParameter[]>();
    let latestGuard: MacroDraftNavigationGuard | null = null;

    await act(async () => {
      root.render(
        renderAdmin({
          macroParams: [taxV1],
          currentUser: adminA,
          onSaveMacroParams: () => deferredA1.promise,
          onMacroDraftGuardChange: (g) => {
            latestGuard = g;
          },
        })
      );
    });

    // User A edits and starts saving
    await act(async () => {
      setReactInputValue(
        bootWindow,
        container.querySelector('input[aria-label="قيمة TaxRate"]') as HTMLInputElement,
        '26'
      );
    });
    let promiseA1!: Promise<MacroParamSaveOutcome>;
    await act(async () => {
      promiseA1 = latestGuard!.saveDirtyDrafts();
    });

    // Switch to User B BEFORE User A's save settles
    const deferredB = createDeferred<MacroParameter[]>();
    await act(async () => {
      root.render(
        renderAdmin({
          macroParams: [taxV1],
          currentUser: adminB,
          onSaveMacroParams: () => deferredB.promise,
          onMacroDraftGuardChange: (g) => {
            latestGuard = g;
          },
        })
      );
    });

    // User B starts with clean 22.5% and types their own draft 31%
    const taxInputB = container.querySelector('input[aria-label="قيمة TaxRate"]') as HTMLInputElement;
    assert.equal(taxInputB.value, '22.5');
    await act(async () => {
      setReactInputValue(bootWindow, taxInputB, '31');
    });

    // User A's late SUCCESS arrives -> MUST be ignored_stale with zero UI/draft effect on User B!
    let outcomeA1!: MacroParamSaveOutcome;
    await act(async () => {
      deferredA1.resolve([makeMacroParam({ key: 'TaxRate', value: 0.26, revision: 2 })]);
      outcomeA1 = await promiseA1;
    });

    assert.equal(outcomeA1.status, 'ignored_stale');
    assert.equal(outcomeA1.serverWriteSucceeded, true);
    assert.equal(outcomeA1.appliedToCurrentSession, false);
    assert.equal(outcomeA1.safeToLeave, false);
    assert.equal(outcomeA1.errorAr, null);
    assert.equal(container.querySelectorAll('[data-testid="macro-save-notice"]').length, 0);
    assert.equal(container.querySelectorAll('[role="alert"]').length, 0);
    assert.equal(
      (container.querySelector('input[aria-label="قيمة TaxRate"]') as HTMLInputElement).value,
      '31'
    );

    // Now User B starts a save, switches back to User A, and User B's save FAILS late -> NOT a failure in User A!
    let promiseB!: Promise<MacroParamSaveOutcome>;
    await act(async () => {
      promiseB = latestGuard!.saveDirtyDrafts();
    });

    await act(async () => {
      root.render(
        renderAdmin({
          macroParams: [taxV1],
          currentUser: adminA,
          onSaveMacroParams: async (p) => p,
          onMacroDraftGuardChange: (g) => {
            latestGuard = g;
          },
        })
      );
    });

    let outcomeB!: MacroParamSaveOutcome;
    await act(async () => {
      deferredB.reject(new Error('فشل متأخر للجلسة السابقة'));
      outcomeB = await promiseB;
    });

    assert.equal(outcomeB.status, 'ignored_stale');
    assert.equal(outcomeB.serverWriteSucceeded, false);
    assert.equal(outcomeB.appliedToCurrentSession, false);
    assert.equal(outcomeB.safeToLeave, false);
    assert.equal(outcomeB.errorAr, null);
    assert.equal(container.querySelectorAll('[role="alert"]').length, 0);
    assert.equal(
      (container.querySelector('input[aria-label="قيمة TaxRate"]') as HTMLInputElement).value,
      '22.5'
    );
  });

  it('7) Runs cleanly under React.StrictMode without duplicate save calls or duplicate notices', async () => {
    const adminA = makeAdminUser('admin_strict', 'مدير Strict');
    const taxV1 = makeMacroParam({ key: 'TaxRate', value: 0.225, revision: 1 });

    let saveCallCount = 0;
    const onSaveMacroParams = async (params: MacroParameter[]) => {
      saveCallCount += 1;
      return params.map((p) => makeMacroParam({ ...p, revision: (p.revision ?? 1) + 1 }));
    };

    await act(async () => {
      root.render(
        renderAdmin({
          macroParams: [taxV1],
          currentUser: adminA,
          onSaveMacroParams,
          strictMode: true,
        })
      );
    });

    const taxInput = container.querySelector('input[aria-label="قيمة TaxRate"]') as HTMLInputElement;
    await act(async () => {
      setReactInputValue(bootWindow, taxInput, '24.5');
    });

    await act(async () => {
      findButtonByText(container, 'حفظ التعديلات (1)').click();
    });

    assert.equal(saveCallCount, 1, 'onSaveMacroParams must execute exactly once under StrictMode');
    const notices = container.querySelectorAll('[data-testid="macro-save-notice"]');
    assert.equal(notices.length, 1, 'Exactly one success notice must render under StrictMode');
    assert.match(notices[0].textContent || '', /تم تأكيد حفظ 1 تعديلاً في Firestore/);
    assert.equal(taxInput.value, '24.5');

    // Now test Save & Continue under StrictMode as well
    await act(async () => {
      setReactInputValue(bootWindow, taxInput, '25.5');
    });
    await act(async () => {
      findButtonByText(container, 'مضاعفات P/E القطاعية').click();
    });
    const dialog = findDialog(container);
    assert.ok(dialog);
    await act(async () => {
      findButtonByText(dialog, 'حفظ التعديلات والمتابعة').click();
    });

    assert.equal(saveCallCount, 2, 'Second save under StrictMode must execute exactly once');
    assert.equal(findDialog(container), null);
    assert.equal(
      container.querySelector('input[aria-label="قيمة TaxRate"]'),
      null,
      'Save & Continue should cleanly switch tabs under StrictMode'
    );
  });

  it('8) Outer leave-admin and sign-out Save & Continue guard executes leave/signOut ONLY when safeToLeave is true', async () => {
    const adminA = makeAdminUser('admin_A', 'مدير أ');
    const taxV1 = makeMacroParam({ key: 'TaxRate', value: 0.225, revision: 1 });
    let activeOuterTab = 'admin';
    let signOutCount = 0;

    // Minimal host mirroring App.tsx's pendingLeaveAction consumer of AdminDashboard's MacroDraftNavigationGuard
    const OuterGuardHost: React.FC<{
      macroParams: MacroParameter[];
      currentUser: AppUser;
      onSaveMacroParams: (
        params: MacroParameter[],
        preconditionsByKey: Record<string, ParameterWritePrecondition>
      ) => Promise<MacroParameter[] | void>;
    }> = ({ macroParams, currentUser, onSaveMacroParams }) => {
      const [tab, setTab] = React.useState<'admin' | 'dashboard'>('admin');
      const [guard, setGuard] = React.useState<MacroDraftNavigationGuard | null>(null);
      const [pending, setPending] = React.useState<'dashboard' | 'signout' | null>(null);
      const [feedback, setFeedback] = React.useState<string | null>(null);
      activeOuterTab = tab;

      const handleLeaveConfirm = async () => {
        if (!guard || !pending) return;
        const target = pending;
        setFeedback(null);
        const outcome = await guard.saveDirtyDrafts();
        if (outcome.safeToLeave) {
          setPending(null);
          if (target === 'signout') {
            signOutCount += 1;
          } else {
            setTab('dashboard');
          }
          return;
        }
        if (outcome.status === 'ignored_stale') {
          return;
        }
        setFeedback(outcome.errorAr || outcome.noticeAr || null);
      };

      return React.createElement(
        'div',
        null,
        React.createElement(
          'button',
          {
            type: 'button',
            'data-testid': 'outer-leave-btn',
            onClick: () => {
              if (tab === 'admin' && guard?.hasUnsavedChanges) {
                setPending('dashboard');
              } else {
                setTab('dashboard');
              }
            },
          },
          'مغادرة الإدارة'
        ),
        React.createElement(
          'button',
          {
            type: 'button',
            'data-testid': 'outer-signout-btn',
            onClick: () => {
              if (tab === 'admin' && guard?.hasUnsavedChanges) {
                setPending('signout');
              } else {
                signOutCount += 1;
              }
            },
          },
          'تسجيل الخروج'
        ),
        tab === 'admin'
          ? React.createElement(AdminDashboardComp, {
              macroParams,
              onSaveMacroParams,
              onMacroDraftGuardChange: setGuard,
              sectorPEMap: {},
              onSaveSectorPE: () => {},
              users: [currentUser],
              onSaveUsers: () => {},
              currentUser,
              onSwitchUser: () => {},
            })
          : React.createElement('div', { 'data-testid': 'dashboard-view' }, 'لوحة المتابعة'),
        pending &&
          React.createElement(
            'div',
            { role: 'dialog', 'data-testid': 'outer-leave-dialog' },
            feedback && React.createElement('div', { 'data-testid': 'outer-feedback' }, feedback),
            React.createElement(
              'button',
              { type: 'button', 'data-testid': 'outer-save-continue', onClick: handleLeaveConfirm },
              'حفظ ومتابعة الخروج'
            )
          )
      );
    };

    // Case A: Sign-out Save & Continue blocked when a newer edit is typed while saving
    const deferredA = createDeferred<MacroParameter[]>();
    await act(async () => {
      root.render(
        React.createElement(
          React.StrictMode,
          null,
          React.createElement(OuterGuardHost, {
            macroParams: [taxV1],
            currentUser: adminA,
            onSaveMacroParams: () => deferredA.promise,
          })
        )
      );
    });

    await act(async () => {
      setReactInputValue(
        bootWindow,
        container.querySelector('input[aria-label="قيمة TaxRate"]') as HTMLInputElement,
        '24'
      );
    });
    await act(async () => {
      (container.querySelector('[data-testid="outer-signout-btn"]') as HTMLButtonElement).click();
    });
    assert.ok(container.querySelector('[data-testid="outer-leave-dialog"]'));

    await act(async () => {
      (container.querySelector('[data-testid="outer-save-continue"]') as HTMLButtonElement).click();
    });
    // Type newer edit while sign-out save is in-flight
    await act(async () => {
      setReactInputValue(
        bootWindow,
        container.querySelector('input[aria-label="قيمة TaxRate"]') as HTMLInputElement,
        '28'
      );
    });
    await act(async () => {
      deferredA.resolve([makeMacroParam({ key: 'TaxRate', value: 0.24, revision: 2 })]);
      await deferredA.promise;
    });

    // Sign-out MUST NOT have fired because newer edit "28" is unsaved!
    assert.equal(signOutCount, 0);
    assert.equal(activeOuterTab, 'admin');
    assert.equal(
      (container.querySelector('input[aria-label="قيمة TaxRate"]') as HTMLInputElement).value,
      '28'
    );

    // Case B: Save cleanly now -> sign-out proceeds deterministically
    await act(async () => {
      root.render(
        React.createElement(
          React.StrictMode,
          null,
          React.createElement(OuterGuardHost, {
            macroParams: [makeMacroParam({ key: 'TaxRate', value: 0.24, revision: 2 })],
            currentUser: adminA,
            onSaveMacroParams: async (params) =>
              params.map((p) => makeMacroParam({ ...p, revision: 3 })),
          })
        )
      );
    });
    await act(async () => {
      (container.querySelector('[data-testid="outer-save-continue"]') as HTMLButtonElement).click();
    });
    assert.equal(signOutCount, 1);
    assert.equal(container.querySelector('[data-testid="outer-leave-dialog"]'), null);
  });
});

