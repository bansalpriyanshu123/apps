// A minimal event bus. Feature modules talk to each other through named events instead of importing each other,
// which keeps the dependency graph one-directional (see ARCHITECTURE.md).
//
//   line:tap            { page, seg, offset }   the user tapped a line in the document
//   page:lines-changed  page                   a page's lines were rebuilt (OCR arrived, settings changed)
//   page:status         { pg, text, spinning, isError }  a page's status pill should change ("Gemini is reading…")
//   settings:saved      -                       the settings sheet saved new values
//   theme:dark          boolean                 dark pages switched on / off
//   player:pause        -                       the Android notification asked to pause

const handlers = new Map();

export function on(event, handler) {
  if (!handlers.has(event)) handlers.set(event, new Set());
  handlers.get(event).add(handler);
  return () => handlers.get(event).delete(handler);
}

export function emit(event, payload) {
  for (const handler of handlers.get(event) || []) {
    try { handler(payload); } catch (err) { console.error('[bus] handler for "' + event + '" failed', err); }
  }
}
