import { Tile } from "./tile.js";
import { toJSON, fromJSON } from "./utils.js";

export class PPU {
  constructor(nes) {
    this.nes = nes;
    
    this.a12 = 0;   // Track last A12 state for MMC3 IRQ edge detection

    // Status flags
    this.STATUS_VRAMWRITE = 4;
    this.STATUS_SLSPRITECOUNT = 5;
    this.STATUS_SPRITE0HIT = 6;
    this.STATUS_VBLANK = 7;

    // JSON Properties
    this.JSON_PROPERTIES = [
      "vramMem", "spriteMem", "cntFV", "cntV", "cntH", "cntVT", "cntHT",
      "regFV", "regV", "regH", "regVT", "regHT", "regFH", "regS",
      "vramAddress", "vramTmpAddress", "f_nmiOnVblank", "f_spriteSize",
      "f_bgPatternTable", "f_spPatternTable", "f_addrInc", "f_nTblAddress",
      "f_color", "f_spVisibility", "f_bgVisibility", "f_spClipping",
      "f_bgClipping", "f_dispType", "vramBufferedReadValue", "firstWrite",
      "currentMirroring", "vramMirrorTable", "ntable1", "sramAddress",
      "hitSpr0", "sprPalette", "imgPalette", "curX", "scanline",
      "lastRenderedScanline", "curNt", "scantile", "attrib", "buffer",
      "bgbuffer", "pixrendered", "requestEndFrame", "nmiOk",
      "dummyCycleToggle", "nmiCounter", "validTileData", "scanlineAlreadyRendered"
    ];

    // Rendering Options:
    this.showSpr0Hit = false;
    this.clipToTvSize = true;

    this.reset();
  }

  reset() {
    this.vramMem = new Array(0x8000).fill(0);
    this.spriteMem = new Array(0x100).fill(0);
    
    this.vramAddress = null;
    this.vramTmpAddress = null;
    this.vramBufferedReadValue = 0;
    this.firstWrite = true; 
    this.sramAddress = 0; 
    this.currentMirroring = -1;
    this.requestEndFrame = false;
    this.nmiOk = false;
    this.dummyCycleToggle = false;
    this.validTileData = false;
    this.nmiCounter = 0;
    this.scanlineAlreadyRendered = null;
    
    this.f_nmiOnVblank = 0; 
    this.f_spriteSize = 0; 
    this.f_bgPatternTable = 0; 
    this.f_spPatternTable = 0; 
    this.f_addrInc = 0; 
    this.f_nTblAddress = 0; 

    this.f_color = 0; 
    this.f_spVisibility = 0; 
    this.f_bgVisibility = 0; 
    this.f_spClipping = 0; 
    this.f_bgClipping = 0; 
    this.f_dispType = 0; 

    this.cntFV = 0; this.cntV = 0; this.cntH = 0; this.cntVT = 0; this.cntHT = 0;
    this.regFV = 0; this.regV = 0; this.regH = 0; this.regVT = 0; this.regHT = 0;
    this.regFH = 0; this.regS = 0;

    this.curNt = null;
    this.attrib = new Array(32);
    this.buffer = new Array(256 * 240);
    this.bgbuffer = new Array(256 * 240);
    this.pixrendered = new Array(256 * 240);
    this.scantile = new Array(32);

    this.scanline = 0;
    this.lastRenderedScanline = -1;
    this.curX = 0;

    this.sprX = new Array(64); 
    this.sprY = new Array(64); 
    this.sprTile = new Array(64); 
    this.sprCol = new Array(64); 
    this.vertFlip = new Array(64); 
    this.horiFlip = new Array(64); 
    this.bgPriority = new Array(64); 
    this.spr0HitX = 0; 
    this.spr0HitY = 0; 
    this.hitSpr0 = false;

    this.sprPalette = new Array(16);
    this.imgPalette = new Array(16);

    this.ptTile = new Array(512);
    for (let i = 0; i < 512; i++) {
      this.ptTile[i] = new Tile();
    }

    this.ntable1 = new Array(4);
    this.nameTable = new Array(4);
    for (let i = 0; i < 4; i++) {
      this.nameTable[i] = new NameTable(32, 32, "Nt" + i);
    }

    this.vramMirrorTable = new Array(0x8000);
    for (let i = 0; i < 0x8000; i++) {
      this.vramMirrorTable[i] = i;
    }

    this.palTable = new PaletteTable();
    this.palTable.loadNTSCPalette();

    this.updateControlReg1(0);
    this.updateControlReg2(0);
  }

  setMirroring(mirroring) {
    if (mirroring === this.currentMirroring) return;
    this.currentMirroring = mirroring;
    this.triggerRendering();

    if (this.vramMirrorTable === null) {
      this.vramMirrorTable = new Array(0x8000);
    }
    for (let i = 0; i < 0x8000; i++) {
      this.vramMirrorTable[i] = i;
    }

    this.defineMirrorRegion(0x3f20, 0x3f00, 0x20);
    this.defineMirrorRegion(0x3f40, 0x3f00, 0x20);
    this.defineMirrorRegion(0x3f80, 0x3f00, 0x20);
    this.defineMirrorRegion(0x3fc0, 0x3f00, 0x20);
    this.defineMirrorRegion(0x3000, 0x2000, 0xf00);
    this.defineMirrorRegion(0x4000, 0x0000, 0x4000);

    if (mirroring === this.nes.rom.HORIZONTAL_MIRRORING) {
      this.ntable1[0] = 0; this.ntable1[1] = 0;
      this.ntable1[2] = 1; this.ntable1[3] = 1;
      this.defineMirrorRegion(0x2400, 0x2000, 0x400);
      this.defineMirrorRegion(0x2c00, 0x2800, 0x400);
    } else if (mirroring === this.nes.rom.VERTICAL_MIRRORING) {
      this.ntable1[0] = 0; this.ntable1[1] = 1;
      this.ntable1[2] = 0; this.ntable1[3] = 1;
      this.defineMirrorRegion(0x2800, 0x2000, 0x400);
      this.defineMirrorRegion(0x2c00, 0x2400, 0x400);
    } else if (mirroring === this.nes.rom.SINGLESCREEN_MIRRORING) {
      this.ntable1[0] = 0; this.ntable1[1] = 0;
      this.ntable1[2] = 0; this.ntable1[3] = 0;
      this.defineMirrorRegion(0x2400, 0x2000, 0x400);
      this.defineMirrorRegion(0x2800, 0x2000, 0x400);
      this.defineMirrorRegion(0x2c00, 0x2000, 0x400);
    } else if (mirroring === this.nes.rom.SINGLESCREEN_MIRRORING2) {
      this.ntable1[0] = 1; this.ntable1[1] = 1;
      this.ntable1[2] = 1; this.ntable1[3] = 1;
      this.defineMirrorRegion(0x2400, 0x2400, 0x400);
      this.defineMirrorRegion(0x2800, 0x2400, 0x400);
      this.defineMirrorRegion(0x2c00, 0x2400, 0x400);
    } else {
      this.ntable1[0] = 0; this.ntable1[1] = 1;
      this.ntable1[2] = 2; this.ntable1[3] = 3;
    }
  }

