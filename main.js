'use strict';

const { app, BrowserWindow, shell, Menu, dialog } = require('electron');
const path = require('path');
const { fork } = require('child_process');
const http = require('http');

// --------------------------------------------------------------------------
// Config
// --------------------------------------------------------------------------
const PORT = 3000;
const SERVER_ENTRY = path.join(__dirname, 'server.js');
const DEV_TOOLS = process.env.NODE_ENV === 'development';

let mainWindow = null;
let serverProcess = null;

// --------------------------------------------------------------------------
// Start the Express server as a child process
// --------------------------------------------------------------------------
function startServer() {
  return new Promise((resolve, reject) => {
    serverProcess = fork(SERVER_ENTRY, [], {
      env: { ...process.env, PORT: String(PORT) },
      silent: true // captures stdout/stderr
    });

    serverProcess.stdout.on('data', (data) => {
      const msg = data.toString().trim();
      console.log('[server]', msg);
      // The server prints this line when it's ready
      if (msg.includes(`http://localhost:${PORT}`)) {
        resolve();
      }
    });

    serverProcess.stderr.on('data', (data) => {
      console.error('[server:err]', data.toString().trim());
    });

    serverProcess.on('error', (err) => {
      reject(err);
    });

    serverProcess.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        console.error(`[server] Exited with code ${code}`);
      }
    });

    // Safety timeout: resolve after 5 s even if log line wasn't matched
    setTimeout(resolve, 5000);
  });
}

// --------------------------------------------------------------------------
// Poll until the server is actually reachable
// --------------------------------------------------------------------------
function waitForServer(url, retries = 30, delay = 300) {
  return new Promise((resolve, reject) => {
    const attempt = () => {
      http.get(url, (res) => {
        res.resume();
        resolve();
      }).on('error', () => {
        if (retries-- <= 0) {
          reject(new Error('Server did not start in time.'));
          return;
        }
        setTimeout(attempt, delay);
      });
    };
    attempt();
  });
}

// --------------------------------------------------------------------------
// Create the main BrowserWindow
// --------------------------------------------------------------------------
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Workspace Hub',
    icon: path.join(__dirname, 'public', 'favicon.ico'), // optional icon
    backgroundColor: '#0f0f13',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // Allow the renderer to open external URLs in the default browser
    },
    // Frameless feel with a clean titlebar
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    show: false // will show once ready-to-show fires
  });

  // Load the app
  mainWindow.loadURL(`http://localhost:${PORT}`);

  // Show only once fully rendered (avoids white flash)
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (DEV_TOOLS) mainWindow.webContents.openDevTools();
  });

  // Open external links (target="_blank") in the default browser, not Electron
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(`http://localhost:${PORT}`)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// --------------------------------------------------------------------------
// Native app menu (File / Edit / View / Window / Help)
// --------------------------------------------------------------------------
function buildMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Reload',
          accelerator: 'CmdOrCtrl+R',
          click: () => mainWindow && mainWindow.reload()
        },
        { type: 'separator' },
        {
          label: 'Quit',
          accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Alt+F4',
          click: () => app.quit()
        }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(DEV_TOOLS
          ? [{ type: 'separator' }, { role: 'toggleDevTools' }]
          : [])
      ]
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About Workspace Hub',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About Workspace Hub',
              message: 'Workspace Hub',
              detail: `Version ${app.getVersion()}\n\nA local offline dashboard to organize your links, PDFs, and notes.`
            });
          }
        }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// --------------------------------------------------------------------------
// App lifecycle
// --------------------------------------------------------------------------
app.whenReady().then(async () => {
  try {
    console.log('[main] Starting Express server…');
    await startServer();

    console.log('[main] Waiting for server to be reachable…');
    await waitForServer(`http://localhost:${PORT}`);

    console.log('[main] Server ready. Opening window…');
    buildMenu();
    createWindow();
  } catch (err) {
    console.error('[main] Fatal startup error:', err);
    dialog.showErrorBox(
      'Startup Error',
      `Workspace Hub failed to start:\n\n${err.message}`
    );
    app.quit();
  }
});

// Quit when all windows are closed (Windows & Linux)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// macOS: re-create window when dock icon is clicked
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Gracefully shut down the Express server when Electron quits
app.on('will-quit', () => {
  if (serverProcess) {
    console.log('[main] Stopping server…');
    serverProcess.kill();
    serverProcess = null;
  }
});
