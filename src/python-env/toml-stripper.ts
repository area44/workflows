/**
 * Strips comments and all TOML string literals (single-line basic/literal,
 * multiline basic/literal) from raw TOML text, replacing their characters with spaces.
 * This guarantees table headers like [project] inside multiline strings or comments
 * are ignored when checking for actual TOML headers.
 */
export function stripTomlStringsAndComments(raw: string): string {
  let result = "";
  let i = 0;
  const len = raw.length;

  while (i < len) {
    const ch = raw[i];

    if (ch === "#") {
      const [chunk, nextI] = stripComment(raw, i, len);
      result += chunk;
      i = nextI;
    } else if (raw.slice(i, i + 3) === '"""') {
      const [chunk, nextI] = stripMultilineBasicString(raw, i, len);
      result += chunk;
      i = nextI;
    } else if (raw.slice(i, i + 3) === "'''") {
      const [chunk, nextI] = stripMultilineLiteralString(raw, i, len);
      result += chunk;
      i = nextI;
    } else if (ch === '"') {
      const [chunk, nextI] = stripSinglelineBasicString(raw, i, len);
      result += chunk;
      i = nextI;
    } else if (ch === "'") {
      const [chunk, nextI] = stripSinglelineLiteralString(raw, i, len);
      result += chunk;
      i = nextI;
    } else {
      result += ch;
      i++;
    }
  }

  return result;
}

function stripComment(raw: string, startIdx: number, len: number): [string, number] {
  let res = "";
  let i = startIdx;
  while (i < len && raw[i] !== "\n" && raw[i] !== "\r") {
    res += " ";
    i++;
  }
  return [res, i];
}

function stripMultilineBasicString(raw: string, startIdx: number, len: number): [string, number] {
  let res = "   ";
  let i = startIdx + 3;

  while (i < len) {
    if (raw.slice(i, i + 3) === '"""') {
      let backslashCount = 0;
      let k = i - 1;
      while (k >= startIdx + 3 && raw[k] === "\\") {
        backslashCount++;
        k--;
      }
      if (backslashCount % 2 === 0) {
        res += "   ";
        return [res, i + 3];
      }
    }

    res += raw[i] === "\n" ? "\n" : " ";
    i++;
  }

  return [res, i];
}

function stripMultilineLiteralString(raw: string, startIdx: number, len: number): [string, number] {
  let res = "   ";
  let i = startIdx + 3;
  while (i < len && raw.slice(i, i + 3) !== "'''") {
    res += raw[i] === "\n" ? "\n" : " ";
    i++;
  }
  if (i < len) {
    res += "   ";
    i += 3;
  }
  return [res, i];
}

function stripSinglelineBasicString(raw: string, startIdx: number, len: number): [string, number] {
  let res = " ";
  let i = startIdx + 1;

  while (i < len && raw[i] !== "\n" && raw[i] !== "\r") {
    if (raw[i] === '"') {
      let backslashCount = 0;
      let k = i - 1;
      while (k >= startIdx + 1 && raw[k] === "\\") {
        backslashCount++;
        k--;
      }
      if (backslashCount % 2 === 0) {
        res += " ";
        return [res, i + 1];
      }
    }
    res += " ";
    i++;
  }

  return [res, i];
}

function stripSinglelineLiteralString(
  raw: string,
  startIdx: number,
  len: number,
): [string, number] {
  let res = " ";
  let i = startIdx + 1;
  while (i < len && raw[i] !== "'" && raw[i] !== "\n" && raw[i] !== "\r") {
    res += " ";
    i++;
  }
  if (i < len && raw[i] === "'") {
    res += " ";
    i++;
  }
  return [res, i];
}
