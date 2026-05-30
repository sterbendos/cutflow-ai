// CutFlow AI — Enhanced AI Chat Panel
// Context-aware chat with action suggestions and natural language
// command dispatch via the MCP protocol.

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useTimeline } from '@/context/TimelineContext';
import { useMotionGraphics } from '@/context/MotionGraphicsContext';
import { parseMotionPrompt } from '@/lib/motion-parser';

const MCP_URL = 'http://127.0.0.1:14220';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  text: string;
  timestamp: number;
}

function SendIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

function SparklesIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z"/><path d="M18 14l1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2z"/><path d="M6 14l-1 2-2 1 2 1 1 2 1-2 2-1-2-1-1-2z"/>
    </svg>
  );
}

export default function ChatPanel() {
  const { state, transcript, deleteRange, toggleSilenceSkip } = useTimeline();
  const { items: mgItems, addFromTemplate } = useMotionGraphics();

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'system-welcome',
      role: 'system',
      text: 'Connected to CutFlow AI. Describe what you want to do, or type /help for commands.\n\nSuggestions:\n• "Load a video and analyze it"\n• "Remove all silent parts"\n• "Apply a lower third graphic"',
      timestamp: Date.now(),
    },
  ]);
  const [input, setInput] = useState('');
  const [connected, setConnected] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(true);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingIdRef = useRef<number | null>(null);
  pendingIdRef.current = pendingId;

  const hasVideo = Boolean(state.source_video_path);
  const hasTranscript = transcript.length > 0;
  const hasSilences = state.edl.some(s => s.segment_type === 'silence');

  // ── Context-aware suggestions ──
  const suggestions = useMemo(() => {
    const chips: Array<{ label: string; action: () => void }> = [];

    if (!hasVideo) {
      chips.push({
        label: 'Load a video to start',
        action: () => setInput('Load a video file and analyze it'),
      });
    }

    if (hasVideo && hasSilences) {
      chips.push({
        label: 'Remove all silences',
        action: () => setInput('Remove all silent sections from the timeline'),
      });
    }

    if (hasVideo && !hasTranscript) {
      chips.push({
        label: 'Generate transcript',
        action: () => setInput('Transcribe the current video'),
      });
    }

    if (hasVideo) {
      chips.push({
        label: 'Timeline summary',
        action: () => setInput('/summary'),
      });
      chips.push({
        label: 'Add a lower third',
        action: () => setInput('Add a name lower third at the current position'),
      });
    }

    if (hasTranscript) {
      chips.push({
        label: 'Remove filler words',
        action: () => setInput('Delete all filler words from the timeline'),
      });
    }

    if (hasVideo && mgItems.length > 0) {
      chips.push({
        label: 'Export video',
        action: () => setInput('Export the edited video'),
      });
    }

    return chips;
  }, [hasVideo, hasSilences, hasTranscript, mgItems.length]);

  // ── Timeline context summary for toolbar ──
  const contextInfo = useMemo(() => {
    const parts: string[] = [];
    if (!hasVideo) return 'No video loaded';

    const keepCount = state.edl.filter(s => s.segment_type === 'keep').length;
    const silenceCount = state.edl.filter(s => s.segment_type === 'silence').length;
    const deletedCount = state.edl.filter(s => s.segment_type === 'user-deleted').length;
    parts.push(`${keepCount} clips`);
    if (silenceCount > 0) parts.push(`${silenceCount} silences`);
    if (deletedCount > 0) parts.push(`${deletedCount} cut`);

    if (transcript.length > 0) parts.push(`${transcript.length} words`);
    if (mgItems.length > 0) parts.push(`${mgItems.length} graphics`);

    return parts.join(' · ') || 'Editing project';
  }, [hasVideo, state.edl, transcript.length, mgItems.length]);

  // ── MCP connection ──
  const connect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const es = new EventSource(`${MCP_URL}/mcp`);
    eventSourceRef.current = es;

    es.onopen = () => setConnected(true);

    es.addEventListener('endpoint', (event) => {
      const idMatch = event.data.match(/id=([a-f0-9-]+)/);
      if (idMatch) {
        setSessionId(idMatch[1]);
      }
    });

    es.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.result) {
          const content = data.result.content?.[0]?.text;
          if (content) {
            try {
              const parsed = JSON.parse(content);
              addMessage('tool', JSON.stringify(parsed, null, 2).slice(0, 2000));
            } catch {
              addMessage('tool', content.slice(0, 2000));
            }
          }
        }
        if (data.error) {
          addMessage('system', `Error: ${data.error.message}`);
        }
        if (pendingIdRef.current === data.id) {
          setPendingId(null);
        }
      } catch {}
    });

    es.onerror = () => {
      setConnected(false);
      setTimeout(connect, 3000);
    };
  }, []);

  useEffect(() => {
    connect();
    return () => eventSourceRef.current?.close();
  }, [connect]);

  // Focus input on Cmd+K
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const scrollToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  useEffect(() => { scrollToBottom(); }, [messages]);

  const addMessage = (role: ChatMessage['role'], text: string) => {
    setMessages(prev => [...prev, { id: crypto.randomUUID(), role, text, timestamp: Date.now() }]);
  };

  const sendMcpCommand = async (method: string, args: any = {}) => {
    if (!sessionId) {
      addMessage('system', 'Not connected to MCP server. Retrying...');
      return;
    }

    const msgId = Date.now();
    setPendingId(msgId);

    try {
      await fetch(`${MCP_URL}/mcp/message?id=${sessionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: msgId,
          method,
          params: method === 'tools/call' ? { name: args.tool, arguments: args.params } : args,
        }),
      });
    } catch (err) {
      addMessage('system', `Network error: ${err}`);
    }
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    setShowSuggestions(false);
    addMessage('user', text);

    if (text.startsWith('/')) {
      const parts = text.slice(1).split(/\s+/);
      const cmd = parts[0];

      switch (cmd) {
        case 'load':
          await sendMcpCommand('tools/call', { tool: 'load_video', params: { path: parts[1] || '', duration: parseFloat(parts[2]) || 60 } });
          break;
        case 'cut':
          await sendMcpCommand('tools/call', { tool: 'cut_range', params: { start: parseFloat(parts[1]) || 0, end: parseFloat(parts[2]) || 0 } });
          break;
        case 'summary':
          await sendMcpCommand('tools/call', { tool: 'get_timeline_summary', params: {} });
          break;
        case 'status':
          await sendMcpCommand('tools/call', { tool: 'get_timeline', params: {} });
          break;
        case 'toggle-skip':
          await toggleSilenceSkip();
          addMessage('system', `Silence skip: ${!state.is_silence_skip_enabled ? 'ON' : 'OFF'}`);
          break;
        case 'export':
          await sendMcpCommand('tools/call', { tool: 'export_video', params: { output_path: parts[1] || 'export.mp4' } });
          break;
        case 'analyze':
          await sendMcpCommand('tools/call', { tool: 'analyze_video', params: { sensitivity: parts[1] || 'balanced' } });
          break;
        case 'help':
          addMessage('system',
            'Commands:\n' +
            '  /load <path> <duration> — Load a video\n' +
            '  /cut <start> <end> — Delete time range\n' +
            '  /summary — Timeline summary\n' +
            '  /status — Full timeline state\n' +
            '  /toggle-skip — Toggle silence skip\n' +
            '  /export <path> — Export video\n' +
            '  /analyze <sensitivity> — Auto-analyze\n' +
            '  /help — Show this help\n\n' +
            'Natural language: Just describe what you want!'
          );
          break;
        default:
          addMessage('system', `Unknown command: /${cmd}. Try /help`);
      }
    } else {
      // Natural language → try to route to appropriate MCP tools
      const lower = text.toLowerCase();
      let handled = false;

      // Detect common intents
      if (lower.includes('cut') || lower.includes('delete') || lower.includes('remove')) {
        // Try silence removal
        if (lower.includes('silence') || lower.includes('silent') || lower.includes('pause')) {
          if (hasSilences) {
            // Use the frontend's deleteRange for each silence segment
            const silences = state.edl.filter(s => s.segment_type === 'silence');
            for (const seg of silences) {
              await deleteRange(seg.start, seg.end);
            }
            addMessage('system', `Removed ${silences.length} silent section(s) from timeline.`);
            handled = true;
          }
        }
        // Try filler word removal
        if (lower.includes('filler') || lower.includes('um') || lower.includes('uh')) {
          addMessage('system', 'Use the Eraser button in the Transcript panel to remove all filler words.');
          handled = true;
        }
      }

      if (lower.includes('summary') || lower.includes('status') || lower.includes('what')) {
        await sendMcpCommand('tools/call', { tool: 'get_timeline_summary', params: {} });
        handled = true;
      }

      if (lower.includes('export') || lower.includes('render') || lower.includes('save')) {
        await sendMcpCommand('tools/call', { tool: 'export_video', params: { output_path: 'export.mp4' } });
        handled = true;
      }

      if (lower.includes('analyze') || lower.includes('detect')) {
        await sendMcpCommand('tools/call', { tool: 'analyze_video', params: { sensitivity: 'balanced' } });
        handled = true;
      }

      if (lower.includes('graphic') || lower.includes('lower third') || lower.includes('title')) {
        const parsed = parseMotionPrompt(text);
        if (parsed && parsed.text) {
          const start = parsed.startTime ?? state.current_time;
          const end = parsed.endTime ?? Math.min(start + 5, state.edl.reduce((max, s) => Math.max(max, s.end), 120));
          addFromTemplate(parsed.template, parsed.text, parsed.subtitle || '', start, end);
          addMessage('system', `Added "${parsed.template}" graphic: "${parsed.text}"${parsed.subtitle ? ` — ${parsed.subtitle}` : ''}${parsed.startTime !== undefined ? ` at ${parsed.startTime}s` : ''}`);
        } else {
          addMessage('system', 'Could not understand the graphic. Try: "add a lower third that says John Doe"');
        }
        handled = true;
      }

      if (lower.includes('load') || lower.includes('open') || lower.includes('import')) {
        addMessage('system', 'Drag and drop a video file into the Media panel, or click the + button to browse files.');
        handled = true;
      }

      if (!handled) {
        addMessage('system', `Not sure how to help with that directly. I understand:\n• Cut/remove silences\n• Timeline summary/status\n• Remove filler words\n• Export video\n• Analyze video\n• Add graphics\n• Load/import media\n\nType /help for all commands.`);
      }
    }
  };

  const connectionStatus = connected
    ? { color: 'var(--teal-primary)', label: 'Connected' }
    : { color: '#ef4444', label: 'Disconnected' };

  return (
    <aside className="chat-panel" id="chat-panel" aria-label="AI Chat">
      {/* Header */}
      <div className="chat-panel__header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <SparklesIcon />
          <span className="chat-panel__title">AI Assistant</span>
        </div>
        <span className="chat-panel__status" style={{ color: connectionStatus.color }}>
          <span className="chat-panel__dot" style={{ background: connectionStatus.color }} />
          {connectionStatus.label}
        </span>
      </div>

      {/* Context bar */}
      {hasVideo && (
        <div
          style={{
            padding: '4px 10px',
            fontSize: 10,
            color: 'var(--teal-primary)',
            background: 'rgba(20, 184, 166, 0.06)',
            borderBottom: '1px solid var(--border)',
            fontFamily: 'monospace',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
          title={contextInfo}
        >
          {contextInfo}
        </div>
      )}

      {/* Messages */}
      <div className="chat-panel__messages" id="chat-messages">
        {messages.map((msg) => (
          <div key={msg.id} className={`chat-message chat-message--${msg.role}`}>
            <div className="chat-message__label">
              {msg.role === 'user' ? 'You' : msg.role === 'tool' ? 'Editor' : msg.role === 'system' ? 'System' : 'AI'}
            </div>
            <pre className="chat-message__text">{msg.text}</pre>
          </div>
        ))}

        {/* Context suggestions */}
        {showSuggestions && suggestions.length > 0 && (
          <div style={{ padding: '8px 10px', display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {suggestions.map((s, i) => (
              <button
                key={i}
                onClick={() => {
                  setInput(s.label);
                  inputRef.current?.focus();
                }}
                style={{
                  padding: '3px 8px',
                  fontSize: 10,
                  fontWeight: 500,
                  background: 'rgba(20, 184, 166, 0.1)',
                  color: 'var(--teal-primary)',
                  border: '1px solid rgba(20, 184, 166, 0.2)',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(20, 184, 166, 0.2)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(20, 184, 166, 0.1)'; }}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="chat-panel__input-row">
        <input
          ref={inputRef}
          className="chat-panel__input"
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder={hasVideo ? 'Ask AI to edit your video...' : 'Type /help for commands...'}
          aria-label="Chat input"
        />
        <button
          className="chat-panel__send"
          onClick={handleSend}
          disabled={!input.trim()}
          aria-label="Send"
          style={{ opacity: !input.trim() ? 0.5 : 1 }}
        >
          <SendIcon />
        </button>
      </div>
    </aside>
  );
}
