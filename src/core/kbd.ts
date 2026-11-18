/** key names as the markup the HUD and the menus draw as key caps: kbd('Shift', 'W') */
export function kbd(...keys: string[]): string {
  return keys.map((k) => `<kbd>${k}</kbd>`).join('');
}
