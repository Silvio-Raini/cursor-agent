import { useEffect, useState } from 'react';
import { api } from './api';
import type { AgentStreamEvent } from '../../shared/timeline.js';
import { parseStoredEvents, reduceEventsToTimeline, type TimelineItem } from '../../shared/timeline.js';

type StoredEvent = { seq: number; type: string; payload: Record<string, unknown> };

export function useRunTimeline(runId: string | null, live: boolean) {
  const [events, setEvents] = useState<AgentStreamEvent[]>([]);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);

  useEffect(() => {
    if (!runId) {
      setEvents([]);
      setTimeline([]);
      return;
    }

    let closed = false;

    async function loadHistory() {
      try {
        const rows = await api<StoredEvent[]>(`/api/agents/runs/${runId}/events`);
        if (closed) return;
        const parsed = parseStoredEvents(rows);
        setEvents(parsed);
        setTimeline(reduceEventsToTimeline(parsed));
      } catch {
        /* ignore */
      }
    }

    void loadHistory();

    if (!live) {
      return () => {
        closed = true;
      };
    }

    const es = new EventSource(`/api/agents/runs/${runId}/stream`, { withCredentials: true });
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
  }, [runId, live]);

  return { timeline };
}
