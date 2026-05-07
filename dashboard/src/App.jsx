import { useEffect, useState, useRef } from 'react';
import { io } from 'socket.io-client';
import { Monitor, Laptop, Server, X, File, Download, Folder, ArrowLeft, LayoutGrid, Terminal, Trash2 } from 'lucide-react';
import './index.css';

const LOCAL_SERVER_URL = 'http://localhost:7420';

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
  const screenRef = useRef(null);
  const socketRef = useRef(null);

  useEffect(() => {
    const agentUrl = `http://${agent.ip}:${agent.port}`;
    const newSocket = io(agentUrl);
    socketRef.current = newSocket;

    newSocket.on('screen_data', (data) => setScreenImage(data.image));
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

  const handleMouseMove = (e) => {
    const socket = socketRef.current;
    if (!socket || !screenRef.current) return;
    const rect = screenRef.current.getBoundingClientRect();
    const x_pct = (e.clientX - rect.left) / rect.width;
    const y_pct = (e.clientY - rect.top) / rect.height;
    socket.emit('mouse_move', { x_pct, y_pct });
  };

  const handleMouseClick = (e) => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit('mouse_click', { button: e.button });
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      const socket = socketRef.current;
      if (!socket || activeTab !== 'screen' || isGrid) return;
      e.preventDefault();
      socket.emit('key_press', { key: e.key });
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTab, isGrid]);

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
    <div className={`remote-view ${isGrid ? 'grid-item' : ''}`}>
      <div className="remote-header">
        <div className="header-title" style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <Monitor size={isGrid ? 16 : 20} />
          <span style={{ fontWeight: '600', fontSize: isGrid ? '14px' : '16px' }}>{agent.name}</span>
          {!isGrid && (
            <div className="tabs">
              <button className={`tab-btn ${activeTab === 'screen' ? 'active' : ''}`} onClick={() => setActiveTab('screen')}>Screen Control</button>
              <button className={`tab-btn ${activeTab === 'files' ? 'active' : ''}`} onClick={() => setActiveTab('files')}>File Manager</button>
            </div>
          )}
        </div>
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
              onContextMenu={(e) => e.preventDefault()}
              draggable={false}
              style={{ cursor: isGrid ? 'default' : 'crosshair' }}
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

function App() {
  const [agents, setAgents] = useState([]);
  const [systemLogs, setSystemLogs] = useState([]);
  const [activeAgents, setActiveAgents] = useState([]);
  const [viewMode, setViewMode] = useState('list'); // 'list', 'focus', 'grid'
  const [focusedAgentId, setFocusedAgentId] = useState(null);
  const dashboardSocketRef = useRef(null);

  useEffect(() => {
    const socket = io(LOCAL_SERVER_URL);
    dashboardSocketRef.current = socket;

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
  }, []);

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

  if (viewMode === 'focus' && focusedAgentId) {
    const agent = activeAgents.find(a => a.id === focusedAgentId);
    return (
      <div className="app-layout">
        <div className="sidebar">
          <div className="sidebar-header">
            <h3>Connected</h3>
            <button className="btn-icon" onClick={toggleGridView} title="Toggle Grid View">
              <LayoutGrid size={20} />
            </button>
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
        {activeAgents.length > 0 && (
          <button className="btn btn-outline" onClick={() => setViewMode('focus')}>
            Back to Active ({activeAgents.length})
          </button>
        )}
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
