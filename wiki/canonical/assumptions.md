---
status: active
updated: 2026-06-08
scope: project-canonical
read_budget: short
decision_ref: none
review_trigger: assumptions are added, validated, or retired
---

# Assumptions

## TL;DR

- 이 페이지는 코드만으로 확정하기 어려운 임시 해석을 추적한다.
- 확정된 사실은 관련 canonical 문서로 이동하고, 코드 증거가 부족한 항목은 open question으로 남긴다.

## Active

| Assumption | Basis | Validation Path | Status |
| --- | --- | --- | --- |
| `dist/`는 npm binary와 skill install을 위해 커밋 상태로 유지되어야 한다. | README development notes and `package.json` binary path. | release/commit policy가 바뀌면 README/package wiring 확인. | active |
| 한국어 canonical page language is acceptable for this repository wiki generation. | Current user request is Korean; README has localized docs including `README.ko.md`. | 사용자가 다른 언어를 지정하면 canonical pages update. | active |

## Retired

- Bootstrap starter assumption that the product topic was not yet selected was retired after code inspection identified the actual package and CLI behavior.
