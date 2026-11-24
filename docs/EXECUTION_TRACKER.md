# سجل متابعة استئناف العمل (MizanEX Execution Tracker)

آخر تحديث: 2026-11-21 — دفعة «توحيد أساس المتوسط المرجح للأسهم وأهلية AccountingEPS» (الدفعة 33 على أساس النسخة 32): (1) إنشاء العقد المركزي الموحد `src/core/contracts/weightedAvgSharesBasis.ts` (وإعادة تصديره في `src/core/contracts/index.ts` ومزامنته إلى `functions/src/shared/`) للرموز الخمسة المحفوظة (`ytd_weighted_avg`, `standalone_quarter`, `end_of_period_proxy`, `unadjusted_weighted_avg`, `unknown`) وتسمياتها العربية ومعانيها وحدود استخدامها وتوضيح أن `WeightedAvgShares_YTD` عدد أسهم كامل وليس ربحية سهم أو نسبة وأن نطاق الفترة لا يُثبت وحده تعديل أحداث رأس المال (`IsCapitalActionAdjusted`)، وتوحيد التحقق عبر الواجهة (`AddCompanyModal`, `EditQuarterlyRecordModal`) والمستورد (`parsers.ts`, `templates.ts`) والخادم (`records.ts`) مع حفظ القيم المحفوظة غير المعروفة دون تحويلها تلقائياً للخيار الأول؛ (2) إنشاء محرك القرار المركزي لأهلية AccountingEPS (`src/core/domain/accountingEpsEligibility.ts`) واستهلاكه مباشرة في `metricContracts.ts` للفترة الواحدة وTTM مع السماح بتكافؤ `Q1` المنفرد (`standalone_quarter`) مع `Q1` التراكمي عند توثيق تاريخي البداية والنهاية وعدم التعارض (للسنوات التقويمية وغير التقويمية والكبيسة) دون تغيير الرمز المحفوظ وإبراز الأساس الأصلي والفعلي، مع حجب `Q1` بلا تواريخ أو بتعارض، وحجب `standalone_quarter` لـ `Q2/Q3/FY` دائماً، وحجب `end_of_period_proxy`/`unadjusted_weighted_avg`/`unknown`/الفارغ/غير المعروف، والحفاظ التام على جميع حراسات `NetIncomeCommon` وTTM وأولوية EPS للتقييم؛ (3) تحديث العرض والتدقيق وروابط التعديل وتصدير `Metric_Audit` (`MetricAuditCard.tsx`, `ValuationSourcesCard.tsx`, `QuarterlyRecordsTable.tsx`, `excelExport.ts`) وإضافة 17 اختبار قبول وDOM جديداً (`tests/weightedAvgSharesBasisEligibility.test.ts` و`tests/weightedAvgSharesBasisUi.dom.test.ts`). الإجمالي: **251 اختباراً ناجحاً ضمن 42 مجموعة** مع تطابق كامل بين `src/core/contracts` و`functions/src/shared` وبناء ناجح للواجهة و`functions/` ونجاح `tsc --strict` على ملفات المحاكي الـ 5. **تنبيه مهم: تغيّرت `src/core/contracts/` و`functions/src/shared/` في هذه الدفعة (إضافة `weightedAvgSharesBasis.ts` وتحديث `records.ts` و`index.ts`)؛ ولا تتوفر Java Runtime (`spawnSync java ENOENT`) داخل هذه الحاوية لتشغيل `npm run test:emulator` فعلياً (رمز خروج `1`)، ولم تُنفّذ أي ترحيلات أو عمليات نشر أو كتابات على Firebase الإنتاجي.**

## 1. ما اكتمل في الدفعة الأولى (Batch 1)
1. **إصلاح أخطاء TypeScript في التصدير (`src/utils/excelExport.ts`):**
   - معالجة `rimAudit.fadeSchedule` و`rimAudit.consistencyChecksAr` بدون تأكيدات نوعية قسرية، والتمييز بين البيانات غير المتاحة والقائمة الفارغة.
2. **استعادة سلامة الاختبارات ومزامنة العقود وبناء Cloud Functions والواجهة.**

## 2. ما اكتمل في الدفعة الثانية (Batch 2)
1. **ربط المصدر الرسمي الوحيد للقطاعات (`sectorPE`) عبر التطبيق** وحوكمة تعطيل وحذف القطاعات (`sectorMutations.ts` + `SectorGovernanceActionModal.tsx` + `AdminDashboard.tsx`).
2. **استكمال إدخال وعرض الحقول المحاسبية والفترية (`AddCompanyModal` و`DataHub`)** مع `tests/batch2GovernanceUi.test.ts`.

## 3. ما اكتمل في الدفعة الثالثة (Batch 3)
1. **توحيد عقد معاملات RIM**، وتعزيز محرك RIM والتدقيق الحسابي (`valuation.ts`)، وطبقة العرض (`rimPresentation.ts` + `RimAuditSection.tsx`) وتصدير `RIM_Audit` في `excelExport.ts` مع `tests/batch3RimUiExport.test.ts`.

## 4. ما اكتمل في دفعة إصلاح سلامة ارتباط الشركات بالقطاعات (Sector Linkage Integrity Fix)
1. **حسم ارتباط الشركة بالقطاع كـ Single Source of Truth (`sectorLinkage.ts`, `sectorRegistry.ts`, `securityIdentity.ts`, `legacyMigrationTool.ts`, `useFirestoreSession.ts`, `AdminDashboard.tsx`).**
2. **السلامة المرجعية المركزية في الخادم (`validateAndCanonicalizeCompanySectorWrite`)** وتحصين إعادة الإسناد والحذف متعدد الدفعات (`sectorMutations.ts`).

## 5. ما نُفّذ في دفعة اختبارات الصلاحيات ومشغّل المحاكي
1. **تصحيح تشخيص القاموس الفارغ للقطاعات (`explicit_unconfirmed_registry` مقابل القاموس الفارغ المؤكد `[]`).**
2. **إعادة بناء اختبارات المحاكي المعزولة (`tests/emulator/*`) وتصحيح اختبارات `users/{userId}` (`id` بدل `uid`) و`admins/{adminId}`.**
3. **تطوير مشغّل المحاكي متعدد المنصات (`scripts/runFirestoreEmulatorTests.mjs` + `tests/emulatorRunner.test.ts`).**

## 6. ما نُفّذ في دفعة إغلاق قابلية التثبيت وتصحيح التعليمات والتشخيص
1. **إصلاح قابلية التثبيت عبر المنصات (`package.json`, `package-lock.json`)** وحسم متطلبات Node.js (`>=24.12.0` للتطوير والاختبار مقابل `22` لـ Cloud Functions).
2. **تصحيح توثيق RIM ورسالة غياب `RIM_Retention`** (`README.md`, `dividendAnalytics.ts`, `valuation.ts`, `rimPresentation.ts`, `batch3RimUiExport.test.ts`).

## 7. ما نُفّذ في دفعة ضبط إدخال وعرض المعاملات العامة بلوحة المدير
1. **وحدة مركزية لعرض وإدخال والتحقق من المعاملات العامة (`macroParameterInput.ts`)** وتطبيقها على التعديل والإضافة في `AdminDashboard.tsx`.

## 8. ما نُفّذ في دفعة سلامة عقد نوع المعاملات عبر الحفظ والقراءة وحماية الدقة العددية (النسخة 23)
1. **العقد المركزي لنوع المعامل وموحدية مسار الحفظ والقراءة (`parameterTypeContract.ts`, `parameterPersistence.ts`, `records.ts`, `hashing.ts`, `functions/src/index.ts`, `firestoreWriters.ts`, `firestoreTransforms.ts`, `AdminDashboard.tsx`).**
2. **حماية الدقة العددية (`macroParameterInput.ts`)** بإزالة `toPrecision(12)` و`toFixed(10)` واستخدام الإزاحة العشرية النصية بالأساس 10.

## 9. ما نُفّذ في دفعة إكمال عقد استيراد وتصدير المعاملات (النسخة 24)
1. **العقد المركزي الموحد لأعمدة `All_Parameters.xlsx` (`src/core/contracts/parameterExcelContract.ts`)** ومواءمة المستورد والمعاينة والحمولة والقالب والتصدير مع `tests/parameterExcelImportExport.test.ts` (8 اختبارات).

## 10. ما نُفّذ في دفعة حماية مسودات المعاملات العامة وسلامة حفظها (`macro_params` — النسخة 25)
1. **متحكم مسودات مركزي وحماية التعديلات المحلية (`macroParameterDraftController.ts`, `AdminDashboard.tsx`, `App.tsx`)** مع التمييز الصريح بين `serverRecord` و`baseRecord` و`draft` وحماية التبويبات/المغادرة/`beforeunload`.
2. **التحكم التزامني التفاؤلي الذري في الخادم (`records.ts`, `parameterPersistence.ts`, `parameterTransaction.ts`, `functions/src/index.ts`)** ودمج الحالة والكاش بالمفتاح (`useFirestoreSession.ts`, `cacheService.ts`, `firestoreWriters.ts`).

## 11. ما نُفّذ في دفعة إغلاق فجوات حماية حفظ `macro_params` (الدفعة الحالية — تحصين النسخة 25)
1. **إلزام شرط النسخة على الخادم لكتابات `macro_params` (`records.ts`, `parameterPersistence.ts`, `firestoreWriters.ts`, `useFirestoreSession.ts`, `AdminDashboard.tsx`, `ValuationView.tsx`):**
   - رفض أي كتابة `scope === 'global'` بدون `precondition` عبر طبقتين (في `validateParameterRecords` وأيضاً كدفاع عميق داخل المعاملة في `verifyParameterPreconditions` برمز `MISSING_PRECONDITION` و`INCOMPLETE_PRECONDITION`) دون استنتاج نسخة الأساس من قراءة خادمية أحدث أو التحويل لتخطٍ صامت.
   - الإبقاء على `scope === 'company'` اختياري الشرط كما هو حالياً، مع توثيق الاستثناءات المتبقية صراحةً (`delete_parameter`، و`backfill_server_timestamps`، وتجزئة استيراد Excel فوق 240 صفاً).
2. **عزل الردود المتأخرة بالجلسة ومعرف الطلب (`(userScopeKey, requestId)`):**
   - ربط كل عملية حفظ أو إنشاء بهوية الجلسة ومعرف طلب ثابت في `macroParameterDraftController.ts` (بما في ذلك `prepareCreateParamSubmission`) و`FirestoreSessionManager` و`CacheService` (`expectedScopeKey`) و`firestoreWriters.ts` و`firestoreSync.ts` و`useFirestoreSession.ts` (`activePersistReqIdRef`) و`AdminDashboard.tsx` و`ValuationView.tsx` و`App.tsx`.
   - تجاهل أي نجاح أو فشل متأخر بعد تغيّر المستخدم/الجلسة أو تجاوز الطلب دون تغيير المسودات أو حالة React أو الكاش أو الإشعارات أو أقفال `saving`/`isSaving`.
   - **توضيح دلالي صريح:** تجاهل الرد المتأخر محلياً يمنع تلويث الجلسة الجديدة أو الحالة الحالية، لكنه **لا يلغي** كتابة خادمية قد تكون وصلت بالفعل واكتملت في Firestore قبل تبديل الجلسة.
3. **قاعدة التوافق الرتيب للنسخ وعدم إحياء المحذوف (`reconcileIncomingMacroParameterVersion`):**
   - توحيد القاعدة في `parameterPersistence.ts` وتطبيقها عبر `macroParameterDraftController.ts` و`FirestoreSessionManager` و`CacheService`.
   - منع أي تأكيد أو لقطة بإصدار أقدم (مثل `revision=2` بعد `revision=3`) أو غير موثق الإصدار من التراجع عن نسخة أحدث أو إزالة `conflict` أو تحويل الصف إلى `clean`؛ ومنع أي تأكيد `update` قديم من إعادة إحياء معامل محذوف (`deleted_on_server` / `deletedMacroKeys` / `macro_params_deleted_keys`) بينما يظل الإنشاء الصريح `mode: 'create'` قادراً على إنشائه من جديد.
4. **اختبارات القبول والمحاكي:**
   - توسيع `tests/macroParameterDraftConcurrency.test.ts` إلى **15 اختباراً** تغطي إلزام الشروط المسبقة، عزل الردود المتأخرة (نجاح وفشل) عبر تبديل المستخدمين ومعرفات الطلبات، التوافق الرتيب ومنع التراجع عن `rev=3` بواسطة `rev=2` أو سجل غير موثق، وعدم إحياء المحذوف.
   - توسيع `tests/emulator/macroParamConcurrency.emulator.test.ts` إلى **6 اختبارات** تضيف التحقق من رفض الكتابة العامة بدون شرط ورفض شرط `update` الناقص على معاملة Firestore الحقيقية.

## 12. ما نُفّذ في دفعة حتمية نتيجة الحفظ والتنقل (الدفعة الحالية)
1. **إزالة الأثر الجانبي داخل محدّث الحالة وتوحيد نتيجة الحفظ الحتمية (`src/core/domain/macroParameterDraftController.ts`):**
   - إضافة عقد النتيجة الحتمي `MacroParamSaveOutcome` الذي يفصل صراحةً بين: `serverWriteSucceeded` (نجاح الكتابة على الخادم)، و`appliedToCurrentSession` (قبول التأكيد في الجلسة والطلب النشط مقابل `ignored_stale`)، و`hasRemainingUnsavedChanges` (وجود تعديلات محلية أحدث كُتبت أثناء انتظار الطلب)، و`hasBlockingIssues`، و`safeToLeave` (الإذن الحتمي بالمغادرة)، و`shouldShowSuccessNotice`.
   - إضافة الدوال النقية القابلة لإعادة التنفيذ `evaluateSaveSuccessTransition` و`evaluateSaveFailureTransition` و`evaluateBlockedDirtySaveOutcome`، ومخزن المصدر الوحيد للحالة `createMacroParamDraftStore` المتوافق مع `useSyncExternalStore` دون أي `setTimeout` أو `flushSync` لإخفاء السباق ودون أي مصدر حالة موازٍ.
2. **تصحيح مسار الحفظ والتنقل (`src/modules/admin/AdminDashboard.tsx`, `src/App.tsx`):**
   - استبدال `useState` + `draftStateRef` وتعديل `appliedCleanly` داخل محدّث `setDraftState` بـ `createMacroParamDraftStore` + `useSyncExternalStore`؛ أصبح `handleSaveDirtyParams` و`handleAddNewParam` يعتمدان مباشرة على `MacroParamSaveOutcome` الحتمي لإظهار إشعار واحد أو خطأ أو تجاهل صامت للردود القديمة دون تسجيلها كفشل.
   - تحديث `MacroDraftNavigationGuard.saveDirtyDrafts()` ليعيد `Promise<MacroParamSaveOutcome>` وتقييد «حفظ التعديلات والمتابعة» (داخل `AdminDashboard` للتبويبات، وفي `App.tsx` لمغادرة لوحة الإدارة وتسجيل الخروج) بشرط `outcome.safeToLeave === true` مع التحقق من الجلسة النشطة وعدم وجود مسودات أحدث.
3. **اختبارات DOM تفاعلية حقيقية (`tests/adminMacroSaveNavigation.dom.test.ts` + `happy-dom` في `package.json`/`package-lock.json`):**
   - إضافة 8 اختبارات تفاعلية عبر `happy-dom` و`react-dom/client` (`createRoot`) و`React.act` تغطي: الحفظ الناجح وإشعاراً واحداً، «حفظ ومتابعة» الداخلي والخارجي وتسجيل الخروج، فشل الحفظ وبقاء المسودة، التعديل الجديد أثناء الطلب وعدم المغادرة فوقه، التحديث الخادمي الأحدث أثناء الطلب، تبديل المستخدم والردود المتأخرة (نجاح وفشل دون تسجيل فشل)، والتشغيل تحت `<React.StrictMode>` دون تكرار الحفظ أو الإشعارات.

## 13. ما نُفّذ في دفعة ضبط تعريف فترة `ReportedEPS` ومطابقتها الزمنية (ما بعد النسخة 27)
1. **العقد المركزي الوحيد (`src/core/contracts/reportedEpsPeriod.ts` المزامَن إلى `functions/src/shared/`):**
   - تمثيل مهيكل صريح عبر 5 حقول (`reportedEpsPeriodType`, `reportedEpsFiscalYear`, `reportedEpsFiscalQuarter`, `reportedEpsPeriodStart`, `reportedEpsPeriodEnd`) بالإضافة إلى `reportedEpsPeriod` المشتق تلقائياً للعرض فقط.
   - 5 رموز داخلية ثابتة مقترنة بمسميات عربية مقيدة: `standalone_quarter` («ربع مالي منفرد»)، `ytd` («تراكمي منذ بداية السنة المالية YTD» — `Q1..Q3` فقط مع رفض `Q4`)، `fy` («سنة مالية كاملة FY»)، `ttm` («آخر 12 شهراً TTM»)، `needs_review` («غير محدد / يحتاج مراجعة»).
   - تحقق مركزي مشترك بين الواجهة والخادم (`records.ts`) وحماية بصمة الأعمال (`hashing.ts`) دون افتراض بداية السنة في 1 يناير ودون استنتاج النوع من عدد الأيام وحده ودون تحويل أو تسنين قيمة `ReportedEPS`.
2. **إصلاح التصنيف ومحرك المطابقة الزمنية (`src/core/domain/metricContracts.ts`, `src/utils/financialCalculations.ts`, `src/core/domain/valuationAssumptions.ts`):**
   - إصلاح `parseReportedEpsPeriodMeta`: `Q3 2026 standalone` و`Q4 2026 standalone` تُصنفان كـ `standalone_quarter` ولا تُفسَّران أبداً كـ `YTD` أو `FY`.
   - حجب مقارنة `ReportedEPS` مقابل `AccountingEPS` فقط عند اختلاف النوع أو حدود التواريخ الموثقة (مثل `Q3 standalone` مقابل `Q3 YTD`، `Q4 standalone` مقابل `FY`، أو `FY` مقابل `TTM` بحدود مختلفة) دون تعطيل نماذج التقييم.
   - السماح بتداخل حدود `Q1 standalone` مع `Q1 YTD` فقط عند تطابق تاريخي البداية والنهاية الموثقين، **دون** إعادة تصنيف `standalone_quarter` إلى `ytd`، مع دعم السنة المالية يوليو–يونيو والسنوات الكبيسة (`366` يوماً و`29 فبراير`).
