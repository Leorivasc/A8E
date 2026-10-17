(function () {
  "use strict";

  const LOCAL_SIGNATURE = 0x04034b50;
  const CENTRAL_SIGNATURE = 0x02014b50;
  const END_SIGNATURE = 0x06054b50;
  const UTF8_FLAG = 0x0800;
  const MAX_U32 = 0xffffffff;

  function toUint8(data) {
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

  function utf8Encode(value) {
    const text = String(value);
    const bytes = [];
    for (let i = 0; i < text.length; i++) {
      let code = text.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
        const low = text.charCodeAt(++i);
        if (low >= 0xdc00 && low <= 0xdfff) {
          code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
        } else {
          throw new Error("Invalid UTF-8 ZIP entry name");
        }
      }
      if (code >= 0xd800 && code <= 0xdfff) {
        throw new Error("Invalid UTF-8 ZIP entry name");
      }
      if (code <= 0x7f) bytes.push(code);
      else if (code <= 0x7ff) {
        bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
      } else if (code <= 0xffff) {
        bytes.push(
          0xe0 | (code >> 12),
          0x80 | ((code >> 6) & 0x3f),
          0x80 | (code & 0x3f),
        );
      } else {
        bytes.push(
          0xf0 | (code >> 18),
          0x80 | ((code >> 12) & 0x3f),
          0x80 | ((code >> 6) & 0x3f),
          0x80 | (code & 0x3f),
        );
      }
    }
    return new Uint8Array(bytes);
  }

  function utf8Decode(bytes) {
    if (typeof TextDecoder === "function") {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    }
    let result = "";
    for (let i = 0; i < bytes.length; i++) {
      const first = bytes[i];
      let code;
      let length;
      if (first <= 0x7f) {
        code = first;
        length = 0;
      } else if ((first & 0xe0) === 0xc0) {
        code = first & 0x1f;
        length = 1;
      } else if ((first & 0xf0) === 0xe0) {
        code = first & 0x0f;
        length = 2;
      } else if ((first & 0xf8) === 0xf0) {
        code = first & 0x07;
        length = 3;
      } else {
        throw new Error("Invalid UTF-8 ZIP entry name");
      }
      if (i + length >= bytes.length) throw new Error("Truncated UTF-8 ZIP entry name");
      for (let j = 1; j <= length; j++) {
        const next = bytes[i + j];
        if ((next & 0xc0) !== 0x80) throw new Error("Invalid UTF-8 ZIP entry name");
        code = (code << 6) | (next & 0x3f);
      }
      i += length;
      if (code <= 0xffff) result += String.fromCharCode(code);
      else {
        code -= 0x10000;
        result += String.fromCharCode(0xd800 | (code >> 10), 0xdc00 | (code & 0x3ff));
      }
    }
    return result;
  }

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
      crc ^= bytes[i];
      for (let bit = 0; bit < 8; bit++) {
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
      }
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function fail(message) {
    throw new Error("Invalid A8E ZIP archive: " + message);
  }

  function validatePath(name) {
    if (!name || name.indexOf("\\") >= 0 || name.indexOf("\0") >= 0 || name[0] === "/" || name.indexOf(":") >= 0) {
      fail("unsafe entry path");
    }
    const parts = name.split("/");
    for (let i = 0; i < parts.length; i++) {
      if (!parts[i] || parts[i] === "." || parts[i] === "..") fail("unsafe entry path");
    }
  }

  function readU16(view, offset) {
    return view.getUint16(offset, true);
  }

  function readU32(view, offset) {
    return view.getUint32(offset, true);
  }

  function writeU16(view, offset, value) {
    view.setUint16(offset, value, true);
  }

  function writeU32(view, offset, value) {
    view.setUint32(offset, value >>> 0, true);
  }

  function write(entries) {
    const normalized = [];
    const names = new Set();
    let count = 0;
    let localSize = 0;
    let centralSize = 0;

    (entries || []).forEach(function (entry) {
      const name = String(entry && entry.name ? entry.name : "");
      validatePath(name);
      const nameBytes = utf8Encode(name);
      const bytes = toUint8(entry && entry.bytes);
      if (nameBytes.length > 0xffff) fail("entry name is too long");
      if (bytes.length > MAX_U32) fail("entry is too large");
      if (names.has(name)) fail("duplicate entry path");
      names.add(name);
      normalized.push({
        name: name,
        nameBytes: nameBytes,
        bytes: bytes,
        crc: crc32(bytes),
        offset: localSize,
      });
      localSize += 30 + nameBytes.length + bytes.length;
      centralSize += 46 + nameBytes.length;
      count++;
    });

    if (count > 0xffff) fail("too many entries");
    if (localSize > MAX_U32 || centralSize > MAX_U32 || localSize + centralSize + 22 > MAX_U32) {
      fail("archive is too large");
    }

    const archive = new Uint8Array(localSize + centralSize + 22);
    const view = new DataView(archive.buffer);
    let offset = 0;
    normalized.forEach(function (entry) {
      writeU32(view, offset, LOCAL_SIGNATURE);
      writeU16(view, offset + 4, 10);
      writeU16(view, offset + 6, UTF8_FLAG);
      writeU16(view, offset + 8, 0);
      writeU16(view, offset + 10, 0);
      writeU16(view, offset + 12, 0);
      writeU32(view, offset + 14, entry.crc);
      writeU32(view, offset + 18, entry.bytes.length);
      writeU32(view, offset + 22, entry.bytes.length);
      writeU16(view, offset + 26, entry.nameBytes.length);
      writeU16(view, offset + 28, 0);
      archive.set(entry.nameBytes, offset + 30);
      archive.set(entry.bytes, offset + 30 + entry.nameBytes.length);
      offset += 30 + entry.nameBytes.length + entry.bytes.length;
    });

    const centralOffset = offset;
    normalized.forEach(function (entry) {
      writeU32(view, offset, CENTRAL_SIGNATURE);
      writeU16(view, offset + 4, 20);
      writeU16(view, offset + 6, 10);
      writeU16(view, offset + 8, UTF8_FLAG);
      writeU16(view, offset + 10, 0);
      writeU16(view, offset + 12, 0);
      writeU16(view, offset + 14, 0);
      writeU32(view, offset + 16, entry.crc);
      writeU32(view, offset + 20, entry.bytes.length);
      writeU32(view, offset + 24, entry.bytes.length);
      writeU16(view, offset + 28, entry.nameBytes.length);
      writeU16(view, offset + 30, 0);
      writeU16(view, offset + 32, 0);
      writeU16(view, offset + 34, 0);
      writeU16(view, offset + 36, 0);
      writeU32(view, offset + 38, 0);
      writeU32(view, offset + 42, entry.offset);
      archive.set(entry.nameBytes, offset + 46);
      offset += 46 + entry.nameBytes.length;
    });

    writeU32(view, offset, END_SIGNATURE);
    writeU16(view, offset + 4, 0);
    writeU16(view, offset + 6, 0);
    writeU16(view, offset + 8, count);
    writeU16(view, offset + 10, count);
    writeU32(view, offset + 12, centralSize);
    writeU32(view, offset + 16, centralOffset);
    writeU16(view, offset + 20, 0);
    return archive.buffer;
  }

  function read(data) {
    const archive = toUint8(data);
    const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
    const searchStart = Math.max(0, archive.length - 0xffff - 22);
    let end = -1;
    for (let i = archive.length - 22; i >= searchStart; i--) {
      if (readU32(view, i) === END_SIGNATURE) {
        const commentLength = readU16(view, i + 20);
        if (i + 22 + commentLength === archive.length) {
          end = i;
          break;
        }
      }
    }
    if (end < 0) fail("end record not found");
    if (readU16(view, end + 4) !== 0 || readU16(view, end + 6) !== 0) fail("multi-disk archive");
    const count = readU16(view, end + 10);
    const centralSize = readU32(view, end + 12);
    const centralOffset = readU32(view, end + 16);
    if (centralOffset + centralSize > end) fail("central directory is out of range");

    const result = [];
    const names = new Set();
    let offset = centralOffset;
    for (let index = 0; index < count; index++) {
      if (offset + 46 > archive.length || readU32(view, offset) !== CENTRAL_SIGNATURE) {
        fail("invalid central directory entry");
      }
      const flags = readU16(view, offset + 8);
      const method = readU16(view, offset + 10);
      const crc = readU32(view, offset + 16);
      const compressedSize = readU32(view, offset + 20);
      const size = readU32(view, offset + 24);
      const nameLength = readU16(view, offset + 28);
      const extraLength = readU16(view, offset + 30);
      const commentLength = readU16(view, offset + 32);
      const localOffset = readU32(view, offset + 42);
      const entryEnd = offset + 46 + nameLength + extraLength + commentLength;
      if (entryEnd > archive.length) fail("truncated central directory entry");
      if ((flags & 1) !== 0 || (flags & 8) !== 0 || method !== 0) {
        fail("encrypted, descriptor-based, or compressed entries are unsupported");
      }
      const name = utf8Decode(archive.subarray(offset + 46, offset + 46 + nameLength));
      validatePath(name);
      if (names.has(name)) fail("duplicate entry path");
      names.add(name);
      if (compressedSize !== size) fail("invalid uncompressed entry size");
      if (localOffset + 30 > archive.length || readU32(view, localOffset) !== LOCAL_SIGNATURE) {
        fail("invalid local file header");
      }
      const localFlags = readU16(view, localOffset + 6);
      const localMethod = readU16(view, localOffset + 8);
      const localNameLength = readU16(view, localOffset + 26);
      const localExtraLength = readU16(view, localOffset + 28);
      if (localFlags !== flags || localMethod !== method || localNameLength !== nameLength) {
        fail("local file header does not match central directory");
      }
      const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
      if (dataOffset + size > archive.length) fail("truncated file data");
      const bytes = archive.slice(dataOffset, dataOffset + size);
      if (crc32(bytes) !== crc) fail("CRC-32 mismatch");
      result.push({ name: name, bytes: bytes });
      offset = entryEnd;
    }
    if (offset !== centralOffset + centralSize) fail("central directory size mismatch");
    return result;
  }

  window.A8ELibraryArchive = {
    createApi: function () {
      return { write: write, read: read, crc32: crc32 };
    },
  };
})();
