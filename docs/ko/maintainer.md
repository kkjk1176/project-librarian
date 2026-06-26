# 관리자 가이드

README 첫 화면에 넣기에는 깊은 개발과 릴리스 운영 정보를 모은 문서입니다.

## 개발

소스는 TypeScript입니다. 커밋된 `dist/` 디렉터리는 npm 바이너리와 설치된 스킬 복사본이 사용하는 컴파일된 JavaScript입니다.

```bash
npm install
npm run typecheck
npm run build
npm run check:dist
npm test
npm run test:coverage
npm run benchmark:llm:raw-audit
npm run benchmark:llm:delta-analysis
npm run benchmark:claim-ledger
npm run release:check
npm pack --dry-run
```

`src/` 아래 TypeScript를 수정했다면 커밋 전에 다시 빌드해 `dist/`가 최신 상태를 유지하게 해야 합니다. `npm run check:dist`는 체크인된 생성 파일이 최신 빌드 출력과 일치하는지 확인합니다.

`npm run test:coverage`는 Node 내장 coverage를 사용하며 line, branch, function threshold를 보수적으로 설정합니다. coverage는 단순 보고서가 아니라 regression gate입니다.

지원 런타임 하한은 Node.js 22.13+입니다. 개발 type definition은 Node 22 지원 계약과 맞아야 하며, 지원 사용자에게 없는 API를 TypeScript가 허용하지 않도록 Node 22 호환성 확인으로 뒷받침해야 합니다.

## 릴리스 준비

`npm run release:check`는 로컬 전용 관리자 게이트입니다. 테스트, Node 내장 coverage, 벤치마크 parser smoke, real-corpus offline demo, benchmark release preview, benchmark claim-ledger classification, raw hygiene audit, package dry-run inspection, native helper package-matrix, binary-format, SHA-256 provenance-manifest 검사, dist 실행 가능 여부/parity, README benchmark-claim boundary, 문서 CLI reference coverage, README/README.ko code-evidence freshness/scale-gate 문서화, trusted-publishing workflow 검사를 실행합니다.

이 명령은 publish하지 않고, raw benchmark artifact를 삭제하지 않으며, 실측 Codex benchmark도 실행하지 않습니다.

`release:check` 통과는 런타임 보증이 아니라 재현 가능한 릴리스 준비 근거입니다. 현재 checkout에서 위 로컬 게이트를 통과했음을 증명하며, package dry run이 예상 publish boundary 안에 머물고, source/test/repo-local wiki/workflow state/raw benchmark output/local cache를 제외하며, partial, 잘못 라벨링된, manifest 없는, stale manifest, checksum mismatch 상태의 `dist/native/` helper matrix를 포함하지 않는지도 확인합니다.

## 배포

배포는 GitHub Release가 published된 뒤 `.github/workflows/publish.yml`에서 처리합니다. Non-OIDC job은 source package를 검증하고, 지원 native helper를 빌드하고, `dist/native/`를 조립하고, helper manifest를 생성하고, helper가 포함된 package에서 `release:check`를 실행합니다.

최종 publish job은 보호된 `npm-publish` GitHub Environment를 대상으로 하며, GitHub OIDC를 통한 npm trusted publishing(`id-token: write`)과 `npm publish --access public`을 사용하고 npm provenance를 자동 생성합니다. 정상 release path에는 `NODE_AUTH_TOKEN`이나 npm token secret을 쓰면 안 되며, release-critical first-party GitHub Actions는 full commit SHA에 pin되어야 합니다. `release:check`가 이 workflow contract를 로컬에서 검증합니다.

Trusted publishing과 npm provenance는 패키지가 GitHub OIDC workflow를 통해 배포됐음을 증명합니다. benchmark correctness, end-user repository의 code-evidence freshness, security audit를 증명하지는 않습니다. 이들은 별도 근거 트랙입니다.

## 코드 근거 런타임 점검

코드 근거 런타임/저장소 점검에는 `npm run perf:code-efficiency`를 사용합니다. 이 명령은 3k/10k/50k fixture를 만들고 `benchmarks/reports/code-performance-efficiency/current.json`과 `.md`를 작성합니다. 명령 timing에는 CLI startup과 freshness check가 포함되며, `query_groups` 섹션은 대표 file/symbol/route/import/edge query의 직접 DB timing을 보고합니다.

보고서는 체크인된 `mixed-monorepo`, `web-service`, `python-cli`, `docs-heavy` corpus도 synthetic scale fixture와 분리해 측정합니다. `--actual-repo <path>`를 반복하고 `--compare-native`를 함께 주면 local real repository를 같은 TypeScript/Rust timing 및 row-delta report에 포함할 수 있습니다. source directory는 수정하지 않습니다.

실제 저장소 native policy check:

```bash
npm run perf:code-full-rebuild -- --source-root <dir> --helper <helper>
npm run perf:code-incremental -- --source-root <dir> --helper <helper>
```

첫 명령은 fresh repo copy에서 TypeScript와 Rust forced full rebuild를 비교합니다. 두 번째 명령은 controlled file mutation 뒤 TypeScript incremental update와 Rust incremental writer를 비교합니다.

## 벤치마크 raw 출력

실측 LLM benchmark run은 1일보다 오래된 stale prior raw run directory와 isolated Codex home을 자동 정리하고, claimable-run failure가 발생해도 current run의 home을 정리합니다. Raw JSONL, stderr, report, manifest는 retention window 안에서는 남습니다.

오래된 ignored raw output은 retained isolated Codex home을 삭제하기 전에 dry-run-first helper로 감사할 수 있습니다.

```bash
npm run benchmark:llm:raw-audit -- --older-than-days 14
npm run benchmark:llm:prune-raw -- --older-than-days 14
npm run benchmark:llm:prune-raw -- --older-than-days 14 --execute
```

`npm run benchmark:llm:delta-analysis`는 체크인된 실측 LLM report를 읽고 Codex를 실행하지 않은 채 cost-weighted regression을 순위화합니다. `-- --include-traces`를 추가하면 대표 raw JSONL command trace를 포함하고 broad-search/router-read driver를 분류합니다. 소형 aggregation처럼 약한 cell에 새 benchmark claim을 추가하기 전에 먼저 보는 진단 지점입니다.

실측 LLM run은 기본적으로 `--scenario-order run-major-balanced`를 사용합니다. 각 measured run index가 선택된 모든 scenario를 실행하고, 반복마다 순서를 뒤집어 with/without pair가 반복 실행에서 condition별로 뭉치지 않게 합니다. 오래된 scenario-grouped 진단을 재현할 때만 `--scenario-order scenario-major`를 사용합니다.

`npm run typecheck:ts7`은 선택적 TypeScript 7 RC 호환성 probe입니다. `npx`를 사용하며, compiler API와 이 프로젝트 TypeScript extractor의 측정된 parity record가 생길 때까지 `test`, `release:check`, CI gate 밖에 둡니다.
