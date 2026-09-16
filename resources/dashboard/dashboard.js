// Dashboard behaviour. Markup comes from the extension; this only wires events and posts
// messages back. It never turns data into HTML.
(function () {
  const vscode = acquireVsCodeApi();

  // Bar widths are set here because the page's CSP forbids inline style attributes.
  for (const bar of document.querySelectorAll('.bar[data-width]')) {
    bar.style.width = bar.getAttribute('data-width') + '%';
  }

  document.addEventListener('click', (event) => {
    const action = event.target instanceof Element ? event.target.closest('[data-action]') : null;
    if (action) {
      event.preventDefault();
      vscode.postMessage({
        type: action.getAttribute('data-action'),
        prompt: action.getAttribute('data-prompt') || undefined,
        path: action.getAttribute('data-path') || undefined,
        key: action.getAttribute('data-key-value') || undefined,
      });
      return;
    }
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

  // Permission tester: the extension evaluates, the page only shows the text it gets back.
  const permInput = document.getElementById('perm-input');
  const permButton = document.getElementById('perm-test');
  const permResult = document.getElementById('perm-result');
  const testPermission = () => {
    if (permInput && permInput.value.trim()) {
      vscode.postMessage({ type: 'testPermission', text: permInput.value.trim() });
    }
  };
  if (permButton) {
    permButton.addEventListener('click', testPermission);
  }
  if (permInput) {
    permInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        testPermission();
      }
    });
  }

  // Hook timeline: drag a hook onto an event or a settings file. Only indexes are sent.
  let dragged = null;
  document.addEventListener('dragstart', (event) => {
    const hook = event.target instanceof Element ? event.target.closest('[data-hook]') : null;
    if (!hook) {
      return;
    }
    dragged = hook.getAttribute('data-hook');
    event.dataTransfer.setData('text/plain', dragged);
    event.dataTransfer.effectAllowed = 'move';
    hook.classList.add('dragging');
  });
  document.addEventListener('dragend', () => {
    dragged = null;
    for (const el of document.querySelectorAll('.dragging, .drop-over')) {
      el.classList.remove('dragging', 'drop-over');
    }
  });
  const dropTargetOf = (event) =>
    event.target instanceof Element ? event.target.closest('.drop-target') : null;
  document.addEventListener('dragover', (event) => {
    const target = dragged && dropTargetOf(event);
    if (!target) {
      return;
    }
    event.preventDefault();
    for (const el of document.querySelectorAll('.drop-over')) {
      if (el !== target) {
        el.classList.remove('drop-over');
      }
    }
    target.classList.add('drop-over');
  });
  document.addEventListener('drop', (event) => {
    const target = dragged && dropTargetOf(event);
    if (!target) {
      return;
    }
    event.preventDefault();
    const message = { type: 'moveHook', hook: dragged };
    if (target.hasAttribute('data-layer')) {
      message.layer = target.getAttribute('data-layer');
    } else {
      message.event = target.getAttribute('data-event');
    }
    vscode.postMessage(message);
  });

  // Which hooks fire for a tool: the same matcher rules Claude Code documents.
  const matcherInput = document.getElementById('matcher-input');
  const matcherResult = document.getElementById('matcher-result');
  const matches = (matcher, kind, tool) => {
    if (kind === 'all') {
      return true;
    }
    if (kind === 'exact') {
      return matcher.split(/[|,]/).map((s) => s.trim()).includes(tool);
    }
    try {
      return new RegExp(matcher).test(tool);
    } catch (e) {
      return false;
    }
  };
  if (matcherInput) {
    matcherInput.addEventListener('input', () => {
      const tool = matcherInput.value.trim();
      let count = 0;
      for (const li of document.querySelectorAll('li.hook')) {
        const toolEvent = li.closest('[data-tool-event]');
        const fires = tool !== '' && toolEvent !== null && matches(li.getAttribute('data-matcher') === '*' ? '' : li.getAttribute('data-matcher'), li.getAttribute('data-matcher-kind'), tool);
        li.classList.toggle('fires', fires);
        li.classList.toggle('quiet', tool !== '' && !fires);
        if (fires) {
          count++;
        }
      }
      if (matcherResult) {
        matcherResult.textContent = tool === '' ? '' : count === 0 ? 'No tool hook matches ' + tool + '.' : count + ' hook' + (count === 1 ? '' : 's') + ' would run for ' + tool + ' (tool events only).';
      }
    });
  }

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
    if (msg && msg.type === 'permissionResult' && permResult) {
      permResult.textContent = msg.text;
      permResult.className = 'tester-result decision-' + String(msg.decision).replace(/[^a-z]/g, '');
      return;
    }
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
