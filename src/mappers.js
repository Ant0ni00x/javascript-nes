import { copyArrayElements } from "./utils.js";

/**
 * Base Mapper (Mapper 0 / NROM)
 */
export class Mapper {
  constructor(nes) {
    this.nes = nes;
    // Flag for mappers that need extra tile fetches (MMC2, MMC4)
    this.hasLatch = false;
  }

  reset() {
    this.joy1StrobeState = 0;
    this.joy2StrobeState = 0;
    this.joypadLastWrite = 0;
    this.zapperFired = false;
    this.zapperX = null;
    this.zapperY = null;
  }

  write(address, value) {
    if (address < 0x2000) {
      this.nes.cpu.mem[address & 0x7ff] = value;
    } else if (address > 0x4017) {
      this.nes.cpu.mem[address] = value;
      if (address >= 0x6000 && address < 0x8000) {
        this.nes.opts.onBatteryRamWrite(address, value);
      }
    } else if (address > 0x2007 && address < 0x4000) {
      this.regWrite(0x2000 + (address & 0x7), value);
    } else {
      this.regWrite(address, value);
    }
  }

  writelow(address, value) {
    if (address < 0x2000) {
      this.nes.cpu.mem[address & 0x7ff] = value;
    } else if (address > 0x4017) {
      this.nes.cpu.mem[address] = value;
    } else if (address > 0x2007 && address < 0x4000) {
      this.regWrite(0x2000 + (address & 0x7), value);
    } else {
      this.regWrite(address, value);
    }
  }

  load(address) {
    address &= 0xffff;
    if (address > 0x4017) {
      return this.nes.cpu.mem[address];
    } else if (address >= 0x2000) {
      return this.regLoad(address);
    } else {
      return this.nes.cpu.mem[address & 0x7ff];
    }
  }

  regLoad(address) {
    switch (address >> 12) {
      case 0:
      case 1:
        break;
      case 2:
      case 3:
        switch (address & 0x7) {
          case 0x0: return this.nes.cpu.mem[0x2000];
          case 0x1: return this.nes.cpu.mem[0x2001];
          case 0x2: return this.nes.ppu.readStatusRegister();
          case 0x3: return 0;
          case 0x4: return this.nes.ppu.sramLoad();
          case 0x5: return 0;
          case 0x6: return 0;
          case 0x7: return this.nes.ppu.vramLoad();
        }
        break;
      case 4:
        switch (address - 0x4015) {
          case 0: return this.nes.papu.readReg(address);
          case 1: return this.joy1Read();
          case 2:
            let w;
            if (this.zapperX !== null && this.zapperY !== null && this.nes.ppu.isPixelWhite(this.zapperX, this.zapperY)) {
              w = 0;
            } else {
              w = 0x1 << 3;
            }
            if (this.zapperFired) w |= 0x1 << 4;
            return (this.joy2Read() | w) & 0xffff;
        }
        break;
    }
    return 0;
  }

  regWrite(address, value) {
    switch (address) {
      case 0x2000: this.nes.cpu.mem[address] = value; this.nes.ppu.updateControlReg1(value); break;
      case 0x2001: this.nes.cpu.mem[address] = value; this.nes.ppu.updateControlReg2(value); break;
      case 0x2003: this.nes.ppu.writeSRAMAddress(value); break;
      case 0x2004: this.nes.ppu.sramWrite(value); break;
      case 0x2005: this.nes.ppu.scrollWrite(value); break;
      case 0x2006: this.nes.ppu.writeVRAMAddress(value); break;
      case 0x2007: this.nes.ppu.vramWrite(value); break;
      case 0x4014: this.nes.ppu.sramDMA(value); break;
      case 0x4015: this.nes.papu.writeReg(address, value); break;
      case 0x4016:
        if ((value & 1) === 0 && (this.joypadLastWrite & 1) === 1) {
          this.joy1StrobeState = 0;
          this.joy2StrobeState = 0;
        }
        this.joypadLastWrite = value;
        break;
      case 0x4017: this.nes.papu.writeReg(address, value); break;
      default:
        if (address >= 0x4000 && address <= 0x4017) {
          this.nes.papu.writeReg(address, value);
        }
    }
  }

  joy1Read() {
    let ret;
    switch (this.joy1StrobeState) {
      case 0: case 1: case 2: case 3: case 4: case 5: case 6: case 7:
        ret = this.nes.controllers[1].state[this.joy1StrobeState]; break;
      case 19: ret = 1; break;
      default: ret = 0; break;
    }
    this.joy1StrobeState++;
    if (this.joy1StrobeState === 24) this.joy1StrobeState = 0;
    return ret;
  }

  joy2Read() {
    let ret;
    switch (this.joy2StrobeState) {
      case 0: case 1: case 2: case 3: case 4: case 5: case 6: case 7:
        ret = this.nes.controllers[2].state[this.joy2StrobeState]; break;
      case 19: ret = 1; break;
      default: ret = 0; break;
    }
    this.joy2StrobeState++;
    if (this.joy2StrobeState === 24) this.joy2StrobeState = 0;
    return ret;
  }

