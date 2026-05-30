// CutFlow AI — MCP Agent Configuration Panel
// Shows the MCP server status and provides one-click config snippets
// for connecting Claude Desktop, Cursor, Codex, and other AI agents.

import { useState, useEffect, useCallback } from 'react';

// ─── SVG Icons ────────────────────────────────────────────────

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
    </svg>
  );
}

function PlugIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/>
      <path d="M18 8v5a6 6 0 0 1-12 0V8Z"/>
    </svg>
  );
}

// ─── Agent Config Snippets ────────────────────────────────────

const MCP_PORT = 14220;
const MCP_BASE_URL = `http://127.0.0.1:${MCP_PORT}`;
const MCP_SSE_URL = `${MCP_BASE_URL}/mcp`;

interface AgentConfig {
  id: string;
  name: string;
  icon: string;
  description: string;
  configType: 'json' | 'cli' | 'text';
  configContent: string;
  configLabel: string;
}

const AGENT_CONFIGS: AgentConfig[] = [
  {
    id: 'claude-desktop',
    name: 'Claude Desktop',
    icon: '🤖',
    description: 'Connect Claude Desktop to edit videos using natural language.',
    configType: 'json',
    configLabel: 'claude_desktop_config.json',
    configContent: JSON.stringify({
      mcpServers: {
        "cutflow-ai": {
          command: "npx",
          args: ["-y", "@anthropic-ai/mcp-client-sse", "--url", MCP_SSE_URL],
        },
      },
    }, null, 2),
  },
  {
    id: 'cursor',
    name: 'Cursor IDE',
    icon: '⌨',
    description: 'Edit videos directly from Cursor using MCP tools.',
    configType: 'json',
    configLabel: '.cursor/mcp.json',
    configContent: JSON.stringify({
      mcpServers: {
        "cutflow-ai": {
          url: MCP_SSE_URL,
        },
      },
    }, null, 2),
  },
  {
    id: 'claude-code',
    name: 'Claude Code (CLI)',
    icon: '⚡',
    description: 'Run `claude mcp add` to connect Claude Code to CutFlow.',
    configType: 'cli',
    configLabel: 'Terminal Command',
    configContent: `claude mcp add cutflow-ai -- npx -y @anthropic-ai/mcp-client-sse --url ${MCP_SSE_URL}`,
  },
  {
    id: 'codex',
    name: 'OpenAI Codex',
    icon: '🔮',
    description: 'Connect Codex CLI to CutFlow for AI-assisted video editing.',
    configType: 'cli',
    configLabel: 'Terminal Command',
    configContent: `codex mcp add cutflow-ai -- npx -y @anthropic-ai/mcp-client-sse --url ${MCP_SSE_URL}`,
  },
  {
    id: 'custom',
    name: 'Custom MCP Client',
    icon: '🔗',
    description: 'Any MCP-compatible client can connect to CutFlow.',
    configType: 'text',
    configLabel: 'MCP Endpoint',
    configContent: `SSE Endpoint: ${MCP_SSE_URL}\nMessage URL: ${MCP_BASE_URL}/mcp/message?id={session_id}\n\nAvailable Tools:\n- get_timeline\n- get_timeline_summary  \n- load_video\n- cut_range\n- mark_segment\n- split_segment\n- toggle_silence_skip\n- analyze_video\n- export_video`,
  },
];

// ─── Server Status Check ──────────────────────────────────────

function useMcpStatus() {
  const [status, setStatus] = useState<'checking' | 'online' | 'offline'>('checking');

  const check = useCallback(async () => {
    setStatus('checking');
    try {
      const res = await fetch(`${MCP_BASE_URL}/api/timeline`, {
        signal: AbortSignal.timeout(2000),
      });
      setStatus(res.ok ? 'online' : 'offline');
    } catch {
      setStatus('offline');
    }
  }, []);

  useEffect(() => {
    check();
    const interval = setInterval(check, 5000);
    return () => clearInterval(interval);
  }, [check]);

  return { status, check };
}

