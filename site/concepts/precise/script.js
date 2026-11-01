const repository = 'https://github.com/OWNER/shepherd';

document.querySelectorAll('[data-repo]').forEach((link) => {
  link.href = repository + (link.dataset.repo === 'readme' ? '#readme' : '');
});

const status = document.querySelector('.copy-status');
let statusTimer;
document.querySelectorAll('[data-copy]').forEach((button) => {
  let buttonTimer;
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText('npx shepherd-agents');
      clearTimeout(buttonTimer);
      clearTimeout(statusTimer);
      button.querySelector('span').textContent = 'Copied';
      button.classList.add('is-copied');
      button.setAttribute('aria-label', 'Install command copied');
      status.textContent = 'Copied. Paste it into your terminal.';
      status.classList.add('visible');
      buttonTimer = setTimeout(() => {
        button.querySelector('span').textContent = 'Copy';
        button.classList.remove('is-copied');
        button.setAttribute('aria-label', 'Copy install command');
      }, 2400);
      statusTimer = setTimeout(() => status.classList.remove('visible'), 3000);
    } catch {
      status.textContent = 'Select and copy: npx shepherd-agents';
      status.classList.add('visible');
      const range = document.createRange();
      range.selectNodeContents(button.parentElement.querySelector('code'));
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      clearTimeout(statusTimer);
      statusTimer = setTimeout(() => status.classList.remove('visible'), 6000);
    }
  });
});

const tabs = [...document.querySelectorAll('[data-view]')];
const captions = {
  map: 'See what’s done, what’s running, and what comes next.',
  outline: 'A clear outline. Every step with its own definition of done.',
  checks: 'Check the code. Check the work against the step.'
};
function selectView(tab, focus = false) {
  tabs.forEach((item) => {
    const active = item === tab;
    item.setAttribute('aria-selected', String(active));
    item.tabIndex = active ? 0 : -1;
    document.getElementById(item.getAttribute('aria-controls')).hidden = !active;
  });
  document.getElementById('view-caption').textContent = captions[tab.dataset.view];
  document.querySelector('.product-caption').classList.toggle('hide-map-hint', tab.dataset.view !== 'map');
  document.querySelector('.caption-count').hidden = tab.dataset.view !== 'map';
  if (mobileMap.matches && tab.dataset.view !== 'map') {
    const panel = document.getElementById(tab.getAttribute('aria-controls'));
    const image = panel.querySelector('img');
    const frame = () => {
      if (panel.dataset.framed) return;
      panel.scrollTop = 270;
      panel.dataset.framed = 'true';
    };
    if (image.complete) frame();
    else image.addEventListener('load', frame, { once: true });
  }
  if (focus) tab.focus();
}
tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => selectView(tab));
  tab.addEventListener('keydown', (event) => {
    let next;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = tabs.length - 1;
    if (next === undefined) return;
    event.preventDefault();
    selectView(tabs[next], true);
  });
});

const mobileMap = window.matchMedia('(max-width: 600px)');
function frameMap() {
  if (!mobileMap.matches) return;
  const panel = document.getElementById('panel-map');
  panel.scrollLeft = 205;
  panel.scrollTop = 90;
}
const mapImage = document.querySelector('.map-screenshot');
if (mapImage.complete) frameMap();
else mapImage.addEventListener('load', frameMap, { once: true });
mobileMap.addEventListener('change', () => {
  if (mobileMap.matches) frameMap();
  else {
    const panel = document.getElementById('panel-map');
    panel.scrollLeft = 0;
    panel.scrollTop = 0;
  }
});
