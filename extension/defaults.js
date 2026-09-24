// Shared by the service worker and the New Tab page.

export const DEFAULT_SETTINGS = {
  source: 'wallpaper',   // 'wallpaper' | 'custom' | 'image'
  custom: '#ff00f2',
  pick: null,            // { stamp, hex }: user's choice from the current wallpaper
  image: null,           // data URL of an uploaded picture
  imageSeeds: [],
  imagePick: null,
  style: 'vibrant',
  mode: 'dark',          // 'dark' | 'light' | 'system'
  iconStyle: 'brand',    // see ICON_STYLES in icons.js
};

