import { toJSON, fromJSON } from "./utils.js";

// Pre-compute opcode data once at module load (static/shared)
const OPDATA = buildOpData();

export class CPU {
  // IRQ Types (static constants)
  static IRQ_NORMAL = 0;
  static IRQ_NMI = 1;
  static IRQ_RESET = 2;

  // Instance getters for backward compatibility
  get IRQ_NORMAL() { return CPU.IRQ_NORMAL; }
  get IRQ_NMI() { return CPU.IRQ_NMI; }
  get IRQ_RESET() { return CPU.IRQ_RESET; }

  // JSON serialization properties
  static JSON_PROPERTIES = [
    "mem",
    "cyclesToHalt",
    "irqRequested",
    "irqType",
    "REG_ACC",
    "REG_X",
    "REG_Y",
    "REG_SP",
    "REG_PC",
    "REG_PC_NEW",
    "REG_STATUS",
    "F_CARRY",
    "F_DECIMAL",
    "F_INTERRUPT",
    "F_INTERRUPT_NEW",
    "F_OVERFLOW",
    "F_SIGN",
    "F_ZERO",
    "F_NOTUSED",
    "F_NOTUSED_NEW",
    "F_BRK",
    "F_BRK_NEW"
  ];

  constructor(nes) {
    this.nes = nes;

    // Pre-declare properties for V8 hidden class optimization
    this.mem = null;
    this.REG_ACC = 0;
    this.REG_X = 0;
    this.REG_Y = 0;
    this.REG_SP = 0;
    this.REG_PC = 0;
    this.REG_PC_NEW = 0;
    this.REG_STATUS = 0;
    this.F_CARRY = 0;
    this.F_DECIMAL = 0;
    this.F_INTERRUPT = 0;
    this.F_INTERRUPT_NEW = 0;
    this.F_OVERFLOW = 0;
    this.F_SIGN = 0;
    this.F_ZERO = 0;
    this.F_NOTUSED = 0;
    this.F_NOTUSED_NEW = 0;
    this.F_BRK = 0;
    this.F_BRK_NEW = 0;
    this.cyclesToHalt = 0;
    this.crash = false;
    this.irqRequested = false;
    this.irqType = null;

    this.reset();
  }

  reset() {
    // Use typed array for main memory
    this.mem = new Uint8Array(0x10000);

    // Initialize RAM pattern
    for (let i = 0; i < 0x2000; i++) {
      this.mem[i] = 0xff;
    }
    for (let p = 0; p < 4; p++) {
      const j = p * 0x800;
      this.mem[j + 0x008] = 0xf7;
      this.mem[j + 0x009] = 0xef;
      this.mem[j + 0x00a] = 0xdf;
      this.mem[j + 0x00f] = 0xbf;
    }

    // CPU Registers
    this.REG_ACC = 0;
    this.REG_X = 0;
    this.REG_Y = 0;
    this.REG_SP = 0xff;
    this.REG_PC = 0x8000 - 1;
    this.REG_PC_NEW = 0x8000 - 1;
    this.REG_STATUS = 0x28;

    this.setStatus(0x28);

    // Flags
    this.F_CARRY = 0;
    this.F_DECIMAL = 0;
    this.F_INTERRUPT = 1;
    this.F_INTERRUPT_NEW = 1;
    this.F_OVERFLOW = 0;
    this.F_SIGN = 0;
    this.F_ZERO = 1;
    this.F_NOTUSED = 1;
    this.F_NOTUSED_NEW = 1;
    this.F_BRK = 1;
    this.F_BRK_NEW = 1;

    this.cyclesToHalt = 0;
    this.crash = false;
    this.irqRequested = false;
    this.irqType = null;
  }

