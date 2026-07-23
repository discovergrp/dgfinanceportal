/* Discover Group Finance Portal */

const sb = supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

const BOOKING_CATS = {
  airline: 'Airline',
  hotel: 'Hotel',
  transportation: 'Transportation',
  admission: 'Admission fee',
  guide: 'Tour guide',
  tour: 'Tours',
  restaurant: 'Restaurants'
};
const OPS_CATS = {
  office_rental: 'Office rental',
  utilities: 'Utilities',
  salary: 'Employee salary',
  other: 'Other operating'
};
const ALL_CATS = { ...BOOKING_CATS, ...OPS_CATS };

let me = null;
let cache = { vendors: [], clients: [], tours: [] };

/* ---------- helpers ---------- */
const $ = s => document.querySelector(s);
const el = (t, a = {}, ...kids) => {
  const n = document.createElement(t);
  for (const [k, v] of Object.entries(a)) {
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  kids.flat().forEach(c => n.append(c?.nodeType ? c : document.createTextNode(c ?? '')));
  return n;
};
const money = n => new Intl.NumberFormat('en-PH', {
  minimumFractionDigits: 2, maximumFractionDigits: 2
}).format(Number(n || 0));
const short = n => {
  n = Number(n || 0);
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toFixed(0);
};
const dt = d => d ? new Date(d).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
const overdue = r => r.due_date && new Date(r.due_date) < new Date().setHours(0, 0, 0, 0)
  && !['paid', 'settled', 'void', 'written_off'].includes(r.status);
const canWrite = () => ['clerk', 'manager', 'admin'].includes(me?.role);

function notify(host, text, ok) {
  host.innerHTML = '';
  host.append(el('div', { class: 'msg ' + (ok ? 'msg-ok' : 'msg-err') }, text));
}

/* ---------- auth ---------- */
$('#signInBtn').addEventListener('click', signIn);
$('#password').addEventListener('keydown', e => e.key === 'Enter' && signIn());

async function signIn() {
  const msg = $('#loginMsg');
  const email = $('#email').value.trim();
  const password = $('#password').value;
  if (!email || !password) return notify(msg, 'Enter your email and password.', false);

  $('#signInBtn').disabled = true;
  const { error } = await sb.auth.signInWithPassword({ email, password });
  $('#signInBtn').disabled = false;
  if (error) return notify(msg, 'That email and password combination did not match an account.', false);
  boot();
}

$('#signOutBtn').addEventListener('click', async () => {
  await sb.auth.signOut();
  location.reload();
});

async function boot() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return;

  const { data: profile } = await sb.from('profiles')
    .select('full_name, role, active').eq('id', session.user.id).single();

  if (!profile || !profile.active) {
    await sb.auth.signOut();
    return notify($('#loginMsg'),
      'Your account is not active yet. A finance administrator needs to approve it.', false);
  }

  me = profile;
  $('#whoName').textContent = profile.full_name || session.user.email;
  $('#whoRole').textContent = profile.role;
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');

  const [v, c, t] = await Promise.all([
    sb.from('vendors').select('id,name,category').eq('active', true).order('name'),
    sb.from('clients').select('id,name').eq('active', true).order('name'),
    sb.from('tours').select('id,code,title').order('start_date', { ascending: false })
  ]);
  cache = { vendors: v.data || [], clients: c.data || [], tours: t.data || [] };

  go('dashboard');
}

document.querySelectorAll('nav button').forEach(b =>
  b.addEventListener('click', () => {
    document.querySelectorAll('nav button').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    go(b.dataset.view);
  }));

function go(view) {
  const host = $('#view');
  host.innerHTML = '<p class="sub">Loading…</p>';
  ({ dashboard, bookings, operational, receivables, aging, margin, ledger })[view](host);
}

function head(title, sub) {
  return [el('h1', {}, title), el('p', { class: 'sub' }, sub)];
}

