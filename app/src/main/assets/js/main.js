// Composition root: the only place that knows every feature. Each feature exposes an init function and does nothing
// at import time, so the order below is the whole start-up sequence. See ARCHITECTURE.md for the module map.

import { initKeyboard } from './app/keyboard.js';
import { initOpenFile } from './app/open-file.js';
import { initSearch } from './search/search-bar.js';
import { initPageText } from './document/page-text.js';
import { initControls } from './player/controls.js';
import { initPlayback } from './player/playback.js';
import { initVoices } from './player/voices.js';
import { loadPdfEngine } from './services/pdf-engine.js';
import { initSettingsPanel } from './settings/settings-panel.js';
import { initHaptics } from './ui/haptics.js';
import { initHeader } from './ui/header.js';
import { setNotice } from './ui/notice.js';
import { initTheme } from './ui/theme.js';
import { initPageList } from './viewer/page-list.js';
import { initLayout } from './viewer/layout.js';
import { initPager } from './viewer/pager.js';
import { initRenderer } from './viewer/renderer.js';
import { initZoom } from './viewer/zoom.js';
import { initDocxView } from './viewer/docx-view.js';

initHeader();
initHaptics();
initTheme();
initZoom();
initPager();
initPageList();
initLayout();
initDocxView();
initRenderer();
initPageText();
initVoices();
initControls();
initPlayback();
initSettingsPanel();
initSearch();
initOpenFile();
initKeyboard();

loadPdfEngine().catch(() => {
  setNotice('Could not load the PDF engine. Check your internet connection and reload.', true);
});
