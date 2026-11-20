// The browser fetches a typeface the first time something on the page uses it, and until it's in, the
// text is drawn in a fallback (Georgia for the serifs) whose letters are a different size: lines rewrap
// when it arrives. A page whose first serif text appears late (a comment box, say) jumps then. Asking
// for them all at start fetches them while the page is still loading, before anything uses them.

// each face used for text (the variable fonts carry every weight; italics are a file of their own)
const FACES = [
  '1em "Source Serif 4 Variable"',
  '1em "Literata Variable"',
  'italic 1em "Literata Variable"',
  '1em "Inter Variable"',
  '1em "JetBrains Mono Variable"',
]

/** Starts fetching the app's typefaces now rather than on first use (fonts.css declares them). */
export function loadFonts(): void {
  if (typeof document === 'undefined' || !document.fonts) {
    return
  }
  for (const face of FACES) {
    // a face that fails to load falls back as it would have anyway
    document.fonts.load(face).catch(() => {})
  }
}