  loadROM() {
    if (!this.nes.rom.valid || this.nes.rom.romCount < 1) {
      throw new Error("NoMapper: Invalid ROM! Unable to load.");
    }
    this.loadPRGROM();
    this.loadCHRROM();
    this.loadBatteryRam();
    this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);
  }

  loadPRGROM() {
    if (this.nes.rom.romCount > 1) {
      this.loadRomBank(0, 0x8000);
      this.loadRomBank(1, 0xc000);
    } else {
      this.loadRomBank(0, 0x8000);
      this.loadRomBank(0, 0xc000);
    }
  }

  loadCHRROM() {
    if (this.nes.rom.vromCount > 0) {
      if (this.nes.rom.vromCount === 1) {
        this.loadVromBank(0, 0x0000);
        this.loadVromBank(0, 0x1000);
      } else {
        this.loadVromBank(0, 0x0000);
        this.loadVromBank(1, 0x1000);
      }
    }
  }

  loadBatteryRam() {
    if (this.nes.rom.batteryRam) {
      const ram = this.nes.rom.batteryRam;
      if (ram !== null && ram.length === 0x2000) {
        copyArrayElements(ram, 0, this.nes.cpu.mem, 0x6000, 0x2000);
      }
    }
  }

  loadRomBank(bank, address) {
    bank %= this.nes.rom.romCount;
    copyArrayElements(this.nes.rom.rom[bank], 0, this.nes.cpu.mem, address, 16384);
  }

  loadVromBank(bank, address) {
    if (this.nes.rom.vromCount === 0) return;
    this.nes.ppu.triggerRendering();
    copyArrayElements(this.nes.rom.vrom[bank % this.nes.rom.vromCount], 0, this.nes.ppu.vramMem, address, 4096);
    const vromTile = this.nes.rom.vromTile[bank % this.nes.rom.vromCount];
    copyArrayElements(vromTile, 0, this.nes.ppu.ptTile, address >> 4, 256);
  }

  load32kRomBank(bank, address) {
    this.loadRomBank((bank * 2) % this.nes.rom.romCount, address);
    this.loadRomBank((bank * 2 + 1) % this.nes.rom.romCount, address + 16384);
  }

  load8kVromBank(bank4kStart, address) {
    if (this.nes.rom.vromCount === 0) return;
    this.nes.ppu.triggerRendering();
    this.loadVromBank(bank4kStart % this.nes.rom.vromCount, address);
    this.loadVromBank((bank4kStart + 1) % this.nes.rom.vromCount, address + 4096);
  }

  load1kVromBank(bank1k, address) {
    if (this.nes.rom.vromCount === 0) return;
    this.nes.ppu.triggerRendering();
    const bank4k = Math.floor(bank1k / 4) % this.nes.rom.vromCount;
    const bankoffset = (bank1k % 4) * 1024;
    copyArrayElements(this.nes.rom.vrom[bank4k], bankoffset, this.nes.ppu.vramMem, address, 1024);
    const vromTile = this.nes.rom.vromTile[bank4k];
    const baseIndex = address >> 4;
    for (let i = 0; i < 64; i++) {
      this.nes.ppu.ptTile[baseIndex + i] = vromTile[(bank1k % 4 << 6) + i];
    }
  }

  load2kVromBank(bank2k, address) {
    if (this.nes.rom.vromCount === 0) return;
    this.nes.ppu.triggerRendering();
    const bank4k = Math.floor(bank2k / 2) % this.nes.rom.vromCount;
    const bankoffset = (bank2k % 2) * 2048;
    copyArrayElements(this.nes.rom.vrom[bank4k], bankoffset, this.nes.ppu.vramMem, address, 2048);
    const vromTile = this.nes.rom.vromTile[bank4k];
    const baseIndex = address >> 4;
    for (let i = 0; i < 128; i++) {
      this.nes.ppu.ptTile[baseIndex + i] = vromTile[(bank2k % 2 << 7) + i];
    }
  }

  load8kRomBank(bank8k, address) {
    const bank16k = Math.floor(bank8k / 2) % this.nes.rom.romCount;
    const offset = (bank8k % 2) * 8192;
    copyArrayElements(this.nes.rom.rom[bank16k], offset, this.nes.cpu.mem, address, 8192);
  }

  clockIrqCounter() {}
  latchAccess(address) {}

  toJSON() {
    return {
      joy1StrobeState: this.joy1StrobeState,
      joy2StrobeState: this.joy2StrobeState,
      joypadLastWrite: this.joypadLastWrite,
    };
  }

  fromJSON(s) {
    this.joy1StrobeState = s.joy1StrobeState;
    this.joy2StrobeState = s.joy2StrobeState;
    this.joypadLastWrite = s.joypadLastWrite;
  }
}

/**
 * Mapper 1 (MMC1)
 */
// ============================================================
// MAPPER 1 (MMC1) - Hardware Accurate Implementation
// ============================================================
class Mapper1 extends Mapper {
  constructor(nes) {
    super(nes);
    this.shiftReg = 0x10;
    this.controlReg = 0x0C; // Default to Mode 3 (Fix Last, Swap 8000)
    this.chrBank0 = 0;
    this.chrBank1 = 0;
    this.prgBank = 0;
    this.lastWriteCycle = 0;
  }

  reset() {
    super.reset();
    this.shiftReg = 0x10;
    this.controlReg = 0x0C; // Mode 3
    this.chrBank0 = 0;
    this.chrBank1 = 0;
    this.prgBank = 0;
    this.lastWriteCycle = 0;
    
    // Initial Load based on default state
    this.updatePrgBanks();
    this.updateChrBanks();
  }