3. **واجهة الإدخال المقيدة والجدول وبطاقة التدقيق (`ReportedEpsPeriodFieldset.tsx`, `EditQuarterlyRecordModal.tsx`, `AddCompanyModal.tsx`, `QuarterlyRecordsTable.tsx`, `MetricAuditCard.tsx`):**
   - استبدال النص الحر بقائمة عربية مقيدة مستمدة مباشرةً من العقد المركزي، وفتح السجلات القديمة الغامضة صراحةً على `needs_review` مع تنبيه المراجعة والنص الموروث دون اختيار افتراضي تشغيلي.
4. **قوالب واستيراد وتصدير Excel ومعاينة البيانات القديمة (`templates.ts`, `parsers.ts`, `excelExport.ts`, `legacyMigrationTool.ts`, `AdminDashboard.tsx`):**
   - إضافة الأعمدة الخمسة المهيكلة إلى القالب والمستورد والمصدّر (مع تصحيح fallback عمود `YearQuarter` في `buildQuarterlyRecordsWorkbook` لضمان دورة التصدير وإعادة الاستيراد بلا فقدان)، ووسم النصوص القديمة الغامضة عند الاستيراد بـ `needs_review` مع تحذير دون اختلاق تواريخ.
   - إضافة معاينة `reportedEpsPeriodAudit` (قراءة فقط `Dry-Run`) إلى تقرير الفحص في `legacyMigrationTool.ts` وواجهة معاينة الفحص في `AdminDashboard.tsx` دون تنفيذ أي ترحيل على الإنتاج.
5. **اختبارات القبول والواجهة التفاعلية:**
   - إضافة `tests/reportedEpsPeriodContract.test.ts` (**12 اختباراً**) و`tests/reportedEpsPeriodUi.dom.test.ts` (**3 اختبارات DOM تفاعلية** عبر `happy-dom` + `react-dom/client` + `React.act`).

## 14. ما نُفّذ في دفعة إغلاق فجوات تفسير فترة `ReportedEPS` وتوحيد تحقق الكتابة (ما بعد النسخة 28)
1. **منع التحويل غير الآمن للنصوص القديمة (`src/core/contracts/reportedEpsPeriod.ts` المزامَن إلى `functions/src/shared/`):**
   - إضافة فحص صريح للإشارات الزمنية المضمنة (`inspectLegacyPeriodTextSignals` + `describeEmbeddedTemporalConflict`): رصد تواريخ ISO (`YYYY-MM-DD`)، التواريخ الرقمية (`DD/MM/YYYY`)، الشهر-السنة (`YYYY-MM`)، السنوات المالية المزدوجة (`2025/2026`, `2025-2026`)، أسماء الأشهر العربية والإنجليزية، تعدد السنوات، والأقواس أو أسهم النطاقات أو محددات النهاية (`ended/ending/حتى/إلى/المنتهية`).
   - حصر `unambiguous_convertible` على الرموز القياسية العارية الصريحة (`FY 2025`, `Q3 2026 YTD`, `Q1 2026 standalone` عند التطابق التام) مع حدود موثقة مطابقة على السجل؛ وأي نص يحمل تواريخ أو نطاقات أو مؤشرات إضافية أو متعارضة (مثل `FY 2026 (2025-07-01 → 2026-06-30)` أو `Q3 2026 YTD (ended 2026-06-30)`) يُصنّف فوراً كـ `needs_review` مع سبب تعارض واضح وإجراء تصحيحي، دون استبدال تواريخ النص بتواريخ السجل ودون إعادة تحليل نص العرض المشتق كمصدر مهيكل موازٍ.
   - الحفاظ على النص القديم الأصلي وقيمة `ReportedEPS` الرقمية دون تعديل، وإظهار سبب التعارض والإجراء التصحيحي في معاينة الاستيراد (`parsers.ts`), ونافذة التعديل (`EditQuarterlyRecordModal.tsx`), وتقرير المراجعة `Dry-Run` (`auditLegacyReportedEpsRecord` و`legacyMigrationTool.ts`).
2. **توحيد قاعدة تحقق الكتابة للمدخلات الجديدة وحماية `0` والقيم السالبة (`reportedEpsPeriod.ts`, `records.ts`, `parsers.ts`, `EditQuarterlyRecordModal.tsx`, `AddCompanyModal.tsx`, `legacyDpsCleanup.ts`):**
   - تعريف دالة `hasExplicitReportedEpsValue` وقاعدة الكتابة المركزية داخل `validateAndNormalizeReportedEpsPeriod` و`resolveImportedReportedEpsPeriod`؛ أي قيمة `ReportedEPS` صالحة (بما فيها `0` والقيم السالبة) لا تُقبل بفترة فارغة عند الكتابة الجديدة في النوافذ أو `validateRecords`، وتُصنَّف في مستورد Excel صراحةً كـ `needs_review` مع تحذير واضح في المعاينة قبل الحفظ دون اختيار فترة تشغيلية تلقائياً.
   - إزالة التحقق المكرر المنفصل من `AddCompanyModal.tsx` و`EditQuarterlyRecordModal.tsx` للاعتماد الحصري على العقد المركزي، مع فتح السجلات القديمة ذات `ReportedEPS` بدون فترة صراحةً على `needs_review` وتنبيه مراجعة واضح.
   - الحفاظ الكامل على توافق القراءة للسجلات القديمة في Firestore (عبر `resolveCanonicalReportedEpsPeriod` وخيار `legacyCompatibilityMode: true` في `legacyDpsCleanup.ts`)، وضمان أن غموض الفترة يحجب مقارنة `ReportedEPS` فقط ولا يؤثر على نماذج التقييم المستقلة (`Relative`, `Graham`, `RIM`, `DCF`).
3. **الاختبارات وتصحيح اختبار سابق:**
   - تصحيح خطأ ترتيب وسائط في اختبار سابق داخل `tests/reportedEpsPeriodContract.test.ts` (كان يستدعي `validateRecords('quarterly', [...])` بدل `validateRecords([...], true)` مما جعل `assert.throws` يلتقط خطأ نوع الدفعة بدل خطأ فترة `ReportedEPS`) مع إضافة تحقق صريح على نص الخطأ.
   - إضافة 6 اختبارات قبول في `tests/reportedEpsPeriodContract.test.ts` + اختبارَي DOM تفاعليين في `tests/reportedEpsPeriodUi.dom.test.ts` ليصل الإجمالي إلى **221 اختباراً ناجحاً ضمن 35 مجموعة**.

## 15. نتائج الفحوص الفعلية (مفصولة وبشفافية تامة)
- **بيئة التنفيذ الفعلية في هذه الحاوية:** Linux `x64` · Node.js `v22.23.2` · npm `10.9.8`.
- **أ) الفحوص والاختبارات العادية والتفاعلية (`npm run check` + `diff -rq` + `compile_applet` + `lint_applet`):**
  - `sync:shared` ✅ · تطابق `src/core/contracts` مع `functions/src/shared` (`diff -rq` = `PARITY_OK`) ✅ · `lint` (`tsc --noEmit`) ✅ · `test` ✅ (**221 اختباراً ضمن 35 مجموعة: 221 ناجح، 0 فاشل، 0 متجاوز**) · `vite build` ✅ · `functions` (`npm run build`) ✅ · `tsc --strict` على جميع ملفات `tests/emulator/*.emulator.test.ts` الـ 4 ✅.
- **ب) اختبارات محاكي Firestore الفعلي (`npm run test:emulator`) — متوقفة بعائق بيئي (`BLOCKER`):**
  - ❌ رمز الخروج **`1`**: `Java Runtime: MISSING (spawnSync java ENOENT)` مع توفر `firebase CLI 15.34.1` — لم تُسجّل كناجحة.
- **ج) حدود التحقق:**
  - الاختبارات التفاعلية نُفّذت في بيئة DOM حقيقية (`happy-dom` + `react-dom/client` + `React.act`) دون اتصال بـ Firebase الإنتاجي؛ ولم تُنفَّذ في متصفح كامل (Chromium/Playwright)، ولم تُشغّل اختبارات محاكي Firestore الفعلي لغياب Java في الحاوية.

## 16. حالة `functions/` والعقود المشتركة والعناصر المؤجلة (دفعة النسخة 29)
- **هل تغيرت `functions/` أو العقود المشتركة (`src/core/contracts/`) في هذه الدفعة؟** **نعم** — عُدّلت `src/core/contracts/reportedEpsPeriod.ts` و`src/core/contracts/records.ts` وتمت مزامنتها إلى `functions/src/shared/` والتحقق من التطابق وبناء `functions/` بنجاح.
- **عناصر مؤجلة (خارج نطاق هذه الدفعة):**
  - أي ترحيل فعلي أو كتابة جماعية على بيانات الإنتاج في Firestore.
  - تشغيل `npm run test:emulator` على بيئة تتوفر فيها **Node.js `>=24.12.0`** و**Java 17+**.
  - لم يتم تنفيذ أي نشر أو ترحيل أو تعديل على بيانات Firebase الإنتاجية.

## 17. ما نُفّذ في دفعة اتساق حفظ فترة `ReportedEPS` بين المصدر والإسقاط والبصمة (النسخة 30)
1. **إغلاق فجوة تحقق الكتابة (`allowLegacyPeriodTextOnly`):**
   - **السبب الجذري:** كان `validateRecords` في `src/core/contracts/records.ts` يمرّر `allowLegacyPeriodTextOnly: true` دائماً حتى في الكتابة الجديدة، مما يسمح بقبول `ReportedEPS` مع `reportedEpsPeriod` كنص حر دون `reportedEpsPeriodType`، بعكس عقد الواجهة وتصنيف المستورد (`needs_review`).
   - **الإصلاح (`src/core/contracts/reportedEpsPeriod.ts`, `src/core/contracts/records.ts` المزامَنان إلى `functions/src/shared/`):**
     - ربط `allowLegacyPeriodTextOnly` و`requirePeriodWhenEpsPresent` حصراً بـ `options?.legacyCompatibilityMode === true` (المحصور في الفحص الداخلي أو الإبقاء على حقول قديمة غير ملموسة عند تحديث حقول غير مرتبطة، دون إتاحة أي خيار تجاوز للعميل).
     - إلزام الكتابة الجديدة لأي `ReportedEPS` (موجب أو `0` أو سالب) بتعريف مهيكل صالح أو `needs_review` صريح، ورفض النص الحر بدون `reportedEpsPeriodType`.
     - إخراج جميع حقول الفترة الستة (`REPORTED_EPS_PERIOD_FIELDS`) بقيم صريحة (`null` للحقول الممسوحة/غير المطبّقة) عند التحقق.
2. **معالجة بقاء حقول الفترة القديمة وتباعد المصدر والإسقاط والبصمة:**
   - **السبب الجذري:** في مسار `quarterly_record` (`applyStockAndQuarterAtomicWrite`) ومسار `bulk_quarterly` في `functions/src/index.ts`، كانت الكتابة الجزئية تحسب `financialProjection` و`contentHash` من الحمولة الجزئية الواردة قبل دمجها مع المستند الحالي في `quarterly_financial_records`، وتكتب `quarterly_financial_records` بـ `{ merge: true }` دون قراءته مسبقاً، مما يترك حقول `ytd` القديمة عالقة في المصدر ويكتب `null` في `financials` ويخزّن بصمة غير مطابقة للمستند النهائي. كما كان `ReportedEpsPeriodFieldset.tsx` يحتفظ بحقول السنة/النص المشتق عند التحويل إلى `needs_review`.
   - **الإصلاح (`src/core/contracts/records.ts`, `functions/src/index.ts`, `src/shared/ui/ReportedEpsPeriodFieldset.tsx`):**
     - إنشاء وحدة دمج وتحقق وإسقاط وبصمة موحّدة `resolveQuarterlyRecordWrite` وإدخال `QuarterlyValidationError` و`applyBulkQuarterlyWrites` مع تحديث `applyStockAndQuarterAtomicWrite` بحيث يستخدم مسارا الكتابة المفرد (`quarterly_record`) والجماعي (`bulk_quarterly`) نفس المنطق الحتمي تماماً دون تغيير معرّفات المستندات أو إنشاء مصدر حقيقة موازٍ.
     - تعريف عقد المفتاح المحذوف (`undefined`/غائب) مقابل `null` الصريح:
       - الحقول المالية غير المرتبطة بـ `ReportedEPS`: المفتاح الغائب يحافظ على قيمة المستند الحالي، و`null` الصريح يمسحه (وعند تغيير `periodStartDate`/`periodEndDate` مع حذف `periodDays` يُعاد حساب `periodDays` بدقة).
       - مجموعة حقول `ReportedEPS` الثمانية (`REPORTED_EPS_FIELD_GROUP`): عدم لمس أي مفتاح منها يحافظ عليها كما هي (بما يشمل التوافق على السجلات القديمة غير الملموسة)؛ لمس أي من حقول الفترة الستة يستبدلها ذرياً بالكامل (الحقول الغائبة تصبح `null` صريحاً)؛ تصفير `reportedEps: null` يمسح حقول الفترة والمصدر غير المحددة؛ وتعديل `reportedEps`/`reportedEpsSource` فقط يُتحقق منه بصرامة ضد فترة السجل الحالية دون قبول النص الحر.
     - حساب `projection = financialProjection(finalRecord)` و`contentHash = computeRecordBusinessHash('quarterly', finalRecord)` من **المستند النهائي المدمج والمتحقق منه فقط**، وكتابتهما معاً بنفس البصمة في `quarterly_financial_records` و`financials`، وتخطي الكتابة عند تطابق البصمة في المصدر والإسقاط (`skippedUnchangedCount`).
     - تحديث `ReportedEpsPeriodFieldset.tsx` لتصفير السنة والربع وتواريخ البداية والنهاية صراحةً إلى `null` عند التحويل إلى `needs_review`.
     - تمرير أخطاء `QuarterlyValidationError` كـ `HttpsError('invalid-argument', ...)` في `functions/src/index.ts`.
3. **الاختبارات والملفات المعدّلة:**
   - إضافة 5 اختبارات قبول شاملة في `tests/reportedEpsPeriodContract.test.ts` (دفعة 30) تغطي الرفض الصارم للنص الحر، التحديث الجزئي إلى `needs_review`، تبديل أنواع الفترات، تصفير `reportedEps: null`، التحديثات غير المرتبطة، تطابق المفرد والجماعي، وتخطي الإعادة المتطابقة.
   - إضافة ملف اختبارات محاكي Firestore الحقيقي `tests/emulator/reportedEpsWriteConsistency.emulator.test.ts` وتسجيله في `scripts/runFirestoreEmulatorTests.mjs` (`all` و`reported_eps`) لتنفيذ `applyStockAndQuarterAtomicWrite` (داخل `db.runTransaction`) و`applyBulkQuarterlyWrites` (مع `db.getAll` + `db.batch().commit()`) ضد محاكي Firestore.
   - تحديث سجلي اختبار قديمين سابقين للنسخة 28 (`tests/batch2GovernanceUi.test.ts` سطر 762 و`tests/metricAuditAndRim.test.ts` سطر 151) لإضافة حقول فترة `FY 2025` المهيكلة لتوافقهما مع تحقق الكتابة الموحّد (دون تعديل أي اختبار توافق قراءة قديم).

## 18. نتائج الفحوص الفعلية للدفعة 30 (بشفافية تامة)
- **أ) الفحوص والاختبارات العادية والتفاعلية (`npm run check` + `diff -rq` + `tsc --strict` على ملفات المحاكي):**
  - `sync:shared` ✅ · تطابق `src/core/contracts` مع `functions/src/shared` (`diff -rq` = `PARITY_OK`) ✅ · `lint` (`tsc --noEmit`) ✅ · `test` ✅ (**226 اختباراً ضمن 36 مجموعة: 226 ناجح، 0 فاشل، 0 متجاوز**) · `vite build` ✅ · `functions` (`npm run build`) ✅ · `tsc --strict` على جميع ملفات `tests/emulator/*.emulator.test.ts` الـ 5 (`EMULATOR_TSC_OK`) ✅.
- **ب) اختبارات محاكي Firestore الفعلي (`npm run test:emulator`) — متوقفة بعائق بيئي (`BLOCKER`):**
  - ❌ رمز الخروج **`1`**: `Java Runtime: MISSING (spawnSync java ENOENT)` مع توفر `firebase CLI 15.34.1` — لم تُسجّل كناجحة.
- **ج) حالة `functions/` والعقود المشتركة وحدود التحقق:**
  - **تغيّرت `src/core/contracts/` و`functions/src/index.ts` و`functions/src/shared/`** في هذه الدفعة وتمت مزامنتها وبناؤها بنجاح.
  - لم تُشغّل اختبارات محاكي Firestore الفعلي داخل هذه الحاوية لغياب Java Runtime، ولم يُنفّذ أي ترحيل أو نشر أو كتابة على Firebase الإنتاجي.

## 19. ما نُفّذ في دفعة تحصين الكتابة الربع سنوية ضد فقد التحديثات واختلاف المحتوى والبصمات (الدفعة 31)
1. **منع فقد التعديل المتزامن في `bulk_quarterly` (`src/core/contracts/records.ts`, `src/core/contracts/sectorAdminPort.ts`, `functions/src/index.ts`):**
   - **السبب الجذري:** كان مسار `bulk_quarterly` يقرأ السجلات الحالية خارج أي معاملة عبر `fetchExistingMap` ثم يدمج ويحفظ عبر `db.batch().commit()`، ما يسمح لحفظ فردي متزامن (`quarterly_record` يغيّر `revenueYTD` إلى `200`) بالضيعان فور التزام دفعة الاستيراد بنسخة مدمجة قديمة (`revenueYTD: 100`).
   - **الإصلاح:**
     - إضافة `validateBulkQuarterlyRequestEnvelope` و`executeBulkQuarterlyTransaction` في `src/core/contracts/records.ts` و`createFirestoreAdminBulkQuarterlyTransactionPort` في `src/core/contracts/sectorAdminPort.ts` وتفعيلها داخل `functions/src/index.ts`.
     - تنفيذ القراءة (`tx.getAll`) والدمج والتحقق وحساب البصمة والإسقاط والكتابة لمستندات `quarterly_financial_records` و`financials` وسجل `import_batches` داخل **معاملة Firestore واحدة ذرية (`db.runTransaction`)** تعيد القراءة وإعادة الدمج والحساب تلقائياً عند التعارض.
     - الحفاظ على الحد الآمن المعتمد (`IMPORT_SAFE_CHUNK_SIZES.quarterly = 180`، أي بحد أقصى `180 * 2 + 1 = 361 <= 500` عملية) ورفض أي دفعة تتجاوزه صراحةً (`QuarterlyValidationError`) دون تقسيم صامت إلى معاملات جزئية.
