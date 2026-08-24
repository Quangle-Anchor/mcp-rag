import axios from 'axios';

const BASE = '/api/v1';

const http = axios.create({
  baseURL: BASE,
  headers: { 'Content-Type': 'application/json' },
  timeout: 30_000,
});

const httpLong = axios.create({
  baseURL: BASE,
  headers: { 'Content-Type': 'application/json' },
  timeout: 180_000,
});

function handleApiError(tag, err) {
  const detail = err.response?.data?.detail || err.message || 'Unknown network error';
  console.error(`[API Error - ${tag}]:`, detail);
  throw err;
}

export const api = {
  chat: (query, namespace = 'docs', topK = 8) =>
    http.post('/chat', {
      session_id: 'rag-studio-session',
      query,
      namespace,
      top_k: topK,
    })
      .then(r => r.data)
      .catch(e => handleApiError('chat', e)),

  syncDirect: (namespace = 'docs', folderName = null) =>
    httpLong.post('/sync-direct', {
      confirmed: true,
      namespace,
      folder_name: folderName,
    })
      .then(r => r.data)
      .catch(e => handleApiError('syncDirect', e)),

  listDocs: () =>
    http.get('/docs/list')
      .then(r => r.data)
      .catch(e => handleApiError('listDocs', e)),

  listCodeFolders: () =>
    http.get('/code/folders')
      .then(r => r.data)
      .catch(e => handleApiError('listCodeFolders', e)),

  listFolderDetails: () =>
    http.get('/code/folders/details')
      .then(r => r.data)
      .catch(e => handleApiError('listFolderDetails', e)),

  scanCode: (folderName, namespace = null) =>
    httpLong.post('/code/scan', {
      folder_name: folderName,
      namespace: namespace || folderName,
    })
      .then(r => r.data)
      .catch(e => handleApiError('scanCode', e)),

  health: () =>
    http.get('/health', { baseURL: '' })
      .then(r => r.data)
      .catch(() => ({ status: 'unknown' })),
};
