const command = 'npx shepherd-agents';
const status = document.querySelector('.copy-status');
let statusTimer;
for (const button of document.querySelectorAll('[data-copy]')) {
  button.hidden = false;
  button.addEventListener('click', async () => {
    clearTimeout(statusTimer);
    const label = button.querySelector('span');
    try {
      await navigator.clipboard.writeText(command);
      label.textContent = 'Copied';
      status.textContent = 'Copied. Paste it into your terminal.';
    } catch {
      const range = document.createRange();
      range.selectNodeContents(button.parentElement.querySelector('code'));
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      label.textContent = 'Copy';
      status.textContent = `Select and copy: ${command}`;
    }
    statusTimer = setTimeout(() => {
      for (const copyLabel of document.querySelectorAll('[data-copy] span')) copyLabel.textContent = 'Copy';
      status.textContent = '';
    }, 6000);
  });
}

const narrow = window.matchMedia('(max-width: 600px)');
const views = {
  map: {
    desktop: ['task-map-desktop', 1440, 1000],
    alt: "Shepherd's Slice task map, with eight connected steps: four done, two running, and review and a merge request waiting.",
    caption: 'Eight steps. Four done, two running, review and a merge request still ahead.',
  },
  outline: {
    desktop: ['task-outline-desktop', 1440, 1500],
    mobile: ['task-outline-mobile', 390, 1000],
    alt: 'The outline beside Handle payment retries, with two of four Done when items marked met.',
    mobileAlt: "Slice's task outline: eight steps, four done, two running and two waiting.",
    caption: 'The plan stays visible, one step at a time.',
  },
  checks: {
    desktop: ['step-checks-desktop', 1440, 1200],
    mobile: ['step-checks-mobile', 390, 1300],
    alt: 'Build the Apple Pay button: twelve tests passed and a separate Codex review marked four Done when items met.',
    caption: 'A command result and a separate review against the step.',
  },
};
const tabs = [...document.querySelectorAll('[data-view]')];
const panel = document.querySelector('#product-view');
const picture = document.querySelector('#explorer-picture');
const screenshot = document.querySelector('#explorer-image');
const fullSize = document.querySelector('#full-size');
let selected = narrow.matches ? 'outline' : 'map';
let userSelected = false;
function showView(name) {
  selected = name;
  const view = views[name];
  for (const tab of tabs) {
    const active = tab.dataset.view === name;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
  }
  panel.setAttribute('role', 'tabpanel');
  panel.setAttribute('aria-labelledby', `tab-${name}`);
  panel.removeAttribute('aria-label');
  const source = picture.querySelector('source');
  if (view.mobile) {
    source.srcset = `./assets/${view.mobile[0]}.png`;
    source.width = view.mobile[1];
    source.height = view.mobile[2];
  } else {
    source.removeAttribute('srcset');
  }
  const [file, width, height] = view.desktop;
  screenshot.src = `./assets/${file}.png`;
  screenshot.width = width;
  screenshot.height = height;
  screenshot.alt = narrow.matches && view.mobileAlt ? view.mobileAlt : view.alt;
  document.querySelector('#view-caption').textContent = view.caption;
  fullSize.href = `./assets/${narrow.matches && view.mobile ? view.mobile[0] : file}.png`;
}
for (const tab of tabs) {
  tab.addEventListener('click', () => {
    userSelected = true;
    showView(tab.dataset.view);
  });
  tab.addEventListener('keydown', (event) => {
    let index = tabs.indexOf(tab);
    if (event.key === 'ArrowRight') index = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') index = (index + tabs.length - 1) % tabs.length;
    else if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = tabs.length - 1;
    else return;
    event.preventDefault();
    tabs[index].focus();
    tabs[index].click();
  });
}
showView(selected);
document.querySelector('.product-tabs').hidden = false;
narrow.addEventListener('change', () => showView(userSelected ? selected : narrow.matches ? 'outline' : 'map'));

document.body.classList.remove('no-js');
