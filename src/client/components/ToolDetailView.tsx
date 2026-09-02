import type { TimelineItem } from '../../shared/timeline.js';
import {
  asRecord,
  computeLineDiff,
  diffStats,
  formatToolLabel,
  normalizeToolKind,
  parseGlobFiles,
  parseGrepMatches,
  pickString,
  truncate,
  unwrapToolResult,
  type DiffLine,
} from '../../shared/toolDisplay.js';

const MAX_DIFF_LINES = 120;
const MAX_OUTPUT_CHARS = 12_000;
const MAX_GREP_FILES = 40;
const MAX_GLOB_FILES = 50;
const MAX_READ_LINES = 80;

function DiffView({ lines, filePath }: { lines: DiffLine[]; filePath?: string }) {
  const stats = diffStats(lines);
  const visible =
    lines.length > MAX_DIFF_LINES
      ? [
          ...lines.slice(0, MAX_DIFF_LINES / 2),
          { kind: 'equal' as const, text: `… ${lines.length - MAX_DIFF_LINES} weitere Zeilen …` },
          ...lines.slice(-MAX_DIFF_LINES / 2),
        ]
      : lines;

  return (
    <div className="tool-diff">
      {filePath && (
        <div className="tool-diff-head">
          <span className="tool-file-path">{filePath}</span>
          {(stats.added > 0 || stats.removed > 0) && (
            <span className="tool-diff-stats">
              {stats.added > 0 && <span className="stat-add">+{stats.added}</span>}
              {stats.removed > 0 && <span className="stat-remove">−{stats.removed}</span>}
            </span>
          )}
        </div>
      )}
      <div className="tool-diff-body">
        {visible.map((line, i) => (
          <div key={i} className={`tool-diff-line tool-diff-${line.kind}`}>
            <span className="tool-diff-gutter">
              {line.kind === 'remove' ? line.oldLine : line.kind === 'add' ? line.newLine : line.oldLine ?? ''}
            </span>
            <span className="tool-diff-sign">{line.kind === 'add' ? '+' : line.kind === 'remove' ? '−' : ' '}</span>
            <code className="tool-diff-text">{line.text || ' '}</code>
          </div>
        ))}
      </div>
    </div>
  );
}

function ShellView({ input, result }: { input: unknown; result?: unknown }) {
  const inp = asRecord(input);
  const command = pickString(inp, 'command') || '';
  const raw = unwrapToolResult(result);
  const res = asRecord(raw);
  const exitCode = typeof res?.exitCode === 'number' ? res.exitCode : undefined;
  const stdout = pickString(res, 'stdout') || (typeof result === 'string' ? result : '');
  const stderr = pickString(res, 'stderr') || '';
  const output = [stdout, stderr].filter(Boolean).join(stderr && stdout ? '\n' : '');
  const trimmed = output.length > MAX_OUTPUT_CHARS ? `${output.slice(0, MAX_OUTPUT_CHARS)}\n…` : output;

  return (
    <div className="tool-shell">
      <div className="tool-shell-cmd">
        <span className="tool-shell-prompt">$</span>
        <code>{command}</code>
      </div>
      {(trimmed || exitCode !== undefined) && (
        <div className="tool-shell-out">
          {exitCode !== undefined && (
            <div className={`tool-exit-badge${exitCode === 0 ? ' ok' : ' err'}`}>exit {exitCode}</div>
          )}
          {trimmed && <pre>{trimmed}</pre>}
        </div>
      )}
    </div>
  );
}

function GrepView({ input, result }: { input: unknown; result?: unknown }) {
  const inp = asRecord(input);
  const pattern = pickString(inp, 'pattern') || '';
  const path = pickString(inp, 'path') || '.';
  const glob = pickString(inp, 'glob');
  const matches = parseGrepMatches(result);
  const shown = matches.slice(0, MAX_GREP_FILES);
  const rest = matches.length - shown.length;

  return (
    <div className="tool-grep">
      <div className="tool-meta-row">
        <span className="tool-meta-label">Pattern</span>
        <code className="tool-meta-value">{pattern}</code>
      </div>
      <div className="tool-meta-row">
        <span className="tool-meta-label">Pfad</span>
        <code className="tool-meta-value">{path}{glob ? ` (${glob})` : ''}</code>
      </div>
      {shown.length > 0 ? (
        <ul className="tool-match-list">
          {shown.map((m, i) => (
            <li key={i}>
              <code className="tool-match-file">{m.file}</code>
              {m.line !== undefined && <span className="tool-match-line">:{m.line}</span>}
              {m.text && <span className="tool-match-text">{truncate(m.text, 120)}</span>}
            </li>
          ))}
          {rest > 0 && <li className="tool-match-more">… {rest} weitere</li>}
        </ul>
      ) : (
        <p className="tool-empty-hint">Keine Treffer</p>
      )}
    </div>
  );
}

