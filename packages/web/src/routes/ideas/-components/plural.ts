/** "1 command", "3 commands". */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString('en')} ${count === 1 ? one : many}`
}