/* ---------- dashboard ---------- */
async function dashboard(host) {
  const [pay, rec] = await Promise.all([
    sb.from('v_payables_aging').select('*'),
    sb.from('v_receivables_aging').select('*')
  ]);
  const P = pay.data || [], R = rec.data || [];

  const owed = P.filter(r => r.status !== 'paid').reduce((s, r) => s + Number(r.balance), 0);
  const due = R.filter(r => r.status !== 'settled').reduce((s, r) => s + Number(r.balance), 0);
  const latePay = P.filter(overdue);
  const lateRec = R.filter(overdue);

  const bookingSpend = P.filter(r => r.kind === 'booking').reduce((s, r) => s + Number(r.amount), 0);
  const opsSpend = P.filter(r => r.kind === 'operational').reduce((s, r) => s + Number(r.amount), 0);

  host.innerHTML = '';
  host.append(...head('Dashboard', 'Cash position across payables and receivables.'));

  host.append(el('div', { class: 'stats' },
    stat('Owed to vendors', money(owed), P.filter(r => r.status !== 'paid').length + ' open bills', 'alert'),
    stat('Due from clients', money(due), R.filter(r => r.status !== 'settled').length + ' open invoices', 'good'),
    stat('Net position', money(due - owed), 'receivables less payables'),
    stat('Overdue bills', latePay.length, money(latePay.reduce((s, r) => s + Number(r.balance), 0)) + ' past due', latePay.length ? 'alert' : '')
  ));

  host.append(el('h2', {}, 'Spend by category'));
  const total = bookingSpend + opsSpend || 1;
  const byCat = {};
  P.forEach(r => byCat[r.category] = (byCat[r.category] || 0) + Number(r.amount));
  host.append(el('div', { class: 'split' },
    ...Object.entries(ALL_CATS).map(([k, label]) => {
      const v = byCat[k] || 0;
      return el('div', { class: 'cat' + (OPS_CATS[k] ? ' ops' : '') },
        el('div', { class: 'k' }, label),
        el('div', { class: 'v' }, money(v)),
        el('div', { class: 'track' },
          el('div', { class: 'fill', style: `width:${Math.min(100, v / total * 100)}%` })));
    })
  ));

  host.append(el('h2', {}, 'Needs attention'));
  const flagged = [...latePay.map(r => ({ ...r, _t: 'Payable', _who: r.vendor_name })),
                   ...lateRec.map(r => ({ ...r, _t: 'Receivable', _who: r.client_name }))]
                   .sort((a, b) => new Date(a.due_date) - new Date(b.due_date)).slice(0, 12);
  host.append(table(
    ['Type', 'Party', 'Reference', 'Due', 'Balance'],
    flagged.map(r => [r._t, r._who, r.invoice_no || '—', dt(r.due_date),
      el('span', { class: 'num' }, money(r.balance))]),
    'Nothing overdue. Everything is current.'
  ));
}

function stat(k, v, n, cls = '') {
  return el('div', { class: 'stat ' + cls },
    el('div', { class: 'k' }, k), el('div', { class: 'v' }, v), el('div', { class: 'n' }, n));
}

function table(cols, rows, emptyText) {
  const wrap = el('div', { class: 'panel' });
  if (!rows.length) { wrap.append(el('div', { class: 'empty' }, emptyText)); return wrap; }
  const t = el('table');
  t.append(el('thead', {}, el('tr', {}, ...cols.map(c => el('th', {}, c)))));
  const tb = el('tbody');
  rows.forEach(r => tb.append(el('tr', {}, ...r.map(c =>
    el('td', { class: c?.classList?.contains('num') ? 'num' : '' }, c)))));
  t.append(tb);
  wrap.append(t);
  return wrap;
}