  write(address, value) {
    if (address < 0x8000) {
      super.write(address, value);
      return;
    }

    // Ignore writes on consecutive cycles (Hardware behavior)
    // We assume this.nes.cpu.cycles exists. If not, this check is skipped.
    const currentCycle = this.nes.cpu.cycles || 0;
    if (currentCycle > 0 && (currentCycle - this.lastWriteCycle) <= 1) {
       // Note: Consecutive cycle writes ignore data, but reset (0x80) might still work 
       // on some revisions. For standard MMC1, usually the whole write is ignored.
       // We'll trust FCEUX behavior and ignore it.
       return;
    }
    this.lastWriteCycle = currentCycle;

    // Reset (Bit 7 set)
    if ((value & 0x80) !== 0) {
      this.shiftReg = 0x10;
      this.controlReg |= 0x0C; // Set PRG Mode 3 (Fix Last)
      this.updatePrgBanks();
      return;
    }

    // Serial Write (LSB first)
    const bit = value & 1;
    const full = (this.shiftReg & 1) !== 0; // Check if the "marker" bit has reached position 0
    
    // Shift right
    this.shiftReg = (this.shiftReg >> 1) | (bit << 4);

    if (full) {
      const regValue = this.shiftReg;
      const regType = (address >> 13) & 3; // 0=Control, 1=CHR0, 2=CHR1, 3=PRG

      this.shiftReg = 0x10; // Reset shift register

      switch (regType) {
        case 0: // Control ($8000-$9FFF)
          this.controlReg = regValue;
          this.updateMirroring();
          this.updateChrBanks();
          this.updatePrgBanks();
          break;
        
        case 1: // CHR Bank 0 ($A000-$BFFF)
          this.chrBank0 = regValue;
          this.updateChrBanks();
          break;
        
        case 2: // CHR Bank 1 ($C000-$DFFF)
          this.chrBank1 = regValue;
          this.updateChrBanks();
          break;
        
        case 3: // PRG Bank ($E000-$FFFF)
          this.prgBank = regValue;
          this.updatePrgBanks();
          break;
      }
    }
  }

  updateMirroring() {
    const mirrorMode = this.controlReg & 3;
    switch (mirrorMode) {
      case 0: this.nes.ppu.setMirroring(this.nes.rom.SINGLESCREEN_MIRRORING); break;
      case 1: this.nes.ppu.setMirroring(this.nes.rom.SINGLESCREEN_MIRRORING2); break;
      case 2: this.nes.ppu.setMirroring(this.nes.rom.VERTICAL_MIRRORING); break;
      case 3: this.nes.ppu.setMirroring(this.nes.rom.HORIZONTAL_MIRRORING); break;
    }
  }

  updatePrgBanks() {
    const prgMode = (this.controlReg >> 2) & 3;
    const bank = this.prgBank & 0x0F;
    const romCount = this.nes.rom.romCount;
    
    // Support for 256KB/512KB ROMs (e.g. Dragon Warrior 4 uses bit 4 of PRG bank)
    // 256KB = 16 x 16KB banks. 512KB = 32 x 16KB banks.
    // The "bank" variable is 4 bits (0-15).
    // Some MMC1 boards use CHR bits to switch high PRG bits (SUROM/SOROM).
    // For standard MMC1 (128KB/256KB), we typically mask appropriately in load functions.

    switch (prgMode) {
      case 0: 
      case 1: // 32KB Mode (switch $8000, ignore LSB)
        // Bit 0 of bank is ignored in 32K mode
        this.load32kRomBank(bank >> 1, 0x8000);
        break;
        
      case 2: // Fix First Bank ($8000 fixed to 0), Switch Last ($C000)
        this.loadRomBank(0, 0x8000);
        this.loadRomBank(bank, 0xC000);
        break;
        
      case 3: // Fix Last Bank ($C000 fixed to last), Switch First ($8000)
        this.loadRomBank(bank, 0x8000);
        this.loadRomBank(romCount - 1, 0xC000);
        break;
    }
  }

  updateChrBanks() {
    const chrMode = (this.controlReg >> 4) & 1;
    const vromCount = this.nes.rom.vromCount;
    
    if (vromCount === 0) return; // CHR RAM not fully handled here, but loadVromBank exits safe

    if (chrMode === 0) {
      // 8KB Mode (Switch 8KB at $0000, ignore LSB of chrBank0)
      this.load8kVromBank(this.chrBank0 & 0x1E, 0x0000);
    } else {
      // 4KB Mode (Switch 4KB at $0000 via chrBank0, 4KB at $1000 via chrBank1)
      this.loadVromBank(this.chrBank0, 0x0000);
      this.loadVromBank(this.chrBank1, 0x1000);
    }
  }

  loadROM() {
    if (!this.nes.rom.valid) throw new Error("MMC1: Invalid ROM!");
    this.reset(); // Sets default state (Mode 3)
    this.loadCHRROM();
    this.loadBatteryRam();
    this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);
  }

  toJSON() {
    const s = super.toJSON();
    s.shiftReg = this.shiftReg;
    s.controlReg = this.controlReg;
    s.chrBank0 = this.chrBank0;
    s.chrBank1 = this.chrBank1;
    s.prgBank = this.prgBank;
    return s;
  }

  fromJSON(s) {
    super.fromJSON(s);
    this.shiftReg = s.shiftReg;
    this.controlReg = s.controlReg;
    this.chrBank0 = s.chrBank0;
    this.chrBank1 = s.chrBank1;
    this.prgBank = s.prgBank;
  }
}

/**
 * Mapper 2 (UNROM)
 */