  defineMirrorRegion(fromStart, toStart, size) {
    for (let i = 0; i < size; i++) {
      this.vramMirrorTable[fromStart + i] = toStart + i;
    }
  }

  startVBlank() {
    this.nes.cpu.requestIrq(this.nes.cpu.IRQ_NMI);
    if (this.lastRenderedScanline < 239) {
      this.renderFramePartially(this.lastRenderedScanline + 1, 240 - this.lastRenderedScanline);
    }
    this.endFrame();
    this.lastRenderedScanline = -1;
  }

  endScanline() {
    switch (this.scanline) {
      case 19:
        // Dummy scanline.
        // May be variable length:
        if (this.dummyCycleToggle) {
          // Remove dead cycle at end of scanline,
          // for next scanline:
          this.curX = 1;
          this.dummyCycleToggle = !this.dummyCycleToggle;
        }
        break;

      case 20:
        // Clear VBlank flag:
        this.setStatusFlag(this.STATUS_VBLANK, false);

        // Clear Sprite #0 hit flag:
        this.setStatusFlag(this.STATUS_SPRITE0HIT, false);
        this.hitSpr0 = false;
        this.spr0HitX = -1;
        this.spr0HitY = -1;

        if (this.f_bgVisibility === 1 || this.f_spVisibility === 1) {
          // Update counters:
          this.cntFV = this.regFV;
          this.cntV = this.regV;
          this.cntH = this.regH;
          this.cntVT = this.regVT;
          this.cntHT = this.regHT;

          // --- MMC2 FIX: Pre-render Sprites for Scanline 0 ---
          // This must happen BEFORE the BG is rendered for Line 0, so that the 
          // MMC2 latches are set correctly by the magic sprites on the pre-render line.
            if (this.nes.mmap.hasLatch && this.f_spVisibility === 1) {
              // Render "dummy" sprites for the first visible line (line 0)
              // The output is discarded/overwritten, but the Mapper Latches are triggered.
              this.renderSpritesPartially(0, 1, true);
              this.renderSpritesPartially(0, 1, false);
          }
          // ---------------------------------------------------

          if (this.f_bgVisibility === 1) {
            // Render dummy scanline:
            this.renderBgScanline(false, 0);
          }
        }

        if (this.f_bgVisibility === 1 && this.f_spVisibility === 1) {
          // Check sprite 0 hit for first scanline:
          this.checkSprite0(0);
        }

        if (this.f_bgVisibility === 1 || this.f_spVisibility === 1) {
          // Clock mapper IRQ Counter:
          // this.nes.mmap.clockIrqCounter();
        }
        break;

      case 261:
        // Dead scanline, no rendering.
        // Set VINT:
        this.setStatusFlag(this.STATUS_VBLANK, true);
        this.requestEndFrame = true;
        this.nmiCounter = 9;

        // Wrap around:
        this.scanline = -1; // will be incremented to 0

        break;

      default:
        if (this.scanline >= 21 && this.scanline <= 260) {
          // Render normally:
          if (this.f_bgVisibility === 1) {
            
            // --- SYNC FIX: Render sprites before processing BG latches ---
            if (this.nes.mmap.hasLatch) {
            this.triggerRendering();
            }
            // -------------------------------------------------------------

            if (!this.scanlineAlreadyRendered) {
              // update scroll:
              this.cntHT = this.regHT;
              this.cntH = this.regH;
              this.renderBgScanline(true, this.scanline + 1 - 21);
            }
            this.scanlineAlreadyRendered = false;

            // Check for sprite 0 (next scanline):
            if (!this.hitSpr0 && this.f_spVisibility === 1) {
              if (
                this.sprX[0] >= -7 &&
                this.sprX[0] < 256 &&
                this.sprY[0] + 1 <= this.scanline - 20 &&
                this.sprY[0] + 1 + (this.f_spriteSize === 0 ? 8 : 16) >=
                  this.scanline - 20
              ) {
                if (this.checkSprite0(this.scanline - 20)) {
                  this.hitSpr0 = true;
                }
              }
            }
          }

          if (this.f_bgVisibility === 1 || this.f_spVisibility === 1) {
            // Clock mapper IRQ Counter:
            // this.nes.mmap.clockIrqCounter();
          }
        }
    }

    this.scanline++;
    this.regsToAddress();
    this.cntsToAddress();
  }

