/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { PARAMETER_REGISTRY, type ParameterRegistryDefinition } from '../contracts/parameterRegistry';
import type { MacroParameter } from '../../types';

export type MacroParameterDefinition = Omit<MacroParameter, 'value'> & {
  allowedScopes?: ('global' | 'company')[];
  enabledInEngine: boolean;
  modeNoteAr?: string;
};

/**
 * التعريفات الهيكلية للمتغيرات الكلية وإعدادات المنهجية وأوزان التقييم،
 * مشتقة بالكامل من Parameter Registry الموحد دون أي قيم تجارية افتراضية أو تكرار.
 */
export const MACRO_PARAMETER_DEFINITIONS: MacroParameterDefinition[] = PARAMETER_REGISTRY.map(
  (def: ParameterRegistryDefinition) => ({
    key: def.key,
    nameAr: def.nameAr,
    descriptionAr: def.descriptionAr,
    category: def.category,
    isPercentage: def.isPercentage,
    unit: def.unit,
    allowedScopes: def.allowedScopes,
    enabledInEngine: def.enabledInEngine,
    modeNoteAr: def.modeNoteAr,
  })
);

// لا توجد أي قيم افتراضية أو مضاعفات قطاعية محفوظة في الكود.
export const DEFAULT_MACRO_PARAMETERS: MacroParameter[] = [];
export const DEFAULT_SECTOR_PE: Record<string, number> = {};
