// The one shared, mutable application state. Modules read it freely and change only the parts they own
// (the owner is noted next to each field).

export const state = {
  // --- document (owner: app/open-file, viewer/page-list, viewer/docx-view) ---
  doc: null,               // the open document: a pdf.js document, or { numPages, destroy() } for a Word file
  docKind: null,           // 'pdf' | 'docx'
  docId: '',               // "name:size:pages" - identifies the file for the caches and the saved position
  pages: [],               // page records (a PDF page, or a section of a Word file), see document/page-model.js
  scale: 1,                // PDF only: CSS pixels per PDF point (fit-to-width x zoom)
  currentPage: 1,          // page nearest the middle of the screen (viewer/pager)
  docVisualOrder: false,   // text layer is in screen order (text/devanagari.js); set once a lossy page is seen

  // --- view options (owners: viewer/zoom, ui/theme) ---
  zoom: 1,
  darkPages: false,

  // --- playback (owner: player/playback) ---
  rate: 1,
  cont: true,              // keep reading after the current sentence
  playing: false,
  active: null,            // { p, s, from } sentence being spoken: page, sentence index, first line offset
  resumePos: null,         // where the play button continues after a pause

  // --- voices (owner: player/voices) ---
  voices: []
};
