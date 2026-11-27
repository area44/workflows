import * as io from "@actions/io";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  isExecutableBinary,
  getNodeExecutable,
  resolveProjectBinary,
  SUPPORTED_WIN_EXTENSIONS,
} from "@/autofix/executable-resolver";

vi.mock("@actions/io");

const originalPlatform = process.platform;

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
}

afterEach(() => {
  setPlatform(originalPlatform);
  vi.restoreAllMocks();
});

describe("SUPPORTED_WIN_EXTENSIONS", () => {
  it("contains the expected Windows executable extensions", () => {
    expect(SUPPORTED_WIN_EXTENSIONS.has(".cmd")).toBe(true);
    expect(SUPPORTED_WIN_EXTENSIONS.has(".bat")).toBe(true);
    expect(SUPPORTED_WIN_EXTENSIONS.has(".exe")).toBe(true);
    expect(SUPPORTED_WIN_EXTENSIONS.has(".ps1")).toBe(false);
    expect(SUPPORTED_WIN_EXTENSIONS.has(".sh")).toBe(false);
    expect(SUPPORTED_WIN_EXTENSIONS.size).toBe(3);
  });
});

describe("isExecutableBinary", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exec-resolver-test-"));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("on win32", () => {
    beforeEach(() => {
      setPlatform("win32");
    });

    it("returns true for an existing regular file (no X_OK check on Windows)", () => {
      const file = path.join(tempDir, "tool.exe");
      fs.writeFileSync(file, "");
      expect(isExecutableBinary(file, "win32")).toBe(true);
    });

    it("returns true for an existing regular file without extension", () => {
      const file = path.join(tempDir, "tool");
      fs.writeFileSync(file, "");
      expect(isExecutableBinary(file, "win32")).toBe(true);
    });

    it("returns false for a non-existent file", () => {
      expect(isExecutableBinary(path.join(tempDir, "missing.exe"), "win32")).toBe(false);
    });

    it("returns false for a directory", () => {
      const dir = path.join(tempDir, "subdir");
      fs.mkdirSync(dir, { recursive: true });
      expect(isExecutableBinary(dir, "win32")).toBe(false);
    });
  });

  describe("on posix", () => {
    beforeEach(() => {
      setPlatform("linux");
    });

    it("returns true for an existing regular file with executable permission", () => {
      const file = path.join(tempDir, "tool");
      fs.writeFileSync(file, "");
      fs.chmodSync(file, 0o755);
      expect(isExecutableBinary(file, "linux")).toBe(true);
    });

    it("returns false for an existing regular file without executable permission", () => {
      const file = path.join(tempDir, "tool");
      fs.writeFileSync(file, "");
      fs.chmodSync(file, 0o644);
      const accessSpy = vi.spyOn(fs, "accessSync").mockImplementation(() => {
        throw new Error("EACCES: permission denied");
      });
      try {
        expect(isExecutableBinary(file, "linux")).toBe(false);
      } finally {
        accessSpy.mockRestore();
      }
    });

    it("returns false for a non-existent file", () => {
      expect(isExecutableBinary(path.join(tempDir, "missing"), "linux")).toBe(false);
    });

    it("returns false for a directory even with permissions", () => {
      const dir = path.join(tempDir, "subdir");
      fs.mkdirSync(dir, { recursive: true });
      fs.chmodSync(dir, 0o755);
      expect(isExecutableBinary(dir, "linux")).toBe(false);
    });
  });
});

describe("getNodeExecutable", () => {
  describe("on win32", () => {
    beforeEach(() => {
      setPlatform("win32");
    });

    it("returns the resolved path when node.exe is on PATH", async () => {
      vi.spyOn(io, "which").mockResolvedValue("C:\\Program Files\\nodejs\\node.exe");
      const result = await getNodeExecutable("win32");
      expect(result).toBe("C:\\Program Files\\nodejs\\node.exe");
      expect(io.which).toHaveBeenCalledWith("node", false);
    });

    it("returns undefined when node resolves to an unsupported extension on Windows (.ps1)", async () => {
      vi.spyOn(io, "which").mockResolvedValue("C:\\tools\\node.ps1");
      const result = await getNodeExecutable("win32");
      expect(result).toBeUndefined();
    });

    it("returns undefined when node resolves to .sh on Windows", async () => {
      vi.spyOn(io, "which").mockResolvedValue("C:\\tools\\node.sh");
      const result = await getNodeExecutable("win32");
      expect(result).toBeUndefined();
    });

    it("returns undefined when node is not on PATH", async () => {
      vi.spyOn(io, "which").mockResolvedValue("");
      const result = await getNodeExecutable("win32");
      expect(result).toBeUndefined();
    });

    it("returns undefined when io.which throws", async () => {
      vi.spyOn(io, "which").mockRejectedValue(new Error("not found"));
      const result = await getNodeExecutable("win32");
      expect(result).toBeUndefined();
    });
  });

  describe("on posix", () => {
    beforeEach(() => {
      setPlatform("linux");
    });

    it("returns the resolved path when node is on PATH", async () => {
      vi.spyOn(io, "which").mockResolvedValue("/usr/bin/node");
      const result = await getNodeExecutable("linux");
      expect(result).toBe("/usr/bin/node");
    });

    it("returns undefined when node is not on PATH", async () => {
      vi.spyOn(io, "which").mockResolvedValue("");
      const result = await getNodeExecutable("linux");
      expect(result).toBeUndefined();
    });
  });
});