class Mapper2 extends Mapper {
  constructor(nes) {
    super(nes);
  }
  write(address, value) {
    if (address < 0x8000) super.write(address, value);
    else this.loadRomBank(value, 0x8000);
  }
  loadROM() {
    if (!this.nes.rom.valid) throw new Error("UNROM: Invalid ROM! Unable to load.");
    this.loadRomBank(0, 0x8000);
    this.loadRomBank(this.nes.rom.romCount - 1, 0xc000);
    this.loadCHRROM();
    this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);
  }
}

/**
 * Mapper 3 (CNROM)
 */
class Mapper3 extends Mapper {
  constructor(nes) {
    super(nes);
  }
  write(address, value) {
    if (address < 0x8000) super.write(address, value);
    else {
      const bank = (value % (this.nes.rom.vromCount / 2)) * 2;
      this.loadVromBank(bank, 0x0000);
      this.loadVromBank(bank + 1, 0x1000);
    }
  }
}

/**
 * Mapper 4 (MMC3)
 */
class Mapper4 extends Mapper {
  constructor(nes) {
    super(nes);
    this.CMD_SEL_2_1K_VROM_0000 = 0;
    this.CMD_SEL_2_1K_VROM_0800 = 1;
    this.CMD_SEL_1K_VROM_1000 = 2;
    this.CMD_SEL_1K_VROM_1400 = 3;
    this.CMD_SEL_1K_VROM_1800 = 4;
    this.CMD_SEL_1K_VROM_1C00 = 5;
    this.CMD_SEL_ROM_PAGE1 = 6;
    this.CMD_SEL_ROM_PAGE2 = 7;
    this.command = 0;
    this.prgAddressSelect = 0;
    this.chrAddressSelect = 0;
    this.pageNumber = 0;
    this.irqCounter = 0;
    this.irqLatchValue = 0;
    this.irqEnable = 0;
    this.irqReloadPending = false;
    this.prgAddressChanged = false;
    this.ppuA12Prev = 0;
    this.lastA12Cycle = 0;
    this.lastClockScanline = -1;
  }

  reset() {
    super.reset();
    this.command = 0;
    this.prgAddressSelect = 0;
    this.chrAddressSelect = 0;
    this.pageNumber = 0;
    this.irqCounter = 0;
    this.irqLatchValue = 0;
    this.irqEnable = 0;
    this.irqReloadPending = false;
    this.prgAddressChanged = false;
    this.ppuA12Prev = 0;
    this.lastA12Cycle = 0;
    this.lastClockScanline = -1;
  }

  write(address, value) {
    if (address < 0x8000) {
      super.write(address, value);
      return;
    }
    switch (address & 0xE001) {
      case 0x8000:
        this.command = value & 7;
        const tmp = (value >> 6) & 1;
        if (tmp !== this.prgAddressSelect) this.prgAddressChanged = true;
        this.prgAddressSelect = tmp;
        this.chrAddressSelect = (value >> 7) & 1;
        break;
      case 0x8001:
        this.executeCommand(this.command, value);
        break;
      case 0xA000:
        if ((value & 1) !== 0) {
          this.nes.ppu.setMirroring(this.nes.rom.HORIZONTAL_MIRRORING);
        } else {
          this.nes.ppu.setMirroring(this.nes.rom.VERTICAL_MIRRORING);
        }
        break;
      case 0xA001: break;
      case 0xC000:
        this.irqLatchValue = value;
        break;
      case 0xC001:
        this.irqCounter = 0; // FCEUX/Hardware behavior: clear counter immediately
        this.irqReloadPending = true;
        break;
      case 0xE000:
        this.irqEnable = 0;
        this.nes.cpu.irqRequested = false;
        break;
      case 0xE001:
        this.irqEnable = 1;
        break;
    }
  }

  executeCommand(cmd, arg) {
    const chrSel = this.chrAddressSelect;
    switch (cmd) {
      case this.CMD_SEL_2_1K_VROM_0000:
        if (chrSel === 0) {
          this.load1kVromBank(arg, 0x0000);
          this.load1kVromBank(arg + 1, 0x0400);
        } else {
          this.load1kVromBank(arg, 0x1000);
          this.load1kVromBank(arg + 1, 0x1400);
        }
        break;
      case this.CMD_SEL_2_1K_VROM_0800:
        if (chrSel === 0) {
          this.load1kVromBank(arg, 0x0800);
          this.load1kVromBank(arg + 1, 0x0c00);
        } else {
          this.load1kVromBank(arg, 0x1800);
          this.load1kVromBank(arg + 1, 0x1c00);
        }
        break;
      case this.CMD_SEL_1K_VROM_1000:
        this.load1kVromBank(arg, chrSel === 0 ? 0x1000 : 0x0000);
        break;
      case this.CMD_SEL_1K_VROM_1400:
        this.load1kVromBank(arg, chrSel === 0 ? 0x1400 : 0x0400);
        break;
      case this.CMD_SEL_1K_VROM_1800:
        this.load1kVromBank(arg, chrSel === 0 ? 0x1800 : 0x0800);
        break;
      case this.CMD_SEL_1K_VROM_1C00:
        this.load1kVromBank(arg, chrSel === 0 ? 0x1c00 : 0x0c00);
        break;
      case this.CMD_SEL_ROM_PAGE1:
        if (this.prgAddressChanged) {
          this.prgAddressChanged = false;
          const lastBank = (this.nes.rom.romCount - 1) << 1;
          if (this.prgAddressSelect === 0) {
            this.load8kRomBank(lastBank, 0xC000);
          } else {
            this.load8kRomBank(lastBank, 0x8000);
          }
        }
        if (this.prgAddressSelect === 0) {
          this.load8kRomBank(arg, 0x8000);
        } else {
          this.load8kRomBank(arg, 0xC000);
        }
        break;
      case this.CMD_SEL_ROM_PAGE2:
        this.load8kRomBank(arg, 0xA000);
        break;
    }
  }

