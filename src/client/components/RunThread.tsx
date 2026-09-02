import { useEffect, useRef, useState } from 'react';
import { ChatTimeline } from '../components/ChatTimeline';
import { useRunTimeline } from '../lib/useRunTimeline';
import { useMediaQuery } from '../lib/useMediaQuery';

type Run = {
  id: string;
  prompt: string;
  status: string;
  errorMessage: string | null;
};

const COLLAPSE_AT = 280;

function UserBlock({ text }: { text: string }) {
  const isMobile = useMediaQuery('(max-width: 860px)');
  const long = text.length > COLLAPSE_AT || text.split('\n').length > 6;
  const [open, setOpen] = useState(!isMobile || !long);

  useEffect(() => {
    setOpen(!isMobile || !long);
  }, [isMobile, long, text]);

  if (!long) {
    return (
      <div className="user-block">
        <div className="user-text">{text}</div>
      </div>
    );
  }

  return (
    <div className="user-block">
      <div className={`user-text${open ? '' : ' user-text-clamp'}`}>{text}</div>
      <button type="button" className="user-toggle" onClick={() => setOpen((v) => !v)}>
        {open ? 'Weniger anzeigen' : 'Ganze Nachricht anzeigen'}
      </button>
    </div>
  );
}

export function RunThread({ run, live, isFirst }: { run: Run; live: boolean; isFirst?: boolean }) {
  const { timeline } = useRunTimeline(run.id, live);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (live) endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [timeline, live]);

  return (
    <section className="chat-turn">
      {!isFirst && <div className="turn-divider" />}
      <UserBlock text={run.prompt} />
      <ChatTimeline items={timeline} live={live} />
      {run.errorMessage && <p className="chat-error">{run.errorMessage}</p>}
      <div ref={endRef} />
    </section>
  );
}
