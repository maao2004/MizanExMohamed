# الإفصاحات العقارية الموثقة (Documented Real Estate Disclosures) — التأسيس وضوابط الدفعة التصحيحية وخطة الدفعة الثانية

## 1. مراجعة العقود والخدمات القائمة وإعادة الاستخدام
بعد فحص `src/core/contracts/` و`src/core/domain/` و`src/types/` و`src/services/firebase/`:
- **هوية الشركة (`ticker`):** أُعيد استخدام `normalizedTicker` من `src/core/contracts/normalization.ts` (المستخدم ذاته في `companies`, `quarterly_financial_records`, `dividend_records`, `beta_assumptions`, `company_assumptions`) دون إنشاء كيان شركة موازٍ.
- **الفترة المالية (`fiscalYear`, `fiscalQuarter`) والتواريخ (`balanceSheetDate`, `fairValueDate`):** أُعيد استخدام `QuarterlyRecordQuarter` (`Q1 | Q2 | Q3 | FY`) من `src/core/contracts/reportedEpsPeriod.ts` و`isValidCalendarDate` و`parseCleanText` و`parseCleanNumber` من `normalization.ts` دون إنشاء تعريف فترات موازٍ.
- **الوحدة والعملة:** لا تُضاف حقول عملة أو مضاعفات آلاف/ملايين جديدة؛ القيم تُقرأ وتُحفظ بالوحدة الأساسية القائمة لسجلات السهم (نفس وحدة `quarterly_financial_records`).
- **نطاق القوائم المالية (`statementScope`):** عُرّف `FinancialStatementScope` (`consolidated | standalone | unspecified`) داخل `src/core/contracts/realEstateDisclosures.ts` بشكل قابل لإعادة الاستخدام.

---

