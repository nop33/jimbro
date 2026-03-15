import { test, expect } from '@playwright/test';

test.describe('Confetti Animation', () => {
  test('Confetti works properly', async ({ page }) => {
    // Go to the app, trigger confetti manually and check its behavior
    await page.goto('/');

    // We'll expose the throwConfetti function to window or just evaluate it
    await page.evaluate(async () => {
      // Import and call the confetti function
      const mod = await import('/src/features/confetti/index.ts');
      mod.throwConfetti('Test Confetti');
    });

    // Wait for the text element to appear
    const textElement = page.getByText('Test Confetti');
    await expect(textElement).toBeVisible();

    // The confetti container has pointerEvents='none', zIndex='999999', position='fixed'
    // It's attached to document.body and contains multiple child divs (confetti particles)
    const confettiContainer = page.locator('body > div[style*="pointer-events: none"][style*="z-index: 999999"]').first();
    const childrenCount = await confettiContainer.locator('div').count();

    console.log(`Found ${childrenCount} confetti pieces`);

    // Wait to see if animations proceed
    await page.waitForTimeout(300);

    const isAnimating = await page.evaluate(() => {
      const container = document.querySelector('body > div[style*="pointer-events: none"][style*="z-index: 999999"]');
      if (!container || container.children.length === 0) return false;
      const piece = container.children[0] as HTMLElement;
      // The element might be removed if animation is somehow broken and runs instantly
      if (!piece) return false;

      const computed = window.getComputedStyle(piece);
      return {
        transform: computed.transform,
        opacity: computed.opacity,
        animations: piece.getAnimations().map(a => ({
          playState: a.playState,
          currentTime: a.currentTime
        }))
      };
    });

    console.log('Animation status:', isAnimating);

    // Wait until it should be finished
    await page.waitForTimeout(2500);

    const isRemoved = await confettiContainer.count();
    console.log(`Is container removed? ${isRemoved === 0}`);
  });
});
