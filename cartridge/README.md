# 고양이 오디세이

고양이 영웅 자체를 당겨 쏘고 벽·적·괴수 부위에 튕겨 연속 타격하는 PC용 2D 리코셰 액션 RPG입니다. Language Miner는 게임 목록, 실행, 저장소와 다이아 지갑만 제공하며 게임 안에는 퀴즈나 학습 화면이 없습니다.

> **비상업 컷신 고지:** EP1–20은 ElevenLabs Text to Speech 음성을
> 포함합니다. EP1–11의 당시 플랜은 확인되지 않아 무료 플랜과 같은
> 비상업 조건으로 다루며, EP12–20은 무료 플랜 기록이 확인됐습니다.
> MP4 제목·게임 제목·회상 목록·배포 문서에는 `elevenlabs.io`가
> 표시됩니다. 이 영상은
> `LicenseRef-Cat-Odyssey-ElevenLabs-NC-1.0`에 따라 비상업 배포만
> 허용됩니다. 자세한 내용은 pack 최상위의 `CUTSCENE_CREDITS.md`와
> `ASSET_LICENSES.md`를 확인하세요.

## 실행

프로젝트 루트의 `index.html`을 더블클릭하면 파일 실행 전용 `standalone/index.html`로 연결되어 바로 게임이 열립니다. 소스를 수정한 뒤에는 먼저 일반 빌드만 갱신합니다.

```text
npm run build
index.html 더블클릭
```

개발 중에는 Vite 프리뷰를 사용할 수 있습니다.

```text
npm run dev
http://127.0.0.1:4173/
```

일반 웹 빌드를 확인하려면 `dist`를 정적 서버로 엽니다.

```text
python -m http.server 4173 --directory dist
http://127.0.0.1:4173/game/index.html
```

`.lemgame` 패킹은 별도 배포 단계이며 위 실행 방법에는 필요하지 않습니다.

외부 CDN이나 네트워크 요청은 사용하지 않습니다. `window.LEM_GAME_HOST_API`가 없는 브라우저 프리뷰에서는 pack의 mock Host가 선택됩니다.

## Host API 경계

게임은 플랫폼 기능을 `src/platform/hostAdapter.ts` 뒤에서만 사용합니다.

- 앱 안: `window.LEM_GAME_HOST_API`
- 앱 밖: `createMockGameHost()`
- 지갑: `wallet.getBalance()`, `wallet.spend()`
- 저장: `save.load()`, `save.write()`, `save.clear()`
- UI: `ui.toast()`, `ui.confirm()`

mock 지갑은 manifest와 액션 ID·가격·사유·확인 여부가 모두 같은 요청만 받습니다. 같은 구매 의도는 같은 `idempotencyKey`를 사용하며, 성공한 키를 다시 보내도 한 번만 차감합니다. mock 잔액은 개발 프리뷰용 메모리 값이며 Language Miner의 실제 지갑이 아닙니다.

## 저장과 구매 복구

저장 키는 `cat-odyssey-save-v1`, schema는 v1입니다.

저장 항목:

- 항로와 스테이지 진행
- 보유 영웅, 파티, 조각과 각성
- 게임 안에서 획득한 골드·재료·유물·스킨
- 신탁 천장과 엔드게임 기록
- 설정과 플레이 기록
- pending 구매와 완료 영수증

다이아 잔액과 지갑 거래내역은 게임 save에 저장하지 않습니다. 잔액은 매번 Host에서 읽습니다.

구매는 다음 순서를 지킵니다.

```text
pending 구매 저장
→ Host wallet.spend
→ transactionId와 spent 상태 저장
→ 게임 보상과 영수증 커밋
→ pending 제거
```

중간에 창이 닫히면 다음 실행에서 pending을 복구합니다. 차감 전 상태는 같은 idempotency key로 Host에 재요청하고, 차감 완료 상태는 지갑을 다시 건드리지 않고 보상만 커밋합니다. 중요한 변화는 즉시 저장하며 `pagehide`, `beforeunload`, 숨김 전환에서도 최신 스냅샷을 flush합니다.

## 다이아 액션

| ID | 비용 | 용도 | 반복 |
| --- | ---: | --- | --- |
| `oracle-summon-1` | 100◆ | 신탁 소환 1회 | 예 |
| `oracle-summon-10` | 900◆ | 신탁 소환 10회 | 예 |
| `battle-rescue` | 60◆ | 패배 직전 구조 요청 | 예 |
| `blessing-reroll` | 30◆ | 가호 후보 재선택 | 예 |
| `storm-extra-run` | 40◆ | 폭풍 항로 추가 출항 | 예 |
| `raid-extra-key` | 50◆ | 토벌 열쇠 보충 | 예 |
| `awakening-materials` | 120◆ | 각성 재료 보충 | 예 |
| `vault-expansion` | 180◆ | 보물고 슬롯 영구 +20 (기본 20칸) | 아니오 |

게임은 다이아를 지급하거나 직접 수정하지 않습니다. 모든 소비는 Host 확인을 거칩니다.

## 권한

- `network`: false
- `externalLinks`: false
- `filesystem`: false
- `clipboard`: false
- `cardsRead`: false
- `cardsCreate`: false
- `walletSpend`: true — 위 8개 manifest 액션에만 사용

## 개발 프리뷰의 한계

- mock 잔액과 성공 거래의 idempotency Map은 프리뷰 런타임 메모리에만 존재합니다.
- mock save만 브라우저 `localStorage`를 fallback으로 사용합니다.
- 실제 지갑 보안, 영구 거래 중복 방지와 pack별 저장 격리는 Language Miner Host 책임입니다.
- 게임 코드는 Language Miner 앱 소스, Electron API, Node API나 사용자 파일에 접근하지 않습니다.

## 업데이트

- `lineageId`: `adb6ec88-2557-4fb2-857a-76e5c057f998` — 모든 버전에서 유지합니다.
- 새 `.lemgame` 배포마다 `version`과 `releaseNotes`를 갱신합니다.
- 저장 구조가 바뀔 때만 `save.schemaVersion`을 올리고 migration을 제공합니다.
- 상업 배포로 전환할 때는 기존 음성을 소급 전환하지 않습니다. 유료 플랜 기간에 음성을 새로 생성하고 그 음성이 들어간 EP1–20 영상과 파생물을 다시 만든 뒤 자산 감사를 갱신합니다.
