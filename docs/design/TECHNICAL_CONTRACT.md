# 고양이 오디세이 — Technical Contract

## 런타임

- Phaser 3.90 + TypeScript 5.9 + Vite 7.
- 논리 해상도 720×1280, `FIT` 스케일, 중앙 정렬.
- WebGL 우선, Canvas fallback.
- 최종 번들은 외부 네트워크와 CDN 없이 실행한다.

## 물리

- 결정론적 벡터 solver가 조준 미리보기와 실제 이동을 모두 계산한다.
- 고정 시간 단위와 swept-circle 충돌로 고속 관통을 막는다.
- 벽은 선분/캡슐, 캐릭터와 적은 원, 약점과 부위는 독립 원/캡슐이다.
- 실제 판정 데이터를 그대로 텔레그래프와 디버그 오버레이에 사용한다.

## 데이터

- 영웅, 적, 항로, 스테이지, 가호, 유물, 보스 페이즈를 JSON 호환 TS 데이터로 둔다.
- seeded RNG로 전투, 소환, 폭풍 항로를 재현한다.
- UGC 스키마와 validator가 누락 참조, 범위 오류, 도달 불가능 스폰, 해부 잠금을 검사한다.
- commercial strict는 모든 스테이지를 1·2·3인 계약으로 검사하고, UI에 노출되는 미지원 효과·목표 설명/승리 조건 불일치·waiver 없는 배경/벽/프롭 아트 누락을 오류로 처리한다.
- 제작 중 아트 waiver는 route JSON에 안정 ID, 정확한 gate, 사유, sunset을 선언한다. 런타임은 추가 필드를 무시하지만 validator와 QA 보고서는 authored/waived 커버리지를 분리한다.

## Host와 저장

- 실제 `window.LEM_GAME_HOST_API` 또는 동일 계약의 mock을 adapter 뒤에서 선택한다.
- save schema v1은 진행, 소유 영웅, 성장, 인벤토리, 천장, pending 구매, 설정과 기록을 저장한다.
- 다이아 잔액은 저장하지 않는다.
- 중요한 변경 직후와 `pagehide`, `beforeunload`, `visibilitychange`에서 저장한다.

## 패키징

- `dist/game`은 자체 실행 가능한 정적 번들이다.
- `.lemgame`에는 `manifest.json`, pack `README.md`, `security-report.md`, 코드·자산 라이선스와 인벤토리, `licenses/`, `game/`, `assets/`만 포함한다.
- `node_modules`, `src`, sourcemap, `.git`, 절대경로, 비밀정보와 외부 URL을 포함하지 않는다.
- lineageId: `adb6ec88-2557-4fb2-857a-76e5c057f998`.
