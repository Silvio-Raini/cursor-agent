import { useState } from 'react';
import type { TimelineItem } from '../../shared/timeline.js';
import { renderMarkdown } from '../lib/markdown';

function formatUsage(usage: Record<string, unknown>): string {
  const parts: string[] = [];
  const inTok = usage.inputTokens ?? usage.input_tokens;
  const outTok = usage.outputTokens ?? usage.output_tokens;
  if (inTok !== undefined) parts.push(`${inTok} in`);
  if (outTok !== undefined) parts.push(`${outTok} out`);
  return parts.length > 0 ? parts.join(' · ') : JSON.stringify(usage);
}

function JsonBlock({ value }: { value: unknown }) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return <pre className="json-block">{text}</pre>;
}

function ToolRow({ item }: { item: Extract<TimelineItem, { kind: 'tool' }> }) {
  const [open, setOpen] = useState(false);
  const done = item.status === 'completed';
  const failed = item.status === 'error';

  return (
    <div className={`tool-row${open ? ' open' : ''}${failed ? ' err' : done ? ' ok' : ''}`}>
      <button type="button" className="tool-row-head" onClick={() => setOpen((v) => !v)}>
        <span className="tool-row-chevron">{open ? '▾' : '▸'}</span>
        <span className="tool-row-name">{item.name}</span>
        <span className="tool-row-status">{item.status}</span>
      </button>
      {open && (
        <div className="tool-row-body">
          {item.input !== undefined && (
            <div className="tool-row-section">
              <span className="tool-row-label">Input</span>
              <JsonBlock value={item.input} />
            </div>
          )}
          {item.result !== undefined && (
            <div className="tool-row-section">
              <span className="tool-row-label">Output</span>
              <JsonBlock value={item.result} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ThinkingRow({ item }: { item: Extract<TimelineItem, { kind: 'thinking' }> }) {
  const [open, setOpen] = useState(false);
  const secs = item.durationMs !== undefined ? Math.round(item.durationMs / 1000) : null;

  return (
    <div className={`thinking-row${open ? ' open' : ''}`}>
      <button type="button" className="thinking-row-head" onClick={() => setOpen((v) => !v)}>
        <span className="tool-row-chevron">{open ? '▾' : '▸'}</span>
        <span>
          {secs !== null ? `Thought for ${secs}s` : 'Thinking'}
        </span>
      </button>
      {open && item.text && (
        <div
          className="thinking-row-body md"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(item.text) }}
        />
      )}
    </div>
  );
}

export function ChatTimeline({ items }: { items: TimelineItem[] }) {
  if (items.length === 0) {
    return <p className="timeline-empty">…</p>;
  }

  return (
    <div className="chat-timeline">
      {items.map((item) => {
        switch (item.kind) {
          case 'assistant':
            return (
              <div
                key={item.id}
                className="agent-block md"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(item.text) }}
              />
            );
          case 'thinking':
            return <ThinkingRow key={item.id} item={item} />;
          case 'tool':
            return <ToolRow key={item.id} item={item} />;
          case 'task':
            return (
              <div key={item.id} className="meta-line">
                Task {item.text || ''}{item.status ? ` · ${item.status}` : ''}
              </div>
            );
          case 'status':
            return (
              <div key={item.id} className="meta-line muted">
                {item.text || item.status}
              </div>
            );
          case 'usage':
            return (
              <div key={item.id} className="meta-line muted mono">
                {formatUsage(item.usage)}
              </div>
            );
          case 'system':
            return (
              <div key={item.id} className="meta-line muted">
                {item.text || 'System'}
              </div>
            );
          case 'error':
            return (
              <p key={item.id} className="chat-error">
                {item.text}
              </p>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}
