"use strict";

function sampleBinaryForTriple(triple) {
  if (triple === "darwin-arm64" || triple === "darwin-x64") {
    const buffer = Buffer.alloc(32);
    buffer.writeUInt32LE(0xfeedfacf, 0);
    buffer.writeInt32LE(triple === "darwin-arm64" ? 0x0100000c : 0x01000007, 4);
    return buffer;
  }
  if (triple === "linux-arm64" || triple === "linux-x64") {
    const buffer = Buffer.alloc(64);
    buffer[0] = 0x7f;
    buffer[1] = 0x45;
    buffer[2] = 0x4c;
    buffer[3] = 0x46;
    buffer[4] = 2;
    buffer[5] = 1;
    buffer.writeUInt16LE(triple === "linux-arm64" ? 0xb7 : 0x3e, 18);
    return buffer;
  }
  if (triple === "win32-x64") {
    const buffer = Buffer.alloc(128);
    buffer[0] = 0x4d;
    buffer[1] = 0x5a;
    buffer.writeUInt32LE(0x40, 0x3c);
    buffer.write("PE\u0000\u0000", 0x40, "ascii");
    buffer.writeUInt16LE(0x8664, 0x44);
    return buffer;
  }
  throw new Error(`unsupported test triple: ${triple}`);
}

module.exports = {
  sampleBinaryForTriple,
};
