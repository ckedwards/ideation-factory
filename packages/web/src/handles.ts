// A handle suggested from a name, for a new team or group: lowercase letters, digits and dashes,
// as the API takes them (1 to 39 characters, starting and ending with a letter or digit).
export function suggestHandle(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, 39)
    .replace(/-+$/, '')
}