  startFrame() {
    let bgColor = 0;
    if (this.f_dispType === 0) {
      bgColor = this.imgPalette[0];
    } else {
      switch (this.f_color) {
        case 0: bgColor = 0x00000; break;
        case 1: bgColor = 0x00ff00; break;
        case 2: bgColor = 0xff0000; break;
        case 3: bgColor = 0x000000; break;
        case 4: bgColor = 0x0000ff; break;
        default: bgColor = 0x0;
      }
    }
    const buffer = this.buffer;
    for (let i = 0; i < 256 * 240; i++) buffer[i] = bgColor;
    const pixrendered = this.pixrendered;
    for (let i = 0; i < pixrendered.length; i++) pixrendered[i] = 65;
  }

  endFrame() {
    let i, x, y;
    const buffer = this.buffer;
    if (this.showSpr0Hit) {
        if (this.sprX[0] >= 0 && this.sprX[0] < 256 && this.sprY[0] >= 0 && this.sprY[0] < 240) {
            for (i = 0; i < 256; i++) buffer[(this.sprY[0] << 8) + i] = 0xff5555;
            for (i = 0; i < 240; i++) buffer[(i << 8) + this.sprX[0]] = 0xff5555;
        }
        if (this.spr0HitX >= 0 && this.spr0HitX < 256 && this.spr0HitY >= 0 && this.spr0HitY < 240) {
            for (i = 0; i < 256; i++) buffer[(this.spr0HitY << 8) + i] = 0x55ff55;
            for (i = 0; i < 240; i++) buffer[(i << 8) + this.spr0HitX] = 0x55ff55;
        }
    }
    if (this.clipToTvSize || this.f_bgClipping === 0 || this.f_spClipping === 0) {
      for (y = 0; y < 240; y++) for (x = 0; x < 8; x++) buffer[(y << 8) + x] = 0;
    }
    if (this.clipToTvSize) {
      for (y = 0; y < 240; y++) for (x = 0; x < 8; x++) buffer[(y << 8) + 255 - x] = 0;
      for (y = 0; y < 8; y++) for (x = 0; x < 256; x++) {
          buffer[(y << 8) + x] = 0;
          buffer[((239 - y) << 8) + x] = 0;
      }
    }
    this.nes.ui.writeFrame(buffer);
  }

  updateControlReg1(value) {
    this.triggerRendering();
    this.f_nmiOnVblank = (value >> 7) & 1;
    this.f_spriteSize = (value >> 5) & 1;
    this.f_bgPatternTable = (value >> 4) & 1;
    this.f_spPatternTable = (value >> 3) & 1;
    this.f_addrInc = (value >> 2) & 1;
    this.f_nTblAddress = value & 3;
    this.regV = (value >> 1) & 1;
    this.regH = value & 1;
    this.regS = (value >> 4) & 1;
  }

  updateControlReg2(value) {
    this.triggerRendering();
    this.f_color = (value >> 5) & 7;
    this.f_spVisibility = (value >> 4) & 1;
    this.f_bgVisibility = (value >> 3) & 1;
    this.f_spClipping = (value >> 2) & 1;
    this.f_bgClipping = (value >> 1) & 1;
    this.f_dispType = value & 1;
    if (this.f_dispType === 0) this.palTable.setEmphasis(this.f_color);
    this.updatePalettes();
  }

  setStatusFlag(flag, value) {
    const n = 1 << flag;
    this.nes.cpu.mem[0x2002] = (this.nes.cpu.mem[0x2002] & (255 - n)) | (value ? n : 0);
  }

  readStatusRegister() {
    const tmp = this.nes.cpu.mem[0x2002];
    this.firstWrite = true;
    this.setStatusFlag(this.STATUS_VBLANK, false);
    return tmp;
  }

  writeSRAMAddress(address) { this.sramAddress = address; }
  sramLoad() { return this.spriteMem[this.sramAddress]; }
  sramWrite(value) {
    this.spriteMem[this.sramAddress] = value;
    this.spriteRamWriteUpdate(this.sramAddress, value);
    this.sramAddress++;
    this.sramAddress %= 0x100;
  }

  scrollWrite(value) {
    this.triggerRendering();
    if (this.firstWrite) {
      this.regHT = (value >> 3) & 31;
      this.regFH = value & 7;
    } else {
      this.regFV = value & 7;
      this.regVT = (value >> 3) & 31;
    }
    this.firstWrite = !this.firstWrite;
  }

  writeVRAMAddress(address) {
    if (this.firstWrite) {
      this.regFV = (address >> 4) & 3;
      this.regV = (address >> 3) & 1;
      this.regH = (address >> 2) & 1;
      this.regVT = (this.regVT & 7) | ((address & 3) << 3);
    } else {
      this.triggerRendering();
      this.regVT = (this.regVT & 24) | ((address >> 5) & 7);
      this.regHT = address & 31;
      this.cntFV = this.regFV; this.cntV = this.regV;
      this.cntH = this.regH; this.cntVT = this.regVT; this.cntHT = this.regHT;
      this.checkSprite0(this.scanline - 20);
    }
    this.firstWrite = !this.firstWrite;
    this.cntsToAddress();
    if (this.vramAddress < 0x2000) this.nes.mmap.latchAccess(this.vramAddress);
  }

  vramLoad() {
    let tmp;
    this.cntsToAddress();
    this.regsToAddress();
    if (this.vramAddress <= 0x3eff) {
      tmp = this.vramBufferedReadValue;
      if (this.vramAddress < 0x2000) this.vramBufferedReadValue = this.vramMem[this.vramAddress];
      else this.vramBufferedReadValue = this.mirroredLoad(this.vramAddress);
      if (this.vramAddress < 0x2000) this.nes.mmap.latchAccess(this.vramAddress);
      this.vramAddress += this.f_addrInc === 1 ? 32 : 1;
      this.cntsFromAddress(); this.regsFromAddress();
      return tmp;
    }
    tmp = this.mirroredLoad(this.vramAddress);
    this.vramAddress += this.f_addrInc === 1 ? 32 : 1;
    this.cntsFromAddress(); this.regsFromAddress();
    return tmp;
  }

