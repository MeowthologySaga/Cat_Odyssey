import type { EnglishCatalog, TranslationRule } from "../catalogTypes";

/**
 * Release-gate copy that is assembled by meta systems and late-game scenes.
 * Dynamic rows are handled by rules below so real values, not only AST test
 * samples, remain fully localized.
 */
export const RELEASE_ENGLISH_CATALOG: EnglishCatalog = Object.freeze({
  // Manifest and release surfaces.
  "고양이 오디세이 (Cat Odyssey)": "Cat Odyssey",
  "고양이 영웅을 당겨 쏘고 벽과 괴수 부위를 연쇄 반사하는 한국어/English 2D 리코셰 액션 RPG입니다.": "A Korean/English 2D ricochet action RPG where cat heroes rebound off walls and chain attacks through monster parts.",
  "한국어를 유지하면서 English 전체 플레이, 영어 컷신 자막, 언어 저장과 로컬라이제이션 QA를 추가했습니다.": "Added complete English play, English cutscene subtitles, persistent language selection, and localization QA while preserving Korean.",
  "고양이 영웅을 당겨 쏘고 벽과 괴수 부위를 연쇄 반사하는 2D 리코셰 액션 RPG입니다.": "A 2D ricochet action RPG where cat heroes rebound off walls and chain attacks through monster parts.",

  // Endgame rewards and compact modifier labels.
  "각성석 1": "1 Awakening Stone",
  "폭풍 추가 출항권 1": "1 Extra Storm Sortie",
  "유물 가루 100": "100 Relic Dust",
  "스킬라 비늘 3": "3 Scylla Scales",
  "스킬라 비늘 10": "10 Scylla Scales",
  "스킬라 비늘 30": "30 Scylla Scales",
  "보스": "Boss",
  "정예": "Elite",
  "예상 반사": "Predicted Ricochets",
  "파티 발사 속도": "Party Launch Speed",
  "파티 공격": "Party Attack",
  "보호 대상 체력": "Protected Target HP",
  "첫 적 공격 지연": "Delay First Enemy Attack",
  "연속 약점 피해": "Consecutive Weak-Point Damage",
  "턴 시작 최저 체력 회복": "Heal Lowest-HP Ally at Turn Start",
  "최초 전투불능 부활 체력": "First-KO Revival HP",
  "첫 피격 보호막": "Shield on First Hit",
  "첫 접촉 기절": "Stun on First Contact",
  "완전 예상선": "Full Trajectory Preview",
  "연쇄 피해": "Chain Damage",
  "발사 속도": "Launch Speed",
  "첫 우정기 반복": "Repeat First Friendship Skill",
  "차원문 이탈 속도": "Portal Exit Speed",
  "아군 접촉 충전": "Charge on Ally Contact",
  "최대 반사": "Maximum Ricochets",
  "반사당 피해": "Damage per Ricochet",
  "파동 종료 회복": "Heal after Each Wave",
  "약점 화상": "Weak-Point Burn",
  "약점 반경": "Weak-Point Radius",
  "보호 대상 피해 감소": "Protected Target Damage Reduction",
  "10연쇄 태양륜": "Solar Ring at 10 Hits",
  "바람 저항": "Wind Resistance",
  "세 번째 벽 충돌 돌풍": "Gust on Third Wall Hit",
  "반발력": "Rebound Force",
  "첫 2초 위험 면역": "Hazard Immunity for First 2 Seconds",
  "반사 시 바람 전환": "Convert Ricochet to Wind",
  "약화 저항": "Debuff Resistance",
  "첫 충돌 분신": "Clone on First Collision",
  "적 크기 감소": "Reduce Enemy Size",
  "방패 방향 반전": "Reverse Shield Direction",
  "거울벽": "Mirror Walls",
  "거울 추가 피해": "Bonus Mirror Damage",
  "턴 시작 회복": "Heal at Turn Start",
  "최초 전투불능 방지": "Prevent First Knockout",
  "벽 접촉 속박": "Bind on Wall Contact",
  "턴당 공격 증가": "Attack Gain per Turn",
  "파티 재생": "Party Regeneration",
  "적 카운트 지연": "Delay Enemy Countdown",

  // Party recommendation rationale and title copy.
  "고위험": "High Risk",
  "주의": "Caution",
  "적 전멸에 유리한 연쇄·광역 역할을 우선했습니다.": "Prioritized chain and area roles that excel at defeating all enemies.",
  "부위 파괴에 맞춰 관통·폭발 역할을 우선했습니다.": "Prioritized pierce and burst roles for breaking parts.",
  "조립 목표에 맞춰 기동·반사 역할을 우선했습니다.": "Prioritized mobile and ricochet roles for assembly objectives.",
  "생존 목표에 맞춰 방어·지원 역할을 우선했습니다.": "Prioritized defense and support roles for survival objectives.",
  "보호 목표에 맞춰 방어·회복 역할을 우선했습니다.": "Prioritized defense and healing roles for protection objectives.",
  "봉인 목표에 맞춰 관통·집중 공격 역할을 우선했습니다.": "Prioritized pierce and focused-damage roles for sealing objectives.",
  "탈출 목표에 맞춰 속도·기동 역할을 우선했습니다.": "Prioritized speed and mobility roles for escape objectives.",
  "신탁탑에서 여섯 갈래 운명을 읽어 낸 선장": "The captain who read six paths of fate in the Oracle Tower",

  // Collection, endgame, route, and reward fragments.
  " · 보스 해역": " · Boss Stage",
  " · 모든 마일스톤 달성": " · All Milestones Reached",
  " · 전 티어 달성": " · All Tiers Reached",
  "예상선이 첫 구간만 표시": "Trajectory preview shows only the first segment",
  "소용돌이 세기 +45%": "Whirlpool strength +45%",
  "파괴벽 내구도 -45%": "Breakable-wall durability -45%",
  "잠긴 영웅 한 명 복귀": "Return one locked hero",
  "다음 편성에서 자유 교대": "Free swap in the next formation",
  "가장 오래된 저주 제거": "Remove the oldest curse",
  " (보유)": " (Owned)",
  "한국어": "Korean",
  " [합류 전: 조각]": " [Before Joining: Shards]",

  // Friendship-skill and linked-skill effect descriptions.
  "가장 가까운 적에게 화살비": "Arrow rain on the nearest enemy",
  "조준선 방향 관통 공격": "Piercing attack along the aim line",
  "모든 아군에게 투사체 방어": "Projectile guard for all allies",
  "아군 체력 회복": "Heal allied HP",
  "접촉한 아군 지속 회복": "Regenerate the contacted ally",
  "적 사이 연쇄 반사": "Chain ricochet between enemies",
  "전방 밀쳐내기 파동": "Forward knockback wave",
  "접촉점 교차 베기": "Cross slash at the contact point",
  "접촉점에 임시 벽 생성": "Create a temporary wall at the contact point",
  "가까운 적 약점 표식": "Mark the nearest enemy's weak point",
  "접촉한 아군에게 순풍": "Grant Tailwind to the contacted ally",
  "가까운 적 축소": "Shrink the nearest enemy",
  "적 공격 예고 연장": "Extend enemy attack telegraphs",
  "접촉한 아군 벽 통과": "Let the contacted ally phase through walls",
  "접촉한 아군 태양륜": "Give the contacted ally a Solar Ring",
  "마지막 피격 적 추격타": "Follow-up shot on the last enemy hit",
  "가까운 적 속박": "Bind the nearest enemy",
  "강한 동료 추가 발사": "Launch a powerful companion again",
  "보스 부위 기절": "Stun a boss part",
  "아군 속도 증가": "Increase ally speed",
  "임시 범퍼 설치": "Install a temporary bumper",
  "쓰러진 동료 부활": "Revive a fallen companion",
  "표식 적 광선": "Beam attack on the marked enemy",
  "차원문 한 쌍 설치": "Install a pair of portals",
  "재료 차감 없음": "No materials consumed",
  "1분대1": "Squad 1 · Deployed",
  "  ◀ 출전": "  ◀ Deployed",
  "형": " class",
  // TypeScript AST samples for nested/conditional template fragments. The
  // corresponding real runtime rows are covered by the dynamic rules below.
  "1 · 권장보다 1 부족": "High Risk · 1 below recommended",
  " · 항로 1개": " · 1 Route",
  " · 보스 격파 1": " · Boss Defeated: 1",
  " 1회": " 1 time",
  "1 · ★5 픽업": "Permanent Oracle · Featured ★5",
  "기본 그림으로 안전하게 계속합니다": "Continuing safely with fallback art",
  "일부 항해 자료를 불러오지 못했습니다 · 1": "Some voyage assets could not be loaded · 1",
  "◆ 벌목 대상": "◆ Felling Target",
});

