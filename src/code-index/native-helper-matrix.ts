export type NativeCodeIndexHelperBinaryFormat = "elf" | "mach-o" | "pe";
export type NativeCodeIndexHelperLibc = "" | "musl";

export interface NativeCodeIndexHelperTarget {
  arch: "arm64" | "x64";
  architecture: "arm64" | "x64";
  format: NativeCodeIndexHelperBinaryFormat;
  libc: NativeCodeIndexHelperLibc;
  platform: "darwin" | "linux" | "win32";
  runner: string;
  rustTarget: string;
  triple: string;
}

export const nativeCodeIndexHelperTargets = [
  {
    arch: "arm64",
    architecture: "arm64",
    format: "mach-o",
    libc: "",
    platform: "darwin",
    runner: "macos-14",
    rustTarget: "aarch64-apple-darwin",
    triple: "darwin-arm64",
  },
  {
    arch: "x64",
    architecture: "x64",
    format: "mach-o",
    libc: "",
    platform: "darwin",
    runner: "macos-15-intel",
    rustTarget: "x86_64-apple-darwin",
    triple: "darwin-x64",
  },
  {
    arch: "arm64",
    architecture: "arm64",
    format: "elf",
    libc: "",
    platform: "linux",
    runner: "ubuntu-24.04-arm",
    rustTarget: "aarch64-unknown-linux-gnu",
    triple: "linux-arm64",
  },
  {
    arch: "arm64",
    architecture: "arm64",
    format: "elf",
    libc: "musl",
    platform: "linux",
    runner: "ubuntu-24.04-arm",
    rustTarget: "aarch64-unknown-linux-musl",
    triple: "linux-arm64-musl",
  },
  {
    arch: "x64",
    architecture: "x64",
    format: "elf",
    libc: "",
    platform: "linux",
    runner: "ubuntu-latest",
    rustTarget: "x86_64-unknown-linux-gnu",
    triple: "linux-x64",
  },
  {
    arch: "x64",
    architecture: "x64",
    format: "elf",
    libc: "musl",
    platform: "linux",
    runner: "ubuntu-latest",
    rustTarget: "x86_64-unknown-linux-musl",
    triple: "linux-x64-musl",
  },
  {
    arch: "arm64",
    architecture: "arm64",
    format: "pe",
    libc: "",
    platform: "win32",
    runner: "windows-11-arm",
    rustTarget: "aarch64-pc-windows-msvc",
    triple: "win32-arm64",
  },
  {
    arch: "x64",
    architecture: "x64",
    format: "pe",
    libc: "",
    platform: "win32",
    runner: "windows-latest",
    rustTarget: "x86_64-pc-windows-msvc",
    triple: "win32-x64",
  },
] as const satisfies readonly NativeCodeIndexHelperTarget[];

export type NativeCodeIndexHelperTriple = (typeof nativeCodeIndexHelperTargets)[number]["triple"];

export const supportedNativeHelperTriples = nativeCodeIndexHelperTargets.map((target) => target.triple);

export function nativeCodeIndexHelperTargetForTriple(triple: string): NativeCodeIndexHelperTarget | undefined {
  return nativeCodeIndexHelperTargets.find((target) => target.triple === triple);
}

export function nativeCodeIndexHelperPlatformFromTriple(triple: string): string {
  return nativeCodeIndexHelperTargetForTriple(triple)?.platform ?? String(triple).split("-")[0] ?? "";
}

export function nativeCodeIndexHelperTripleForPlatform(platform: string, arch: string, libc: string = ""): string {
  const normalizedLibc = platform === "linux" && libc === "musl" ? "musl" : "";
  return nativeCodeIndexHelperTargets.find((target) => (
    target.platform === platform && target.arch === arch && target.libc === normalizedLibc
  ))?.triple ?? `${platform}-${arch}`;
}
