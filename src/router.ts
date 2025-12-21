const navigateTo = (url: string) => {
  history.pushState({}, '', url);
  router();
}

const router = () => {
  const routes = [
    { path: '/', view: () => console.log('Home') },
    { path: '/workouts', view: () => console.log('Workouts') },
    { path: '/templates', view: () => console.log('Templates') },
    { path: '/settings', view: () => console.log('Settings') },
  ]

  const match = routes.find(route => route.path === location.pathname) ?? routes[0]
  match.view()
}

// Useful when the user navigates with the browser's back and forward buttons
window.addEventListener('popstate', router);

document.addEventListener('DOMContentLoaded', () => {
  document.body.addEventListener('click', (e) => {
    if (e?.target instanceof HTMLElement && e.target.matches('[data-link]')) {
      e.preventDefault();
      console.log(e.target);
      navigateTo(e.target.getAttribute('href')!);
    }
  })

  router();
});

