// Every element the app touches, looked up once. Keeping the ids here means index.html and the code that drives it
// meet in exactly one place. Modules are loaded after the document is parsed, so the lookups are safe at import time.

const byId = (id) => document.getElementById(id);

export const el = {
  // header
  bar: byId('bar'),
  pagerCtl: byId('pagerCtl'), prevPage: byId('prevBtn'), nextPage: byId('nextBtn'),
  pageInput: byId('pageInput'), pageTotal: byId('pageTotal'),
  openBtn: byId('openBtn'), fileInput: byId('fileInput'), darkBtn: byId('darkBtn'), settingsBtn: byId('settingsBtn'),

  // document area
  main: document.querySelector('main'),
  stage: byId('stage'), empty: byId('empty'), pages: byId('pages'), notice: byId('notice'),
  banner: byId('banner'), bannerText: byId('bannerText'), bannerBtn: byId('bannerBtn'),

  // zoom control
  zoombar: byId('zoombar'), zoomIn: byId('zoomIn'), zoomOut: byId('zoomOut'), zoomVal: byId('zoomVal'),

  // player
  now: byId('now'), nowText: byId('nowText'), nowMeta: byId('nowMeta'),
  prevSeg: byId('prevSeg'), playBtn: byId('playBtn'), nextSeg: byId('nextSeg'), stopBtn: byId('stopBtn'),
  speedBtn: byId('speedBtn'), contBtn: byId('contBtn'), voice: byId('voice'),
  speedPop: byId('speedPop'), speedRange: byId('speedRange'), speedVal: byId('speedVal'),
  speedDown: byId('speedDown'), speedUp: byId('speedUp'),

  // settings sheet
  scrim: byId('scrim'), sheet: byId('sheet'), closeSheet: byId('closeSheet'),
  contMode: byId('contMode'), testVoice: byId('testVoice'),
  apiKey: byId('apiKey'), showKey: byId('showKey'), ocrMode: byId('ocrMode'),
  textModel: byId('textModel'), ttsModel: byId('ttsModel'),
  saveSettings: byId('saveSettings'), testKey: byId('testKey'), clearCache: byId('clearCache'),
  keyStatus: byId('keyStatus')
};