2. **توحيد سياسة دمج الخرائط المتداخلة ومطابقتها الحتمية مع `contentHash` (`src/core/contracts/hashing.ts`, `src/core/contracts/records.ts`, `src/core/contracts/sectorAdminPort.ts`, `functions/src/index.ts`):**
   - **السبب الجذري:** عند دمج خريطة متداخلة مثل `extendedFields` (الموجود `{ a: 1, b: 2 }` والوارد `{ a: 9 }`) كان `resolveQuarterlyRecordWrite` يحسب `contentHash` على `{ a: 9 }` بينما يكتب `{ merge: true }` في Firestore الخريطة المدمجة `{ a: 9, b: 2 }`.
   - **الإصلاح:**
     - تعريف العقد المركزي `QUARTERLY_NESTED_MAP_FIELDS` (`extendedFields`, `originalValues`, `manualCorrections`) ودالة `mergeQuarterlyNestedMap`:
       - الغياب (`undefined`) يحافظ على الخريطة الموجودة دون تعديل.
       - الكائن العادي (`{}` أو `{ k: v }`) ينفذ دمجاً غير هدّام على مستوى المفاتيح بحيث تحفظ المفاتيح غير المذكورة ولا يُعامل `{}` كمسح (وعند عدم وجود مفاتيح نهائية تُطبع الخريطة الفارغة إلى `null`).
       - `null` الصريح على مستوى الخريطة كاملةً يمسح الخريطة إلى `null`.
       - حذف مفتاح واحد: في `extendedFields` (يدعم الدمج العودي للكائنات المتداخلة) و`manualCorrections` يحذف `null` الصريح على المفتاح ذلك المفتاح فقط؛ أما في `originalValues` فيُحفظ `null` الصريح كقيمة أصلية صالحة للحقل ويُمسح الكل فقط عند `originalValues: null`.
       - أي قيمة ليست كائناً عادياً أو `null`/`undefined` (مثل مصفوفة أو عدد أو نص) تُرفض عبر `QuarterlyValidationError`.
     - كتابة المستند المدمج النهائي الكامل لمجموعتي `quarterly_financial_records` و`financials` عبر استبدال كامل ذري داخل المعاملة (`merge: false` → `tx.set(ref, payload)` بدون `{ merge: true }`) مع الإبقاء على `merge: true` لـ `companies` و`import_batches`، بحيث يتطابق المخزّن في Firestore حرفياً مع `contentHash` و`projectionHash` وتُطبّق عمليات حذف المفاتيح ومسح الخرائط فعلياً.
3. **إصلاح تخطي إسقاط `financials` المنحرف دون المساس بالمصدر الصالح (`src/core/contracts/hashing.ts`, `src/core/contracts/records.ts`):**
   - **السبب الجذري:** اعتمد قرار التخطي `isUnchanged` على مساواة `existingFinancialDoc.contentHash === contentHash` وحدها؛ فإذا انحرف حقل أعمال داخل `financials` (مثل `reportedEps: 999` مقابل `2` في المصدر) مع بقاء `contentHash` القديم، كان إعادة الحفظ تُعيد `skippedUnchangedCount = 1` وتترك الانحراف قائماً.
   - **الإصلاح:**
     - تصدير `canonicalizeFinancialProjection` و`computeFinancialProjectionHash` في `src/core/contracts/hashing.ts` لبناء تمثيل معياري حتمي يغطي جميع حقول الأعمال الـ 44 في `financials` مع استبعاد الطوابع التشغيلية والخادمية (`VOLATILE_PROVENANCE_KEYS`).
     - فصل `sourceNeedsWrite` عن `projectionNeedsWrite` في `resolveQuarterlyRecordWrite`: يفحص `sourceNeedsWrite` تطابق `contentHash` و`computeRecordBusinessHash` وخرائط التدقيق (`originalValues`, `manualCorrections`) على المصدر، ويفحص `projectionNeedsWrite` وجود الإسقاط وعدم حذفه وتطابق `contentHash` وتطابق `computeFinancialProjectionHash(existingFinancialDoc) === projectionHash`.
     - عند انحراف الإسقاط فقط مع سلامة المصدر: يكتب المساران الفردي والجماعي `financials` فقط ولا يلمسان مستند `quarterly_financial_records` الصالح (يحافظ على `updatedAt`/`updatedBy`/`serverUpdatedAt`)؛ وعند سلامة الاثنين يستمر التخطي التام (`skippedUnchangedCount = 1`) بلا أي كتابة غير ضرورية.
4. **الاختبارات المضافة والمحدّثة:**
   - إنشاء `tests/quarterlyWriteHardening.test.ts` (**4 اختبارات قبول متكاملة** مع محاكاة معاملة تزامن تفاؤلي بمراقبة الإصدارات وإعادة المحاولة عند التعارض، والتحقق من الحد `180` ورفض `181`، وتغطية سياسة الخرائط المتداخلة الثلاث ومطابقة `contentHash`، وترميم الإسقاط المنحرف دون تعديل المصدر الصالح ثم التخطي الصفري عند السلامة).
   - ترقية `tests/emulator/reportedEpsWriteConsistency.emulator.test.ts` لاستخدام المنفّذ الإنتاجي الحقيقي (`executeBulkQuarterlyTransaction` + `createFirestoreAdminBulkQuarterlyTransactionPort`) وإضافة **3 اختبارات محاكي Firestore حقيقية** لحالات الدفعة 31 (التزامن المضبوط وإعادة المحاولة، الخرائط المتداخلة وبصمة المحتوى، وترميم الإسقاط المنحرف دون تعديل المصدر).

## 20. نتائج الفحوص الفعلية للدفعة 31 (بشفافية تامة)
- **بيئة التنفيذ الفعلية في هذه الحاوية:** Linux `x64` · Node.js `v22.23.2` · npm `10.9.8`.
- **أ) الفحوص والاختبارات العادية والتفاعلية (`npm run check` + `diff -rq` + `tsc --strict` على ملفات المحاكي + `compile_applet` + `lint_applet`):**
  - `sync:shared` ✅ · تطابق `src/core/contracts` مع `functions/src/shared` (`diff -rq` = `PARITY_OK`) ✅ · `lint` (`tsc --noEmit`) ✅ · `test` ✅ (**230 اختباراً ضمن 37 مجموعة: 230 ناجح، 0 فاشل، 0 متجاوز**) · `vite build` ✅ · `functions` (`npm run build`) ✅ · `tsc --strict` على جميع ملفات `tests/emulator/*.emulator.test.ts` الـ 5 (`EMULATOR_TSC_OK`) ✅.
- **ب) اختبارات محاكي Firestore الفعلي (`npm run test:emulator`) — متوقفة بعائق بيئي (`BLOCKER`):**
  - ❌ رمز الخروج **`1`**: `Java Runtime: MISSING (spawnSync java ENOENT)` مع توفر `firebase CLI 15.34.1` — لم تُسجّل كناجحة.
- **ج) حالة `functions/` والعقود المشتركة وحدود التحقق:**
  - **تغيّرت `src/core/contracts/` (`hashing.ts`, `records.ts`, `sectorAdminPort.ts`) و`functions/src/index.ts` و`functions/src/shared/`** في هذه الدفعة وتمت مزامنتها وبناؤها بنجاح.
  - لم تُشغّل اختبارات محاكي Firestore الفعلي داخل هذه الحاوية لغياب Java Runtime؛ ويجب تشغيل `npm run test:emulator` على بيئة تتوفر فيها **Java 17+** و**Node.js `>=24.12.0`** للتحقق الحي ضد المحاكي، ولم يُنفّذ أي ترحيل أو نشر أو كتابة على Firebase الإنتاجي.

## 21. ما نُفّذ في دفعة إغلاق تحقق التزامن وتصحيح دورة التدقيق اليدوي (الدفعة 32)
1. **تصحيح اختبار التزامن الحقيقي على Firestore Emulator (`tests/emulator/reportedEpsWriteConsistency.emulator.test.ts`):**
   - **السبب الجذري:** في اختبار `Batch 31.1`، كان `afterReadBeforeWrite` ينتظر اكتمال `runSingleWrite` على نفس المستند (`RACE_2026_Q3`) أثناء احتفاظ معاملة `bulk_quarterly` بأقفال القراءة التشاؤمية (pessimistic locks) في Firestore Admin SDK، ما يسبّب تعارض أقفال دائرية وانتهاء مهلة بدلاً من اختبار التزامن الحقيقي.
   - **الإصلاح:**
     - استبدال الانتظار الحاجز داخل `afterReadBeforeWrite` بإشارة حتمية غير حاجبة (`resolveBulkRead()`) تُطلق فور انتهاء القراءة المعاملية الأولى، مع حراسة مهلة صريحة `withTimeout` وربط رفض `bulkPromise` المبكر بالـ barrier (بلا أي `sleep` عشوائية).
     - إطلاق `runSingleWrite` خارج معاملة الاستيراد فور تلقّي الإشارة ثم انتظار اكتمال العمليتين معاً عبر `Promise.all` والتحقق من نجاح كلتيهما (`updatedCount === 1`) وقبول التنفيذ المتسلسل الآمن أو إعادة المحاولة الصحيحة (`attemptsSeen >= 1` دون اشتراط `attempts >= 2`) مع الإبقاء الصارم على `revenueYTD === 200` و`netIncomeYTD === 20` وتطابق المصدر والإسقاط وبصمات `contentHash` و`projectionHash`.
     - إضافة حالة ثانية في نفس الاختبار (`RACE2_2026_Q3`) تُطلق المعاملتين في نفس اللحظة عبر `Promise.all`، بالإضافة إلى اختبار `Batch 32.1` لدورة حذف التصحيح اليدوي عند الرجوع للأصل على محاكي Firestore الحقيقي.
     - لم يُعدّل أي كود خادمي أو إنتاجي لإرضاء الاختبار.
2. **تصحيح الرجوع من قيمة معدّلة إلى القيمة الأصلية في `EditQuarterlyRecordModal` ودورة الحفظ والقراءة والعرض والتصدير:**
   - **السبب الجذري:**
     1. عند بناء حمولة الحفظ في `EditQuarterlyRecordModal.tsx`، كان `{ ...normalizedFormData, ...(Object.keys(nextManualCorrections).length > 0 ? { manualCorrections: nextManualCorrections } : {}) }` يُعيد نشر `normalizedFormData.manualCorrections` القديمة بمجرد أن تصبح `nextManualCorrections` فارغة بعد الحذف المحلي.
     2. حتى مع وجود تصحيحات أخرى متبقية، فإن غياب المفتاح المحذوف من `manualCorrections` في الطلب لا يحذفه على الخادم وفق عقد الدمج غير الهدّام للخرائط المتداخلة (`mergeQuarterlyNestedMap`)؛ إذ يتطلب حذف مفتاح واحد إرسال `{ [field]: null }` صراحةً.
   - **الإصلاح والملفات المعدّلة:**
     - `src/types/financial.ts` و`src/types/index.ts`: تعريف نوع طلب الكتابة المستقل `ManualCorrectionsWritePatch` و`QuarterlyFinancialRecordWritePayload` لدعم علامات الحذف الصريحة (`null`) في طلبات الكتابة دون إضعاف نوع المستند المقروء (`QuarterlyFinancialRecord` / `ManualCorrectionsMap`) أو تخزين علامات الحذف فيه.
     - `src/core/domain/quarterlyManualAudit.ts` (جديد) و`src/core/domain/index.ts`: إضافة `normalizeAuditScalar` و`sanitizeReadManualCorrections` و`sanitizeReadOriginalValues` و`sanitizeQuarterlyReadRecord` و`buildQuarterlyEditSubmission`:
       - إزالة `manualCorrections` و`originalValues` القديمة قبل بناء كلٍّ من `readRecord` (سجل قراءة نقي بلا علامات `null`) و`writePayload` (يحمل `{ [revertedField]: null }` فقط للمفاتيح المُعادة إلى أصلها و`{ [editedField]: entry }` للمعدّلة، ويحذف `extendedFields` غير المحرّرة ليحفظها الخادم دون المساس بها).
       - حذف التصحيح النشط المستهدف فقط مع حفظ `originalValues` وبقية التصحيحات النشطة، والفصل الصارم بين `0` و`null` (BLANK) والغياب (`undefined`).
     - `src/modules/data-hub/EditQuarterlyRecordModal.tsx`, `src/modules/data-hub/DataHubView.tsx`, `src/hooks/useFirestoreSession.ts`, `src/services/firebase/firestoreWriters.ts`, `src/services/firebase/firestoreTransforms.ts`: تمرير `(readRecord, writePayload)` عبر نفس مسار الحفظ الموحّد القائم دون مسار موازٍ (إرسال `writePayload` إلى `quarterly_record` ودمج `sanitizeQuarterlyReadRecord(readRecord)` محلياً وتنظيف القراءة من Firestore عند `manualCorrections: null`).
     - `src/modules/data-hub/QuarterlyRecordsTable.tsx`, `src/modules/data-hub/RecordDetailsModal.tsx`, `src/utils/excelExport.ts`: ضمان أن شارة «معدّل» والعداد `معدّل (N)` ونافذة التفاصيل وورقة `Manual_Corrections` وعداد التصدير تعكس التصحيحات النشطة الفعلية فقط بعد الحفظ وإعادة القراءة.
3. **الاختبارات الجديدة (`tests/quarterlyManualAuditCycle.dom.test.ts`):**
   - إضافة **4 اختبارات DOM وتكامل تفاعلية** (`happy-dom` + `react-dom/client` + `React.act` + `sanitizeForFirestore` + `applyStockAndQuarterAtomicWrite` + إعادة القراءة + `QuarterlyRecordsTable` + `RecordDetailsModal` + `buildQuarterlyRecordsWorkbook`) تغطي: دورة التعديل ثم الإرجاع للأصل، الإرجاع الجزئي لتصحيح واحد مع بقاء تصحيح آخر، الإرجاع إلى `0` وإلى قيمة أصلية فارغة `null` مع الفصل الصارم بينهما، والحفاظ على `extendedFields` الخادمية.

## 22. نتائج الفحوص الفعلية للدفعة 32 (بشفافية تامة)
- **بيئة التنفيذ الفعلية في هذه الحاوية:** Linux `x64` · Node.js `v22.23.2` · npm `10.9.8`.
- **أ) اختبارات الذاكرة وDOM وبناء الواجهة والدوال (`npm run check` + `diff -rq` + `tsc --strict` على ملفات المحاكي + `compile_applet` + `lint_applet`):**
  - `sync:shared` ✅ · تطابق `src/core/contracts` مع `functions/src/shared` (`diff -rq` = `PARITY_OK`) ✅ · `lint` (`tsc --noEmit`) ✅ · `test` ✅ (**234 اختباراً ناجحاً ضمن 38 مجموعة: 234 ناجح، 0 فاشل، 0 متجاوز**) · `vite build` ✅ · `functions` (`npm run build`) ✅ · `tsc --strict` على جميع ملفات `tests/emulator/*.emulator.test.ts` الـ 5 (`EMULATOR_TSC_OK`) ✅.
- **ب) اختبارات محاكي Firestore الفعلي (`npm run test:emulator`) — متوقفة بعائق بيئي (`BLOCKER`):**
  - ❌ رمز الخروج **`1`**: `Java Runtime: MISSING (spawnSync java ENOENT)` مع توفر `firebase CLI 15.34.1` — لم تُشغّل ولم تُسجّل كناجحة داخل هذه الحاوية؛ يلزم تشغيل `npm run test:emulator` محلياً في بيئة تحتوي **Java 17+** و**Node.js `>=24.12.0`** للتحقق الفعلي من نجاح `Batch 31.1` و`Batch 32.1` وبقية اختبارات المحاكي.
- **ج) حالة `functions/` والعقود المشتركة وحدود التحقق:**
  - **لم تتغير `functions/` أو العقود المشتركة (`src/core/contracts/`)** في هذه الدفعة؛ جميع التعديلات كانت في طبقة الواجهة والأنواع ودومين التدقيق اليدوي واختبارات المحاكي وDOM.
  - لم يُنفّذ أي تنظيف جماعي أو ترحيل أو نشر أو كتابة على Firebase الإنتاجي.

## 23. ما نُفّذ في دفعة توحيد أساس المتوسط المرجح للأسهم وأهلية `AccountingEPS` (الدفعة 33)
1. **العقد المركزي لخيارات `WeightedAvgShares_Basis` وتوحيد التحقق (`src/core/contracts/weightedAvgSharesBasis.ts`, `index.ts`, `records.ts`, `parsers.ts`, `templates.ts`, `AddCompanyModal.tsx`, `EditQuarterlyRecordModal.tsx`):**
   - إنشاء سجل مركزي واحد للرموز الخمسة المحفوظة (`ytd_weighted_avg`, `standalone_quarter`, `end_of_period_proxy`, `unadjusted_weighted_avg`, `unknown`) دون تغيير أي رمز محفوظ أو تشغيل أي ترحيل.
   - توضيح صريح في العقد والواجهتين والقالب:
     - `WeightedAvgShares_YTD` هو **عدد أسهم كامل** وليس ربحية سهم أو نسبة.
     - `ytd_weighted_avg` متوسط مرجح للفترة التراكمية وقد تشمل السنة المالية الكاملة (`FY`).
     - `standalone_quarter` للربع المنفرد فقط ولا يمثل تلقائياً `6M/9M/FY`.
     - `end_of_period_proxy` عدد أسهم نهاية فترة تقريبي وليس متوسطاً مرجحاً فعلياً أو سنة مالية كاملة.
     - اختيار نطاق الفترة في `WeightedAvgShares_Basis` لا يُثبت وحده تعديل أحداث رأس المال (`provesCapitalActionAdjustment: false` — يوثّق مستقلاً في `IsCapitalActionAdjusted`).
   - توحيد التحقق الكتابي (`validateAndNormalizeWeightedAvgSharesBasis`) بين الواجهة والمستورد والخادم (`validateRecords`)، واستخدام الفحص غير المعدّل (`inspectWeightedAvgSharesBasis`) في القراءة ونافذة التعديل للاحتفاظ بأي قيمة محفوظة غير معروفة بوضوح ومنع انزلاقها إلى الخيار الأول.
