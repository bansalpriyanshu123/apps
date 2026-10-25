// The one-line status message under the document (errors in red).

import { el } from '../core/dom.js';

export function setNotice(message, isWarning) {
  el.notice.textContent = message || '';
  el.notice.classList.toggle('warn', !!isWarning);
}
