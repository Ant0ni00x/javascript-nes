# JavaScript-NES Debug Module Integration Guide

## Quick Start

### 1. Add to your main entry point (e.g., `index.js` or `nes.js`)

```javascript
import { initDebug } from './debug.js';

// After creating your NES instance:
const nes = new NES(options);

// Initialize debug (binds F9 key automatically)
const debug = initDebug(nes, 'F9');
```

### 2. Or manual integration in your UI code:

```javascript
import { NESDebug } from './debug.js';

// Create debug instance
const debug = new NESDebug(nes);

// Bind to F9 key
document.addEventListener('keydown', (e) => {
    if (e.key === 'F9') {
        e.preventDefault();
        debug.outputAll();
    }
});
```

## Files Needed

The debug module reads from these components:

| Component | Properties Used |
|-----------|-----------------|
| `nes.ppu` | vramMem, spriteMem, registers (f_*), scroll registers (reg*, cnt*), scanline, curX |
| `nes.cpu` | mem (for $2000-$2001) |
| `nes.mmap` | All MMC5 properties if Mapper5 |

## Output Sections

Press **F9** to output:

1. **CHR ROM/RAM** - Pattern table samples
2. **PPU Registers** - $2000-$2007, $4014 with decoded flags
3. **Nametables** - All 4 nametables + attribute tables
4. **Palette** - Background and sprite palettes
5. **Scroll Info** - Registers and counters
6. **MMC5 State** - Full mapper state (if MMC5 game)

## Console Commands

After initialization, you can also use these in browser console:

```javascript
// Full debug output
nesDebug.outputAll();

// Individual sections
nesDebug.outputPPURegisters();
nesDebug.outputNametables();
nesDebug.outputPalette();
nesDebug.outputScrollInfo();
nesDebug.outputMMC5State();
nesDebug.outputCHR();
```

## Sample Output

```
============================================================
NES DEBUG OUTPUT - 2024-12-17T15:30:00.000Z
============================================================

--- PPU Registers ---
PPUCTRL    $2000 = $88
  Nametable Base:     0 ($2000)
  VRAM Increment:     0 (+1 (across))
  Sprite Pattern:     0 ($0000)
  BG Pattern:         1 ($1000)
  Sprite Size:        0 (8x8)
  NMI Enable:         1

--- MMC5 State ---
PRG Mode       $5100 = 3
  Mode 3: 8KB×4
CHR Mode       $5101 = 3
  Mode 3: 1KB×8
ExRAM Mode     $5104 = 1
  1: Extended Attributes
NT Mapping     $5105 = $44
  NT0 ($2000): CIRAM 0
  NT1 ($2400): CIRAM 1
  NT2 ($2800): CIRAM 0
  NT3 ($2C00): CIRAM 1
IRQ Compare    $5203 = $80 (scanline 128)
IRQ Status     $5204 = $40
  IRQ Enabled: true
  IRQ Pending: false
  In Frame:    true
  Scanline:    45
```

## Comparing with Mesen

1. Load the same ROM in both emulators
2. Advance to the same frame/state
3. Press F9 in your emulator
4. Compare with Mesen's Debug → PPU Viewer / Nametable Viewer

### Key Comparisons:

| Your Debug | Mesen Location |
|------------|----------------|
| PPUCTRL/MASK | Debug → PPU Status |
| Nametables | Debug → Nametable Viewer |
| Palette | Debug → Palette Viewer |
| Scroll registers | Debug → PPU Status |
| MMC5 State | Debug → Memory Viewer ($5100-$5206) |

## Customization

### Add more output sections:

```javascript
// In debug.js, add a new method:
outputOAM() {
    const ppu = this.nes.ppu;
    console.log('\n--- OAM (Sprite Memory) ---');
    for (let i = 0; i < 64; i++) {
        const base = i * 4;
        const y = ppu.spriteMem[base];
        const tile = ppu.spriteMem[base + 1];
        const attr = ppu.spriteMem[base + 2];
        const x = ppu.spriteMem[base + 3];
        if (y < 0xEF) { // Only show visible sprites
            console.log(`  Sprite ${i}: X=${x} Y=${y} Tile=$${this.hex(tile)} Attr=$${this.hex(attr)}`);
        }
    }
}
```

### Change trigger key:

```javascript
initDebug(nes, 'F10');  // Use F10 instead
```

### Multiple keys for different outputs:

```javascript
document.addEventListener('keydown', (e) => {
    switch(e.key) {
        case 'F9': debug.outputAll(); break;
        case 'F10': debug.outputPPURegisters(); break;
        case 'F11': debug.outputMMC5State(); break;
    }
});
```
