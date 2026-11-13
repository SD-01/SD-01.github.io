/* FreeHandl chat widget — dependency-free, single file.
 *
 * Embed (one line on any website):
 *   <script async src="https://HOST/widget.js"
 *           data-client="freehandl"
 *           data-agent="Handl"
 *           data-api="https://API-HOST"></script>
 *
 * - data-client : the client id from the backend registry (worker/clients/)
 * - data-agent  : (optional) the agent's display name — brands the panel
 *                 instantly and if the config request is ever blocked
 * - data-api    : base URL of the FreeHandl Worker (no trailing slash)
 *
 * The widget fetches its branding + greetings from GET /api/config, talks to
 * POST /api/chat, and holds NO secrets — the API key lives only on the
 * server. Lead capture is conversational: the assistant asks the questions
 * in chat (see the client system prompt); when the backend confirms a lead
 * was saved it returns { leadCaptured: true }.
 */
(function () {
  'use strict';

  var script = document.currentScript;
  if (!script) {
    var all = document.querySelectorAll('script[data-client][src*="widget"]');
    script = all[all.length - 1];
  }
  if (!script) return;

  var CLIENT = script.getAttribute('data-client');
  var API = (script.getAttribute('data-api') || '').replace(/\/+$/, '');
  // Optional: the agent's display name, so the panel is branded correctly
  // from the first paint (and even if the config request is blocked, e.g.
  // in a site-builder preview). The backend config still wins when it loads.
  var AGENT = script.getAttribute('data-agent') || '';
  if (!CLIENT || !API) {
    if (window.console) console.warn('[freehandl-widget] data-client and data-api attributes are required.');
    return;
  }
  if (document.getElementById('fh-widget-root')) return; // no duplicates

  // ---- UI strings (widget chrome only — the assistant's own replies come
  // from the backend and mirror the visitor's language automatically).
  var STR = {
    en: {
      open: 'Chat with us',
      close: 'Close chat',
      placeholder: 'Type your message…',
      send: 'Send',
      book: 'Book a free call',
      typing: 'typing…',
      error: 'Sorry — something went wrong on my end. Please try again in a moment.',
    },
    fr: {
      open: 'Discutez avec nous',
      close: 'Fermer le clavardage',
      placeholder: 'Écrivez votre message…',
      send: 'Envoyer',
      book: 'Réserver un appel gratuit',
      typing: 'en train d’écrire…',
      error: 'Désolé — un problème est survenu de mon côté. Veuillez réessayer dans un instant.',
    },
  };
  var lang = (navigator.language || 'en').toLowerCase().indexOf('fr') === 0 ? 'fr' : 'en';
  var T = STR[lang];

  // ---- styles (all classes fh- prefixed; no external assets) ------------
  var COLOR = '#0F766E'; // placeholder until config loads
  var css = [
    '#fh-widget-root{position:fixed;right:20px;bottom:20px;z-index:2147483000;font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;}',
    '#fh-bubble{width:60px;height:60px;border-radius:50%;border:0;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 20px rgba(0,0,0,.25);color:#fff;padding:0;}',
    '#fh-bubble:focus-visible,#fh-close:focus-visible,#fh-send:focus-visible,#fh-input:focus-visible{outline:3px solid #93c5fd;outline-offset:2px;}',
    '#fh-bubble svg{width:28px;height:28px;fill:currentColor;}',
    '#fh-panel{position:fixed;right:20px;bottom:92px;width:380px;max-width:calc(100vw - 32px);height:560px;max-height:calc(100dvh - 120px);background:#fff;border-radius:16px;box-shadow:0 16px 48px rgba(0,0,0,.28);display:none;flex-direction:column;overflow:hidden;}',
    '#fh-panel.fh-open{display:flex;}',
    '#fh-head{color:#fff;padding:14px 16px;display:flex;align-items:flex-start;gap:10px;}',
    '#fh-head .fh-title{font-size:16px;font-weight:650;line-height:1.25;}',
    '#fh-head .fh-sub{font-size:12.5px;opacity:.88;line-height:1.3;}',
    '#fh-close{margin-left:auto;background:transparent;border:0;color:#fff;font-size:22px;line-height:1;cursor:pointer;padding:2px 6px;}',
    '#fh-book{display:none;margin:0;padding:9px 16px;background:#f8fafc;border-bottom:1px solid #e5e7eb;font-size:13.5px;text-decoration:none;font-weight:600;}',
    '#fh-msgs{flex:1;overflow-y:auto;padding:14px 12px;background:#f8fafc;display:flex;flex-direction:column;gap:8px;}',
    '.fh-row{display:flex;}',
    '.fh-row.fh-user{justify-content:flex-end;}',
    '.fh-msg{max-width:82%;padding:9px 12px;border-radius:14px;font-size:14.5px;line-height:1.45;white-space:normal;word-wrap:break-word;}',
    '.fh-msg.fh-assistant{background:#fff;border:1px solid #e5e7eb;border-bottom-left-radius:4px;color:#111827;}',
    '.fh-msg.fh-user{color:#fff;border-bottom-right-radius:4px;}',
    '.fh-msg.fh-typing{color:#6b7280;font-style:italic;}',
    '#fh-form{display:flex;gap:8px;padding:10px;border-top:1px solid #e5e7eb;background:#fff;}',
    '#fh-input{flex:1;border:1px solid #d1d5db;border-radius:10px;padding:10px 11px;font-size:14.5px;font-family:inherit;resize:none;max-height:90px;}',
    '#fh-send{border:0;border-radius:10px;color:#fff;padding:0 16px;font-size:14.5px;font-weight:600;cursor:pointer;}',
    '#fh-send:disabled{opacity:.55;cursor:default;}',
    '@media (max-width:480px){#fh-panel{right:8px;bottom:84px}#fh-widget-root{right:12px;bottom:12px}}',
  ].join('');

  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  // ---- DOM -----------------------------------------------------------------
  var root = document.createElement('div');
  root.id = 'fh-widget-root';

  var bubble = document.createElement('button');
  bubble.id = 'fh-bubble';
  bubble.type = 'button';
  bubble.setAttribute('aria-label', T.open);
  bubble.setAttribute('aria-haspopup', 'dialog');
  bubble.setAttribute('aria-expanded', 'false');
  bubble.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3C6.5 3 2 6.9 2 11.8c0 2.8 1.5 5.3 3.9 6.9-.1 1.1-.6 2.7-1.7 3.9 2.3-.2 4.4-1.3 5.7-2.3.7.1 1.4.2 2.1.2 5.5 0 10-3.9 10-8.7S17.5 3 12 3z"/></svg>';

  var panel = document.createElement('section');
  panel.id = 'fh-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', T.open);

  var head = document.createElement('div');
  head.id = 'fh-head';
  var headText = document.createElement('div');
  var title = document.createElement('div');
  title.className = 'fh-title';
  title.textContent = AGENT; // branded immediately; config confirms it below
  var sub = document.createElement('div');
  sub.className = 'fh-sub';
  var closeBtn = document.createElement('button');
  closeBtn.id = 'fh-close';
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', T.close);
  closeBtn.textContent = '×';
  headText.appendChild(title);
  headText.appendChild(sub);
  head.appendChild(headText);
  head.appendChild(closeBtn);

  var book = document.createElement('a');
  book.id = 'fh-book';
  book.target = '_blank';
  book.rel = 'noopener';
  book.textContent = T.book;

  var msgs = document.createElement('div');
  msgs.id = 'fh-msgs';
  msgs.setAttribute('aria-live', 'polite');

  var form = document.createElement('form');
  form.id = 'fh-form';
  var input = document.createElement('textarea');
  input.id = 'fh-input';
  input.rows = 1;
  input.setAttribute('aria-label', T.placeholder);
  input.placeholder = T.placeholder;
  var send = document.createElement('button');
  send.id = 'fh-send';
  send.type = 'submit';
  send.textContent = T.send;
  form.appendChild(input);
  form.appendChild(send);

  panel.appendChild(head);
  panel.appendChild(book);
  panel.appendChild(msgs);
  panel.appendChild(form);
  root.appendChild(panel);
  root.appendChild(bubble);
  document.body.appendChild(root);

  function applyColor() {
    bubble.style.background = COLOR;
    head.style.background = COLOR;
    send.style.background = COLOR;
    book.style.color = COLOR;
    var userStyle = document.createElement('style');
    userStyle.textContent = '.fh-msg.fh-user{background:' + COLOR + ';}';
    document.head.appendChild(userStyle);
  }
  applyColor();

  // ---- state ---------------------------------------------------------------
  var history = []; // [{role:'user'|'assistant', content}]
  var opened = false;
  var greeted = false;
  var busy = false;
  var sessionId = '';
  try {
    sessionId = sessionStorage.getItem('fh-session-' + CLIENT) || '';
    if (!sessionId) {
      sessionId = Math.random().toString(36).slice(2) + Date.now().toString(36);
      sessionStorage.setItem('fh-session-' + CLIENT, sessionId);
    }
  } catch (e) {
    sessionId = 's-' + Date.now().toString(36);
  }

  var config = null;

  // The model sometimes writes Markdown (**bold**, *italics*, ## headings,
  // `code`). This widget renders plain text only (textContent, never
  // innerHTML), so those markers would show literally — strip them from
  // assistant messages before display. The words themselves are kept.
  function stripMarkdown(s) {
    return String(s)
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\*\*/g, '')
      .replace(/^#{1,6}\s+/gm, '');
  }

  function addMessage(role, text) {
    var row = document.createElement('div');
    row.className = 'fh-row ' + (role === 'user' ? 'fh-user' : 'fh-assistant');
    var bubbleEl = document.createElement('div');
    bubbleEl.className = 'fh-msg fh-' + role;
    // textContent only — never innerHTML — so neither visitor nor model
    // output can inject markup into the host page. URLs in assistant
    // messages become real links (built as DOM nodes, still no innerHTML).
    var displayText = role === 'assistant' ? stripMarkdown(text) : text;
    String(displayText).split('\n').forEach(function (line, i, arr) {
      if (role === 'assistant') {
        var parts = line.split(/(https?:\/\/[^\s<*]+)/g);
        parts.forEach(function (part) {
          if (/^https?:\/\//.test(part)) {
            // Defensive: strip any trailing markdown/punctuation the model
            // may have attached (e.g. **bold** or a closing parenthesis).
            var trail = (part.match(/[\*).,;:!?]+$/) || [''])[0];
            var clean = trail ? part.slice(0, -trail.length) : part;
            var a = document.createElement('a');
            a.href = clean;
            a.target = '_blank';
            a.rel = 'noopener';
            a.textContent = clean;
            a.style.color = 'inherit';
            a.style.textDecoration = 'underline';
            bubbleEl.appendChild(a);
            if (trail) bubbleEl.appendChild(document.createTextNode(trail));
          } else if (part) {
            bubbleEl.appendChild(document.createTextNode(part));
          }
        });
      } else {
        bubbleEl.appendChild(document.createTextNode(line));
      }
      if (i < arr.length - 1) bubbleEl.appendChild(document.createElement('br'));
    });
    row.appendChild(bubbleEl);
    msgs.appendChild(row);
    msgs.scrollTop = msgs.scrollHeight;
    return row;
  }

  function setTyping(on) {
    var existing = msgs.querySelector('.fh-typing-row');
    if (on && !existing) {
      var row = addMessage('assistant', T.typing);
      row.classList.add('fh-typing-row');
      row.firstChild.classList.add('fh-typing');
    } else if (!on && existing) {
      existing.remove();
    }
  }

  function toggle(open) {
    opened = typeof open === 'boolean' ? open : !opened;
    panel.classList.toggle('fh-open', opened);
    bubble.setAttribute('aria-expanded', String(opened));
    if (opened) {
      if (!greeted && config) {
        greeted = true;
        var greeting = lang === 'fr' ? config.greetingFR : config.greetingEN;
        history.push({ role: 'assistant', content: greeting });
        addMessage('assistant', greeting);
      }
      input.focus();
    } else {
      bubble.focus();
    }
  }

  bubble.addEventListener('click', function () { toggle(); });
  closeBtn.addEventListener('click', function () { toggle(false); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && opened) toggle(false);
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var text = input.value.trim();
    if (!text || busy) return;
    input.value = '';
    busy = true;
    send.disabled = true;
    history.push({ role: 'user', content: text });
    addMessage('user', text);
    setTyping(true);

    fetch(API + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client: CLIENT, sessionId: sessionId, messages: history }),
    })
      .then(function (res) {
        if (!res.ok) throw new Error('http ' + res.status);
        return res.json();
      })
      .then(function (data) {
        setTyping(false);
        history.push({ role: 'assistant', content: data.reply });
        addMessage('assistant', data.reply);
        if (data.leadCaptured && window.console) {
          console.info('[freehandl-widget] lead captured and sent to the team.');
        }
      })
      .catch(function () {
        setTyping(false);
        addMessage('assistant', T.error);
      })
      .finally(function () {
        busy = false;
        send.disabled = false;
        input.focus();
      });
  });

  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  // ---- load config, then restyle -------------------------------------------
  fetch(API + '/api/config?client=' + encodeURIComponent(CLIENT))
    .then(function (res) {
      if (!res.ok) throw new Error('config http ' + res.status);
      return res.json();
    })
    .then(function (cfg) {
      config = cfg;
      if (cfg.color) { COLOR = cfg.color; applyColor(); }
      title.textContent = cfg.agentName || cfg.displayName;
      sub.textContent = cfg.displayName;
      panel.setAttribute('aria-label', (cfg.agentName || cfg.displayName) + ' — ' + T.open);
      if (cfg.bookingUrl) {
        book.href = cfg.bookingUrl;
        book.style.display = 'block';
      }
    })
    .catch(function () {
      // Site still gets a working bubble; chat calls will surface the error
      // string in-panel if the backend is unreachable. Keep the agent's
      // name as the title — never a generic "Chat with us".
      title.textContent = AGENT || T.open;
    });
})();
