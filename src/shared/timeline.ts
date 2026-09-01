/** Normalisiertes Stream-Event (Backend → Frontend / SSE). */
export type AgentStreamEvent = {
  type: string;
  timestamp: string;
  text?: string;
  tool?: string;
  toolId?: string;
  toolStatus?: string;
  toolInput?: unknown;
  toolResult?: unknown;
  status?: string;
  taskStatus?: string;
  thinkingDurationMs?: number;
  usage?: Record<string, unknown>;
  subtype?: string;
  seq?: number;
};

export type TimelineItem =
  | { id: string; kind: 'assistant'; text: string }
  | { id: string; kind: 'thinking'; text: string; durationMs?: number; collapsed?: boolean }
  | {
      id: string;
      kind: 'tool';
      name: string;
      status: string;
      input?: unknown;
      result?: unknown;
    }
  | { id: string; kind: 'status'; status: string; text?: string }
  | { id: string; kind: 'task'; text?: string; status?: string }
  | { id: string; kind: 'usage'; usage: Record<string, unknown> }
  | { id: string; kind: 'system'; text?: string }
  | { id: string; kind: 'error'; text: string };

function itemId(seq: number | undefined, suffix: string): string {
  return seq !== undefined ? `${seq}-${suffix}` : suffix;
}

/** Reduziert normalisierte Events zu einer renderbaren Timeline. */
export function reduceEventsToTimeline(events: AgentStreamEvent[]): TimelineItem[] {
  const items: TimelineItem[] = [];

  for (const ev of events) {
    const seq = ev.seq;
    switch (ev.type) {
      case 'assistant':
        if (!ev.text) break;
        {
          const last = items[items.length - 1];
          if (last?.kind === 'assistant') {
            last.text += ev.text;
          } else {
            items.push({ id: itemId(seq, 'a'), kind: 'assistant', text: ev.text });
          }
        }
        break;

      case 'thinking':
        if (!ev.text) break;
        {
          const last = items[items.length - 1];
          if (last?.kind === 'thinking' && !ev.thinkingDurationMs) {
            last.text += ev.text;
          } else if (last?.kind === 'thinking' && ev.thinkingDurationMs) {
            last.durationMs = ev.thinkingDurationMs;
          } else {
            items.push({
              id: itemId(seq, 't'),
              kind: 'thinking',
              text: ev.text,
              durationMs: ev.thinkingDurationMs,
              collapsed: true,
            });
          }
        }
        break;

      case 'tool_call':
      case 'tool':
        {
          const toolId = ev.toolId || ev.tool || itemId(seq, 'tool');
          const existing = items.find((i) => i.kind === 'tool' && i.id === toolId);
          if (existing && existing.kind === 'tool') {
            if (ev.toolStatus) existing.status = ev.toolStatus;
            if (ev.toolInput !== undefined) existing.input = ev.toolInput;
            if (ev.toolResult !== undefined) {
              if (typeof existing.result === 'string' && typeof ev.toolResult === 'string') {
                existing.result += ev.toolResult;
              } else {
                existing.result = ev.toolResult;
              }
            }
          } else {
            items.push({
              id: String(toolId),
              kind: 'tool',
              name: ev.tool || 'tool',
              status: ev.toolStatus || 'running',
              input: ev.toolInput,
              result: ev.toolResult,
            });
          }
        }
        break;

      case 'status':
        if (ev.status === 'FINISHED' || ev.status === 'RUNNING' || ev.status === 'CREATING') {
          break;
        }
        items.push({
          id: itemId(seq, 'st'),
          kind: 'status',
          status: ev.status || ev.text || 'status',
          text: ev.text,
        });
        break;

      case 'task':
        items.push({
          id: itemId(seq, 'task'),
          kind: 'task',
          text: ev.text,
          status: ev.taskStatus,
        });
        break;

      case 'usage':
        if (ev.usage) {
          items.push({ id: itemId(seq, 'u'), kind: 'usage', usage: ev.usage });
        }
        break;

      case 'system':
        items.push({ id: itemId(seq, 'sys'), kind: 'system', text: ev.subtype || ev.text });
        break;

      case 'error':
        items.push({ id: itemId(seq, 'err'), kind: 'error', text: ev.text || 'Fehler' });
        break;

      case 'run_started':
      case 'run_finished':
      case 'sdk_run_id':
        break;

      default:
        if (ev.text) {
          const last = items[items.length - 1];
          if (last?.kind === 'assistant') last.text += ev.text;
          else items.push({ id: itemId(seq, ev.type), kind: 'assistant', text: ev.text });
        }
        break;
    }
  }

  return items;
}