/* ---------- payables ---------- */
async function payablesView(host, kind, title, sub, cats) {
  const { data } = await sb.from('v_payables_aging').select('*')
    .eq('kind', kind).order('due_date', { ascending: true });
  const rows = data || [];

  host.innerHTML = '';
  host.append(...head(title, sub));

  const bar = el('div', { class: 'bar' });
  const fCat = el('select', {}, el('option', { value: '' }, 'All categories'),
    ...Object.entries(cats).map(([k, v]) => el('option', { value: k }, v)));
  const fStatus = el('select', {}, ...['All statuses', 'unpaid', 'partial', 'paid']
    .map((s, i) => el('option', { value: i ? s : '' }, i ? s[0].toUpperCase() + s.slice(1) : s)));
  const fSearch = el('input', { type: 'search', placeholder: 'Search vendor, invoice, description' });
  bar.append(
    el('div', { class: 'field' }, el('label', {}, 'Category'), fCat),
    el('div', { class: 'field' }, el('label', {}, 'Status'), fStatus),
    el('div', { class: 'field grow' }, el('label', {}, 'Search'), fSearch));
  if (canWrite()) bar.append(el('button', { class: 'btn', onclick: () => billForm(kind, cats) }, 'Record a bill'));
  host.append(bar);

  const panel = el('div');
  host.append(panel);

  const draw = () => {
    const q = fSearch.value.toLowerCase();
    const list = rows.filter(r =>
      (!fCat.value || r.category === fCat.value) &&
      (!fStatus.value || r.status === fStatus.value) &&
      (!q || [r.vendor_name, r.invoice_no, r.description, r.tour_code]
        .some(x => (x || '').toLowerCase().includes(q))));

    panel.innerHTML = '';
    const totalDue = list.reduce((s, r) => s + Number(r.balance), 0);
    panel.append(el('p', { class: 'sub' },
      `${list.length} bills · ${money(totalDue)} outstanding`));
    panel.append(table(
      ['Vendor', 'Category', kind === 'booking' ? 'Tour' : 'Description', 'Invoice', 'Due', 'Amount', 'Balance', 'Status', ''],
      list.map(r => [
        r.vendor_name,
        ALL_CATS[r.category] || r.category,
        kind === 'booking' ? (r.tour_code || '—') : (r.description || '—'),
        r.invoice_no || '—',
        dt(r.due_date),
        el('span', { class: 'num' }, money(r.amount)),
        el('span', { class: 'num' }, money(r.balance)),
        el('span', { class: 'tag t-' + (overdue(r) ? 'overdue' : r.status) },
          overdue(r) ? 'Overdue' : r.status),
        canWrite() && r.status !== 'paid'
          ? el('button', { class: 'btn btn-ghost', onclick: () => payForm(r, 'out') }, 'Pay')
          : ''
      ]),
      'No bills recorded yet.'));
  };
  [fCat, fStatus].forEach(x => x.addEventListener('change', draw));
  fSearch.addEventListener('input', draw);
  draw();
}

const bookings = h => payablesView(h, 'booking', 'Tour bookings',
  'Supplier costs tied to a tour — flights, hotels, transport, admissions, guides, restaurants.', BOOKING_CATS);
const operational = h => payablesView(h, 'operational', 'Operational expense',
  'Running costs of the business — rent, utilities, payroll and general overhead.', OPS_CATS);

