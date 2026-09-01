import { Agent, CursorAgentError, decodeLocalRunStreamEvent, localRunStreamEventToSdkMessage } from '@cursor/sdk';
import type { SDKMessage } from '@cursor/sdk';
import { env } from '../config.js';
import { AppError } from '../util/errors.js';
import { getCursorApiKey } from './settings.js';
import type { AgentStreamEvent } from '../../shared/timeline.js';

export type NormalizedEvent = AgentStreamEvent;

export type RunExecutorOptions = {
  panelRunId: string;
  agentId: string | null;
  cwd: string;
  model: string;
  prompt: string;
  onEvent: (event: NormalizedEvent) => void;
  isCancelled: () => boolean;
};

export type RunExecutorResult = {
  agentId: string;
  runId: string;
  status: 'finished' | 'error' | 'cancelled';
  errorMessage?: string;
};

function assertApiKey(): string {
  const key = getCursorApiKey();
  if (!key) throw new AppError('CONFIG_ERROR', 'Cursor API-Key nicht konfiguriert.', 503);
  return key;
}

function ts(): string {
  return new Date().toISOString();
}

const SDK_MESSAGE_TYPES = new Set([
  'system',
  'assistant',
  'user',
  'tool_call',
  'thinking',
  'status',
  'request',
  'task',
  'usage',
]);

function unwrapSdkMessage(event: unknown): SDKMessage | null {
  const e = event as Record<string, unknown>;
  if (e && typeof e === 'object') {
    if (e.type === 'sdk_message' && e.message && typeof e.message === 'object') {
      return e.message as SDKMessage;
    }
    if (typeof e.type === 'string' && SDK_MESSAGE_TYPES.has(e.type)) {
      return e as unknown as SDKMessage;
    }
  }
  return null;
}