describe("resolveProjectBinary", () => {
  let tempDir: string;
  let binDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "resolve-bin-test-"));
    binDir = path.join(tempDir, "node_modules", ".bin");
    fs.mkdirSync(binDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("on win32", () => {
    beforeEach(() => {
      setPlatform("win32");
    });

    it("resolves .cmd shim first when tool has no extension", async () => {
      const cmdShim = path.join(binDir, "ruff.cmd");
      fs.writeFileSync(cmdShim, "@node ..\\..\\ruff\\bin\\ruff.js %*");
      vi.spyOn(io, "which").mockResolvedValue("");

      const result = await resolveProjectBinary(tempDir, "ruff", "win32");
      expect(result).toBe(cmdShim);
    });

    it("resolves .bat shim when .cmd is absent", async () => {
      const batShim = path.join(binDir, "ruff.bat");
      fs.writeFileSync(batShim, "@node ..\\..\\ruff\\bin\\ruff.js %*");
      vi.spyOn(io, "which").mockResolvedValue("");

      const result = await resolveProjectBinary(tempDir, "ruff", "win32");
      expect(result).toBe(batShim);
    });

    it("resolves .exe shim when .cmd and .bat are absent", async () => {
      const exeShim = path.join(binDir, "ruff.exe");
      fs.writeFileSync(exeShim, "");
      vi.spyOn(io, "which").mockResolvedValue("");

      const result = await resolveProjectBinary(tempDir, "ruff", "win32");
      expect(result).toBe(exeShim);
    });

    it("resolves extensionless executable when all shim variants are absent", async () => {
      const extless = path.join(binDir, "ruff");
      fs.writeFileSync(extless, "#!/usr/bin/env node");
      vi.spyOn(io, "which").mockResolvedValue("");

      const result = await resolveProjectBinary(tempDir, "ruff", "win32");
      expect(result).toBe(extless);
    });

    it("respects shim priority: .cmd > .bat > .exe > extensionless", async () => {
      fs.writeFileSync(path.join(binDir, "ruff.cmd"), "@rem cmd shim");
      fs.writeFileSync(path.join(binDir, "ruff.bat"), "@rem bat shim");
      fs.writeFileSync(path.join(binDir, "ruff.exe"), "");
      fs.writeFileSync(path.join(binDir, "ruff"), "#!/usr/bin/env node");
      vi.spyOn(io, "which").mockResolvedValue("");

      const result = await resolveProjectBinary(tempDir, "ruff", "win32");
      expect(result).toBe(path.join(binDir, "ruff.cmd"));
    });

    it("rejects a tool binary with an unsupported extension on Windows (.ps1)", async () => {
      const result = await resolveProjectBinary(tempDir, "ruff.ps1", "win32");
      expect(result).toBeUndefined();
    });

    it("accepts a tool binary with a supported .exe extension on Windows", async () => {
      const exePath = path.join(binDir, "ruff.exe");
      fs.writeFileSync(exePath, "");
      vi.spyOn(io, "which").mockResolvedValue("");

      const result = await resolveProjectBinary(tempDir, "ruff.exe", "win32");
      expect(result).toBe(exePath);
    });

    it("falls back to PATH when no local binary is found", async () => {
      vi.spyOn(io, "which").mockResolvedValue("C:\\Tools\\ruff.exe");
      const result = await resolveProjectBinary(tempDir, "ruff", "win32");
      expect(result).toBe("C:\\Tools\\ruff.exe");
    });

    it("returns undefined when binary is not found locally or on PATH", async () => {
      vi.spyOn(io, "which").mockResolvedValue("");
      const result = await resolveProjectBinary(tempDir, "ruff", "win32");
      expect(result).toBeUndefined();
    });

    it("returns undefined when io.which throws during PATH fallback", async () => {
      vi.spyOn(io, "which").mockRejectedValue(new Error("not found"));
      const result = await resolveProjectBinary(tempDir, "ruff", "win32");
      expect(result).toBeUndefined();
    });
  });

  describe("on posix", () => {
    beforeEach(() => {
      setPlatform("linux");
    });

    it("resolves from node_modules/.bin with executable permission", async () => {
      const localBin = path.join(binDir, "ruff");
      fs.writeFileSync(localBin, "#!/usr/bin/env node");
      fs.chmodSync(localBin, 0o755);
      vi.spyOn(io, "which").mockResolvedValue("");

      const result = await resolveProjectBinary(tempDir, "ruff", "linux");
      expect(result).toBe(localBin);
    });

    it("skips node_modules/.bin entry without executable permission", async () => {
      const localBin = path.join(binDir, "ruff");
      fs.writeFileSync(localBin, "#!/usr/bin/env node");
      fs.chmodSync(localBin, 0o644);
      const accessSpy = vi.spyOn(fs, "accessSync").mockImplementation(() => {
        throw new Error("EACCES: permission denied");
      });
      vi.spyOn(io, "which").mockResolvedValue("/usr/bin/ruff");
      try {
        const result = await resolveProjectBinary(tempDir, "ruff", "linux");
        expect(result).toBe("/usr/bin/ruff");
      } finally {
        accessSpy.mockRestore();
      }
    });

    it("falls back to PATH when no local binary is found", async () => {
      vi.spyOn(io, "which").mockResolvedValue("/usr/bin/ruff");
      const result = await resolveProjectBinary(tempDir, "ruff", "linux");
      expect(result).toBe("/usr/bin/ruff");
    });

    it("returns undefined when binary is not found locally or on PATH", async () => {
      vi.spyOn(io, "which").mockResolvedValue("");
      const result = await resolveProjectBinary(tempDir, "ruff", "linux");
      expect(result).toBeUndefined();
    });
  });
});
