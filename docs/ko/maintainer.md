# 관리자 안내서

## 개발

```bash
npm install
npm run typecheck
npm run build
npm run unit
bash tests/smoke.sh
```

`npm run build`는 기존 루트 `dist/`를 제거하고 TypeScript를 컴파일한 뒤 저장소에 포함된 스킬 런타임 복사본을 동기화합니다. `src/`, 템플릿, 패키지 메타데이터, 스킬 동작을 바꾸면 다시 빌드합니다.

## 검증

- 파서나 모드 변경은 집중 단위 테스트를 갱신합니다.
- 생성 위키 변경은 새 `init`과 기존 위키의 `update`를 검사합니다.
- 라우팅 변경은 필요에 따라 query, impact, neighborhood, 링크, 품질, doctor 동작을 검사합니다.
- 스킬 런타임 변경은 빌드 후 저장소에 포함된 두 스킬 복사본을 확인합니다.
- 패키징이나 워크플로 변경은 `npm test`, `npm run audit:supply-chain`, `npm pack --dry-run --json`을 실행합니다.

검증 범위는 변경 위험에 맞춥니다. 제품 품질의 기준은 프로젝트 지식이 명확한 소유권과 경로를 가지며 최신 상태로 복구 가능하게 정리되어 있는지입니다.

## 배포

패키지는 `agents/`, `docs/`, `dist/`, README, 기여 안내서, 라이선스, 루트 스킬을 포함합니다. `prepack`은 생성 런타임을 다시 빌드합니다.

배포 워크플로는 trusted publishing을 유지합니다.

1. `npm ci`로 설치합니다.
2. `npm test`와 운영 의존성 감사를 실행합니다.
3. `npm pack --dry-run --json`으로 패키지 내용을 확인합니다.
4. 릴리스 또는 승인된 릴리스 태그에서 GitHub OIDC로 배포합니다.

장기 npm 토큰으로 로컬 배포하지 않습니다.
