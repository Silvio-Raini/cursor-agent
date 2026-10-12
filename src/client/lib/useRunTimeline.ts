import { useEffect, useState } from 'react';
import { api } from './api';
import type { AgentStreamEvent } from '../../shared/timeline.js';
import { parseStoredEvents, reduceEventsToTimeline, type TimelineItem } from '../../shared/timeline.js';

type StoredEvent = { seq: number; type: string; payload: Record<string, unknown> };

export function useRunTimeline(
  runId: string | null,
  live: boolean,
  source?: { eventsUrl: string; streamUrl: string },
) {
  const [events, setEvents] = useState<AgentStreamEvent[]>([]);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const eventsUrl = source?.eventsUrl ?? (runId ? `/api/agents/runs/${runId}/events` : '');
  const streamUrl = source?.streamUrl ?? (runId ? `/api/agents/runs/${runId}/stream` : '');

  useEffect(() => {
    if (!runId || !eventsUrl) {
      setEvents([]);
      setTimeline([]);
      return;
    }

    let closed = false;

    async function loadHistory() {
      try {
        const rows = await api<StoredEvent[]>(eventsUrl);
        if (closed) return;
        const parsed = parseStoredEvents(rows);
        setEvents(parsed);
        setTimeline(reduceEventsToTimeline(parsed));
      } catch {
        /* ignore */
      }
    }

    void loadHistory();

    if (!live || !streamUrl) {
      return () => {
        closed = true;
      };
    }

    const es = new EventSource(streamUrl, { withCredentials: true });
    es.onmessage = (msg) => {
      try {
        const ev = JSON.parse(msg.data) as AgentStreamEvent & { seq?: number };
        setEvents((prev) => {
          if (ev.seq !== undefined && prev.some((p) => p.seq === ev.seq)) return prev;
          const next = [...prev, ev];
          setTimeline(reduceEventsToTimeline(next));
          return next;
        });
      } catch {
        /* ignore */
      }
    };

    es.onerror = () => {
      es.close();
      void loadHistory();
    };

    return () => {
      closed = true;
      es.close();
    };
  }, [runId, live, eventsUrl, streamUrl]);

  return { timeline };
}
