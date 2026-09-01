import { useState } from 'react';
import type { TimelineItem } from '../../shared/timeline.js';
import { renderMarkdown } from '../lib/markdown';

function formatUsage(usage: Record<string, unknown>): string {
  const parts: string[] = [];
  const inTok = usage.inputTokens ?? usage.input_tokens;
  const outTok = usage.outputTokens ?? usage.output_tokens;
  const total = usage.totalTokens ?? usage.total_tokens;
  const reasoning = usage.reasoningTokens ?? usage.reasoning_tokens;
  if (inTok !== undefined) parts.push(`Eingabe: ${inTok}`);
  if (outTok !== undefined) parts.push(`Ausgabe: ${outTok}`);
  if (reasoning !== undefined) parts.push(`Reasoning: ${reasoning}`);
  if (total !== undefined) parts.push(`Gesamt: ${total}`);
  return parts.length > 0 ? parts.join(' · ') : JSON.stringify(usage);
}

function JsonBlock({ value }: { value: unknown }) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return <pre className="json-block">{text}</pre>;
}

function ToolCard({ item }: { item: Extract<TimelineItem, { kind: 'tool' }> }) {
  const [open, setOpen] = useState(false);
  const statusClass =
    item.status === 'completed' ? 'ok' : item.status === 'error' ? 'err' : 'run';

  return (
    <div className={`tool-card status-${statusClass}`}>
      <button type="button" className="tool-head" onClick={() => setOpen((v) => !v)}>
        <span className="tool-icon">⚡</span>
        <span className="tool-name">{item.name}</span>
        <span className={`tool-status ${statusClass}`}>{item.status}</span>
        <span className="tool-chevron">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="tool-body">
          {item.input !== undefined && (
            <div>
              <strong>Input</strong>
              <JsonBlock value={item.input} />
            </div>
          )}
          {item.result !== undefined && (
            <div>
              <strong>Result</strong>
              <JsonBlock value={item.result} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ThinkingBlock({ item }: { item: Extract<TimelineItem, { kind: 'thinking' }> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="thinking-block">
      <button type="button" className="thinking-head" onClick={() => setOpen((v) => !v)}>
        <span>💭 Denken</span>
        {item.durationMs !== undefined && (
          <span className="thinking-ms">{Math.round(item.durationMs / 1000)}s</span>
        )}
        <span className="tool-chevron">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div
          className="thinking-body md"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(item.text) }}
        />
      )}
    </div>
  );
}

export function ChatTimeline({ items }: { items: TimelineItem[] }) {
  if (items.length === 0) {
    return <p className="timeline-empty">Warte auf Antwort…</p>;
  }

  return (
    <div className="chat-timeline">
      {items.map((item) => {
        switch (item.kind) {
          case 'assistant':
            return (
              <div key={item.id} className="message assistant">
                <span className="msg-label">Agent</span>
                <div
                  className="msg-body md"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(item.text) }}
                />
              </div>
            );
          case 'thinking':
            return <ThinkingBlock key={item.id} item={item} />;
          case 'tool':
            return <ToolCard key={item.id} item={item} />;
          case 'task':
            return (
              <div key={item.id} className="task-chip">
                📋 {item.text || 'Task'}
                {item.status ? ` · ${item.status}` : ''}
              </div>
            );
          case 'status':
            return (
              <div key={item.id} className="status-chip">
                {item.text || item.status}
              </div>
            );
          case 'usage':
            return (
              <div key={item.id} className="usage-chip">
                📊 {formatUsage(item.usage)}
              </div>
            );
          case 'system':
            return (
              <div key={item.id} className="system-chip">
                {item.text || 'System'}
              </div>
            );
          case 'error':
            return (
              <p key={item.id} className="form-error">
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
