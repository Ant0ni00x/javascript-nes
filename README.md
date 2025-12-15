# JavaScript-NES - Modernized JavaScript NES Emulator

A modernized Nintendo Entertainment System (NES) emulator written in JavaScript. This fork focuses on **accuracy, maintainability, and clean architecture**, with particular emphasis on correct mapper behavior and long-term extensibility.

## Features

* ✅ **Pure JavaScript** — Runs in any modern browser, no plugins required
* ✅ **ES6 Modules** — Clean, maintainable codebase with proper imports/exports
* ✅ **Modern Audio** — AudioWorklet-based sound with ScriptProcessor fallback
* ✅ **Capability‑Driven Mappers** — The PPU interacts with mappers strictly through declared behavioral capabilities (no mapper IDs, no method‑presence heuristics)
* ✅ **Accurate Mapper Emulation** — Correct MMC1, MMC2, MMC3, MMC4, and MMC5 behavior
* ✅ **CHR Latch Accuracy** — Hardware‑accurate MMC2/MMC4 latch triggering using real pattern fetch addresses (fine‑Y + both bitplanes)
* ✅ **Stable IRQ Timing** — MMC3 IRQs driven by true A12 rising‑edge detection
* ✅ **Drag & Drop ROM Loading** — Load `.nes` files directly into the emulator
* ✅ **Gamepad Support** — Native browser Gamepad API integration

## Quick Start

1. Clone or download this repository
2. Serve the files with any HTTP server:

   ```bash
   # Python 3
   python -m http.server 8000

   # Node.js
   npx serve
   ```
3. Open `http://localhost:8000/nes-embed.htm` in your browser
4. Click to start or drag a `.nes` ROM file onto the emulator

## Controls

| Key        | Action   |
| ---------- | -------- |
| Arrow Keys | D‑Pad    |
| A / Q      | A Button |
| S / O      | B Button |
| Enter      | Start    |
| Tab        | Select   |

Gamepad support is automatic.

## Project Structure

```
├── nes-embed.htm          # Main HTML interface
├── nes-embed.css          # Stylesheet for modernized UI
├── nes-embed.js           # Frontend: canvas, audio, input handling
├── nes-audio-worklet.js   # AudioWorklet processor
└── src/
    ├── nes.js             # Emulator orchestrator
    ├── cpu.js             # 6502 CPU emulation
    ├── ppu.js             # Picture Processing Unit (renderer)
    ├── papu.js            # Audio Processing Unit (APU)
    ├── rom.js             # iNES ROM parser
    ├── mappers.js         # Mapper implementations
    ├── controller.js      # Input handling
    ├── tile.js            # Tile/sprite helpers
    └── utils.js           # Shared utilities
```

## Supported Mappers

| Mapper    | Status | Notes                                   |
| --------- | ------ | --------------------------------------- |
| NROM (0)  | ✅      | Baseline mapper                         |
| MMC1 (1)  | ✅      | Correct shift‑register behavior         |
| UxROM (2) | ✅      | PRG banking                             |
| CNROM (3) | ✅      | CHR banking                             |
| MMC3 (4)  | ✅      | A12‑driven IRQs                         |
| MMC5 (5)  | 🟡     | ExRAM + split screen support evolving   |
| MMC2 (9)  | ✅      | Accurate CHR latch timing (Punch‑Out!!) |
| MMC4 (10) | ✅      | Dual latch variant                      |

## Design Philosophy

This emulator intentionally avoids hard‑coding mapper IDs inside the PPU or CPU. Instead:

* Each mapper **declares behavioral capabilities** (e.g. CHR latch, A12 IRQ, nametable override)
* The PPU calls mapper hooks **only when the corresponding capability flag is set**
* If a capability is declared, the mapper guarantees the required method exists

This approach prevents cross‑mapper regressions and makes new mappers significantly easier to add.

For deep technical details, see **TECHNICAL.md**.

## Development Notes

### Audio System

The emulator uses a two-tier audio system:

1. **AudioWorklet** (preferred) — Runs on a dedicated audio thread for glitch-free playback
2. **ScriptProcessor** (fallback) — For browsers without AudioWorklet support

Audio samples are batched and sent to the worklet to minimize postMessage overhead.

## Credits

Based on [JSNES](https://github.com/bfirsh/jsnes) by Ben Firshman, which was based on vNES by Jamie Sanders.

Modernization and mapper fixes contributed by Antonio Armstrong.
AI Coding Assistance:
- [Claude Code]{https://claude.com/)
- [ChatGPT](https://chatgpt.com/)
- [Gemini](https://gemini.google.com/)
- [Copilot](https://copilot.microsoft.com/)
- [Grok](https://copilot.microsoft.com/)

If you want to assist, please take a look at the technical document and give it a whirl!

## License

This project is under the GPL v3 license.

## Legal

This emulator does not include any copyrighted ROM files. You must provide your own legally obtained ROM dumps to use with this emulator.
