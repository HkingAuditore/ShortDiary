import type { CapacitorConfig } from '@capacitor/cli';

/**
 * 剪纸日记 —— Android 壳配置
 *
 * 这个 APP 不含任何前端代码，只是一个 WebView 容器，
 * 直接加载线上站点。改网站 = 改 APP，无需重新打包。
 *
 * 要换地址：改 server.url，然后 `npx cap sync android` 重新编译即可。
 */
const config: CapacitorConfig = {
  appId: 'top.toyempires.diary',
  appName: '剪纸日记',
  webDir: 'shell',

  // 让站点能识别出「来自 APP」，方便以后做差异化适配
  appendUserAgent: ' PaperJournalApp/1.0',

  server: {
    url: 'https://diary.toyempires.top',
    cleartext: false,
    // 断网 / WebView 版本过低时显示的本地兜底页
    errorPath: 'error.html',
  },

  android: {
    allowMixedContent: false,
    // debug 包允许用 chrome://inspect 远程调试 WebView
    webContentsDebuggingEnabled: true,
    minWebViewVersion: 60,
  },
};

export default config;