  loadROM() {
    if (!this.nes.rom.valid) throw new Error("MMC3: Invalid ROM!");
    const lastBank = (this.nes.rom.romCount - 1) << 1;
    this.prgAddressSelect = 0;
    this.load8kRomBank(lastBank + 1, 0xE000);
    this.load8kRomBank(lastBank, 0xC000);
    this.load8kRomBank(0, 0x8000);
    this.load8kRomBank(1, 0xA000);
    this.loadCHRROM();
    this.loadBatteryRam();
    this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);
  }

  clockIrqCounter() {
    // 1. If counter is 0 or reload is pending, reload
    if (this.irqCounter === 0 || this.irqReloadPending) {
      this.irqCounter = this.irqLatchValue;
      this.irqReloadPending = false;
    } else {
      // 2. Otherwise decrement
      this.irqCounter--;
      // 3. Trigger IRQ if we transitioned to 0
      if (this.irqCounter === 0 && this.irqEnable) {
        this.nes.cpu.requestIrq(this.nes.cpu.IRQ_NORMAL);
      }
    }
  }

  notifyA12(value) {
    // A12 rising edge detection (0 -> 1)
    if (value === 1 && this.ppuA12Prev === 0) {
      const ppu = this.nes.ppu;
      const isRendering = ppu.f_bgVisibility === 1 || ppu.f_spVisibility === 1;

      if (isRendering) {
        const currentScanline = ppu.scanline;
        if (this.lastClockScanline !== currentScanline) {
          this.clockIrqCounter();
          this.lastClockScanline = currentScanline;
        }
      }
    }
    this.ppuA12Prev = value;
  }

  toJSON() {
    const s = super.toJSON();
    s.command = this.command;
    s.prgAddressSelect = this.prgAddressSelect;
    s.chrAddressSelect = this.chrAddressSelect;
    s.pageNumber = this.pageNumber;
    s.irqCounter = this.irqCounter;
    s.irqLatchValue = this.irqLatchValue;
    s.irqEnable = this.irqEnable;
    s.prgAddressChanged = this.prgAddressChanged;
    return s;
  }

  fromJSON(s) {
    super.fromJSON(s);
    this.command = s.command;
    this.prgAddressSelect = s.prgAddressSelect;
    this.chrAddressSelect = s.chrAddressSelect;
    this.pageNumber = s.pageNumber;
    this.irqCounter = s.irqCounter;
    this.irqLatchValue = s.irqLatchValue;
    this.irqEnable = s.irqEnable;
    this.prgAddressChanged = s.prgAddressChanged;
  }
}

/**
 * Mapper 5 (MMC5) - Partial
 */
class Mapper5 extends Mapper {
  constructor(nes) {
    super(nes);
  }
  // (Simplified for brevity, assuming existing logic)
  write(address, value) {
     if (address < 0x8000) super.write(address, value);
     else this.load8kVromBank(value, 0x0000);
  }
  loadROM() {
    if (!this.nes.rom.valid) throw new Error("MMC5: Invalid ROM! Unable to load.");
    this.load8kRomBank(this.nes.rom.romCount * 2 - 1, 0x8000);
    this.load8kRomBank(this.nes.rom.romCount * 2 - 1, 0xa000);
    this.load8kRomBank(this.nes.rom.romCount * 2 - 1, 0xc000);
    this.load8kRomBank(this.nes.rom.romCount * 2 - 1, 0xe000);
    this.loadCHRROM();
    this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);
  }
}

/**
 * Mapper 7 (AxROM)
 */
class Mapper7 extends Mapper {
  constructor(nes) {
    super(nes);
  }
  write(address, value) {
    if (address < 0x8000) super.write(address, value);
    else {
      this.load32kRomBank(value & 0x7, 0x8000);
      if (value & 0x10) this.nes.ppu.setMirroring(this.nes.rom.SINGLESCREEN_MIRRORING2);
      else this.nes.ppu.setMirroring(this.nes.rom.SINGLESCREEN_MIRRORING);
    }
  }
  loadROM() {
    if (!this.nes.rom.valid) throw new Error("AOROM: Invalid ROM! Unable to load.");
    this.loadPRGROM();
    this.loadCHRROM();
    this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);
  }
}

/**
 * Mapper 9 (MMC2) - Punch-Out!!
 * 
 * Uses latches triggered by PPU pattern table reads to switch CHR banks.
 * The latch is triggered when the PPU fetches tile $FD or $FE from either
 * pattern table, allowing mid-screen graphics changes.
 */
class Mapper9 extends Mapper {
  constructor(nes) {
    super(nes);
    // Enable extra tile fetches in PPU for latch detection
    this.hasLatch = true;
    // Initialize all properties in constructor to prevent undefined access
    this.latchLo = 0;
    this.latchHi = 0;
    this.chrBank0 = 0;
    this.chrBank1 = 0;
    this.chrBank2 = 0;
    this.chrBank3 = 0;
    this.prgBank = 0;
  }

