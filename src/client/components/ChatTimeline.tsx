import { useState } from 'react';
import type { TimelineItem } from '../../shared/timeline.js';
import {
  formatWorkedLabel,
  groupTimelineSegments,
  type TimelineDisplaySegment,
} from '../../shared/timeline.js';
import { renderMarkdown } from '../lib/markdown';

function JsonBlock({ value }: { value: unknown }) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return <pre className="json-block json-block-sm">{text}</pre>;
}

function WorkToolLine({ item }: { item: Extract<TimelineItem, { kind: 'tool' }> }) {
  const [open, setOpen] = useState(false);
  const hasDetail = item.input !== undefined || item.result !== undefined;

  return (
    <div className="work-tool-line">
      {hasDetail ? (
        <button type="button" className="work-tool-trigger" onClick={() => setOpen((v) => !v)}>
          <span className="work-tool-chevron">{open ? '▾' : '▸'}</span>
          <span className="work-tool-name">{item.name}</span>
        </button>
      ) : (
        <span className="work-tool-trigger static">
          <span className="work-tool-name">{item.name}</span>
        </span>
      )}
      {open && hasDetail && (
        <div className="work-tool-detail">
          {item.input !== undefined && <JsonBlock value={item.input} />}
          {item.result !== undefined && <JsonBlock value={item.result} />}
        </div>
      )}
    </div>
  );
}

function WorkStepList({ items }: { items: TimelineItem[] }) {
  return (
    <div className="work-steps">
      {items.map((item) => {
        switch (item.kind) {
          case 'tool':
            return <WorkToolLine key={item.id} item={item} />;
          case 'thinking':
            if (!item.text?.trim()) return null;
            return (
              <div
                key={item.id}
                className="work-thinking md"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(item.text) }}
              />
            );
          case 'task':
            return (
              <div key={item.id} className="work-meta">
                {item.text || 'Task'}{item.status ? ` · ${item.status}` : ''}
              </div>
            );
          case 'status':
            return (
              <div key={item.id} className="work-meta">
                {item.text || item.status}
              </div>
            );
          case 'system':
            return (
              <div key={item.id} className="work-meta">
                {item.text || 'System'}
              </div>
            );
          case 'usage':
            return null;
          default:
            return null;
        }
      })}
    </div>
  );
}

function WorkBlock({
  segment,
  working,
}: {
  segment: TimelineDisplaySegment & { type: 'work' };
  working: boolean;
}) {
  const [open, setOpen] = useState(false);
  const label = formatWorkedLabel(segment.durationMs, working);

  return (
    <div className={`work-block${open ? ' open' : ''}${working ? ' live' : ''}`}>
      <button type="button" className="work-block-head" onClick={() => setOpen((v) => !v)}>
        <span className="work-block-chevron">{open ? '▾' : '▸'}</span>
        <span className="work-block-label">{label}</span>
      </button>
      {open && <WorkStepList items={segment.items} />}
    </div>
  );
}

export function ChatTimeline({ items, live = false }: { items: TimelineItem[]; live?: boolean }) {
  if (items.length === 0) {
    return live ? (
      <div className="work-block live">
        <span className="work-block-label static">Working…</span>
      </div>
    ) : (
      <p className="timeline-empty">…</p>
    );
  }

  const segments = groupTimelineSegments(items);
  const last = segments[segments.length - 1];
  const workStillGoing =
    live && last?.type === 'work' && !items.some((i) => i.kind === 'assistant');

  return (
    <div className="chat-timeline">
      {segments.map((seg, idx) => {
        if (seg.type === 'work') {
          const isActiveWork = live && idx === segments.length - 1 && workStillGoing;
          return <WorkBlock key={seg.id} segment={seg} working={isActiveWork} />;
        }
        if (seg.type === 'assistant') {
          return (
            <div
              key={seg.item.id}
              className="agent-block md"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(seg.item.text) }}
            />
          );
        }
        return (
          <p key={seg.item.id} className="chat-error">
            {seg.item.text}
          </p>
        );
      })}
      {live && segments.length === 0 && (
        <div className="work-block live">
          <span className="work-block-label static">Working…</span>
        </div>
      )}
    </div>
  );
}