/* ---------- receivables ---------- */
async function receivables(host) {
  const { data } = await sb.from('v_receivables_aging').select('*').order('due_date');
  const rows = data || [];

  host.innerHTML = '';
  host.append(...head('Client invoices', 'Money billed to agencies, corporates and direct clients.'));

  const bar = el('div', { class: 'bar' });
  const fStatus = el('select', {}, ...['All statuses', 'open', 'partial', 'settled']
    .map((s, i) => el('option', { value: i ? s : '' }, i ? s[0].toUpperCase() + s.slice(1) : s)));
  const fSearch = el('input', { type: 'search', placeholder: 'Search client, invoice, tour' });
  bar.append(
    el('div', { class: 'field' }, el('label', {}, 'Status'), fStatus),
    el('div', { class: 'field grow' }, el('label', {}, 'Search'), fSearch));
  if (canWrite()) bar.append(el('button', { class: 'btn', onclick: invoiceForm }, 'Raise an invoice'));
  host.append(bar);

  const panel = el('div');
  host.append(panel);

  const draw = () => {
    const q = fSearch.value.toLowerCase();
    const list = rows.filter(r =>
      (!fStatus.value || r.status === fStatus.value) &&
      (!q || [r.client_name, r.invoice_no, r.tour_code, r.description]
        .some(x => (x || '').toLowerCase().includes(q))));
    panel.innerHTML = '';
    panel.append(el('p', { class: 'sub' },
      `${list.length} invoices · ${money(list.reduce((s, r) => s + Number(r.balance), 0))} outstanding`));
    panel.append(table(
      ['Client', 'Tour', 'Invoice', 'Issued', 'Due', 'Amount', 'Balance', 'Status', ''],
      list.map(r => [
        r.client_name, r.tour_code || '—', r.invoice_no || '—',
        dt(r.invoice_date), dt(r.due_date),
        el('span', { class: 'num' }, money(r.amount)),
        el('span', { class: 'num' }, money(r.balance)),
        el('span', { class: 'tag t-' + (overdue(r) ? 'overdue' : r.status) },
          overdue(r) ? 'Overdue' : r.status),
        canWrite() && r.status !== 'settled'
          ? el('button', { class: 'btn btn-ghost', onclick: () => payForm(r, 'in') }, 'Receive')
          : ''
      ]),
      'No invoices raised yet.'));
  };
  fStatus.addEventListener('change', draw);
  fSearch.addEventListener('input', draw);
  draw();
}

/* ---------- reports ---------- */
async function aging(host) {
  const [p, r] = await Promise.all([
    sb.from('v_payables_aging').select('*'),
    sb.from('v_receivables_aging').select('*')
  ]);
  host.innerHTML = '';
  host.append(...head('Aging report', 'How long money has been sitting unpaid, on both sides of the book.'));

  const buckets = ['current', '1-30', '31-60', '61-90', '90+'];
  const sum = (rows, b) => rows.filter(x => x.aging_bucket === b)
    .reduce((s, x) => s + Number(x.balance), 0);

  const section = (label, rows) => {
    host.append(el('h2', {}, label));
    host.append(el('div', { class: 'aging' },
      ...buckets.map((b, i) => el('div', { class: 'age b' + (i + 1) },
        el('div', { class: 'k' }, b === 'current' ? 'Not yet due' : b + ' days'),
        el('div', { class: 'v' }, money(sum(rows, b)))))));
  };
  section('Payables', (p.data || []).filter(x => x.status !== 'paid'));
  section('Receivables', (r.data || []).filter(x => x.status !== 'settled'));

  host.append(el('h2', {}, 'Oldest outstanding'));
  const old = [...(p.data || []).filter(x => x.aging_bucket === '90+')
    .map(x => ({ w: x.vendor_name, t: 'Owed', d: x.due_date, b: x.balance })),
  ...(r.data || []).filter(x => x.aging_bucket === '90+')
    .map(x => ({ w: x.client_name, t: 'Due in', d: x.due_date, b: x.balance }))]
    .sort((a, b) => new Date(a.d) - new Date(b.d));
  host.append(table(['Direction', 'Party', 'Due', 'Balance'],
    old.map(x => [x.t, x.w, dt(x.d), el('span', { class: 'num' }, money(x.b))]),
    'Nothing has aged past 90 days.'));
}

