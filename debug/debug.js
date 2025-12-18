/**
 * NES Debug Output Module
 * 
 * Outputs emulator state in Mesen-comparable format
 * Triggered by F9 key (configurable)
 * 
 * Usage:
 *   import { NESDebug } from './debug.js';
 *   const debug = new NESDebug(nes);
 *   debug.bindKey(document, 'F9');
 *   // Or manually: debug.outputAll();
 */

export class NESDebug {
    constructor(nes) {
        this.nes = nes;
    }

    /**
     * Bind debug output to a key
     */
    bindKey(target, key = 'F9') {
        target.addEventListener('keydown', (e) => {
            if (e.key === key) {
                e.preventDefault();
                this.outputAll();
            }
        });
        console.log(`[JavaScript-NES Debug] Press ${key} to output debug data`);
    }

    /**
     * Output all debug data
     */
    outputAll() {
        console.log('\n' + '='.repeat(60));
        console.log('JAVASCRIPT-NES DEBUG OUTPUT - ' + new Date().toISOString());
        console.log('='.repeat(60));

        this.outputCHR();
        this.outputPPURegisters();
        this.outputNametables();
        this.outputPalette();
        this.outputScrollInfo();
        this.outputMMC5State();

        console.log('='.repeat(60) + '\n');
    }

    // =========================================================================
    // CHR ROM/RAM - $0000-$1FFF
    // =========================================================================
    outputCHR() {
        const ppu = this.nes.ppu;
        console.log('\n--- CHR ROM/RAM ($0000-$1FFF) ---');
        
        // Output first 64 bytes of each pattern table as sample
        console.log('Pattern Table 0 ($0000-$0FFF) - First 64 bytes:');
        console.log(this.formatMemoryBlock(ppu.vramMem, 0x0000, 64));
        
        console.log('Pattern Table 1 ($1000-$1FFF) - First 64 bytes:');
        console.log(this.formatMemoryBlock(ppu.vramMem, 0x1000, 64));
    }