  reset() {
    super.reset();
    // Latch states: 0 = $FD, 1 = $FE
    this.latchLo = 0;  // Latch for $0000-$0FFF
    this.latchHi = 0;  // Latch for $1000-$1FFF
    // CHR bank registers
    this.chrBank0 = 0; // $B000 - used when latchLo = 0 ($FD)
    this.chrBank1 = 0; // $C000 - used when latchLo = 1 ($FE)
    this.chrBank2 = 0; // $D000 - used when latchHi = 0 ($FD)
    this.chrBank3 = 0; // $E000 - used when latchHi = 1 ($FE)
    this.prgBank = 0;
  }

  /**
   * Switch a 4KB CHR bank with bounds checking
   */
  safeSwitchBank(bank, address) {
    const rom = this.nes.rom;
    if (rom.vromCount === 0) return;

    if (bank >= rom.vromCount) {
      bank %= rom.vromCount;
    }

    // Copy VROM data
    copyArrayElements(rom.vrom[bank], 0, this.nes.ppu.vramMem, address, 4096);

    var vromTile = rom.vromTile[bank];
    if (vromTile) {
      var baseIndex = address >> 4;
      for (let i = 0; i < 256; i++) {
        this.nes.ppu.ptTile[baseIndex + i] = vromTile[i];
      }
    }

    this.nes.ppu.validTileData = false;
  }

  write(address, value) {
    if (address < 0xA000) {
      if (address < 0x8000) {
        super.write(address, value);
      }
      return;
    }

    switch (address & 0xF000) {
      case 0xA000:
        // PRG ROM bank select ($A000-$AFFF)
        this.prgBank = value & 0x0F;
        this.load8kRomBank(this.prgBank, 0x8000);
        break;

      case 0xB000:
        // CHR ROM $FD/0000 bank select ($B000-$BFFF)
        this.chrBank0 = value & 0x1F;
        if (this.latchLo === 0) {
          this.safeSwitchBank(this.chrBank0, 0x0000);
        }
        break;

      case 0xC000:
        // CHR ROM $FE/0000 bank select ($C000-$CFFF)
        this.chrBank1 = value & 0x1F;
        if (this.latchLo === 1) {
          this.safeSwitchBank(this.chrBank1, 0x0000);
        }
        break;

      case 0xD000:
        // CHR ROM $FD/1000 bank select ($D000-$DFFF)
        this.chrBank2 = value & 0x1F;
        if (this.latchHi === 0) {
          this.safeSwitchBank(this.chrBank2, 0x1000);
        }
        break;

      case 0xE000:
        // CHR ROM $FE/1000 bank select ($E000-$EFFF)
        this.chrBank3 = value & 0x1F;
        if (this.latchHi === 1) {
          this.safeSwitchBank(this.chrBank3, 0x1000);
        }
        break;

      case 0xF000:
        // Mirroring ($F000-$FFFF)
        if ((value & 1) === 0) {
          this.nes.ppu.setMirroring(this.nes.rom.VERTICAL_MIRRORING);
        } else {
          this.nes.ppu.setMirroring(this.nes.rom.HORIZONTAL_MIRRORING);
        }
        break;
    }
  }

  /**
   * Called by PPU when pattern table address is accessed.
   * Checks for magic tiles ($FD, $FE) and updates latches.
   */
  latchAccess(address) {
    var masked = address & 0x1FF0;

    // Only care about pattern table addresses ($0000-$1FFF)
    if (address >= 0x2000) return;

    // Check which pattern table (low $0000-$0FFF or high $1000-$1FFF)
    if ((address & 0x1000) === 0) {
      if (masked === 0x0FD0) {
        if (this.latchLo !== 0) {
          this.latchLo = 0;
          this.safeSwitchBank(this.chrBank0, 0x0000);
        }
      } else if (masked === 0x0FE0) {
        if (this.latchLo !== 1) {
          this.latchLo = 1;
          this.safeSwitchBank(this.chrBank1, 0x0000);
        }
      }
    }
    else {
      masked = address & 0x0FF0;
      if (masked === 0x0FD0) {
        if (this.latchHi !== 0) {
          this.latchHi = 0;
          this.safeSwitchBank(this.chrBank2, 0x1000);
        }
      } else if (masked === 0x0FE0) {
        if (this.latchHi !== 1) {
          this.latchHi = 1;
          this.safeSwitchBank(this.chrBank3, 0x1000);
        }
      }
    }
  }

  loadROM() {
    if (!this.nes.rom.valid) {
      throw new Error("MMC2: Invalid ROM! Unable to load.");
    }

    // Load PRG ROM
    // First 8KB switchable bank at $8000
    this.load8kRomBank(0, 0x8000);
    // Last three 8KB banks fixed at $A000, $C000, $E000
    const numBanks = this.nes.rom.romCount * 2;
    this.load8kRomBank(numBanks - 3, 0xA000);
    this.load8kRomBank(numBanks - 2, 0xC000);
    this.load8kRomBank(numBanks - 1, 0xE000);

    // Initialize latches to 0 ($FD state)
    this.latchLo = 0;
    this.latchHi = 0;

    // Load initial CHR banks based on latch state
    this.safeSwitchBank(this.chrBank0, 0x0000);
    this.safeSwitchBank(this.chrBank2, 0x1000);

    // Set initial mirroring
    this.nes.ppu.setMirroring(this.nes.rom.VERTICAL_MIRRORING);
    this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);
  }

  toJSON() {
    const s = super.toJSON();
    s.latchLo = this.latchLo;
    s.latchHi = this.latchHi;
    s.chrBank0 = this.chrBank0;
    s.chrBank1 = this.chrBank1;
    s.chrBank2 = this.chrBank2;
    s.chrBank3 = this.chrBank3;
    s.prgBank = this.prgBank;
    return s;
  }

  fromJSON(s) {
    super.fromJSON(s);
    this.latchLo = s.latchLo;
    this.latchHi = s.latchHi;
    this.chrBank0 = s.chrBank0;
    this.chrBank1 = s.chrBank1;
    this.chrBank2 = s.chrBank2;
    this.chrBank3 = s.chrBank3;
    this.prgBank = s.prgBank;
  }
}

