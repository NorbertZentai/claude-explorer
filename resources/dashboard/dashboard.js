// Dashboard behaviour. Markup comes from the extension; this only wires events and posts
// messages back. It never turns data into HTML.
(function () {
  const vscode = acquireVsCodeApi();

  // Bar widths are set here because the page's CSP forbids inline style attributes.
  for (const bar of document.querySelectorAll('.bar[data-width]')) {
    bar.style.width = bar.getAttribute('data-width') + '%';
  }

  document.addEventListener('click', (event) => {
    const link = event.target instanceof Element ? event.target.closest('a.open') : null;
    if (!link) {
      return;
    }
    event.preventDefault();
    const line = link.getAttribute('data-line');
    vscode.postMessage({
      type: 'open',
      path: link.getAttribute('data-path'),
      line: line === null ? undefined : Number(line),
    });
  });

  const picker = document.getElementById('project');
  if (picker) {
    picker.addEventListener('change', () => {
      vscode.setState({ scrollY: window.scrollY });
      vscode.postMessage({ type: 'selectScope', root: picker.value });
    });
  }

  // A re-render replaces the whole page; put the reader back where they were.
  const state = vscode.getState();
  if (state && typeof state.scrollY === 'number') {
    window.scrollTo(0, state.scrollY);
  }
  window.addEventListener('scroll', () => vscode.setState({ scrollY: window.scrollY }), { passive: true });

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg || msg.type !== 'reveal') {
      return;
    }
    const section = document.getElementById(msg.section);
    if (!section) {
      return;
    }
    for (const old of document.querySelectorAll('.highlight')) {
      old.classList.remove('highlight');
    }
    const rows = msg.key
      ? [...section.querySelectorAll('[data-key]')].filter((el) =>
          el.getAttribute('data-key').split('|').some((k) => k.startsWith(msg.key)),
        )
      : [];
    for (const row of rows) {
      row.classList.add('highlight');
    }
    (rows[0] || section).scrollIntoView({ block: rows[0] ? 'center' : 'start' });
  });

  // Tell the extension the page is listening; a reveal sent earlier would be lost.
  vscode.postMessage({ type: 'ready' });
})();
