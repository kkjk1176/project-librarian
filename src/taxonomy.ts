import type { MigrationConfidence, MigrationStorage, MigrationUnitClassification } from "./types";

interface TaxonomyArea {
  id: string;
  label: string;
  storage: MigrationStorage;
  targetSlug: string;
  keywords: string[];
}

const taxonomyAreas: TaxonomyArea[] = [
  {
    id: "research-sources",
    label: "Research / Source Evidence",
    storage: "sources",
    targetSlug: "research-sources",
    keywords: ["source", "sources", "reference", "references", "citation", "bibliography", "research", "paper", "article", "link", "출처", "참고", "자료", "근거", "링크", "리서치", "논문"],
  },
  {
    id: "decision-record",
    label: "Decision Record",
    storage: "decisions",
    targetSlug: "decision-records",
    keywords: ["adr", "decision", "decisions", "rationale", "tradeoff", "trade-off", "alternative", "rejected", "accepted", "decided", "결정", "의사결정", "기각", "대안", "트레이드오프", "선택", "채택"],
  },
  {
    id: "strategy",
    label: "Strategy / Business Context",
    storage: "canonical",
    targetSlug: "strategy-context",
    keywords: ["vision", "mission", "strategy", "business model", "market", "positioning", "competitive", "gtm", "pricing", "roadmap", "비전", "미션", "전략", "시장", "포지셔닝", "경쟁", "사업", "가격", "로드맵"],
  },
  {
    id: "product-requirements",
    label: "Product Requirements",
    storage: "canonical",
    targetSlug: "product-requirements",
    keywords: ["prd", "requirement", "requirements", "feature", "features", "function", "functional", "scope", "goal", "goals", "acceptance", "use case", "기능", "기능명세", "요구사항", "요건", "범위", "목표", "수용기준", "유스케이스", "서비스기획", "기획"],
  },
  {
    id: "user-flow",
    label: "User Flow / Journey",
    storage: "canonical",
    targetSlug: "user-flows",
    keywords: ["user flow", "flow", "journey", "scenario", "persona", "story", "navigation", "screen flow", "유저플로우", "사용자 흐름", "사용자 여정", "시나리오", "페르소나", "스토리", "화면흐름", "동선"],
  },
  {
    id: "ux-content",
    label: "UX / Content",
    storage: "canonical",
    targetSlug: "ux-content",
    keywords: ["ux", "interaction", "wireframe", "copy", "content", "microcopy", "empty state", "error state", "accessibility", "i18n", "사용성", "인터랙션", "와이어프레임", "카피", "콘텐츠", "빈상태", "오류상태", "접근성", "문구"],
  },
  {
    id: "design-system",
    label: "Design System / UI",
    storage: "canonical",
    targetSlug: "design-system",
    keywords: ["design", "ui", "component", "prototype", "figma", "style guide", "brand", "visual", "layout", "디자인", "컴포넌트", "프로토타입", "스타일가이드", "브랜드", "시각", "레이아웃"],
  },
  {
    id: "data-analytics",
    label: "Data / Analytics",
    storage: "canonical",
    targetSlug: "data-analytics",
    keywords: ["data", "schema", "database", "db", "erd", "entity", "event", "metric", "analytics", "kpi", "tracking", "데이터", "스키마", "디비", "엔티티", "이벤트", "지표", "분석", "트래킹"],
  },
  {
    id: "api-contract",
    label: "API Contract",
    storage: "canonical",
    targetSlug: "api-contracts",
    keywords: ["api", "endpoint", "request", "response", "rest", "graphql", "webhook", "sdk", "openapi", "swagger", "인증", "토큰", "요청", "응답", "엔드포인트", "웹훅", "api명세", "api 명세"],
  },
  {
    id: "engineering-architecture",
    label: "Engineering / Architecture",
    storage: "canonical",
    targetSlug: "engineering-architecture",
    keywords: ["architecture", "system", "service", "module", "implementation", "tech stack", "dependency", "infra", "deployment", "queue", "cache", "아키텍처", "시스템", "서비스", "모듈", "구현", "기술스택", "인프라", "배포", "큐", "캐시"],
  },
  {
    id: "security-legal",
    label: "Security / Legal",
    storage: "canonical",
    targetSlug: "security-legal",
    keywords: ["security", "privacy", "permission", "role", "auth", "authorization", "compliance", "legal", "terms", "consent", "보안", "개인정보", "권한", "역할", "인가", "인증", "준수", "법무", "약관", "동의"],
  },
  {
    id: "policy",
    label: "Policy / Governance",
    storage: "canonical",
    targetSlug: "policy-governance",
    keywords: ["policy", "rule", "moderation", "governance", "sla", "retention", "eligibility", "refund", "정책", "규칙", "운영정책", "거버넌스", "보관", "자격", "환불"],
  },
  {
    id: "qa",
    label: "QA / Test",
    storage: "canonical",
    targetSlug: "qa-test-plan",
    keywords: ["qa", "test", "testing", "validation", "verification", "bug", "edge case", "regression", "acceptance test", "테스트", "검증", "품질", "버그", "엣지케이스", "회귀", "테스트케이스"],
  },
  {
    id: "release-ops",
    label: "Release / Operations",
    storage: "canonical",
    targetSlug: "release-operations",
    keywords: ["release", "launch", "operation", "runbook", "monitoring", "alert", "incident", "support", "cs", "migration", "rollout", "릴리즈", "출시", "운영", "런북", "모니터링", "알림", "장애", "고객지원", "마이그레이션"],
  },
  {
    id: "business-ops",
    label: "Business Operations",
    storage: "canonical",
    targetSlug: "business-operations",
    keywords: ["sales", "marketing", "crm", "customer success", "finance", "billing", "invoice", "contract", "영업", "마케팅", "고객성공", "재무", "청구", "계약", "정산"],
  },
  {
    id: "wiki-meta",
    label: "Wiki Operations / Meta",
    storage: "meta",
    targetSlug: "wiki-operations",
    keywords: ["wiki", "documentation", "document taxonomy", "canonical", "source of truth", "lint", "doctor", "위키", "문서화", "문서체계", "정본", "정보구조", "린트", "닥터"],
  },
];

