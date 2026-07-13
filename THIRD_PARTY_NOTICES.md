# Third-Party Notices

The complete dependency lock audit is in `THIRD_PARTY_PACKAGES.json`. It is
generated from `package-lock.json` and currently records 116 packages with no
missing license identifier.

License summary:

| SPDX expression | Packages |
| --- | ---: |
| MIT | 108 |
| ISC | 3 |
| Apache-2.0 | 2 |
| (MIT OR GPL-3.0-or-later) | 1 |
| (MIT AND Zlib) | 1 |
| BSD-3-Clause | 1 |

## Runtime code

The production minifier removes upstream comment headers. Their copyright and
license notices are therefore reproduced as separate files in `licenses/` and
are included in every `.lemgame` package.

- Phaser 3.90.0 — Copyright (c) 2024 Richard Davey, Phaser Studio Inc. — MIT —
  `licenses/PHASER-3.90.0.txt`
- EventEmitter3 5.0.4 — Copyright (c) 2014 Arnout Kazemier — MIT —
  `licenses/EVENTEMITTER3-5.0.4.txt`
- Matter.js 0.20.0 — Copyright (c) Liam Brummitt and contributors. — MIT —
  `licenses/MATTER-0.20.0.txt`
- Earcut 2.2.4 — Copyright (c) 2016, Mapbox — ISC —
  `licenses/EARCUT-2.2.4.txt`
- Simplify.js — Copyright (c) 2017, Vladimir Agafonkin — BSD-2-Clause —
  `licenses/SIMPLIFY-JS.txt`
- AudioContextMonkeyPatch — Copyright 2013 Chris Wilson — Apache-2.0 —
  `licenses/AUDIOCONTEXT-MONKEYPATCH-NOTICE.txt` and
  `licenses/APACHE-2.0.txt`
- poly-decomp 0.3.0 — author Stefan Hedman — MIT —
  `licenses/POLY-DECOMP-0.3.0.txt`
- Vite 7.3.6 modulepreload polyfill — Copyright (c) 2019-present, VoidZero
  Inc. and Vite contributors — MIT — `licenses/VITE-7.3.6.txt`

Phaser's Matter integration also includes the MIT plugins MatterAttractors,
MatterWrap, and MatterCollisionEvents. Source comments additionally credit
Minko Gechev, Gavin Kistner, and Paul Bourke for incorporated algorithms.
Phaser-source MIT contributions include CodeAndWeb GmbH's PhysicsEditor parser
and RoboWhale's median helper.

## Build, test, and packaging tools

These packages are development dependencies and are not copied as
`node_modules` into the game or `.lemgame` archive:

- JSZip 3.10.1 — dual licensed `(MIT OR GPL-3.0-or-later)`; this project uses
  it under the MIT option. Upstream text: `licenses/JSZIP-3.10.1.txt`.
- TypeScript 5.9.3 — Copyright (c) Microsoft Corporation — Apache-2.0.
  License: `licenses/APACHE-2.0.txt`; bundled notices:
  `licenses/TYPESCRIPT-5.9.3-THIRD-PARTY.txt`.
- Vite 7.3.6 — MIT — `licenses/VITE-7.3.6.txt`.
- Vitest 3.2.7 — Copyright (c) 2021-Present Vitest Team — MIT —
  `licenses/VITEST-3.2.7.txt`.

Their full transitive dependency names, versions, development/runtime flags,
and license expressions are recorded in `THIRD_PARTY_PACKAGES.json`. Installing
with `npm ci` restores each package's upstream license files from the locked npm
artifacts.

Third-party software is provided under its respective upstream license and
without warranties from the Cat Odyssey authors.

## Generated cutscene voice disclosure

`public/assets/video/cutscenes/ep1.mp4` through `ep20.mp4` contain narration
generated using ElevenLabs Text to Speech. Episodes 1–11 have no preserved plan
record and are conservatively treated as free-plan output. Episodes 12–20 have
a confirmed free-plan record and used the ElevenLabs Voice Library voice
“Spuds Oxley - Wise and Approachable.” The historical voice name for episodes
1–11 was not preserved. The user reports that they did not create a voice
clone. This is generated output, not a bundled copy of ElevenLabs software,
models, or voice technology.

- Required public title attribution: `elevenlabs.io`
- Distribution scope: non-commercial only
- Project license id: `LicenseRef-Cat-Odyssey-ElevenLabs-NC-1.0`
- Episode-by-episode titles and paths: `CUTSCENE_CREDITS.md`
- Governing project notice: `ASSET_LICENSES.md`
- Provider terms: https://elevenlabs.io/terms-of-use
- Provider publishing guidance:
  https://help.elevenlabs.io/hc/en-us/articles/13313564601361-Can-I-publish-the-content-I-generate-on-the-platform

The TypeScript source, replay list, MP4 title metadata, credits table, and
release instructions display `elevenlabs.io`. MeowthologySaga does not claim
provider or Voice Library creator endorsement and grants no rights beyond those
permitted by the applicable provider terms. Commercial use requires new
paid-plan-period narration, confirmation of the selected voice terms, and
rebuilt derivative videos; historical free-plan files do not become
commercially licensed merely because an account is upgraded later.
