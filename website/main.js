/* Nobulex — main.js */

(function () {
  'use strict';

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ——— Hero video (replace src with videos/hero.mp4 for branded video) ——— */
  const heroVideo = document.querySelector('.hero__video');
  if (heroVideo && !prefersReducedMotion) {
    heroVideo.play().catch(() => {});
    document.addEventListener('click', () => heroVideo.play().catch(() => {}), { once: true });
  }

  /* ——— Section background videos ——— */
  document.querySelectorAll('.section__bg-video').forEach((v) => {
    v.addEventListener('error', () => {
      v.src = 'https://videos.pexels.com/video-files/4939677/4939677-uhd_2560_1440_30fps.mp4';
    }, { once: true });
    v.play().catch(() => {});
  });

  /* ——— Hamburger menu ——— */
  const navToggle = document.querySelector('.nav-toggle');
  const navClose = document.querySelector('.nav-close');
  const headerNav = document.querySelector('.header__nav');
  const navOverlay = document.getElementById('nav-overlay');
  function closeNav() {
    if (navToggle) navToggle.setAttribute('aria-expanded', 'false');
    if (headerNav) headerNav.classList.remove('is-open');
    if (navOverlay) navOverlay.classList.remove('is-visible');
    document.body.style.overflow = '';
  }
  if (navToggle && headerNav) {
    navToggle.addEventListener('click', () => {
      const expanded = navToggle.getAttribute('aria-expanded') === 'true';
      navToggle.setAttribute('aria-expanded', !expanded);
      headerNav.classList.toggle('is-open');
      if (navOverlay) navOverlay.classList.toggle('is-visible', !expanded);
      document.body.style.overflow = expanded ? '' : 'hidden';
    });
    if (navClose) navClose.addEventListener('click', closeNav);
    if (navOverlay) navOverlay.addEventListener('click', closeNav);
    headerNav.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', closeNav);
    });
  }

  /* ——— Copy buttons ——— */
  function showCopied(btn, label = 'Copied!') {
    const prev = btn.textContent;
    btn.textContent = label;
    btn.classList.add('copied');
    setTimeout(() => {
      btn.textContent = prev;
      btn.classList.remove('copied');
    }, 2000);
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    ta.style.top = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try {
      document.execCommand('copy');
      return Promise.resolve();
    } catch (e) {
      return Promise.reject(e);
    } finally {
      document.body.removeChild(ta);
    }
  }

  document.querySelectorAll('.code-block__copy').forEach((btn) => {
    btn.addEventListener('click', () => {
      const block = btn.closest('.code-block');
      const code = block?.querySelector('pre code');
      const text = (code ? (code.textContent || code.innerText) : '').trim();
      copyToClipboard(text).then(() => showCopied(btn, 'Copied!')).catch(() => showCopied(btn, 'Select & copy'));
    });
  });

  document.querySelectorAll('.npm-copy').forEach((btn) => {
    btn.addEventListener('click', () => {
      const text = (btn.getAttribute('data-copy') || btn.textContent || '').trim();
      if (text) copyToClipboard(text).then(() => showCopied(btn, 'Copied!')).catch(() => showCopied(btn, 'Select & copy'));
    });
  });

  /* ——— Live stats (GitHub stars, npm downloads) ——— */
  const GITHUB_REPO = 'nobulexdev/nobulex';
  const NPM_PACKAGE = '@nobulex/sdk';

  function formatNum(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
    return String(n);
  }

  function setLiveStats(stars, downloads) {
    const starEls = document.querySelectorAll('#hero-github-stars, #github-stars, #stats-github-stars');
    const dlEls = document.querySelectorAll('#hero-npm-downloads, #npm-downloads, #stats-npm-downloads');
    starEls.forEach((el) => {
      if (el) el.textContent = (stars != null && stars > 0) ? formatNum(stars) : 'Open Source';
    });
    dlEls.forEach((el) => {
      if (el) el.textContent = (downloads != null && downloads > 0) ? formatNum(downloads) : 'Free';
    });
  }

  Promise.all([
    fetch(`https://api.github.com/repos/${GITHUB_REPO}`).then((r) => r.json()).then((d) => d.stargazers_count).catch(() => null),
    fetch(`https://api.npmjs.org/downloads/point/last-week/${encodeURIComponent(NPM_PACKAGE)}`).then((r) => r.json()).then((d) => d.downloads).catch(() => null)
  ]).then(([stars, downloads]) => setLiveStats(stars, downloads));

  /* ——— Help widget (AI assistance) ——— */
  const helpToggle = document.getElementById('help-toggle');
  const helpPanel = document.getElementById('help-panel');
  const helpClose = document.getElementById('help-close');
  const helpQuery = document.getElementById('help-query');
  const helpAsk = document.getElementById('help-ask');

  if (helpToggle && helpPanel) {
    function openHelp() {
      helpPanel.classList.add('is-open');
      helpPanel.setAttribute('aria-hidden', 'false');
      helpToggle.setAttribute('aria-expanded', 'true');
    }
    function closeHelp() {
      helpPanel.classList.remove('is-open');
      helpPanel.setAttribute('aria-hidden', 'true');
      helpToggle.setAttribute('aria-expanded', 'false');
    }
    helpToggle.addEventListener('click', () => {
      if (helpPanel.classList.contains('is-open')) closeHelp();
      else openHelp();
    });
    if (helpClose) helpClose.addEventListener('click', closeHelp);
    helpPanel.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', closeHelp);
    });
  }

  const helpMessages = document.getElementById('help-messages');
  const helpHint = document.getElementById('help-hint');

  if (helpQuery && helpAsk && helpMessages) {
    let chatHistory = [];

    function addMessage(role, content) {
      const div = document.createElement('div');
      div.className = 'help-widget__msg help-widget__msg--' + role;
      const p = document.createElement('p');
      p.textContent = content;
      div.appendChild(p);
      helpMessages.appendChild(div);
      helpMessages.scrollTop = helpMessages.scrollHeight;
    }

    function setHint(text) {
      if (helpHint) helpHint.textContent = text;
    }

    function addFriendlyLinks() {
      const div = document.createElement('div');
      div.className = 'help-widget__msg help-widget__msg--assistant';
      div.innerHTML = '<p><a href="#problem">What is Nobulex</a> · <a href="#manifesto">Why it matters</a> · <a href="eu-ai-act.html">EU compliance guide</a> · <a href="manifesto.html">Manifesto</a></p>';
      helpMessages.appendChild(div);
      helpMessages.scrollTop = helpMessages.scrollHeight;
    }

    async function sendMessage() {
      const q = helpQuery.value.trim();
      if (!q) return;

      helpQuery.value = '';
      chatHistory.push({ role: 'user', content: q });
      addMessage('user', q);

      const askBtn = helpAsk;
      askBtn.disabled = true;
      setHint('Thinking…');

      try {
        const apiUrl = window.NOBULEX_API_URL || '/api/chat';
        const res = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: chatHistory }),
        });
        const text = await res.text();
        let data;
        try {
          data = text ? JSON.parse(text) : {};
        } catch {
          addMessage('assistant', "Our chat isn't available right now. No worries — try these instead:");
          addFriendlyLinks();
          setHint('');
          return;
        }

        if (!res.ok) {
          addMessage('assistant', "Our chat isn't available right now. Here are some helpful links:");
          addFriendlyLinks();
          setHint('');
          return;
        }

        const content = data.content || '';
        chatHistory.push({ role: 'assistant', content });
        addMessage('assistant', content);
        setHint('');
      } catch (err) {
        addMessage('assistant', "Our chat isn't available right now. Here are some helpful links:");
        addFriendlyLinks();
        setHint('');
      } finally {
        askBtn.disabled = false;
      }
    }

    helpAsk.addEventListener('click', sendMessage);
    helpQuery.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') sendMessage();
    });
  }

  /* ——— EU countdown ——— */
  const euCountdown = document.getElementById('eu-countdown');
  if (euCountdown) {
    const deadline = new Date('2026-08-02T00:00:00Z');
    function update() {
      const now = new Date();
      const diff = deadline - now;
      if (diff <= 0) {
        euCountdown.textContent = 'Enforcement started';
        return;
      }
      const d = Math.floor(diff / 864e5);
      const h = Math.floor((diff % 864e5) / 36e5);
      euCountdown.textContent = `${d} days remaining`;
    }
    update();
    setInterval(update, 36e5);
  }

  /* ——— Scroll progress bar ——— */
  const scrollBar = document.querySelector('.scroll-bar');
  if (scrollBar) {
    function updateScrollBar() {
      const h = document.documentElement.scrollHeight - window.innerHeight;
      const pct = h > 0 ? window.scrollY / h : 0;
      scrollBar.style.transform = `scaleX(${pct})`;
    }
    window.addEventListener('scroll', updateScrollBar, { passive: true });
    updateScrollBar();
  }

  /* ——— Scroll reveal ——— */
  if (!prefersReducedMotion) {
    const reveal = document.querySelectorAll('[data-reveal], [data-section]');
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) e.target.classList.add('visible');
        });
      },
      { threshold: 0.08, rootMargin: '0px 0px -40px 0px' }
    );
    reveal.forEach((el) => io.observe(el));
  }

  /* ——— See it fail closed demo ——— */
  const demoRun = document.getElementById('demo-run');
  const demoLines = document.querySelectorAll('.demo__line--step');
  if (demoRun && demoLines.length) {
    function resetDemo() {
      demoLines.forEach((line) => line.classList.remove('demo__line--visible'));
    }
    function runDemo() {
      resetDemo();
      demoRun.disabled = true;
      demoRun.textContent = 'Running…';
      let delay = 0;
      demoLines.forEach((line, i) => {
        setTimeout(() => {
          line.classList.add('demo__line--visible');
        }, delay);
        delay += 600;
      });
      setTimeout(() => {
        demoRun.disabled = false;
        demoRun.textContent = 'Replay';
      }, delay + 200);
    }
    demoRun.addEventListener('click', runDemo);
  }

  /* ——— Hero word split animation ——— */
  if (!prefersReducedMotion) {
    document.querySelectorAll('[data-split="words"]').forEach((line) => {
      const text = line.textContent;
      const words = text.split(/\s+/).filter(Boolean);
      line.innerHTML = words
        .map((w) => `<span class="word"><span class="word-inner">${w}</span></span>`)
        .join(' ');
    });
  }

})();