  emulate() {
    let temp, add, val;

    if (this.irqRequested) {
      temp =
        this.F_CARRY |
        ((this.F_ZERO === 0 ? 1 : 0) << 1) |
        (this.F_INTERRUPT << 2) |
        (this.F_DECIMAL << 3) |
        (this.F_BRK << 4) |
        (this.F_NOTUSED << 5) |
        (this.F_OVERFLOW << 6) |
        (this.F_SIGN << 7);

      this.REG_PC_NEW = this.REG_PC;
      this.F_INTERRUPT_NEW = this.F_INTERRUPT;

      switch (this.irqType) {
        case 0:
          if (this.F_INTERRUPT !== 0) break;
          this.doIrq(temp);
          break;
        case 1:
          this.doNonMaskableInterrupt(temp);
          break;
        case 2:
          this.doResetInterrupt();
          break;
      }

      this.REG_PC = this.REG_PC_NEW;
      this.F_INTERRUPT = this.F_INTERRUPT_NEW;
      this.F_BRK = this.F_BRK_NEW;
      this.irqRequested = false;
    }

    const mmap = this.nes.mmap;
    if (mmap === null) return 32;

    const mem = this.mem;
    let REG_PC = this.REG_PC;
    const opinf = OPDATA[mmap.load(REG_PC + 1)];
    let cycleCount = opinf >> 24;
    let cycleAdd = 0;

    const addrMode = (opinf >> 8) & 0xff;
    const opaddr = REG_PC;
    REG_PC += (opinf >> 16) & 0xff;

    let addr = 0;
    switch (addrMode) {
      case 0: addr = this.load(opaddr + 2); break;
      case 1:
        addr = this.load(opaddr + 2);
        addr += addr < 0x80 ? REG_PC : REG_PC - 256;
        break;
      case 2: break;
      case 3: addr = this.load16bit(opaddr + 2); break;
      case 4: addr = this.REG_ACC; break;
      case 5: addr = REG_PC; break;
      case 6: addr = (this.load(opaddr + 2) + this.REG_X) & 0xff; break;
      case 7: addr = (this.load(opaddr + 2) + this.REG_Y) & 0xff; break;
      case 8:
        addr = this.load16bit(opaddr + 2);
        if ((addr & 0xff00) !== ((addr + this.REG_X) & 0xff00)) cycleAdd = 1;
        addr += this.REG_X;
        break;
      case 9:
        addr = this.load16bit(opaddr + 2);
        if ((addr & 0xff00) !== ((addr + this.REG_Y) & 0xff00)) cycleAdd = 1;
        addr += this.REG_Y;
        break;
      case 10:
        addr = this.load(opaddr + 2);
        if ((addr & 0xff00) !== ((addr + this.REG_X) & 0xff00)) cycleAdd = 1;
        addr = this.load16bit((addr + this.REG_X) & 0xff);
        break;
      case 11:
        addr = this.load16bit(this.load(opaddr + 2));
        if ((addr & 0xff00) !== ((addr + this.REG_Y) & 0xff00)) cycleAdd = 1;
        addr += this.REG_Y;
        break;
      case 12:
        addr = this.load16bit(opaddr + 2);
        if (addr < 0x1fff) {
          addr = mem[addr & 0x7ff] | (mem[(addr & 0xff00) | (((addr & 0xff) + 1) & 0xff)] << 8);
        } else {
          addr = mmap.load(addr) | (mmap.load((addr & 0xff00) | (((addr & 0xff) + 1) & 0xff)) << 8);
        }
        break;
    }
    addr &= 0xffff;
    this.REG_PC = REG_PC;

    switch (opinf & 0xff) {
      case 0: // ADC
        val = this.load(addr);
        temp = this.REG_ACC + val + this.F_CARRY;
        this.F_OVERFLOW = ((this.REG_ACC ^ val) & 0x80) === 0 && ((this.REG_ACC ^ temp) & 0x80) !== 0 ? 1 : 0;
        this.F_CARRY = temp > 255 ? 1 : 0;
        this.F_SIGN = (temp >> 7) & 1;
        this.F_ZERO = temp & 0xff;
        this.REG_ACC = temp & 0xff;
        cycleCount += cycleAdd;
        break;
      case 1: // AND
        this.REG_ACC &= this.load(addr);
        this.F_SIGN = (this.REG_ACC >> 7) & 1;
        this.F_ZERO = this.REG_ACC;
        if (addrMode !== 11) cycleCount += cycleAdd;
        break;
      case 2: // ASL
        if (addrMode === 4) {
          this.F_CARRY = (this.REG_ACC >> 7) & 1;
          this.REG_ACC = (this.REG_ACC << 1) & 0xff;
          this.F_SIGN = (this.REG_ACC >> 7) & 1;
          this.F_ZERO = this.REG_ACC;
        } else {
          temp = this.load(addr);
          this.F_CARRY = (temp >> 7) & 1;
          temp = (temp << 1) & 0xff;
          this.F_SIGN = (temp >> 7) & 1;
          this.F_ZERO = temp;
          this.write(addr, temp);
        }
        break;
      case 3: // BCC
        if (this.F_CARRY === 0) {
          cycleCount += (opaddr & 0xff00) !== (addr & 0xff00) ? 2 : 1;
          this.REG_PC = addr;
        }
        break;
      case 4: // BCS
        if (this.F_CARRY === 1) {
          cycleCount += (opaddr & 0xff00) !== (addr & 0xff00) ? 2 : 1;
          this.REG_PC = addr;
        }
        break;
      case 5: // BEQ
        if (this.F_ZERO === 0) {
          cycleCount += (opaddr & 0xff00) !== (addr & 0xff00) ? 2 : 1;
          this.REG_PC = addr;
        }
        break;
      case 6: // BIT
        temp = this.load(addr);
        this.F_SIGN = (temp >> 7) & 1;
        this.F_OVERFLOW = (temp >> 6) & 1;
        this.F_ZERO = temp & this.REG_ACC;
        break;
      case 7: // BMI
        if (this.F_SIGN === 1) { cycleCount++; this.REG_PC = addr; }
        break;
      case 8: // BNE
        if (this.F_ZERO !== 0) {
          cycleCount += (opaddr & 0xff00) !== (addr & 0xff00) ? 2 : 1;
          this.REG_PC = addr;
        }
        break;
      case 9: // BPL
        if (this.F_SIGN === 0) {
          cycleCount += (opaddr & 0xff00) !== (addr & 0xff00) ? 2 : 1;
          this.REG_PC = addr;
        }
        break;
      case 10: // BRK
        this.REG_PC += 2;
        this.push((this.REG_PC >> 8) & 0xff);
        this.push(this.REG_PC & 0xff);
        this.F_BRK = 1;
        this.push(
          this.F_CARRY | ((this.F_ZERO === 0 ? 1 : 0) << 1) | (this.F_INTERRUPT << 2) |
          (this.F_DECIMAL << 3) | (this.F_BRK << 4) | (this.F_NOTUSED << 5) |
          (this.F_OVERFLOW << 6) | (this.F_SIGN << 7)
        );
        this.F_INTERRUPT = 1;
        this.REG_PC = this.load16bit(0xfffe) - 1;
        break;
      case 11: // BVC
        if (this.F_OVERFLOW === 0) {
          cycleCount += (opaddr & 0xff00) !== (addr & 0xff00) ? 2 : 1;
          this.REG_PC = addr;
        }
        break;
      case 12: // BVS
        if (this.F_OVERFLOW === 1) {
          cycleCount += (opaddr & 0xff00) !== (addr & 0xff00) ? 2 : 1;
          this.REG_PC = addr;
        }
        break;
      case 13: this.F_CARRY = 0; break; // CLC
      case 14: this.F_DECIMAL = 0; break; // CLD
      case 15: this.F_INTERRUPT = 0; break; // CLI
      case 16: this.F_OVERFLOW = 0; break; // CLV
      case 17: // CMP
        temp = this.REG_ACC - this.load(addr);
        this.F_CARRY = temp >= 0 ? 1 : 0;
        this.F_SIGN = (temp >> 7) & 1;
        this.F_ZERO = temp & 0xff;
        cycleCount += cycleAdd;
        break;
      case 18: // CPX
        temp = this.REG_X - this.load(addr);
        this.F_CARRY = temp >= 0 ? 1 : 0;
        this.F_SIGN = (temp >> 7) & 1;
        this.F_ZERO = temp & 0xff;
        break;
      case 19: // CPY
        temp = this.REG_Y - this.load(addr);
        this.F_CARRY = temp >= 0 ? 1 : 0;
        this.F_SIGN = (temp >> 7) & 1;
        this.F_ZERO = temp & 0xff;
        break;
      case 20: // DEC
        temp = (this.load(addr) - 1) & 0xff;
        this.F_SIGN = (temp >> 7) & 1;
        this.F_ZERO = temp;
        this.write(addr, temp);
        break;
      case 21: // DEX
        this.REG_X = (this.REG_X - 1) & 0xff;
        this.F_SIGN = (this.REG_X >> 7) & 1;
        this.F_ZERO = this.REG_X;
        break;
      case 22: // DEY
        this.REG_Y = (this.REG_Y - 1) & 0xff;
        this.F_SIGN = (this.REG_Y >> 7) & 1;
        this.F_ZERO = this.REG_Y;
        break;
      case 23: // EOR
        this.REG_ACC = (this.load(addr) ^ this.REG_ACC) & 0xff;
        this.F_SIGN = (this.REG_ACC >> 7) & 1;
        this.F_ZERO = this.REG_ACC;
        cycleCount += cycleAdd;
        break;
      case 24: // INC
        temp = (this.load(addr) + 1) & 0xff;
        this.F_SIGN = (temp >> 7) & 1;
        this.F_ZERO = temp;
        this.write(addr, temp);
        break;
      case 25: // INX
        this.REG_X = (this.REG_X + 1) & 0xff;
        this.F_SIGN = (this.REG_X >> 7) & 1;
        this.F_ZERO = this.REG_X;
        break;
      case 26: // INY
        this.REG_Y = (this.REG_Y + 1) & 0xff;
        this.F_SIGN = (this.REG_Y >> 7) & 1;
        this.F_ZERO = this.REG_Y;
        break;
      case 27: this.REG_PC = addr - 1; break; // JMP
      case 28: // JSR
        this.push((this.REG_PC >> 8) & 0xff);
        this.push(this.REG_PC & 0xff);
        this.REG_PC = addr - 1;
        break;
      case 29: // LDA
        this.REG_ACC = this.load(addr);
        this.F_SIGN = (this.REG_ACC >> 7) & 1;
        this.F_ZERO = this.REG_ACC;
        cycleCount += cycleAdd;
        break;
      case 30: // LDX
        this.REG_X = this.load(addr);
        this.F_SIGN = (this.REG_X >> 7) & 1;
        this.F_ZERO = this.REG_X;
        cycleCount += cycleAdd;
        break;
      case 31: // LDY
        this.REG_Y = this.load(addr);
        this.F_SIGN = (this.REG_Y >> 7) & 1;
        this.F_ZERO = this.REG_Y;
        cycleCount += cycleAdd;
        break;
      case 32: // LSR
        if (addrMode === 4) {
          this.F_CARRY = this.REG_ACC & 1;
          this.REG_ACC >>= 1;
          temp = this.REG_ACC;
        } else {
          temp = this.load(addr);
          this.F_CARRY = temp & 1;
          temp >>= 1;
          this.write(addr, temp);
        }
        this.F_SIGN = 0;
        this.F_ZERO = temp;
        break;
      case 33: break; // NOP
      case 34: // ORA
        this.REG_ACC = (this.load(addr) | this.REG_ACC) & 0xff;
        this.F_SIGN = (this.REG_ACC >> 7) & 1;
        this.F_ZERO = this.REG_ACC;
        if (addrMode !== 11) cycleCount += cycleAdd;
        break;
      case 35: this.push(this.REG_ACC); break; // PHA
      case 36: // PHP
        this.F_BRK = 1;
        this.push(
          this.F_CARRY | ((this.F_ZERO === 0 ? 1 : 0) << 1) | (this.F_INTERRUPT << 2) |
          (this.F_DECIMAL << 3) | (this.F_BRK << 4) | (this.F_NOTUSED << 5) |
          (this.F_OVERFLOW << 6) | (this.F_SIGN << 7)
        );
        break;
      case 37: // PLA
        this.REG_ACC = this.pull();
        this.F_SIGN = (this.REG_ACC >> 7) & 1;
        this.F_ZERO = this.REG_ACC;
        break;
      case 38: // PLP
        temp = this.pull();
        this.F_CARRY = temp & 1;
        this.F_ZERO = ((temp >> 1) & 1) === 1 ? 0 : 1;
        this.F_INTERRUPT = (temp >> 2) & 1;
        this.F_DECIMAL = (temp >> 3) & 1;
        this.F_BRK = (temp >> 4) & 1;
        this.F_NOTUSED = (temp >> 5) & 1;
        this.F_OVERFLOW = (temp >> 6) & 1;
        this.F_SIGN = (temp >> 7) & 1;
        this.F_NOTUSED = 1;
        break;
      case 39: // ROL
        if (addrMode === 4) {
          temp = this.REG_ACC;
          add = this.F_CARRY;
          this.F_CARRY = (temp >> 7) & 1;
          temp = ((temp << 1) & 0xff) + add;
          this.REG_ACC = temp;
        } else {
          temp = this.load(addr);
          add = this.F_CARRY;
          this.F_CARRY = (temp >> 7) & 1;
          temp = ((temp << 1) & 0xff) + add;
          this.write(addr, temp);
        }
        this.F_SIGN = (temp >> 7) & 1;
        this.F_ZERO = temp;
        break;
      case 40: // ROR
        if (addrMode === 4) {
          add = this.F_CARRY << 7;
          this.F_CARRY = this.REG_ACC & 1;
          temp = (this.REG_ACC >> 1) + add;
          this.REG_ACC = temp;
        } else {
          temp = this.load(addr);
          add = this.F_CARRY << 7;
          this.F_CARRY = temp & 1;
          temp = (temp >> 1) + add;
          this.write(addr, temp);
        }
        this.F_SIGN = (temp >> 7) & 1;
        this.F_ZERO = temp;
        break;
      case 41: // RTI
        temp = this.pull();
        this.F_CARRY = temp & 1;
        this.F_ZERO = ((temp >> 1) & 1) === 0 ? 1 : 0;
        this.F_INTERRUPT = (temp >> 2) & 1;
        this.F_DECIMAL = (temp >> 3) & 1;
        this.F_BRK = (temp >> 4) & 1;
        this.F_NOTUSED = (temp >> 5) & 1;
        this.F_OVERFLOW = (temp >> 6) & 1;
        this.F_SIGN = (temp >> 7) & 1;
        this.REG_PC = this.pull();
        this.REG_PC += this.pull() << 8;
        if (this.REG_PC === 0xffff) return cycleCount;
        this.REG_PC--;
        this.F_NOTUSED = 1;
        break;
      case 42: // RTS
        this.REG_PC = this.pull();
        this.REG_PC += this.pull() << 8;
        if (this.REG_PC === 0xffff) return cycleCount;
        break;
      case 43: // SBC
        val = this.load(addr);
        temp = this.REG_ACC - val - (1 - this.F_CARRY);
        this.F_SIGN = (temp >> 7) & 1;
        this.F_ZERO = temp & 0xff;
        this.F_OVERFLOW = ((this.REG_ACC ^ temp) & 0x80) !== 0 && ((this.REG_ACC ^ val) & 0x80) !== 0 ? 1 : 0;
        this.F_CARRY = temp < 0 ? 0 : 1;
        this.REG_ACC = temp & 0xff;
        if (addrMode !== 11) cycleCount += cycleAdd;
        break;
      case 44: this.F_CARRY = 1; break; // SEC
      case 45: this.F_DECIMAL = 1; break; // SED
      case 46: this.F_INTERRUPT = 1; break; // SEI
      case 47: this.write(addr, this.REG_ACC); break; // STA
      case 48: this.write(addr, this.REG_X); break; // STX
      case 49: this.write(addr, this.REG_Y); break; // STY
      case 50: // TAX
        this.REG_X = this.REG_ACC;
        this.F_SIGN = (this.REG_ACC >> 7) & 1;
        this.F_ZERO = this.REG_ACC;
        break;
      case 51: // TAY
        this.REG_Y = this.REG_ACC;
        this.F_SIGN = (this.REG_ACC >> 7) & 1;
        this.F_ZERO = this.REG_ACC;
        break;
      case 52: // TSX
        this.REG_X = this.REG_SP & 0xff;
        this.F_SIGN = (this.REG_SP >> 7) & 1;
        this.F_ZERO = this.REG_X;
        break;
      case 53: // TXA
        this.REG_ACC = this.REG_X;
        this.F_SIGN = (this.REG_X >> 7) & 1;
        this.F_ZERO = this.REG_X;
        break;
      case 54: this.REG_SP = this.REG_X & 0xff; break; // TXS
      case 55: // TYA
        this.REG_ACC = this.REG_Y;
        this.F_SIGN = (this.REG_Y >> 7) & 1;
        this.F_ZERO = this.REG_Y;
        break;
      case 56: // ALR
        temp = this.REG_ACC & this.load(addr);
        this.F_CARRY = temp & 1;
        this.REG_ACC = this.F_ZERO = temp >> 1;
        this.F_SIGN = 0;
        break;
      case 57: // ANC
        this.REG_ACC = this.F_ZERO = this.REG_ACC & this.load(addr);
        this.F_CARRY = this.F_SIGN = (this.REG_ACC >> 7) & 1;
        break;
      case 58: // ARR
        temp = this.REG_ACC & this.load(addr);
        this.REG_ACC = this.F_ZERO = (temp >> 1) + (this.F_CARRY << 7);
        this.F_SIGN = this.F_CARRY;
        this.F_CARRY = (temp >> 7) & 1;
        this.F_OVERFLOW = ((temp >> 7) ^ (temp >> 6)) & 1;
        break;
      case 59: // AXS
        val = this.load(addr);
        temp = (this.REG_X & this.REG_ACC) - val;
        this.F_SIGN = (temp >> 7) & 1;
        this.F_ZERO = temp & 0xff;
        this.F_OVERFLOW = ((this.REG_X ^ temp) & 0x80) !== 0 && ((this.REG_X ^ val) & 0x80) !== 0 ? 1 : 0;
        this.F_CARRY = temp < 0 ? 0 : 1;
        this.REG_X = temp & 0xff;
        break;
      case 60: // LAX
        this.REG_ACC = this.REG_X = this.F_ZERO = this.load(addr);
        this.F_SIGN = (this.REG_ACC >> 7) & 1;
        cycleCount += cycleAdd;
        break;
      case 61: this.write(addr, this.REG_ACC & this.REG_X); break; // SAX
      case 62: // DCP
        temp = (this.load(addr) - 1) & 0xff;
        this.write(addr, temp);
        temp = this.REG_ACC - temp;
        this.F_CARRY = temp >= 0 ? 1 : 0;
        this.F_SIGN = (temp >> 7) & 1;
        this.F_ZERO = temp & 0xff;
        if (addrMode !== 11) cycleCount += cycleAdd;
        break;
      case 63: // ISC
        temp = (this.load(addr) + 1) & 0xff;
        this.write(addr, temp);
        val = temp;
        temp = this.REG_ACC - val - (1 - this.F_CARRY);
        this.F_SIGN = (temp >> 7) & 1;
        this.F_ZERO = temp & 0xff;
        this.F_OVERFLOW = ((this.REG_ACC ^ temp) & 0x80) !== 0 && ((this.REG_ACC ^ val) & 0x80) !== 0 ? 1 : 0;
        this.F_CARRY = temp < 0 ? 0 : 1;
        this.REG_ACC = temp & 0xff;
        if (addrMode !== 11) cycleCount += cycleAdd;
        break;
      case 64: // RLA
        temp = this.load(addr);
        add = this.F_CARRY;
        this.F_CARRY = (temp >> 7) & 1;
        temp = ((temp << 1) & 0xff) + add;
        this.write(addr, temp);
        this.REG_ACC &= temp;
        this.F_SIGN = (this.REG_ACC >> 7) & 1;
        this.F_ZERO = this.REG_ACC;
        if (addrMode !== 11) cycleCount += cycleAdd;
        break;
      case 65: // RRA
        temp = this.load(addr);
        add = this.F_CARRY << 7;
        this.F_CARRY = temp & 1;
        temp = (temp >> 1) + add;
        this.write(addr, temp);
        val = temp;
        temp = this.REG_ACC + val + this.F_CARRY;
        this.F_OVERFLOW = ((this.REG_ACC ^ val) & 0x80) === 0 && ((this.REG_ACC ^ temp) & 0x80) !== 0 ? 1 : 0;
        this.F_CARRY = temp > 255 ? 1 : 0;
        this.F_SIGN = (temp >> 7) & 1;
        this.F_ZERO = temp & 0xff;
        this.REG_ACC = temp & 0xff;
        if (addrMode !== 11) cycleCount += cycleAdd;
        break;
      case 66: // SLO
        temp = this.load(addr);
        this.F_CARRY = (temp >> 7) & 1;
        temp = (temp << 1) & 0xff;
        this.write(addr, temp);
        this.REG_ACC |= temp;
        this.F_SIGN = (this.REG_ACC >> 7) & 1;
        this.F_ZERO = this.REG_ACC;
        if (addrMode !== 11) cycleCount += cycleAdd;
        break;
      case 67: // SRE
        temp = this.load(addr);
        this.F_CARRY = temp & 1;
        temp >>= 1;
        this.write(addr, temp);
        this.REG_ACC ^= temp;
        this.F_SIGN = (this.REG_ACC >> 7) & 1;
        this.F_ZERO = this.REG_ACC;
        if (addrMode !== 11) cycleCount += cycleAdd;
        break;
      case 68: break; // SKB
      case 69: // IGN
        this.load(addr);
        if (addrMode !== 11) cycleCount += cycleAdd;
        break;
      default:
        this.nes.stop();
        this.nes.crashMessage = "Game crashed, invalid opcode at address $" + opaddr.toString(16);
        break;
    }

    return cycleCount;
  }

