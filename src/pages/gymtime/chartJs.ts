// Chart.js is most of gymtime's code and only the history dialog draws with it, so it loads when the dialog first
// opens. The service worker caches its chunk with the rest of the build, so it loads offline too.
export const loadChartJs = async () => (await import('chart.js/auto')).default
