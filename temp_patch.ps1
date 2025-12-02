$patch = @"
*** Begin Patch
*** Update File: src/components/Tabs.tsx
@@
-        const statsOptionsForDisplay = (() => {
-          if ((isSingleSelect && !isMultiSelect && !isNumericQuestion && !isNumericGrid) || isSingleSelectGrid) {
-            return statsCheckboxes.filter(option => option.key === 'mean');
-          }
-          return statsCheckboxes;
-        })();
+        const statsOptionsForDisplay = (() => {
+          if ((isSingleSelect && !isMultiSelect && !isNumericQuestion && !isNumericGrid) || isSingleSelectGrid) {
+            return statsCheckboxes.filter(option => option.key === 'mean');
+          }
+          return statsCheckboxes;
+        })();
*** End Patch
"@
$patch | git apply
