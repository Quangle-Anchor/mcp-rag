import axios from 'axios';

const DEFAULT_BASE = 'http://localhost:8000/api/v1';

/**
 * Build an Axios instance from a dynamic base URL.
 * Falls back to the default if none is provided.
 */
function client(baseURL = DEFAULT_BASE) {
  return axios.create({
    baseURL,
    headers: { 'Content-Type': 'application/json' },
    timeout: 30_000,
  });
}

export const api = {
  /**
   * Send a query to the chat/retrieval endpoint.
   * @param {string} query
   * @param {string} namespace
   * @param {number} topK
   * @param {string} [baseURL]
   */
  chat: async (query, namespace = 'docs', topK = 8, baseURL) => {
    const res = await client(baseURL).post('/chat', {
      session_id: 'web-ui-session',
      query,
      namespace,
      top_k: topK,
    });
    return res.data;
  },

  /**
   * Trigger a full document sync (Pinecone + BM25).
   */
  sync: async (namespace = 'docs', baseURL) => {
    const res = await client(baseURL).post('/sync', {
      confirmed: true,
      namespace,
    });
    return res.data;
  },

  /**
   * Poll the status of an ingestion/sync task.
   */
  getTaskStatus: async (taskId, baseURL) => {
    const res = await client(baseURL).get(`/upload-doc/status/${taskId}`);
    return res.data;
  },

  /**
   * List available sibling folders for code scanning.
   */
  listCodeFolders: async (baseURL) => {
    const res = await client(baseURL).get('/code/folders');
    return res.data;
  },

  /**
   * Scan a source code folder, chunk with language-aware separators, and index.
   */
  scanCode: async (folderName, namespace = null, baseURL) => {
    const res = await client(baseURL).post('/code/scan', {
      folder_name: folderName,
      namespace: namespace || folderName,
    });
    return res.data;
  },
};