const WORK_KINDS = new Set(['thinking', 'tool', 'task', 'status', 'system', 'usage']);

export type TimelineDisplaySegment =
  | { type: 'work'; id: string; items: TimelineItem[]; durationMs: number }
  | { type: 'assistant'; item: TimelineItem & { kind: 'assistant' } }
  | { type: 'error'; item: TimelineItem & { kind: 'error' } };

/** Schätzt Dauer aus Thinking-Events; Fallback pro Arbeitsschritt. */
export function estimateWorkDurationMs(items: TimelineItem[]): number {
  let ms = 0;
  let steps = 0;
  for (const item of items) {
    if (item.kind === 'thinking') {
      steps += 1;
      if (item.durationMs) ms += item.durationMs;
    } else if (item.kind === 'tool') {
      steps += 1;
    }
  }
  if (ms > 0) return ms;
  if (steps > 0) return steps * 1200;
  return items.length > 0 ? 800 : 0;
}

/** Cursor-Style: „Worked for 23 seconds“ / „Worked for 2 minutes“. */
export function formatWorkedLabel(ms: number, working = false): string {
  if (working) return 'Working…';
  const totalSec = Math.max(1, Math.round(ms / 1000));
  if (totalSec < 60) {
    return `Worked for ${totalSec} ${totalSec === 1 ? 'second' : 'seconds'}`;
  }
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (sec === 0) {
    return `Worked for ${min} ${min === 1 ? 'minute' : 'minutes'}`;
  }
  return `Worked for ${min}m ${sec}s`;
}

export function groupTimelineSegments(items: TimelineItem[]): TimelineDisplaySegment[] {
  const segments: TimelineDisplaySegment[] = [];
  let workBatch: TimelineItem[] = [];

  const flushWork = () => {
    if (!workBatch.length) return;
    segments.push({
      type: 'work',
      id: `work-${workBatch[0].id}`,
      items: [...workBatch],
      durationMs: estimateWorkDurationMs(workBatch),
    });
    workBatch = [];
  };

  for (const item of items) {
    if (item.kind === 'assistant') {
      flushWork();
      segments.push({ type: 'assistant', item });
    } else if (item.kind === 'error') {
      flushWork();
      segments.push({ type: 'error', item });
    } else if (WORK_KINDS.has(item.kind)) {
      workBatch.push(item);
    }
  }
  flushWork();
  return segments;
}

export function parseStoredEvents(
  rows: Array<{ seq: number; type: string; payload: Record<string, unknown> }>,
): AgentStreamEvent[] {
  return rows.map((r) => ({
    type: r.type,
    seq: r.seq,
    timestamp: typeof r.payload.timestamp === 'string' ? r.payload.timestamp : '',
    text: typeof r.payload.text === 'string' ? r.payload.text : undefined,
    tool: typeof r.payload.tool === 'string' ? r.payload.tool : undefined,
    toolId: typeof r.payload.toolId === 'string' ? r.payload.toolId : undefined,
    toolStatus: typeof r.payload.toolStatus === 'string' ? r.payload.toolStatus : undefined,
    toolInput: r.payload.toolInput,
    toolResult: r.payload.toolResult,
    status: typeof r.payload.status === 'string' ? r.payload.status : undefined,
    taskStatus: typeof r.payload.taskStatus === 'string' ? r.payload.taskStatus : undefined,
    thinkingDurationMs:
      typeof r.payload.thinkingDurationMs === 'number' ? r.payload.thinkingDurationMs : undefined,
    usage:
      typeof r.payload.usage === 'object' && r.payload.usage
        ? (r.payload.usage as Record<string, unknown>)
        : undefined,
    subtype: typeof r.payload.subtype === 'string' ? r.payload.subtype : undefined,
  }));
}
