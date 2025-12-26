export function initNavigation() {
  const body = document.body;
  const appPage = body.querySelector('.app-page');

  if (!appPage) {
    console.error('App page not found');
    return;
  }

  const bottomNav = document.createElement('nav');
  bottomNav.className = 'bottom-nav fixed bottom-0 left-0 right-0 bg-neutral-800 border-t border-neutral-700 md:hidden z-50';
  bottomNav.innerHTML = `
    <div class="flex justify-around items-center h-16">
      <a href="/" class="nav-link flex flex-col items-center justify-center flex-1 h-full text-neutral-400 hover:text-blue-500 transition">
        <span class="text-xl">🏠</span>
        <span class="text-xs mt-1">Home</span>
      </a>
      <a href="/workouts/" class="nav-link flex flex-col items-center justify-center flex-1 h-full text-neutral-400 hover:text-blue-500 transition">
        <span class="text-xl">💪</span>
        <span class="text-xs mt-1">Workouts</span>
      </a>
      <a href="/exercises/" class="nav-link flex flex-col items-center justify-center flex-1 h-full text-neutral-400 hover:text-blue-500 transition">
        <span class="text-xl">📋</span>
        <span class="text-xs mt-1">Exercises</span>
      </a>
      <a href="/templates/" class="nav-link flex flex-col items-center justify-center flex-1 h-full text-neutral-400 hover:text-blue-500 transition">
        <span class="text-xl">📝</span>
        <span class="text-xs mt-1">Templates</span>
      </a>
    </div>
  `;

  const currentPath = window.location.pathname;

  bottomNav.querySelectorAll('.nav-link').forEach(link => {
    const href = (link as HTMLAnchorElement).getAttribute('href');
    if (href && currentPath.startsWith(href) && href !== '/') {
      link.classList.add('text-blue-500');
      link.classList.remove('text-neutral-400');
    }
  });

  appPage.classList.add('pb-16', 'md:pb-0');

  body.appendChild(bottomNav);
}

document.addEventListener('DOMContentLoaded', initNavigation);