    // =========================================================================
    // PPU Registers
    // =========================================================================
    outputPPURegisters() {
        const ppu = this.nes.ppu;
        const cpu = this.nes.cpu;
        
        console.log('\n--- PPU Registers ---');
        
        // $2000 - PPUCTRL
        const ppuCtrl = cpu.mem[0x2000];
        console.log(`PPUCTRL    $2000 = $${this.hex(ppuCtrl)}`);
        console.log(`  Nametable Base:     ${ppu.f_nTblAddress} (${['$2000', '$2400', '$2800', '$2C00'][ppu.f_nTblAddress]})`);
        console.log(`  VRAM Increment:     ${ppu.f_addrInc} (${ppu.f_addrInc ? '+32 (down)' : '+1 (across)'})`);
        console.log(`  Sprite Pattern:     ${ppu.f_spPatternTable} ($${ppu.f_spPatternTable ? '1000' : '0000'})`);
        console.log(`  BG Pattern:         ${ppu.f_bgPatternTable} ($${ppu.f_bgPatternTable ? '1000' : '0000'})`);
        console.log(`  Sprite Size:        ${ppu.f_spriteSize} (${ppu.f_spriteSize ? '8x16' : '8x8'})`);
        console.log(`  NMI Enable:         ${ppu.f_nmiOnVblank}`);

        // $2001 - PPUMASK
        const ppuMask = cpu.mem[0x2001];
        console.log(`PPUMASK    $2001 = $${this.hex(ppuMask)}`);
        console.log(`  Grayscale:          ${ppu.f_grayscale}`);
        console.log(`  Show BG Left 8:     ${ppu.f_bgClipping}`);
        console.log(`  Show Sprite Left 8: ${ppu.f_spClipping}`);
        console.log(`  Show BG:            ${ppu.f_bgVisibility}`);
        console.log(`  Show Sprites:       ${ppu.f_spVisibility}`);
        console.log(`  Emphasis:           R=${ppu.f_colorEmphasis & 1} G=${(ppu.f_colorEmphasis >> 1) & 1} B=${(ppu.f_colorEmphasis >> 2) & 1}`);

        // $2002 - PPUSTATUS
        const status = ppu.readStatusRegister ? ppu.readStatusRegister() : 0;
        console.log(`PPUSTATUS  $2002 = $${this.hex(status)} (read clears vblank)`);
        console.log(`  Sprite Overflow:    ${(status >> 5) & 1}`);
        console.log(`  Sprite 0 Hit:       ${(status >> 6) & 1}`);
        console.log(`  VBlank:             ${(status >> 7) & 1}`);

        // $2003 - OAMADDR
        console.log(`OAMADDR    $2003 = $${this.hex(ppu.sramAddress || 0)}`);

        // $2004 - OAMDATA (current byte at OAMADDR)
        const oamData = ppu.spriteMem ? ppu.spriteMem[ppu.sramAddress || 0] : 0;
        console.log(`OAMDATA    $2004 = $${this.hex(oamData)} (at OAMADDR)`);

        // $2005 - PPUSCROLL
        console.log(`PPUSCROLL  $2005`);
        console.log(`  Scroll X:           ${ppu.regFH || 0} (fine) + ${(ppu.regHT || 0) * 8} (coarse) = ${(ppu.regFH || 0) + (ppu.regHT || 0) * 8}`);
        console.log(`  Scroll Y:           ${ppu.regFV || 0} (fine) + ${(ppu.regVT || 0) * 8} (coarse) = ${(ppu.regFV || 0) + (ppu.regVT || 0) * 8}`);

        // $2006 - PPUADDR
        const vramAddr = ppu.vramAddress || 0;
        console.log(`PPUADDR    $2006 = $${this.hex16(vramAddr)}`);

        // $2007 - PPUDATA
        console.log(`PPUDATA    $2007 (VRAM at $${this.hex16(vramAddr)}) = $${this.hex(ppu.vramMem[vramAddr & 0x3FFF] || 0)}`);

        // $4014 - OAMDMA
        console.log(`OAMDMA     $4014 (Sprite DMA page)`);
    }

    // =========================================================================
    // Nametables and Attribute Tables - $2000-$2FFF
    // =========================================================================
    outputNametables() {
        const ppu = this.nes.ppu;
        const mmap = this.nes.mmap;
        
        console.log('\n--- Nametables & Attributes ($2000-$2FFF) ---');
        
        // Mirroring mode
        const mirrorModes = ['Horizontal', 'Vertical', 'Four-Screen', 'Single-Screen', 'Single-Screen 2'];
        console.log(`Mirroring Mode: ${ppu.currentMirroring !== undefined ? mirrorModes[ppu.currentMirroring] || 'Unknown' : 'Unknown'}`);
        
        // Output each nametable
        for (let nt = 0; nt < 4; nt++) {
            const baseAddr = 0x2000 + (nt * 0x400);
            console.log(`\nNametable ${nt} ($${this.hex16(baseAddr)}-$${this.hex16(baseAddr + 0x3BF)}):`);
            
            // Get nametable data (first 2 rows as sample)
            let ntData = [];
            for (let i = 0; i < 64; i++) {
                const addr = baseAddr + i;
                let value;
                if (mmap && mmap.hasNametableOverride && mmap.readNametable) {
                    value = mmap.readNametable(addr);
                } else if (ppu.vramMem) {
                    value = ppu.mirroredLoad(addr);
                } else {
                    value = 0;
                }
                ntData.push(value);
            }
            console.log('  First 2 rows (64 tiles):');
            console.log('  ' + ntData.slice(0, 32).map(v => this.hex(v)).join(' '));
            console.log('  ' + ntData.slice(32, 64).map(v => this.hex(v)).join(' '));
            
            // Attribute table
            const attrAddr = baseAddr + 0x3C0;
            console.log(`  Attribute Table ($${this.hex16(attrAddr)}-$${this.hex16(attrAddr + 0x3F)}):`);
            let attrData = [];
            for (let i = 0; i < 64; i++) {
                const addr = attrAddr + i;
                let value;
                if (mmap && mmap.hasNametableOverride && mmap.readNametable) {
                    value = mmap.readNametable(addr);
                } else if (ppu.vramMem) {
                    value = ppu.mirroredLoad(addr);
                } else {
                    value = 0;
                }
                attrData.push(value);
            }
            console.log('  ' + attrData.map(v => this.hex(v)).join(' '));
        }
        
        // Mirror region $3000-$3EFF
        console.log('\nMirror Region ($3000-$3EFF): Mirrors $2000-$2EFF');
    }