function ReadView({ input, result }: { input: unknown; result?: unknown }) {
  const inp = asRecord(input);
  const path = pickString(inp, 'path') || '';
  const raw = unwrapToolResult(result);
  const res = asRecord(raw);
  const content = pickString(res, 'content') || pickString(inp, 'content') || '';
  const lines = content.split('\n');
  const shown = lines.slice(0, MAX_READ_LINES);
  const rest = lines.length - shown.length;

  return (
    <div className="tool-read">
      <div className="tool-file-head">
        <code className="tool-file-path">{path}</code>
        {lines.length > 0 && <span className="tool-line-count">{lines.length} Zeilen</span>}
      </div>
      <pre className="tool-code-block">
        {shown.map((line, i) => (
          <div key={i} className="tool-code-line">
            <span className="tool-code-gutter">{i + 1}</span>
            <code>{line || ' '}</code>
          </div>
        ))}
        {rest > 0 && <div className="tool-code-more">… {rest} weitere Zeilen</div>}
      </pre>
    </div>
  );
}

function GlobView({ input, result }: { input: unknown; result?: unknown }) {
  const inp = asRecord(input);
  const pattern = pickString(inp, 'globPattern', 'glob_pattern', 'pattern') || '';
  const dir = pickString(inp, 'targetDirectory', 'target_directory', 'path') || '';
  const files = parseGlobFiles(result);
  const shown = files.slice(0, MAX_GLOB_FILES);
  const rest = files.length - shown.length;

  return (
    <div className="tool-glob">
      <div className="tool-meta-row">
        <span className="tool-meta-label">Pattern</span>
        <code className="tool-meta-value">{pattern}</code>
      </div>
      {dir && (
        <div className="tool-meta-row">
          <span className="tool-meta-label">Verzeichnis</span>
          <code className="tool-meta-value">{dir}</code>
        </div>
      )}
      {shown.length > 0 ? (
        <ul className="tool-file-list">
          {shown.map((f) => (
            <li key={f}><code>{f}</code></li>
          ))}
          {rest > 0 && <li className="tool-match-more">… {rest} weitere</li>}
        </ul>
      ) : (
        <p className="tool-empty-hint">Keine Dateien</p>
      )}
    </div>
  );
}

function EditView({ input }: { input: unknown }) {
  const inp = asRecord(input);
  const path = pickString(inp, 'path') || '';
  const oldStr = pickString(inp, 'old_string', 'oldString') || '';
  const newStr = pickString(inp, 'new_string', 'newString') || '';
  const lines = computeLineDiff(oldStr, newStr);
  return <DiffView lines={lines} filePath={path} />;
}

function WriteView({ input }: { input: unknown }) {
  const inp = asRecord(input);
  const path = pickString(inp, 'path') || '';
  const content = pickString(inp, 'contents', 'content') || '';
  const lines: DiffLine[] = content.split('\n').map((text, i) => ({
    kind: 'add' as const,
    text,
    newLine: i + 1,
  }));
  return <DiffView lines={lines} filePath={path} />;
}

function FallbackView({ input, result }: { input?: unknown; result?: unknown }) {
  return (
    <div className="tool-fallback">
      {input !== undefined && (
        <div>
          <div className="tool-fallback-label">Input</div>
          <pre>{typeof input === 'string' ? input : JSON.stringify(input, null, 2)}</pre>
        </div>
      )}
      {result !== undefined && (
        <div>
          <div className="tool-fallback-label">Output</div>
          <pre>{typeof result === 'string' ? result : JSON.stringify(result, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

export function ToolDetailView({
  name,
  input,
  result,
}: {
  name: string;
  input?: unknown;
  result?: unknown;
}) {
  const kind = normalizeToolKind(name);

  switch (kind) {
    case 'shell':
      return <ShellView input={input} result={result} />;
    case 'grep':
      return <GrepView input={input} result={result} />;
    case 'read':
      return <ReadView input={input} result={result} />;
    case 'glob':
      return <GlobView input={input} result={result} />;
    case 'edit':
      return input ? <EditView input={input} /> : <FallbackView input={input} result={result} />;
    case 'write':
      return input ? <WriteView input={input} /> : <FallbackView input={input} result={result} />;
    case 'delete': {
      const path = pickString(asRecord(input), 'path') || '…';
      return (
        <div className="tool-delete">
          <code className="tool-file-path">{path}</code>
          <span className="tool-delete-label">Datei gelöscht</span>
        </div>
      );
    }
    default:
      return <FallbackView input={input} result={result} />;
  }
}

export function ToolTriggerLabel({ item }: { item: Extract<TimelineItem, { kind: 'tool' }> }) {
  const label = formatToolLabel(item.name, item.input, item.result);
  return (
    <>
      <span className="work-tool-kind">{label.title}</span>
      {label.subtitle && <span className="work-tool-desc">{label.subtitle}</span>}
      {label.stats && <span className="work-tool-stats">{label.stats}</span>}
    </>
  );
}

export function toolStatusClass(status: string): string {
  if (status === 'completed' || status === 'success' || status === 'finished') return 'done';
  if (status === 'error' || status === 'failed') return 'err';
  if (status === 'running' || status === 'queued') return 'run';
  return '';
}
