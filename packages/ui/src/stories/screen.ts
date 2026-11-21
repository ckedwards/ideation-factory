// What a story's test can tell about the screen: how much of an element shows, and the window's size.

/**
 * How many pixels of an element's height show: cut by the window and by every ancestor that clips
 * (overflow other than visible). An element can be visible to `toBeVisible` and show none of itself.
 */
export function shownHeight(element: Element): number {
  const box = element.getBoundingClientRect()
  let top = Math.max(box.top, 0)
  let bottom = Math.min(box.bottom, window.innerHeight)
  for (let at = element.parentElement; at; at = at.parentElement) {
    const { overflowX, overflowY } = getComputedStyle(at)
    if (overflowY !== 'visible' || overflowX !== 'visible') {
      const clip = at.getBoundingClientRect()
      top = Math.max(top, clip.top)
      bottom = Math.min(bottom, clip.bottom)
    }
  }
  return Math.max(0, bottom - top)
}

/**
 * Runs `play` with the window at a size, then puts it back. Only the stories' tests can size the
 * window (`bun run test:stories`); in Storybook itself it runs at whatever size the window is.
 */
export async function atSize(width: number, height: number, play: () => Promise<void>): Promise<void> {
  // the stories' tests run in a browser vitest drives, and say so on the window
  if (!(window as { __vitest_browser__?: boolean }).__vitest_browser__) {
    await play()
    return
  }
  const { page } = await import('vitest/browser')
  const was = { width: window.innerWidth, height: window.innerHeight }
  await page.viewport(width, height)
  try {
    await play()
  } finally {
    await page.viewport(was.width, was.height)
  }
}