  load(addr) {
    return addr < 0x2000 ? this.mem[addr & 0x7ff] : this.nes.mmap.load(addr);
  }

  load16bit(addr) {
    return addr < 0x1fff
      ? this.mem[addr & 0x7ff] | (this.mem[(addr + 1) & 0x7ff] << 8)
      : this.nes.mmap.load(addr) | (this.nes.mmap.load(addr + 1) << 8);
  }

  write(addr, val) {
    if (addr < 0x2000) this.mem[addr & 0x7ff] = val;
    else this.nes.mmap.write(addr, val);
  }

  requestIrq(type) {
    if (this.irqRequested && type === CPU.IRQ_NORMAL) return;
    this.irqRequested = true;
    this.irqType = type;
  }

  push(value) {
    this.nes.mmap.write(this.REG_SP | 0x100, value);
    this.REG_SP = (this.REG_SP - 1) & 0xff;
  }

  pull() {
    this.REG_SP = (this.REG_SP + 1) & 0xff;
    return this.nes.mmap.load(0x100 | this.REG_SP);
  }

  haltCycles(cycles) {
    this.cyclesToHalt += cycles;
  }

  doNonMaskableInterrupt(status) {
    const mmap = this.nes.mmap;
    if (mmap === null) return;
    if ((mmap.load(0x2000) & 128) !== 0) {
      this.REG_PC_NEW++;
      this.push((this.REG_PC_NEW >> 8) & 0xff);
      this.push(this.REG_PC_NEW & 0xff);
      this.push(status);
      this.REG_PC_NEW = mmap.load(0xfffa) | (mmap.load(0xfffb) << 8);
      this.REG_PC_NEW--;
    }
  }

