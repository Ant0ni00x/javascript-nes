# JavaScript-NES - Modernized

A modernized Nintendo Entertainment System (NES) emulator written in JavaScript. This is a heavily refactored fork featuring ES6 modules, accurate mapper implementations, modern Web Audio API support, and an overhauled user interface.

## Features

- ✅ **Pure JavaScript** — Runs in any modern browser, no plugins required
- ✅ **ES6 Modules** — Clean, maintainable codebase with proper imports/exports
- ✅ **Modern Audio** — AudioWorklet-based sound with ScriptProcessor fallback
- ✅ **Accurate Mappers** — Working implementations of MMC1, MMC2, MMC3, MMC4, and more
- ✅ **Drag & Drop** — Load ROMs by dragging .nes files onto the emulator
- ✅ **Gamepad Support** — Native browser Gamepad API integration
- ✅ **MMC2 fully working!** (Punch-Out!! is one of the best stress tests there is)
- ✅ **Correct latch timing** (fine-Y + both bitplanes)
- ✅ **Pure behavioral capability** flags instead of mapper IDs
- ✅ A PPU that no longer “knows” about mappers

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

| Key | Action |
|-----|--------|
| Arrow Keys | D-Pad |
| A / Q | A Button |
| S / O | B Button |
| Enter | Start |
| Tab | Select |

Gamepad support is automatic — connect an Xbox or similar controller.

## Project Structure

```
├── nes-embed.htm          # Main HTML interface
├── nes-embed.css          # Stylesheet for modernized UI
├── nes-embed.js           # Frontend: canvas, audio, input handling
├── nes-audio-worklet.js   # AudioWorklet processor for low-latency sound
└── src/
    ├── nes.js             # Refactored Main emulator orchestrator
    ├── cpu.js             # Refactored 6502 CPU emulation with illegal opcodes
    ├── ppu.js             # Refactored Picture Processing Unit
    ├── papu.js            # Refactored Audio Processing Unit (APU)
    ├── rom.js             # Refactored iNES ROM parser
    ├── mappers.js         # Refactored Memory mapper implementations
    ├── controller.js      # Updated Input handling
    ├── tile.js            # Refactored Tile/sprite rendering
    ├── utils.js           # Updated Utility functions
    └── index.js           # Updated Module exports
```

## Supported Mappers

| # | Name | Example Games |
|---|------|---------------|
| 0 | NROM | Super Mario Bros., Donkey Kong |
| 1 | MMC1 | The Legend of Zelda, Metroid |
| 2 | UxROM | Mega Man, Castlevania |
| 3 | CNROM | Gradius, Paperboy |
| 4 | MMC3 | Super Mario Bros. 2/3, Kirby's Adventure |
| 5 | MMC5 | Castlevania III (partial support, still working on it!) |
| 7 | AxROM | Battletoads |
| 9 | MMC2 | Punch-Out!! |
| 10 | MMC4 | Fire Emblem |
| 11 | Color Dreams | Bible Adventures |
| 34 | BNROM | Deadly Towers |
| 66 | GxROM | Super Mario Bros. + Duck Hunt |

## Browser Requirements

- Modern browser with ES6 module support
- AudioWorklet support (Chrome 66+, Firefox 76+, Safari 14.1+)
- Falls back to ScriptProcessor on older browsers

## API Usage

```javascript
import { NES } from './src/nes.js';
import { Controller } from './src/controller.js';

const nes = new NES({
  onFrame: (framebuffer) => { /* render 256x240 RGB buffer */ },
  onAudioSample: (left, right) => { /* handle audio sample */ },
  sampleRate: 44100
});

// Load ROM (as string with charCodeAt for byte access)
nes.loadROM(romData);

// Run one frame
nes.frame();

// Input
nes.buttonDown(1, Controller.BUTTON_A);
nes.buttonUp(1, Controller.BUTTON_A);

// Save/Load state. Not yet implemented
const state = nes.toJSON();
nes.fromJSON(state);
```

## Development Notes

### Audio System

The emulator uses a two-tier audio system:

1. **AudioWorklet** (preferred) — Runs on a dedicated audio thread for glitch-free playback
2. **ScriptProcessor** (fallback) — For browsers without AudioWorklet support

Audio samples are batched and sent to the worklet to minimize postMessage overhead.

### Mapper Implementation

Mappers handle the NES's bank switching hardware. Key implementation details:

- **MMC2/MMC4**: Implement CHR latch switching triggered by specific tile fetches ($FD/$FE tiles)
- **MMC3**: Implements scanline counter via A12 rising edge detection for IRQ timing
- **MMC1**: Proper shift register with 5-write sequences

See [TECHNICAL.md](TECHNICAL.md) for detailed implementation notes.

## Credits

Based on [JSNES](https://github.com/bfirsh/jsnes) by Ben Firshman, which was based on vNES by Jamie Sanders.

Modernization and mapper fixes contributed by Antonio Armstrong.

## License

This project uses the GPL v3 license.

## Legal

This emulator does not include any copyrighted ROM files. You must provide your own legally obtained ROM dumps to use with this emulator.