  vramWrite(value) {
    this.triggerRendering();
    this.cntsToAddress();
    this.regsToAddress();
    if (this.vramAddress >= 0x2000) this.mirroredWrite(this.vramAddress, value);
    else {
      this.writeMem(this.vramAddress, value);
      this.nes.mmap.latchAccess(this.vramAddress);
    }
    this.vramAddress += this.f_addrInc === 1 ? 32 : 1;
    this.regsFromAddress();
    this.cntsFromAddress();
  }

  sramDMA(value) {
    const baseAddress = value * 0x100;
    let data;
    for (let i = this.sramAddress; i < 256; i++) {
      data = this.nes.cpu.mem[baseAddress + i];
      this.spriteMem[i] = data;
      this.spriteRamWriteUpdate(i, data);
    }
    this.nes.cpu.haltCycles(513);
  }

  regsFromAddress() {
    let address = (this.vramTmpAddress >> 8) & 0xff;
    this.regFV = (address >> 4) & 7;
    this.regV = (address >> 3) & 1;
    this.regH = (address >> 2) & 1;
    this.regVT = (this.regVT & 7) | ((address & 3) << 3);
    address = this.vramTmpAddress & 0xff;
    this.regVT = (this.regVT & 24) | ((address >> 5) & 7);
    this.regHT = address & 31;
  }

  cntsFromAddress() {
    let address = (this.vramAddress >> 8) & 0xff;
    this.cntFV = (address >> 4) & 3;
    this.cntV = (address >> 3) & 1;
    this.cntH = (address >> 2) & 1;
    this.cntVT = (this.cntVT & 7) | ((address & 3) << 3);
    address = this.vramAddress & 0xff;
    this.cntVT = (this.cntVT & 24) | ((address >> 5) & 7);
    this.cntHT = address & 31;
  }

  regsToAddress() {
    let b1 = (this.regFV & 7) << 4;
    b1 |= (this.regV & 1) << 3;
    b1 |= (this.regH & 1) << 2;
    b1 |= (this.regVT >> 3) & 3;
    let b2 = (this.regVT & 7) << 5;
    b2 |= this.regHT & 31;
    this.vramTmpAddress = ((b1 << 8) | b2) & 0x7fff;
  }

  cntsToAddress() {
    let b1 = (this.cntFV & 7) << 4;
    b1 |= (this.cntV & 1) << 3;
    b1 |= (this.cntH & 1) << 2;
    b1 |= (this.cntVT >> 3) & 3;
    let b2 = (this.cntVT & 7) << 5;
    b2 |= this.cntHT & 31;
    this.vramAddress = ((b1 << 8) | b2) & 0x7fff;
  }

  incTileCounter(count) {
    for (let i = count; i !== 0; i--) {
      this.cntHT++;
      if (this.cntHT === 32) {
        this.cntHT = 0;
        this.cntVT++;
        if (this.cntVT >= 30) {
          this.cntH++;
          if (this.cntH === 2) {
            this.cntH = 0;
            this.cntV++;
            if (this.cntV === 2) {
              this.cntV = 0;
              this.cntFV++;
              this.cntFV &= 0x7;
            }
          }
        }
      }
    }
  }

  mirroredLoad(address) {
    return this.vramMem[this.vramMirrorTable[address]];
  }

  mirroredWrite(address, value) {
    if (address >= 0x3f00 && address < 0x3f20) {
      if (address === 0x3f00 || address === 0x3f10) { this.writeMem(0x3f00, value); this.writeMem(0x3f10, value); }
      else if (address === 0x3f04 || address === 0x3f14) { this.writeMem(0x3f04, value); this.writeMem(0x3f14, value); }
      else if (address === 0x3f08 || address === 0x3f18) { this.writeMem(0x3f08, value); this.writeMem(0x3f18, value); }
      else if (address === 0x3f0c || address === 0x3f1c) { this.writeMem(0x3f0c, value); this.writeMem(0x3f1c, value); }
      else this.writeMem(address, value);
    } else {
      if (address < this.vramMirrorTable.length) this.writeMem(this.vramMirrorTable[address], value);
      else throw new Error("Invalid VRAM address: " + address.toString(16));
    }
  }

  triggerRendering() {
    if (this.scanline >= 21 && this.scanline <= 260) {
      this.renderFramePartially(this.lastRenderedScanline + 1, this.scanline - 21 - this.lastRenderedScanline);
      this.lastRenderedScanline = this.scanline - 21;
    }
  }

  renderFramePartially(startScan, scanCount) {
    if (this.f_spVisibility === 1) this.renderSpritesPartially(startScan, scanCount, true);
    if (this.f_bgVisibility === 1) {
      const si = startScan << 8;
      let ei = (startScan + scanCount) << 8;
      if (ei > 0xf000) ei = 0xf000;
      const buffer = this.buffer;
      const bgbuffer = this.bgbuffer;
      const pixrendered = this.pixrendered;
      for (let destIndex = si; destIndex < ei; destIndex++) {
        if (pixrendered[destIndex] > 0xff) buffer[destIndex] = bgbuffer[destIndex];
      }
    }
    if (this.f_spVisibility === 1) this.renderSpritesPartially(startScan, scanCount, false);
    this.validTileData = false;
  }

