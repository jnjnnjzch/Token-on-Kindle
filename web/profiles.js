export const DEFAULT_PROFILE_ID = 'kindle-600x800';

export const KINDLE_PROFILES = Object.freeze([
  { id: 'kindle-600x800', name: '600 × 800', models: 'Kindle 4/5/7/8/10 等经典 6 英寸机型', width: 600, height: 800 },
  { id: 'kindle-758x1024', name: '758 × 1024', models: 'Kindle Paperwhite 1 / 2', width: 758, height: 1024 },
  { id: 'kindle-1072x1448', name: '1072 × 1448', models: 'Voyage、Paperwhite 3/4、Oasis 1、Kindle 11', width: 1072, height: 1448 },
  { id: 'kindle-1236x1648', name: '1236 × 1648', models: 'Kindle Paperwhite 5（11 代，6.8 英寸）', width: 1236, height: 1648 },
  { id: 'kindle-1264x1680', name: '1264 × 1680', models: 'Kindle Oasis 2/3 与 7 英寸 300 ppi 机型', width: 1264, height: 1680 },
  { id: 'kindle-1860x2480', name: '1860 × 2480', models: 'Kindle Scribe 10.2 英寸', width: 1860, height: 2480 }
]);

const PROFILE_MAP = new Map(KINDLE_PROFILES.map(profile => [profile.id, profile]));

export function getKindleProfile(id) {
  return PROFILE_MAP.get(id) || PROFILE_MAP.get(DEFAULT_PROFILE_ID);
}

export function isSupportedProfile(id) {
  return PROFILE_MAP.has(id);
}