function safeJson(value: unknown): unknown {
  if (value === undefined || value === null) return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

function normalizeSdkMessage(msg: SDKMessage): NormalizedEvent[] {
  const timestamp = ts();
  switch (msg.type) {
    case 'assistant': {
      const out: NormalizedEvent[] = [];
      for (const block of msg.message.content) {
        if (block.type === 'text' && block.text) {
          out.push({ type: 'assistant', text: block.text, timestamp });
        } else if (block.type === 'tool_use') {
          out.push({
            type: 'tool_call',
            tool: block.name,
            toolId: block.id,
            toolStatus: 'running',
            toolInput: safeJson(block.input),
            timestamp,
          });
        }
      }
      return out;
    }

    case 'thinking':
      return [
        {
          type: 'thinking',
          text: msg.text,
          thinkingDurationMs: msg.thinking_duration_ms,
          timestamp,
        },
      ];

    case 'tool_call':
      return [
        {
          type: 'tool_call',
          tool: msg.name,
          toolId: msg.call_id,
          toolStatus: msg.status,
          toolInput: safeJson(msg.args),
          toolResult: safeJson(msg.result),
          timestamp,
        },
      ];

    case 'status':
      return [{ type: 'status', status: msg.status, text: msg.message, timestamp }];

    case 'task':
      return [{ type: 'task', text: msg.text, taskStatus: msg.status, timestamp }];

    case 'usage':
      return [{ type: 'usage', usage: safeJson(msg.usage) as Record<string, unknown>, timestamp }];

    case 'system':
      return [
        {
          type: 'system',
          subtype: msg.subtype,
          text: msg.model ? `Modell: ${msg.model.id}` : undefined,
          timestamp,
        },
      ];

    case 'user':
      return msg.message.content
        .filter((b) => b.type === 'text' && b.text)
        .map((b) => ({ type: 'user', text: b.text, timestamp }));

    case 'request':
      return [{ type: 'request', text: msg.request_id, timestamp }];

    default:
      return [{ type: 'unknown', timestamp }];
  }
}

function normalizeSdkEvent(event: unknown): NormalizedEvent[] {
  try {
    const streamEv = decodeLocalRunStreamEvent(event);
    if (streamEv.type === 'result') {
      if (streamEv.status === 'error') {
        return [{ type: 'error', text: streamEv.errorCode || 'Run fehlgeschlagen', timestamp: ts() }];
      }
      return [];
    }
    if (streamEv.type === 'done') return [];
    const fromStream = localRunStreamEventToSdkMessage(streamEv);
    if (fromStream) return normalizeSdkMessage(fromStream);
  } catch {
    /* not a LocalRunStreamEvent */
  }

  const msg = unwrapSdkMessage(event);
  if (msg) return normalizeSdkMessage(msg);

  const e = event as Record<string, unknown>;

  if (e.type === 'text-delta' && typeof e.text === 'string') {
    return [{ type: 'assistant', text: e.text, timestamp: ts() }];
  }
  if (e.type === 'thinking-delta' && typeof e.text === 'string') {
    return [{ type: 'thinking', text: e.text, timestamp: ts() }];
  }
  if (e.type === 'thinking-completed' && typeof e.thinkingDurationMs === 'number') {
    return [{ type: 'thinking', text: '', thinkingDurationMs: e.thinkingDurationMs, timestamp: ts() }];
  }
  if (e.type === 'tool-call-started') {
    const toolCall = e.toolCall as { type?: string; args?: unknown } | undefined;
    return [
      {
        type: 'tool_call',
        tool: toolCall?.type || 'tool',
        toolId: String(e.callId || ''),
        toolStatus: 'running',
        toolInput: safeJson(toolCall?.args),
        timestamp: ts(),
      },
    ];
  }
  if (e.type === 'tool-call-completed') {
    const toolCall = e.toolCall as { type?: string; args?: unknown; result?: unknown } | undefined;
    return [
      {
        type: 'tool_call',
        tool: toolCall?.type || 'tool',
        toolId: String(e.callId || ''),
        toolStatus: 'completed',
        toolInput: safeJson(toolCall?.args),
        toolResult: safeJson(toolCall?.result),
        timestamp: ts(),
      },
    ];
  }
  if (e.type === 'shell-output-delta' && typeof e.text === 'string') {
    return [
      {
        type: 'tool_call',
        tool: 'shell',
        toolId: 'shell-output',
        toolStatus: 'running',
        toolResult: e.text,
        timestamp: ts(),
      },
    ];
  }
  if (e.type === 'summary-started' || e.type === 'summary-completed') {
    return [{ type: 'task', text: String(e.summary || e.type), taskStatus: e.type, timestamp: ts() }];
  }

  const legacy = event as {
    type?: string;
    text?: string;
    message?: { content?: Array<{ type?: string; text?: string; name?: string; id?: string; input?: unknown }> };
  };

  if (legacy.type === 'assistant' && legacy.message?.content) {
    return normalizeSdkMessage({
      type: 'assistant',
      agent_id: '',
      run_id: '',
      message: { role: 'assistant', content: legacy.message.content as never },
    });
  }

  if (legacy.type && legacy.text) return [{ type: legacy.type, text: legacy.text, timestamp: ts() }];
  if (legacy.type) return [{ type: legacy.type, timestamp: ts() }];
  return [{ type: 'unknown', timestamp: ts() }];
}

const activeCancellers = new Map<string, () => Promise<void>>();

export async function executeAgentRun(options: RunExecutorOptions): Promise<RunExecutorResult> {
  const apiKey = assertApiKey();
  const localOpts = { cwd: options.cwd, settingSources: [] as [] };
  const modelSel = { id: options.model };

  let agent: Awaited<ReturnType<typeof Agent.create>>;
  try {
    if (options.agentId) {
      agent = await Agent.resume(options.agentId, { apiKey, model: modelSel, local: localOpts });
    } else {
      agent = await Agent.create({ apiKey, model: modelSel, local: localOpts });
    }
  } catch (err) {
    if (err instanceof CursorAgentError) {
      throw new AppError('AGENT_STARTUP_FAILED', err.message, 502, { retryable: err.isRetryable });
    }
    throw err;
  }

  let runId = '';
  try {
    const run = await agent.send(options.prompt, { model: modelSel, local: { force: true } });
    runId = run.id;
    if (run.supports('cancel')) {
      activeCancellers.set(options.panelRunId, () => run.cancel());
    }

    options.onEvent({ type: 'run_started', text: runId, timestamp: ts() });

    const streamPromise = (async () => {
      try {
        for await (const event of run.stream()) {
          if (options.isCancelled()) break;
          for (const n of normalizeSdkEvent(event)) options.onEvent(n);
        }
      } catch (streamErr) {
        if (!options.isCancelled()) {
          options.onEvent({
            type: 'error',
            text: streamErr instanceof Error ? streamErr.message : 'Stream-Fehler',
            timestamp: ts(),
          });
        }
      }
    })();

    const timeoutMs = env.AGENT_MAX_RUN_MS;
    const timeoutPromise = new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), timeoutMs));
    const race = await Promise.race([
      run.wait().then((result) => ({ kind: 'done' as const, result })),
      timeoutPromise.then(() => ({ kind: 'timeout' as const })),
    ]);

    if (race.kind === 'timeout') {
      await cancelActiveRun(options.panelRunId);
      await streamPromise.catch(() => undefined);
      return {
        agentId: agent.agentId,
        runId,
        status: 'cancelled',
        errorMessage: `Timeout nach ${Math.round(timeoutMs / 60_000)} Min`,
      };
    }

    if (options.isCancelled()) {
      await streamPromise.catch(() => undefined);
      return { agentId: agent.agentId, runId, status: 'cancelled', errorMessage: 'Abgebrochen' };
    }

    await streamPromise.catch(() => undefined);
    if (race.result.status === 'error') {
      return { agentId: agent.agentId, runId, status: 'error', errorMessage: 'Run fehlgeschlagen' };
    }

    options.onEvent({ type: 'run_finished', timestamp: ts() });
    return { agentId: agent.agentId, runId, status: 'finished' };
  } catch (err) {
    if (err instanceof CursorAgentError) {
      throw new AppError('AGENT_STARTUP_FAILED', err.message, 502, { retryable: err.isRetryable });
    }
    throw err;
  } finally {
    activeCancellers.delete(options.panelRunId);
    await agent[Symbol.asyncDispose]().catch(() => undefined);
  }
}

export async function cancelActiveRun(panelRunId: string): Promise<boolean> {
  const fn = activeCancellers.get(panelRunId);
  if (!fn) return false;
  await fn().catch(() => undefined);
  return true;
}