  renderBgScanline(bgbuffer, scan) {
    var isMMC2 = this.nes.rom && this.nes.rom.mapperType === 9;
    var baseTile = this.regS === 0 ? 0 : 256;
    var destIndex = (scan << 8) - this.regFH;

    // --- MMC3 A12 Signaling ---
    // Signal A12 for BG pattern table at start of BG rendering.
    // This creates the low state before sprite fetches cause the rising edge.
    var mmap = this.nes.mmap;
    if (mmap && typeof mmap.notifyA12 === "function") {
      mmap.notifyA12(this.f_bgPatternTable);
    }
    // --- End MMC3 A12 Signaling ---

    this.curNt = this.ntable1[this.cntV + this.cntV + this.cntH];

    this.cntHT = this.regHT;
    this.cntH = this.regH;
    this.curNt = this.ntable1[this.cntV + this.cntV + this.cntH];

    if (scan < 240 && scan - this.cntFV >= 0) {
      var tscanoffset = this.cntFV << 3;
      var scantile = this.scantile;
      var attrib = this.attrib;
      var ptTile = this.ptTile;
      var nameTable = this.nameTable;
      var imgPalette = this.imgPalette;
      var pixrendered = this.pixrendered;
      var targetBuffer = bgbuffer ? this.bgbuffer : this.buffer;

      var t, tpix, att, col;

      var tileCount = isMMC2 ? 34 : 32;

      for (var tile = 0; tile < tileCount; tile++) {
        if (scan >= 0) {
          // Fetch tile & attrib data:
          if (this.validTileData) {
            // Get data from array:
            t = scantile[tile];
            if (typeof t === "undefined") {
              continue;
            }
            tpix = t.pix;
            att = attrib[tile];
          } else {
            // Fetch data:
            var tileIndex = nameTable[this.curNt].getTileIndex(this.cntHT, this.cntVT);
            
            t = ptTile[baseTile + tileIndex];
            
            // --- MMC2 Latch Trigger (Start) ---
            // Trigger AFTER fetching tile data so the NEXT tile sees the new bank
            if (this.nes.mmap && this.nes.mmap.latchAccess) {
               this.nes.mmap.latchAccess((baseTile === 0 ? 0x0000 : 0x1000) + (tileIndex << 4));
            }
            // --- MMC2 Latch Trigger (End) ---

            if (typeof t === "undefined") {
              continue;
            }
            tpix = t.pix;
            att = nameTable[this.curNt].getAttrib(this.cntHT, this.cntVT);
            scantile[tile] = t;
            attrib[tile] = att;
          }

          // Render tile scanline:
          var sx = 0;
          var x = (tile << 3) - this.regFH;

          if (x > -8) {
            if (x < 0) {
              destIndex -= x;
              sx = -x;
            }
            if (t.opaque[this.cntFV]) {
              for (; sx < 8; sx++) {
                targetBuffer[destIndex] =
                  imgPalette[tpix[tscanoffset + sx] + att];
                pixrendered[destIndex] |= 256;
                destIndex++;
              }
            } else {
              for (; sx < 8; sx++) {
                col = tpix[tscanoffset + sx];
                if (col !== 0) {
                  targetBuffer[destIndex] = imgPalette[col + att];
                  pixrendered[destIndex] |= 256;
                }
                destIndex++;
              }
            }
          }
        }

        // Increase Horizontal Tile Counter:
        if (++this.cntHT === 32) {
          this.cntHT = 0;
          this.cntH++;
          this.cntH %= 2;
          this.curNt = this.ntable1[(this.cntV << 1) + this.cntH];
        }
      }

      // Tile data for one row should now have been fetched,
      // so the data in the array is valid.
      this.validTileData = true;
    }

    // update vertical scroll:
    this.cntFV++;
    if (this.cntFV === 8) {
      this.cntFV = 0;
      this.cntVT++;
      if (this.cntVT === 30) {
        this.cntVT = 0;
        this.cntV++;
        this.cntV %= 2;
        this.curNt = this.ntable1[(this.cntV << 1) + this.cntH];
      } else if (this.cntVT === 32) {
        this.cntVT = 0;
      }

      // Invalidate fetched data:
      // --- MMC2 FIX: Disable optimization to force latch access every scanline ---
      this.validTileData = false; 
      // --------------------------------------------------------------------------
    }
  }

