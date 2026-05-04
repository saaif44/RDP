import React, { useEffect, useState, useRef } from 'react';
import { io } from 'socket.io-client';
import { Monitor, Laptop, Server, X, MousePointer2, FolderOpen, File, Download, Folder, ArrowLeft } from 'lucide-react';
import './index.css';

const LOCAL_SERVER_URL = 'http://localhost:7420'; 

function App() {
  const [localSocket, setLocalSocket] = useState(null);
  const [agentSocket, setAgentSocket] = useState(null); 
  
  const [agents, setAgents] = useState([]);
  const [activeAgent, setActiveAgent] = useState(null);
  const [activeTab, setActiveTab] = useState('screen'); // 'screen' or 'files'
  
  // Screen State
  const [screenImage, setScreenImage] = useState(null);
  const screenRef = useRef(null);

  // File Explorer State
  const [currentPath, setCurrentPath] = useState('');
  const [files, setFiles] = useState([]);
  const [fileError, setFileError] = useState(null);
  const [isDownloading, setIsDownloading] = useState(false);

  // 1. Connect to local backend to get discovered agents
  useEffect(() => {
    const newLocalSocket = io(LOCAL_SERVER_URL);
    setLocalSocket(newLocalSocket);

    newLocalSocket.on('connect', () => {
      console.log('Connected to local Mother System backend');
    });

    newLocalSocket.on('agents_updated', (updatedAgents) => {
      setAgents(updatedAgents);
    });

    return () => newLocalSocket.close();
  }, []);

  // 2. Direct connection to Agent when selected
  useEffect(() => {
    if (activeAgent) {
      const agentUrl = `http://${activeAgent.ip}:${activeAgent.port}`;
      const newAgentSocket = io(agentUrl);
      setAgentSocket(newAgentSocket);

      newAgentSocket.on('screen_data', (data) => {
        setScreenImage(data.image);
      });

      newAgentSocket.on('dir_data', (data) => {
        setCurrentPath(data.path);
        setFiles(data.files);
        setFileError(null);
      });

      newAgentSocket.on('dir_error', (data) => {
        setFileError(data.error);
        setIsDownloading(false);
      });

      newAgentSocket.on('file_data', (data) => {
        setIsDownloading(false);
        // Trigger download in browser
        const link = document.createElement('a');
        link.href = `data:application/octet-stream;base64,${data.data}`;
        link.download = data.name;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      });

      newAgentSocket.on('disconnect', () => {
        closeConnection();
      });

      return () => {
        newAgentSocket.close();
      };
    }
  }, [activeAgent]);

  // Load initial directory when switching to files tab
  useEffect(() => {
    if (activeTab === 'files' && agentSocket && !currentPath) {
      agentSocket.emit('list_dir', {}); // default home dir
    }
  }, [activeTab, agentSocket]);

  const connectToAgent = (agent) => {
    setActiveAgent(agent);
    setActiveTab('screen');
    setScreenImage(null);
    setCurrentPath('');
    setFiles([]);
  };

  const closeConnection = () => {
    setActiveAgent(null);
    setScreenImage(null);
    if (agentSocket) {
      agentSocket.close();
      setAgentSocket(null);
    }
  };

  // Mouse & Keyboard
  const handleMouseMove = (e) => {
    if (!agentSocket || !screenRef.current) return;
    const rect = screenRef.current.getBoundingClientRect();
    const x_pct = (e.clientX - rect.left) / rect.width;
    const y_pct = (e.clientY - rect.top) / rect.height;
    agentSocket.emit('mouse_move', { x_pct, y_pct });
  };

  const handleMouseClick = (e) => {
    if (!agentSocket) return;
    agentSocket.emit('mouse_click', { button: e.button });
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!agentSocket || activeTab !== 'screen') return;
      e.preventDefault();
      agentSocket.emit('key_press', { key: e.key });
    };

    if (activeAgent && activeTab === 'screen') {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeAgent, agentSocket, activeTab]);

  // File Manager Handlers
  const handleDirClick = (folderName) => {
    const separator = activeAgent.os === 'Windows' ? '\\' : '/';
    const newPath = currentPath + (currentPath.endsWith(separator) ? '' : separator) + folderName;
    agentSocket.emit('list_dir', { path: newPath });
  };

  const handleGoUp = () => {
    const separator = activeAgent.os === 'Windows' ? '\\' : '/';
    const parts = currentPath.split(separator).filter(Boolean);
    if (parts.length > 1) {
      parts.pop();
      const newPath = activeAgent.os === 'Windows' && parts.length === 1 && parts[0].includes(':') 
        ? parts[0] + separator // e.g. C:\
        : parts.join(separator);
      agentSocket.emit('list_dir', { path: newPath || separator });
    } else if (parts.length === 1 && activeAgent.os !== 'Windows') {
      agentSocket.emit('list_dir', { path: '/' });
    }
  };

  const handleDownload = (fileName) => {
    const separator = activeAgent.os === 'Windows' ? '\\' : '/';
    const filePath = currentPath + (currentPath.endsWith(separator) ? '' : separator) + fileName;
    setIsDownloading(true);
    agentSocket.emit('download_file', { path: filePath });
  };

  const formatSize = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  if (activeAgent) {
    return (
      <div className="remote-view">
        <div className="remote-header">
          <div className="header-title" style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
            <Monitor size={20} />
            <span style={{ fontWeight: '600' }}>{activeAgent.name}</span>
            
            <div className="tabs">
              <button className={`tab-btn ${activeTab === 'screen' ? 'active' : ''}`} onClick={() => setActiveTab('screen')}>
                Screen Control
              </button>
              <button className={`tab-btn ${activeTab === 'files' ? 'active' : ''}`} onClick={() => setActiveTab('files')}>
                File Manager
              </button>
            </div>
          </div>
          <button className="btn btn-close" onClick={closeConnection}>
            <X size={18} /> Disconnect
          </button>
        </div>
        
        <div className="screen-container" style={{ padding: activeTab === 'files' ? '20px' : '0' }}>
          {activeTab === 'screen' ? (
            screenImage ? (
              <img 
                ref={screenRef}
                src={screenImage} 
                alt="Remote Screen Feed" 
                className="screen-feed"
                onMouseMove={handleMouseMove}
                onMouseDown={handleMouseClick}
                onContextMenu={(e) => e.preventDefault()}
                draggable={false}
              />
            ) : (
              <div style={{ color: 'var(--text-secondary)' }}>Connecting screen feed...</div>
            )
          ) : (
            <div className="file-manager">
              <div className="path-bar">
                <button className="btn-icon" onClick={handleGoUp}><ArrowLeft size={18} /></button>
                <div className="current-path">{currentPath}</div>
              </div>
              
              {fileError && <div className="error-msg">{fileError}</div>}
              {isDownloading && <div className="info-msg">Downloading file... Please wait.</div>}
              
              <div className="file-list">
                {files.map((file, idx) => (
                  <div className="file-row" key={idx}>
                    <div className="file-name" onClick={() => file.is_dir ? handleDirClick(file.name) : null}>
                      {file.is_dir ? <Folder size={18} color="#fcd34d" /> : <File size={18} color="#94a3b8" />}
                      <span style={{ cursor: file.is_dir ? 'pointer' : 'default' }}>{file.name}</span>
                    </div>
                    <div className="file-actions">
                      {!file.is_dir && <span>{formatSize(file.size)}</span>}
                      {!file.is_dir && (
                        <button className="btn-icon" onClick={() => handleDownload(file.name)} title="Download File">
                          <Download size={16} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="header">
        <h1><Server color="var(--accent)" /> Mother System</h1>
      </div>

      {agents.length === 0 ? (
        <div className="empty-state">
          <Laptop />
          <h2>No PCs Found</h2>
        </div>
      ) : (
        <div className="grid">
          {agents.map(agent => (
            <div className="card" key={agent.id}>
              <div className="card-header">
                <div className="card-title">
                  <Monitor size={20} color="var(--accent)" />
                  {agent.name}
                </div>
                <div className="status-badge">
                  <div className="status-dot"></div> Online
                </div>
              </div>
              <button className="btn" onClick={() => connectToAgent(agent)}>
                <MousePointer2 size={16} /> Connect & Control
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default App;