## 2. القاعدة المركزية للهوية ومنع تصادم المعرّفات (محدّثة في الدفعة التصحيحية)
- تنطبق قاعدة الهوية نفسها باتساق تام على `disclosureId` و`parentDisclosureId` وعند بناء `buildRealEstateDisclosureDocId` عبر `inspectRealEstateDisclosureId` / `validateRealEstateDisclosureId` (و`sanitizeRealEstateDisclosureId`):
  - **طول المعرّف:** من `1` إلى `80` حرفاً (`REAL_ESTATE_DISCLOSURE_ID_MAX_LENGTH = 80`) — **يُرفض تجاوز الحد برسالة واضحة ولا يُقص المعرّف بصمت أبداً**، منعاً لتحول معرفين مختلفين يتشاركان أول 80 حرفاً إلى مستند واحد.
  - **منع التحويلات المسببة للتصادم:** لا تُستبدل المسافات بـ `_` ولا يُجرى تحويل صامت لحالة الأحرف؛ أي مسافات (داخلية أو طرفية أو علامات جدولة) أو `/`, `\`, `..` تُرفض صراحةً، وتقتصر الصيغة المعتمدة على `^[A-Za-z0-9][A-Za-z0-9._-]*$`.
  - **حتمية `buildRealEstateDisclosureDocId`:** يشترط تحديد `(fiscalYear + fiscalQuarter)` معاً أو `balanceSheetDate` صالحاً ونطاقاً معتمداً (دون سقوط صامت إلى `'undated'`)، وتبقى صيغة المستند `${ticker}_${periodToken}_${statementScope}_${disclosureId}` أحادية التطابق بلا تصادم.

---

## 3. مكان الربط بالسجل المالي (دون تعديل تخزين `quarterly_financial_records`)
- **عدم التضمين داخل مستند `quarterly_financial_records`:** قد تحتوي الفترة المالية الواحدة على عدة سطور إفصاح عقاري (مثلاً إجمالي الاستثمارات العقارية + تفاصيل مشاريع/مبانٍ فرعية + أراضٍ ومخزون تطوير عقاري، أو قوائم موحدة ومستقلة).
- **الربط المنطقي مقابل التحقق الفعلي (Logical Reference vs Actual Verification):**
  1. يُشتق المرجع المنطقي على الخادم فقط عبر `ticker` + `fiscalYear` + `fiscalQuarter` → `linkedQuarterlyDocId = "${ticker}_${fiscalYear}_${fiscalQuarter}"` (مطابق لصيغة مستندات `quarterly_financial_records`).
  2. يتحقق الخادم داخل معاملة الحفظ (قراءة فقط) من وجود `companies/{ticker.toLowerCase()}` و`quarterly_financial_records/{linkedQuarterlyDocId}` **بفصل تام بين وجود الوثيقة وبين صلاحية هويتها وتطابقها** (`ticker` في الشركة؛ و`ticker` و`year` و`quarter` و`periodEndDate` في السجل المالي المرجعي)، مع إرجاع حالات صادقة وواضحة للنقص أو عدم التأكيد أو التعارض (`verified` / `missing_company` / `unverified_company_identity` / `company_ticker_conflict` / `missing_quarterly_record` / `unverified_quarterly_identity` / `unverified_quarterly_period_end_date` / `ticker_conflict` / `period_conflict` / `date_conflict` / `verified_without_period_end_date` / `not_linked_period`) **دون إنشاء أو تعديل أي مستند مرجعي تلقائياً ودون افتراض بداية سنة مالية أو نطاق قوائم غير موثق**.
- **المجموعة المعتمدة:** مجموعة مستقلة باسم `real_estate_disclosures` بمعرّف حتمي من `buildRealEstateDisclosureDocId` بصيغة `${ticker}_${periodToken}_${statementScope}_${disclosureId}`، دون لمس بنية `quarterly_financial_records`.

---

## 4. قاموس الحقول ومصادرها (`REAL_ESTATE_DISCLOSURE_FIELD_DICTIONARY`)

| الحقل | التسمية العربية | النوع / الرموز المعتمدة | المصدر المحاسبي | ضوابط الحوكمة |
|---|---|---|---|---|
| `disclosureId` | معرّف الإفصاح العقاري | `string (1..80, /^[A-Za-z0-9][A-Za-z0-9._-]*$/)` | معرّف سطر الإفصاح داخل الفترة | بلا قص صامت ولا استبدال مسافات لمنع تصادم المعرّفات |
| `ticker` | رمز السهم | `normalizedTicker` | بطاقة الشركة (`companies`) | إعادة استخدام بدون كيان موازٍ |
| `fiscalYear` | السنة المالية | `1900..2200 \| null` | سجل الفترة المالية (`quarterly_financial_records`) | يُقرن مع `fiscalQuarter` عند الربط |
| `fiscalQuarter` | الربع / الفترة | `Q1 \| Q2 \| Q3 \| FY \| null` | `QuarterlyRecordQuarter` | مطابقة رموز الفترات القائمة |
| `linkedQuarterlyDocId` | المرجع المنطقي للسجل الفصلي | `string \| null` (مشتق خادمياً) | `${ticker}_${fiscalYear}_${fiscalQuarter}` | مرجع ربط فقط دون تعديل `quarterly_financial_records` |
| `balanceSheetDate` | تاريخ المركز المالي | `YYYY-MM-DD \| null` | قائمة المركز المالي (`periodEndDate`) | شرط للتحقق من المقارنة الزمنية |
| `statementScope` | نطاق القوائم المالية | `consolidated \| standalone \| unspecified` | ترويسة القوائم المالية | يمنع مقارنة/جمع موحد مع مستقل |
| `assetCategory` | تصنيف العقار واستخدامه | `investment_property \| development_inventory \| owner_occupied_property \| land_bank_unspecified_use \| mixed_or_other_real_estate \| unspecified` | قائمة المركز المالي والإيضاحات | لا يفترض أن كل عقارات المطورين IAS 40؛ ولا يُحوّل غير المعروف تلقائياً |
| `assetUsageDescription` | وصف استخدام العقار | `string (<=240) \| null` | نص الإيضاح المتمم | توثيق اختياري؛ يُرفض تجاوز الحد المركزي (`240`) دون قص صامت |
| `accountingPolicy` | السياسة المحاسبية المعلنة | `cost_model \| fair_value_model \| unspecified` | إيضاح السياسات المحاسبية | تُسجل كما أفصحت الشركة دون افتراض معيار غير موثق |
| `aggregationLevel` | مستوى التجميع | `total_summary \| component_detail \| standalone_item \| unspecified` | بنية جدول الإيضاح العقاري | لا يُستبعد `component_detail` بالتصنيف وحده؛ يشترط احتواء موثق |
| `parentDisclosureId` | معرّف الإجمالي الأب | `string (نفس قاعدة الهوية) \| null` | ربط `component_detail` بـ `total_summary` حاضر ومتوافق | غياب الأب أو تعارضه حالة مراجعة تحجب الإجمالي المعتمد دون استبعاد صامت |
| `carryingValue` | القيمة الدفترية | `number >= 0 \| null` | قائمة المركز المالي / الإيضاح (وحدة أساسية) | `0 ≠ null`؛ تُرفض السالبة وغير المنتهية |
| `disclosedFairValue` | القيمة العادلة المُفصح عنها | `number >= 0 \| null` | إيضاح القيمة العادلة (وحدة أساسية) | `0 ≠ null`؛ لا تُستنتج أبداً من الدفترية |
| `fairValueDate` | تاريخ القيمة العادلة | `YYYY-MM-DD \| null` | تقرير المثمن / نص الإيضاح | يجب تطابقه مع `balanceSheetDate` للمقارنة |
| `fairValueStatementScope` | نطاق القيمة العادلة (إن انفصل) | `consolidated \| standalone \| unspecified \| null` | إيضاح القيمة العادلة | اختلافه عن `statementScope` يحجب المقارنة |
| `fairValueAssetScopeMatchesCarrying` | تطابق نطاق الأصول المقيمة | `boolean \| null` | نص الإيضاح | `true` = تطابق موثق؛ `false` = عدم تطابق؛ **`null` = غير موثّق ولا يُعامل أبداً كـ `true`** |
| `fairValueSource` | مصدر القيمة العادلة / جهة التقييم | `string (<=240) \| null` | اسم المثمن المستقل أو مرجع الإدارة | توثيق للتدقيق؛ يُرفض تجاوز الحد المركزي (`240`) دون قص صامت |
| `fairValueSourceType` | تصنيف مصدر التقييم | `independent_valuer \| management_estimate \| market_observable \| unspecified` | الإيضاح المتمم | يميز المثمن المستقل عن تقدير الإدارة |
| `footnoteReference` | رقم الإيضاح أو مرجعه | `string (<=160) \| null` | رقم وعنوان الإيضاح بالقوائم | مرجع مباشر؛ يُرفض تجاوز الحد المركزي (`160`) دون قص صامت |
| `explanatoryNote` | ملاحظة تفسيرية | `string (<=800) \| null` | المحلل / مدخل البيانات | توثيق القيود؛ يُرفض تجاوز الحد المركزي (`800`) دون قص صامت |
| `completenessStatus` | حالة الاكتمال وقابلية المقارنة | `complete_comparable \| documented_not_comparable \| partial_missing_fair_value \| partial_missing_carrying_value \| incomplete_missing_metadata \| unrecognized_classification` | مشتقة مركزياً بفصل المحاور الثلاثة | لا تُرجع `complete_comparable` أبداً عند حجب المقارنة |

---

## 5. فصل المحاور الثلاثة والدوال التفسيرية النقية (`src/core/domain/realEstateDisclosureAnalysis.ts`)
- **فصل المحاور الثلاثة دون تضارب (`deriveRealEstateDisclosureStatusBreakdown` + `evaluateRealEstateFairValueGap`):**
  1. **صحة البنية (`structuralValidityStatus`):** `valid | invalid` مع `structuralIssues` (صلاحية المعرّفات والأرقام والتواريخ والرموز المعتمدة).
  2. **اكتمال التوثيق (`documentationStatus` + `missingDocumentationFields`):** مستقل عن قابلية المقارنة (يميز بين التوثيق المكتمل وغياب القيمة العادلة/الدفترية أو نقص البيانات الوصفية بما فيها عدم توثيق `fairValueAssetScopeMatchesCarrying`).
  3. **قابلية المقارنة (`comparabilityStatus` + `comparable` + `blockingReasons`):** تتحقق فقط عند تطابق النطاق والتاريخ وتوثيق `fairValueAssetScopeMatchesCarrying === true` (ولا تُعامل `null` كـ `true`) وتوفر قيم صالحة؛ وعند اكتمال التوثيق مع حجب المقارنة (مثل اختلاف التاريخ أو النطاق أو `false` لنطاق الأصول) تكون النتيجة `documented_not_comparable` وليس `complete_comparable`.
- **حوكمة التجميع وعلاقات الاحتواء (`summarizeRealEstateDisclosures`):**
  - **كشف تكرار الهوية قبل أي جمع:** التكرار المطابق يُحسب مرة واحدة دون مضاعفة الأرصدة (`exact_duplicate_disclosure_id`)، بينما تكرار الهوية بقيم متعارضة يحجب التجميع المعتمد بسبب منظم (`conflicting_duplicate_disclosure_id`) دون اختيار أحد السجلين بصمت.
  - **لا استبعاد بالتصنيف وحده:** يُستبعد `component_detail` من الجمع **فقط** عند ثبوت علاقة احتواء موثقة عبر `parentDisclosureId` يشير إلى `total_summary` حاضر ومتوافق في الشركة والفترة وتاريخ المركز المالي ونطاق القوائم.
  - **حالات المراجعة عند الغموض:** غياب الأب (`missing_parent_disclosure`)، أو غياب مرجع الأب (`unresolved_component_parent`)، أو تعارض الأب (`conflicting_parent_disclosure`)، أو تداخل غير محسوم (`ambiguous_aggregation_overlap`) تحجب الإجمالي المعتمد مع إبقاء **جميع السجلات ظاهرة في `items`**.

---

## 6. حالة التنفيذ المرحلي وما تبقى للدفعات اللاحقة
1. **مسار الحفظ والتحديث الخادمي لسجل واحد (`مكتمل في الدفعة 42`):**
   - تنفيذ منطق المعاملة والتحقق والتزامن التفاؤلي وفحص الروابط المرجعية في الوحدة المشتركة المستقلة `src/core/contracts/realEstateDisclosureTransaction.ts` (ومتزامنة في `functions/src/shared/realEstateDisclosureTransaction.ts`).
   - ربط `operationType: 'real_estate_disclosure'` داخل `updateFinancialData` في `functions/src/index.ts` بإعادة استخدام فحص الصلاحيات القائم (`admin` و`data_entry` النشطين فقط)، وحساب `contentHash` (`computeRecordBusinessHash('real_estate_disclosure', ...)`) و`revision` و`completenessStatus` و`linkedQuarterlyDocId` خادمياً، وإلزام `precondition.expectedDocId` (معرّف السجل الأصلي قبل التعديل، دون استنتاجه من البيانات المعدّلة) مع `expectedRevision` أو `expectedContentHash` عند `mode="update"` لمنع تحويل تعديل سجل A إلى سجل B (`IDENTITY_MISMATCH` / `INCOMPLETE_PRECONDITION`)، ومنع الكتابة عند تطابق المحتوى (`status: 'unchanged'`, `wroteToDatabase: false`).
   - إضافة قاعدة `match /real_estate_disclosures/{disclosureId}` في `firestore.rules` (`allow read: if isDataEntry();` و`allow write: if false;`).
2. **القراءة والمزامنة التدريجية المركزية (`مكتمل في الدفعة 44`):**
   - إنشاء عقد القراءة والمحوّل غير المعدِّل ودامج التحديثات وبوابة الصلاحية والربط المرجعي الصادق على جانب القراءة في `src/core/domain/realEstateDisclosureRead.ts` (فصل تام بين `RealEstateDisclosureReadRecord` و`RealEstateDisclosureInput`، حفظ `docId`/`revision`/`contentHash`/حقول التدقيق و`0`/`null`/`false` والنصوص الكاملة والرموز غير المعروفة دون إسقاط صامت أو كتابة أثناء القراءة).
   - تسجيل `real_estate_disclosures` في البنية المركزية القائمة فقط (`indexedDbStore.ts`, `cacheService.ts`, `firestoreTransforms.ts`, `firestoreRepositories.ts`, `firestoreSync.ts`, `firestoreService.ts`, `firestoreSessionManager.ts`, `useFirestoreSession.ts`) بمؤشر دلتا مستقل (`realEstateDisclosures`) على `serverUpdatedAt` ونافذة التداخل `15_000ms` وتخزين ذري في IndexedDB مع منع تقديم المؤشر قبل نجاح الدمج والتخزين.
   - قصر القراءة والمزامنة والاشتراك على `admin` و`data_entry` النشطين فقط (مطابقاً لـ `firestore.rules`) دون بدء أي قراءة لغير المصرح لهم، وعزل أخطاء المجموعة عن بقية المجموعات، وحماية الجلسة والكاش النطاقي ضد الردود المتأخرة وتسجيل الخروج وتبديل الحساب وسحب الصلاحية، وإتاحة حالة الربط المرجعي الصادقة (`pending_source_confirmation` / `source_load_failed` قبل تأكيد `companies` و`quarterly_financial_records` دون قراءات N+1) مع بصمة حداثة `sourcesVersion`.
3. **واجهة الإدخال والمراجعة في مركز البيانات (`DataHubView` — دفعة لاحقة — لم تُنفّذ بعد):**
   - إضافة تبويب فرعي مستقل «الإفصاحات العقارية الموثقة» للأدمن ومدخلي البيانات يعرض جدول السجلات ونموذج الإدخال بالقوائم المنسدلة المركزية وحقل `fairValueAssetScopeMatchesCarrying` ثلاثي الحالة (`نعم` / `لا` / `غير موثق`) مع عرض المحاور الثلاثة وبطاقة **«فرق القيمة العادلة المُفصح عنها عن القيمة الدفترية»** دون إدخاله في التقييم أو Adjusted NAV.
4. **التصدير وإعادة الاستيراد عبر Excel والحذف/الحفظ الجماعي وتوصيل كتابة العميل إن لزم (دفعة لاحقة — لم تُنفّذ بعد):**
   - ورقة `Real_Estate_Disclosures` ومستورد متماثل يمر عبر `validateAndNormalizeRealEstateDisclosure` دون خلطها بأوراق التقييم.
5. **العزل التام عن التقييم:**
   - تبقى مخرجات هذه المرحلة معزولة تماماً عن `NetIncome` و`EPS` و`Equity` ومحرك التقييم والقيمة المركبة، ولا يُطرح `Adjusted NAV` إلا في مرحلة مستقلة لاحقة.