  doResetInterrupt() {
    const mmap = this.nes.mmap;
    this.REG_PC_NEW = mmap.load(0xfffc) | (mmap.load(0xfffd) << 8);
    this.REG_PC_NEW--;
  }

  doIrq(status) {
    const mmap = this.nes.mmap;
    this.REG_PC_NEW++;
    this.push((this.REG_PC_NEW >> 8) & 0xff);
    this.push(this.REG_PC_NEW & 0xff);
    this.push(status);
    this.F_INTERRUPT_NEW = 1;
    this.F_BRK_NEW = 0;
    this.REG_PC_NEW = mmap.load(0xfffe) | (mmap.load(0xffff) << 8);
    this.REG_PC_NEW--;
  }

  getStatus() {
    return (
      this.F_CARRY | (this.F_ZERO << 1) | (this.F_INTERRUPT << 2) | (this.F_DECIMAL << 3) |
      (this.F_BRK << 4) | (this.F_NOTUSED << 5) | (this.F_OVERFLOW << 6) | (this.F_SIGN << 7)
    );
  }

  setStatus(st) {
    this.F_CARRY = st & 1;
    this.F_ZERO = (st >> 1) & 1;
    this.F_INTERRUPT = (st >> 2) & 1;
    this.F_DECIMAL = (st >> 3) & 1;
    this.F_BRK = (st >> 4) & 1;
    this.F_NOTUSED = (st >> 5) & 1;
    this.F_OVERFLOW = (st >> 6) & 1;
    this.F_SIGN = (st >> 7) & 1;
  }

