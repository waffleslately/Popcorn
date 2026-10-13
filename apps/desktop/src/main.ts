import { app, BrowserWindow } from 'electron';
import path from 'node:path';

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 390,
    minHeight: 600,
    backgroundColor: '#0d0c11', // --pit design token
    title: 'Popcorn — Cinema',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const devUrl = 'http://localhost:5173';
  const prodPath = path.join(__dirname, '../../web/dist/index.html');

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL(devUrl).catch(() => {
      mainWindow.loadFile(prodPath);
    });
  } else {
    mainWindow.loadFile(prodPath).catch(() => {
      mainWindow.loadURL(devUrl);
    });
  }
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