    // =========================================================================
    // Palette - $3F00-$3F1F
    // =========================================================================
    outputPalette() {
        const ppu = this.nes.ppu;
        
        console.log('\n--- Palette ($3F00-$3F1F) ---');
        
        // Background palette
        console.log('Background Palette:');
        if (ppu.vramMem) {
            for (let p = 0; p < 4; p++) {
                const base = 0x3F00 + (p * 4);
                const colors = [];
                for (let c = 0; c < 4; c++) {
                    colors.push(this.hex(ppu.vramMem[base + c] || 0));
                }
                console.log(`  Palette ${p}: $${colors.join(' $')}`);
            }
        }
        
        // Sprite palette
        console.log('Sprite Palette:');
        if (ppu.vramMem) {
            for (let p = 0; p < 4; p++) {
                const base = 0x3F10 + (p * 4);
                const colors = [];
                for (let c = 0; c < 4; c++) {
                    colors.push(this.hex(ppu.vramMem[base + c] || 0));
                }
                console.log(`  Palette ${p}: $${colors.join(' $')}`);
            }
        }
    }

    // =========================================================================
    // Scroll Registers & Counters
    // =========================================================================
    outputScrollInfo() {
        const ppu = this.nes.ppu;
        
        console.log('\n--- Scroll Registers ---');
        console.log(`regFH  (Fine X):           ${ppu.regFH || 0}`);
        console.log(`regFV  (Fine Y):           ${ppu.regFV || 0}`);
        console.log(`regHT  (Coarse X / Tile):  ${ppu.regHT || 0}`);
        console.log(`regVT  (Coarse Y / Tile):  ${ppu.regVT || 0}`);
        console.log(`regH   (Nametable X):      ${ppu.regH || 0}`);
        console.log(`regV   (Nametable Y):      ${ppu.regV || 0}`);
        console.log(`regS   (Sprite Pattern):   ${ppu.regS || 0}`);
        
        console.log('\n--- Scroll Counters ---');
        console.log(`cntFV  (Fine Y Counter):   ${ppu.cntFV || 0}`);
        console.log(`cntV   (NT Y Counter):     ${ppu.cntV || 0}`);
        console.log(`cntVT  (Coarse Y Counter): ${ppu.cntVT || 0}`);
        console.log(`cntH   (NT X Counter):     ${ppu.cntH || 0}`);
        console.log(`cntHT  (Coarse X Counter): ${ppu.cntHT || 0}`);
        
        // Current scanline/cycle
        console.log('\n--- PPU Position ---');
        console.log(`Scanline:  ${ppu.scanline || 0}`);
        console.log(`Cycle:     ${ppu.curX || 0}`);
        console.log(`Frame:     ${ppu.frameCount || 0}`);
    }