function slugPart(value: string, maxLength: number = 36): string {
  return value.toLowerCase().replace(/[^a-z0-9가-힣ぁ-んァ-ン一-龥]+/g, "-").replace(/^-|-$/g, "").slice(0, maxLength) || "migration";
}

function legacyStem(legacyPath: string): string {
  return slugPart(legacyPath.replace(/\.(md|mdx)$/i, "").split(/[\\/]+/).pop() ?? legacyPath);
}

function fallbackStorageFromLegacyPath(legacyPath: string): MigrationStorage {
  if (/^meta\//.test(legacyPath)) return "meta";
  if (/^decisions\//.test(legacyPath)) return "decisions";
  if (/^sources\//.test(legacyPath)) return "sources";
  return "canonical";
}

function keywordScore(haystack: string, keyword: string): number {
  const normalized = keyword.toLowerCase();
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (/^[a-z0-9 -]+$/.test(normalized)) {
    const matches = haystack.match(new RegExp(`\\b${escaped}\\b`, "g"));
    return matches ? matches.length : 0;
  }
  return haystack.includes(normalized) ? 1 : 0;
}

function areaScore(area: TaxonomyArea, haystack: string): number {
  return area.keywords.reduce((sum, keyword) => sum + keywordScore(haystack, keyword), 0);
}

function targetPath(storage: MigrationStorage, base: string, targetSlug: string): string {
  return `wiki/${storage}/${slugPart(base, 32)}-${targetSlug}.md`;
}

export function classifyMigrationUnit(input: {
  legacyPath: string;
  heading: string;
  headingPath: string[];
  content: string;
  summary: string;
}): MigrationUnitClassification {
  const haystack = [
    legacyStem(input.legacyPath),
    input.heading,
    input.headingPath.join(" "),
    input.summary,
    input.content,
  ].join("\n").toLowerCase();
  const scored = taxonomyAreas
    .map((area) => ({ area, score: areaScore(area, haystack) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.area.id.localeCompare(right.area.id));
  const fallbackStorage = fallbackStorageFromLegacyPath(input.legacyPath);
  const best = scored[0]?.area ?? {
    id: "unclassified",
    label: "Needs Human Review",
    storage: fallbackStorage,
    targetSlug: "migration-review",
    keywords: [],
  };
  const bestScore = scored[0]?.score ?? 0;
  const secondScore = scored[1]?.score ?? 0;
  const confidence: MigrationConfidence = bestScore >= 3 && bestScore > secondScore ? "high" : bestScore >= 1 && bestScore >= secondScore ? "medium" : "low";
  const base = legacyStem(input.legacyPath);
  const reason = confidence === "low"
    ? "no strong taxonomy signal; human review required"
    : `matched ${best.label}${secondScore > 0 && bestScore === secondScore ? " with overlapping signals" : ""}`;
  return {
    area: best.id,
    label: best.label,
    storage: best.storage,
    target: targetPath(best.storage, base, best.targetSlug),
    confidence,
    reason,
  };
}

export function storageToMigrationKind(storage: MigrationStorage): "canonical" | "decision" | "source" | "meta" {
  if (storage === "decisions") return "decision";
  if (storage === "sources") return "source";
  if (storage === "meta") return "meta";
  return "canonical";
}