/**
 * Mapper 10 (MMC4) - Fire Emblem, Famicom Wars
 * 
 * Similar to MMC2 but with 16KB PRG switching instead of 8KB.
 */
class Mapper10 extends Mapper {
  constructor(nes) {
    super(nes);
    this.hasLatch = true;
    // Initialize all properties in constructor
    this.latchLo = 0;
    this.latchHi = 0;
    this.chrBank0 = 0;
    this.chrBank1 = 0;
    this.chrBank2 = 0;
    this.chrBank3 = 0;
    this.prgBank = 0;
  }

  reset() {
    super.reset();
    this.latchLo = 0;
    this.latchHi = 0;
    this.chrBank0 = 0;
    this.chrBank1 = 0;
    this.chrBank2 = 0;
    this.chrBank3 = 0;
    this.prgBank = 0;
  }

  write(address, value) {
    if (address < 0x8000) {
      super.write(address, value);
      return;
    }

    switch (address & 0xF000) {
      case 0xA000:
        // PRG ROM bank select - 16KB at $8000
        this.prgBank = value & 0x0F;
        this.loadRomBank(this.prgBank, 0x8000);
        break;

      case 0xB000:
        this.chrBank0 = value & 0x1F;
        if (this.latchLo === 0) {
          this.safeSwitchBank(this.chrBank0, 0x0000);
        }
        break;

      case 0xC000:
        this.chrBank1 = value & 0x1F;
        if (this.latchLo === 1) {
          this.safeSwitchBank(this.chrBank1, 0x0000);
        }
        break;

      case 0xD000:
        this.chrBank2 = value & 0x1F;
        if (this.latchHi === 0) {
          this.safeSwitchBank(this.chrBank2, 0x1000);
        }
        break;

      case 0xE000:
        this.chrBank3 = value & 0x1F;
        if (this.latchHi === 1) {
          this.safeSwitchBank(this.chrBank3, 0x1000);
        }
        break;

      case 0xF000:
        if ((value & 1) === 0) {
          this.nes.ppu.setMirroring(this.nes.rom.VERTICAL_MIRRORING);
        } else {
          this.nes.ppu.setMirroring(this.nes.rom.HORIZONTAL_MIRRORING);
        }
        break;
    }
  }

  latchAccess(address) {
    if (address >= 0x2000) return;

    if ((address & 0x1000) === 0) {
      const masked = address & 0x0FF0;
      if (masked === 0x0FD0) {
        if (this.latchLo !== 0) {
          this.latchLo = 0;
          this.safeSwitchBank(this.chrBank0, 0x0000);
        }
      } else if (masked === 0x0FE0) {
        if (this.latchLo !== 1) {
          this.latchLo = 1;
          this.safeSwitchBank(this.chrBank1, 0x0000);
        }
      }
    } else {
      const masked = address & 0x0FF0;
      if (masked === 0x0FD0) {
        if (this.latchHi !== 0) {
          this.latchHi = 0;
          this.safeSwitchBank(this.chrBank2, 0x1000);
        }
      } else if (masked === 0x0FE0) {
        if (this.latchHi !== 1) {
          this.latchHi = 1;
          this.safeSwitchBank(this.chrBank3, 0x1000);
        }
      }
    }
  }

  safeSwitchBank(bank, address) {
    const rom = this.nes.rom;
    if (!rom || rom.vromCount === 0 || !rom.vrom) return;

    // Ensure bank is a valid number
    if (typeof bank !== 'number' || isNaN(bank)) {
      bank = 0;
    }

    if (bank >= rom.vromCount) {
      bank %= rom.vromCount;
    }

    // Safety check
    if (!rom.vrom[bank]) return;

    copyArrayElements(rom.vrom[bank], 0, this.nes.ppu.vramMem, address, 4096);

    const vromTile = rom.vromTile[bank];
    if (vromTile) {
      const baseIndex = address >> 4;
      for (let i = 0; i < 256; i++) {
        this.nes.ppu.ptTile[baseIndex + i] = vromTile[i];
      }
    }

    this.nes.ppu.validTileData = false;
  }

