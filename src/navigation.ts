export function initNavigation() {
  const body = document.body;
  const appPage = body.querySelector('.app-page');

  if (!appPage) {
    console.error('App page not found');
    return;
  }

  const bottomNav = document.createElement('nav');
  bottomNav.className = 'bottom-nav fixed bottom-0 left-0 right-0 md:hidden z-50';
  bottomNav.innerHTML = `
    <div class="flex justify-around items-center h-20 px-2">
      <a href="/" class="nav-link flex flex-col items-center justify-center flex-1 h-full text-neutral-400 hover:text-blue-400 transition-all duration-200">
        <span class="text-2xl mb-1">🏠</span>
        <span class="text-xs font-medium">Home</span>
      </a>
      <a href="/workouts/" class="nav-link flex flex-col items-center justify-center flex-1 h-full text-neutral-400 hover:text-blue-400 transition-all duration-200">
        <span class="text-2xl mb-1">💪</span>
        <span class="text-xs font-medium">Workouts</span>
      </a>
      <a href="/exercises/" class="nav-link flex flex-col items-center justify-center flex-1 h-full text-neutral-400 hover:text-blue-400 transition-all duration-200">
        <span class="text-2xl mb-1">📋</span>
        <span class="text-xs font-medium">Exercises</span>
      </a>
      <a href="/programms/" class="nav-link flex flex-col items-center justify-center flex-1 h-full text-neutral-400 hover:text-blue-400 transition-all duration-200">
        <span class="text-2xl mb-1">📝</span>
        <span class="text-xs font-medium">Programms</span>
      </a>
    </div>
  `;

  const currentPath = window.location.pathname;

  bottomNav.querySelectorAll('.nav-link').forEach(link => {
    const href = (link as HTMLAnchorElement).getAttribute('href');
    if (href === '/' && currentPath === '/') {
      link.classList.add('active');
      link.classList.remove('text-neutral-400');
    } else if (href && href !== '/' && currentPath.startsWith(href)) {
      link.classList.add('active');
      link.classList.remove('text-neutral-400');
    }
  });

  appPage.classList.add('pb-20', 'md:pb-0');

  body.appendChild(bottomNav);
}

document.addEventListener('DOMContentLoaded', initNavigation);


