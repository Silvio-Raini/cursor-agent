import { useEffect, useRef } from 'react';
import { ChatTimeline } from '../components/ChatTimeline';
import { useRunTimeline } from '../lib/useRunTimeline';

type Run = {
  id: string;
  prompt: string;
  status: string;
  errorMessage: string | null;
};

export function RunThread({ run, live, isFirst }: { run: Run; live: boolean; isFirst?: boolean }) {
  const { timeline } = useRunTimeline(run.id, live);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (live) endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [timeline, live]);

  return (
    <section className="chat-turn">
      {!isFirst && <div className="turn-divider" />}
      <div className="user-block">
        <div className="user-text">{run.prompt}</div>
      </div>
      <ChatTimeline items={timeline} live={live} />
      {run.errorMessage && <p className="chat-error">{run.errorMessage}</p>}
      <div ref={endRef} />
    </section>
  );
}
