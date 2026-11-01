// Replace the repository placeholder here when the public repository is created.
const repository = 'https://github.com/comountainclimber/shepherd';
document.querySelectorAll('[data-repo]').forEach(link => {
  link.href = repository + (link.dataset.repo === 'docs' ? '#readme' : '');
});
let toastTimeout;
const toast = document.querySelector('#copy-status');
document.querySelectorAll('.copy').forEach(button => {
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText('npx shepherd-agents');
      toast.textContent = 'Copied. Your flock is one command away.';
    } catch {
      toast.textContent = 'Select and copy: npx shepherd-agents';
      const range = document.createRange();
      range.selectNodeContents(button.parentElement.querySelector('code'));
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }
    toast.classList.add('visible');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => toast.classList.remove('visible'), 3500);
  });
});
const views = {
  map: { desktop: 'task-map-desktop.png', mobile: 'task-map-desktop.png', alt: 'Shepherd’s map: eight steps for adding Apple Pay, with four done and two running.', description: 'One task. Eight steps. Everyone knows where they’re going.' },
  outline: { desktop: 'task-outline-desktop.png', mobile: 'task-outline-mobile.png', alt: 'Shepherd’s outline and the running payment retries step, with 2 of 4 Done when items met.', description: 'The outline keeps the plan and each step’s Done when items together.' },
  checks: { desktop: 'step-checks-desktop.png', mobile: 'step-checks-mobile.png', alt: 'Shepherd’s Checks tab shows passing checkout tests and four verdicts against the step.', description: 'See the checks, the verdicts, and what “done” actually means.' }
};
const tabs = [...document.querySelectorAll('[data-view]')];
function selectView(button) {
  const view = views[button.dataset.view];
  tabs.forEach(tab => {
    tab.setAttribute('aria-selected', String(tab === button));
    tab.tabIndex = tab === button ? 0 : -1;
  });
  document.querySelector('#product-panel').setAttribute('aria-labelledby', button.id);
  document.querySelector('#mobile-source').srcset = `assets/${view.mobile}`;
  const img = document.querySelector('#product-image');
  img.src = `assets/${view.desktop}`;
  img.alt = view.alt;
  document.querySelector('#screenshot-link').href = `assets/${view.desktop}`;
  document.querySelector('#view-description').textContent = view.description;
}
tabs.forEach((button, index) => {
  button.addEventListener('click', () => selectView(button));
  button.addEventListener('keydown', event => {
    let next;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = tabs.length - 1;
    if (next !== undefined) {
      event.preventDefault();
      tabs[next].focus();
      selectView(tabs[next]);
    }
  });
});
if (window.matchMedia('(max-width: 600px)').matches) {
  selectView(document.querySelector('#tab-outline'));
}
let greeting = 0;
const greetings = ['Baa. (That means “you’ve got this.”)', 'All accounted for. Even the tests.', 'small flock. big get-it-done energy.'];
document.querySelector('.pet').addEventListener('click', () => {
  document.querySelector('.sheep-note').textContent = greetings[greeting++ % greetings.length];
});
