const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');

let previewWindow = null;

ipcMain.handle('open-preview-window', () => {
  if (previewWindow) {
    previewWindow.focus();
    return;
  }
  previewWindow = new BrowserWindow({
    width: 800,
    height: 900,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    }
  });
  previewWindow.loadFile(path.join(__dirname, 'preview.html'));
  previewWindow.on('closed', () => {
    previewWindow = null;
  });
});

ipcMain.on('send-preview-pdf', (event, pdfBuffer) => {
  if (previewWindow) {
    previewWindow.webContents.send('preview-pdf', pdfBuffer);
  }
});

function createWindow() {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    }
  });

  win.maximize();
  win.loadFile(path.join(__dirname, 'index.html'));
}

ipcMain.handle('open-file-dialog', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'CSV Dateien', extensions: ['csv'] }]
  });

  if (canceled) {
    return null;
  }
  return filePaths[0]; // Absoluter Pfad zur CSV
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.on('send-preview-data', (event, invoiceData, companyData, invoiceNumber) => {
  if (previewWindow) {
    previewWindow.webContents.send('preview-data', invoiceData, companyData, invoiceNumber);
  }
});

ipcMain.handle('select-output-folder', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  return result.canceled ? null : result.filePaths[0];
});