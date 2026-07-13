# Security Report

## Pack Identity

- Pack id: `meowthology.cat-odyssey`
- Lineage id: `adb6ec88-2557-4fb2-857a-76e5c057f998`
- Version: `0.1.1`
- Content type: `game_pack`
- Runtime: sandboxed iframe static bundle

## Files

- Executable OS files: none
- Nested archives: none
- Source maps in release: none
- External URLs or CDN dependencies: none
- Absolute paths: none
- Path traversal entries: none
- Secrets, tokens or environment files: none
- `node_modules`, `src`, `.git` in release: none
- Final file count and unpacked size: release validator records these from the packaged archive

## Asset Sanitization

- Generated PNG/WebP assets are stored under stable pack-relative paths.
- Image metadata is stripped during release preparation.
- Audio is locally bundled and duration/peak checked before packaging.
- HTML, JSON and subtitles are scanned for script injection and external URLs.
- Oversized textures and audio are rejected by the release budget validator.

## Permissions

- `network`: false
- `externalLinks`: false
- `filesystem`: false
- `clipboard`: false
- `cardsRead`: false
- `cardsCreate`: false
- `walletSpend`: true

The game receives no Node/Electron primitives, user file paths, environment variables, clipboard access or raw IPC objects.

## Economy

Declared diamond actions:

- `oracle-summon-1`: 100, repeatable, confirmation required
- `oracle-summon-10`: 900, repeatable, confirmation required
- `battle-rescue`: 60, repeatable, confirmation required
- `blessing-reroll`: 30, repeatable, confirmation required
- `storm-extra-run`: 40, repeatable, confirmation required
- `raid-extra-key`: 50, repeatable, confirmation required
- `awakening-materials`: 120, repeatable, confirmation required
- `vault-expansion`: 180, non-repeatable, confirmation required

Runtime requests must match manifest `id`, `amount`, `reason` and `requiresConfirm` exactly.

Idempotency examples:

```text
meowthology.cat-odyssey:oracle-summon-10:banner-01-pull-00017
meowthology.cat-odyssey:battle-rescue:run-0042-rescue
meowthology.cat-odyssey:vault-expansion:profile-vault-01
```

The save contains pending purchase intent, action id, idempotency key, reward payload and transaction id needed for recovery. It never contains wallet balance. Reward application is deterministic and committed with a bounded receipt history after Host spend succeeds.

## Risk Notes

- Risk level: medium
- Reason: local third-party JavaScript with declared wallet spend permission
- Network exfiltration surface: none by manifest and build policy
- Known risk: production Host must not trust the pack's mock adapter
- Known risk: production Host must validate every spend against manifest and provide persistent idempotency
- Known risk: save and transaction recovery must be tested with forced close at every purchase phase

Required Host protections:

- iframe sandbox without Node/Electron access
- postMessage source and request ID validation
- manifest-gated Host API methods
- confirmation before all 8 spend actions
- persistent transaction idempotency
- save isolation by user profile and cartridge id
- safe archive extraction and path traversal rejection

## Release Verification

- Run all platform tests.
- Launch the unpacked game with mock Host and exercise every diamond action.
- Launch the packaged `.lemgame` in PlayZone and repeat save/reopen and spend tests.
- Force-close once before spend, after spend, and during reward commit; confirm recovery grants exactly once.
- Confirm manifest action parity and that save JSON has no `diamonds` or `walletBalance` field.
- Confirm image/audio/font assets use stable relative URLs and do not flicker on wallet or save updates.
