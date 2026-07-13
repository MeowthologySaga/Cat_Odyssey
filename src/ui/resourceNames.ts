const RESOURCE_NAMES: Readonly<Record<string, string>> = Object.freeze({
  "black-shell": "검은 조개껍질",
  "bronze-oar-head": "청동 노 머리",
  "calypso-thread": "캣-립소의 실",
  "cave-iron": "동굴 철광",
  "cyclops-fragment": "키클롭스 파편",
  "forepaw-claw": "앞발 갈고리",
  "giant-stone": "거인의 돌",
  "ithaca-bronze": "이타카 청동",
  "ithaca-crown": "이타카 왕관",
  "lotus-antidote": "연꽃 해독제",
  "lotus-fiber": "연꽃 섬유",
  "mirror-dust": "거울 가루",
  "moly-flower": "몰리 꽃",
  "moly-leaf": "몰리 잎",
  "oracle-dust": "신탁의 가루",
  "oracle-emblem": "신탁 문장",
  "ogygian-timber": "오기기아 목재",
  "raid-scale": "토벌 비늘",
  "ram-bell": "숫양 방울",
  "relic-dust": "유물 가루",
  "scylla-scale": "스킬라 비늘",
  "sea-ore": "바다 광석",
  "siren-pearl": "세이렌 진주",
  "solar-bell": "태양 방울",
  "song-crystal": "노래 결정",
  "spirit-ash": "영혼 재",
  "storm-extra-entry": "폭풍 추가 출항권",
  "storm-glass": "폭풍 유리",
  "strait-rope": "해협 밧줄",
  "sun-grass": "태양풀",
  "underworld-coin": "저승의 동전",
  "voyage-knot": "항해 매듭",
  "wax-earplug": "밀랍 귀마개",
  "wind-seal": "바람 봉인",
  "wind-silk": "바람 비단",
});

export function resourceDisplayName(id: string): string {
  return RESOURCE_NAMES[id] ?? id.replaceAll("-", " ");
}

export function formatResourceAmount(id: string, amount: number): string {
  return `${resourceDisplayName(id)} ×${Math.max(0, Math.floor(amount)).toLocaleString()}`;
}
