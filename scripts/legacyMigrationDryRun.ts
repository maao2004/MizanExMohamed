/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  analyzeLegacyMigration,
  formatLegacyMigrationDryRunReport,
} from '../src/core/domain/legacyMigrationTool';
import { deriveSectorPEMapFromDefinitions, normalizeSectorDoc } from '../src/core/contracts';
import type { SectorDefinition } from '../src/types/financial';

function main() {
  const arg = process.argv.find((a) => a.startsWith('--input='));
  if (!arg) {
    console.log(
      [
        'MizanEX Legacy Migration & SectorPE Dry-Run CLI (قراءة ومعاينة فقط — لا يكتب إلى الإنتاج)',
        'الاستخدام:',
        '  npx tsx scripts/legacyMigrationDryRun.ts --input=path/to/export.json',
        '',
        'صيغة JSON المتوقعة:',
        '  {',
        '    "sectorPE": { "DocId": { "nameAr": "...", "value": 10 } },',
        '    "companies": [...],',
        '    "quarterlyRecords": [...],',
        '    "dailyRecords": [...],',
        '    "companyOverrides": [...],',
        '    "betaAssumptions": [...],',
        '    "macroParams": [...]',
        '  }',
      ].join('\n')
    );
    return;
  }

  const inputPath = path.resolve(arg.slice('--input='.length));
  const raw = JSON.parse(fs.readFileSync(inputPath, 'utf-8')) as Record<string, any>;

  const rawSectorPE = raw.sectorPE ?? raw.sectorDefinitions ?? {};
  const sectorDefinitions: SectorDefinition[] = Array.isArray(rawSectorPE)
    ? rawSectorPE
        .map((d: any) => normalizeSectorDoc(d.sectorId || d.legacyDocId || d.nameAr, d))
        .filter((d): d is SectorDefinition => d !== null)
    : Object.entries(rawSectorPE as Record<string, unknown>)
        .map(([id, doc]) => normalizeSectorDoc(id, doc))
        .filter((d): d is SectorDefinition => d !== null);

  const report = analyzeLegacyMigration({
    companies: raw.companies ?? [],
    sectorPEMap: deriveSectorPEMapFromDefinitions(sectorDefinitions),
    sectorDefinitions,
    quarterlyRecords: raw.quarterlyRecords ?? [],
    dailyRecords: raw.dailyRecords ?? [],
    companyOverrides: raw.companyOverrides ?? [],
    betaAssumptions: raw.betaAssumptions ?? [],
    macroParams: raw.macroParams ?? [],
  });

  console.log(formatLegacyMigrationDryRunReport(report));
}

main();