  renderSpritesPartially(startscan, scancount, bgPri) {
    if (this.f_spVisibility === 1) {
      // --- MMC3 A12 Signaling ---
      // Signal A12 transitions for sprite pattern fetches.
      // On real hardware, sprite fetches cause A12 to reflect the sprite pattern table.
      // This is critical for MMC3 scanline counter timing.
      var mmap = this.nes.mmap;
      if (mmap && typeof mmap.notifyA12 === "function") {
        // Signal the sprite pattern table address (A12 = 1 for $1000, 0 for $0000)
        // For 8x8 sprites, it's based on f_spPatternTable
        // For 8x16 sprites, each sprite can use either bank, but typically
        // the first sprite fetch triggers the A12 transition
        if (this.f_spriteSize === 0) {
          // 8x8 sprites use the configured pattern table
          mmap.notifyA12(this.f_spPatternTable);
        } else {
          // 8x16 sprites - signal based on first visible sprite's bank
          // Default to A12=1 which is typical for SMB3 (sprites use $1000)
          var signaled = false;
          for (var j = 0; j < 64; j++) {
            if (this.sprY[j] + 16 >= startscan && this.sprY[j] < startscan + scancount) {
              var spriteBank = (this.sprTile[j] & 1) ? 1 : 0;
              mmap.notifyA12(spriteBank);
              signaled = true;
              break;
            }
          }
          // If no visible sprites, still signal A12=1 (PPU still fetches from $1000 area)
          if (!signaled) {
            mmap.notifyA12(1);
          }
        }
      }
      // --- End MMC3 A12 Signaling ---
      
      for (var i = 0; i < 64; i++) {
        // --- MMC2 Latch Trigger (Start) ---
        // Latch MUST trigger for every sprite on the scanline, 
        // regardless of priority (bgPri) or visibility.
        // We do this check first.

        // Use correct sprite height (8 or 16) for visibility check
        var latchSpriteHeight = (this.f_spriteSize === 0) ? 8 : 16;
        if (
          this.sprY[i] + latchSpriteHeight >= startscan &&
          this.sprY[i] < startscan + scancount
        ) {
             if(this.nes.mmap && this.nes.mmap.latchAccess) {
                 if (this.f_spriteSize === 0) {
                     // 8x8
                     var bankBase = (this.f_spPatternTable === 0) ? 0x0000 : 0x1000;
                     this.nes.mmap.latchAccess(bankBase + (this.sprTile[i] << 4));
                 } else {
                     // 8x16
                     var top = this.sprTile[i];
                     var bank = (top & 1) ? 0x1000 : 0x0000;
                     var topTileIndex = top & 0xFE;
                     this.nes.mmap.latchAccess(bank + (topTileIndex << 4)); // Top
                     this.nes.mmap.latchAccess(bank + ((topTileIndex + 1) << 4)); // Bottom
                 }
             }
        }
        // --- MMC2 Latch Trigger (End) ---

        // Calculate sprite height based on sprite size mode
        var spriteHeight = (this.f_spriteSize === 0) ? 8 : 16;

        if (
          this.bgPriority[i] === bgPri &&
          this.sprX[i] >= 0 &&
          this.sprX[i] < 256 &&
          this.sprY[i] + spriteHeight >= startscan &&
          this.sprY[i] < startscan + scancount
        ) {
          // Show sprite.
          if (this.f_spriteSize === 0) {
            // 8x8 sprites
            this.srcy1 = 0;
            this.srcy2 = 8;

            if (this.sprY[i] < startscan) {
              this.srcy1 = startscan - this.sprY[i] - 1;
            }

            if (this.sprY[i] + 8 > startscan + scancount) {
              this.srcy2 = startscan + scancount - this.sprY[i] + 1;
            }

            var tileIndex = this.sprTile[i] + (this.f_spPatternTable === 0 ? 0 : 256);
            var t = this.ptTile[tileIndex];

            // Safety check: Only render if tile exists
            if (t) {
                t.render(
                  this.buffer,
                  0,
                  this.srcy1,
                  8,
                  this.srcy2,
                  this.sprX[i],
                  this.sprY[i] + 1,
                  this.sprCol[i],
                  this.sprPalette,
                  this.horiFlip[i],
                  this.vertFlip[i],
                  i,
                  this.pixrendered
                );
            }
          } else {
            // 8x16 sprites
            var top = this.sprTile[i];
            
            if ((top & 1) !== 0) {
              top = this.sprTile[i] - 1 + 256;
            }

            var srcy1 = 0;
            var srcy2 = 8;

            if (this.sprY[i] < startscan) {
              srcy1 = startscan - this.sprY[i] - 1;
            }

            if (this.sprY[i] + 8 > startscan + scancount) {
              srcy2 = startscan + scancount - this.sprY[i];
            }

            var t1 = this.ptTile[top + (this.vertFlip[i] ? 1 : 0)];
            // Safety check: Only render if tile exists
            if (t1) {
                t1.render(
                  this.buffer,
                  0,
                  srcy1,
                  8,
                  srcy2,
                  this.sprX[i],
                  this.sprY[i] + 1,
                  this.sprCol[i],
                  this.sprPalette,
                  this.horiFlip[i],
                  this.vertFlip[i],
                  i,
                  this.pixrendered
                );
            }

            srcy1 = 0;
            srcy2 = 8;

            if (this.sprY[i] + 8 < startscan) {
              srcy1 = startscan - (this.sprY[i] + 8 + 1);
            }

            if (this.sprY[i] + 16 > startscan + scancount) {
              srcy2 = startscan + scancount - (this.sprY[i] + 8);
            }

            var t2 = this.ptTile[top + (this.vertFlip[i] ? 0 : 1)];
            // Safety check: Only render if tile exists
            if (t2) {
                t2.render(
                  this.buffer,
                  0,
                  srcy1,
                  8,
                  srcy2,
                  this.sprX[i],
                  this.sprY[i] + 1 + 8,
                  this.sprCol[i],
                  this.sprPalette,
                  this.horiFlip[i],
                  this.vertFlip[i],
                  i,
                  this.pixrendered
                );
            }
          }
        }
      }
    }
  }

