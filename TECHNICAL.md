# JavaScript-NES Technical Documentation

This document covers the internal architecture and key implementation details of the JavaScript-NES emulator, with emphasis on **correct hardware modeling** and the **capability‑driven mapper system**.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [PPU <-> Mapper Contract (Core Design)](#ppu--mapper-contract-core-design)
3. [CPU (6502)](#cpu-6502)
4. [PPU (Picture Processing Unit)](#ppu-picture-processing-unit)
5. [APU (Audio Processing Unit)](#apu-audio-processing-unit)
6. [Memory Mappers](#memory-mappers)
7. [Audio System](#audio-system)
8. [Save State System](#save-state-system)
9. [Timing and Synchronization](#timing-and-synchronization)
10. [Performance Optimizations](#performance-optimizations)
11. [Debugging Guide](#debugging-guide)
12. [References](#references)

---

## Architecture Overview

The emulator follows a component-based design mirroring the NES hardware:

```
┌─────────────────────────────────────────────────────────┐
│                        NES Class                        │
│  (Orchestrator - handles frame loop, component wiring)  │
├─────────────┬─────────────┬─────────────┬───────────────┤
│    CPU      │     PPU     │    PAPU     │   Mapper      │
│   (6502)    │  (Graphics) │   (Audio)   │ (Bank Switch) │
└─────────────┴─────────────┴─────────────┴───────────────┘
```

The **NES class** orchestrates timing and wiring. Each component is isolated and communicates through explicit, well‑defined interfaces.

### Frame Execution Flow

```javascript
// nes.js - frame() method
1. PPU starts frame (startFrame)
2. Loop until frame complete:
   a. CPU executes instruction, returns cycle count
   b. APU clocks for those cycles (audio sample generation)
   c. PPU advances by cycles * 3 (PPU runs 3x CPU speed)
   d. Check for sprite 0 hit, NMI triggers
3. PPU renders scanlines, triggers VBlank NMI
4. Frame buffer sent to onFrame callback
```

---

## PPU ↔ Mapper Contract (Core Design)

The PPU never checks mapper IDs or method presence. Instead, each mapper declares **what behaviors it supports** through capability flags. This design prevents common emulator pitfalls:

- x Fixing one mapper breaking another
- x Hidden method‑presence heuristics
- x Mapper ID checks scattered through the PPU

Instead, each mapper becomes **self‑contained**, and the PPU becomes **stable infrastructure**.

### Behavioral Capability Flags

| Capability Flag | Meaning | Required Method(s) |
|----------------|--------|--------------------|
| `hasChrLatch` | CHR latch switching (MMC2/MMC4) | `latchAccess(addr)` |
| `hasScanlineIrq` | Scanline IRQ support | `notifyA12(value)` |
| `hasPpuA13ChrSwitch` | BG vs sprite CHR mode (MMC5) | `notifyPpuA13(value)` |
| `hasNametableOverride` | Custom nametable reads/writes | `readNametable(addr)`, `writeNametable(addr,val)` |
| `hasPpuAddressHook` | Observe PPU address activity | `ppuAddressUpdate(addr)` |
| `hasPpuScanlineHook` | End‑of‑scanline callback | `onEndScanline(scanline)` |

**Rule:** If a capability flag is `true`, the corresponding method **must exist**.

---

## CPU (6502)

### Implementation Highlights

- **Typed Array Memory**: Uses `Uint8Array(0x10000)` for 64KB address space
- **Pre-computed Opcode Table**: `OPDATA` array built at module load time
- **Illegal Opcodes**: Full support for undocumented 6502 instructions

### Opcode Data Encoding

Each opcode is packed into a 32-bit integer:
```
Bits 0-7:   Instruction type (INS_ADC, INS_AND, etc.)
Bits 8-15:  Addressing mode (ADDR_IMM, ADDR_ZP, etc.)
Bits 16-23: Instruction size in bytes
Bits 24-31: Base cycle count
```

### Addressing Modes

| Mode | Code | Example | Description |
|------|------|---------|-------------|
| Immediate | `ADDR_IMM` | `LDA #$44` | Value in next byte |
| Zero Page | `ADDR_ZP` | `LDA $44` | Address in zero page |
| Zero Page,X | `ADDR_ZPX` | `LDA $44,X` | ZP + X register |
| Absolute | `ADDR_ABS` | `LDA $4400` | 16-bit address |
| Absolute,X | `ADDR_ABSX` | `LDA $4400,X` | Abs + X (page cross +1 cycle) |
| Indirect,X | `ADDR_PREIDXIND` | `LDA ($44,X)` | Pre-indexed indirect |
| Indirect,Y | `ADDR_POSTIDXIND` | `LDA ($44),Y` | Post-indexed indirect |

### IRQ Handling

Three IRQ types are supported:
```javascript
CPU.IRQ_NORMAL = 0;  // Mapper IRQs (e.g., MMC3 scanline counter)
CPU.IRQ_NMI = 1;     // VBlank NMI from PPU
CPU.IRQ_RESET = 2;   // System reset
```

---

## PPU (Picture Processing Unit)

### Rendering Pipeline

The PPU renders 262 scanlines per frame:
- Scanlines 0-19: Pre-render / VBlank
- Scanline 20: Clear VBlank and sprite 0 flags
- Scanlines 21-260: Visible frame (240 lines)
- Scanline 261: Post-render

### Key Registers

| Address | Name | Purpose |
|---------|------|---------|
| $2000 | PPUCTRL | NMI enable, sprite size, pattern tables |
| $2001 | PPUMASK | Rendering enable, clipping |
| $2002 | PPUSTATUS | VBlank flag, sprite 0 hit |
| $2005 | PPUSCROLL | Scroll position (write x2) |
| $2006 | PPUADDR | VRAM address (write x2) |
| $2007 | PPUDATA | VRAM read/write |
---

### Sprite 0 Hit Detection

The sprite 0 hit flag is set when an opaque pixel of sprite 0 overlaps an opaque background pixel. This is used by games for split-screen effects.

```javascript
// Checked during scanline rendering
if (sprite0_pixel_opaque && background_pixel_opaque) {
  setStatusFlag(STATUS_SPRITE0HIT, true);
}
```

### MMC2/MMC4 Latch Triggering

For mappers with CHR latches (MMC2, MMC4), tile fetches are monitored:

```javascript
// ppu.js - Pre-render sprite evaluation triggers latches
if (this.f_spVisibility === 1) {
  this.renderSpritesPartially(0, 1, true);
  this.renderSpritesPartially(0, 1, false);
}
```

This ensures the latch state is correct before the first visible scanline.

---

## APU (Audio Processing Unit)

### Channel Overview

| Channel | Type | Description |
|---------|------|-------------|
| Square 1 | Pulse | Variable duty cycle (12.5%, 25%, 50%, 75%) |
| Square 2 | Pulse | Same as Square 1 |
| Triangle | Triangle | Fixed waveform, no volume control |
| Noise | Noise | Pseudo-random, two modes |
| DMC | Sample | Delta-modulation playback |
---


### Frame Counter

The APU frame counter drives envelope, length counter, and sweep updates:

```
Mode 0 (4-step):  Clocks at frames 1, 2, 3, 4 (generates IRQ at 4)
Mode 1 (5-step):  Clocks at frames 1, 2, 3, 5 (no IRQ)
```

### Sample Generation

The `sample()` method mixes all channels using the NES's non-linear mixing:

```javascript
// Lookup tables for accurate mixing
square_table[n] = 95.52 / (8128.0 / n + 100)
tnd_table[n] = 163.67 / (24329.0 / n + 100)
```

DC offset removal is applied to prevent speaker damage from sustained offsets.

---

## Memory Mappers

### Mapper 4 (MMC3)

Used by many popular games including Super Mario Bros. 2, Super Mario Bros. 3, and Kirby's Adventure.

**PRG Banking:**
- 8KB banks switchable at $8000 and $A000
- $C000 and $E000 can be fixed to last banks or swapped

**CHR Banking:**
- 2KB banks at $0000/$0800 or $1000/$1800
- 1KB banks at $1000-$1C00 or $0000-$0C00

**IRQ Counter:**

MMC3 IRQs are driven by **A12 rising edges**, not by generic scanline counters. The PPU signals A12 state changes via `notifyA12(value)`, and the mapper detects rising edges to clock its IRQ counter. IRQs are isolated to mappers that declare `hasScanlineIrq`.

```javascript
notifyA12(value) {
  if (value === 1 && this.ppuA12Prev === 0) {
    // Rising edge detected
    if (isRendering && this.lastClockScanline !== currentScanline) {
      this.clockIrqCounter();
      this.lastClockScanline = currentScanline;
    }
  }
  this.ppuA12Prev = value;
}

clockIrqCounter() {
  if (this.irqCounter === 0 || this.irqReloadPending) {
    this.irqCounter = this.irqLatchValue;
    this.irqReloadPending = false;
  } else {
    this.irqCounter--;
    if (this.irqCounter === 0 && this.irqEnable) {
      this.nes.cpu.requestIrq(CPU.IRQ_NORMAL);
    }
  }
}
```

---

### Mapper 9 (MMC2)

Used exclusively by Punch-Out!! Features unique CHR latches.

**Latch Mechanism:**

MMC2 latch switching is triggered by **specific pattern fetch addresses**:
- `$0FD8 / $0FE8` (low pattern table)
- `$1FD8 / $1FE8` (high pattern table)

To correctly emulate this behavior, the PPU computes **real pattern fetch addresses**:
- `tileBase + (tileIndex << 4) + fineY`
- and the second bitplane at `+ 8`

Both background and sprite fetch paths call `latchAccess()`.

Two latches control CHR bank selection. Latches change state when specific tiles ($FD or $FE) are fetched:

```javascript
latchAccess(address) {
  if (address >= 0x2000) return;
  
  if ((address & 0x1000) === 0) {
    // Low pattern table ($0000-$0FFF)
    const masked = address & 0x0FF0;
    if (masked === 0x0FD0) {
      this.latchLo = 0;
      this.safeSwitchBank(this.chrBank0, 0x0000);
    } else if (masked === 0x0FE0) {
      this.latchLo = 1;
      this.safeSwitchBank(this.chrBank1, 0x0000);
    }
  } else {
    // High pattern table ($1000-$1FFF)
    const masked = address & 0x0FF0;
    if (masked === 0x0FD0) {
      this.latchHi = 0;
      this.safeSwitchBank(this.chrBank2, 0x1000);
    } else if (masked === 0x0FE0) {
      this.latchHi = 1;
      this.safeSwitchBank(this.chrBank3, 0x1000);
    }
  }
}
```

**Why This Matters:**

This is critical for games like **Mike Tyson's Punch‑Out!!**, which rely on mid‑frame CHR bank switching for large animated sprites. The latch triggers mid-frame to swap CHR banks, creating smooth animation without CPU intervention.

---

### Mapper 10 (MMC4)

Similar to MMC2 but with 16KB PRG banking instead of 8KB. Used by Fire Emblem and Famicom Wars.

---

### Mapper 5 (MMC5)

MMC5 introduces advanced features:

- Extended nametable mapping (ExRAM)
- Fill‑mode backgrounds
- Split‑screen scrolling
- Separate BG and sprite CHR modes (A13)

These features are enabled through capability flags:

- `hasNametableOverride`
- `hasPpuA13ChrSwitch`
- `hasPpuAddressHook`
- `hasPpuScanlineHook`

The PPU remains mapper‑agnostic while still supporting MMC5's complexity.

---

## Audio System

### AudioWorklet Architecture

```
┌─────────────────┐         postMessage          ┌─────────────────┐
│  Main Thread    │ ───────────────────────────▶ │  Audio Thread   │
│                 │                              │                 │
│  NES.frame()    │     { type: 'samples',       │  NESAudioProc   │
│       │         │       left: Float32[],       │       │         │
│       ▼         │       right: Float32[] }     │       ▼         │
│  onAudioSample  │                              │  Ring Buffer    │
│  (accumulate)   │                              │  (2048 samples) │
│       │         │                              │       │         │
│       ▼         │                              │       ▼         │
│  flushAudio()   │                              │  process()      │
│                 │                              │  (128 samples)  │
└─────────────────┘                              └─────────────────┘
```
---

### Ring Buffer Implementation

The worklet uses a power-of-2 sized ring buffer for efficient wrapping:

```javascript
this.bufferSize = 2048;
this.bufferMask = this.bufferSize - 1;

// Write (main thread sends samples)
this.samplesL[this.writeIndex] = sample;
this.writeIndex = (this.writeIndex + 1) & this.bufferMask;

// Read (audio thread consumes)
output[i] = this.samplesL[this.readIndex];
this.readIndex = (this.readIndex + 1) & this.bufferMask;

// Available samples
available = (this.writeIndex - this.readIndex) & this.bufferMask;
```
---

### Underrun Handling

When the buffer runs dry, the worklet fades to silence to avoid clicks:

```javascript
if (i < available) {
  lastL = outputL[i] = this.samplesL[this.readIndex++];
} else {
  const fade = 1 - ((i - available) / (len - available));
  outputL[i] = lastL * fade;
}
```
---

### Fallback to ScriptProcessor

For browsers without AudioWorklet, a deprecated but functional ScriptProcessor is used:

```javascript
scriptProcessor = audioCtx.createScriptProcessor(1024, 0, 2);
scriptProcessor.onaudioprocess = (e) => {
  // Read directly from shared buffer
  for (let i = 0; i < len; i++) {
    outL[i] = fallbackL[fallbackRead];
    fallbackRead = (fallbackRead + 1) & AUDIO_BUFFER_MASK;
  }
};
```

---

## Save State System

The save state system enables saving and restoring the complete emulator state.

### Architecture Overview

```
┌────────────────────────────────────────────────────────────┐
│                     save-states.js                         │
├────────────────────────────────────────────────────────────┤
│  initSaveStates(nes, logger)  ←── Initialize with NES ref  │
│           │                                                │
│           ▼                                                │
│  ┌─────────────────┐    ┌─────────────────┐                │
│  │  saveState(n)   │    │  loadState(n)   │                │
│  │       │         │    │       │         │                │
│  │       ▼         │    │       ▼         │                │
│  │  nes.toJSON()   │    │  nes.fromJSON() │                │
│  │       │         │    │       ▲         │                │
│  │       ▼         │    │       │         │                │
│  │  localStorage   │───▶│  localStorage   │                │
│  └─────────────────┘    └─────────────────┘                │
│                                                            │
│  ┌─────────────────┐    ┌─────────────────┐                │
│  │  quickSave()    │    │  quickLoad()    │                │
│  │       │         │    │       │         │                │
│  │       ▼         │    │       ▼         │                │
│  │  Memory Only    │◀──▶│  Memory Only    │                │
│  └─────────────────┘    └─────────────────┘                │
└────────────────────────────────────────────────────────────┘
```
---

### State Serialization

Each component implements `toJSON()` and `fromJSON()` methods using the `JSON_PROPERTIES` pattern from `utils.js`:

```javascript
// Example from cpu.js
static JSON_PROPERTIES = [
  "mem",              // 64KB RAM
  "cyclesToHalt",
  "irqRequested",
  "irqType",
  "REG_ACC",          // Accumulator
  "REG_X",            // X Register
  "REG_Y",            // Y Register
  "REG_SP",           // Stack Pointer
  "REG_PC",           // Program Counter
  "REG_STATUS",       // Status Register
  "F_CARRY",          // Flags...
  "F_ZERO",
  // ... etc
];

toJSON() {
  return toJSON(this);  // utils.js helper
}

fromJSON(s) {
  fromJSON(this, s);    // utils.js helper
}
```
---

### Save State Format

```javascript
{
  version: 1,                    // Format version for future compatibility
  timestamp: 1702500000000,      // Unix timestamp
  romHash: "a1b2c3d4",          // Hash of first 1KB of ROM (for validation)
  data: {
    cpu: { mem: [...], REG_PC: 0x8000, ... },
    ppu: { vramMem: [...], scanline: 0, ... },
    papu: { square1: {...}, triangle: {...}, ... },
    mmap: { /* mapper-specific state */ }
  }
}
```
---

### Storage Locations

| Type | Storage | Key Format | Persistence |
|------|---------|------------|-------------|
| Slot saves | localStorage | `jsnes_savestate_0` - `jsnes_savestate_9` | Permanent |
| Quick save | Memory | JavaScript variable | Session only |
| Export | File | `savestate_slot0.json` | User manages |

### ROM Hash Verification

A simple hash of the first 1KB of ROM data identifies which game the save belongs to:

```javascript
function getRomHash() {
  if (!nes.romData) return 'unknown';
  
  let hash = 0;
  const len = Math.min(1024, nes.romData.length);
  for (let i = 0; i < len; i++) {
    hash = ((hash << 5) - hash) + nes.romData.charCodeAt(i);
    hash |= 0;  // Convert to 32-bit integer
  }
  return hash.toString(16);
}
```
---

This warns users when loading a save from a different ROM, but doesn't prevent it (useful for ROM hacks or regional variants).

### Keyboard Shortcut Handler

```javascript
function handleSaveStateKeys(e) {
  // Ignore if typing
  if (document.activeElement.tagName === 'INPUT') return;
  
  if (e.keyCode === 116) {        // F5 = Quick Save
    e.preventDefault();
    quickSave();
  }
  else if (e.keyCode === 119) {   // F8 = Quick Load
    e.preventDefault();
    quickLoad();
  }
  else if (e.shiftKey && e.keyCode >= 49 && e.keyCode <= 57) {
    e.preventDefault();
    saveState(e.keyCode - 49);    // Shift+1-9 = Save to slot
  }
  else if (e.keyCode >= 49 && e.keyCode <= 57) {
    e.preventDefault();
    loadState(e.keyCode - 49);    // 1-9 = Load from slot
  }
}
```

### Integration Example

```javascript
// nes-embed.js
import { initSaveStates } from './save-states.js';

async function nesBoot(romData) {
  // ... audio init, etc ...
  
  nes.loadROM(romData);
  
  // Initialize save states after ROM is loaded
  initSaveStates(nes, logStatus);
  
  // ... start emulation ...
}
```

---

## Timing and Synchronization

### NES Timing Constants

| Component | Frequency | Notes |
|-----------|-----------|-------|
| CPU | 1.789773 MHz | NTSC master clock / 12 |
| PPU | 5.369318 MHz | 3x CPU clock |
| APU Frame | 240 Hz | Controls envelope/sweep |
---

### Frame Timing

At 60 FPS (NTSC):
- ~29,780 CPU cycles per frame
- ~89,342 PPU cycles per frame
- ~735 audio samples per frame (at 44.1kHz)
---

### requestAnimationFrame Loop

The emulator runs one NES frame per browser animation frame:

```javascript
function onAnimationFrame() {
  requestAnimationFrame(onAnimationFrame);
  
  nes.frame();      // Run one NES frame
  flushAudio();     // Send accumulated samples to worklet
  
  imageData.data.set(framebufferU8);
  canvasCtx.putImageData(imageData, 0, 0);
}
```

This ties emulation to the display refresh rate (~60Hz), which closely matches NTSC timing.

---

## Performance Optimizations

### CPU Optimizations

1. **Pre-computed opcode table** — Built once at module load
2. **Typed arrays** — `Uint8Array` for memory
3. **Bitwise operations** — Fast flag manipulation
4. **Local variable caching** — Avoid repeated property access in hot loops
---

### PPU Optimizations

1. **Scanline-based rendering** — Only render visible portions
2. **Dirty tile tracking** — Skip unchanged tiles
3. **Shared ArrayBuffer** — Framebuffer backing for zero-copy canvas updates
---

### Memory Layout

```javascript
// Framebuffer uses shared backing for zero-copy canvas updates
const buffer = new ArrayBuffer(imageData.data.length);
framebufferU8 = new Uint8ClampedArray(buffer);  // For canvas
framebufferU32 = new Uint32Array(buffer);        // For fast pixel writes
```

---

## Debugging Guide

### Common Issues

**Black screen:**
- Check mapper support for the ROM
- Verify ROM header is valid (starts with "NES\x1a")

**Garbled graphics:**
- Almost always CHR banking or latch timing
- Verify `hasChrLatch` and `latchAccess()` usage
- Verify mirroring mode is correct

**No audio:**
- Check browser console for AudioContext errors
- Ensure user interaction before audio init (browser autoplay policy)

**Status bar shaking / issues (MMC3):**
- IRQ counter timing issue
- Verify A12 rising edges
- Check IRQ counter reload timing

**Split screen issues (MMC5):**
- Verify `notifyPpuA13()` is called in both BG and sprite paths
- Ensure ExRAM writes are gated correctly

**Save state not loading:**
- Check browser console for JSON parse errors
- Verify ROM matches (check hash warning)
- localStorage may be full — clear old saves
---


### Useful Console Commands

```javascript
// Access emulator internals
nes.cpu.REG_PC.toString(16)  // Current program counter
nes.ppu.scanline             // Current scanline
nes.rom.mapperType           // Loaded mapper number
nes.mmap.irqCounter          // MMC3 IRQ counter value

// Save state debugging
listStates()                 // Show all save slots
localStorage                 // View raw storage
```

---

## References

- [NESDev Wiki](https://www.nesdev.org/wiki/) — Comprehensive NES hardware documentation
- [6502 Instruction Reference](https://www.masswerk.at/6502/6502_instruction_set.html)
- [MMC2 Documentation](https://www.nesdev.org/wiki/MMC2)
- [MMC3 Documentation](https://www.nesdev.org/wiki/MMC3)
- [MMC5 Documentation](https://www.nesdev.org/wiki/MMC5)
