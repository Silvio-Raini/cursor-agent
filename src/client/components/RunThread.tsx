import { useEffect, useRef } from 'react';
import { ChatTimeline } from '../components/ChatTimeline';
import { useRunTimeline } from '../lib/useRunTimeline';

type Run = {
  id: string;
  prompt: string;
  status: string;
  errorMessage: string | null;
};

export function RunThread({ run, live }: { run: Run; live: boolean }) {
  const { timeline } = useRunTimeline(run.id, live);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (live) endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [timeline, live]);

  return (
    <div className="message-block">
      <div className="message user">
        <span className="msg-label">Du</span>
        <div className="msg-body">{run.prompt}</div>
      </div>
      <ChatTimeline items={timeline} />
      {run.errorMessage && <p className="form-error">{run.errorMessage}</p>}
      <div ref={endRef} />
    </div>
  );
}