2. **محرك القرار المركزي لأهلية `AccountingEPS` وتكافؤ `Q1` الموثق (`src/core/domain/accountingEpsEligibility.ts`, `src/core/domain/index.ts`, `src/core/domain/metricContracts.ts`, `src/types/financial.ts`):**
   - قرار مركزي واحد يُرجع: حالة الأهلية (`eligible`/`blocked`)، الأساس الأصلي المحفوظ، الأساس الفعلي للحساب، علم استخدام تكافؤ `Q1` الموثق (`usedQ1DocumentedEquivalence`)، سبب الحجب، الحقل/العمود الناقص، وخطوة الاستكمال (`remediationAr`).
   - إجازة تكافؤ `Q1` المنفرد (`standalone_quarter`) مع `Q1` التراكمي (`q1_standalone_equivalent_to_ytd`) فقط عند توثيق تاريخي البداية والنهاية (`PeriodStartDate` و`PeriodEndDate`) ضمن نطاق ربع فعلي (`60..125` يوماً، دقيق للسنوات التقويمية وغير التقويمية والكبيسة) ودون تعارض مع `PeriodDays` أو السنة المالية أو نهاية `FY` السابقة أو بداية بقية أرباع السنة — دون تعديل `standalone_quarter` المحفوظ أبداً.
   - رفض الاكتفاء برقم الربع `Q1` أو `PeriodDays` وحده (`standalone_q1_missing_dates`)، وحجب `standalone_quarter` دائماً لـ `Q2` و`Q3` و`FY` (`standalone_quarter_non_q1_blocked`)، وحجب `end_of_period_proxy` و`unadjusted_weighted_avg` و`unknown` والفارغ والقيم غير المعروفة، وحفظ `0` والقيم السالبة في `NetIncomeCommon_YTD` بدقة، وعدم تجاوز حراسة `NetIncomeCommon` مطلقاً.
   - إعادة استخدام نفس القرار للفترات المكوّنة في `AccountingEPS TTM` مع الحفاظ الكامل على حراسات TTM (الأيام الفعلية، نافذة 360–370 يوماً، اتصال الحدود، الترجيح التقويمي، منع جمع الأسهم، وحراسة `IsCapitalActionAdjusted`)، دون تعديل معادلات التقييم أو أولوية اختيار EPS للتقييم.
3. **تحديث العرض والتدقيق وروابط التعديل وتصدير `Metric_Audit` (`MetricAuditCard.tsx`, `ValuationSourcesCard.tsx`, `QuarterlyRecordsTable.tsx`, `excelExport.ts`):**
   - عرض الأساس الأصلي المحفوظ والأساس الفعلي عند تطبيق تكافؤ `Q1` الموثق، وعرض `remediationAr` وروابط التعديل المباشرة للحقول الناقصة (`periodStartDate`, `weightedAvgSharesBasis`, `weightedAvgSharesYTD`, `isCapitalActionAdjusted`, إلخ) دون أي حسابات مالية داخل JSX.
   - تحديث ورقة `Metric_Audit` في `excelExport.ts` لتصدير جدول «قرار أهلية AccountingEPS المركزي وأساس المتوسط المرجح» وجدول «حقول AccountingEPS الناقصة أو المحجوبة» وعمودي الأساس الأصلي والفعلي وخطوة الاستكمال.
4. **اختبارات القبول والواجهة (`tests/weightedAvgSharesBasisEligibility.test.ts` و`tests/weightedAvgSharesBasisUi.dom.test.ts`):**
   - إضافة **17 اختباراً جديداً ضمن 4 مجموعات** (12 اختبار دومين/عقد/مستورد/خادم/TTM/تصدير Excel + 5 اختبارات DOM وعرض تفاعلي).

## 24. نتائج الفحوص الفعلية للدفعة 33 (بشفافية تامة)
- **أ) اختبارات الذاكرة وDOM وبناء الواجهة والدوال (`npm run check` + `diff -rq` + `tsc --strict` على ملفات المحاكي + `compile_applet` + `lint_applet`):**
  - `sync:shared` ✅ · تطابق `src/core/contracts` مع `functions/src/shared` (`diff -rq` = `PARITY_OK`) ✅ · `lint` (`tsc --noEmit`) ✅ · `test` ✅ (**251 اختباراً ناجحاً ضمن 42 مجموعة: 251 ناجح، 0 فاشل، 0 متجاوز**) · `vite build` ✅ · `functions` (`npm run build`) ✅ · `tsc --strict` على جميع ملفات `tests/emulator/*.emulator.test.ts` الـ 5 (`EMULATOR_TSC_OK`) ✅.
- **ب) اختبارات محاكي Firestore الفعلي (`npm run test:emulator`) — متوقفة بعائق بيئي (`BLOCKER`):**
  - ❌ رمز الخروج **`1`**: `Java Runtime: MISSING (spawnSync java ENOENT)` مع توفر `firebase CLI 15.34.1` — لم تُشغّل ولم تُسجّل كناجحة داخل هذه الحاوية؛ يلزم تشغيل `npm run test:emulator` محلياً في بيئة تحتوي **Java 17+** و**Node.js `>=24.12.0`**.
- **ج) حالة `functions/` والعقود المشتركة وأوامر إعادة البناء:**
  - **نعم — تغيّرت العقود المشتركة (`src/core/contracts/`) و`functions/src/shared/`** (إضافة `weightedAvgSharesBasis.ts` وتحديث `records.ts` و`index.ts`)، وتمت مزامنتها وبناؤها محلياً بنجاح.
  - لإعادة المزامنة وبناء الدوال محلياً: `npm run sync:shared && npm --prefix functions run build` (وعند الرغبة بالنشر لاحقاً من بيئة النشر المعتمدة: `npm run deploy:functions`).
  - لم يُنفّذ أي تنظيف جماعي أو ترحيل أو نشر أو كتابة على Firebase الإنتاجي، ولم تُضف أداة اشتقاق الأسهم من `ReportedEPS` (مؤجلة) ولا افتراضات جديدة للعملة أو `FinancialUnit`.

---

## 25. سجل تنفيذ الدفعة 34 — توضيح أوزان التقييم النسبي ومصادرها ورسائل استكمالها (النسخة 34)
1. **تحديث التعريفات المركزية وسجل الحقول (`src/core/contracts/parameterRegistry.ts`, `src/core/contracts/valuationFieldRegistry.ts` → مزامنة إلى `functions/src/shared/`):**
   - تحديث التسميات والأوصاف العربية لـ `Relative_PE_Weight` و`Relative_PB_Weight` لتوضيح أنهما وزنان رقميان لدمج القيمة الضمنية المستخرجة من `P/E` مع القيمة الضمنية من `P/B` داخل التقييم النسبي فقط (وليسا المضاعفين نفسيهما ولا وزن النموذج في القيمة المركبة)، وأنهما يقبلان النطاقين (`company_assumptions` و`macro_params`) ويُطبَّعان تلقائياً بالقسمة على مجموعهما دون اشتراط مساواة المجموع لـ `1` أو `100`، دون تغيير مفاتيح قاعدة البيانات أو إنشاء مفاتيح بديلة للاختصارات.
   - تسجيل `Relative_PE_Weight` و`Relative_PB_Weight` في `VALUATION_LAB_FIELD_REGISTRY` وتصدير `RELATIVE_WEIGHT_REGISTRY_KEYS` لإعادة استخدام بطاقة `ValuationParameterCard` ومسار الحفظ القائم (`company_assumptions` / `macro_params` / مسودة الحساسية المحلية) دون أي مسار حفظ موازٍ.
2. **فصل النطاق عن المصدر التوثيقي وبناء تدقيق الدمج المركزي (`src/core/domain/valuationAssumptions.ts`, `src/core/domain/relativeValuationAudit.ts`, `src/core/domain/firestoreSessionManager.ts`, `src/core/math/valuation.ts`, `src/types/financial.ts`, `src/utils/financialCalculations.ts`, `src/hooks/useStockValuation.ts`, `src/App.tsx`):**
   - استهلاك نتيجة `resolveValuationAssumptions` القائمة مباشرة مع إظهار بيانات النطاقين (`companyValue`/`companyParameterSource`/`companyAsOfDate` و`globalValue`/`globalParameterSource`/`globalAsOfDate`)، وفصل النطاق (`company_assumptions` مقابل `macro_params`) عن المصدر التوثيقي (`parameterSource`) وتاريخ السريان (`asOfDate`) دون اختلاق مصدر أو تاريخ للسجلات غير الموثقة أو لمسودات الحساسية المؤقتة.
   - إضافة علم `macroParamsConfirmed` في `SyncCollectionState` (دون أي استعلامات Firestore إضافية) وتمريره مع `companyOverridesConfirmed` إلى المحرك والواجهة حتى لا يُستنتج غياب الأوزان من حالة تحميل غير مكتملة.
   - إنشاء `buildRelativeValuationAudit` لإخراج `RelativeValuationAudit` كمصدر حقيقة واحد للمحرك والواجهة وتصدير Excel: فصل الوزن الرقمي الخام عن حصة الدمج المطبّعة (%)، وعدم إظهار حصص دمج وهمية عند توفر فرع واحد فقط أو عند التعليق، وإصلاح رسالة التعليق لتشمل المسارين المدعومين (`company_assumptions` و`macro_params`) وتحدد الوزن الناقص أو غير الصالح وخطوة الاستكمال بوضوح — دون أي تعديل على معادلة التقييم النسبي أو سياسة الفرع الواحد.
3. **الواجهة وتصدير Excel (`src/components/ValuationView.tsx`, `src/components/ValuationParameterCard.tsx`, `src/utils/excelExport.ts`):**
   - استبدال الاختصارين الظاهرين `Rel_PE_W` و`Rel_PB_W` بتسميتين عربيتين واضحتين (`وزن دمج قيمة P/E` و`وزن دمج قيمة P/B`) مع إظهار المفتاح التقني كمرجع ثانوي، وإضافة قسم «أوزان دمج التقييم النسبي ومصادرها» في تبويب التقييم النسبي مع بطاقتَي `ValuationParameterCard` الموحدتين (بلا حسابات مالية داخل JSX وبلا كتابات Firestore عند العرض أو التجربة المؤقتة).
   - توحيد تصدير Excel في الورقتين القائمتين `'ملخص التقييم'` و`'الافتراضات_والمصادر'` بقراءة مباشرة من `relativeAudit` و`resolvedAssumptions` (أولوية الافتراضات النشطة، المفتاح التقني، الوزن الخام مقابل الحصة المطبّعة، فصل النطاق عن المصدر التوثيقي وتاريخ السريان، وقيم النطاقين ورسالة الاستكمال) دون إنشاء أوراق مكررة أو مسار حساب موازٍ.
4. **اختبارات القبول والواجهة وتصدير Excel (`tests/relativeValuationWeights.test.ts`):**
   - إضافة **9 اختبارات شاملة** تغطي: التعريفات المركزية وغياب المفاتيح البديلة، تخصيص الشركة فقط (مع وعدم وجود توثيق)، القيم العامة فقط، وجود النطاقين معاً تحت `company_first` و`global_first`، نقص وزن/وزن صفري وحيد `1/0`/مجموع صفري `0/0`/وزن سالب، التكافؤ العددي بين `60/40` و`0.6/0.4`، فرع واحد فقط دون طلب أوزان أو حصص وهمية، حالة التحميل غير المكتملة وعلم `macroParamsConfirmed`، والتطابق الكامل بين المحرك والواجهة (SSR + تجربة حساسية تفاعلية في `happy-dom` بلا أي كتابات Firestore وبلا تاريخ مختلق) وتصدير Excel.

## 26. نتائج الفحوص الفعلية للدفعة 34 (بشفافية تامة)
- **أ) اختبارات الذاكرة وDOM وبناء الواجهة والدوال (`npm run check` + `diff -rq` + `tsc --strict` على ملفات المحاكي + `compile_applet` + `lint_applet`):**
  - `sync:shared` ✅ · تطابق `src/core/contracts` مع `functions/src/shared` (`diff -rq` = `PARITY_OK`) ✅ · `lint` (`tsc --noEmit`) ✅ · `test` ✅ (**260 اختباراً ناجحاً ضمن 43 مجموعة: 260 ناجح، 0 فاشل، 0 متجاوز**) · `vite build` ✅ · `functions` (`npm run build`) ✅ · `tsc --strict` على جميع ملفات `tests/emulator/*.emulator.test.ts` الـ 5 (`EMULATOR_TSC_OK`) ✅.
- **ب) اختبارات محاكي Firestore الفعلي (`npm run test:emulator`) — متوقفة بعائق بيئي (`BLOCKER`):**
  - ❌ رمز الخروج **`1`**: `Java Runtime: MISSING (spawnSync java ENOENT)` مع توفر `firebase CLI` — لم تُشغّل ولم تُسجّل كناجحة داخل هذه الحاوية؛ يلزم تشغيل `npm run test:emulator` محلياً في بيئة تحتوي **Java 17+** و**Node.js `>=24.12.0`**.
- **ج) حالة `functions/` والعقود المشتركة وأوامر إعادة البناء:**
  - **نعم — تغيّرت العقود المشتركة (`src/core/contracts/`) و`functions/src/shared/`** (`parameterRegistry.ts` و`valuationFieldRegistry.ts`)، وتمت مزامنتها وبناؤها محلياً بنجاح.
  - لإعادة المزامنة وبناء الدوال محلياً: `npm run sync:shared && npm --prefix functions run build` (وعند الرغبة بالنشر لاحقاً من بيئة النشر المعتمدة: `npm run deploy:functions`).
  - لم يُنفّذ أي تنظيف جماعي أو ترحيل أو نشر أو كتابة على Firebase الإنتاجي.



---

## 27. سجل تنفيذ الدفعة 35 — إصلاح ظهور ملاحظات التدقيق المحاسبي ودقة تفسير حالات الفحص في MizanEX
1. **السبب الجذري (Root Cause):**
   - كان `useStockValuation` يحسب بالفعل كلاً من `auditWarnings` (عبر `runDataQualityAudit`) و`healthChecks` (عبر `runStockHealthChecks`)، وكان `App.tsx` يمرر `auditWarnings` إلى `DashboardView` (وعدادها إلى `Navbar`/`Sidebar`)، لكنه كان يمرر `healthChecks` فقط إلى `DataHubView` دون تمرير `auditWarnings`. وعند النقر على تنبيه التدقيق في `DashboardView` كان ينتقل إلى تبويب `data` ويفتح `DataHubView` على مصفوفة الفحص الـ 9 فقط، فتختفي ملاحظات التدقيق التي أعلن عنها التنبيه.
   - في `src/core/math/healthChecks.ts` كانت الحالات محصورة في 3 قيم (`pass | warning | fail`)، ما أدى إلى وصف بيانات ناقصة (`null`/`BLANK`) بشكل خاطئ (مثل وصف `fcfTTM === null` بأنه «التدفق النقدي الحر سالب»، ووصف غياب `Equity` أو `TotalAssets` بأنه «خلل محاسبي حرج: حقوق الملكية المسجلة أكبر من إجمالي أصول الشركة!»، وخلط `0` مع `BLANK` وعدم فصل عدم الانطباق القطاعي/المنهجي).
2. **الملفات المُنشأة والمعدّلة:**
   - `src/types/financial.ts` و`src/utils/auditEngine.ts`: إضافة مراجع السجلات والحقول المهيكلة (`AuditWarningRecordTarget` و`AuditWarningDetectedField` و`relatedRecords`) مباشرةً داخل `runDataQualityAudit` لجميع الفحوص الـ 6 (`revenue_drop`, `capex_drop`, `profit_exceeds_revenue`, `blank_zero_confusion`, `cashflow_divergence`, `unusual_repetition`) دون أي تحليل للنص العربي، مع دعم الملاحظات متعددة السجلات (مثل فترتي `Q2` و`Q1` في تراجع `CapEx YTD` أو الإيرادات أو التكرار).
   - `src/modules/data-hub/AccountingAuditWarningsPanel.tsx` (جديد): مكون عرض مستقل وقابل للصيانة لملاحظات التدقيق المحاسبي مع عزل صارم لسياق السهم المحدد (`selectedTicker`)، وإعادة ضبط المرشحات تلقائياً عند تبديل السهم، وعرض إجمالي الملاحظات للسهم مقابل المعروض بعد التصفية، وزر صريح «إزالة المرشحات»، وروابط تعديل منظمة لكل سجل وحقل معني تمر عبر `resolveRequestedQuarterlyEditTarget` دون اختيار سجل بديل أو إنشاء سجل تلقائياً أو اختلاق أثر تقييمي غير معروف.
   - `src/modules/data-hub/DataHubView.tsx`, `src/components/DashboardView.tsx`, `src/App.tsx`: تمرير `auditWarnings` نفسها عبر `useStockValuation → App → DataHubView` دون أي استعلامات أو مجموعات Firestore جديدة، وإضافة تبويب مستقل `audit_warnings` («ملاحظات التدقيق المحاسبي») مفصول كلياً عن تبويب مصفوفة الفحص الـ 9، وتوجيه النقر على تنبيه `DashboardView` مباشرةً إلى قسم ملاحظات التدقيق للسهم النشط مع الحفاظ على سياقه، وعرض شريط ملخص الحالات المركزية الخمس فوق جدول الفحص الـ 9.
   - `src/types/index.ts`, `src/shared/ui/HealthBadge.tsx`, `src/core/math/healthChecks.ts`: توسيع `HealthCheckStatus` إلى 5 حالات مركزية (`pass | fail | incomplete | not_applicable | warning`) مع `HEALTH_CHECK_STATUS_META` وتحديث `HealthBadge`، وإصلاح جميع الفحوص الـ 9 للفصل الصارم بين القيمة الموجبة، والصفر (`0`)، والقيمة السالبة، والمدخلات الناقصة (`incomplete`/`BLANK`)، وعدم الانطباق المعروف من المحرك (`not_applicable` للقطاع المالي في `dcf_price_positive` و`wacc_greater_than_g`، أو لـ `exit_multiple` في `wacc_greater_than_g`).
   - `tests/auditWarningsAndHealthChecks.test.ts` (جديد) و`tests/reliability.test.ts`: إضافة 5 اختبارات قبول وDOM تفاعلية (`happy-dom` + `react-dom/client` + `React.act`) وتحديث تأكيد حالة `equity: null` في `tests/reliability.test.ts` إلى `'incomplete'` مع إضافة تأكيد صريح لـ `equity > totalAssets` كـ `'fail'`.

