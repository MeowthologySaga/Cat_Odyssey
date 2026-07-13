# 레이어드 스테이지 UGC 작성 계약

이 문서는 특정 게임이나 장르에 종속되지 않는 2D 스테이지 작성 규칙이다. 배경 한 장에 장애물과 목표물을 구워 넣지 않고, 기반 맵·프롭·벽·위험·충돌·목표를 데이터로 분리한다. Cat Odyssey의 항로 1은 이 계약의 실제 작동 예시다.

## 기본 원칙

- `arena.backgroundAssetUrl`은 지형과 바닥 무늬만 포함한 WebP를 가리킨다.
- 충돌하거나 상태가 바뀌는 나무, 문, 상자, 기계, 목표물은 `kind: "prop"` 스폰으로 둔다.
- 벽 이미지는 충돌선과 별개다. 충돌은 `wall` 좌표가, 외형은 `wall.presentation`이 담당한다.
- 움직이거나 피해를 주는 환경 요소는 `hazard`로 둔다.
- 이미지가 누락되면 런타임은 기존 도형으로 안전하게 폴백할 수 있지만, 배포 검증은 누락을 오류로 취급한다.
- 생성형 이미지의 프롬프트와 원본은 별도 제작 보관소에 보존하고, 런타임에는 최적화된 WebP만 넣는다.
- 상용 strict 세부 규칙과 임시 waiver 형식은 `COMMERCIAL_CONTENT_GATE.md`를 따른다.

## 스테이지별 기반 맵

```json
{
  "arena": {
    "id": "forest-clearing",
    "width": 720,
    "height": 1040,
    "backgroundKey": "arena-forest-clearing",
    "backgroundAssetUrl": "assets/art/maps/stages/forest-clearing.webp",
    "musicKey": "bgm-forest"
  }
}
```

`backgroundKey`는 텍스처 식별자이고 `backgroundAssetUrl`은 `public` 기준 안전한 WebP 경로다. 기반 맵에는 런타임이 이동·파괴·교체·충돌·정렬해야 하는 오브젝트를 넣지 않는다.

## 프롭 외형과 상태

```json
{
  "id": "tree-a",
  "kind": "prop",
  "x": 220,
  "y": 340,
  "radius": 48,
  "presentation": {
    "visualId": "prop-tree-intact",
    "width": 150,
    "height": 220,
    "anchorX": 0.5,
    "anchorY": 0.82,
    "stateVisualIds": {
      "intact": "prop-tree-intact",
      "damaged": "prop-tree-damaged",
      "fallen": "prop-tree-fallen",
      "stump": "prop-tree-stump"
    }
  },
  "interaction": {
    "mode": "destructible",
    "maxHp": 380
  }
}
```

프롭 이미지는 `public/assets/art/props/<visualId>.webp`에 둔다. `anchorX/Y`는 0~1 범위이며, 상태 이미지는 같은 충돌 중심과 시각적 기준점을 유지해야 한다.

지원 상호작용:

- `destructible`: HP 비율에 따라 `intact → damaged → fallen → stump` 상태를 사용한다.
- `bond`: HP 비율에 따라 `bonded → fraying → severed` 상태를 사용한다. 비살상 보스나 봉인 해제 목표에 적합하다.
- `assembly`: 한 발사에서 한 단계만 진행하며, 지정 횟수 접촉 후 목적지로 이동·고정된다.

## 조립 목표

```json
{
  "spawns": [
    {
      "id": "part-a",
      "kind": "prop",
      "x": 220,
      "y": 330,
      "radius": 34,
      "presentation": {
        "visualId": "prop-part-unplaced",
        "stateVisualIds": {
          "unlashed": "prop-part-unplaced",
          "positioned": "prop-part-positioned",
          "lashed": "prop-part-complete"
        }
      },
      "interaction": {
        "mode": "assembly",
        "hitsRequired": 2,
        "destination": { "x": 300, "y": 560 }
      }
    }
  ],
  "objective": {
    "type": "assemble",
    "turnLimit": 8,
    "targetIds": ["part-a"],
    "requiredCount": 1
  }
}
```

- 모든 `assemble` 목표 ID는 `kind: "prop"`이면서 `interaction.mode: "assembly"`인 스폰을 가리켜야 한다.
- 목적지는 아레나 안에 있어야 한다.
- 초기 스폰, 목적지, 다른 고정 충돌물 사이의 겹침을 테스트한다.
- 조립 완료 프롭은 이동과 충돌을 중지하고 완성 상태를 유지한다.

