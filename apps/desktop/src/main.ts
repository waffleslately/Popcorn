import { app, BrowserWindow, shell } from 'electron';
import path from 'node:path';

// In a packaged app, extraResources lands at process.resourcesPath/web
// In dev mode (electron . from dist/), it's relative to __dirname
function resolveWebPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'web', 'index.html');
  }
  // Dev fallback: look for sibling web app dist
  return path.join(__dirname, '..', '..', '..', 'web', 'dist', 'index.html');
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 390,
    minHeight: 600,
    backgroundColor: '#0d0c11', // --pit design token
    title: 'Popcorn — Cinema',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // Allow loading local web dist in production
      webSecurity: app.isPackaged,
    },
  });

  const devUrl = 'http://localhost:5173';

  if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
    // Try dev server first; fall back to local build
    mainWindow.loadURL(devUrl).catch(() => {
      mainWindow.loadFile(resolveWebPath());
    });
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(resolveWebPath());
  }

  // Open external links in the system browser, not inside the app
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