## 28. نتائج الفحوص الفعلية للدفعة 35 (بشفافية تامة)
- **أ) الفحوص والاختبارات المنفذة:**
  - `npm run lint` (`tsc --noEmit`) ✅
  - `npm test`: **265 اختباراً ناجحاً ضمن 44 مجموعة (265 ناجح، 0 فاشل، 0 متجاوز)** ✅ — تشمل اختبارات القبول والـ DOM التفاعلية عبر `happy-dom` (تراجع `CapEx YTD` من `100` إلى `80`، تطابق العداد مع `DashboardView`، الانتقال من تنبيه `DashboardView` إلى قسم ملاحظات التدقيق، التصفية وإزالة المرشحات، عزل السياق عند تبديل السهم، توجيه التعديل متعدد السجلات وصلاحيات `viewer` والسجل المفقود، عدم وجود أي كتابة Firestore عند العرض والتنقل، دقة الحالات الخمس للفحوص الـ 9، وثبات نتائج التقييم).
  - `npm run build` (`vite build`) ✅
  - تطابق `src/core/contracts` مع `functions/src/shared` (`diff -rq`): دون تغيير ✅
- **ب) حالة `functions/` وقواعد Firestore واختبارات المحاكي:**
  - **لم تتغير `functions/` ولا `src/core/contracts/` ولا `firestore.rules`** في هذه الدفعة، ولم تُضف أي استعلامات أو مجموعات Firestore جديدة؛ لذا لم تستلزم هذه الدفعة إعادة بناء الدوال أو تشغيل اختبارات محاكي Firestore (كما أن Java Runtime غير متوفرة داخل هذه الحاوية).
- **ج) حدود التحقق:**
  - الاختبارات التفاعلية نُفّذت برمجياً في بيئة DOM (`happy-dom` + `react-dom/client` + `React.act`) و`renderToStaticMarkup`، ولم يُجرَ فحص حي داخل متصفح فعلي (Chromium/Playwright)، ولم يُنفَّذ أي نشر أو تعديل على بيانات Firebase الإنتاجية.

---

## 29. سجل تنفيذ الدفعة 36 — تصحيح مصادر ودلالات فحوص التقييم في MizanEX
1. **فصل `P/E` الوارد من التداول اليومي عن `P/E` المحسوب من الأرباح المعتمدة (`src/core/math/healthChecks.ts`):**
   - قصر حكم فحص `pe_ratio_positive` (`[PE_Ratio_Common] > 0`) على السعر السوقي الصالح وربحية الأسهم العادية المعتمدة من المحرك (`engineOutputs.epsTTM`) حصراً، وعدم اعتبار `dailyRecord.peRatio` دليلاً على توثيق `NetIncomeCommon` أو `EPS` داخل التطبيق.
   - عند غياب `EPS_TTM` المعتمد مع وجود `dailyRecord.peRatio` موجب: تبقى حالة الفحص `incomplete` دون الادعاء بربحية عادية موثقة، ويُعرض المضاعف المستورد كمرجع ثانوي مع بيان مصدره وتاريخه وحدود معرفة أساسه.
   - عند اختلاف المضاعف المستورد عن المحسوب من المحرك: يُعرض المصدران معاً بوضوح دون استبدال صامت أو تعديل `dailyRecord`، مع تغطية دقيقة لحالات `EPS` الموجب والصفري (`0`) والسالب والمفقود.
   - عدم تعديل مدخلات أو معادلات التقييم النسبي.
2. **تحديد انطباق `WACC > g` من طريقة القيمة النهائية النشطة (`src/core/math/healthChecks.ts`, `src/hooks/useStockValuation.ts`):**
   - إضافة معامل اختياري `terminalValueMethod` إلى `HealthCheckInputs` وتمرير الطريقة النشطة مباشرة من `useStockValuation` (بدل الاعتماد وحده على `engineOutputs.dcfDetails` الذي يكون `null` عند نقص مدخلات DCF).
   - عند اختيار `exit_multiple`: يُصنّف فحص `wacc_greater_than_g` كـ `not_applicable` حتى عند `dcfDetails === null`، مع التنبيه الصريح بأن ذلك لا يعفي نموذج `DCF` من الحاجة إلى معدل خصم (`WACC`) صالح.
   - الحفاظ على تصنيف القطاع المالي (`not_applicable`)، وعلى فحص `perpetuity_growth` (مدخلات ناقصة `incomplete`، و`WACC > g` `pass`، و`WACC === g` و`WACC < g` `fail`) دون تعديل معادلات `DCF`.
3. **ضبط العبارات وفق ما تثبته البيانات (`src/core/math/healthChecks.ts`, `src/utils/auditEngine.ts`, `src/modules/data-hub/AccountingAuditWarningsPanel.tsx`):**
   - `ocf_positive`: توضيح أن إيجابية `OCF_TTM` تثبت إيجابية التدفق التشغيلي المسجل فقط ولا تكفي وحدها لإثبات جودة الأرباح.
   - `clean_daily_data`: توضيح أن توفر سجل تداول وسعر موجب لا يثبت بذاته حداثة البيانات أو مطابقتها الخارجية مع شاشة البورصة دون تحقق مستقل.
   - `blank_zero_confusion` (`auditEngine.ts`): إزالة الادعاء بأن الإيراد الصفري يعني تلقائياً توقف نشاط الشركة، والطلب بمراجعة القيمة ومصدرها مع الحفاظ على الصفر (`0`) دون تحويله إلى فراغ.
   - تمييز ملاحظات الاشتباه والمراجعة عن الخطأ المحاسبي المثبت في `AccountingAuditWarningsPanel.tsx` («اشتباه حرج للمراجعة» بدل «خطأ حرج») و`equity_assets_consistent` و`cashflow_divergence`.
4. **الاختبارات والتحقق (`tests/auditWarningsAndHealthChecks.test.ts`):**
   - إضافة اختبارات قبول تغطي: `peRatio` المستورد الموجب مع غياب `EPS` المعتمد، حالات `EPS` الأربعة، تعارض `P/E` المستورد والمحسوب، `exit_multiple` مع `dcfDetails = null`، جميع حالات `perpetuity_growth`، صياغات `OCF` والسجل اليومي والصفر والاشتباه، واستبدال مقارنة التشغيلين المتماثلين باختبار انحدار مستقل بحالات مالية صالحة وقيم متوقعة محسوبة بالصيغ المغلقة لـ `Ke` و`WACC` و`DCF` و`DDM` و`Relative` و`Graham` و`Composite`.

## 30. نتائج الفحوص الفعلية للدفعة 36 (بشفافية تامة)
- `npm run lint` (`tsc --noEmit`): **ناجح (0 أخطاء)** ✅
- `npm test`: **267 اختباراً ناجحاً ضمن 44 مجموعة (267 ناجح، 0 فاشل، 0 متجاوز)** ✅
- `npm run build` (`vite build`) + `compile_applet` + `lint_applet`: **ناجحة جميعها** ✅
- تطابق العقود المشتركة (`diff -rq src/core/contracts functions/src/shared`): **`PARITY_OK`** — **لم تتغير `functions/` ولا `src/core/contracts/` ولا `firestore.rules`** في هذه الدفعة، ولم تُضف أي استعلامات أو كتابات Firestore.
- **حدود التحقق:** الاختبارات التفاعلية نُفّذت برمجياً في بيئة DOM (`happy-dom` + `react-dom/client` + `React.act`) و`renderToStaticMarkup`، ولم يُجرَ فحص حي داخل متصفح فعلي (Chromium/Playwright)، ولم تُشغّل اختبارات محاكي Firestore (عدم تغيير الخادم/القواعد وغياب Java Runtime في الحاوية)، ولم يُنفَّذ أي نشر أو تعديل على Firebase الإنتاجي.

---

## 31. سجل تنفيذ الدفعة 37 — استكمال تخصيص معاملات نموذج DDM داخل تبويبه في معمل التقييم والحساسية
1. **ما كان موجوداً بالفعل قبل هذه الدفعة (تمت إعادة استخدامه دون تكرار):**
   - تعريف `DDM_Growth` و`CRP_Egypt` و`Rf_Egypt_10Y` و`ERP_Developed` و`Beta`/`Beta_Analytical` في العقود المركزية (`parameterRegistry.ts` و`valuationFieldRegistry.ts`).
   - دعم `company_assumptions` و`macro_params` ومسودات الحساسية المحلية وأولوية المصادر (`company_first` / `global_first`) ومسارات الحفظ والحذف وصلاحيات الأدوار ومتحكم التزامن في `ValuationView.tsx` و`ValuationParameterCard.tsx` و`valuationAssumptions.ts`.
   - معادلة جوردون `(D0 × (1 + g)) / (Ke − g)` وسياسة اختيار التوزيعات المنتظمة واستبعاد التوزيعات الاستثنائية (`special`) في `valuation.ts` و`dividendAnalytics.ts`.
   - ورقتا `DDM_Audit` و`الافتراضات_والمصادر` في `excelExport.ts` وبنية `requestedSubTab` في `DataHubView.tsx`.
2. **ما أُضيف وعُدّل في هذه الدفعة:**
   - **بطاقة تخصيص `DDM_Growth` داخل تبويب DDM (`src/components/ValuationView.tsx`, `src/components/ValuationParameterCard.tsx`):**
     - دمج `ValuationParameterCard` لـ `DDM_Growth` باستخدام العقد المركزي القائم، مع عرض القيمة العامة وتخصيص الشركة والقيمة الفعلية بعد الأولوية والنطاق والمصدر وتاريخ السريان، وإتاحة التجربة المؤقتة (0 كتابات Firestore)، والحفظ للشركة، ومسح التخصيص (يعيد تطبيق أولوية المصادر ولا يفترض صفراً أبداً)، والحفظ العام للمدير فقط، وتمييز عدم تأكيد التحميل (`قيد تأكيد التحميل`) عن الغياب المؤكد، وتوضيح وحدة النسبة المئوية مقابل التخزين العشري للنطاقات السالبة والموجبة (`-50%..99%`).
   - **قسم تكلفة حقوق الملكية المشتقة (`Ke`) ومدخلاتها النشطة حسب `r_Mode` (`src/components/ValuationView.tsx`, `src/core/math/valuation.ts`):**
     - عرض `Ke` كمخرج مشتق من المحرك مع بيان النمط والمعادلة النشطة (`r_Mode` = 1 أو 2 أو 3) دون أي تجاوز يدوي مباشر لـ `Ke`.
     - عرض المدخلات النشطة فعلياً في النمط الحالي مع تنبيه صريح بالتأثير المشترك على باقي النماذج (DCF، RIM، WACC)، وروابط انتقال مباشرة لبطاقات `Rf_Egypt_10Y` و`ERP_Developed` ولوحة بيتا (`ValuationBetaPanel`) بالأعلى دون تكرار بصري أو كتابة `Beta_Analytical` في `beta_assumptions`، وتضمين بطاقة `CRP_Egypt` عند تفعيلها في `r_Mode` 1/2 (مع احترام `supportsSensitivityDraft: false`)، والإبقاء على `r_Mode` و`Country_Risk_Lambda` و`Rf_USD_10Y` و`Beta_Raw_Weight` و`Beta_Anchor` للقراءة فقط دون توسيع نطاقاتها.
   - **التوزيعات الفعلية وتصحيح نصوص التدقيق والتصدير (`src/core/math/valuation.ts`, `src/types/financial.ts`, `src/components/DdmAuditCard.tsx`, `src/App.tsx`, `src/utils/excelExport.ts`):**
     - إبقاء `DPS_Actual` مرتبطاً بـ `dividend_records` و`dividend_year_statuses` دون تحويله إلى افتراض يدوي مكرر، مع زر انتقال مباشر إلى تبويب `dividend_table` في مركز البيانات مع الحفاظ على سياق السهم.
     - إصلاح رسالة غياب `DDM_Growth` في `valuation.ts` (كانت تنسبها لـ `macro_params` فقط) والوصف الثابت في `ValuationView.tsx` لتعكس النطاقين (`company_assumptions` و`macro_params`) وتميّز التحميل غير المؤكد وتعرض سبب الاستبعاد وخطوة الاستكمال عند `Ke ≤ g` أو نقص المدخلات، مع تصدير مصدر ونطاق `DDM_Growth` ومعادلة `Ke` النشطة وخطوة الاستكمال في `excelExport.ts`.
   - **اختبارات القبول (`tests/ddmCustomizationAndAudit.test.ts`):**
     - إضافة 7 اختبارات شاملة تغطي: الحساب المغلق `D0=2, Ke=26%, g=6% => DDM=10.60`، وتخصيص الشركة `g=2% => DDM=8.50` تحت `company_first` مقابل `10.60` تحت `global_first`، وتخصيص الشركة فقط، والصفر (`0%`)، والنمو السالب (`-5%`)، والغياب المؤكد مقابل التحميل غير المؤكد، واستبعاد `Ke === g` و`Ke < g`، وصيغ `r_Mode` الثلاث، واختبارات DOM التفاعلية في `ValuationView` (مسودة الحساسية بصفر كتابات، الحفظ، المسح والرجوع للأولوية، صلاحيات المدير ومدخل البيانات والعارض، تبديل السهم، رابط `DPS_Actual`)، وتصدير Excel.

## 32. نتائج الفحوص الفعلية للدفعة 37 (بشفافية تامة)
- `npm test`: **274 اختباراً ناجحاً ضمن 45 مجموعة (274 ناجح، 0 فاشل، 0 متجاوز)** ✅
- `npm run lint` (`tsc --noEmit`) + `npm run build` (`vite build`) + `compile_applet` + `lint_applet`: **ناجحة جميعها** ✅
- تطابق العقود المشتركة (`diff -rq src/core/contracts functions/src/shared`): **`PARITY_OK`** — **لم تتغير `functions/` ولا `src/core/contracts/` ولا `firestore.rules`** في هذه الدفعة، ولم تُنشأ أي مجموعات أو مسارات حفظ مكررة.
- **حدود التحقق:** الاختبارات التفاعلية نُفّذت برمجياً في بيئة DOM (`happy-dom` + `react-dom/client` + `React.act`)، ولم يُجرَ فحص حي داخل متصفح فعلي (Chromium/Playwright)، ولم تُشغّل اختبارات محاكي Firestore (عدم تغيير الخادم/القواعد وغياب Java Runtime في الحاوية)، ولم يُنفَّذ أي نشر أو تعديل على Firebase الإنتاجي.

---

## 33. سجل تنفيذ الدفعة 38 — تصحيح وصف مصادر الافتراضات وحالات تحميلها في MizanEX
1. **المشكلات الجذرية المعالجة (Root Causes):**
   - **مصدر بيتا داخل لوحة `Ke` بتبويب `DDM`:** كان `ValuationView.tsx` يستنتج مصدر بيتا بفرع ثنائي يعتمد على وجود `Beta_Analytical` فقط، فكان ينسب بيتا الافتراضية (`1.00` عند غياب السجل المؤكد `defaulted_missing`) وحالة عدم تأكيد التحميل وفشل الخادم ومسودة حساسية `Beta` المحلية إلى «بيتا التاريخية المعدلة بـ Blume (`beta_assumptions`)».
   - **حالات تحميل النطاقات في تصدير Excel والواجهة:** كان `excelExport.ts` يعرض «غير محفوظ» في صفوف `DDM_Audit` وأوزان التقييم النسبي بـ `ملخص التقييم` وورقة `الافتراضات_والمصادر` فور غياب القيمة حتى قبل تأكيد تحميل `company_assumptions` أو `macro_params`، ولم يكن يفصل بين غياب المصدر التوثيقي وغياب القيمة أو يعامل حالتي تأكيد النطاقين باستقلال كامل.
   - **اتساق مسودة الحساسية في بطاقة `DDM_Audit`:** كان تراكب `sensitivityDrafts` على `draftCompanyOverrides`/`draftParams` قبل `runValuationModels` يجعل `ddmAudit` ينسب المسودة المحلية المؤقتة إلى `company_assumptions` أو `macro_params` داخل `DdmAuditCard`.