  checkSprite0(scan) {
    this.spr0HitX = -1;
    this.spr0HitY = -1;

    var toffset;
    var tIndexAdd = this.f_spPatternTable === 0 ? 0 : 256;
    var x, y, t, i;
    var bufferIndex;

    x = this.sprX[0];
    y = this.sprY[0] + 1;

    if (this.f_spriteSize === 0) {
      // 8x8 sprites.

      // Check range:
      if (y <= scan && y + 8 > scan && x >= -7 && x < 256) {
        // Sprite is in range.
        // Draw scanline:
        t = this.ptTile[this.sprTile[0] + tIndexAdd];
        
        // --- SAFETY CHECK ---
        if (!t) return false;
        // --------------------

        if (this.vertFlip[0]) {
          toffset = 7 - (scan - y);
        } else {
          toffset = scan - y;
        }
        toffset *= 8;

        bufferIndex = scan * 256 + x;
        if (this.horiFlip[0]) {
          for (i = 7; i >= 0; i--) {
            if (x >= 0 && x < 256) {
              if (
                bufferIndex >= 0 &&
                bufferIndex < 61440 &&
                this.pixrendered[bufferIndex] !== 0
              ) {
                if (t.pix[toffset + i] !== 0) {
                  this.spr0HitX = bufferIndex % 256;
                  this.spr0HitY = scan;
                  return true;
                }
              }
            }
            x++;
            bufferIndex++;
          }
        } else {
          for (i = 0; i < 8; i++) {
            if (x >= 0 && x < 256) {
              if (
                bufferIndex >= 0 &&
                bufferIndex < 61440 &&
                this.pixrendered[bufferIndex] !== 0
              ) {
                if (t.pix[toffset + i] !== 0) {
                  this.spr0HitX = bufferIndex % 256;
                  this.spr0HitY = scan;
                  return true;
                }
              }
            }
            x++;
            bufferIndex++;
          }
        }
      }
    } else {
      // 8x16 sprites:

      // Check range:
      if (y <= scan && y + 16 > scan && x >= -7 && x < 256) {
        // Sprite is in range.
        // Draw scanline:

        if (this.vertFlip[0]) {
          toffset = 15 - (scan - y);
        } else {
          toffset = scan - y;
        }

        if (toffset < 8) {
          // first half of sprite.
          t = this.ptTile[
            this.sprTile[0] +
              (this.vertFlip[0] ? 1 : 0) +
              ((this.sprTile[0] & 1) !== 0 ? 255 : 0)
          ];
        } else {
          // second half of sprite.
          t = this.ptTile[
            this.sprTile[0] +
              (this.vertFlip[0] ? 0 : 1) +
              ((this.sprTile[0] & 1) !== 0 ? 255 : 0)
          ];
          if (this.vertFlip[0]) {
            toffset = 15 - toffset;
          } else {
            toffset -= 8;
          }
        }
        
        // --- SAFETY CHECK ---
        if (!t) return false;
        // --------------------
        
        toffset *= 8;

        bufferIndex = scan * 256 + x;
        if (this.horiFlip[0]) {
          for (i = 7; i >= 0; i--) {
            if (x >= 0 && x < 256) {
              if (
                bufferIndex >= 0 &&
                bufferIndex < 61440 &&
                this.pixrendered[bufferIndex] !== 0
              ) {
                if (t.pix[toffset + i] !== 0) {
                  this.spr0HitX = bufferIndex % 256;
                  this.spr0HitY = scan;
                  return true;
                }
              }
            }
            x++;
            bufferIndex++;
          }
        } else {
          for (i = 0; i < 8; i++) {
            if (x >= 0 && x < 256) {
              if (
                bufferIndex >= 0 &&
                bufferIndex < 61440 &&
                this.pixrendered[bufferIndex] !== 0
              ) {
                if (t.pix[toffset + i] !== 0) {
                  this.spr0HitX = bufferIndex % 256;
                  this.spr0HitY = scan;
                  return true;
                }
              }
            }
            x++;
            bufferIndex++;
          }
        }
      }
    }

    return false;
  }

  _checkSpriteHitLoop(scan, x, t, toffset) {
      let bufferIndex = scan * 256 + x;
      if (this.horiFlip[0]) {
          for (let i = 7; i >= 0; i--) {
              if (x >= 0 && x < 256 && bufferIndex >= 0 && bufferIndex < 61440 && this.pixrendered[bufferIndex] !== 0) {
                  if (t.pix[toffset + i] !== 0) {
                      this.spr0HitX = bufferIndex % 256;
                      this.spr0HitY = scan;
                      return;
                  }
              }
              x++; bufferIndex++;
          }
      } else {
          for (let i = 0; i < 8; i++) {
              if (x >= 0 && x < 256 && bufferIndex >= 0 && bufferIndex < 61440 && this.pixrendered[bufferIndex] !== 0) {
                  if (t.pix[toffset + i] !== 0) {
                      this.spr0HitX = bufferIndex % 256;
                      this.spr0HitY = scan;
                      return;
                  }
              }
              x++; bufferIndex++;
          }
      }
  }

  writeMem(address, value) {
    this.vramMem[address] = value;
    if (address < 0x2000) {
      this.vramMem[address] = value;
      this.patternWrite(address, value);
    } else if (address >= 0x2000 && address < 0x23c0) this.nameTableWrite(this.ntable1[0], address - 0x2000, value);
    else if (address >= 0x23c0 && address < 0x2400) this.attribTableWrite(this.ntable1[0], address - 0x23c0, value);
    else if (address >= 0x2400 && address < 0x27c0) this.nameTableWrite(this.ntable1[1], address - 0x2400, value);
    else if (address >= 0x27c0 && address < 0x2800) this.attribTableWrite(this.ntable1[1], address - 0x27c0, value);
    else if (address >= 0x2800 && address < 0x2bc0) this.nameTableWrite(this.ntable1[2], address - 0x2800, value);
    else if (address >= 0x2bc0 && address < 0x2c00) this.attribTableWrite(this.ntable1[2], address - 0x2bc0, value);
    else if (address >= 0x2c00 && address < 0x2fc0) this.nameTableWrite(this.ntable1[3], address - 0x2c00, value);
    else if (address >= 0x2fc0 && address < 0x3000) this.attribTableWrite(this.ntable1[3], address - 0x2fc0, value);
    else if (address >= 0x3f00 && address < 0x3f20) this.updatePalettes();
  }

  updatePalettes() {
    for (let i = 0; i < 16; i++) {
      if (this.f_dispType === 0) this.imgPalette[i] = this.palTable.getEntry(this.vramMem[0x3f00 + i] & 63);
      else this.imgPalette[i] = this.palTable.getEntry(this.vramMem[0x3f00 + i] & 32);
    }
    for (let i = 0; i < 16; i++) {
      if (this.f_dispType === 0) this.sprPalette[i] = this.palTable.getEntry(this.vramMem[0x3f10 + i] & 63);
      else this.sprPalette[i] = this.palTable.getEntry(this.vramMem[0x3f10 + i] & 32);
    }
  }

  patternWrite(address, value) {
    const tileIndex = Math.floor(address / 16);
    const leftOver = address % 16;
    if (leftOver < 8) this.ptTile[tileIndex].setScanline(leftOver, value, this.vramMem[address + 8]);
    else this.ptTile[tileIndex].setScanline(leftOver - 8, this.vramMem[address - 8], value);
  }

  nameTableWrite(index, address, value) {
    this.nameTable[index].tile[address] = value;
    this.checkSprite0(this.scanline - 20);
  }

  attribTableWrite(index, address, value) {
    this.nameTable[index].writeAttrib(address, value);
  }

