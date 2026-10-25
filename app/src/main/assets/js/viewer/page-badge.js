// The small pill in a page's corner ("Gemini is reading this page…", or an error).

export function setPageBadge(pg, text, spinning, isError) {
  const badge = pg.badge;
  badge.innerHTML = '';
  if (!text) { badge.classList.remove('show', 'err'); return; }
  if (spinning) {
    const spinner = document.createElement('span');
    spinner.className = 'spin';
    badge.appendChild(spinner);
  }
  badge.appendChild(document.createTextNode(text));
  badge.classList.toggle('err', !!isError);
  badge.classList.add('show');
}
