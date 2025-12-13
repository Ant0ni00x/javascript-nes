import { Mappers } from "./mappers.js";
import { Tile } from "./tile.js";

export class ROM {
  constructor(nes) {
    this.nes = nes;

    this.mapperName = new Array(92).fill("Unknown Mapper");
    this.mapperName[0] = "Direct Access";
    this.mapperName[1] = "Nintendo MMC1";
    this.mapperName[2] = "UNROM";
    this.mapperName[3] = "CNROM";
    this.mapperName[4] = "Nintendo MMC3";
    this.mapperName[5] = "Nintendo MMC5";
    this.mapperName[6] = "FFE F4xxx";
    this.mapperName[7] = "AOROM";
    this.mapperName[8] = "FFE F3xxx";
    this.mapperName[9] = "Nintendo MMC2";
    this.mapperName[10] = "Nintendo MMC4";
    this.mapperName[11] = "Color Dreams Chip";
    this.mapperName[12] = "FFE F6xxx";
    this.mapperName[15] = "100-in-1 switch";
    this.mapperName[16] = "Bandai chip";
    this.mapperName[17] = "FFE F8xxx";
    this.mapperName[18] = "Jaleco SS8806 chip";
    this.mapperName[19] = "Namcot 106 chip";
    this.mapperName[20] = "Famicom Disk System";
    this.mapperName[21] = "Konami VRC4a";
    this.mapperName[22] = "Konami VRC2a";
    this.mapperName[23] = "Konami VRC2a";
    this.mapperName[24] = "Konami VRC6";
    this.mapperName[25] = "Konami VRC4b";
    this.mapperName[32] = "Irem G-101 chip";
    this.mapperName[33] = "Taito TC0190/TC0350";
    this.mapperName[34] = "32kB ROM switch";
    this.mapperName[64] = "Tengen RAMBO-1 chip";
    this.mapperName[65] = "Irem H-3001 chip";
    this.mapperName[66] = "GNROM switch";
    this.mapperName[67] = "SunSoft3 chip";
    this.mapperName[68] = "SunSoft4 chip";
    this.mapperName[69] = "SunSoft5 FME-7 chip";
    this.mapperName[71] = "Camerica chip";
    this.mapperName[78] = "Irem 74HC161/32-based";
    this.mapperName[91] = "Pirate HK-SF3 chip";

    // Mirroring types:
    this.VERTICAL_MIRRORING = 0;
    this.HORIZONTAL_MIRRORING = 1;
    this.FOURSCREEN_MIRRORING = 2;
    this.SINGLESCREEN_MIRRORING = 3;
    this.SINGLESCREEN_MIRRORING2 = 4;
    this.SINGLESCREEN_MIRRORING3 = 5;
    this.SINGLESCREEN_MIRRORING4 = 6;
    this.CHRROM_MIRRORING = 7;

    this.header = null;
    this.rom = null;
    this.vrom = null;
    this.vromTile = null;

    this.romCount = null;
    this.vromCount = null;
    this.mirroring = null;
    this.batteryRam = null;
    this.trainer = null;
    this.fourScreen = null;
    this.mapperType = null;
    this.valid = false;
  }

  load(data) {
    if (data.indexOf("NES\x1a") === -1) {
      throw new Error("Not a valid NES ROM.");
    }
    this.header = new Array(16);
    for (let i = 0; i < 16; i++) {
      this.header[i] = data.charCodeAt(i) & 0xff;
    }
    this.romCount = this.header[4];
    this.vromCount = this.header[5] * 2;
    this.mirroring = (this.header[6] & 1) !== 0 ? 1 : 0;
    this.batteryRam = (this.header[6] & 2) !== 0;
    this.trainer = (this.header[6] & 4) !== 0;
    this.fourScreen = (this.header[6] & 8) !== 0;
    this.mapperType = (this.header[6] >> 4) | (this.header[7] & 0xf0);

    let foundError = false;
    for (let i = 8; i < 16; i++) {
      if (this.header[i] !== 0) {
        foundError = true;
        break;
      }
    }
    if (foundError) {
      this.mapperType &= 0xf;
    }

    this.rom = new Array(this.romCount);
    let offset = 16;
    for (let i = 0; i < this.romCount; i++) {
      this.rom[i] = new Array(16384);
      for (let j = 0; j < 16384; j++) {
        if (offset + j >= data.length) break;
        this.rom[i][j] = data.charCodeAt(offset + j) & 0xff;
      }
      offset += 16384;
    }

    this.vrom = new Array(this.vromCount);
    for (let i = 0; i < this.vromCount; i++) {
      this.vrom[i] = new Array(4096);
      for (let j = 0; j < 4096; j++) {
        if (offset + j >= data.length) break;
        this.vrom[i][j] = data.charCodeAt(offset + j) & 0xff;
      }
      offset += 4096;
    }

    this.vromTile = new Array(this.vromCount);
    for (let i = 0; i < this.vromCount; i++) {
      this.vromTile[i] = new Array(256);
      for (let j = 0; j < 256; j++) {
        this.vromTile[i][j] = new Tile();
      }
    }

    for (let v = 0; v < this.vromCount; v++) {
      for (let i = 0; i < 4096; i++) {
        let tileIndex = i >> 4;
        let leftOver = i % 16;
        if (leftOver < 8) {
          this.vromTile[v][tileIndex].setScanline(leftOver, this.vrom[v][i], this.vrom[v][i + 8]);
        } else {
          this.vromTile[v][tileIndex].setScanline(leftOver - 8, this.vrom[v][i - 8], this.vrom[v][i]);
        }
      }
    }

    this.valid = true;
  }

  getMirroringType() {
    if (this.fourScreen) return this.FOURSCREEN_MIRRORING;
    if (this.mirroring === 0) return this.HORIZONTAL_MIRRORING;
    return this.VERTICAL_MIRRORING;
  }

  getMapperName() {
    if (this.mapperType >= 0 && this.mapperType < this.mapperName.length) {
      return this.mapperName[this.mapperType];
    }
    return "Unknown Mapper, " + this.mapperType;
  }

  mapperSupported() {
    return typeof Mappers[this.mapperType] !== "undefined";
  }

  createMapper() {
    if (this.mapperSupported()) {
      return new Mappers[this.mapperType](this.nes);
    } else {
      throw new Error("This ROM uses a mapper not supported by JSNES: " + this.getMapperName() + "(" + this.mapperType + ")");
    }
  }
}