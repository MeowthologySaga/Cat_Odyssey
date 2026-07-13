# Cat Odyssey Asset Licenses

This document applies to non-code assets. The repository `LICENSE` does not
license game art, audio, video, names, logos, or branding.

## LicenseRef-Meowthology-Official-Builtin

Except for the cutscene paths covered by the narrower section below, the rights
holder grants permission to download and reproduce the listed assets only as
part of a complete Cat Odyssey build, Cat Odyssey source checkout, official
Language Miner distribution, or Cat Odyssey `.lemgame` package. The copyright and
notices in this repository must remain with every redistributed copy.

The following are not permitted without separate written permission:

- extraction, resale, relicensing, or redistribution as a standalone asset pack;
- use in an unrelated game, application, dataset, model-training corpus, or
  promotional work;
- use of Cat Odyssey or MeowthologySaga names or logos to imply endorsement;
- removal of provenance, copyright, or third-party notices.

All rights not expressly granted are reserved by MeowthologySaga.

## Path-by-path source of truth

`ASSET_INVENTORY.json` is the authoritative file-level list. It records SHA-256,
size, media type, origin category, license id, and current rights status.

### Generated images

The rights holder confirms that these paths were generated with OpenAI Codex at
the user's direction and that the rights holder controls commercial use and
redistribution of the resulting project assets:

- `public/assets/art/**`
- `cartridge/assets/thumbnail.webp`

OpenAI's terms assign Output to the user as between OpenAI and the user, subject
to applicable law, while also warning that output may not be unique. This notice
does not claim that copyright protection exists in every jurisdiction.

Reference: https://openai.com/policies/terms-of-use/

### Music and sound effects

The rights holder confirms that audio in these inventory categories was made
while the relevant Suno account had a paid plan and that the rights holder owns
the commercial-use and redistribution rights needed for this project:

- `suno-paid-dedicated`
- `suno-paid-user-owned-remaster`
- `suno-paid-user-owned`

The three `project-owned-procedural` files were deterministically synthesized by
the project and are not represented as Suno output:

- `public/assets/audio/bgm/voyage-ricochet.mp3`
- `public/assets/audio/sfx/ricochet-hit.mp3`
- `public/assets/audio/sfx/summon-reveal.mp3`

Suno's published guidance says songs made while subscribed to a paid plan are
granted commercial-use rights, including use in video games. It does not
guarantee copyright protection or uniqueness.

References:

- https://help.suno.com/en/articles/9601665
- https://help.suno.com/en/articles/2416769
- https://help.suno.com/en/articles/9601985

### Story cutscenes — LicenseRef-Cat-Odyssey-ElevenLabs-NC-1.0

The following paths contain narration generated using ElevenLabs Text to Speech
and are governed by this narrower path-scoped license:

- `public/assets/video/cutscenes/ep1.mp4` through `ep20.mp4`

Episodes 1–11 have no preserved paid/free plan record and are conservatively
treated as free-plan output. Episodes 12–20 have a confirmed free-plan record.
The generation surface was ElevenLabs Text to Speech. Episodes 12–20 used the
ElevenLabs Voice Library voice “Spuds Oxley - Wise and Approachable”; the exact
historical voice name for episodes 1–11 was not preserved. The user reports
that they did not create a voice clone. The narration scripts are controlled by
the project owner and were prepared with AI assistance.

Subject to the current provider terms, the rights holder grants permission to
download, reproduce, and redistribute these videos only when all of the
following conditions are met:

- use and distribution are non-commercial and non-monetized;
- the videos remain part of a complete Cat Odyssey source checkout, complete
  Cat Odyssey build, official Language Miner distribution, or Cat Odyssey
  `.lemgame` package;
- every published episode title includes `elevenlabs.io` or `11.ai`; this
  project uses `elevenlabs.io`;
- `CUTSCENE_CREDITS.md`, this license notice, and provider notices remain with
  every copy; and
- the narration or voice is not extracted, resold, relicensed, used for voice
  cloning, or represented as owned by or endorsed by MeowthologySaga.

No commercial use, monetized distribution, standalone media redistribution,
standalone voice extraction, model training, or relicensing is granted. This
repository grants no right in ElevenLabs' services, models, Voice Library
voices, trademarks, or other provider technology. Downstream users must
independently comply with the current ElevenLabs Terms and Prohibited Use
Policy. The exact path/title mapping is in `CUTSCENE_CREDITS.md`; attribution is
embedded in every MP4 title and displayed by the game and replay list.

Official references:

- https://elevenlabs.io/terms-of-use
- https://help.elevenlabs.io/hc/en-us/articles/13313564601361-Can-I-publish-the-content-I-generate-on-the-platform

A future paid subscription does not retroactively commercialize historical
free-plan outputs. Commercial distribution requires newly generating the
narration during an eligible paid-plan period and rebuilding every derivative
video from that new audio, followed by a new rights and checksum audit.

The path-scoped inventory records the generation mode, plan status, voice
disclosure, non-commercial license identifier, attribution surfaces, and final
SHA-256 for every cutscene.

## Fonts

No font files are shipped. `Malgun Gothic`, `Noto Sans KR`, `Georgia`,
`system-ui`, `sans-serif`, and `serif` appear only as system fallback names.