  spriteRamWriteUpdate(address, value) {
    const tIndex = Math.floor(address / 4);
    if (tIndex === 0) this.checkSprite0(this.scanline - 20);
    if (address % 4 === 0) this.sprY[tIndex] = value;
    else if (address % 4 === 1) this.sprTile[tIndex] = value;
    else if (address % 4 === 2) {
      this.vertFlip[tIndex] = (value & 0x80) !== 0;
      this.horiFlip[tIndex] = (value & 0x40) !== 0;
      this.bgPriority[tIndex] = (value & 0x20) !== 0;
      this.sprCol[tIndex] = (value & 3) << 2;
    } else if (address % 4 === 3) this.sprX[tIndex] = value;
  }

  doNMI() {
    this.setStatusFlag(this.STATUS_VBLANK, true);
    this.nes.cpu.requestIrq(this.nes.cpu.IRQ_NMI);
  }

  isPixelWhite(x, y) {
    this.triggerRendering();
    return this.nes.ppu.buffer[(y << 8) + x] === 0xffffff;
  }

  toJSON() {
    const state = toJSON(this);
    state.nameTable = [];
    for (let i = 0; i < this.nameTable.length; i++) state.nameTable[i] = this.nameTable[i].toJSON();
    state.ptTile = [];
    for (let i = 0; i < this.ptTile.length; i++) state.ptTile[i] = this.ptTile[i].toJSON();
    return state;
  }

  fromJSON(state) {
    fromJSON(this, state);
    for (let i = 0; i < this.nameTable.length; i++) this.nameTable[i].fromJSON(state.nameTable[i]);
    for (let i = 0; i < this.ptTile.length; i++) this.ptTile[i].fromJSON(state.ptTile[i]);
    for (let i = 0; i < this.spriteMem.length; i++) this.spriteRamWriteUpdate(i, this.spriteMem[i]);
  }
}

class NameTable {
  constructor(width, height, name) {
    this.width = width;
    this.height = height;
    this.name = name;
    this.tile = new Array(width * height).fill(0);
    this.attrib = new Array(width * height).fill(0);
  }

  getTileIndex(x, y) { return this.tile[y * this.width + x]; }
  getAttrib(x, y) { return this.attrib[y * this.width + x]; }
  
  writeAttrib(index, value) {
    const basex = (index % 8) * 4;
    const basey = Math.floor(index / 8) * 4;
    for (let sqy = 0; sqy < 2; sqy++) {
      for (let sqx = 0; sqx < 2; sqx++) {
        const add = (value >> (2 * (sqy * 2 + sqx))) & 3;
        for (let y = 0; y < 2; y++) {
          for (let x = 0; x < 2; x++) {
            const tx = basex + sqx * 2 + x;
            const ty = basey + sqy * 2 + y;
            this.attrib[ty * this.width + tx] = (add << 2) & 12;
          }
        }
      }
    }
  }

  toJSON() { return { tile: this.tile, attrib: this.attrib }; }
  fromJSON(s) { this.tile = s.tile; this.attrib = s.attrib; }
}

class PaletteTable {
  constructor() {
    this.curTable = new Array(64);
    this.emphTable = new Array(8);
    this.currentEmph = -1;
  }
  
  reset() { this.setEmphasis(0); }
  
  loadNTSCPalette() {
    this.curTable = [0x525252, 0xB40000, 0xA00000, 0xB1003D, 0x740069, 0x00005B, 0x00005F, 0x001840, 0x002F10, 0x084A08, 0x006700, 0x124200, 0x6D2800, 0x000000, 0x000000, 0x000000, 0xC4D5E7, 0xFF4000, 0xDC0E22, 0xFF476B, 0xD7009F, 0x680AD7, 0x0019BC, 0x0054B1, 0x006A5B, 0x008C03, 0x00AB00, 0x2C8800, 0xA47200, 0x000000, 0x000000, 0x000000, 0xF8F8F8, 0xFFAB3C, 0xFF7981, 0xFF5BC5, 0xFF48F2, 0xDF49FF, 0x476DFF, 0x00B4F7, 0x00E0FF, 0x00E375, 0x03F42B, 0x78B82E, 0xE5E218, 0x787878, 0x000000, 0x000000, 0xFFFFFF, 0xFFF2BE, 0xF8B8B8, 0xF8B8D8, 0xFFB6FF, 0xFFC3FF, 0xC7D1FF, 0x9ADAFF, 0x88EDF8, 0x83FFDD, 0xB8F8B8, 0xF5F8AC, 0xFFFFB0, 0xF8D8F8, 0x000000, 0x000000];
    this.makeTables();
    this.setEmphasis(0);
  }

  makeTables() {
    let r, g, b, col, rFactor, gFactor, bFactor;
    for (let emph = 0; emph < 8; emph++) {
      rFactor = 1.0; gFactor = 1.0; bFactor = 1.0;
      if ((emph & 1) !== 0) { rFactor = 0.75; bFactor = 0.75; }
      if ((emph & 2) !== 0) { rFactor = 0.75; gFactor = 0.75; }
      if ((emph & 4) !== 0) { gFactor = 0.75; bFactor = 0.75; }
      this.emphTable[emph] = new Array(64);
      for (let i = 0; i < 64; i++) {
        col = this.curTable[i];
        r = Math.floor(this.getRed(col) * rFactor);
        g = Math.floor(this.getGreen(col) * gFactor);
        b = Math.floor(this.getBlue(col) * bFactor);
        this.emphTable[emph][i] = this.getRgb(r, g, b);
      }
    }
  }

  setEmphasis(emph) {
    if (emph !== this.currentEmph) {
      this.currentEmph = emph;
      for (let i = 0; i < 64; i++) this.curTable[i] = this.emphTable[emph][i];
    }
  }

  getEntry(yiq) { return this.curTable[yiq]; }
  getRed(rgb) { return (rgb >> 16) & 0xff; }
  getGreen(rgb) { return (rgb >> 8) & 0xff; }
  getBlue(rgb) { return rgb & 0xff; }
  getRgb(r, g, b) { return (r << 16) | (g << 8) | b; }
}
