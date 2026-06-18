# Code Performance Efficiency Report

Generated: 2026-06-17T23:49:23.813Z
Node: v22.19.0

## Summary

- FTS decision: contentless FTS experiment does not cross the DB-size adoption threshold in this run; keep current schema and revisit with stronger latency evidence
- Build decision: build/typecheck measured for tracking; keep clean build/typecheck commands until duplicate compiler work is a measured bottleneck

## Scales

### 3000 files

- Index time: 401.2 ms
- Current DB size: 6049792 bytes
- Contentless FTS experiment size: 4591616 bytes (-24.1%)
- code_status: median 149.2 ms, p95 151.9 ms (3 runs)
- code_context_pack: median 154.3 ms, p95 156.6 ms (3 runs)
- code_impact: median 161.1 ms, p95 163.3 ms (3 runs)
- code_report_coverage: median 146.8 ms, p95 147.7 ms (3 runs)

### 10000 files

- Index time: 951.6 ms
- Current DB size: 20336640 bytes
- Contentless FTS experiment size: 15286272 bytes (-24.8%)
- code_status: median 216.1 ms, p95 218.4 ms (3 runs)
- code_context_pack: median 232.0 ms, p95 235.5 ms (3 runs)
- code_impact: median 251.7 ms, p95 253.3 ms (3 runs)
- code_report_coverage: median 203.3 ms, p95 206.2 ms (3 runs)

### 50000 files

- Index time: 4450.5 ms
- Current DB size: 102354944 bytes
- Contentless FTS experiment size: 77066240 bytes (-24.7%)
- code_status: median 632.7 ms, p95 632.9 ms (3 runs)
- code_context_pack: median 721.2 ms, p95 724.8 ms (3 runs)
- code_impact: median 784.0 ms, p95 787.7 ms (3 runs)
- code_report_coverage: median 633.2 ms, p95 637.8 ms (3 runs)

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

## Query Groups

Direct DB query timings exclude CLI startup and staleness checks.

### 3000 files
- file_search_path: median 1.1 ms, p95 1.6 ms, rows 1 (3 runs)
- symbol_search_single_token: median 2.2 ms, p95 2.4 ms, rows 1 (3 runs)
- symbol_search_multi_token: median 2.3 ms, p95 2.4 ms, rows 1 (3 runs)
- route_contains: median 0.4 ms, p95 0.5 ms, rows 0 (3 runs)
- import_contains: median 0.5 ms, p95 0.5 ms, rows 75 (3 runs)
- edge_contains: median 1.3 ms, p95 1.3 ms, rows 100 (3 runs)

### 10000 files
- file_search_path: median 2.6 ms, p95 2.6 ms, rows 1 (3 runs)
- symbol_search_single_token: median 6.5 ms, p95 7.1 ms, rows 1 (3 runs)
- symbol_search_multi_token: median 6.8 ms, p95 7.0 ms, rows 1 (3 runs)
- route_contains: median 0.4 ms, p95 0.5 ms, rows 0 (3 runs)
- import_contains: median 0.4 ms, p95 0.5 ms, rows 75 (3 runs)
- edge_contains: median 3.2 ms, p95 3.5 ms, rows 100 (3 runs)

### 50000 files
- file_search_path: median 12.3 ms, p95 12.4 ms, rows 1 (3 runs)
- symbol_search_single_token: median 36.1 ms, p95 36.3 ms, rows 1 (3 runs)
- symbol_search_multi_token: median 36.6 ms, p95 36.9 ms, rows 1 (3 runs)
- route_contains: median 0.5 ms, p95 0.6 ms, rows 0 (3 runs)
- import_contains: median 0.5 ms, p95 0.5 ms, rows 75 (3 runs)
- edge_contains: median 16.1 ms, p95 16.1 ms, rows 100 (3 runs)
