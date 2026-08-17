import type { CapacitorConfig } from '@capacitor/cli';

// appId should be unique to you, reverse-domain style — change "com.jackboon"
// to something of your own if you like, but keep it as-is if you're not fussed.
// You cannot change this later without effectively creating a new app listing,
// so it's worth a moment's thought now.
const config: CapacitorConfig = {
  appId: 'com.jackboon.wealthwithin',
  appName: 'Wealth Within',
  webDir: 'dist',
};

export default config;