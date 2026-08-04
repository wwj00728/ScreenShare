// preload：仅暴露只读平台信息，不开放 Node 能力
import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('screenshare', {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  },
});
