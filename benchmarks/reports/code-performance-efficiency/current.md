# Code Performance Efficiency Report

Generated: 2026-06-17T05:22:06.910Z
Node: v22.17.1

## Summary

- FTS decision: contentless FTS experiment does not cross the DB-size adoption threshold in this run; keep current schema and revisit with stronger latency evidence
- Build decision: build/typecheck measured for tracking; keep clean build/typecheck commands until duplicate compiler work is a measured bottleneck

## Scales

### 3000 files

- Index time: 363.0 ms
- Current DB size: 6012928 bytes
- Contentless FTS experiment size: 4554752 bytes (-24.3%)
- code_status: median 194.0 ms, p95 194.0 ms (3 runs)
- code_context_pack: median 198.2 ms, p95 198.6 ms (3 runs)
- code_impact: median 199.0 ms, p95 203.2 ms (3 runs)
- code_report_coverage: median 190.2 ms, p95 192.0 ms (3 runs)

### 10000 files

- Index time: 846.8 ms
- Current DB size: 20226048 bytes
- Contentless FTS experiment size: 15175680 bytes (-25.0%)
- code_status: median 352.0 ms, p95 353.4 ms (3 runs)
- code_context_pack: median 360.8 ms, p95 367.0 ms (3 runs)
- code_impact: median 375.8 ms, p95 380.5 ms (3 runs)
- code_report_coverage: median 348.1 ms, p95 351.9 ms (3 runs)

### 50000 files

- Index time: 5122.2 ms
- Current DB size: 101785600 bytes
- Contentless FTS experiment size: 76496896 bytes (-24.8%)
- code_status: median 2869.6 ms, p95 2909.9 ms (3 runs)
- code_context_pack: median 3018.4 ms, p95 3196.1 ms (3 runs)
- code_impact: median 3066.6 ms, p95 3135.8 ms (3 runs)
- code_report_coverage: median 3045.7 ms, p95 3159.1 ms (3 runs)

## Query Plans

### 3000 files
- file_prefix_like: SCAN files USING COVERING INDEX sqlite_autoindex_files_1
- file_contains_like: SCAN files USING COVERING INDEX sqlite_autoindex_files_1
- symbol_contains_like: SCAN symbols USING INDEX idx_symbols_file | USE TEMP B-TREE FOR LAST TERM OF ORDER BY
- route_contains_like: SCAN routes | USE TEMP B-TREE FOR ORDER BY
- import_contains_like: SCAN imports USING INDEX idx_imports_from | USE TEMP B-TREE FOR LAST TERM OF ORDER BY
### 10000 files
- file_prefix_like: SCAN files USING COVERING INDEX sqlite_autoindex_files_1
- file_contains_like: SCAN files USING COVERING INDEX sqlite_autoindex_files_1
- symbol_contains_like: SCAN symbols USING INDEX idx_symbols_file | USE TEMP B-TREE FOR LAST TERM OF ORDER BY
- route_contains_like: SCAN routes | USE TEMP B-TREE FOR ORDER BY
- import_contains_like: SCAN imports USING INDEX idx_imports_from | USE TEMP B-TREE FOR LAST TERM OF ORDER BY

### 50000 files
- file_prefix_like: SCAN files USING COVERING INDEX sqlite_autoindex_files_1
- file_contains_like: SCAN files USING COVERING INDEX sqlite_autoindex_files_1
- symbol_contains_like: SCAN symbols USING INDEX idx_symbols_file | USE TEMP B-TREE FOR LAST TERM OF ORDER BY
- route_contains_like: SCAN routes | USE TEMP B-TREE FOR ORDER BY
- import_contains_like: SCAN imports USING INDEX idx_imports_from | USE TEMP B-TREE FOR LAST TERM OF ORDER BY
