// The invisible, tappable boxes laid over each page, one per line of text. A tap is announced on the bus as
// 'line:tap'; the player decides what to do with it, so this module knows nothing about playback.

import { state } from '../core/state.js';
import { emit } from '../core/bus.js';

export function layoutLines(pg) {
  if (pg.linesLaidOut) return;
  pg.textLayer.innerHTML = '';
  const active = state.active;
  const activeSentence = active && active.p === pg.num ? pg.segs[active.s] : null;
  const highlighted = activeSentence ? activeSentence.lines.slice(active.from || 0) : [];

  pg.lines.forEach((line, index) => {
    const box = document.createElement('div');
    box.className = 'line' + (highlighted.includes(index) ? ' active' : '');
    box.setAttribute('role', 'button');
    box.setAttribute('tabindex', '0');
    box.title = line.text;
    box.style.left = line.left + 'px';
    box.style.top = line.top + 'px';
    box.style.width = line.width + 'px';
    box.style.height = line.height + 'px';

    const tap = () => {
      const sentence = pg.segs[line.seg];
      emit('line:tap', { page: pg.num, seg: line.seg, offset: sentence ? Math.max(0, sentence.lines.indexOf(index)) : 0 });
    };
    box.addEventListener('click', tap);
    box.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); tap(); }
    });
    pg.textLayer.appendChild(box);
  });
  pg.linesLaidOut = true;
}