  toJSON() {
    const state = {};
    for (let i = 0; i < CPU.JSON_PROPERTIES.length; i++) {
      state[CPU.JSON_PROPERTIES[i]] = this[CPU.JSON_PROPERTIES[i]];
    }
    state.mem = Array.from(this.mem);
    return state;
  }

  fromJSON(s) {
    for (let i = 0; i < CPU.JSON_PROPERTIES.length; i++) {
      this[CPU.JSON_PROPERTIES[i]] = s[CPU.JSON_PROPERTIES[i]];
    }
    this.mem = new Uint8Array(s.mem);
  }
}

// Build opcode data table once at module load
function buildOpData() {
  const opdata = new Uint32Array(256);
  const ADDR_ZP = 0, ADDR_REL = 1, ADDR_IMP = 2, ADDR_ABS = 3, ADDR_ACC = 4;
  const ADDR_IMM = 5, ADDR_ZPX = 6, ADDR_ZPY = 7, ADDR_ABSX = 8, ADDR_ABSY = 9;
  const ADDR_PREIDXIND = 10, ADDR_POSTIDXIND = 11, ADDR_INDABS = 12;

  const INS_ADC = 0, INS_AND = 1, INS_ASL = 2, INS_BCC = 3, INS_BCS = 4;
  const INS_BEQ = 5, INS_BIT = 6, INS_BMI = 7, INS_BNE = 8, INS_BPL = 9;
  const INS_BRK = 10, INS_BVC = 11, INS_BVS = 12, INS_CLC = 13, INS_CLD = 14;
  const INS_CLI = 15, INS_CLV = 16, INS_CMP = 17, INS_CPX = 18, INS_CPY = 19;
  const INS_DEC = 20, INS_DEX = 21, INS_DEY = 22, INS_EOR = 23, INS_INC = 24;
  const INS_INX = 25, INS_INY = 26, INS_JMP = 27, INS_JSR = 28, INS_LDA = 29;
  const INS_LDX = 30, INS_LDY = 31, INS_LSR = 32, INS_NOP = 33, INS_ORA = 34;
  const INS_PHA = 35, INS_PHP = 36, INS_PLA = 37, INS_PLP = 38, INS_ROL = 39;
  const INS_ROR = 40, INS_RTI = 41, INS_RTS = 42, INS_SBC = 43, INS_SEC = 44;
  const INS_SED = 45, INS_SEI = 46, INS_STA = 47, INS_STX = 48, INS_STY = 49;
  const INS_TAX = 50, INS_TAY = 51, INS_TSX = 52, INS_TXA = 53, INS_TXS = 54;
  const INS_TYA = 55, INS_ALR = 56, INS_ANC = 57, INS_ARR = 58, INS_AXS = 59;
  const INS_LAX = 60, INS_SAX = 61, INS_DCP = 62, INS_ISC = 63, INS_RLA = 64;
  const INS_RRA = 65, INS_SLO = 66, INS_SRE = 67, INS_SKB = 68, INS_IGN = 69;

  const setOp = (inst, op, addr, size, cycles) => {
    opdata[op] = (inst & 0xff) | ((addr & 0xff) << 8) | ((size & 0xff) << 16) | ((cycles & 0xff) << 24);
  };

  for (let i = 0; i < 256; i++) opdata[i] = 0xff;

  // ADC
  setOp(INS_ADC, 0x69, ADDR_IMM, 2, 2); setOp(INS_ADC, 0x65, ADDR_ZP, 2, 3);
  setOp(INS_ADC, 0x75, ADDR_ZPX, 2, 4); setOp(INS_ADC, 0x6d, ADDR_ABS, 3, 4);
  setOp(INS_ADC, 0x7d, ADDR_ABSX, 3, 4); setOp(INS_ADC, 0x79, ADDR_ABSY, 3, 4);
  setOp(INS_ADC, 0x61, ADDR_PREIDXIND, 2, 6); setOp(INS_ADC, 0x71, ADDR_POSTIDXIND, 2, 5);
  // AND
  setOp(INS_AND, 0x29, ADDR_IMM, 2, 2); setOp(INS_AND, 0x25, ADDR_ZP, 2, 3);
  setOp(INS_AND, 0x35, ADDR_ZPX, 2, 4); setOp(INS_AND, 0x2d, ADDR_ABS, 3, 4);
  setOp(INS_AND, 0x3d, ADDR_ABSX, 3, 4); setOp(INS_AND, 0x39, ADDR_ABSY, 3, 4);
  setOp(INS_AND, 0x21, ADDR_PREIDXIND, 2, 6); setOp(INS_AND, 0x31, ADDR_POSTIDXIND, 2, 5);
  // ASL
  setOp(INS_ASL, 0x0a, ADDR_ACC, 1, 2); setOp(INS_ASL, 0x06, ADDR_ZP, 2, 5);
  setOp(INS_ASL, 0x16, ADDR_ZPX, 2, 6); setOp(INS_ASL, 0x0e, ADDR_ABS, 3, 6);
  setOp(INS_ASL, 0x1e, ADDR_ABSX, 3, 7);
  // Branch
  setOp(INS_BCC, 0x90, ADDR_REL, 2, 2); setOp(INS_BCS, 0xb0, ADDR_REL, 2, 2);
  setOp(INS_BEQ, 0xf0, ADDR_REL, 2, 2); setOp(INS_BMI, 0x30, ADDR_REL, 2, 2);
  setOp(INS_BNE, 0xd0, ADDR_REL, 2, 2); setOp(INS_BPL, 0x10, ADDR_REL, 2, 2);
  setOp(INS_BVC, 0x50, ADDR_REL, 2, 2); setOp(INS_BVS, 0x70, ADDR_REL, 2, 2);
  // BIT
  setOp(INS_BIT, 0x24, ADDR_ZP, 2, 3); setOp(INS_BIT, 0x2c, ADDR_ABS, 3, 4);
  // BRK
  setOp(INS_BRK, 0x00, ADDR_IMP, 1, 7);
  // Flags
  setOp(INS_CLC, 0x18, ADDR_IMP, 1, 2); setOp(INS_CLD, 0xd8, ADDR_IMP, 1, 2);
  setOp(INS_CLI, 0x58, ADDR_IMP, 1, 2); setOp(INS_CLV, 0xb8, ADDR_IMP, 1, 2);
  setOp(INS_SEC, 0x38, ADDR_IMP, 1, 2); setOp(INS_SED, 0xf8, ADDR_IMP, 1, 2);
  setOp(INS_SEI, 0x78, ADDR_IMP, 1, 2);
  // CMP
  setOp(INS_CMP, 0xc9, ADDR_IMM, 2, 2); setOp(INS_CMP, 0xc5, ADDR_ZP, 2, 3);
  setOp(INS_CMP, 0xd5, ADDR_ZPX, 2, 4); setOp(INS_CMP, 0xcd, ADDR_ABS, 3, 4);
  setOp(INS_CMP, 0xdd, ADDR_ABSX, 3, 4); setOp(INS_CMP, 0xd9, ADDR_ABSY, 3, 4);
  setOp(INS_CMP, 0xc1, ADDR_PREIDXIND, 2, 6); setOp(INS_CMP, 0xd1, ADDR_POSTIDXIND, 2, 5);
  // CPX/CPY
  setOp(INS_CPX, 0xe0, ADDR_IMM, 2, 2); setOp(INS_CPX, 0xe4, ADDR_ZP, 2, 3);
  setOp(INS_CPX, 0xec, ADDR_ABS, 3, 4); setOp(INS_CPY, 0xc0, ADDR_IMM, 2, 2);
  setOp(INS_CPY, 0xc4, ADDR_ZP, 2, 3); setOp(INS_CPY, 0xcc, ADDR_ABS, 3, 4);
  // DEC
  setOp(INS_DEC, 0xc6, ADDR_ZP, 2, 5); setOp(INS_DEC, 0xd6, ADDR_ZPX, 2, 6);
  setOp(INS_DEC, 0xce, ADDR_ABS, 3, 6); setOp(INS_DEC, 0xde, ADDR_ABSX, 3, 7);
  setOp(INS_DEX, 0xca, ADDR_IMP, 1, 2); setOp(INS_DEY, 0x88, ADDR_IMP, 1, 2);
  // EOR
  setOp(INS_EOR, 0x49, ADDR_IMM, 2, 2); setOp(INS_EOR, 0x45, ADDR_ZP, 2, 3);
  setOp(INS_EOR, 0x55, ADDR_ZPX, 2, 4); setOp(INS_EOR, 0x4d, ADDR_ABS, 3, 4);
  setOp(INS_EOR, 0x5d, ADDR_ABSX, 3, 4); setOp(INS_EOR, 0x59, ADDR_ABSY, 3, 4);
  setOp(INS_EOR, 0x41, ADDR_PREIDXIND, 2, 6); setOp(INS_EOR, 0x51, ADDR_POSTIDXIND, 2, 5);
  // INC
  setOp(INS_INC, 0xe6, ADDR_ZP, 2, 5); setOp(INS_INC, 0xf6, ADDR_ZPX, 2, 6);
  setOp(INS_INC, 0xee, ADDR_ABS, 3, 6); setOp(INS_INC, 0xfe, ADDR_ABSX, 3, 7);
  setOp(INS_INX, 0xe8, ADDR_IMP, 1, 2); setOp(INS_INY, 0xc8, ADDR_IMP, 1, 2);
  // JMP/JSR
  setOp(INS_JMP, 0x4c, ADDR_ABS, 3, 3); setOp(INS_JMP, 0x6c, ADDR_INDABS, 3, 5);
  setOp(INS_JSR, 0x20, ADDR_ABS, 3, 6);
  // LDA
  setOp(INS_LDA, 0xa9, ADDR_IMM, 2, 2); setOp(INS_LDA, 0xa5, ADDR_ZP, 2, 3);
  setOp(INS_LDA, 0xb5, ADDR_ZPX, 2, 4); setOp(INS_LDA, 0xad, ADDR_ABS, 3, 4);
  setOp(INS_LDA, 0xbd, ADDR_ABSX, 3, 4); setOp(INS_LDA, 0xb9, ADDR_ABSY, 3, 4);
  setOp(INS_LDA, 0xa1, ADDR_PREIDXIND, 2, 6); setOp(INS_LDA, 0xb1, ADDR_POSTIDXIND, 2, 5);
  // LDX
  setOp(INS_LDX, 0xa2, ADDR_IMM, 2, 2); setOp(INS_LDX, 0xa6, ADDR_ZP, 2, 3);
  setOp(INS_LDX, 0xb6, ADDR_ZPY, 2, 4); setOp(INS_LDX, 0xae, ADDR_ABS, 3, 4);
  setOp(INS_LDX, 0xbe, ADDR_ABSY, 3, 4);
  // LDY
  setOp(INS_LDY, 0xa0, ADDR_IMM, 2, 2); setOp(INS_LDY, 0xa4, ADDR_ZP, 2, 3);
  setOp(INS_LDY, 0xb4, ADDR_ZPX, 2, 4); setOp(INS_LDY, 0xac, ADDR_ABS, 3, 4);
  setOp(INS_LDY, 0xbc, ADDR_ABSX, 3, 4);
  // LSR
  setOp(INS_LSR, 0x4a, ADDR_ACC, 1, 2); setOp(INS_LSR, 0x46, ADDR_ZP, 2, 5);
  setOp(INS_LSR, 0x56, ADDR_ZPX, 2, 6); setOp(INS_LSR, 0x4e, ADDR_ABS, 3, 6);
  setOp(INS_LSR, 0x5e, ADDR_ABSX, 3, 7);
  // NOP
  setOp(INS_NOP, 0x1a, ADDR_IMP, 1, 2); setOp(INS_NOP, 0x3a, ADDR_IMP, 1, 2);
  setOp(INS_NOP, 0x5a, ADDR_IMP, 1, 2); setOp(INS_NOP, 0x7a, ADDR_IMP, 1, 2);
  setOp(INS_NOP, 0xda, ADDR_IMP, 1, 2); setOp(INS_NOP, 0xea, ADDR_IMP, 1, 2);
  setOp(INS_NOP, 0xfa, ADDR_IMP, 1, 2);
  // ORA
  setOp(INS_ORA, 0x09, ADDR_IMM, 2, 2); setOp(INS_ORA, 0x05, ADDR_ZP, 2, 3);
  setOp(INS_ORA, 0x15, ADDR_ZPX, 2, 4); setOp(INS_ORA, 0x0d, ADDR_ABS, 3, 4);
  setOp(INS_ORA, 0x1d, ADDR_ABSX, 3, 4); setOp(INS_ORA, 0x19, ADDR_ABSY, 3, 4);
  setOp(INS_ORA, 0x01, ADDR_PREIDXIND, 2, 6); setOp(INS_ORA, 0x11, ADDR_POSTIDXIND, 2, 5);
  // Stack
  setOp(INS_PHA, 0x48, ADDR_IMP, 1, 3); setOp(INS_PHP, 0x08, ADDR_IMP, 1, 3);
  setOp(INS_PLA, 0x68, ADDR_IMP, 1, 4); setOp(INS_PLP, 0x28, ADDR_IMP, 1, 4);
  // ROL
  setOp(INS_ROL, 0x2a, ADDR_ACC, 1, 2); setOp(INS_ROL, 0x26, ADDR_ZP, 2, 5);
  setOp(INS_ROL, 0x36, ADDR_ZPX, 2, 6); setOp(INS_ROL, 0x2e, ADDR_ABS, 3, 6);
  setOp(INS_ROL, 0x3e, ADDR_ABSX, 3, 7);
  // ROR
  setOp(INS_ROR, 0x6a, ADDR_ACC, 1, 2); setOp(INS_ROR, 0x66, ADDR_ZP, 2, 5);
  setOp(INS_ROR, 0x76, ADDR_ZPX, 2, 6); setOp(INS_ROR, 0x6e, ADDR_ABS, 3, 6);
  setOp(INS_ROR, 0x7e, ADDR_ABSX, 3, 7);
  // RTI/RTS
  setOp(INS_RTI, 0x40, ADDR_IMP, 1, 6); setOp(INS_RTS, 0x60, ADDR_IMP, 1, 6);
  // SBC
  setOp(INS_SBC, 0xe9, ADDR_IMM, 2, 2); setOp(INS_SBC, 0xe5, ADDR_ZP, 2, 3);
  setOp(INS_SBC, 0xf5, ADDR_ZPX, 2, 4); setOp(INS_SBC, 0xed, ADDR_ABS, 3, 4);
  setOp(INS_SBC, 0xfd, ADDR_ABSX, 3, 4); setOp(INS_SBC, 0xf9, ADDR_ABSY, 3, 4);
  setOp(INS_SBC, 0xe1, ADDR_PREIDXIND, 2, 6); setOp(INS_SBC, 0xf1, ADDR_POSTIDXIND, 2, 5);
  // STA
  setOp(INS_STA, 0x85, ADDR_ZP, 2, 3); setOp(INS_STA, 0x95, ADDR_ZPX, 2, 4);
  setOp(INS_STA, 0x8d, ADDR_ABS, 3, 4); setOp(INS_STA, 0x9d, ADDR_ABSX, 3, 5);
  setOp(INS_STA, 0x99, ADDR_ABSY, 3, 5); setOp(INS_STA, 0x81, ADDR_PREIDXIND, 2, 6);
  setOp(INS_STA, 0x91, ADDR_POSTIDXIND, 2, 6);
  // STX/STY
  setOp(INS_STX, 0x86, ADDR_ZP, 2, 3); setOp(INS_STX, 0x96, ADDR_ZPY, 2, 4);
  setOp(INS_STX, 0x8e, ADDR_ABS, 3, 4); setOp(INS_STY, 0x84, ADDR_ZP, 2, 3);
  setOp(INS_STY, 0x94, ADDR_ZPX, 2, 4); setOp(INS_STY, 0x8c, ADDR_ABS, 3, 4);
  // Transfers
  setOp(INS_TAX, 0xaa, ADDR_IMP, 1, 2); setOp(INS_TAY, 0xa8, ADDR_IMP, 1, 2);
  setOp(INS_TSX, 0xba, ADDR_IMP, 1, 2); setOp(INS_TXA, 0x8a, ADDR_IMP, 1, 2);
  setOp(INS_TXS, 0x9a, ADDR_IMP, 1, 2); setOp(INS_TYA, 0x98, ADDR_IMP, 1, 2);
  // Illegal
  setOp(INS_ALR, 0x4b, ADDR_IMM, 2, 2); setOp(INS_ANC, 0x0b, ADDR_IMM, 2, 2);
  setOp(INS_ANC, 0x2b, ADDR_IMM, 2, 2); setOp(INS_ARR, 0x6b, ADDR_IMM, 2, 2);
  setOp(INS_AXS, 0xcb, ADDR_IMM, 2, 2);
  // LAX
  setOp(INS_LAX, 0xa3, ADDR_PREIDXIND, 2, 6); setOp(INS_LAX, 0xa7, ADDR_ZP, 2, 3);
  setOp(INS_LAX, 0xaf, ADDR_ABS, 3, 4); setOp(INS_LAX, 0xb3, ADDR_POSTIDXIND, 2, 5);
  setOp(INS_LAX, 0xb7, ADDR_ZPY, 2, 4); setOp(INS_LAX, 0xbf, ADDR_ABSY, 3, 4);
  // SAX
  setOp(INS_SAX, 0x83, ADDR_PREIDXIND, 2, 6); setOp(INS_SAX, 0x87, ADDR_ZP, 2, 3);
  setOp(INS_SAX, 0x8f, ADDR_ABS, 3, 4); setOp(INS_SAX, 0x97, ADDR_ZPY, 2, 4);
  // DCP
  setOp(INS_DCP, 0xc3, ADDR_PREIDXIND, 2, 8); setOp(INS_DCP, 0xc7, ADDR_ZP, 2, 5);
  setOp(INS_DCP, 0xcf, ADDR_ABS, 3, 6); setOp(INS_DCP, 0xd3, ADDR_POSTIDXIND, 2, 8);
  setOp(INS_DCP, 0xd7, ADDR_ZPX, 2, 6); setOp(INS_DCP, 0xdb, ADDR_ABSY, 3, 7);
  setOp(INS_DCP, 0xdf, ADDR_ABSX, 3, 7);
  // ISC
  setOp(INS_ISC, 0xe3, ADDR_PREIDXIND, 2, 8); setOp(INS_ISC, 0xe7, ADDR_ZP, 2, 5);
  setOp(INS_ISC, 0xef, ADDR_ABS, 3, 6); setOp(INS_ISC, 0xf3, ADDR_POSTIDXIND, 2, 8);
  setOp(INS_ISC, 0xf7, ADDR_ZPX, 2, 6); setOp(INS_ISC, 0xfb, ADDR_ABSY, 3, 7);
  setOp(INS_ISC, 0xff, ADDR_ABSX, 3, 7);
  // RLA
  setOp(INS_RLA, 0x23, ADDR_PREIDXIND, 2, 8); setOp(INS_RLA, 0x27, ADDR_ZP, 2, 5);
  setOp(INS_RLA, 0x2f, ADDR_ABS, 3, 6); setOp(INS_RLA, 0x33, ADDR_POSTIDXIND, 2, 8);
  setOp(INS_RLA, 0x37, ADDR_ZPX, 2, 6); setOp(INS_RLA, 0x3b, ADDR_ABSY, 3, 7);
  setOp(INS_RLA, 0x3f, ADDR_ABSX, 3, 7);
  // RRA
  setOp(INS_RRA, 0x63, ADDR_PREIDXIND, 2, 8); setOp(INS_RRA, 0x67, ADDR_ZP, 2, 5);
  setOp(INS_RRA, 0x6f, ADDR_ABS, 3, 6); setOp(INS_RRA, 0x73, ADDR_POSTIDXIND, 2, 8);
  setOp(INS_RRA, 0x77, ADDR_ZPX, 2, 6); setOp(INS_RRA, 0x7b, ADDR_ABSY, 3, 7);
  setOp(INS_RRA, 0x7f, ADDR_ABSX, 3, 7);
  // SLO
  setOp(INS_SLO, 0x03, ADDR_PREIDXIND, 2, 8); setOp(INS_SLO, 0x07, ADDR_ZP, 2, 5);
  setOp(INS_SLO, 0x0f, ADDR_ABS, 3, 6); setOp(INS_SLO, 0x13, ADDR_POSTIDXIND, 2, 8);
  setOp(INS_SLO, 0x17, ADDR_ZPX, 2, 6); setOp(INS_SLO, 0x1b, ADDR_ABSY, 3, 7);
  setOp(INS_SLO, 0x1f, ADDR_ABSX, 3, 7);
  // SRE
  setOp(INS_SRE, 0x43, ADDR_PREIDXIND, 2, 8); setOp(INS_SRE, 0x47, ADDR_ZP, 2, 5);
  setOp(INS_SRE, 0x4f, ADDR_ABS, 3, 6); setOp(INS_SRE, 0x53, ADDR_POSTIDXIND, 2, 8);
  setOp(INS_SRE, 0x57, ADDR_ZPX, 2, 6); setOp(INS_SRE, 0x5b, ADDR_ABSY, 3, 7);
  setOp(INS_SRE, 0x5f, ADDR_ABSX, 3, 7);
  // SKB
  setOp(INS_SKB, 0x80, ADDR_IMM, 2, 2); setOp(INS_SKB, 0x82, ADDR_IMM, 2, 2);
  setOp(INS_SKB, 0x89, ADDR_IMM, 2, 2); setOp(INS_SKB, 0xc2, ADDR_IMM, 2, 2);
  setOp(INS_SKB, 0xe2, ADDR_IMM, 2, 2);
  // IGN
  setOp(INS_IGN, 0x0c, ADDR_ABS, 3, 4); setOp(INS_IGN, 0x1c, ADDR_ABSX, 3, 4);
  setOp(INS_IGN, 0x3c, ADDR_ABSX, 3, 4); setOp(INS_IGN, 0x5c, ADDR_ABSX, 3, 4);
  setOp(INS_IGN, 0x7c, ADDR_ABSX, 3, 4); setOp(INS_IGN, 0xdc, ADDR_ABSX, 3, 4);
  setOp(INS_IGN, 0xfc, ADDR_ABSX, 3, 4); setOp(INS_IGN, 0x04, ADDR_ZP, 2, 3);
  setOp(INS_IGN, 0x44, ADDR_ZP, 2, 3); setOp(INS_IGN, 0x64, ADDR_ZP, 2, 3);
  setOp(INS_IGN, 0x14, ADDR_ZPX, 2, 4); setOp(INS_IGN, 0x34, ADDR_ZPX, 2, 4);
  setOp(INS_IGN, 0x54, ADDR_ZPX, 2, 4); setOp(INS_IGN, 0x74, ADDR_ZPX, 2, 4);
  setOp(INS_IGN, 0xd4, ADDR_ZPX, 2, 4); setOp(INS_IGN, 0xf4, ADDR_ZPX, 2, 4);

  return opdata;
}