async function margin(host) {
  const { data } = await sb.from('v_tour_margin').select('*').order('start_date', { ascending: false });
  const rows = data || [];
  host.innerHTML = '';
  host.append(...head('Tour margin', 'Revenue billed against booking costs, per tour.'));

  const rev = rows.reduce((s, r) => s + Number(r.revenue), 0);
  const cost = rows.reduce((s, r) => s + Number(r.cost), 0);
  host.append(el('div', { class: 'stats' },
    stat('Revenue', money(rev), rows.length + ' tours'),
    stat('Booking cost', money(cost), 'supplier payables'),
    stat('Gross margin', money(rev - cost),
      rev ? ((rev - cost) / rev * 100).toFixed(1) + '% of revenue' : '—',
      rev - cost >= 0 ? 'good' : 'alert')));

  host.append(el('h2', {}, 'By tour'));
  host.append(table(
    ['Code', 'Tour', 'Departs', 'Pax', 'Revenue', 'Cost', 'Margin', '%'],
    rows.map(r => {
      const m = Number(r.margin), rv = Number(r.revenue);
      return [r.code, r.title, dt(r.start_date), r.pax,
        el('span', { class: 'num' }, money(r.revenue)),
        el('span', { class: 'num' }, money(r.cost)),
        el('span', { class: 'num' }, money(m)),
        el('span', { class: 'num' }, rv ? (m / rv * 100).toFixed(1) + '%' : '—')];
    }),
    'No tours recorded yet.'));
}

async function ledger(host) {
  const { data } = await sb.from('payments').select('*').order('paid_on', { ascending: false }).limit(300);
  const rows = data || [];
  host.innerHTML = '';
  host.append(...head('Payment ledger', 'Every payment in and out. Append-only — entries cannot be edited or deleted.'));
  host.append(table(
    ['Date', 'Direction', 'Method', 'Reference', 'Amount'],
    rows.map(r => [dt(r.paid_on), r.direction === 'out' ? 'Paid out' : 'Received',
      r.method || '—', r.reference || '—',
      el('span', { class: 'num' }, money(r.amount))]),
    'No payments recorded yet.'));
}

/* ---------- forms ---------- */
function modal(title, body, onSave) {
  const host = $('#modalHost');
  const msg = el('div');
  const close = () => host.innerHTML = '';
  const saveBtn = el('button', { class: 'btn' }, 'Save');
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    const err = await onSave();
    saveBtn.disabled = false;
    if (err) notify(msg, err, false);
    else { close(); go(document.querySelector('nav button.on').dataset.view); }
  });
  host.innerHTML = '';
  host.append(el('div', { class: 'veil', onclick: e => e.target.classList.contains('veil') && close() },
    el('div', { class: 'modal' }, el('h3', {}, title), msg, body,
      el('div', { class: 'modal-foot' },
        el('button', { class: 'btn btn-ghost', onclick: close }, 'Cancel'), saveBtn))));
}

function field(label, node) {
  return el('div', { class: 'field' }, el('label', {}, label), node);
}

function billForm(kind, cats) {
  const vendor = el('select', {}, el('option', { value: '' }, 'Select a vendor'),
    ...cache.vendors.map(v => el('option', { value: v.id }, v.name)));
  const cat = el('select', {}, ...Object.entries(cats).map(([k, v]) => el('option', { value: k }, v)));
  const tour = el('select', {}, el('option', { value: '' }, 'Not tied to a tour'),
    ...cache.tours.map(t => el('option', { value: t.id }, `${t.code} — ${t.title}`)));
  const inv = el('input', { type: 'text', placeholder: 'e.g. INV-4471' });
  const amt = el('input', { type: 'number', step: '0.01', min: '0' });
  const idate = el('input', { type: 'date', value: new Date().toISOString().slice(0, 10) });
  const ddate = el('input', { type: 'date' });
  const desc = el('textarea', { rows: '2', placeholder: 'What is this bill for?' });

  const body = el('div', {},
    field('Vendor', vendor),
    el('div', { class: 'grid2' }, field('Category', cat), field('Invoice number', inv)),
    kind === 'booking' ? field('Tour', tour) : '',
    el('div', { class: 'grid2' }, field('Amount', amt), field('Due date', ddate)),
    field('Invoice date', idate),
    field('Description', desc));

  modal(kind === 'booking' ? 'Record a booking bill' : 'Record an operating expense', body, async () => {
    if (!vendor.value) return 'Choose a vendor.';
    if (!Number(amt.value) || Number(amt.value) <= 0) return 'Enter an amount greater than zero.';
    const { error } = await sb.from('payables').insert({
      vendor_id: vendor.value, kind, category: cat.value,
      tour_id: kind === 'booking' && tour.value ? tour.value : null,
      invoice_no: inv.value || null, amount: Number(amt.value),
      invoice_date: idate.value, due_date: ddate.value || null,
      description: desc.value || null
    });
    return error ? 'Could not save this bill: ' + error.message : null;
  });
}

