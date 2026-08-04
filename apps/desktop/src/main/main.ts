// ScreenShare Electron 主进程
import { app, BrowserWindow, session, desktopCapturer } from 'electron';
import path from 'node:path';

// 受限环境（无特权会话）下 Chromium 沙箱可能无法初始化，个人工具场景关闭沙箱
app.commandLine.appendSwitch('no-sandbox');

const isDev = !!process.env.VITE_DEV_SERVER_URL;

function createWindow() {
  const win = new BrowserWindow({
    width: 1160,
    height: 780,
    minWidth: 900,
    minHeight: 600,
    title: 'ScreenShare 超清屏幕分享',
    backgroundColor: '#0f1115',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (isDev) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL as string);
  } else {
    win.loadFile(path.join(__dirname, '../../dist-renderer/index.html'));
  }
}

app.whenReady().then(() => {
  // 权限：只放行摄像头/麦克风/屏幕采集
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    const allowed = ['media', 'display-capture', 'screen-capture'].includes(permission);
    callback(allowed);
  });

  // 桌面采集：用 Electron 原生 desktopCapturer（兼容性最好），自动分享第一个屏幕。
  // 首次调用会触发系统"屏幕录制"授权弹窗。
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 0, height: 0 },
      });
      const first = sources[0];
      if (first) {
        callback({ video: first });
      } else {
        callback({ video: {} as Electron.DesktopCapturerSource });
      }
    } catch {
      callback({ video: {} as Electron.DesktopCapturerSource });
    }
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