// ─── Copy Button ──────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for environments without clipboard API
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <button
      className="mcp__copy-btn"
      onClick={handleCopy}
      title="Copy to clipboard"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '4px 8px',
        fontSize: 10,
        fontWeight: 600,
        background: copied ? 'var(--teal-primary)' : 'var(--surface)',
        color: copied ? '#fff' : 'var(--text-primary)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-sm)',
        cursor: 'pointer',
        transition: 'all 0.15s',
      }}
    >
      {copied ? <><CheckIcon /> Copied</> : <><CopyIcon /> Copy</>}
    </button>
  );
}

// ─── Main Component ───────────────────────────────────────────

export default function MCPConfigPanel() {
  const { status, check } = useMcpStatus();
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);

  const statusColor = status === 'online' ? 'var(--teal-primary)' : status === 'offline' ? '#dc2626' : '#f59e0b';
  const statusLabel = status === 'online' ? 'Connected' : status === 'offline' ? 'Offline' : 'Checking…';

  return (
    <div className="mcp-panel">
      {/* Server Status Banner */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 10px',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)',
          marginBottom: 12,
        }}
      >
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: statusColor,
            flexShrink: 0,
          }}
          aria-hidden="true"
        />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)' }}>
            MCP Server — {statusLabel}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-subtle)', fontFamily: 'monospace' }}>
            {MCP_SSE_URL}
          </div>
        </div>
        <button
          onClick={check}
          style={{
            padding: '4px 8px',
            fontSize: 10,
            background: 'transparent',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--text-muted)',
            cursor: 'pointer',
          }}
          title="Refresh status"
        >
          Refresh
        </button>
      </div>

      {/* Description */}
      <p style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 12, padding: '0 2px' }}>
        Connect your favorite AI agent to CutFlow for natural language video editing.
        Choose your agent below and copy the configuration.
      </p>

      {/* Agent Cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {AGENT_CONFIGS.map((agent) => {
          const isExpanded = expandedAgent === agent.id;

          return (
            <div
              key={agent.id}
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                overflow: 'hidden',
              }}
            >
              {/* Agent Header — always visible */}
              <button
                onClick={() => setExpandedAgent(isExpanded ? null : agent.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  width: '100%',
                  padding: '10px 12px',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--text-primary)',
                  textAlign: 'left',
                }}
              >
                <span style={{ fontSize: 18 }}>{agent.icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{agent.name}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-subtle)', marginTop: 1 }}>
                    {agent.description}
                  </div>
                </div>
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  style={{
                    transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                    transition: 'transform 0.15s',
                    color: 'var(--text-muted)',
                  }}
                >
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </button>

              {/* Expanded Config — shown when clicked */}
              {isExpanded && (
                <div style={{ borderTop: '1px solid var(--border)', padding: '10px 12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      {agent.configLabel}
                    </span>
                    <CopyButton text={agent.configContent} />
                  </div>
                  <pre
                    style={{
                      margin: 0,
                      padding: '8px 10px',
                      background: 'var(--canvas)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: 10,
                      lineHeight: 1.5,
                      color: 'var(--text-primary)',
                      overflowX: 'auto',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      fontFamily: 'monospace',
                    }}
                  >
                    {agent.configContent}
                  </pre>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Quick Test Section */}
      <div
        style={{
          marginTop: 12,
          padding: '10px 12px',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <PlugIcon />
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)' }}>
            Quick Test
          </span>
        </div>
        <p style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.4, margin: 0 }}>
          Verify your AI agent can reach CutFlow by running this command in your terminal:
        </p>
        <pre
          style={{
            margin: '6px 0 0',
            padding: '8px 10px',
            background: 'var(--canvas)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 10,
            color: 'var(--teal-primary)',
            fontFamily: 'monospace',
            overflowX: 'auto',
          }}
        >
          {`curl -s ${MCP_SSE_URL} | head -5`}
        </pre>
        <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
          <button
            onClick={async () => {
              try {
                const res = await fetch(`${MCP_BASE_URL}/api/timeline`);
                const data = await res.json();
                alert(`Connected! Timeline: ${data.edl?.length || 0} segments, ${data.source_video_path ? 'video loaded' : 'no video loaded'}`);
              } catch {
                alert('Cannot reach MCP server. Is CutFlow running?');
              }
            }}
            style={{
              flex: 1,
              padding: '6px 10px',
              fontSize: 10,
              fontWeight: 600,
              background: 'var(--teal-primary)',
              color: '#fff',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
            }}
          >
            Test Connection
          </button>
        </div>
      </div>
    </div>
  );
}
