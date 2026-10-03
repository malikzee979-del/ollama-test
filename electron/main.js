'use strict';

// Electron main process: launches the existing Express server (server.js)
// as a child process, waits until it's actually accepting connections,
// then opens a native window pointing at it. Closing the window shuts the
// server child process down too, so there's nothing left running in the
// background.
//
// This intentionally does NOT re-implement any server logic — it's a thin
// native shell around the same local web app you get from `npm start`.

const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const PORT = process.env.PORT || 4173;
const SERVER_URL = `http://localhost:${PORT}`;
const REPO_ROOT = path.join(__dirname, '..');

let serverProcess = null;
let mainWindow = null;

function startServer() {
  return new Promise((resolve, reject) => {
    serverProcess = spawn(process.execPath, [path.join(REPO_ROOT, 'server.js')], {
      cwd: REPO_ROOT,
      env: process.env,
      stdio: 'inherit',
    });

    serverProcess.on('error', reject);
    serverProcess.on('exit', (code, signal) => {
      // If the server dies after we already resolved (window is up), quit
      // the whole app rather than leaving an empty/broken window around.
      serverProcess = null;
      if (mainWindow) {
        app.quit();
      } else {
        reject(new Error(`server.js exited early (code=${code}, signal=${signal})`));
      }
    });

    waitForServer(resolve, reject);
  });
}

// Polls the server's health endpoint until it responds, so we don't open
// the window on a blank/connection-refused page while Express is still
// starting up (or while node:sqlite/db setup runs on first launch).
function waitForServer(resolve, reject, attempt = 0) {
  const MAX_ATTEMPTS = 100; // ~20s at 200ms intervals
  const req = http.get(`${SERVER_URL}/api/auth/me`, (res) => {
    res.resume();
    resolve();
  });
  req.on('error', () => {
    if (attempt >= MAX_ATTEMPTS) {
      reject(new Error('Timed out waiting for local server to start.'));
      return;
    }
    setTimeout(() => waitForServer(resolve, reject, attempt + 1), 200);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 720,
    minHeight: 480,
    title: 'Ollama Chat',
    backgroundColor: '#1e1e1e',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(SERVER_URL);

  // Open any external links (e.g. https://ollama.com) in the system
  // browser instead of inside the app window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(SERVER_URL)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function stopServer() {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
}

app.whenReady().then(async () => {
  try {
    await startServer();
    createWindow();
  } catch (err) {
    console.error('Failed to start Ollama Chat:', err);
    app.quit();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  stopServer();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', stopServer);
app.on('will-quit', stopServer);