2. **الملفات المُنشأة والمعدّلة:**
   - `src/core/domain/assumptionSourcePresentation.ts` (جديد) و`src/core/domain/index.ts`: استخراج دوال عرض مركزية مشتركة صغيرة:
     - `describeBetaEffectiveSource`: تصنّف مصدر بيتا الفعال من حالات المحرك القائمة (`betaStatus`, `betaSourceNoteAr`, `effectiveBetaForKe`) و`betaConfirmed`/`betaError` ومسودات الحساسية (`draftBeta`, `draftAnalyticalBeta`) عبر جميع الحالات (تاريخية فعلية، تخصيص تحليلي محفوظ، افتراضية `1.00` بعد غياب مؤكد دون نسبتها لسجل تاريخي، قيد تأكيد التحميل / فشل التأكيد، ومسودة حساسية مؤقتة) دون تعديل سياسة بيتا أو قيمها أو أولوياتها أو وجهات حفظها.
     - `classifyScopedAssumptionState` و`formatScopedAssumptionStateAr` و`formatDocumentaryMetadataAr`: تعرض حالة كل من `company_assumptions` و`macro_params` مستقلاً (قيمة متاحة بما فيها `0`، غياب مؤكد، أو تحميل غير مؤكد) وتفصل غياب المصدر التوثيقي («المصدر التوثيقي غير موثق (القيمة متاحة)») عن غياب القيمة.
   - `src/types/financial.ts`, `src/core/math/valuation.ts`, `src/core/domain/valuationAssumptions.ts`, `src/utils/financialCalculations.ts`: تمرير أعلام تأكيد التحميل القائمة (`companyOverridesConfirmed`, `macroParamsConfirmed`) وبيانات التوثيق لكل نطاق عبر المخرجات المركزية (`DdmAuditSummary`, `ValuationSourcesSummary`) دون أي استعلامات أو تخزين جديد في Firestore، وتمرير `sensitivityDraftKeys` القائمة من مسار الحساسية الموجود لوسم `ddmAudit.growthSource = 'sensitivity_draft'` و`isSensitivityDraft = true` عند تفعيل مسودة محلية على `DDM_Growth`.
   - `src/components/ValuationBetaPanel.tsx`, `src/components/ValuationView.tsx`, `src/components/ValuationParameterCard.tsx`, `src/components/DdmAuditCard.tsx`: توحيد وصف مصدر بيتا بين `ValuationBetaPanel` ولوحة `Ke` داخل تبويب `DDM` عبر `describeBetaEffectiveSource`، وتمرير `companyScopeConfirmed` و`globalScopeConfirmed` مستقلاً إلى `ValuationParameterCard` وتبويب التقييم النسبي، وتمييز مسودات الحساسية المؤقتة صراحةً في `DdmAuditCard` وبطاقات `Rf_Egypt_10Y`/`ERP_Developed` دون نسبتها لافتراض محفوظ.
   - `src/utils/excelExport.ts`: استخدام `formatScopedAssumptionStateAr` و`formatDocumentaryMetadataAr` وأعلام تأكيد النطاقين المستقلة في أوراق `DDM_Audit` وأوزان التقييم النسبي داخل `ملخص التقييم` وورقة `الافتراضات_والمصادر` مع إبقاء الصفر (`0`) قيمة متاحة وفصل غياب المصدر التوثيقي عن غياب القيمة.
   - `tests/assumptionSourceAndLoadingConsistency.test.ts` (جديد) و`tests/ddmCustomizationAndAudit.test.ts`: إضافة 5 اختبارات قبول شاملة (وحدة + `happy-dom` + Excel) تغطي جميع حالات بيتا الـ 6 وتطابقها مع `ValuationBetaPanel`، وجميع تركيبات تأكيد النطاقين (كلاهما غير مؤكد، أحدهما فقط مؤكد، غياب مؤكد، الصفر الصريح `0`، وغياب المصدر التوثيقي مع قيمة متاحة)، وحفظ قيم جوردون الدقيقة (`10.60` و`8.50`)، واتساق `DdmAuditCard` ولوحة `Ke` تحت مسودات الحساسية المحلية بصفر كتابات Firestore.

## 34. نتائج الفحوص الفعلية للدفعة 38 (بشفافية تامة)
- `npm test`: **279 اختباراً ناجحاً ضمن 46 مجموعة (279 ناجح، 0 فاشل، 0 متجاوز)** ✅
- `diff -rq src/core/contracts functions/src/shared`: **`PARITY_OK`** — **لم تتغير `functions/` ولا `src/core/contracts/` ولا `firestore.rules`** في هذه الدفعة، ولم تُضف أي استعلامات أو مجموعات أو مسارات حفظ أو تصدير جديدة (لا يلزم إعادة بناء `functions/` أو مزامنة العقود).
- `compile_applet` (`vite build`) + `lint_applet` (`tsc --noEmit`): **ناجحة جميعها** ✅
- **حدود التحقق:** الاختبارات التفاعلية نُفّذت برمجياً في بيئة DOM (`happy-dom` + `react-dom/client` + `React.act`) مع فحص أوراق Excel المولدة عبر `XLSX`، ولم يُجرَ فحص حي داخل متصفح فعلي (Chromium/Playwright)، ولم تُشغّل اختبارات محاكي Firestore (عدم تغيير الخادم/القواعد وغياب Java Runtime في الحاوية)، ولم يُنفَّذ أي نشر أو تعديل على Firebase الإنتاجي.

---

## 35. سجل تنفيذ الدفعة 39 — الدفعة الأولى (تأسيس) من ميزة «الإفصاحات العقارية الموثقة»
1. **النطاق المحدود والضوابط:**
   - دفعة تأسيس نقية (عقد بيانات مركزي + تحقق + دوال تفسيرية نقية + اختبارات + توثيق قاموس الحقول وخطة الدفعة الثانية).
   - **دون أي واجهات مستخدم أو كولكشن جديدة أو Cloud Functions أو تعديل `firestore.rules` أو كتابات Firestore أو تعديل معادلات التقييم أو `NetIncome`/`EPS`/`Equity` أو حساب Adjusted NAV.**
2. **فحص الموجود وإعادة الاستخدام (دون تعريفات موازية):**
   - أعيد استخدام `normalizedTicker` و`isValidCalendarDate` و`parseCleanNumber` و`parseCleanText` من `src/core/contracts/normalization.ts`، وتعريف الفترة الفصلية `QuarterlyRecordQuarter` (`Q1 | Q2 | Q3 | FY`) من `src/core/contracts/reportedEpsPeriod.ts`، ومعرّف السجل المالي المنطقي `${ticker}_${fiscalYear}_${fiscalQuarter}` من `src/core/contracts/records.ts`، والعملة ومعامل الوحدة الموجودين على السجل المالي/الشركة دون تكرارها أو تعديل تخزين `quarterly_financials`.
3. **الملفات المُنشأة والمعدّلة:**
   - `src/core/contracts/realEstateDisclosures.ts` (جديد) و`src/core/contracts/index.ts` (معدّل):
     - تعريف العقد المركزي `RealEstateDisclosureRecord` وقوائم القيم الموحدة الجاهزة للقوائم المنسدلة لاحقاً: نطاق القوائم (`consolidated | standalone | unspecified`)، تصنيف العقار واستخدامه (`investment_property | development_inventory | owner_occupied_property | land_bank_unspecified_use | mixed_or_other_real_estate | unspecified`)، السياسة المحاسبية المعلنة حرفياً دون افتراض معايير غير موثقة (`cost_model | fair_value_model | unspecified`)، مستوى التجميع لمنع الازدواج (`total_summary | component_detail | standalone_item | unspecified` + `parentDisclosureId`)، مصدر القيمة العادلة (`independent_valuer | management_estimate | market_observable | unspecified`)، وحالة اكتمال الإفصاح المشتقة.
     - دوال فحص غير معدِّلة عند القراءة (`inspect*`) تحفظ القيم غير المعرّفة صراحةً دون تحويل صامت، ومُحقِّق كتابة صارم (`validateAndNormalizeRealEstateDisclosure`) يميز `null` عن `0` ويرفض القيم السالبة وغير المنتهية، ومعرّفات الربط المنطقي (`buildLinkedQuarterlyDocId` و`buildRealEstateDisclosureDocId`)، وقاموس الحقول المركزي (`REAL_ESTATE_DISCLOSURE_FIELD_DICTIONARY` — 22 حقلاً).
   - `src/core/domain/realEstateDisclosureAnalysis.ts` (جديد) و`src/core/domain/index.ts` (معدّل):
     - دوال تفسيرية نقية: `evaluateRealEstateFairValueGap` لحساب **«فرق القيمة العادلة المُفصح عنها عن القيمة الدفترية»** (`disclosedFairValue - carryingValue`) حصراً عند تحقق شروط المقارنة (قيمة دفترية وقيمة عادلة غير سالبتين ومنتهيتين، نطاق محدد ومطابق، وعاء أصل مطابق، وتاريخ مطابق، وعدم وجود أكواد غير معرّفة)، وإلا يعيد `null` مع أسباب منع مهيكلة وتوضيح محاسبي يمنع وصف الفرق كربح إعادة تقييم أو NAV أو سعر سهم.
     - `summarizeRealEstateDisclosures` لتجميع السجلات بنطاق واحد مع حارس مزدوج لمنع الازدواج بين `total_summary` و`component_detail` المرتبط عبر `parentDisclosureId` أو ضمن نفس الفئة ومنع التجميع الأعمى عند تداخل `unspecified` أو خلط `consolidated` مع `standalone`.
   - `tests/realEstateDisclosuresFoundation.test.ts` (جديد):
     - 8 اختبارات قبول شاملة تغطي: تمييز `0` عن `null` ورفض القيم السالبة/غير المنتهية، حالة `carrying=100, fair=150 => difference=50` بالتسمية العربية الدقيقة والضوابط، حالة `carrying=150, fair=150 => difference=0` دون استنتاج ربح، غياب القيمة العادلة دون استنتاجها من الدفترية، اختلاف النطاق/عدم تحديد النطاق/اختلاف التاريخ/اختلاف وعاء الأصل، حفظ التصنيف غير المعرّف كغير معرّف عند القراءة ورفضه عند الكتابة، منع الازدواج بين الإجمالي والتفاصيل، وتأكيد صفر كتابات Firestore وعدم تغير مخرجات محرك التقييم بتاتاً.
   - `docs/REAL_ESTATE_DISCLOSURES_FOUNDATION.md` (جديد):
     - توثيق فحص العقود القائمة وإعادة الاستخدام، مكان الربط المنطقي المقترح بسجل `quarterly_financials` دون تعديل تخزينه، قاموس الحقول الكامل ومصادرها، قواعد الدوال التفسيرية، وخطة الدفعة الثانية المحدودة للواجهة والحفظ والمزامنة والتصدير وإعادة الاستيراد عبر الخدمات المركزية.
   - **مزامنة العقود المشتركة مع `functions/src/shared/`:**
     - نظراً لإضافة عقد جديد داخل `src/core/contracts/realEstateDisclosures.ts` وتصديره في `src/core/contracts/index.ts`، نُفّذت `npm run sync:shared` لنسخ العقد إلى `functions/src/shared/`، وتم بناء حزمة `functions` محلياً (`npm --prefix functions run build`) للتأكد من التوافق الكامل مع بقاء صفر دوال أو كولكشن أو قواعد مضافة في هذه الدفعة.

## 36. نتائج الفحوص الفعلية للدفعة 39 (بشفافية تامة)
- `npm run sync:shared`: **نجحت المزامنة** (`functions/src/shared/realEstateDisclosures.ts` و`functions/src/shared/index.ts`) ✅
- `npm --prefix functions run build`: **نجح بناء `functions` محلياً بدون أخطاء TypeScript** ✅
- تطابق العقود المشتركة (`diff -rq src/core/contracts functions/src/shared`): **`PARITY_OK`** ✅
- `npm test`: **287 اختباراً ناجحاً ضمن 47 مجموعة (287 ناجح، 0 فاشل، 0 متجاوز)** بما فيها 8 اختبارات جديدة في `tests/realEstateDisclosuresFoundation.test.ts` ✅
- `compile_applet` (`vite build`) + `lint_applet` (`tsc --noEmit`): **ناجحة جميعها** ✅
- **ما لم يُنفّذ عمداً في هذه الدفعة:** لم تُنشأ أي واجهات، ولا كولكشن في Firestore، ولا Cloud Functions، ولا تعديل في `firestore.rules`، ولا تصدير/استيراد Excel، ولا تعديل على حسابات `NetIncome`/`EPS`/`Equity`/التقييم/Adjusted NAV، ولا نشر أو تعديل على Firebase الإنتاجي.
- **حدود التحقق:** جميع اختبارات الدفعة 39 هي اختبارات وحدة ونقاء حسابي وبناء محلي (Frontend + Functions TypeScript build)؛ لم تُشغّل اختبارات متصفح حي أو محاكي Firestore (لعدم وجود واجهات أو قواعد أو دوال خادم جديدة وغياب Java Runtime في الحاوية).

---

