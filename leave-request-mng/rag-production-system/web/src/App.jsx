import React, { useState, useCallback } from 'react';
import Sidebar from './components/Sidebar/Settings';
import Chat from './components/Chat/Chat';
import ContextPanel from './components/Context/ContextPanel';
import SettingsPage, { loadSettings } from './components/Settings/SettingsPage';

function App() {
  const [page, setPage] = useState('chat'); // 'chat' | 'settings'
  const [settings, setSettings] = useState(() => loadSettings());
  const [namespace, setNamespace] = useState(settings.namespace || 'docs');
  const [retrievedChunks, setRetrievedChunks] = useState([]);
  const [isContextOpen, setIsContextOpen] = useState(false);

  const handleSettingsChange = useCallback((newSettings) => {
    setSettings(newSettings);
    setNamespace(newSettings.namespace || 'docs');
  }, []);

  const handleChunksRetrieved = useCallback((chunks) => {
    setRetrievedChunks(chunks);
    if (chunks.length > 0) setIsContextOpen(true);
  }, []);

  // ── Settings page ──────────────────────────────────────────────────────────
  if (page === 'settings') {
    return (
      <SettingsPage
        onBack={() => {
          // Reload settings when going back
          setSettings(loadSettings());
          setPage('chat');
        }}
        onSettingsChange={handleSettingsChange}
      />
    );
  }

  // ── Chat page ──────────────────────────────────────────────────────────────
  return (
    <div className="app-layout">
      <Sidebar
        namespace={namespace}
        setNamespace={setNamespace}
        settings={settings}
        onOpenSettings={() => setPage('settings')}
      />

      <main className="main-content">
        <Chat
          namespace={namespace}
          settings={settings}
          onChunksRetrieved={handleChunksRetrieved}
          isContextOpen={isContextOpen}
          setIsContextOpen={setIsContextOpen}
        />

        <ContextPanel
          chunks={retrievedChunks}
          isOpen={isContextOpen}
          onClose={() => setIsContextOpen(false)}
        />
      </main>
    </div>
  );
}

export default App;