function invoiceForm() {
  const client = el('select', {}, el('option', { value: '' }, 'Select a client'),
    ...cache.clients.map(c => el('option', { value: c.id }, c.name)));
  const tour = el('select', {}, el('option', { value: '' }, 'Not tied to a tour'),
    ...cache.tours.map(t => el('option', { value: t.id }, `${t.code} — ${t.title}`)));
  const inv = el('input', { type: 'text', placeholder: 'e.g. SI-2026-118' });
  const amt = el('input', { type: 'number', step: '0.01', min: '0' });
  const idate = el('input', { type: 'date', value: new Date().toISOString().slice(0, 10) });
  const ddate = el('input', { type: 'date' });
  const desc = el('textarea', { rows: '2', placeholder: 'What is being billed?' });

  const body = el('div', {},
    field('Client', client), field('Tour', tour),
    el('div', { class: 'grid2' }, field('Invoice number', inv), field('Amount', amt)),
    el('div', { class: 'grid2' }, field('Invoice date', idate), field('Due date', ddate)),
    field('Description', desc));

  modal('Raise a client invoice', body, async () => {
    if (!client.value) return 'Choose a client.';
    if (!Number(amt.value) || Number(amt.value) <= 0) return 'Enter an amount greater than zero.';
    const { error } = await sb.from('receivables').insert({
      client_id: client.value, tour_id: tour.value || null,
      invoice_no: inv.value || null, amount: Number(amt.value),
      invoice_date: idate.value, due_date: ddate.value || null,
      description: desc.value || null
    });
    return error ? 'Could not raise this invoice: ' + error.message : null;
  });
}

function payForm(row, direction) {
  const bal = Number(row.balance);
  const amt = el('input', { type: 'number', step: '0.01', min: '0.01', value: bal.toFixed(2) });
  const method = el('select', {}, ...['bank', 'cash', 'card', 'cheque', 'online']
    .map(m => el('option', { value: m }, m[0].toUpperCase() + m.slice(1))));
  const ref = el('input', { type: 'text', placeholder: 'Transaction or cheque number' });
  const when = el('input', { type: 'date', value: new Date().toISOString().slice(0, 10) });

  const body = el('div', {},
    el('p', { class: 'sub' },
      `${direction === 'out' ? row.vendor_name : row.client_name} · balance ${money(bal)}`),
    el('div', { class: 'grid2' }, field('Amount', amt), field('Date', when)),
    el('div', { class: 'grid2' }, field('Method', method), field('Reference', ref)));

  modal(direction === 'out' ? 'Record a payment out' : 'Record a payment received', body, async () => {
    const a = Number(amt.value);
    if (!a || a <= 0) return 'Enter an amount greater than zero.';
    if (a > bal) return `That is more than the ${money(bal)} outstanding.`;
    const { error } = await sb.from('payments').insert({
      [direction === 'out' ? 'payable_id' : 'receivable_id']: row.id,
      direction, amount: a, method: method.value,
      reference: ref.value || null, paid_on: when.value
    });
    return error ? 'Could not record this payment: ' + error.message : null;
  });
}

/* ---------- start ---------- */
boot();
