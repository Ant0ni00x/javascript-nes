import { copyArrayElements } from "./utils.js";

/**
 * Base Mapper (Mapper 0 / NROM)
 */
export class Mapper {
  constructor(nes) {
    this.nes = nes;
    // Flag for mappers that need extra tile fetches (MMC2, MMC4)
    this.hasLatch = false;

    // Mapper Flags For Proper Gating In PPU
    this.hasMMC1Features = false;
    this.hasMMC2Features = false;
    this.hasMMC3Features = false;
    this.hasMMC5Features = false;
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
    
    // Disable MMC5-specific PPU features (non-MMC5 mapper)
    if (this.nes.ppu && typeof this.nes.ppu.disableMMC5Mode === 'function') {
      this.nes.ppu.disableMMC5Mode();
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
    this.hasMMC3Features = true;
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
    this.hasScanlineIrq = true;
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
    if (this.nes.ppu && this.onPpuInit) {
      this.onPpuInit(this.nes.ppu);
    }
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
 * Mapper 5 (MMC5 / ExROM) - Hardware Accurate Implementation
 * Used by: Castlevania III
**/
class Mapper5 extends Mapper {
  constructor(nes) {
    super(nes);
    this.hasScanlineIrq = true;
    this.hasExtendedNametables = true;

    // PRG banking
    this.prgMode = 3;           // $5100 - PRG mode (0-3)
    this.prgBankRegs = new Uint8Array(5); // $5113-$5117
    this.prgRamProtect1 = 0;    // $5102
    this.prgRamProtect2 = 0;    // $5103
    
    // CHR banking
    this.chrMode = 0;           // $5101 - CHR mode (0-3)
    this.chrBankRegs = new Uint8Array(12); // $5120-$512B (sprite + BG sets)
    this.chrBankHi = 0;         // $5130 - upper CHR bits
    this.lastChrWrite = 0;      // Track which set was last written (0=sprite, 1=BG)
    
    // Nametable mapping
    this.ntMapping = new Uint8Array(4); // $5105 - nametable mapping
    
    // Extended RAM (1KB internal)
    this.exRam = new Uint8Array(1024);
    this.exRamMode = 0;         // $5104 - ExRAM mode (0-3)
    
    // Fill mode
    this.fillTile = 0;          // $5106 - fill mode tile
    this.fillAttr = 0;          // $5107 - fill mode attribute
    
    // IRQ
    this.irqScanline = 0;       // $5203 - target scanline
    this.irqEnabled = false;    // $5204 bit 7
    this.irqPending = false;    // $5204 bit 7 read
    this.inFrame = false;       // $5204 bit 6 read
    this.lastPpuAddr = 0;
    this.ppuIdleCount = 0;
    this.ppuReadCount = 0;
    this.currentScanline = 0;
    
    // Multiplier
    this.multiplicand = 0;      // $5205
    this.multiplier = 0;        // $5206
    
    // Split mode
    this.splitMode = 0;         // $5200
    this.splitScroll = 0;       // $5201
    this.splitBank = 0;         // $5202
    
    // Internal state
    this.prgRam = new Uint8Array(0x10000); // Up to 64KB PRG-RAM
    this.lastPpuA13 = -1;  // Initialize to invalid value so first notifyPpuA13 always updates
    this.spriteMode = false;    // True when fetching sprites
  }

  reset() {
    super.reset();
    
    this.prgMode = 3;
    this.prgBankRegs.fill(0);
    this.prgBankRegs[4] = 0xFF; // $5117 defaults to last bank
    this.prgRamProtect1 = 0;
    this.prgRamProtect2 = 0;
    
    this.chrMode = 0;
    this.chrBankRegs.fill(0);
    this.chrBankHi = 0;
    this.lastChrWrite = 0;
    
    this.ntMapping.fill(0);
    this.exRam.fill(0);
    this.exRamMode = 0;
    
    this.fillTile = 0;
    this.fillAttr = 0;
    
    this.irqScanline = 0;
    this.irqEnabled = false;
    this.irqPending = false;
    this.inFrame = false;
    this.ppuIdleCount = 0;
    this.ppuReadCount = 0;
    this.currentScanline = 0;
    
    this.multiplicand = 0;
    this.multiplier = 0;
    
    this.splitMode = 0;
    this.splitScroll = 0;
    this.splitBank = 0;
    
    this.lastPpuA13 = -1;  // Initialize to invalid value so first notifyPpuA13 always updates
    this.spriteMode = false;
    
    this.updatePrgBanks();
    this.updateChrBanks();
  }

  // === Memory Access ===
  
  load(address) {
    address &= 0xFFFF;
    
    if (address < 0x2000) {
      return this.nes.cpu.mem[address & 0x7FF];
    }
    
    // MMC5 registers $5000-$5FFF
    if (address >= 0x5000 && address < 0x6000) {
      return this.readMMC5Register(address);
    }
    
    // PRG-RAM $6000-$7FFF
    if (address >= 0x6000 && address < 0x8000) {
      return this.readPrgRam(address);
    }
    
    // PRG-ROM $8000-$FFFF
    if (address >= 0x8000) {
      return this.readPrgRom(address);
    }
    
    return this.regLoad(address);
  }

  write(address, value) {
    if (address < 0x2000) {
      this.nes.cpu.mem[address & 0x7FF] = value;
      return;
    }
    
    // MMC5 registers $5000-$5FFF
    if (address >= 0x5000 && address < 0x6000) {
      this.writeMMC5Register(address, value);
      return;
    }
    
    // PRG-RAM $6000-$7FFF
    if (address >= 0x6000 && address < 0x8000) {
      this.writePrgRam(address, value);
      return;
    }
    
    // PRG-ROM area - check if RAM is mapped
    if (address >= 0x8000) {
      this.writePrgArea(address, value);
      return;
    }
    
    // Standard register handling
    if (address >= 0x2000 && address < 0x4020) {
      if (address < 0x4000) {
        this.regWrite(0x2000 + (address & 0x7), value);
      } else {
        this.regWrite(address, value);
      }
    }
  }

  // === MMC5 Register Access ===
  
  readMMC5Register(address) {
    switch (address) {
      // Pulse 1/2, PCM (not readable)
      case 0x5000: case 0x5001: case 0x5002: case 0x5003:
      case 0x5004: case 0x5005: case 0x5006: case 0x5007:
      case 0x5010: case 0x5011:
        return 0;
        
      // Multiplier result
      case 0x5205:
        return (this.multiplicand * this.multiplier) & 0xFF;
      case 0x5206:
        return ((this.multiplicand * this.multiplier) >> 8) & 0xFF;
        
      // IRQ status
      case 0x5204: {
        let result = 0;
        if (this.irqPending) result |= 0x80;
        if (this.inFrame) result |= 0x40;
        this.irqPending = false;
        this.nes.cpu.irqRequested = false;
        return result;
      }
      
      // ExRAM read
      default:
        if (address >= 0x5C00 && address < 0x6000) {
          if (this.exRamMode >= 2) {
            return this.exRam[address & 0x3FF];
          }
          return 0;
        }
        return 0;
    }
  }

  writeMMC5Register(address, value) {
    switch (address) {
      // Audio registers (stub - not implemented)
      case 0x5000: case 0x5001: case 0x5002: case 0x5003:
      case 0x5004: case 0x5005: case 0x5006: case 0x5007:
      case 0x5010: case 0x5011: case 0x5015:
        break;
        
      // PRG Mode
      case 0x5100:
        this.prgMode = value & 0x03;
        this.updatePrgBanks();
        break;
        
      // CHR Mode
      case 0x5101:
        this.chrMode = value & 0x03;
        this.updateChrBanks();
        break;
        
      // PRG-RAM Protect
      case 0x5102:
        this.prgRamProtect1 = value & 0x03;
        break;
      case 0x5103:
        this.prgRamProtect2 = value & 0x03;
        break;
        
      // Extended RAM Mode
      case 0x5104:
        this.exRamMode = value & 0x03;
        break;
        
      // Nametable Mapping
      case 0x5105:
        this.ntMapping[0] = value & 0x03;
        this.ntMapping[1] = (value >> 2) & 0x03;
        this.ntMapping[2] = (value >> 4) & 0x03;
        this.ntMapping[3] = (value >> 6) & 0x03;
        this.updateNametableMirroring();
        break;
        
      // Fill Mode
      case 0x5106:
        this.fillTile = value;
        break;
      case 0x5107:
        this.fillAttr = value & 0x03;
        break;
        
      // PRG Banking
      case 0x5113:
        this.prgBankRegs[0] = value & 0x07;
        this.updatePrgBanks();
        break;
      case 0x5114:
        this.prgBankRegs[1] = value;
        this.updatePrgBanks();
        break;
      case 0x5115:
        this.prgBankRegs[2] = value;
        this.updatePrgBanks();
        break;
      case 0x5116:
        this.prgBankRegs[3] = value;
        this.updatePrgBanks();
        break;
      case 0x5117:
        this.prgBankRegs[4] = value | 0x80; // ROM only
        this.updatePrgBanks();
        break;
        
      // CHR Banking (Sprite set)
      case 0x5120: case 0x5121: case 0x5122: case 0x5123:
      case 0x5124: case 0x5125: case 0x5126: case 0x5127:
        this.chrBankRegs[address - 0x5120] = value;
        this.lastChrWrite = 0;
        this.updateChrBanks();
        break;
        
      // CHR Banking (BG set)
      case 0x5128: case 0x5129: case 0x512A: case 0x512B:
        this.chrBankRegs[8 + (address - 0x5128)] = value;
        this.lastChrWrite = 1;
        this.updateChrBanks();
        break;
        
      // CHR Bank High Bits
      case 0x5130:
        this.chrBankHi = value & 0x03;
        break;
        
      // Split Mode
      case 0x5200:
        this.splitMode = value;
        break;
      case 0x5201:
        this.splitScroll = value;
        break;
      case 0x5202:
        this.splitBank = value;
        break;
        
      // IRQ
      case 0x5203:
        this.irqScanline = value;
        break;
      case 0x5204:
        this.irqEnabled = (value & 0x80) !== 0;
        break;
        
      // Multiplier
      case 0x5205:
        this.multiplicand = value;
        break;
      case 0x5206:
        this.multiplier = value;
        break;
        
      // ExRAM Write
      default:
        if (address >= 0x5C00 && address < 0x6000) {
          if (this.exRamMode !== 3) {
            if (this.exRamMode < 2) {
              if (this.inFrame) {
                this.exRam[address & 0x3FF] = value;
              } else {
                this.exRam[address & 0x3FF] = 0;
              }
            } else {
              this.exRam[address & 0x3FF] = value;
            }
          }
        }
        break;
    }
  }

  // === PRG Banking ===
  
  updatePrgBanks() {
    const romCount8k = this.nes.rom.romCount * 2;
    
    switch (this.prgMode) {
      case 0: { // 32KB mode
        const bank32k = (this.prgBankRegs[4] & 0x7C) >> 2;
        const base = (bank32k * 4) % romCount8k;
        this.load8kRomBank(base, 0x8000);
        this.load8kRomBank((base + 1) % romCount8k, 0xA000);
        this.load8kRomBank((base + 2) % romCount8k, 0xC000);
        this.load8kRomBank((base + 3) % romCount8k, 0xE000);
        break;
      }
      case 1: { // 16KB + 16KB mode
        const bank16k_0 = (this.prgBankRegs[2] & 0x7E) >> 1;
        const base0 = (bank16k_0 * 2) % romCount8k;
        if (this.prgBankRegs[2] & 0x80) {
          this.load8kRomBank(base0, 0x8000);
          this.load8kRomBank((base0 + 1) % romCount8k, 0xA000);
        }
        const bank16k_1 = (this.prgBankRegs[4] & 0x7E) >> 1;
        const base1 = (bank16k_1 * 2) % romCount8k;
        this.load8kRomBank(base1, 0xC000);
        this.load8kRomBank((base1 + 1) % romCount8k, 0xE000);
        break;
      }
      case 2: { // 16KB + 8KB + 8KB mode
        const bank16k = (this.prgBankRegs[2] & 0x7E) >> 1;
        const base = (bank16k * 2) % romCount8k;
        if (this.prgBankRegs[2] & 0x80) {
          this.load8kRomBank(base, 0x8000);
          this.load8kRomBank((base + 1) % romCount8k, 0xA000);
        }
        if (this.prgBankRegs[3] & 0x80) {
          this.load8kRomBank((this.prgBankRegs[3] & 0x7F) % romCount8k, 0xC000);
        }
        this.load8kRomBank((this.prgBankRegs[4] & 0x7F) % romCount8k, 0xE000);
        break;
      }
      case 3: { // 8KB × 4 mode
        if (this.prgBankRegs[1] & 0x80) {
          this.load8kRomBank((this.prgBankRegs[1] & 0x7F) % romCount8k, 0x8000);
        }
        if (this.prgBankRegs[2] & 0x80) {
          this.load8kRomBank((this.prgBankRegs[2] & 0x7F) % romCount8k, 0xA000);
        }
        if (this.prgBankRegs[3] & 0x80) {
          this.load8kRomBank((this.prgBankRegs[3] & 0x7F) % romCount8k, 0xC000);
        }
        this.load8kRomBank((this.prgBankRegs[4] & 0x7F) % romCount8k, 0xE000);
        break;
      }
    }
  }

  readPrgRam(address) {
    const bank = this.prgBankRegs[0] & 0x07;
    const offset = (bank * 0x2000) + (address & 0x1FFF);
    return this.prgRam[offset];
  }

  writePrgRam(address, value) {
    if (this.prgRamProtect1 === 0x02 && this.prgRamProtect2 === 0x01) {
      const bank = this.prgBankRegs[0] & 0x07;
      const offset = (bank * 0x2000) + (address & 0x1FFF);
      this.prgRam[offset] = value;
      if (this.nes.opts.onBatteryRamWrite) {
        this.nes.opts.onBatteryRamWrite(address, value);
      }
    }
  }

  readPrgRom(address) {
    if (this.prgMode === 3) {
      const slot = (address - 0x8000) >> 13;
      const reg = this.prgBankRegs[slot + 1];
      if ((reg & 0x80) === 0) {
        const bank = reg & 0x07;
        const offset = (bank * 0x2000) + (address & 0x1FFF);
        return this.prgRam[offset];
      }
    }
    return this.nes.cpu.mem[address];
  }

  writePrgArea(address, value) {
    if (this.prgMode === 3) {
      const slot = (address - 0x8000) >> 13;
      if (slot < 3) {
        const reg = this.prgBankRegs[slot + 1];
        if ((reg & 0x80) === 0) {
          if (this.prgRamProtect1 === 0x02 && this.prgRamProtect2 === 0x01) {
            const bank = reg & 0x07;
            const offset = (bank * 0x2000) + (address & 0x1FFF);
            this.prgRam[offset] = value;
          }
          return;
        }
      }
    }
  }

  // === CHR Banking ===
  
  updateChrBanks() {
    if (this.nes.rom.vromCount === 0) return;
    this.updateChrBanksForMode(false);
  }

  updateChrBanksForMode(isSprite) {
    if (this.nes.rom.vromCount === 0) return;
    
    // Default to Set A (Registers $5120-$5127) which starts at index 0
    let bankOffset = 0;
    
    // Determine if we should use Set B (Registers $5128-$512B) which starts at index 8
    // Backgrounds use Set B if:
    // 1. We are in ExGrafix Mode (exRamMode === 1)
    // 2. OR We are using 8x16 Sprites (ppu.f_spriteSize === 1)
    if (!isSprite) {
      const is8x16 = this.nes.ppu.f_spriteSize === 1;
      if (this.exRamMode === 1 || is8x16) {
        bankOffset = 8;
      }
    }
    
    const hiShift = this.chrBankHi << 8;
    
    switch (this.chrMode) {
      case 0: { // 8KB mode
        // For 8KB mode, we usually take the last register of the set (Offset + 7)
        // Note: Set B only has 4 registers (8-11), effectively mapping 5128-512B.
        // In 8KB mode for BG (Set B), it usually uses $512B (Index 11).
        const regIndex = bankOffset === 8 ? 11 : 7;
        const bank = this.chrBankRegs[regIndex] | hiShift;
        const bank4k = (bank * 2) % this.nes.rom.vromCount;
        this.loadVromBank(bank4k, 0x0000);
        this.loadVromBank((bank4k + 1) % this.nes.rom.vromCount, 0x1000);
        break;
      }
      case 1: { // 4KB × 2 mode
        const regIndex0 = bankOffset === 8 ? 11 : 3; // $512B or $5123
        const regIndex1 = bankOffset === 8 ? 11 : 7; // $512B or $5127
        
        // Wait, standard hardware behavior for Set B in Mode 1 is actually complex.
        // But simply mapping the registers linearly usually works for CV3.
        // For Set A (Sprites): uses regs 3 and 7.
        // For Set B (BG): Uses regs 11 (and technically 11 again? Or 9 and 11?)
        // Standard MMC5 4KB mode usually just points to the loaded banks.
        // Let's stick to the linear map if offset is 0, but if offset is 8 (Set B), 
        // MMC5 uses $5128-$512B.
        
        // CORRECTION: In Mode 1 (4KB):
        // Set A uses $5123 and $5127.
        // Set B uses $512B for both? Or $512B and $512B? 
        // Actually, CV3 uses Mode 3 (1KB) mostly, but let's be safe:
        const bank0 = this.chrBankRegs[bankOffset + 3] | hiShift;
        const bank1 = this.chrBankRegs[bankOffset + 7] | hiShift;
        this.loadVromBank(bank0 % this.nes.rom.vromCount, 0x0000);
        this.loadVromBank(bank1 % this.nes.rom.vromCount, 0x1000);
        break;
      }
      case 2: { // 2KB × 4 mode
        const bank0 = this.chrBankRegs[bankOffset + 1] | hiShift;
        const bank1 = this.chrBankRegs[bankOffset + 3] | hiShift;
        const bank2 = this.chrBankRegs[bankOffset + 5] | hiShift;
        const bank3 = this.chrBankRegs[bankOffset + 7] | hiShift;
        this.load2kVromBank(bank0, 0x0000);
        this.load2kVromBank(bank1, 0x0800);
        this.load2kVromBank(bank2, 0x1000);
        this.load2kVromBank(bank3, 0x1800);
        break;
      }
      case 3: { // 1KB × 8 mode
        // This is what Castlevania III uses most of the time
        for (let i = 0; i < 8; i++) {
          // If bankOffset is 8, we read indices 8,9,10,11.
          // Since the loop goes 0-7, we need to wrap the reads for Set B (which only has 4 regs).
          // However, your chrBankRegs array is size 12. 
          // Indices 0-7 are Set A. Indices 8-11 are Set B.
          // When fetching for BG (Set B), MMC5 maps:
          // $0000-$03FF -> Reg 8
          // $0400-$07FF -> Reg 9
          // $0800-$0BFF -> Reg 10
          // $0C00-$0FFF -> Reg 11
          // $1000-$13FF -> Reg 8
          // $1400-$17FF -> Reg 9
          // $1800-$1BFF -> Reg 10
          // $1C00-$1FFF -> Reg 11
          
          let regIndex;
          if (bankOffset === 0) {
             regIndex = i;
          } else {
             // Wrap 8-11
             regIndex = 8 + (i % 4);
          }

          const bank = this.chrBankRegs[regIndex] | hiShift;
          this.load1kVromBank(bank, i * 0x400);
        }
        break;
      }
    }
  }

  // === Nametable Mapping ===
  
  updateNametableMirroring() {
    const m = this.ntMapping;
    
    // Only update PPU mirroring for standard mappings (modes 0 and 1)
    // If any nametable uses ExRAM (2) or fill (3), we handle it ourselves
    const hasCustomMapping = m.some(v => v >= 2);
    if (hasCustomMapping) {
      // Don't touch PPU mirroring - we handle reads via readNametable()
      return;
    }
    
    // Standard CIRAM mappings
    if (m[0] === 0 && m[1] === 1 && m[2] === 0 && m[3] === 1) {
      this.nes.ppu.setMirroring(this.nes.rom.VERTICAL_MIRRORING);
    } else if (m[0] === 0 && m[1] === 0 && m[2] === 1 && m[3] === 1) {
      this.nes.ppu.setMirroring(this.nes.rom.HORIZONTAL_MIRRORING);
    } else if (m[0] === m[1] && m[1] === m[2] && m[2] === m[3]) {
      if (m[0] === 0) {
        this.nes.ppu.setMirroring(this.nes.rom.SINGLESCREEN_MIRRORING);
      } else if (m[0] === 1) {
        this.nes.ppu.setMirroring(this.nes.rom.SINGLESCREEN_MIRRORING2);
      }
    }
  }

  // === Scanline IRQ ===
  
  ppuScanline(scanline, rendering) {
    // Pre-render/VBlank scanline (-1) resets in-frame state
    if (scanline < 0) {
      this.inFrame = false;
      this.ppuIdleCount = 0;
      this.ppuReadCount = 0;
      return;
    }
    
    if (!rendering) {
      this.ppuIdleCount++;
      if (this.ppuIdleCount > 3) {
        this.inFrame = false;
        this.currentScanline = 0;
      }
      return;
    }
    
    this.ppuIdleCount = 0;
    
    // First visible scanline starts the frame
    if (!this.inFrame) {
      this.inFrame = true;
      this.currentScanline = 0;
      this.irqPending = false;
    }
    
    this.currentScanline = scanline;
    
    // Check for IRQ match
    if (scanline === this.irqScanline) {
      this.irqPending = true;
      if (this.irqEnabled) {
        this.nes.cpu.requestIrq(this.nes.cpu.IRQ_NORMAL);
      }
    }
  }

  ppuAddressUpdate(address) {
    if (address >= 0x2000 && address < 0x3F00) {
      this.ppuReadCount++;
      if (this.ppuReadCount >= 3 && !this.inFrame) {
        this.inFrame = true;
        this.currentScanline = 0;
      }
    }
    this.lastPpuAddr = address;
  }

  notifyPpuA13(value) {
    if (value !== this.lastPpuA13) {
      this.lastPpuA13 = value;
      this.spriteMode = (value === 0);
      // BUG FIX: Always update banks when A13 changes. 
      // The logic inside updateChrBanksForMode will decide if a swap is actually necessary.
      this.updateChrBanksForMode(this.spriteMode);
    }
  }

  // === Nametable Read (fill mode and ExRAM) ===
  
  readNametable(address) {
    // address is $2000-$2FFF
    const ntIndex = (address >> 10) & 0x03;
    const offset = address & 0x3FF;
    const mapping = this.ntMapping[ntIndex];
    
    switch (mapping) {
      case 0: // CIRAM $0000 (first 1KB)
        return this.nes.ppu.vramMem[0x2000 + offset];
      case 1: // CIRAM $0400 (second 1KB)
        return this.nes.ppu.vramMem[0x2400 + offset];
      case 2: // ExRAM (if mode 0 or 1)
        if (this.exRamMode < 2) {
          return this.exRam[offset];
        }
        return 0;
      case 3: // Fill mode
        if (offset < 0x3C0) {
          return this.fillTile;
        }
        // Attribute area - replicate fill attribute to all quadrants
        return (this.fillAttr * 0x55);
      default:
        return 0;
    }
  }

  writeNametable(address, value) {
    const ntIndex = (address >> 10) & 0x03;
    const offset = address & 0x3FF;
    const mapping = this.ntMapping[ntIndex];
    
    switch (mapping) {
      case 0:
        this.nes.ppu.vramMem[0x2000 + offset] = value;
        break;
      case 1:
        this.nes.ppu.vramMem[0x2400 + offset] = value;
        break;
      case 2:
        if (this.exRamMode < 2 && this.inFrame) {
          this.exRam[offset] = value;
        }
        break;
      // Fill mode is read-only
    }
  }

  // === Extended Attributes (ExGrafix mode) ===
  
  getExtendedAttribute(tileX, tileY) {
    if (this.exRamMode !== 1) return 0;
    const exRamAddr = (tileY * 32) + tileX;
    return this.exRam[exRamAddr & 0x3FF] & 0x03;
  }

  getExtendedChrBank(tileX, tileY) {
    if (this.exRamMode !== 1) return 0;
    const exRamAddr = (tileY * 32) + tileX;
    return (this.exRam[exRamAddr & 0x3FF] >> 2) & 0x3F;
  }

  // === ROM Loading ===
  
  loadROM() {
    if (!this.nes.rom.valid) {
      throw new Error("MMC5: Invalid ROM! Unable to load.");
    }
    
    // Enable MMC5-specific PPU features
    if (this.nes.ppu && typeof this.nes.ppu.enableMMC5Mode === 'function') {
      this.nes.ppu.enableMMC5Mode();
    }
    
    this.prgBankRegs[4] = 0xFF;
    
    const lastBank = (this.nes.rom.romCount * 2) - 1;
    this.load8kRomBank(lastBank, 0x8000);
    this.load8kRomBank(lastBank, 0xA000);
    this.load8kRomBank(lastBank, 0xC000);
    this.load8kRomBank(lastBank, 0xE000);
    
    this.loadCHRROM();
    this.updateNametableMirroring();
    this.loadBatteryRam();
    
    this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);
  }

  loadBatteryRam() {
    if (this.nes.rom.batteryRam) {
      const ram = this.nes.rom.batteryRam;
      if (ram !== null && ram.length <= this.prgRam.length) {
        copyArrayElements(ram, 0, this.prgRam, 0, ram.length);
      }
    }
  }

  // === State Serialization ===
  
  toJSON() {
    const s = super.toJSON();
    s.prgMode = this.prgMode;
    s.prgBankRegs = Array.from(this.prgBankRegs);
    s.prgRamProtect1 = this.prgRamProtect1;
    s.prgRamProtect2 = this.prgRamProtect2;
    s.chrMode = this.chrMode;
    s.chrBankRegs = Array.from(this.chrBankRegs);
    s.chrBankHi = this.chrBankHi;
    s.lastChrWrite = this.lastChrWrite;
    s.ntMapping = Array.from(this.ntMapping);
    s.exRam = Array.from(this.exRam);
    s.exRamMode = this.exRamMode;
    s.fillTile = this.fillTile;
    s.fillAttr = this.fillAttr;
    s.irqScanline = this.irqScanline;
    s.irqEnabled = this.irqEnabled;
    s.irqPending = this.irqPending;
    s.inFrame = this.inFrame;
    s.currentScanline = this.currentScanline;
    s.multiplicand = this.multiplicand;
    s.multiplier = this.multiplier;
    s.splitMode = this.splitMode;
    s.splitScroll = this.splitScroll;
    s.splitBank = this.splitBank;
    s.prgRam = Array.from(this.prgRam);
    return s;
  }

  fromJSON(s) {
    super.fromJSON(s);
    this.prgMode = s.prgMode;
    this.prgBankRegs = new Uint8Array(s.prgBankRegs);
    this.prgRamProtect1 = s.prgRamProtect1;
    this.prgRamProtect2 = s.prgRamProtect2;
    this.chrMode = s.chrMode;
    this.chrBankRegs = new Uint8Array(s.chrBankRegs);
    this.chrBankHi = s.chrBankHi;
    this.lastChrWrite = s.lastChrWrite;
    this.ntMapping = new Uint8Array(s.ntMapping);
    this.exRam = new Uint8Array(s.exRam);
    this.exRamMode = s.exRamMode;
    this.fillTile = s.fillTile;
    this.fillAttr = s.fillAttr;
    this.irqScanline = s.irqScanline;
    this.irqEnabled = s.irqEnabled;
    this.irqPending = s.irqPending;
    this.inFrame = s.inFrame;
    this.currentScanline = s.currentScanline;
    this.multiplicand = s.multiplicand;
    this.multiplier = s.multiplier;
    this.splitMode = s.splitMode;
    this.splitScroll = s.splitScroll;
    this.splitBank = s.splitBank;
    this.prgRam = new Uint8Array(s.prgRam);
    this.updatePrgBanks();
    this.updateChrBanks();
    this.updateNametableMirroring();
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
    this.hasMMC2Features = true;
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