    // =========================================================================
    // MMC5 Specific State
    // =========================================================================
    outputMMC5State() {
        const mmap = this.nes.mmap;
        
        // Check if this is MMC5
        if (!mmap || mmap.constructor.name !== 'Mapper5') {
            console.log('\n--- MMC5 State ---');
            console.log('(Not an MMC5 game)');
            return;
        }
        
        console.log('\n--- MMC5 State ---');
        
        // PRG Mode $5100
        console.log(`$5100: - PRG Mode       = ${mmap.prgMode}`);
        console.log(`  Mode ${mmap.prgMode}: ${['32KB', '16KB+16KB', '16KB+8KB+8KB', '8KB×4'][mmap.prgMode]}`);
        
        // CHR Mode $5101
        console.log(`$5101: - CHR Mode       = ${mmap.chrMode}`);
        console.log(`  Mode ${mmap.chrMode}: ${['8KB', '4KB×2', '2KB×4', '1KB×8'][mmap.chrMode]}`);
        
        // PRG RAM Protect $5102/$5103
        console.log(`$5102: - PRG RAM Prot1  = $${this.hex(mmap.prgRamProtect1)}`);
        console.log(`$5103: - PRG RAM Prot2  = $${this.hex(mmap.prgRamProtect2)}`);
        console.log(`  Write Enabled: ${mmap.prgRamProtect1 === 0x02 && mmap.prgRamProtect2 === 0x01}`);
        
        // ExRAM Mode $5104
        console.log(`$5104: - ExRAM Mode     = ${mmap.extendedRamMode}`);
        const exRamModes = [
            '0: Write-only (NT data)',
            '1: Extended Attributes',
            '2: Read/Write RAM',
            '3: Read-only RAM'
        ];
        console.log(`  ${exRamModes[mmap.extendedRamMode]}`);
        
        // Nametable Mapping $5105
        console.log(`$5105: - NT Mapping     = $${this.hex(mmap.nametableMapping)}`);
        const ntSources = ['CIRAM 0', 'CIRAM 1', 'ExRAM', 'Fill'];
        for (let i = 0; i < 4; i++) {
            const src = (mmap.nametableMapping >> (i * 2)) & 0x03;
            console.log(`  NT${i} ($${this.hex16(0x2000 + i * 0x400)}): ${ntSources[src]}`);
        }
        
        // Fill Mode $5106/$5107
        console.log(`$5106: - Fill Mode Tile        = $${this.hex(mmap.fillModeTile)}`);
        console.log(`$5107: - Fill Attribute/Color  = $${this.hex(mmap.fillModeColor)}`);
        
        // PRG Banks $5113-$5117
        console.log(`PRG Banks:`);
        console.log(`  $5113: (RAM):   $${this.hex(mmap.prgBanks[0])}`);
        console.log(`  $5114: ($8000): $${this.hex(mmap.prgBanks[1])} ${(mmap.prgBanks[1] & 0x80) ? 'ROM' : 'RAM'}`);
        console.log(`  $5115: ($A000): $${this.hex(mmap.prgBanks[2])} ${(mmap.prgBanks[2] & 0x80) ? 'ROM' : 'RAM'}`);
        console.log(`  $5116: ($C000): $${this.hex(mmap.prgBanks[3])} ${(mmap.prgBanks[3] & 0x80) ? 'ROM' : 'RAM'}`);
        console.log(`  $5117: ($E000): $${this.hex(mmap.prgBanks[4])} ROM (always)`);
        
        // For the CHR Banks match to Mesen Output
        function hexToDecimal(hexString) {
            return parseInt(hexString, 16);
        }
        // Example usage:  
        //console.log(hexToDecimal("7F"));

        // CHR Banks $5120-$512B
        console.log(`CHR Banks (A - BG):`);
        for (let i = 0; i < 8; i++) {
            console.log(`  $512${i.toString(16).toUpperCase()}: CHR Bank Register ${i}     = Hex: $${this.hex16(mmap.chrBanks[i])}   Value: ${hexToDecimal(this.hex16(mmap.chrBanks[i]))}`);
        }
        console.log(`CHR Banks (B - Sprites 8x16):`);
        for (let i = 8; i < 10; i++) {
            console.log(`  $512${i.toString(16).toUpperCase()}: CHR Bank Register ${i}     = Hex: $${this.hex16(mmap.chrBanks[i])}   Value: ${hexToDecimal(this.hex16(mmap.chrBanks[i]))}`);
        }
        for (let i = 10; i < 12; i++) {
            console.log(`  $512${i.toString(16).toUpperCase()}: CHR Bank Register ${i}    = Hex: $${this.hex16(mmap.chrBanks[i])}   Value: ${hexToDecimal(this.hex16(mmap.chrBanks[i]))}`);
        }

        // CHR Upper Bits $5130
        console.log(`$5130: - CHR Upper Bits = ${mmap.chrUpperBits}`);
        
        // Vertical Split $5200-$5202
        console.log(`$5200 - Vertical Split Control   = $${this.hex((mmap.verticalSplitEnabled ? 0x80 : 0) | (mmap.verticalSplitRightSide ? 0x40 : 0) | mmap.verticalSplitDelimiterTile)}`);
        console.log(`  $5200.0-4 - Delimiter Tile:    = ${mmap.verticalSplitDelimiterTile}`);
        console.log(`  $5200.6   - Right Side:        = ${mmap.verticalSplitRightSide ? 'True' : 'False'}`);
        console.log(`  $5200.7   - Enabled:           = ${mmap.verticalSplitEnabled}`);
        console.log(`  $5201     - Scroll:            = $${this.hex(mmap.verticalSplitScroll)}`);
        console.log(`  $5202     - Bank:              = $${this.hex(mmap.verticalSplitBank)}`);
        
        // IRQ $5203/$5204
        console.log(`$5203 - IRQ Counter Target:      = Value: ${mmap.irqCounterTarget} - (Hex: $${this.hex(mmap.irqCounterTarget)})`);
        const irqStatus = (mmap.ppuInFrame ? 0x40 : 0) | (mmap.irqPending ? 0x80 : 0);
        console.log(`$5204   - IRQ Status:            = $${this.hex(irqStatus)}`);
        console.log(`$5204.7 - IRQ Enabled:           = ${mmap.irqEnabled}`);
        console.log(`$5205   - Multiplcand            = $${this.hex(mmap.multiplierValue1)}`);
        console.log(`$5205   - Multiplier             = $${this.hex(mmap.multiplierValue2)}`);
        // Multiplier $5205/$5206
        const product = mmap.multiplierValue1 * mmap.multiplierValue2;
        console.log(`$5205/6 - Multiplication Result: = $${this.hex(mmap.multiplierValue1)} × $${this.hex(mmap.multiplierValue2)} = $${this.hex16(product)} (${product})`);
      
        console.log(`  IRQ Pending:                   = ${mmap.irqPending}`);
        console.log(`  In Frame:                      = ${mmap.ppuInFrame}`);
        console.log(`  Scanline:                      = ${mmap.scanlineCounter}`);
        
          
        // ExRAM sample
        console.log(`ExRAM ($5C00-$5FFF) - First 64 bytes:`);
        console.log(this.formatMemoryBlock(mmap.exRam, 0, 64));
    }

    // =========================================================================
    // Utility Methods
    // =========================================================================
    
    hex(value) {
        return (value || 0).toString(16).toUpperCase().padStart(2, '0');
    }
    
    hex16(value) {
        return (value || 0).toString(16).toUpperCase().padStart(4, '0');
    }
    
    formatMemoryBlock(mem, start, length) {
        if (!mem) return '  (no data)';
        
        let result = [];
        for (let row = 0; row < length; row += 16) {
            let line = `  $${this.hex16(start + row)}: `;
            let bytes = [];
            for (let col = 0; col < 16 && (row + col) < length; col++) {
                bytes.push(this.hex(mem[start + row + col] || 0));
            }
            line += bytes.join(' ');
            result.push(line);
        }
        return result.join('\n');
    }
}

/**
 * Quick initialization helper
 * Call this after your NES instance is created
 */
export function initDebug(nes, key = 'F9') {
    const debug = new NESDebug(nes);
    debug.bindKey(document, key);
    
    // Also expose globally for console access
    window.nesDebug = debug;
    console.log('[NESDebug] Debug module loaded. Use nesDebug.outputAll() or press ' + key);
    
    return debug;
}
