import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const RULES_PATH = path.resolve('firestore.rules');
const RULES_SRC = fs.readFileSync(RULES_PATH, 'utf8');

function extractMatchBlock(src: string, matchHeader: string): string {
  const start = src.indexOf(matchHeader);
  assert.notEqual(start, -1, `Missing rules block: ${matchHeader}`);
  const braceOpen = src.indexOf('{', start + matchHeader.length);
  let depth = 0;
  for (let i = braceOpen; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) {
        return src.slice(start, i + 1);
      }
    }
  }
  throw new Error(`Unclosed rules block: ${matchHeader}`);
}

describe('Firestore Security Rules Governance & Anti-Escalation Suite', () => {
  const serverOnlyCollections = [
    'match /companies/{companyId}',
    'match /financials/{financialId}',
    'match /quarterly_financial_records/{recordId}',
    'match /daily_trading_records/{dailyId}',
    'match /stories/{companyId}',
    'match /decisions/{companyId}',
    'match /trades/{tradeId}',
    'match /macro_params/{paramKey}',
    'match /sectorPE/{sectorId}',
    'match /beta_assumptions/{tickerId}',
    'match /company_assumptions/{tickerId}',
    'match /parameters/{paramKey}',
    'match /{path=**}/parameters/{paramKey}',
    'match /import_batches/{batchId}',
    'match /real_estate_disclosures/{disclosureId}',
    'match /tombstones/{tombId}',
  ];

  it('denies all direct client writes on all financial, valuation parameter, tombstone, and import collections', () => {
    for (const header of serverOnlyCollections) {
      const block = extractMatchBlock(RULES_SRC, header);
      assert.match(
        block,
        /allow\s+write:\s*if\s+false\s*;/,
        `Expected 'allow write: if false;' in ${header}`
      );
      assert.equal(
        /allow\s+(create|update|delete):\s*if\s+(?!false)/.test(block),
        false,
        `Forbidden non-false write/create/update/delete found in ${header}`
      );
    }
  });

  it('prevents subscriber self-escalation on users/{userId} create and update', () => {
    const usersBlock = extractMatchBlock(RULES_SRC, 'match /users/{userId}');
    // Create must pin id == userId, subscriber, free tier, isActive == true
    assert.match(usersBlock, /request\.resource\.data\.id\s*==\s*userId/);
    assert.match(usersBlock, /request\.resource\.data\.role\s*==\s*'subscriber'/);
    assert.match(usersBlock, /request\.resource\.data\.tier\s*==\s*'free'/);
    assert.match(usersBlock, /request\.resource\.data\.isActive\s*==\s*true/);

    // Self-update must restrict affectedKeys to displayName, photoURL, lastLoginAt, updatedAt only
    assert.match(
      usersBlock,
      /request\.resource\.data\.diff\(resource\.data\)\.affectedKeys\(\)\.hasOnly\(\[\s*'displayName'\s*,\s*'photoURL'\s*,\s*'lastLoginAt'\s*,\s*'updatedAt'\s*\]\)/
    );
    // Role, tier, isActive, subscriptionExpiresAt must NOT be mutable by non-admin self-updates
    assert.doesNotMatch(
      usersBlock,
      /affectedKeys\(\)\.hasOnly\([^)]*(role|tier|isActive|subscriptionExpiresAt)/
    );
  });

  it('requires verified admin identity checks for admins/{adminId}, data_entry-only import_batches, and server-only dividend_year_locks', () => {
    const adminsBlock = extractMatchBlock(RULES_SRC, 'match /admins/{adminId}');
    assert.match(adminsBlock, /allow\s+read:\s*if\s+isAuthenticated\(\)\s*;/);
    assert.match(adminsBlock, /allow\s+write:\s*if\s+isAdmin\(\)\s*;/);

    const importBlock = extractMatchBlock(RULES_SRC, 'match /import_batches/{batchId}');
    assert.match(importBlock, /allow\s+read:\s*if\s+isDataEntry\(\)\s*;/);
    assert.match(importBlock, /allow\s+write:\s*if\s+false\s*;/);

    const realEstateBlock = extractMatchBlock(RULES_SRC, 'match /real_estate_disclosures/{disclosureId}');
    assert.match(realEstateBlock, /allow\s+read:\s*if\s+isDataEntry\(\)\s*;/);
    assert.match(realEstateBlock, /allow\s+write:\s*if\s+false\s*;/);

    const lockBlock = extractMatchBlock(RULES_SRC, 'match /dividend_year_locks/{lockId}');
    assert.match(lockBlock, /allow\s+read,\s*write:\s*if\s+false\s*;/);
  });
});

