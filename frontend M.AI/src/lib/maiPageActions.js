/* MAI page-level assistance. Operates only on visible, enabled controls of the
   current authenticated page. Never bypasses permissions or submits silently. */
const normalize = value => String(value || '').toLocaleLowerCase().trim();
const visible = element => Boolean(element && element.getClientRects().length && !element.disabled && element.getAttribute('aria-hidden') !== 'true');
const description = element => [element.getAttribute('aria-label'), element.getAttribute('placeholder'), element.getAttribute('name'), element.id, element.labels && [...element.labels].map(x => x.textContent).join(' '), element.textContent?.slice(0, 90)].filter(Boolean).join(' ').toLocaleLowerCase();
const controls = selector => [...document.querySelectorAll(`main ${selector}, [role="dialog"] ${selector}`)].filter(visible);
export function listPageControls() {
  return controls('input, textarea, select, button, a[href], [role="button"]').map((el, index) => ({index: index + 1, label: description(el).slice(0, 100), type: el.tagName.toLowerCase()}));
}
function matchControl(term, selector) {
  const candidates = controls(selector);
  const wanted = normalize(term);
  const exact = candidates.find(el => description(el).includes(wanted));
  if (exact) return exact;
  const number = Number(wanted);
  return Number.isInteger(number) && number > 0 ? candidates[number - 1] : null;
}
export function planPageAction(command) {
  const raw = command.trim();
  // Commands with explicit field names and values: "set chassis number to ABC123"
  const fill = raw.match(/^(?:set|fill|write|enter|type|لکھو|لکھیں|درج کرو|بھرو)\s+(.+?)\s+(?:to|as|with|میں|ہے|:|=)\s+(.+)$/i);
  if (fill) {
    const element = matchControl(fill[1], 'input:not([type="hidden"]):not([type="file"]), textarea, select');
    if (!element) return {message: `Field not found on this page: ${fill[1]}`};
    if (element.type === 'password' || element.type === 'file') return {message: 'This field cannot be filled by voice.'};
    return {message: `Write “${fill[2]}” into “${fill[1]}”?`, action: () => {
      const setter = Object.getOwnPropertyDescriptor(element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : element.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value')?.set;
      if (element.tagName === 'SELECT') {
        const option = [...element.options].find(x => normalize(x.textContent).includes(normalize(fill[2])) || normalize(x.value) === normalize(fill[2]));
        if (!option) throw new Error('Option not found');
        setter.call(element, option.value);
      } else setter.call(element, fill[2]);
      element.dispatchEvent(new Event('input', {bubbles: true}));
      element.dispatchEvent(new Event('change', {bubbles: true}));
      element.focus();
    }};
  }
  const click = raw.match(/^(?:click|press|select|tap|دباؤ|دبائیں|کلک|منتخب کرو)\s+(.+)$/i);
  if (click) {
    const element = matchControl(click[1], 'button, a[href], [role="button"]');
    if (!element) return {message: `Button or link not found: ${click[1]}`};
    return {message: `Press “${description(element).slice(0, 80)}”?`, action: () => element.click()};
  }
  const scroll = raw.match(/^(?:scroll|نیچے|اوپر)\s*(down|up|نیچے|اوپر)?$/i);
  if (scroll) return {message: 'Scrolling page', immediate: () => window.scrollBy({top: /up|اوپر/i.test(raw) ? -550 : 550, behavior: 'smooth'})};
  return null;
}
