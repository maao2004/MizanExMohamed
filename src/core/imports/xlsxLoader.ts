/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

let xlsxPromise: Promise<typeof import('xlsx')> | null = null;

/**
 * تحميل مكتبة xlsx ديناميكياً عند الاستيراد أو التصدير فقط لتقليص الحزمة الأولية (Bundle Splitting).
 */
export async function loadXlsx(): Promise<typeof import('xlsx')> {
  if (!xlsxPromise) {
    xlsxPromise = import('xlsx');
  }
  return xlsxPromise;
}
