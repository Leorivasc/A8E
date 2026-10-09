(function (root) {
  "use strict";

  const ATR_HEADER_SIZE = 16;
  const BOOT_SECTOR_COUNT = 3;
  const BOOT_SECTOR_SIZE = 128;
  const VTOC_SECTOR = 360;
  const DIRECTORY_START_SECTOR = 361;
  const DIRECTORY_SECTOR_COUNT = 8;
  const DIRECTORY_ENTRIES_PER_SECTOR = 8;
  const DIRECTORY_ENTRY_SIZE = 16;

  function toBytes(data) {
    if (data instanceof Uint8Array) return new Uint8Array(data);
    if (data instanceof ArrayBuffer) return new Uint8Array(data.slice(0));
    if (ArrayBuffer.isView(data)) {
      return new Uint8Array(
        data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
      );
    }
    return new Uint8Array(0);
  }

  function readWord(bytes, offset) {
    return (bytes[offset] | (bytes[offset + 1] << 8)) >>> 0;
  }

  function readAtrParagraphs(bytes) {
    return (
      bytes[2] +
      bytes[3] * 0x100 +
      bytes[6] * 0x10000 +
      bytes[7] * 0x1000000
    );
  }

  function sectorOffset(sector, sectorSize) {
    if (sector < 1) return -1;
    if (sector <= BOOT_SECTOR_COUNT) {
      return ATR_HEADER_SIZE + (sector - 1) * BOOT_SECTOR_SIZE;
    }
    return ATR_HEADER_SIZE + BOOT_SECTOR_COUNT * BOOT_SECTOR_SIZE +
      (sector - (BOOT_SECTOR_COUNT + 1)) * sectorSize;
  }

  function readSector(bytes, sector, sectorSize) {
    const offset = sectorOffset(sector, sectorSize);
    const size = sector <= BOOT_SECTOR_COUNT ? BOOT_SECTOR_SIZE : sectorSize;
    if (offset < 0 || offset + size > bytes.length) return null;
    return bytes.slice(offset, offset + size);
  }

  function cleanName(bytes, offset) {
    let value = "";
    for (let i = 0; i < 11; i++) {
      const code = bytes[offset + i] & 0x7f;
      if (code === 0) break;
      value += code >= 0x20 && code <= 0x7e ? String.fromCharCode(code) : "?";
    }
    return value.trimEnd();
  }

  function isDirectoryEntry(entry) {
    return (entry.status & 0x40) !== 0 && (entry.status & 0x80) === 0;
  }

  function readDirectoryEntries(bytes, info) {
    const entries = [];
    for (let sectorIndex = 0; sectorIndex < DIRECTORY_SECTOR_COUNT; sectorIndex++) {
      const sector = readSector(
        bytes,
        DIRECTORY_START_SECTOR + sectorIndex,
        info.sectorSize,
      );
      if (!sector || sector.length < DIRECTORY_ENTRIES_PER_SECTOR * DIRECTORY_ENTRY_SIZE) {
        return null;
      }
      for (let slot = 0; slot < DIRECTORY_ENTRIES_PER_SECTOR; slot++) {
        const offset = slot * DIRECTORY_ENTRY_SIZE;
        const status = sector[offset];
        const entry = {
          index: sectorIndex * DIRECTORY_ENTRIES_PER_SECTOR + slot,
          status: status,
          locked: (status & 0x20) !== 0,
          open: (status & 0x01) !== 0,
          sectors: readWord(sector, offset + 1),
          startSector: readWord(sector, offset + 3),
          name: cleanName(sector, offset + 5),
        };
        if (isDirectoryEntry(entry)) {
          if (!entry.name || entry.sectors === 0 || entry.startSector < 1 ||
              entry.startSector > info.totalSectors) {
            return null;
          }
          entries.push(entry);
        }
      }
    }
    return entries;
  }

  function inspect(data) {
    const bytes = toBytes(data);
    const result = {
      valid: false,
      error: null,
      header: null,
      filesystem: null,
      entries: [],
    };
    if (bytes.length < ATR_HEADER_SIZE) {
      result.error = "ATR image is shorter than its header";
      return result;
    }
    if (bytes[0] !== 0x96 || bytes[1] !== 0x02) {
      result.error = "Invalid ATR signature";
      return result;
    }
    const sectorSize = readWord(bytes, 4);
    const paragraphs = readAtrParagraphs(bytes);
    const dataBytes = paragraphs * 16;
    if (sectorSize < 128 || sectorSize > 4096 || dataBytes < BOOT_SECTOR_COUNT * BOOT_SECTOR_SIZE) {
      result.error = "Invalid ATR geometry";
      return result;
    }
    const remaining = dataBytes - BOOT_SECTOR_COUNT * BOOT_SECTOR_SIZE;
    if (remaining % sectorSize !== 0 || bytes.length !== ATR_HEADER_SIZE + dataBytes) {
      result.error = "ATR size does not match its header geometry";
      return result;
    }
    const totalSectors = BOOT_SECTOR_COUNT + remaining / sectorSize;
    result.valid = true;
    result.header = {
      sectorSize: sectorSize,
      totalSectors: totalSectors,
      dataBytes: dataBytes,
      imageBytes: bytes.length,
      paragraphs: paragraphs,
    };
    if (totalSectors < DIRECTORY_START_SECTOR + DIRECTORY_SECTOR_COUNT - 1) return result;

    const vtoc = readSector(bytes, VTOC_SECTOR, sectorSize);
    if (!vtoc || vtoc[0] !== 2) return result;
    const initialFree = readWord(vtoc, 1);
    const currentFree = readWord(vtoc, 3);
    if (initialFree > totalSectors || currentFree > totalSectors) return result;

    const entries = readDirectoryEntries(bytes, {
      sectorSize: sectorSize,
      totalSectors: totalSectors,
    });
    if (!entries) return result;
    result.filesystem = {
      id: "dos2-mydos",
      name: "DOS 2.x / MyDOS",
      description: "DOS 2.x-compatible VTOC and directory layout",
      initialFreeSectors: initialFree,
      freeSectors: currentFree,
      vtocSector: VTOC_SECTOR,
      directoryStartSector: DIRECTORY_START_SECTOR,
      directorySectorCount: DIRECTORY_SECTOR_COUNT,
    };
    result.entries = entries;
    return result;
  }

  function extractFile(data, inspection, entry) {
    const bytes = toBytes(data);
    if (!inspection || !inspection.valid || !entry) {
      throw new Error("Cannot extract from an invalid ATR entry");
    }
    const sectorSize = inspection.header.sectorSize;
    const payloadSize = sectorSize - 3;
    const output = [];
    const visited = new Set();
    let sectorNumber = entry.startSector;
    for (let count = 0; count < entry.sectors; count++) {
      if (sectorNumber < 1 || sectorNumber > inspection.header.totalSectors || visited.has(sectorNumber)) {
        throw new Error("Invalid or cyclic DOS sector chain");
      }
      visited.add(sectorNumber);
      const sector = readSector(bytes, sectorNumber, sectorSize);
      if (!sector || sector.length < sectorSize) throw new Error("DOS sector is outside the ATR image");
      const next = (((sector[sectorSize - 3] & 0x03) << 8) | sector[sectorSize - 2]) >>> 0;
      const used = Math.min(sector[sectorSize - 1], payloadSize);
      const last = next === 0 || count + 1 === entry.sectors;
      const length = last ? used : payloadSize;
      for (let i = 0; i < length; i++) output.push(sector[i]);
      if (next === 0) break;
      sectorNumber = next;
    }
    return new Uint8Array(output);
  }

  function decodeAtascii(data) {
    const bytes = toBytes(data);
    let text = "";
    for (let i = 0; i < bytes.length; i++) {
      const raw = bytes[i];
      const code = raw & 0x7f;
      if (raw === 0x9b) text += "\n";
      else if (code === 0x09) text += "\t";
      else if (code >= 0x20 && code <= 0x7e) text += String.fromCharCode(code);
      else text += ".";
    }
    return text;
  }

  root.A8EAtrInspector = {
    inspect: inspect,
    extractFile: extractFile,
    decodeAtascii: decodeAtascii,
    sectorOffset: sectorOffset,
  };
})(typeof window !== "undefined" ? window : self);
