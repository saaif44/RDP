import { useEffect, useState, useRef } from 'react';
import { io } from 'socket.io-client';
import { Monitor, Laptop, Server, X, File, Download, Folder, ArrowLeft, LayoutGrid, Terminal, Trash2, Eye, MousePointerClick, Gauge, LogOut, Maximize, Minimize } from 'lucide-react';
import './index.css';

const LOCAL_SERVER_URL = 'http://localhost:7420';
const TOKEN_KEY = 'localrdp_token';
const apiUrl = (p) => `${LOCAL_SERVER_URL}${p}`;

// Streaming presets. Clarity is the default; low latency is opt-in.
const QUALITY_MODES = [
  { id: 'clear', label: 'Clear', hint: 'Sharpest picture' },
  { id: 'balanced', label: 'Balanced', hint: 'Good picture, lower lag' },
  { id: 'low_latency', label: 'Low Latency', hint: 'Fastest response, softer picture' },
];

const formatLogTime = (timestamp) => {
  return new Intl.DateTimeFormat([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(new Date(timestamp));
};

// Sub-component for a single remote screen/agent
const RemoteAgentView = ({ agent, onClose, isGrid }) => {
  const [screenImage, setScreenImage] = useState(null);
  const [activeTab, setActiveTab] = useState('screen');
  const [currentPath, setCurrentPath] = useState('');
  const [files, setFiles] = useState([]);
  const [fileError, setFileError] = useState(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [controlEnabled, setControlEnabled] = useState(false);
  const [qualityMode, setQualityMode] = useState('clear');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const screenRef = useRef(null);
  const viewRef = useRef(null);
  const socketRef = useRef(null);

  useEffect(() => {
    const agentUrl = `http://${agent.ip}:${agent.port}`;
    const newSocket = io(agentUrl);
    socketRef.current = newSocket;

    newSocket.on('screen_data', (data) => setScreenImage(data.image));
    newSocket.on('agent_state', (state) => {
      if (state.quality_mode) setQualityMode(state.quality_mode);
      if (typeof state.control_enabled === 'boolean') setControlEnabled(state.control_enabled);
    });
    newSocket.on('dir_data', (data) => {
      setCurrentPath(data.path);
      setFiles(data.files);
      setFileError(null);
    });
    newSocket.on('dir_error', (data) => {
      setFileError(data.error);
      setIsDownloading(false);
    });
    newSocket.on('file_data', (data) => {
      setIsDownloading(false);
      const link = document.createElement('a');
      link.href = `data:application/octet-stream;base64,${data.data}`;
      link.download = data.name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    });

    return () => {
      socketRef.current = null;
      newSocket.close();
    };
  }, [agent]);

  useEffect(() => {
    if (activeTab === 'files' && socketRef.current && !currentPath) {
      socketRef.current.emit('list_dir', {});
    }
  }, [activeTab, currentPath]);

  const changeQuality = (mode) => {
    setQualityMode(mode);
    socketRef.current?.emit('set_quality', { mode });
  };

  const toggleControl = () => {
    const next = !controlEnabled;
    setControlEnabled(next);
    socketRef.current?.emit('set_control', { enabled: next });
  };

  const toggleFullscreen = () => {
    const el = viewRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
    } else {
      el.requestFullscreen?.().catch(() => {});
    }
  };

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // Map a pointer event to image-relative percentages, accounting for the
  // letterbox bars that object-fit: contain leaves around the feed.
  const getImagePercent = (e) => {
    const img = screenRef.current;
    if (!img || !img.naturalWidth || !img.naturalHeight) return null;
    const rect = img.getBoundingClientRect();
    const imageRatio = img.naturalWidth / img.naturalHeight;
    const boxRatio = rect.width / rect.height;
    let renderW = rect.width;
    let renderH = rect.height;
    if (imageRatio > boxRatio) {
      renderH = rect.width / imageRatio;
    } else {
      renderW = rect.height * imageRatio;
    }
    const offsetX = (rect.width - renderW) / 2;
    const offsetY = (rect.height - renderH) / 2;
    const x = e.clientX - rect.left - offsetX;
    const y = e.clientY - rect.top - offsetY;
    if (x < 0 || y < 0 || x > renderW || y > renderH) return null;
    return { x_pct: x / renderW, y_pct: y / renderH };
  };

  const handleMouseMove = (e) => {
    const socket = socketRef.current;
    if (!socket || !controlEnabled) return;
    const pos = getImagePercent(e);
    if (pos) socket.emit('mouse_move', pos);
  };

  const handleMouseClick = (e) => {
    const socket = socketRef.current;
    if (!socket || !controlEnabled) return;
    socket.emit('mouse_click', { button: e.button });
  };

  const handleWheel = (e) => {
    const socket = socketRef.current;
    if (!socket || !controlEnabled) return;
    socket.emit('mouse_scroll', { dy: e.deltaY });
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      const socket = socketRef.current;
      if (!socket || activeTab !== 'screen' || isGrid || !controlEnabled) return;
      e.preventDefault();
      socket.emit('key_press', { key: e.key });
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTab, isGrid, controlEnabled]);

  const handleDirClick = (folderName) => {
    const socket = socketRef.current;
    if (!socket) return;
    const separator = agent.os === 'Windows' ? '\\' : '/';
    const newPath = currentPath + (currentPath.endsWith(separator) ? '' : separator) + folderName;
    socket.emit('list_dir', { path: newPath });
  };

  const handleGoUp = () => {
    const socket = socketRef.current;
    if (!socket) return;
    const separator = agent.os === 'Windows' ? '\\' : '/';
    const parts = currentPath.split(separator).filter(Boolean);
    if (parts.length > 1) {
      parts.pop();
      const newPath = agent.os === 'Windows' && parts.length === 1 && parts[0].includes(':') 
        ? parts[0] + separator 
        : parts.join(separator);
      socket.emit('list_dir', { path: newPath || separator });
    } else if (parts.length === 1 && agent.os !== 'Windows') {
      socket.emit('list_dir', { path: '/' });
    }
  };

  const handleDownload = (fileName) => {
    const socket = socketRef.current;
    if (!socket) return;
    const separator = agent.os === 'Windows' ? '\\' : '/';
    const filePath = currentPath + (currentPath.endsWith(separator) ? '' : separator) + fileName;
    setIsDownloading(true);
    socket.emit('download_file', { path: filePath });
  };

  return (
    <div ref={viewRef} className={`remote-view ${isGrid ? 'grid-item' : ''}`}>
      <div className="remote-header">
        <div className="header-title" style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <Monitor size={isGrid ? 16 : 20} />
          <span style={{ fontWeight: '600', fontSize: isGrid ? '14px' : '16px' }}>{agent.name}</span>
          {!isGrid && (
            <div className="tabs">
              <button className={`tab-btn ${activeTab === 'screen' ? 'active' : ''}`} onClick={() => setActiveTab('screen')}>Screen</button>
              <button className={`tab-btn ${activeTab === 'files' ? 'active' : ''}`} onClick={() => setActiveTab('files')}>File Manager</button>
            </div>
          )}
        </div>

        {!isGrid && activeTab === 'screen' && (
          <div className="remote-controls">
            <div className="quality-group" title="Streaming quality — clarity is prioritized by default">
              <Gauge size={15} />
              {QUALITY_MODES.map((m) => (
                <button
                  key={m.id}
                  className={`quality-btn ${qualityMode === m.id ? 'active' : ''}`}
                  onClick={() => changeQuality(m.id)}
                  title={m.hint}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <button
              className={`btn-control ${controlEnabled ? 'on' : ''}`}
              onClick={toggleControl}
              title={controlEnabled ? 'Stop controlling — switch back to view only' : 'Take silent control of this PC'}
            >
              {controlEnabled ? <MousePointerClick size={16} /> : <Eye size={16} />}
              {controlEnabled ? 'Controlling' : 'View Only'}
            </button>
            <button
              className="btn-control"
              onClick={toggleFullscreen}
              title={isFullscreen ? 'Exit full screen' : 'Full screen'}
            >
              {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
              {isFullscreen ? 'Exit' : 'Full Screen'}
            </button>
          </div>
        )}

        <button className="btn btn-close" onClick={() => onClose(agent.id)}>
          <X size={18} /> {isGrid ? '' : 'Disconnect'}
        </button>
      </div>
      
      <div className="screen-container" style={{ padding: activeTab === 'files' ? '20px' : '0' }}>
        {activeTab === 'screen' ? (
          screenImage ? (
            <img 
              ref={screenRef}
              src={screenImage} 
              className="screen-feed"
              onMouseMove={!isGrid ? handleMouseMove : null}
              onMouseDown={!isGrid ? handleMouseClick : null}
              onWheel={!isGrid ? handleWheel : null}
              onContextMenu={(e) => e.preventDefault()}
              draggable={false}
              style={{ cursor: !isGrid && controlEnabled ? 'crosshair' : 'default' }}
            />
          ) : <div className="loading">Connecting...</div>
        ) : (
          <div className="file-manager">
            <div className="path-bar">
              <button className="btn-icon" onClick={handleGoUp}><ArrowLeft size={18} /></button>
              <div className="current-path">{currentPath}</div>
            </div>
            {fileError && <div className="error-msg">{fileError}</div>}
            {isDownloading && <div className="loading">Preparing download...</div>}
            <div className="file-list">
              {files.map((file, idx) => (
                <div className="file-row" key={idx}>
                  <div className="file-name" onClick={() => file.is_dir ? handleDirClick(file.name) : null}>
                    {file.is_dir ? <Folder size={18} color="#fcd34d" /> : <File size={18} color="#94a3b8" />}
                    <span>{file.name}</span>
                  </div>
                  {!file.is_dir && (
                    <button className="btn-icon" onClick={() => handleDownload(file.name)} disabled={isDownloading}><Download size={16} /></button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// Login / first-run setup wall. The dashboard renders nothing else until a
// valid token is held.
const AuthScreen = ({ mode, onAuthed }) => {
  const isSetup = mode === 'setup';
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (isSetup && password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(apiUrl(isSetup ? '/api/auth/setup' : '/api/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Something went wrong.');
        return;
      }
      onAuthed(data.token, data.username);
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-brand">
          <Server color="var(--accent)" size={26} />
          <h1>Mother System</h1>
        </div>
        <h2>{isSetup ? 'Create admin account' : 'Sign in'}</h2>
        <p className="auth-sub">
          {isSetup
            ? 'First-time setup. This account controls access to the server.'
            : 'Enter your administrator credentials to continue.'}
        </p>
        <label className="auth-label">
          Username
          <input
            className="auth-input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
          />
        </label>
        <label className="auth-label">
          Password
          <input
            className="auth-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={isSetup ? 'new-password' : 'current-password'}
          />
        </label>
        {isSetup && (
          <label className="auth-label">
            Confirm password
            <input
              className="auth-input"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
            />
          </label>
        )}
        {error && <div className="auth-error">{error}</div>}
        <button className="btn" type="submit" disabled={busy}>
          {busy ? 'Please wait…' : isSetup ? 'Create account' : 'Sign in'}
        </button>
      </form>
    </div>
  );
};

function App() {
  const [agents, setAgents] = useState([]);
  const [systemLogs, setSystemLogs] = useState([]);
  const [activeAgents, setActiveAgents] = useState([]);
  const [viewMode, setViewMode] = useState('list'); // 'list', 'focus', 'grid'
  const [focusedAgentId, setFocusedAgentId] = useState(null);
  const [authStatus, setAuthStatus] = useState('loading'); // loading | setup | login | authed
  const [authToken, setAuthToken] = useState(null);
  const [authUser, setAuthUser] = useState(null);
  const dashboardSocketRef = useRef(null);

  // Decide on load whether to show setup, login, or the app.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const statusRes = await fetch(apiUrl('/api/auth/status'));
        const status = await statusRes.json();
        if (cancelled) return;
        if (!status.configured) {
          setAuthStatus('setup');
          return;
        }
        const token = localStorage.getItem(TOKEN_KEY);
        if (!token) {
          setAuthStatus('login');
          return;
        }
        const meRes = await fetch(apiUrl('/api/auth/me'), {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (cancelled) return;
        if (meRes.ok) {
          const me = await meRes.json();
          setAuthToken(token);
          setAuthUser(me.username);
          setAuthStatus('authed');
        } else {
          localStorage.removeItem(TOKEN_KEY);
          setAuthStatus('login');
        }
      } catch {
        if (!cancelled) setAuthStatus('login');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleAuthed = (token, username) => {
    localStorage.setItem(TOKEN_KEY, token);
    setAuthToken(token);
    setAuthUser(username);
    setAuthStatus('authed');
  };

  const handleLogout = () => {
    localStorage.removeItem(TOKEN_KEY);
    setAuthToken(null);
    setAuthUser(null);
    setActiveAgents([]);
    setFocusedAgentId(null);
    setViewMode('list');
    setAuthStatus('login');
  };

  useEffect(() => {
    if (authStatus !== 'authed' || !authToken) return undefined;
    const socket = io(LOCAL_SERVER_URL, { auth: { token: authToken } });
    dashboardSocketRef.current = socket;

    socket.on('connect_error', (err) => {
      if (err && err.message === 'unauthorized') {
        localStorage.removeItem(TOKEN_KEY);
        setAuthToken(null);
        setAuthUser(null);
        setAuthStatus('login');
      }
    });
    socket.on('agents_updated', (updatedAgents) => setAgents(updatedAgents));
    socket.on('system_logs', (logs) => setSystemLogs(logs));
    socket.on('system_log', (logEntry) => {
      setSystemLogs((currentLogs) => {
        if (currentLogs.some((log) => log.id === logEntry.id)) {
          return currentLogs;
        }
        return [...currentLogs, logEntry].slice(-100);
      });
    });

    return () => {
      dashboardSocketRef.current = null;
      socket.close();
    };
  }, [authStatus, authToken]);

  const connectToAgent = (agent) => {
    if (!activeAgents.find(a => a.id === agent.id)) {
      setActiveAgents([...activeAgents, agent]);
    }
    setFocusedAgentId(agent.id);
    setViewMode('focus');
  };

  const disconnectAgent = (id) => {
    const updated = activeAgents.filter(a => a.id !== id);
    setActiveAgents(updated);
    if (focusedAgentId === id) {
      setFocusedAgentId(updated.length > 0 ? updated[0].id : null);
      if (updated.length === 0) setViewMode('list');
    }
  };

  const toggleGridView = () => {
    if (viewMode === 'grid') setViewMode('focus');
    else setViewMode('grid');
  };

  const clearSystemLogs = () => {
    setSystemLogs([]);
    dashboardSocketRef.current?.emit('clear_system_logs');
  };

  if (authStatus === 'loading') {
    return <div className="auth-screen"><div className="loading">Loading…</div></div>;
  }
  if (authStatus === 'setup' || authStatus === 'login') {
    return <AuthScreen mode={authStatus} onAuthed={handleAuthed} />;
  }

  if (viewMode === 'focus' && focusedAgentId) {
    const agent = activeAgents.find(a => a.id === focusedAgentId);
    return (
      <div className="app-layout">
        <div className="sidebar">
          <div className="sidebar-header">
            <h3>Connected</h3>
            <div style={{ display: 'flex', gap: '4px' }}>
              <button className="btn-icon" onClick={toggleGridView} title="Toggle Grid View">
                <LayoutGrid size={20} />
              </button>
              <button className="btn-icon" onClick={handleLogout} title={`Sign out${authUser ? ` (${authUser})` : ''}`}>
                <LogOut size={20} />
              </button>
            </div>
          </div>
          <div className="active-list">
            {activeAgents.map(a => (
              <div 
                key={a.id} 
                className={`active-item ${a.id === focusedAgentId ? 'focused' : ''}`}
                onClick={() => setFocusedAgentId(a.id)}
              >
                <Monitor size={16} /> {a.name}
              </div>
            ))}
            <button className="btn btn-outline" onClick={() => setViewMode('list')}>+ Add PC</button>
          </div>
        </div>
        <div className="main-content">
          <RemoteAgentView agent={agent} onClose={disconnectAgent} isGrid={false} />
        </div>
      </div>
    );
  }

  if (viewMode === 'grid') {
    return (
      <div className="grid-container">
        <div className="grid-header">
          <h2>Multi-PC Grid View</h2>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button className="btn btn-outline" onClick={() => setViewMode('focus')}>Exit Grid</button>
            <button className="btn" onClick={() => setViewMode('list')}>+ Add PC</button>
            <button className="btn btn-logout" onClick={handleLogout}><LogOut size={16} /> Sign out</button>
          </div>
        </div>
        <div className="multi-grid">
          {activeAgents.map(agent => (
            <RemoteAgentView key={agent.id} agent={agent} onClose={disconnectAgent} isGrid={true} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="header">
        <h1><Server color="var(--accent)" /> Mother System</h1>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          {activeAgents.length > 0 && (
            <button className="btn btn-outline" onClick={() => setViewMode('focus')}>
              Back to Active ({activeAgents.length})
            </button>
          )}
          <button className="btn btn-logout" onClick={handleLogout} title={authUser ? `Signed in as ${authUser}` : 'Sign out'}>
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </div>

      {agents.length === 0 ? (
        <div className="empty-state">
          <Laptop size={48} />
          <h2>No PCs Discovered</h2>
          <p>Make sure the Agent app is running on the target PCs.</p>
        </div>
      ) : (
        <div className="grid">
          {agents.map(agent => (
            <div className="card" key={agent.id}>
              <div className="card-header">
                <div className="card-title"><Monitor size={20} color="var(--accent)" /> {agent.name}</div>
                <div className="status-badge"><div className="status-dot"></div> Online</div>
              </div>
              <p className="ip-text">{agent.ip}:{agent.port}</p>
              <button 
                className={`btn ${activeAgents.find(a => a.id === agent.id) ? 'btn-active' : ''}`} 
                onClick={() => connectToAgent(agent)}
              >
                {activeAgents.find(a => a.id === agent.id) ? 'Switch to Control' : 'Connect & Control'}
              </button>
            </div>
          ))}
        </div>
      )}

      <section className="system-log-panel" aria-label="System log">
        <div className="system-log-header">
          <div className="system-log-title">
            <Terminal size={18} />
            <span>System Log</span>
          </div>
          <button className="btn-icon" onClick={clearSystemLogs} title="Clear system log">
            <Trash2 size={16} />
          </button>
        </div>
        <div className="system-log-list" role="log" aria-live="polite">
          {systemLogs.length === 0 ? (
            <div className="system-log-empty">No system events yet.</div>
          ) : (
            systemLogs.map((log) => (
              <div className={`system-log-row ${log.level}`} key={log.id}>
                <time className="system-log-time" dateTime={log.timestamp}>
                  {formatLogTime(log.timestamp)}
                </time>
                <span className="system-log-message">{log.message}</span>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

export default App;