export const RELEASE_ENGLISH_RULES: readonly TranslationRule[] = Object.freeze([
  {
    pattern: /^(영웅 도감|유물 도감|항해 기록|칭호 목록) · (수집|진행) ([\d,]+)\/([\d,]+)(?: · 항로 (\d+)개)?$/u,
    replacement: (_match, section, progress, owned, total, routes) => {
      const sectionName = ({
        "영웅 도감": "Crew Codex",
        "유물 도감": "Relic Codex",
        "항해 기록": "Voyage Record",
        "칭호 목록": "Title List",
      } as Record<string, string>)[section] ?? section;
      const progressName = progress === "수집" ? "Collected" : "Progress";
      return `${sectionName} · ${progressName} ${owned}/${total}${routes ? ` · ${routes} Routes` : ""}`;
    },
  },
  {
    pattern: /^(.+)  (★+)$/u,
    replacement: (_match, name, stars) => `${name}  ${stars}`,
  },
  {
    pattern: /^(.+)  ·  (바다|태양|달|폭풍|대지|영혼)  ·  (.+)$/u,
    replacement: (_match, epithet, element, role) => `${epithet}  ·  ${element}  ·  ${role}`,
  },
  {
    pattern: /^(가까운 적 화살비|예상선 연장|약점 피해 증가) (-?\d+)$/u,
    replacement: (_match, effect, value) => `${effect} ${value}`,
  },
  {
    pattern: /^(예상선 연장|약점 피해 증가) (-?\d+) · (예상선 연장|약점 피해 증가) (-?\d+)$/u,
    replacement: (_match, first, firstValue, second, secondValue) => `${first} ${firstValue} · ${second} ${secondValue}`,
  },
  {
    pattern: /^2성 · (\d+)턴 이내 목표 파괴$/u,
    replacement: (_match, turns) => `2 Stars · Destroy the objective within ${turns} turns`,
  },
  {
    pattern: /^3성 · (\d+)턴 이내 · 남은 HP (\d+)% 이상$/u,
    replacement: (_match, turns, hp) => `3 Stars · Within ${turns} turns · at least ${hp}% HP remaining`,
  },
  {
    pattern: /^첫 돌파 · 첫 돌파 · (.+?)(?: ×(\d+))?$/u,
    replacement: (_match, reward, amount) => `First Clear · ${reward}${amount ? ` ×${amount}` : ""}`,
  },
  {
    pattern: /^(.+)  Lv\.(\d+)$/u,
    replacement: (_match, hero, level) => `${hero}  Lv.${level}`,
  },
  {
    pattern: /^(\d+)층 · (.+)$/u,
    replacement: (_match, floor, name) => `Floor ${floor} · ${name}`,
  },
  {
    pattern: /^폭풍 (\d+)(?:\/12)? · (.+)$/u,
    replacement: (_match, node, name) => `Storm ${node} · ${name}`,
  },
  {
    pattern: /^파티 (.+) (-?\d+)%$/u,
    replacement: (_match, stat, amount) => `Party ${stat} ${amount}%`,
  },
  {
    pattern: /^ · 점수 보상 (.+)$/u,
    replacement: (_match, rewards) => ` · Score Rewards ${rewards}`,
  },
  {
    pattern: /^(고위험|주의) · 권장보다 ([\d,]+) 부족$/u,
    replacement: (_match, risk, deficit) => `${risk === "고위험" ? "High Risk" : "Caution"} · ${deficit} below recommended`,
  },
  {
    pattern: /^(.+) · 항로 (\d+)개$/u,
    replacement: (_match, prefix, count) => `${prefix} · ${count} Route${count === "1" ? "" : "s"}`,
  },
  {
    pattern: /^(.+) · 보스 격파 (.+)$/u,
    replacement: (_match, prefix, boss) => `${prefix} · Boss Defeated: ${boss}`,
  },
  {
    pattern: /^인연 (\d+) \/ 99(.*)$/u,
    replacement: (_match, level, suffix) => `Affinity ${level} / 99${suffix}`,
  },
  {
    pattern: /^ · 다음 (\d+): (.+)$/u,
    replacement: (_match, level, label) => ` · Next ${level}: ${label}`,
  },
  {
    pattern: /^폭풍 점수 ([\d,]+)(.*)$/u,
    replacement: (_match, score, suffix) => `Storm Score ${score}${suffix}`,
  },
  {
    pattern: /^ \/ ([\d,]+) · 다음 (.+)$/u,
    replacement: (_match, score, label) => ` / ${score} · Next ${label}`,
  },
  {
    pattern: /^보유 ([\d,]+) · (.+)$/u,
    replacement: (_match, amount, state) => `Owned ${amount} · ${state}`,
  },
  {
    pattern: /^(\d+)분대(?:  ◀ 출전)?$/u,
    replacement: (_match, squad) => `Squad ${squad}${_match.includes("출전") ? "  ◀ Deployed" : ""}`,
  },
  {
    pattern: /^함대 유물\s+(\d+) \/ 3$/u,
    replacement: (_match, count) => `Fleet Relics  ${count} / 3`,
  },
  {
    pattern: /^(.+) (\d+)회$/u,
    replacement: (_match, objective, count) => `${objective} ${count} time${count === "1" ? "" : "s"}`,
  },
  {
    pattern: /^항로 (\d+)  ·  (.+)$/u,
    replacement: (_match, route, kind) => `Route ${route}  ·  ${kind}`,
  },
  {
    pattern: /^(상시 신탁|기간 신탁) · ★5 픽업$/u,
    replacement: (_match, kind) => `${kind === "상시 신탁" ? "Permanent Oracle" : "Limited Oracle"} · Featured ★5`,
  },
  {
    pattern: /^배너 (.+) · 약관 v(.+) · (.+)$/u,
    replacement: (_match, banner, terms, availability) => `Banner ${banner} · Terms v${terms} · ${availability}`,
  },
]);
