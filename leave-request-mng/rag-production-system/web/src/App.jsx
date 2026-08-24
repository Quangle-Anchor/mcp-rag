import React, { useState, useEffect } from 'react';
import Header from './components/Header/Header';
import FolderScannerConsole from './components/Console/FolderScannerConsole';
import ChatConsole from './components/Chat/ChatConsole';
import SettingsModal from './components/Settings/SettingsModal';

const STORAGE_KEY_THEME = 'rag_studio_theme';
const STORAGE_KEY_SETTINGS = 'rag_studio_settings';
const STORAGE_KEY_NS = 'rag_studio_namespace';

export default function App() {
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem(STORAGE_KEY_THEME) || 'cyber-emerald';
  });

  const [namespace, setNamespace] = useState(() => {
    return localStorage.getItem(STORAGE_KEY_NS) || 'docs';
  });

  const [isChatOpen, setIsChatOpen] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const [settings, setSettings] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_SETTINGS);
      return saved ? JSON.parse(saved) : {
        googleApiKey: '',
        openaiApiKey: '',
        llmProvider: 'google',
        topK: 8,
        vectorBackend: 'pinecone',
      };
    } catch {
      return {
        googleApiKey: '',
        openaiApiKey: '',
        llmProvider: 'google',
        topK: 8,
        vectorBackend: 'pinecone',
      };
    }
  });

  // Apply theme to document root
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(STORAGE_KEY_THEME, theme);
  }, [theme]);

  // Sync namespace to localStorage
  useEffect(() => {
    if (namespace) {
      localStorage.setItem(STORAGE_KEY_NS, namespace);
    }
  }, [namespace]);

  const handleSaveSettings = (newSettings) => {
    setSettings(newSettings);
    localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(newSettings));
  };

  return (
    <div className="app-shell">
      {/* Top Header */}
      <Header
        namespace={namespace}
        theme={theme}
        onThemeChange={setTheme}
        isChatOpen={isChatOpen}
        onToggleChat={() => setIsChatOpen(prev => !prev)}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />

      {/* Main Workspace Split Layout */}
      <main className="app-workspace">
        {/* Main Ingestion & Scanner Console */}
        <div className="workspace-main-panel">
          <FolderScannerConsole
            namespace={namespace}
            setNamespace={setNamespace}
            settings={settings}
          />
        </div>

        {/* Collapsible Chat & Hybrid Retrieval Workspace */}
        {isChatOpen && (
          <div className="workspace-chat-panel">
            <ChatConsole
              namespace={namespace}
              settings={settings}
            />
          </div>
        )}
      </main>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onSaveSettings={handleSaveSettings}
      />
    </div>
  );
}
