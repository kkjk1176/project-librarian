# Code Performance Efficiency Report

Generated: 2026-06-18T00:56:21.186Z
Node: v22.17.1

## Summary

- FTS decision: contentless FTS experiment does not cross the DB-size adoption threshold in this run; keep current schema and revisit with stronger latency evidence
- Build decision: build/typecheck measured for tracking; keep clean build/typecheck commands until duplicate compiler work is a measured bottleneck

## Scales

### 3000 files

- Index time: 397.4 ms
- Current DB size: 6049792 bytes
- Contentless FTS experiment size: 4591616 bytes (-24.1%)
- code_status: median 143.7 ms, p95 144.1 ms (3 runs)
- code_context_pack: median 147.0 ms, p95 153.0 ms (3 runs)
- code_impact: median 151.6 ms, p95 151.8 ms (3 runs)
- code_report_coverage: median 142.7 ms, p95 144.3 ms (3 runs)

### 10000 files

- Index time: 939.3 ms
- Current DB size: 20336640 bytes
- Contentless FTS experiment size: 15286272 bytes (-24.8%)
- code_status: median 205.1 ms, p95 207.9 ms (3 runs)
- code_context_pack: median 223.2 ms, p95 223.9 ms (3 runs)
- code_impact: median 236.5 ms, p95 237.4 ms (3 runs)
- code_report_coverage: median 206.0 ms, p95 206.9 ms (3 runs)

### 50000 files

- Index time: 6201.6 ms
- Current DB size: 102354944 bytes
- Contentless FTS experiment size: 77066240 bytes (-24.7%)
- code_status: median 629.2 ms, p95 635.2 ms (3 runs)
- code_context_pack: median 705.9 ms, p95 725.6 ms (3 runs)
- code_impact: median 771.6 ms, p95 916.4 ms (3 runs)
- code_report_coverage: median 623.0 ms, p95 626.1 ms (3 runs)

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
- file_search_path: median 1.0 ms, p95 1.4 ms, rows 1 (3 runs)
- symbol_search_single_token: median 2.1 ms, p95 2.2 ms, rows 1 (3 runs)
- symbol_search_multi_token: median 2.6 ms, p95 2.6 ms, rows 1 (3 runs)
- route_contains: median 0.4 ms, p95 0.4 ms, rows 0 (3 runs)
- import_contains: median 0.3 ms, p95 0.4 ms, rows 75 (3 runs)
- edge_contains: median 1.2 ms, p95 1.3 ms, rows 100 (3 runs)

### 10000 files
- file_search_path: median 2.5 ms, p95 2.6 ms, rows 1 (3 runs)
- symbol_search_single_token: median 6.6 ms, p95 6.8 ms, rows 1 (3 runs)
- symbol_search_multi_token: median 8.3 ms, p95 8.5 ms, rows 1 (3 runs)
- route_contains: median 0.3 ms, p95 0.3 ms, rows 0 (3 runs)
- import_contains: median 0.4 ms, p95 0.4 ms, rows 75 (3 runs)
- edge_contains: median 3.0 ms, p95 3.1 ms, rows 100 (3 runs)

### 50000 files
- file_search_path: median 11.6 ms, p95 16.7 ms, rows 1 (3 runs)
- symbol_search_single_token: median 34.7 ms, p95 36.3 ms, rows 1 (3 runs)
- symbol_search_multi_token: median 44.3 ms, p95 59.1 ms, rows 1 (3 runs)
- route_contains: median 0.3 ms, p95 0.5 ms, rows 0 (3 runs)
- import_contains: median 0.4 ms, p95 0.4 ms, rows 75 (3 runs)
- edge_contains: median 15.6 ms, p95 15.7 ms, rows 100 (3 runs)

## Sample Corpora

Checked-in sample corpora are measured separately from synthetic scale fixtures.

### mixed-monorepo (mixed)
- Indexed files: 7
- Index time: 121.8 ms
- Current DB size: 114688 bytes
- code_status: median 111.2 ms, p95 111.6 ms (3 runs)
- code_files: median 111.1 ms, p95 113.3 ms (3 runs)
- code_search_symbol: median 111.5 ms, p95 111.7 ms (3 runs)
- code_context_pack: median 117.2 ms, p95 118.1 ms (3 runs)
- query file_search_path: median 0.4 ms, rows 2 (3 runs)
- query symbol_search_single_token: median 0.4 ms, rows 2 (3 runs)
- query symbol_search_multi_token: median 0.5 ms, rows 1 (3 runs)
- query route_contains: median 0.4 ms, rows 2 (3 runs)
- query import_contains: median 0.3 ms, rows 2 (3 runs)
- query edge_contains: median 0.4 ms, rows 3 (3 runs)

### web-service (service)
- Indexed files: 4
- Index time: 119.3 ms
- Current DB size: 114688 bytes
- code_status: median 110.9 ms, p95 111.3 ms (3 runs)
- code_files: median 110.2 ms, p95 111.8 ms (3 runs)
- code_search_symbol: median 109.9 ms, p95 110.0 ms (3 runs)
- code_context_pack: median 111.2 ms, p95 112.9 ms (3 runs)
- query file_search_path: median 0.4 ms, rows 1 (3 runs)
- query symbol_search_single_token: median 0.4 ms, rows 2 (3 runs)
- query symbol_search_multi_token: median 0.5 ms, rows 2 (3 runs)
- query route_contains: median 0.4 ms, rows 2 (3 runs)
- query import_contains: median 0.4 ms, rows 1 (3 runs)
- query edge_contains: median 0.3 ms, rows 3 (3 runs)

### python-cli (single-language)
- Indexed files: 2
- Index time: 115.4 ms
- Current DB size: 114688 bytes
- code_status: median 109.8 ms, p95 110.0 ms (3 runs)
- code_files: median 110.2 ms, p95 110.7 ms (3 runs)
- code_search_symbol: median 112.2 ms, p95 123.9 ms (3 runs)
- code_context_pack: median 113.1 ms, p95 113.2 ms (3 runs)
- query file_search_path: median 0.4 ms, rows 1 (3 runs)
- query symbol_search_single_token: median 0.6 ms, rows 1 (3 runs)
- query symbol_search_multi_token: median 0.6 ms, rows 1 (3 runs)
- query route_contains: median 0.4 ms, rows 0 (3 runs)
- query import_contains: median 0.3 ms, rows 1 (3 runs)
- query edge_contains: median 0.3 ms, rows 0 (3 runs)
