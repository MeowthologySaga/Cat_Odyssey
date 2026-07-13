# 상용 콘텐츠 Strict 게이트

이 문서는 데이터로 작성하는 캠페인·UGC가 "이름만 있는 기능"이나 임시 폴백을 완성품으로 통과시키지 않도록 하는 공용 출고 계약이다. 기본 검증 명령은 `npm.cmd run validate:content`다.

## 1. 플레이어에게 보이는 효과는 100% 연결한다

- 목표, 스테이지 수정자, 스킬, 보상 설명에 노출되는 효과는 런타임 또는 렌더러 소비 주체가 있어야 한다.
- 알 수 없는 ID를 그대로 UI에 출력하거나 `현재 미연결`인 효과를 완성 기능처럼 판매하지 않는다.
- 새 효과는 `데이터 ID → 런타임 소비 → 관찰 가능한 피드백 → 자동 테스트`를 한 변경에서 함께 추가한다.
- strict 결과의 `unsupportedPlayerVisibleEffects`는 항상 `0`이어야 한다.

## 2. 설명과 승리 조건을 같은 계약에서 만든다

지원 목표는 `defeat-all`, `break-parts`, `assemble`, `survive`, `protect`, `seal`, `escape`다.

- 목표 문구는 별도 자유 문장으로 승리 조건을 재정의하지 않고, 실제 `objective.type`, `targetIds`, `requiredCount`, `turnLimit`에서 파생한다.
- `survive`는 사용하지 않는 목표 ID나 횟수를 선언하지 않는다.
- `escape`는 실제 접촉 가능한 출구 하나를 한 번 요구한다.
- `break-parts`는 파괴/결속 프롭 또는 접촉 가능한 보스 부위만 가리킨다.
- `assemble`은 모든 목표가 `interaction.mode: "assembly"`이고 최소 필요 접촉 수가 턴 제한 이하여야 한다.
- `seal`은 접촉 가능한 프롭/약점과 실제로 달성 가능한 방향·순서 조건을 사용한다.

## 3. 1·2·3인 클리어 가능성을 각각 검증한다

- 모든 캠페인 스테이지는 1인, 2인, 3인 파티로 각각 초기화하며, 출고 전에는 승리 상태까지 도달하는 목표별 결정론적 시뮬레이션 또는 기록된 수동 검수 대상이다.
- 한 파티 크기의 성공을 다른 크기의 성공으로 간주하지 않는다.
- 서로 다른 영웅·속성·아군 접촉이 필수인 규칙은 해당 인원이 없을 때의 명시적 대체 규칙이 있어야 한다.
- 스폰이 화면 밖으로 밀리거나, 목표 최소 행동 수가 턴 제한을 넘거나, 특정 인원에서 승리 조건이 수학적으로 불가능하면 실패다.
- 빠른 스모크는 전 스테이지×3개 파티 크기의 초기화·한 턴·직렬화까지만 검사한다. 이 통과를 클리어 가능성 통과로 표기하지 않는다.
- 출고 시뮬레이션은 실제 승리·실패 경로를 끝까지 검사한다. 현재 미완료 조합은 `MANUAL_CLEAR_AUDIT.md`와 Vitest `todo` 대기열에 정직하게 남긴다.

## 4. 레이어드 아트 커버리지

상용 스테이지는 다음 세 게이트를 모두 만족한다.

1. 각 스테이지에 고유한 `arena.backgroundAssetUrl`이 있다.
2. 모든 벽에 `wall.presentation`과 존재하는 WebP가 있다.
3. 모든 `kind: "prop"` 스폰에 `presentation`과 필요한 상태 WebP가 있다.

제작 중 폴백이 꼭 필요하면 route 데이터에 다음과 같은 명시적 waiver를 둔다.

```json
{
  "commercialWaivers": [
    {
      "id": "route-03-layered-art-transition",
      "gates": ["backgroundAssetUrl", "wall-presentation", "prop-presentation"],
      "reason": "어떤 최종 에셋을 제작 중인지 설명한다.",
      "sunset": "remove-before-1.0"
    }
  ]
}
```

- 지원 gate 이외의 문자열, 짧거나 빈 사유, 종료 조건 없는 waiver는 실패다.
- 완성된 범위의 gate는 즉시 waiver에서 제거한다. 이미 완성된 배경을 waiver로 계속 가려 회귀를 허용하지 않는다.
- waiver는 개발 브리지이며 1.0/상용 패키지의 품질 증명이 아니다.

## 5. 오디오 의미 중복 금지

- `적 턴`, `적 공격 예고`, `위험 경고`, `목표 실패`, `UI 오류`처럼 플레이 판단이 다른 키는 같은 음원 해시를 공유할 수 없다.
- 같은 재질 충돌의 변형처럼 의미가 같은 family 안에서만 원본 공유·피치 변형을 허용한다.
- 오디오 카탈로그 검증은 `key`, `semanticFamily`, 파일 해시를 함께 보고 서로 다른 family의 동일 해시를 오류로 처리한다.
- 파일명만 복사해 다른 키로 늘리는 것은 변형 수로 세지 않는다.

## 6. 현재 검증 출력 읽기

`validate:content`의 `commercialStrict`에는 다음이 포함된다.

- `unsupportedPlayerVisibleEffects`
- `objectiveTypesWithPlayerCopy`
- `simulatedPartySizes`
- `waiverCount`
- 배경·벽·프롭의 authored/waived 커버리지

오류 배열이 비어 있더라도 waiver가 남아 있으면 해당 아트는 전환 중이다. 출고 보고서에는 authored와 waived 수를 구분해서 적는다.

`simulatedPartySizes`는 strict 정적 검증과 빠른 초기화 스모크가 다루는 파티 크기다. 이 값만으로 제한 턴 내 승리 경로가 검증됐다고 해석하지 않는다.
