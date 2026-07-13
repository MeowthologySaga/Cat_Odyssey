# Cat Odyssey / 고양이 오디세이

Cat Odyssey is the official built-in ricochet action RPG for Language Miner.
The learning app supplies the launcher, save boundary, and diamond wallet; the
game itself is a standalone-style game without quizzes or study UI.

> **Non-commercial cutscene notice:** all 20 story videos contain narration made
> with ElevenLabs Text to Speech. Episodes 1–11 have no preserved plan record and
> are conservatively treated as free-plan output; episodes 12–20 have a confirmed
> free-plan record. Every public episode title includes `elevenlabs.io`, including
> the embedded MP4 title, in-game title, replay list, and release documentation.
> These videos are distributed only under
> `LicenseRef-Cat-Odyssey-ElevenLabs-NC-1.0` and are not licensed for commercial
> use. See `CUTSCENE_CREDITS.md` and `ASSET_LICENSES.md`.

## What is included

- Editable TypeScript/Phaser game source under `src/`
- All runtime art, 51 music/SFX files, and 20 story cutscenes under `public/`
- Browser and file-open builds driven by Vite
- Language Miner cartridge metadata, icon, thumbnail, validation, and
  deterministic `.lemgame` packaging
- Runtime-media SHA-256 manifests and path-by-path provenance categories
- Unit, content, physics, platform, and packaging tests

Generated bundles, source videos, production logs, prompts, caches, local
paths, API credentials, and unrelated production material
are not source inputs and are not included.

## Prerequisites

- Git 2.40 or newer
- Git LFS 3.x
- Node.js 22 LTS or a version accepted by Vite 7
- npm 10 or newer
- FFmpeg only when running the optional asset-metadata sanitizer

All game media is versioned with Git LFS. A normal source checkout must include
the LFS objects before a build can reproduce the complete Language Miner game.

```powershell
git lfs install
git lfs pull
npm ci
npm run qa
```

`npm run release:check` performs the stricter non-commercial public-release
gate, including embedded title attribution, media integrity, and path-specific
license checks.

## Run and build

Development server:

```powershell
npm run dev
```

Production web bundle plus the file-open bundle:

```powershell
npm run build
```

After building, either serve `dist/` or double-click the repository root
`index.html`; it forwards to `standalone/index.html`. The runtime is fully
offline and has no CDN or network dependency.

## Validate and package for Language Miner

```powershell
npm run test
npm run validate:content
npm run build
npm run validate:pack
npm run package:lem
```

The package command creates a deterministic archive and a `.sha256` sidecar in
`releases/`. Both are intentionally ignored by Git. For a public release, attach
the `.lemgame` and sidecar to a GitHub Release whose tag points at the exact source
commit. Record the commit, tag, archive filename, byte size, and SHA-256 in the
release notes. The release title must include `elevenlabs.io`, and both the title
and description must identify the cutscene media as non-commercial.

The source checkout can be verified against:

- `MEDIA_MANIFEST.json` — every Git LFS runtime object and its SHA-256
- `ASSET_INVENTORY.json` — path, size, hash, media type, origin category, and
  rights state for each shipped image, audio file, and cutscene
- `public/assets/audio/catalog.json` — runtime audio registry integrity

Regenerate these deterministic inventories after an approved asset change:

```powershell
npm run assets:inventory
```

## Language Miner Host boundary

The game accesses host functionality only through `src/platform/hostAdapter.ts`.
In Language Miner it uses `window.LEM_GAME_HOST_API`; in a local browser it uses
the isolated mock host. The adapter exposes save, toast/confirm UI, and the
manifest-declared diamond-spend actions. The game never stores or grants
diamonds itself.

The cartridge declares no network, filesystem, clipboard, external-link, or
card access. `walletSpend` is the only enabled privileged capability, and every
spend is matched to the cartridge manifest and uses an idempotency key.

## Licensing

- Original source code: MIT, in `LICENSE`
- Third-party code and build tools: `THIRD_PARTY_NOTICES.md` and
  `THIRD_PARTY_PACKAGES.json`
- Official art, Suno audio, names, and branding: excluded from MIT and covered by
  `LicenseRef-Meowthology-Official-Builtin`; see `ASSET_LICENSES.md`
- ElevenLabs narration and every derivative cutscene containing it:
  `LicenseRef-Cat-Odyssey-ElevenLabs-NC-1.0`, non-commercial only, with title
  attribution; see `CUTSCENE_CREDITS.md`

The narration scripts were prepared by the project owner with AI assistance.
Episodes 12–20 used the ElevenLabs Voice Library voice “Spuds Oxley - Wise and
Approachable” in Text to Speech; the historical voice name for episodes 1–11 was
not preserved. The user reports that they did not create a voice clone. This is
not a claim of ownership over the provider voice or service.

The MIT code may be used independently under MIT. A commercial Cat Odyssey or
Language Miner distribution must not treat historical free-plan narration as
converted by a later subscription. It must generate new narration during an
eligible paid-plan period, confirm the applicable voice terms, and rebuild every
derivative video from that new audio before commercial distribution.

No font files are distributed. The UI uses locally installed system-font
fallbacks only.
