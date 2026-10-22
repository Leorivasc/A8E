(function (root) {
  "use strict";

  const ATR_HEADER_SIZE = 16;
  const BOOT_SECTOR_COUNT = 3;
  const BOOT_SECTOR_SIZE = 128;
  const ATR_SIGNATURE_0 = 0x96;
  const ATR_SIGNATURE_1 = 0x02;

  // These are the standard flat sector dumps described by AHRM Appendix B.
  // The length alone is deliberately used only for unheadered, well-known
  // geometries; arbitrary raw images are ambiguous without a Percom block.
  const RAW_GEOMETRIES = [
    { byteLength: 720 * 128, sectorSize: 128, totalSectors: 720 },
    { byteLength: 1040 * 128, sectorSize: 128, totalSectors: 1040 },
    { byteLength: 720 * 256, sectorSize: 256, totalSectors: 720 },
    { byteLength: 1440 * 256, sectorSize: 256, totalSectors: 1440 },
  ];

  function toBytes(data) {
    if (!data) return new Uint8Array(0);
    if (data instanceof Uint8Array) return new Uint8Array(data);
    if (data instanceof ArrayBuffer) return new Uint8Array(data.slice(0));
    if (ArrayBuffer.isView(data)) {
      return new Uint8Array(
        data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
      );
    }
    if (Array.isArray(data)) return new Uint8Array(data);
    return new Uint8Array(0);
  }

  function atrParagraphs(bytes) {
    return (
      bytes[2] |
      (bytes[3] << 8) |
      (bytes[6] << 16) |
      (bytes[7] << 24)
    ) >>> 0;
  }

  function isAtrSignature(bytes) {
    return bytes.length >= 2 &&
      bytes[0] === ATR_SIGNATURE_0 && bytes[1] === ATR_SIGNATURE_1;
  }

  function validAtrGeometry(bytes) {
    if (!isAtrSignature(bytes) || bytes.length < ATR_HEADER_SIZE) return null;
    const sectorSize = (bytes[4] | (bytes[5] << 8)) >>> 0;
    const dataBytes = atrParagraphs(bytes) * 16;
    if (
      (sectorSize !== 128 && sectorSize !== 256 && sectorSize !== 512) ||
      dataBytes < BOOT_SECTOR_COUNT * BOOT_SECTOR_SIZE ||
      bytes.length !== ATR_HEADER_SIZE + dataBytes
    ) return null;
    const remaining = dataBytes - BOOT_SECTOR_COUNT * BOOT_SECTOR_SIZE;
    if (remaining % sectorSize !== 0) return null;
    return {
      format: "atr",
      sectorSize: sectorSize,
      totalSectors: BOOT_SECTOR_COUNT + remaining / sectorSize,
      headerSize: ATR_HEADER_SIZE,
      byteLength: bytes.length,
    };
  }

  function rawGeometry(bytes) {
    for (let i = 0; i < RAW_GEOMETRIES.length; i++) {
      const geometry = RAW_GEOMETRIES[i];
      if (geometry.byteLength === bytes.length) {
        return {
          format: "raw",
          sectorSize: geometry.sectorSize,
          totalSectors: geometry.totalSectors,
          headerSize: 0,
          byteLength: bytes.length,
        };
      }
    }
    return null;
  }

  function detect(data) {
    const bytes = toBytes(data);
    if (isAtrSignature(bytes)) {
      const atr = validAtrGeometry(bytes);
      return atr || {
        format: "atr",
        valid: false,
        error: "Invalid ATR geometry",
        headerSize: ATR_HEADER_SIZE,
        byteLength: bytes.length,
      };
    }
    return rawGeometry(bytes) || {
      format: "unknown",
      valid: false,
      error: "Unsupported disk image geometry",
      headerSize: 0,
      byteLength: bytes.length,
    };
  }

  function setAtrHeader(target, geometry, dataBytes) {
    const paragraphs = dataBytes / 16;
    target[0] = ATR_SIGNATURE_0;
    target[1] = ATR_SIGNATURE_1;
    target[2] = paragraphs & 0xff;
    target[3] = (paragraphs >>> 8) & 0xff;
    target[4] = geometry.sectorSize & 0xff;
    target[5] = (geometry.sectorSize >>> 8) & 0xff;
    target[6] = (paragraphs >>> 16) & 0xff;
    target[7] = (paragraphs >>> 24) & 0xff;
  }

  function rawToAtr(bytes, geometry) {
    const isDoubleDensity = geometry.sectorSize === 256;
    const dataBytes = isDoubleDensity
      ? BOOT_SECTOR_COUNT * BOOT_SECTOR_SIZE +
        (geometry.totalSectors - BOOT_SECTOR_COUNT) * geometry.sectorSize
      : geometry.totalSectors * geometry.sectorSize;
    const atr = new Uint8Array(ATR_HEADER_SIZE + dataBytes);
    setAtrHeader(atr, geometry, dataBytes);

    if (!isDoubleDensity) {
      atr.set(bytes, ATR_HEADER_SIZE);
      return atr;
    }

    // AHRM Appendix B: physical DD sectors are 256 bytes, but the OS sees
    // only the first 128 bytes of logical sectors 1-3.
    for (let sector = 0; sector < BOOT_SECTOR_COUNT; sector++) {
      atr.set(
        bytes.subarray(sector * geometry.sectorSize, sector * geometry.sectorSize + BOOT_SECTOR_SIZE),
        ATR_HEADER_SIZE + sector * BOOT_SECTOR_SIZE,
      );
    }
    atr.set(
      bytes.subarray(BOOT_SECTOR_COUNT * geometry.sectorSize),
      ATR_HEADER_SIZE + BOOT_SECTOR_COUNT * BOOT_SECTOR_SIZE,
    );
    return atr;
  }

  function normalizeForEmulator(data) {
    const bytes = toBytes(data);
    const geometry = detect(bytes);
    if (geometry.format !== "raw") {
      return {
        bytes: bytes,
        converted: false,
        sourceFormat: geometry.format,
        geometry: geometry,
      };
    }
    return {
      bytes: rawToAtr(bytes, geometry),
      converted: true,
      sourceFormat: "raw",
      geometry: geometry,
    };
  }

  root.A8EDiskImage = {
    detect: detect,
    normalizeForEmulator: normalizeForEmulator,
    rawGeometries: RAW_GEOMETRIES.map(function (geometry) {
      return Object.assign({}, geometry);
    }),
  };
})(typeof window !== "undefined" ? window : self);
