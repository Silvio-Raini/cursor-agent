/** Hilfsfunktionen für Tool-Anzeige (Shell, Grep, Edit, …). */

export type DiffLine = {
  kind: 'add' | 'remove' | 'equal';
  text: string;
  oldLine?: number;
  newLine?: number;
};

export type ToolKind =
  | 'shell'
  | 'grep'
  | 'read'
  | 'glob'
  | 'edit'
  | 'write'
  | 'delete'
  | 'unknown';

const TOOL_ALIASES: Record<string, ToolKind> = {
  shell: 'shell',
  grep: 'grep',
  read: 'read',
  glob: 'glob',
  glob_file_search: 'glob',
  strreplace: 'edit',
  search_replace: 'edit',
  edit: 'edit',
  applypatch: 'edit',
  write: 'write',
  delete: 'delete',
};

export function normalizeToolKind(name: string): ToolKind {
  const key = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  return TOOL_ALIASES[key] ?? 'unknown';
}

export function unwrapToolResult(result: unknown): unknown {
  if (!result || typeof result !== 'object') return result;
  const r = result as Record<string, unknown>;
  if ('value' in r && r.status !== undefined) return r.value;
  return result;
}

export function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export function pickString(obj: Record<string, unknown> | null, ...keys: string[]): string | undefined {
  if (!obj) return undefined;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string') return v;
  }
  return undefined;
}

export function basename(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts[parts.length - 1] || path;
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

/** Zeilen-Diff (LCS) für Edit/StrReplace. */
export function computeLineDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const m = oldLines.length;
  const n = newLines.length;

  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        oldLines[i - 1] === newLines[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  const raw: Array<{ kind: 'add' | 'remove' | 'equal'; text: string }> = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      raw.unshift({ kind: 'equal', text: oldLines[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      raw.unshift({ kind: 'add', text: newLines[j - 1] });
      j--;
    } else {
      raw.unshift({ kind: 'remove', text: oldLines[i - 1] });
      i--;
    }
  }

  let oldLine = 0;
  let newLine = 0;
  return raw.map((row) => {
    if (row.kind === 'equal') {
      oldLine++;
      newLine++;
      return { ...row, oldLine, newLine };
    }
    if (row.kind === 'remove') {
      oldLine++;
      return { ...row, oldLine };
    }
    newLine++;
    return { ...row, newLine };
  });
}

export function diffStats(lines: DiffLine[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const l of lines) {
    if (l.kind === 'add') added++;
    else if (l.kind === 'remove') removed++;
  }
  return { added, removed };
}

export type GrepMatch = { file: string; line?: number; text?: string };

export function parseGrepMatches(result: unknown): GrepMatch[] {
  const value = unwrapToolResult(result);
  const root = asRecord(value);
  const workspace = asRecord(root?.workspaceResults);
  if (!workspace) return [];

  const out: GrepMatch[] = [];
  for (const ws of Object.values(workspace)) {
    const wsRec = asRecord(ws);
    const output = asRecord(wsRec?.output);
    const matches = output?.matches;
    if (!Array.isArray(matches)) continue;
    for (const m of matches) {
      const rec = asRecord(m);
      if (!rec) continue;
      const file = pickString(rec, 'file', 'path');
      if (!file) continue;
      out.push({
        file,
        line: typeof rec.line === 'number' ? rec.line : undefined,
        text: pickString(rec, 'text', 'content', 'lineText'),
      });
    }
  }
  return out;
}

export function parseGlobFiles(result: unknown): string[] {
  const value = unwrapToolResult(result);
  const root = asRecord(value);
  if (Array.isArray(root?.files)) {
    return root.files.filter((f): f is string => typeof f === 'string');
  }
  if (typeof root?.files === 'string') return [root.files];
  return [];
}

export type ToolLabel = {
  title: string;
  subtitle?: string;
  stats?: string;
};

export function formatToolLabel(name: string, input: unknown, result?: unknown): ToolLabel {
  const kind = normalizeToolKind(name);
  const inp = asRecord(input);

  switch (kind) {
    case 'shell': {
      const cmd = pickString(inp, 'command') || '';
      return { title: 'Shell', subtitle: truncate(cmd.replace(/\s+/g, ' ').trim(), 72) };
    }
    case 'grep': {
      const pattern = pickString(inp, 'pattern') || '…';
      const path = pickString(inp, 'path') || '.';
      const matches = result ? parseGrepMatches(result) : [];
      return {
        title: 'Grep',
        subtitle: `"${truncate(pattern, 40)}" in ${truncate(path, 36)}`,
        stats: matches.length ? `${matches.length} Treffer` : undefined,
      };
    }
    case 'read': {
      const path = pickString(inp, 'path') || '…';
      return { title: 'Read', subtitle: basename(path) };
    }
    case 'glob': {
      const pattern = pickString(inp, 'globPattern', 'glob_pattern', 'pattern') || '…';
      const files = result ? parseGlobFiles(result) : [];
      return {
        title: 'Glob',
        subtitle: truncate(pattern, 48),
        stats: files.length ? `${files.length} Dateien` : undefined,
      };
    }
    case 'edit': {
      const path = pickString(inp, 'path') || '…';
      const oldStr = pickString(inp, 'old_string', 'oldString') || '';
      const newStr = pickString(inp, 'new_string', 'newString') || '';
      const stats = diffStats(computeLineDiff(oldStr, newStr));
      const statParts: string[] = [];
      if (stats.added) statParts.push(`+${stats.added}`);
      if (stats.removed) statParts.push(`−${stats.removed}`);
      return {
        title: 'Edit',
        subtitle: basename(path),
        stats: statParts.length ? statParts.join(' ') : undefined,
      };
    }
    case 'write': {
      const path = pickString(inp, 'path') || '…';
      const content = pickString(inp, 'contents', 'content') || '';
      const lines = content ? content.split('\n').length : 0;
      return {
        title: 'Write',
        subtitle: basename(path),
        stats: lines ? `+${lines}` : undefined,
      };
    }
    case 'delete': {
      const path = pickString(inp, 'path') || '…';
      return { title: 'Delete', subtitle: basename(path) };
    }
    default:
      return { title: name, subtitle: undefined };
  }
}
