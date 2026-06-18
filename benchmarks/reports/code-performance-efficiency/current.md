# Code Performance Efficiency Report

Generated: 2026-06-18T02:35:21.261Z
Node: v22.19.0

## Summary

- FTS decision: contentless FTS experiment does not cross the DB-size adoption threshold in this run; keep current schema and revisit with stronger latency evidence
- Build decision: build/typecheck measured for tracking; keep clean build/typecheck commands until duplicate compiler work is a measured bottleneck

## Scales

### 3000 files

- Index time: 469.4 ms
- Current DB size: 6049792 bytes
- Contentless FTS experiment size: 4591616 bytes (-24.1%)
- code_status: median 154.0 ms, p95 154.2 ms (3 runs)
- code_context_pack: median 186.9 ms, p95 190.1 ms (3 runs)
- code_impact: median 165.0 ms, p95 172.8 ms (3 runs)
- code_report_coverage: median 155.1 ms, p95 157.3 ms (3 runs)

### 10000 files

- Index time: 1066.2 ms
- Current DB size: 20336640 bytes
- Contentless FTS experiment size: 15286272 bytes (-24.8%)
- code_status: median 201.3 ms, p95 201.7 ms (3 runs)
- code_context_pack: median 217.2 ms, p95 220.4 ms (3 runs)
- code_impact: median 231.7 ms, p95 236.0 ms (3 runs)
- code_report_coverage: median 199.6 ms, p95 201.1 ms (3 runs)

### 50000 files

- Index time: 4363.0 ms
- Current DB size: 102354944 bytes
- Contentless FTS experiment size: 77066240 bytes (-24.7%)
- code_status: median 598.4 ms, p95 598.9 ms (3 runs)
- code_context_pack: median 678.5 ms, p95 688.9 ms (3 runs)
- code_impact: median 733.9 ms, p95 737.6 ms (3 runs)
- code_report_coverage: median 599.3 ms, p95 600.9 ms (3 runs)

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
- file_search_path: median 1.3 ms, p95 1.7 ms, rows 1 (3 runs)
- symbol_search_single_token: median 2.2 ms, p95 2.3 ms, rows 1 (3 runs)
- symbol_search_multi_token: median 2.6 ms, p95 2.8 ms, rows 1 (3 runs)
- route_contains: median 0.4 ms, p95 0.6 ms, rows 0 (3 runs)
- import_contains: median 0.4 ms, p95 0.5 ms, rows 75 (3 runs)
- edge_contains: median 1.3 ms, p95 1.5 ms, rows 100 (3 runs)

### 10000 files
- file_search_path: median 2.7 ms, p95 2.7 ms, rows 1 (3 runs)
- symbol_search_single_token: median 6.7 ms, p95 6.8 ms, rows 1 (3 runs)
- symbol_search_multi_token: median 8.4 ms, p95 8.5 ms, rows 1 (3 runs)
- route_contains: median 0.4 ms, p95 0.5 ms, rows 0 (3 runs)
- import_contains: median 0.4 ms, p95 0.5 ms, rows 75 (3 runs)
- edge_contains: median 3.4 ms, p95 3.4 ms, rows 100 (3 runs)

### 50000 files
- file_search_path: median 11.6 ms, p95 11.7 ms, rows 1 (3 runs)
- symbol_search_single_token: median 32.5 ms, p95 33.8 ms, rows 1 (3 runs)
- symbol_search_multi_token: median 41.5 ms, p95 41.9 ms, rows 1 (3 runs)
- route_contains: median 0.4 ms, p95 0.7 ms, rows 0 (3 runs)
- import_contains: median 0.4 ms, p95 0.6 ms, rows 75 (3 runs)
- edge_contains: median 15.3 ms, p95 15.6 ms, rows 100 (3 runs)

## Sample Corpora

Checked-in sample corpora are measured separately from synthetic scale fixtures.

### mixed-monorepo (mixed)
- Indexed files: 16
- Index time: 118.5 ms
- Current DB size: 122880 bytes
- code_status: median 105.6 ms, p95 105.8 ms (3 runs)
- code_files: median 105.6 ms, p95 106.1 ms (3 runs)
- code_search_symbol: median 110.1 ms, p95 111.0 ms (3 runs)
- code_context_pack: median 111.4 ms, p95 112.0 ms (3 runs)
- query file_search_path: median 0.4 ms, rows 2 (3 runs)
- query symbol_search_single_token: median 0.4 ms, rows 7 (3 runs)
- query symbol_search_multi_token: median 0.7 ms, rows 6 (3 runs)
- query route_contains: median 0.3 ms, rows 2 (3 runs)
- query import_contains: median 0.4 ms, rows 8 (3 runs)
- query edge_contains: median 0.3 ms, rows 10 (3 runs)

### web-service (service)
- Indexed files: 10
- Index time: 115.3 ms
- Current DB size: 114688 bytes
- code_status: median 106.2 ms, p95 108.6 ms (3 runs)
- code_files: median 105.0 ms, p95 105.4 ms (3 runs)
- code_search_symbol: median 110.4 ms, p95 110.7 ms (3 runs)
- code_context_pack: median 111.2 ms, p95 111.4 ms (3 runs)
- query file_search_path: median 0.4 ms, rows 2 (3 runs)
- query symbol_search_single_token: median 0.5 ms, rows 3 (3 runs)
- query symbol_search_multi_token: median 0.6 ms, rows 2 (3 runs)
- query route_contains: median 0.4 ms, rows 5 (3 runs)
- query import_contains: median 0.3 ms, rows 1 (3 runs)
- query edge_contains: median 0.4 ms, rows 5 (3 runs)

### python-cli (single-language)
- Indexed files: 6
- Index time: 109.6 ms
- Current DB size: 114688 bytes
- code_status: median 105.0 ms, p95 105.6 ms (3 runs)
- code_files: median 104.6 ms, p95 105.0 ms (3 runs)
- code_search_symbol: median 105.3 ms, p95 105.6 ms (3 runs)
- code_context_pack: median 106.0 ms, p95 106.8 ms (3 runs)
- query file_search_path: median 0.3 ms, rows 2 (3 runs)
- query symbol_search_single_token: median 0.5 ms, rows 1 (3 runs)
- query symbol_search_multi_token: median 0.4 ms, rows 1 (3 runs)
- query route_contains: median 0.3 ms, rows 0 (3 runs)
- query import_contains: median 0.3 ms, rows 1 (3 runs)
- query edge_contains: median 0.4 ms, rows 1 (3 runs)

### docs-heavy (docs-heavy)
- Indexed files: 10
- Index time: 114.7 ms
- Current DB size: 114688 bytes
- code_status: median 105.6 ms, p95 106.0 ms (3 runs)
- code_files: median 105.1 ms, p95 105.2 ms (3 runs)
- code_search_symbol: median 111.4 ms, p95 112.4 ms (3 runs)
- code_context_pack: median 111.4 ms, p95 111.6 ms (3 runs)
- query file_search_path: median 0.4 ms, rows 1 (3 runs)
- query symbol_search_single_token: median 0.4 ms, rows 4 (3 runs)
- query symbol_search_multi_token: median 0.4 ms, rows 2 (3 runs)
- query route_contains: median 0.4 ms, rows 2 (3 runs)
- query import_contains: median 0.3 ms, rows 2 (3 runs)
- query edge_contains: median 0.4 ms, rows 7 (3 runs)