## 37. سجل تنفيذ الدفعة 40 — دفعة تصحيح محدودة لأساس «الإفصاحات العقارية الموثقة»
1. **المشكلات المصحّحة (قبل ← بعد):**
   - **منع تصادم المعرّفات (`src/core/contracts/realEstateDisclosures.ts`):**
     - **قبل:** كان `sanitizeRealEstateDisclosureId` يقص المعرّف بصمت إلى 80 حرفاً (`slice(0, 80)`) ويستبدل المسافات بـ `_` (`replace(/\s+/g, '_')`)، فكان معرّفان أطول من 80 حرفاً يتطابقان في أول 80 حرفاً أو `'note 11'` مع `'note_11'` يتحولان إلى هوية واحدة؛ وكان `buildRealEstateDisclosureDocId` يسقط بصمت إلى `'undated'` عند غياب الفترة.
     - **بعد:** قاعدة هوية مركزية موثقة (`REAL_ESTATE_DISCLOSURE_ID_MAX_LENGTH = 80`, `REAL_ESTATE_DISCLOSURE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/`, `inspectRealEstateDisclosureId`, `validateRealEstateDisclosureId`, `sanitizeRealEstateDisclosureId`) ترفض تجاوز 80 حرفاً أو أي مسافات أو رموز مسار (`/`, `\`, `..`) برسالة واضحة دون قص صامت أو تحويل مسافات أو طي حالة الأحرف، وتُطبّق باتساق تام على `disclosureId` و`parentDisclosureId` و`buildRealEstateDisclosureDocId` (مع رفض غياب الفترة/النطاق الصالح ورفض تعيين `parentDisclosureId` لغير `component_detail`).
   - **تصحيح التجميع وعلاقات الاحتواء (`src/core/domain/realEstateDisclosureAnalysis.ts`):**
     - **قبل:** لم يكن `summarizeRealEstateDisclosures` يكشف تكرار الهوية قبل الجمع، وكان يستبعد أي `component_detail` اعتماداً على تطابق `assetCategory` وحده حتى لو كان `parentDisclosureId` غائباً أو يشير لإجمالي آخر.
     - **بعد:**
       - كشف تكرار الهوية قبل أي جمع: التكرار المطابق يُحتسب مرة واحدة (`exact_duplicate_disclosure_id`)، وتكرار الهوية بقيم مختلفة يحجب الإجمالي المعتمد بسبب منظم (`conflicting_duplicate_disclosure_id`) دون اختيار أحد السجلين بصمت.
       - إزالة الاستبعاد بالتصنيف وحده نهائياً: يُستبعد `component_detail` **فقط** عند ثبوت علاقة احتواء موثقة عبر `parentDisclosureId` يشير إلى `total_summary` حاضر ومتوافق في الشركة (`ticker`) والفترة (`fiscalYear`, `fiscalQuarter`, `balanceSheetDate`) ونطاق القوائم (`statementScope`).
       - الأب الغائب (`missing_parent_disclosure`) أو غير الموثق (`unresolved_component_parent`) أو المتعارض (`conflicting_parent_disclosure`) والتداخل غير المحسوم (`ambiguous_aggregation_overlap`) حالات مراجعة تحجب الإجمالي المعتمد مع إبقاء جميع السجلات ظاهرة في `items`.
   - **فصل صحة البنية واكتمال التوثيق وقابلية المقارنة (`src/core/contracts/realEstateDisclosures.ts` + `src/core/domain/realEstateDisclosureAnalysis.ts`):**
     - **قبل:** كانت `deriveRealEstateDisclosureCompleteness` تُرجع `complete_comparable` حتى عند اختلاف التاريخ أو النطاق أو غياب توثيق تطابق الأصول، وكانت `evaluateRealEstateFairValueGap` تعامل `fairValueAssetScopeMatchesCarrying === null` كأنها `true`.
     - **بعد:** اشتقاق مركزي موحد (`deriveRealEstateDisclosureStatusBreakdown`) يفصل صراحةً `structuralValidityStatus` و`documentationStatus` و`comparabilityStatus` دون تضارب بين الدوال:
       - لا تُرجع `complete_comparable` أبداً إذا كانت المقارنة محجوبة؛ بل تُرجع `documented_not_comparable` عند اكتمال التوثيق مع حجب المقارنة (اختلاف التاريخ/النطاق أو `false` لتطابق الأصول)، و`incomplete_missing_metadata` عند نقص التوثيق.
       - `null` في `fairValueAssetScopeMatchesCarrying` تعني أن التطابق غير موثّق (`unverified_asset_scope_match`) ولا تُعامل كـ `true`، مع بقاء السجل الجزئي ممثلاً في العقد وتعليق الفرق المعتمد حتى استكمال التوثيق.
2. **الملفات المُعدّلة والمُزامنة:**
   - `src/core/contracts/realEstateDisclosures.ts` (ومُزامنته إلى `functions/src/shared/realEstateDisclosures.ts` عبر `npm run sync:shared`)
   - `src/core/domain/realEstateDisclosureAnalysis.ts`
   - `tests/realEstateDisclosuresFoundation.test.ts` (تحديث شامل إلى 9 اختبارات قبول، مع إزالة اختبار الاستبعاد بالتصنيف وحده وتغطية جميع حالات التصادم والتكرار والاحتواء وفصل الاكتمال عن المقارنة وثبات نماذج التقييم)
   - `docs/REAL_ESTATE_DISCLOSURES_FOUNDATION.md` (تحديث القاعدة المركزية للهوية وقاموس الحقول وضوابط الاحتواء والمحاور الثلاثة وخطة الدفعة الثانية)

## 38. نتائج الفحوص الفعلية للدفعة 40 (بشفافية تامة)
- `npm run sync:shared`: **نجحت المزامنة** (`functions/src/shared/realEstateDisclosures.ts`) ✅
- `npm --prefix functions run build`: **نجح بناء `functions` محلياً بدون أخطاء TypeScript** ✅
- تطابق العقود المشتركة (`diff -rq src/core/contracts functions/src/shared`): **`PARITY_OK`** ✅
- `npm test`: **288 اختباراً ناجحاً ضمن 47 مجموعة (288 ناجح، 0 فاشل، 0 متجاوز)** بما فيها جميع اختبارات القبول الـ 9 في `tests/realEstateDisclosuresFoundation.test.ts` ✅
- `compile_applet` (`vite build`) + `lint_applet` (`tsc --noEmit`): **ناجحة جميعها** ✅
- **الالتزام بالحدود:** لا واجهات، ولا كولكشن جديدة، ولا عمليات حفظ/حذف/استيراد، ولا تعديل على `firestore.rules` أو Cloud Functions أو `NetIncome`/`EPS`/`Equity`/التقييم/Adjusted NAV، ولا نشر أو تعديل على Firebase الإنتاجي.
- **حدود التحقق:** جميع اختبارات هذه الدفعة هي اختبارات وحدة ونقاء حسابي وبناء محلي للواجهة و`functions`؛ لم تُشغّل اختبارات متصفح حي أو محاكي Firestore (لعدم وجود واجهات أو قواعد أو دوال خادم جديدة وغياب Java Runtime في الحاوية).

---

## 39. سجل تنفيذ الدفعة 41 — دفعة تصحيح محدودة (منع قص نصوص توثيق العقارات + تثبيت Node 24 للدوال + تنظيف تحذير قواعد Firestore)
1. **ما نُفّذ وأسبابه (دون إعادة تنفيذ تصحيحات النسخة 40 المكتملة):**
   - **منع فقد نصوص توثيق الإفصاحات العقارية (`src/core/contracts/realEstateDisclosures.ts` ← مُزامَن إلى `functions/src/shared/realEstateDisclosures.ts`):**
     - تعريف الحدود المركزية `REAL_ESTATE_DISCLOSURE_TEXT_MAX_LENGTHS` (`assetUsageDescription: 240`, `fairValueSource: 240`, `footnoteReference: 160`, `explanatoryNote: 800`) وإعادة استخدامها في التحقق (`validateOptionalBoundedText`) وفي قاموس الحقول (`REAL_ESTATE_DISCLOSURE_FIELD_DICTIONARY`).
     - إزالة جميع استدعاءات `.slice(...)` الصامتة من `validateAndNormalizeRealEstateDisclosure`، ورفض أي نص متجاوز بحرف واحد أو أكثر برسالة عربية تذكر اسم الحقل والحد الأقصى والطول المدخل صراحةً، مع حفظ النص المقبول (بما فيه النص العربي ومتعدد الأسطر) كاملاً والحفاظ على التمييز بين النص المفقود (`null`) والقيمة المدخلة.
     - تحديث التوثيق في `docs/REAL_ESTATE_DISCLOSURES_FOUNDATION.md` وإضافة اختبار القبول رقم (10) في `tests/realEstateDisclosuresFoundation.test.ts`.
   - **تثبيت اعتماد Node 24 لبيئة الدوال (`functions/package.json`, `functions/package-lock.json`, `README.md`):**
     - تحديث `"engines": { "node": "24" }` في `functions/package.json` وتحديث بيانات `functions/package-lock.json` نظامياً عبر `npm --prefix functions install --package-lock-only --no-audit --no-fund --ignore-scripts` دون ترقيات حزم غير لازمة.
     - التحقق من خلو `firebase.json` من أي حقل `runtime` متعارض مع Node 24، وتحديث توثيق بيئة التشغيل في `README.md`.
   - **تنظيف تحذير قواعد Firestore (`firestore.rules`):**
     - التحقق عبر البحث الشامل في المستودع من أن الدالة المساعدة `hasValidUpdatedAt()` غير مستخدمة إطلاقاً في القواعد، وحذفها فقط دون تعديل أي قاعدة صلاحيات أو اسم `request` المدمج.

## 40. نتائج الفحوص الفعلية للدفعة 41 (بشفافية تامة)
- `npm run sync:shared`: **نجحت المزامنة** (`functions/src/shared/realEstateDisclosures.ts`) ✅
- `diff -rq src/core/contracts functions/src/shared`: **`PARITY_OK`** ✅
- `npm --prefix functions run build`: **نجح بناء `functions` محلياً بدون أخطاء TypeScript** ✅
- `npm test`: **289 اختباراً ناجحاً ضمن 47 مجموعة (289 ناجح، 0 فاشل، 0 متجاوز)** — متضمنة جميع اختبارات الهوية والتكرار والاحتواء والمقارنة ونصوص التوثيق الأربعة (الاختبار 10 الجديد) وثبات نتائج نماذج التقييم ومصادر البيانات وأولويات الافتراضات ✅
- `compile_applet` (`vite build`) + `lint_applet` (`tsc --noEmit`): **ناجحة جميعها** ✅
- `npm run test:emulator:rules` (محاكي Firestore بعد تعديل `firestore.rules`): **تعذّر التشغيل ولم تُحتسب ناجحة** — أظهر الفحص وجود `firebase CLI 15.34.1` مع غياب بيئة `Java Runtime (spawnSync java ENOENT)` داخل الحاوية، ورفض المشغّل السقوط إلى الإنتاج أو اعتبار الاختبارات غير المنفّذة ناجحة.
- **ملاحظة بيئة الحاوية حول Node 24:** بيئة الحاوية الحالية تعمل على `Node v22.23.2`، لذا صدر تحذير `npm warn EBADENGINE` المتوقع عند تحديث `functions/package-lock.json` لـ `node: "24"` دون أخطاء بناء؛ وتبقى أوامر إعادة البناء المحلية المعتمدة: `npm run sync:shared && npm --prefix functions run build && npm run lint && npm test && npm run build`.
- **الالتزام بالحدود:** لا واجهات، ولا كولكشن، ولا عمليات حفظ/ترحيل/تنظيف لبيانات محفوظة، ولا تعديل على معادلات الربح أو EPS أو حقوق الملكية أو نماذج التقييم، ولا نشر إلى Firebase أو تعديل بيانات الإنتاج.

---

## 41. سجل تنفيذ الدفعة 42 — الحفظ والتحديث الخادمي لسجل إفصاح عقاري واحد (`real_estate_disclosures`)
1. **ما نُفّذ وأسبابه (ضمن النطاق المحدد دون إعادة تنفيذ الدفعتين 40 و41):**
   - **تثبيت المجموعة وتصحيح المرجع المالي (`src/core/contracts/realEstateDisclosures.ts`, `docs/REAL_ESTATE_DISCLOSURES_FOUNDATION.md`):**
     - تثبيت ثابتي `REAL_ESTATE_DISCLOSURES_COLLECTION = 'real_estate_disclosures'` و`QUARTERLY_FINANCIAL_RECORDS_COLLECTION = 'quarterly_financial_records'`.
     - تصحيح جميع الإشارات التوثيقية والقاموسية من `quarterly_financials` إلى اسم المجموعة الفعلي `quarterly_financial_records`.
   - **تجزئة الأعمال القانونية (`src/core/contracts/hashing.ts`):**
     - إضافة فرع `'real_estate_disclosure'` في `computeRecordBusinessHash` يغطي جميع الحقول الموضوعية الـ 22 في العقد ويستثني الطوابع التشغيلية والتدقيقية (`createdAt`, `createdBy`, `updatedAt`, `updatedBy`, `serverUpdatedAt`, `revision`, `contentHash`, `importId`, `sourceFile`, `sourceSheet`, `schemaVersion`, `isDeleted`).
   - **وحدة المعاملة المستقلة القابلة للاختبار (`src/core/contracts/realEstateDisclosureTransaction.ts` + تصديرها في `src/core/contracts/index.ts` ومزامنتها في `functions/src/shared/`):**
     - تنفيذ `parseRealEstateDisclosureSaveRequest`, `extractAllowListedRealEstateDisclosureInput`, `evaluateRealEstateDisclosureLinkage`, `executeSaveRealEstateDisclosure`, و`createFirestoreAdminRealEstateDisclosureTransactionPort`.
     - تجريد مدخلات العميل عبر قائمة بيضاء صارمة (تجاهل أي حقول مشتقة أو تدقيقية مزوّرة مثل `linkedQuarterlyDocId`, `completenessStatus`, `revision`, `contentHash`, `createdBy`, `updatedBy`, `isDeleted`).
     - اشتقاق `docId`, `linkedQuarterlyDocId`, `completenessStatus`, `statusBreakdown`, و`contentHash` خادمياً بالكامل عبر الدوال المركزية (`validateAndNormalizeRealEstateDisclosure` و`buildRealEstateDisclosureDocId`).
     - التحقق التفاؤلي داخل معاملة Firestore (`runTransaction`): فحص وجود السجل، وشرط `mode: 'create' | 'update'` مع `expectedDocId` و`expectedRevision` و`expectedContentHash`، ورفض تغيير هوية المستند أثناء التحديث (`IDENTITY_MISMATCH`)، ومنع الكتابة عند عدم تغيّر المحتوى القانوني (`status: 'unchanged'`, `wroteToDatabase: false`, صفر كتابات)، ومنع إنشاء هوية موجودة بمحتوى مختلف (`ALREADY_EXISTS`)، ورفض التحديثات المتقادمة (`REVISION_MISMATCH` / `HASH_MISMATCH`).
     - التحقق الفعلي (قراءة فقط داخل المعاملة) من وجود `companies/{ticker.toLowerCase()}` و`quarterly_financial_records/{linkedQuarterlyDocId}` وتوافق `balanceSheetDate` مع `periodEndDate` دون إنشاء أي مستند مفقود تلقائياً ودون افتراض بداية سنة مالية أو نطاق قوائم غير موثق.
   - **ربط خادمي مصغّر داخل `functions/src/index.ts`:**
     - إضافة `operationType === 'real_estate_disclosure'` داخل `updateFinancialData` بإعادة استخدام بوابة الصلاحيات القائمة (`entry`: `admin` أو `data_entry` نشط فقط)، وتمرير التنفيذ إلى `executeSaveRealEstateDisclosure` وإرجاع `realEstateDisclosureReceipt` مع تحويل أخطاء التحقق إلى `invalid-argument` وأخطاء التعارض إلى `failed-precondition` (`code: 'real-estate-disclosure-conflict'`).
   - **قواعد الأمان (`firestore.rules`):**
     - إضافة `match /real_estate_disclosures/{disclosureId}` بـ `allow read: if isDataEntry();` و`allow write: if false;` دون المساس بأي مجموعة أخرى.
   - **الاختبارات (`tests/realEstateDisclosureWrite.test.ts`, `tests/emulator/realEstateDisclosureWrite.emulator.test.ts`, `tests/firestoreRules.test.ts`, `tests/emulator/firestoreRules.emulator.test.ts`, `scripts/runFirestoreEmulatorTests.mjs`, `package.json`):**
     - تغطية الإنشاء، والتحديث، وعدم الكتابة عند التكرار المتطابق (0 writes)، ورفض التحديث المتقادم والإنشاء المكرر بمحتوى مختلف وتغيير الهوية أثناء التحديث، وحفظ `0` و`null` والنصوص العربية ومتعددة الأسطر، ورفض النصوص المتجاوزة والرموز والمعرّفات غير الصالحة، وحفظ السجل الجزئي دون `complete_comparable`، وإبراز نقص الشركة أو السجل الفصلي أو تعارض التاريخ دون إنشاء تلقائي، ومنع الكتابة المباشرة من العميل وقصر القراءة على `admin` و`data_entry`.

## 42. نتائج الفحوص الفعلية للدفعة 42 (بشفافية تامة)
- `npm run sync:shared`: **نجحت المزامنة** (`src/core/contracts/*` → `functions/src/shared/*`) ✅
- `diff -rq src/core/contracts functions/src/shared`: **`PARITY_OK`** ✅
- `npm --prefix functions run build`: **نجح بناء `functions` محلياً بدون أخطاء TypeScript** ✅
- `npm test`: **297 اختباراً ناجحاً ضمن 48 مجموعة (297 ناجح، 0 فاشل، 0 متجاوز)** — متضمنة 8 اختبارات شاملة جديدة في `tests/realEstateDisclosureWrite.test.ts` وجميع اختبارات الإفصاحات العقارية وقواعد Firestore الثابتة ونماذج التقييم القائمة ✅
- `compile_applet` (`vite build`) + `lint_applet` (`tsc --noEmit`): **ناجحة جميعها** (ملاحظة مصحّحة: `npm run lint` يستخدم `tsconfig.json` الذي يقتصر على `"include": ["src"]`، وبالتالي يفحص أنواع `src/` فقط ولا يثبت فحص أنواع ملفات `tests/` أو `tests/emulator/`).
- **التمييز الصريح في نطاق الاختبارات المنفّذة:**
  - الاختبارات المنفّذة في `tests/realEstateDisclosureWrite.test.ts` تختبر **وحدة منطق المعاملة الإنتاجية المستقلة (`executeSaveRealEstateDisclosure`)** عبر منفذ معاملة ذاكري مُقاس (يرصد عدد الكتابات الفعلية بدقة) ولا تستدعي غلاف النقل والمصادقة `onCall` (`updateFinancialData`) على خادم Cloud Functions حي.
  - اختبارا المحاكي الفعليان (`npm run test:emulator:real_estate` و`npm run test:emulator:rules`): **تعذّر تشغيلهما في هذه الحاوية ولا يُحتسبان ناجحَين** بسبب غياب بيئة `Java Runtime (spawnSync java ENOENT)` رغم وجود `firebase CLI 15.34.1`؛ وهما جاهزان للتشغيل محلياً عند توفر JDK 17+.
- **الالتزام بالحدود:** لا واجهات، لا استيراد/تصدير Excel، لا حذف أو حفظ جماعي، لا ربط بالمزامنة العامة أو التقييم أو `Adjusted NAV`، ولا نشر إلى Firebase أو تعديل بيانات الإنتاج.

---

## 43. سجل تنفيذ دفعة تصحيح محدودة للنسخة 42 (إلزام `expectedDocId` عند التحديث + تصحيح اختبار المحاكي + صدق حالات الربط)
1. **إلزام هوية السجل الأصلي عند التحديث (`src/core/contracts/realEstateDisclosureTransaction.ts` ← مُزامَن إلى `functions/src/shared/`):**
   - تحويل `RealEstateDisclosureWritePrecondition` إلى اتحاد مميّز يُلزم تمرير `expectedDocId: string` صالح وغير فارغ عند `mode: "update"` (مع الإبقاء على إلزام `expectedRevision` أو `expectedContentHash`)، وعدم استنتاج `expectedDocId` من البيانات المعدّلة أبداً.
   - رفض أي تحديث يغيب فيه `expectedDocId` (حتى عند توفر `expectedRevision` و`expectedContentHash`) عبر `INCOMPLETE_PRECONDITION`، ومطابقة `expectedDocId` مع المعرّف المشتق قبل أي كتابة لرفض محاولة تحويل تعديل سجل `A` إلى سجل `B` (حتى لو تشاركا نفس `revision`) عبر `IDENTITY_MISMATCH` مع صفر كتابات وبقاء المستندين دون تغيير.
   - الحفاظ الكامل على سلوك `mode: "create"`، وعدم الكتابة عند عدم التغيير (`status: "unchanged"`, `wroteToDatabase: false`)، وبقية تعارضات التزامن.
2. **تصحيح اختبار المحاكي وإضافة فحص أنواع مستهدف للاختبارات (`tests/emulator/realEstateDisclosureWrite.emulator.test.ts`, `package.json`):**
   - استبدال الاستدعاءات غير القائمة بواجهة `tests/emulator/emulatorHarness.ts` الفعلية: `createEmulatorAdminContext`, `EmulatorAdminContext`, `resetDatabase`, `cleanup` مع الإبقاء التام على حواجز الأمان (`FIRESTORE_EMULATOR_HOST` ومشروع `demo-*` فقط ومنع التجاوز الصامت).
   - إضافة السكربت المستهدف `npm run lint:real_estate_tests` لفحص أنواع ملفات اختبارات الإفصاحات والقواعد والمحاكي المحددة (`tests/realEstateDisclosureWrite.test.ts`, `tests/emulator/realEstateDisclosureWrite.emulator.test.ts`, `tests/emulator/emulatorHarness.ts`, `tests/emulator/firestoreRules.emulator.test.ts`, `tests/firestoreRules.test.ts`) دون توسيع `tsconfig.json` لبقية الاختبارات القديمة.
3. **تصحيح صدق حالات الربط المرجعي (`evaluateRealEstateDisclosureLinkage` في `src/core/contracts/realEstateDisclosureTransaction.ts`):**
   - فصل **وجود وثيقة الشركة (`companyExists`)** عن **صلاحية وتطابق هويتها (`companyLinkStatus`)**: `verified` | `missing_company` | `unverified_company_identity` (رمز سهم مفقود أو غير صالح) | `company_ticker_conflict` (تعارض `ticker` أو `id`).
   - فصل **وجود السجل المالي المرجعي (`quarterlyRecordExists`)** عن **صلاحية وتطابق هويته وتاريخه (`quarterlyLinkStatus`)**: التحقق الفعلي من `ticker` و`year` و`quarter` و`periodEndDate`؛ القيم المفقودة أو غير الصالحة تعطي `unverified_quarterly_identity` أو `unverified_quarterly_period_end_date` ولا تتحول أبداً إلى `verified`، والاختلاف الصريح يعطي `ticker_conflict` أو `period_conflict` أو `date_conflict`.
   - دعم السنوات المالية غير التقويمية الموثّقة (مثل `2024-07-01` إلى `2025-06-30`) دون افتراض بداية سنة مالية أو نهاية فترة أو نطاق قوائم غير موثّق، مع استمرار حفظ الإفصاح الجزئي الصحيح بنيوياً وإرجاع تحذيرات الربط دون تعديل أو إنشاء أي مستند مرجعي.

## 44. نتائج الفحوص الفعلية لدفعة التصحيح (بشفافية تامة)
- `npm run sync:shared` + `diff -rq src/core/contracts functions/src/shared`: **نجحت المزامنة وتطابق تام (`PARITY_OK`)** ✅
- `npm --prefix functions run build`: **نجح بناء `functions` بدون أخطاء TypeScript** ✅
- `npm run lint` (`tsc --noEmit` — يفحص `src/` فقط وفق `tsconfig.json`): **نجح بدون أخطاء** ✅
- `npm run lint:real_estate_tests` (فحص أنواع مستهدف لملفات اختبارات الإفصاحات والمحاكي والقواعد الخمسة فقط؛ لا يغطي بقية ملفات `tests/` القديمة): **نجح بدون أخطاء** ✅
- `npm test`: **297 اختباراً ناجحاً ضمن 48 مجموعة (297 ناجح، 0 فاشل، 0 متجاوز)** — متضمنة اختبارات القبول الجديدة لإلزام `expectedDocId`، ومنع تحويل `A` إلى `B` عند نفس المراجعة، وصدق حالات الربط (رمز غير صالح، هوية ناقصة، سنة/ربع متعارض، ربط صحيح، وسنة مالية غير تقويمية موثّقة) ✅
- `compile_applet` (`vite build`): **نجح بناء الواجهة** ✅
- **التحقق الفعلي من استيراد وحواجز أمان ملف اختبار المحاكي (`tests/emulator/realEstateDisclosureWrite.emulator.test.ts`):** تحميل الملف بـ `tsx` يعمل بلا أخطاء استيراد ويرفض التشغيل فوراً عبر حاجز الأمان `[EMULATOR_BLOCKER] FIRESTORE_EMULATOR_HOST is not set` دون اتصال بالإنتاج.
- **تشغيل اختبارات المحاكي (`npm run test:emulator:real_estate` ثم `npm run test:emulator` كاملة):** **تعذّر التشغيل (كود الخروج `1` في الحالتين) ولا يُحتسبان ناجحَين** بسبب غياب `Java Runtime (spawnSync java ENOENT)` داخل الحاوية (مع توفر `firebase CLI 15.34.1`)؛ حافظ المشغّل على حاجز الأمان ورفض السقوط إلى الإنتاج أو التجاوز الصامت.
- **التمييز الصريح في نطاق الاختبار:** اختبارات الوحدة اختبرت **خدمة المعاملة الإنتاجية المستقلة (`executeSaveRealEstateDisclosure`)** عبر منفذ معاملة ذاكري مُقاس؛ ولم يُختبر غلاف `onCall` (`updateFinancialData`) أو محاكي Firestore الحي داخل هذه الحاوية.

---

## 45. سجل تنفيذ الدفعة 44 — قراءة ومزامنة الإفصاحات العقارية (`real_estate_disclosures`) داخل البنية المركزية القائمة
1. **عقد القراءة والمحوّل غير المعدِّل ودامج الدلتا والربط المرجعي الصادق (`src/core/domain/realEstateDisclosureRead.ts`):**
   - فصل تام بين سجل القراءة (`RealEstateDisclosureReadRecord`) وحمولة إدخال العميل (`RealEstateDisclosureInput`) مع إعادة استخدام `REAL_ESTATE_DISCLOSURES_COLLECTION` وقواعد الهوية والفترات والرموز من `src/core/contracts/`.
   - حفظ `docId`، `docPath`، `storedDocId`، `revision`، `contentHash`، وبيانات التدقيق (`createdAt`, `createdBy`, `updatedAt`, `updatedBy`, `serverUpdatedAt`, `serverUpdatedAtMs`, `isDeleted`, `schemaVersion`) تمهيداً للتعديل المتزامن لاحقاً.
   - تحويل غير معدِّل بالكامل: لا يكتب إلى Firestore أثناء القراءة، ولا يُسقط أي سجل بسبب رمز غير معروف أو حقل غير صالح (`readIntegrityStatus: 'needs_review'` مع `unrecognizedFields` و`readIssues` وحفظ القيم الخام)، ويحافظ بدقة على `0` مقابل `null`، و`false` مقابل `null`، والنصوص العربية ومتعددة الأسطر كاملةً دون `.slice()`.
   - إعادة استخدام `evaluateRealEstateDisclosureLinkage` المركزية على جانب القراءة مع فهارس `Map` خطية `O(N)` فوق `companies` و`quarterly_financial_records` المحمّلة في الجلسة (صفر قراءات N+1)، وتقييد حالات النقص (`missing_company` / `missing_quarterly_record`) والتأكيد (`verified`) بـ `companiesConfirmed` و`quarterlyConfirmed` (`pending_source_confirmation` و`source_load_failed` قبل التأكيد)، مع بصمة حداثة `sourcesVersion` ودالة `isRealEstateLinkageSnapshotFresh`.
2. **الدمج داخل البنية المركزية القائمة (دون مستودع أو محرك مزامنة موازٍ ودون واجهات جديدة):**
   - `src/services/storage/indexedDbStore.ts` و`src/services/storage/cacheService.ts`: إضافة `'realEstateDisclosures'` إلى `SyncCollectionKey`، وتخزين نطاقي معزول بـ `(schemaVersion, projectId, databaseId, uid)`، وإضافة `removeCollectionFromScopedIndexedDbState` و`CacheService.clearRealEstateDisclosuresCache()` للتنظيف الموضعي عند سحب الصلاحية دون مساس ببقية المجموعات.
   - `src/services/firebase/firestoreTransforms.ts` و`src/services/firebase/firestoreRepositories.ts`: تسجيل `COLLECTIONS.REAL_ESTATE_DISCLOSURES` وإضافة `mapRealEstateDisclosuresSnapshot` و`getAllRealEstateDisclosuresWithMeta` و`fetchRealEstateDisclosureDeltasFromServer`.
   - `src/services/firebase/firestoreSync.ts` و`src/services/firebase/firestoreService.ts`: إضافة `syncRealEstateDisclosuresIncremental` ودمج المجموعة في `syncAllIncrementalDeltas` و`subscribeToAll` بمؤشر مستقل على `serverUpdatedAt` ونافذة التداخل `CURSOR_OVERLAP_MS = 15_000`، ومنع تقديم المؤشر أو تثبيت خط الأساس قبل نجاح الدمج (`onConfirmedMerge`) والالتزام الذري في IndexedDB، مع عزل تام لأخطاء المجموعة عن بقية المجموعات الـ 14.
   - `src/core/domain/firestoreSessionManager.ts` و`src/hooks/useFirestoreSession.ts`: إضافة `companiesConfirmed` و`companiesError` وحقول حالة الإفصاحات العقارية (`loading`, `cached_unconfirmed`, `confirmed`, `confirmed_empty`, `permission_denied`, `error`, `unauthorized`, `idle`) مع عزل أخطائها عن `connectionError` العام، وإضافة `revokeRealEstateDisclosuresAccess`، وعدم بدء أي قراءة أو اشتراك لغير `admin`/`data_entry` النشطين، وتنظيف الذاكرة والكاش عند تسجيل الخروج وتبديل المستخدم وسحب الصلاحية، وإتاحة `realEstateDisclosuresState` (بما فيها `linkage`) في عقد الجلسة دون إضافة أي واجهات.
3. **الاختبارات (`tests/realEstateDisclosureReadSync.test.ts` + `package.json`):**
   - إضافة 8 اختبارات قبول شاملة تغطي: التحميل الأولي الكامل والجزئي وعدم التعديل، حفظ `0`/`null`/`false` والنصوص الكاملة، بقاء القيم غير المعروفة والشاذة قابلة للمراجعة، التمييز بين جميع حالات التحميل والخطأ وعزلها، المزامنة التزايدية ونافذة `15s` وإزالة التكرار والحذف الناعم وحراس المؤشر عند رفض الدمج أو فشل التخزين الذري، الصلاحيات وتسجيل الخروج وتبديل الحساب وسحب الصلاحية والردود المتأخرة، الربط المرجعي الصادق والحداثة، وعدم تراجع قواعد `firestore.rules`.

## 46. نتائج الفحوص الفعلية للدفعة 44 (بشفافية تامة)
- `diff -rq src/core/contracts functions/src/shared`: **`PARITY_OK`** (لم تُعدّل `src/core/contracts/` أو `functions/` أو `firestore.rules` في هذه الدفعة) ✅
- `npm run lint` / `lint_applet` (`tsc --noEmit` — يفحص `src/` فقط): **نجح بدون أخطاء** ✅
- `npm run lint:real_estate_tests` (فحص أنواع مستهدف لـ 6 ملفات اختبارات الإفصاحات والقواعد والمحاكي متضمنة `tests/realEstateDisclosureReadSync.test.ts`): **نجح بدون أخطاء** ✅
- `npm test`: **305 اختبارات ناجحة ضمن 48 مجموعة (305 ناجح، 0 فاشل، 0 متجاوز)** — متضمنة 8 اختبارات جديدة في `tests/realEstateDisclosureReadSync.test.ts` وجميع الاختبارات القائمة ✅
- `compile_applet` (`vite build`): **نجح بناء الواجهة بدون أخطاء** ✅
- **تشغيل اختبارات المحاكي (`npm run test:emulator:rules` و`npm run test:emulator:real_estate`):** **تعذّر التشغيل (رمز الخروج `1` في الحالتين) ولا يُحتسبان ناجحَين** بسبب غياب `Java Runtime (spawnSync java ENOENT)` داخل الحاوية (مع توفر `firebase CLI 15.34.1`)؛ حافظ المشغّل على حاجز الأمان ورفض السقوط إلى الإنتاج.
- **التمييز الصريح في نطاق التحقق:** اختبرت `tests/realEstateDisclosureReadSync.test.ts` وحدات التحويل والدمج وإدارة الجلسة والكاش النطاقي ومحرك المزامنة التزايدية والربط المرجعي محلياً عبر منافذ اختبار ذاكرية (`createMemoryAtomicPersistenceDriver` + `RealEstateDisclosuresFetchPort` + لقطات اختبارية)، ولم تُشغَّل ضد خادم Firestore حي أو محاكي Firestore (لغياب Java في الحاوية).
- **الالـتزام بالحدود:** لا واجهات جديدة، لا إدخال/تعديل/حذف/حفظ جماعي، لا استيراد/تصدير Excel، لا تعديل على معادلات الربح أو EPS أو حقوق الملكية أو التقييم أو `Adjusted NAV`، لا تخفيف في `firestore.rules`، ولا نشر أو كتابة إلى Firebase الإنتاجي.

---

## 47. سجل تنفيذ دفعة تصحيح محدودة لسلامة قراءة ومزامنة الإفصاحات العقارية (تحصين النسخة 44)
1. **عزل الحفظ غير المتزامن بنطاق المستخدم وحراس العملية (`src/services/storage/cacheService.ts`, `src/services/firebase/firestoreTransforms.ts`, `src/services/firebase/firestoreSync.ts`, `src/hooks/useFirestoreSession.ts`):**
   - **السبب الجذري:** كانت `persistCollectionDeltaAtomically` و`persistBatchDeltaAtomically` تقرأ `this.getScopeKey()` قبل `await` ثم تكتب المؤشر و`baselineConfirmed` بعد `await` على النطاق النشط وقت الاكتمال، ما يسمح بتسرب مؤشرات و`baseline` الحساب `A` إلى الحساب `B` عند تبديل الحساب أثناء التخزين، أو إعادة ملء الكاش بعد تسجيل الخروج أو سحب الصلاحية؛ كما لم تكن مسارات المزامنة المفردة (`syncRealEstateDisclosuresIncremental`) والجماعية (`syncAllIncrementalDeltas`) والاشتراك (`subscribeToAll`) تعيد التحقق من صلاحية الجلسة بعد اكتمال `await` التخزين.
   - **الإصلاح:**
     - إضافة حارس العملية `CacheOperationGuard` (`scopeKey`, `scopeEpoch`, `scopeClearEpoch`, `collectionEpochs`) مع دالتي `CacheService.captureOperationGuard` و`CacheService.isOperationGuardValid` وزيادة عدادات الإبطال عند تبديل النطاق ومسح النطاق ومسح `realEstateDisclosures`.
     - ربط `persistCollectionDeltaAtomically` و`persistBatchDeltaAtomically` و`setCollectionDeltaCursorMs` و`setCollectionBaselineConfirmed` و`setDeltaCursorMs` و`setLastCheckedAt` و`saveRealEstateDisclosures` بـ `expectedScopeKey` و`operationGuard` و`isStillValid` / `isCollectionValid`؛ التحقق قبل وبعد `await` وتنظيف أي إدخال IndexedDB قديم في حال إبطال النطاق أو المجموعة أثناء الانتظار دون المساس ببقية المجموعات الصالحة.
     - توحيد مسار الاشتراك عبر `FirestoreSyncManager.persistSubscriptionCollectionSnapshot` مع التحقق بعد `await` في جميع المسارات الثلاثة (المفرد، الجماعي، والاشتراك)، ومنع إرجاع `status: "synced"` لأي جلسة انتهت أو تبدّل حسابها أو سُحبت صلاحيتها أثناء العملية.
2. **تصحيح أولوية الحذف الحتمية عبر المسار الكامل (`src/core/domain/realEstateDisclosureRead.ts`, `src/services/firebase/firestoreTransforms.ts`, `src/core/domain/firestoreSessionManager.ts`, `src/services/firebase/firestoreSync.ts`):**
   - **السبب الجذري:** كانت `mergeRealEstateDisclosureDeltas` تنفّذ مرورين منفصلين يسمحان لقائمة `deletedDocIds` العارية (`tombMs = 0`) بمسح سجل نشط أحدث (`revision = 3, t = 300000`) حتى بعد رفض وثيقة حذف أقدم (`revision = 2, t = 200000`)؛ كما لم تكن `mapRealEstateDisclosuresSnapshot` تنقل طوابع/مراجعات علامات الحذف صراحةً.
   - **الإصلاح:**
     - إضافة `RealEstateDisclosureDeletionMarker` و`createDeletionMarkerFromReadRecord` وحمل `deletedMarkers` من `mapRealEstateDisclosuresSnapshot` عبر `FirestoreSyncManager` و`FirestoreSessionManager` إلى الدامج المركزي.
     - إعادة بناء `mergeRealEstateDisclosureDeltas` فوق محلّل أولوية موحّد وحتمي مستقل عن ترتيب الوصول (`resolveRealEstateDisclosureMerge`) يقارن أفضل نسخة نشطة بأفضل علامة حذف لكل `docId` حسب الطابع الزمني الخادمي ثم `updatedAt` ثم `revision`، ويمنع `deletedDocIds` العارية من تجاوز علامة حذف مؤرخة/مراجعة أقدم، ويُظهر الحالات فاقدة بيانات الترتيب أو غير القابلة للمقارنة صراحةً (`kept_active_missing_delete_ordering` و`kept_active_incomparable_delete_ordering` ضمن `decisionsByDocId` و`unresolvedDeletions`) دون حذف صامت.
3. **معالجة `permission-denied` وعزلها واستعادة الوصول بعد إعادة التحقق (`src/core/domain/firestoreSessionManager.ts`, `src/services/firebase/firestoreSync.ts`, `src/hooks/useFirestoreSession.ts`):**
   - عند رفض قراءة `real_estate_disclosures` برمز `permission-denied` في **الاشتراك الحي** أو **المزامنة اليدوية**: يتم فوراً سحب الصلاحية داخل الجلسة (`realEstateDisclosuresAuthorized: false`)، وتصفير السجلات بالذاكرة (`[]`)، وحالة `permission_denied`، ومسح الكاش النطاقي ومؤشره و`baseline` وIndexedDB للمجموعة وحدها (`CacheService.clearRealEstateDisclosuresCache`) وفك اشتراك مستمع المجموعة دون المساس ببقية المجموعات الـ 14 أو `connectionError` العام.
   - رفض أي لقطة أو دلتا متأخرة بعد الرفض (`reason: "unauthorized"`)، وعدم إعادة محاولة المجموعة في `handleManualSync` طالما `realEstateDisclosuresAuthorized === false`.
   - الإبقاء على فصل تام عن أخطاء الشبكة/عدم الاتصال (`unavailable` لا تسحب الصلاحية وتتعافى تلقائياً بأول لقطة مؤكدة من الخادم).
   - إضافة `FirestoreSessionManager.restoreRealEstateDisclosuresAccess(token, { user })` لاستعادة الصلاحية فقط بعد التحقق الفعلي من دور نشط مصرح به (`admin`/`data_entry`) والبدء من حالة نظيفة (`records: []`, `confirmed: false`, `status: 'loading'`) حتى تصل لقطة خادمية مؤكدة جديدة.

## 48. نتائج الفحوص الفعلية لدفعة تحصين النسخة 44 (بشفافية تامة)
- `diff -rq src/core/contracts functions/src/shared`: **`PARITY_OK`** (لم تُعدّل `src/core/contracts/` أو `functions/` أو `firestore.rules` في هذه الدفعة) ✅
- `npm run lint` / `lint_applet` (`tsc --noEmit` — يفحص `src/` فقط وفق `tsconfig.json`): **نجح بدون أخطاء** ✅
- `npm run lint:real_estate_tests` (فحص أنواع مستهدف لـ 6 ملفات اختبارات الإفصاحات والقواعد والمحاكي متضمنة `tests/realEstateDisclosureReadSync.test.ts`): **نجح بدون أخطاء** ✅
- `npm test`: **310 اختبارات ناجحة ضمن 48 مجموعة (310 ناجح، 0 فاشل، 0 متجاوز)** — متضمنة 5 اختبارات قبول وانحدار جديدة (`Batch 44.9` إلى `Batch 44.13`) تغطي عزل التخزين غير المتزامن عبر المسار المفرد والجماعي والاشتراك وانحدار المجموعات الأخرى، وأولوية الحذف عبر المسار الكامل (المحوّل ← الدامج ← المزامنة/الجلسة)، ومعالجة `permission-denied` وعزلها واستعادة الصلاحية بعد إعادة التحقق ✅
- `compile_applet` (`vite build`): **نجح بناء الواجهة بدون أخطاء** ✅
- **تشغيل اختبارات المحاكي (`npm run test:emulator:rules` و`npm run test:emulator:real_estate`):** **تعذّر التشغيل (رمز الخروج `1` في الحالتين) ولا يُحتسبان ناجحَين** بسبب غياب `Java Runtime (spawnSync java ENOENT)` داخل الحاوية (مع توفر `firebase CLI 15.36.0`)؛ حافظ المشغّل على حاجز الأمان ورفض السقوط إلى الإنتاج.
- **التمييز الصريح في نطاق التحقق:** اختبرت `tests/realEstateDisclosureReadSync.test.ts` المسارات الإنتاجية للتحويل والدمج والكاش والـ IndexedDB الذري (بمحرك اختباري قابل للتعليق أثناء `await`) ومحرك المزامنة المفرد والجماعي والاشتراك وإدارة الجلسة محلياً، ولم تُشغَّل ضد خادم Firestore حي أو محاكي Firestore (لغياب Java في الحاوية).
- **الالتزام بالحدود:** لا واجهات جديدة، لا استيراد/تصدير Excel، لا عملية حذف خادمية جديدة، لا تعديل على معادلات التقييم أو `NetIncome`/`EPS`/`Equity`، لا تعديل على `firestore.rules` أو `functions/`، ولا نشر أو تعديل لبيانات الإنتاج.
