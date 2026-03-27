/**
 * Generic row renderer for the options page.
 *
 * Creates DOM rows from a column specification + data object.
 * Used for both shortcut rows and site-rule rows.
 *
 * Pure DOM helper — no framework, no data binding.
 */

/**
 * Create a DOM row element from a column spec and optional initial data.
 *
 * @param {HTMLElement} container - Parent element to insert into
 * @param {Array<Object>} columns - Column definitions, each with:
 *   - key       {string}  Data key for this column
 *   - type      {string}  'text' | 'checkbox' | 'select'
 *   - className {string}  CSS class for the element
 *   - placeholder {string}  (optional) Input placeholder
 *   - default   {*}       (optional) Default value if data[key] is missing
 *   - options   {Array}   (select only) Array of [value, label] pairs
 * @param {Object} [data={}] - Initial values keyed by column key
 * @param {Object} [opts={}] - Options:
 *   - before    {HTMLElement}  Insert before this element (default: append)
 *   - removable {boolean}      Add a remove button
 *   - id        {string}       Set row id attribute
 *   - className {string}       Additional CSS class(es) for the row
 * @returns {HTMLElement} The created row element
 */
export function createRow(container, columns, data = {}, opts = {}) {
  const row = document.createElement('div');
  row.className = `row${opts.className ? ` ${opts.className}` : ''}`;
  if (opts.id) {
    row.id = opts.id;
  }

  for (const col of columns) {
    let el;

    if (col.type === 'select') {
      el = document.createElement('select');
      el.className = col.className;
      for (const [value, label] of col.options) {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = label;
        el.appendChild(opt);
      }
      if (data[col.key] !== null && data[col.key] !== undefined) {
        el.value = data[col.key];
      }
    } else if (col.type === 'checkbox') {
      el = document.createElement('input');
      el.type = 'checkbox';
      el.className = col.className;
      el.checked = data[col.key] ?? col.default ?? false;
    } else {
      // 'text' or any other input type
      el = document.createElement('input');
      el.type = col.inputType || 'text';
      el.className = col.className;
      if (col.placeholder) {
        el.placeholder = col.placeholder;
      }
      const val = data[col.key] ?? col.default;
      if (val !== null && val !== undefined) {
        el.value = val;
      }
    }

    row.appendChild(el);
  }

  if (opts.removable) {
    const btn = document.createElement('button');
    btn.className = 'removeParent';
    btn.textContent = '\u00d7';
    row.appendChild(btn);
  }

  if (opts.before) {
    container.insertBefore(row, opts.before);
  } else {
    container.appendChild(row);
  }

  return row;
}
