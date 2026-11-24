/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Company,
  DecisionItem,
  InvestmentStory,
  QuarterlyFinancial,
  TradeLog,
} from '../types/financial';
import { FirestoreService, SyncStats, COLLECTIONS } from '../services/firebase/firestoreService';

export { FirestoreService, COLLECTIONS };
export type { SyncStats };

/**
 * Synchronous and Asynchronous Storage Bridge backed by FirestoreService
 * Implements Incremental Delta Queries with updatedAt and Real-Time onSnapshot Sync.
 */

export function loadStoredCompanies(): Company[] {
  return FirestoreService.getCachedCompanies();
}

export function saveStoredCompanies(companies: Company[]): void {
  FirestoreService.setCachedCompanies(companies);
}

export function loadStoredFinancials(): QuarterlyFinancial[] {
  return FirestoreService.getCachedFinancials();
}

export function saveStoredFinancials(financials: QuarterlyFinancial[]): void {
  FirestoreService.setCachedFinancials(financials);
}

export function loadStoredStories(): Record<string, InvestmentStory> {
  return FirestoreService.getCachedStories();
}

export function saveStoredStories(stories: Record<string, InvestmentStory>): void {
  FirestoreService.setCachedStories(stories);
}

export function loadStoredDecisions(): Record<string, DecisionItem> {
  return FirestoreService.getCachedDecisions();
}

export function saveStoredDecisions(decisions: Record<string, DecisionItem>): void {
  FirestoreService.setCachedDecisions(decisions);
}

export function loadStoredTrades(): TradeLog[] {
  return FirestoreService.getCachedTrades();
}

export function saveStoredTrades(trades: TradeLog[]): void {
  FirestoreService.setCachedTrades(trades);
}

export function clearSessionCaches(): void {
  FirestoreService.clearSessionCaches();
}
