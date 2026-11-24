/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface SaveActionKey {
  ticker: string;
  key: string;
  kind: 'company_override' | 'delete_company_override' | 'global_macro' | 'beta_assumption' | 'delete_beta';
}

export interface SaveRequestHandle {
  requestId: number;
  ticker: string;
  key: string;
  compoundKey: string;
}

export class ValuationSaveConcurrencyController {
  private activeTicker = '';
  private nextRequestId = 1;
  private readonly inFlightByCompoundKey = new Map<string, number>();

  constructor(initialTicker = '') {
    this.activeTicker = initialTicker.trim().toUpperCase();
  }

  setActiveTicker(ticker: string): void {
    this.activeTicker = ticker.trim().toUpperCase();
  }

  getActiveTicker(): string {
    return this.activeTicker;
  }

  static makeCompoundKey(ticker: string, key: string): string {
    return `${ticker.trim().toUpperCase()}::${key.trim()}`;
  }

  isKeyInFlight(ticker: string, key: string): boolean {
    return this.inFlightByCompoundKey.has(
      ValuationSaveConcurrencyController.makeCompoundKey(ticker, key)
    );
  }

  hasAnyInFlightForTicker(ticker: string): boolean {
    const prefix = `${ticker.trim().toUpperCase()}::`;
    for (const k of this.inFlightByCompoundKey.keys()) {
      if (k.startsWith(prefix)) return true;
    }
    return false;
  }

  hasAnyInFlight(): boolean {
    return this.inFlightByCompoundKey.size > 0;
  }

  beginRequest(ticker: string, key: string): SaveRequestHandle | null {
    const normTicker = ticker.trim().toUpperCase();
    const compoundKey = ValuationSaveConcurrencyController.makeCompoundKey(normTicker, key);
    if (this.inFlightByCompoundKey.has(compoundKey)) {
      return null;
    }
    const requestId = this.nextRequestId++;
    this.inFlightByCompoundKey.set(compoundKey, requestId);
    return {
      requestId,
      ticker: normTicker,
      key,
      compoundKey,
    };
  }

  /**
   * يُنهي تتبع الطلب ويعيد ما إذا كان يُسمح له بتحديث واجهة السهم النشط حالياً.
   * إذا غيّر المستخدم السهم أثناء انتظار الشبكة، تُحجب تحديثات السهم السابق صامتاً عن واجهة السهم الجديد.
   */
  completeRequest(handle: SaveRequestHandle): {
    shouldApplyUiState: boolean;
    staleReason: 'ticker_changed' | 'superseded' | null;
  } {
    const trackedId = this.inFlightByCompoundKey.get(handle.compoundKey);
    if (trackedId === handle.requestId) {
      this.inFlightByCompoundKey.delete(handle.compoundKey);
    }

    if (this.activeTicker !== handle.ticker) {
      return { shouldApplyUiState: false, staleReason: 'ticker_changed' };
    }
    if (trackedId !== undefined && trackedId !== handle.requestId) {
      return { shouldApplyUiState: false, staleReason: 'superseded' };
    }
    return { shouldApplyUiState: true, staleReason: null };
  }
}