## 아트가 있는 벽

```json
{
  "id": "root-wall",
  "shape": "capsule",
  "x": 100,
  "y": 280,
  "x2": 150,
  "y2": 760,
  "radius": 28,
  "material": "wood",
  "restitution": 0.86,
  "presentation": {
    "visualId": "wall-forest-root",
    "width": 500,
    "height": 76
  }
}
```

벽 이미지는 `public/assets/art/walls/<visualId>.webp`에 둔다. 런타임은 이미지의 중심과 각도를 충돌선의 중점·각도에 맞춘다. 긴 벽은 정사각형 프롭 팩에 넣지 말고 개별 wide asset 또는 strip으로 만든다.

## 이동 파도

```json
{
  "id": "wave-a",
  "type": "wave-front",
  "x": 360,
  "y": 860,
  "radius": 84,
  "parameters": {
    "axis": "y",
    "direction": -1,
    "distance": 520,
    "warningTurns": 1,
    "activeTurns": 4,
    "length": 720,
    "forceX": 0,
    "forceY": -115,
    "damage": 58
  }
}
```

- `axis`는 파도의 긴 방향이 아니라 이동 축이다.
- `axis: "y"`는 수평 파도가 위·아래로 이동한다.
- `axis: "x"`는 수직 파도가 좌·우로 이동한다.
- `direction`은 `-1` 또는 `1`이다.
- `warningTurns`에는 예고만 하고, 활성 턴에 이동·피해·밀치기를 적용한다.
- 같은 턴에 같은 파도가 같은 유닛을 중복 타격하지 않도록 런타임이 접촉 기록을 유지한다.
- 기본 이미지는 `public/assets/art/hazards/wave-front.webp`다.

## 비살상 보스 목표

보스를 쓰러뜨리지 않는 스테이지는 보스에게 `boss-cannot-be-killed` 수정자를 주고, 승리 조건은 별도의 `bond` 프롭이나 `break-parts` 목표로 선언한다. 보스 HP는 1 아래로 내려가지 않으며 목표 프롭이 모두 해제되면 전투가 끝난다. 스토리 설정과 런타임 승리 조건이 충돌하지 않게 하는 공용 패턴이다.

## 가독성 규칙

- 바닥형 위험(`current`, `wind-vector`, `slow-field`)은 낮은 투명도와 낮은 렌더 깊이를 사용한다.
- 충돌하는 파도·벽·범퍼는 강한 실루엣을 유지한다.
- 목표 HP/진행 바는 프롭 가까이에 두되, 차례 표시나 보호막 표시와 모양을 공유하지 않는다.
- HUD는 아레나 밖 영역을 우선 사용한다.
- 예고선은 위험 범위와 다음 행동만 설명하고 플레이 결과 전체를 미리 그리지 않는다.

## 검증

```powershell
npm.cmd run validate:content
npx.cmd tsc -p tsconfig.json --noEmit
npm.cmd test -- tests/content/stage-contract-validator.test.mjs
npm.cmd test -- tests/battle/all-stages-smoke.test.ts
```

`scripts/stage-contract-validator.mjs`는 다음을 차단한다.

- 존재하지 않거나 종류가 잘못된 목표 ID
- 잘못된 조립 상호작용과 아레나 밖 목적지
- 누락된 기반 맵, 프롭 상태 이미지, 벽 이미지
- 안전하지 않은 에셋 경로
- 잘못된 `wave-front` 축·방향·거리·턴·길이·힘·피해 값
- UI에 표시되지만 런타임/렌더러가 소비하지 않는 스테이지 효과
- 목표 타입·대상·필요 횟수·턴 제한과 실제 승리 규칙의 불일치
- 1인·2인·3인 파티 중 하나에서 수학적으로 달성할 수 없는 인원·속성 조건
- strict 모드에서 waiver 없는 스테이지 배경, 벽 presentation, 프롭 presentation 누락

개발 중 아트 폴백은 route의 `commercialWaivers`에 안정 ID, 정확한 gate, 구체적인 사유, 제거 조건을 기록해야 한다. 완성된 gate를 waiver에 계속 남겨 두지 않으며, 상용 1.0 출고에는 폴백을 품질 증명으로 사용하지 않는다.

새 UGC 장르가 다른 상태 이름을 요구하면 게임별 코드를 추가하기 전에 이 공용 데이터 계약과 검증기를 확장한다.