  loadROM() {
    if (!this.nes.rom.valid) {
      throw new Error("MMC4: Invalid ROM! Unable to load.");
    }

    // 16KB switchable at $8000, 16KB fixed at $C000
    this.loadRomBank(0, 0x8000);
    this.loadRomBank(this.nes.rom.romCount - 1, 0xC000);

    this.latchLo = 0;
    this.latchHi = 0;

    this.safeSwitchBank(this.chrBank0, 0x0000);
    this.safeSwitchBank(this.chrBank2, 0x1000);

    this.nes.ppu.setMirroring(this.nes.rom.VERTICAL_MIRRORING);
    this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);
  }

  toJSON() {
    const s = super.toJSON();
    s.latchLo = this.latchLo;
    s.latchHi = this.latchHi;
    s.chrBank0 = this.chrBank0;
    s.chrBank1 = this.chrBank1;
    s.chrBank2 = this.chrBank2;
    s.chrBank3 = this.chrBank3;
    s.prgBank = this.prgBank;
    return s;
  }

  fromJSON(s) {
    super.fromJSON(s);
    this.latchLo = s.latchLo;
    this.latchHi = s.latchHi;
    this.chrBank0 = s.chrBank0;
    this.chrBank1 = s.chrBank1;
    this.chrBank2 = s.chrBank2;
    this.chrBank3 = s.chrBank3;
    this.prgBank = s.prgBank;
  }
}

/**
 * Mapper 11 (Color Dreams)
 */
class Mapper11 extends Mapper {
  constructor(nes) {
    super(nes);
  }
  write(address, value) {
    if (address < 0x8000) super.write(address, value);
    else {
      const prgbank1 = ((value & 0xf) * 2) % this.nes.rom.romCount;
      const prgbank2 = ((value & 0xf) * 2 + 1) % this.nes.rom.romCount;
      this.loadRomBank(prgbank1, 0x8000);
      this.loadRomBank(prgbank2, 0xc000);
      if (this.nes.rom.vromCount > 0) {
        const bank = ((value >> 4) * 2) % this.nes.rom.vromCount;
        this.loadVromBank(bank, 0x0000);
        this.loadVromBank(bank + 1, 0x1000);
      }
    }
  }
}

/**
 * Mapper 34 (BNROM)
 */
class Mapper34 extends Mapper {
  constructor(nes) {
    super(nes);
  }
  write(address, value) {
    if (address < 0x8000) super.write(address, value);
    else this.load32kRomBank(value, 0x8000);
  }
}

/**
 * Mapper 38
 */
class Mapper38 extends Mapper {
  constructor(nes) {
    super(nes);
  }
  write(address, value) {
    if (address < 0x7000 || address > 0x7fff) super.write(address, value);
    else {
      this.load32kRomBank(value & 3, 0x8000);
      this.load8kVromBank(((value >> 2) & 3) * 2, 0x0000);
    }
  }
}

/**
 * Mapper 66 (GxROM)
 */
class Mapper66 extends Mapper {
  constructor(nes) {
    super(nes);
  }
  write(address, value) {
    if (address < 0x8000) super.write(address, value);
    else {
      this.load32kRomBank((value >> 4) & 3, 0x8000);
      this.load8kVromBank((value & 3) * 2, 0x0000);
    }
  }
}

/**
 * Mapper 94 (UN1ROM)
 */
class Mapper94 extends Mapper {
  constructor(nes) {
    super(nes);
  }
  write(address, value) {
    if (address < 0x8000) super.write(address, value);
    else this.loadRomBank(value >> 2, 0x8000);
  }
  loadROM() {
    if (!this.nes.rom.valid) throw new Error("UN1ROM: Invalid ROM! Unable to load.");
    this.loadRomBank(0, 0x8000);
    this.loadRomBank(this.nes.rom.romCount - 1, 0xc000);
    this.loadCHRROM();
    this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);
  }
}

/**
 * Mapper 140
 */
class Mapper140 extends Mapper {
  constructor(nes) {
    super(nes);
  }
  write(address, value) {
    if (address < 0x6000 || address > 0x7fff) super.write(address, value);
    else {
      this.load32kRomBank((value >> 4) & 3, 0x8000);
      this.load8kVromBank((value & 0xf) * 2, 0x0000);
    }
  }
}

/**
 * Mapper 180
 */
class Mapper180 extends Mapper {
  constructor(nes) {
    super(nes);
  }
  write(address, value) {
    if (address < 0x8000) super.write(address, value);
    else this.loadRomBank(value, 0xc000);
  }
  loadROM() {
    if (!this.nes.rom.valid) throw new Error("Mapper 180: Invalid ROM! Unable to load.");
    this.loadRomBank(0, 0x8000);
    this.loadRomBank(this.nes.rom.romCount - 1, 0xc000);
    this.loadCHRROM();
    this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);
  }
}

/**
 * Mapper 240
 */
class Mapper240 extends Mapper {
  constructor(nes) {
    super(nes);
  }
  write(address, value) {
    if (address < 0x4020 || address > 0x5fff) super.write(address, value);
    else {
      this.load32kRomBank((value >> 4) & 3, 0x8000);
      this.load8kVromBank((value & 0xf) * 2, 0x0000);
    }
  }
}

/**
 * Mapper 241
 */
class Mapper241 extends Mapper {
  constructor(nes) {
    super(nes);
  }
  write(address, value) {
    if (address < 0x8000) super.write(address, value);
    else this.load32kRomBank(value, 0x8000);
  }
}

// Export mapping
export const Mappers = {
  0: Mapper,
  1: Mapper1,
  2: Mapper2,
  3: Mapper3,
  4: Mapper4,
  5: Mapper5,
  7: Mapper7,
  9: Mapper9,
  10: Mapper10,
  11: Mapper11,
  34: Mapper34,
  38: Mapper38,
  66: Mapper66,
  94: Mapper94,
  140: Mapper140,
  180: Mapper180,
  240: Mapper240,
  241: Mapper241
};