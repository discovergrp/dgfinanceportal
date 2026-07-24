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
  office: 'Office expenses',
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
  const VIEWS = {
    dashboard,
    // Booking department
    bk_tour: h => bookingsByKind(h, 'tour', 'Tour Bookings',
      'Land packages and full tour arrangements.'),
    bk_air: h => bookingsByKind(h, 'airline', 'Airline Bookings',
      'Group fares and individual ticketing.'),
    bk_hotel: h => bookingsByKind(h, 'hotel', 'Hotel Bookings',
      'Accommodation across every route.'),
    bk_land: h => bookingsByKind(h, 'transportation', 'Land Arrangements',
      'Coaches, transfers and ground transport.'),
    bk_optional: h => bookingsByKind(h, 'admission', 'Optional Tours',
      'Excursions, admissions and add-on experiences.'),
    suppliers, bk_overview: bookingsOverview, documents,
    // Payables
    pay_invoices: h => payablesView(h, 'booking', 'Supplier Invoices',
      'Bills from suppliers against tour bookings.', BOOKING_CATS),
    pay_po: purchaseOrders,
    pay_schedule: paymentSchedule,
    pay_made: h => paymentsList(h, 'out', 'Payments Made',
      'Everything paid out to suppliers.'),
    // Operations
    op_all: h => opsView(h, null, 'Operational Expenses',
      'Day-to-day running costs of the company.'),
    op_utilities: h => opsView(h, 'utilities', 'Utilities',
      'Electricity, water, internet and telecoms.'),
    op_rentals: h => opsView(h, 'office_rental', 'Rentals',
      'Office and property rental.'),
    op_salaries: h => opsView(h, 'salary', 'Salaries & Wages',
      'Payroll and contractor fees.'),
    op_office: h => opsView(h, 'office', 'Office Expenses',
      'Supplies, equipment and office running costs.'),
    op_other: h => opsView(h, 'other', 'Other Expenses',
      'Anything outside the standard categories.'),
    // Receivables
    ar_client: h => receivablesView(h, 'client', 'Client Invoices',
      'Money billed to agencies, corporates and direct clients.'),
    ar_visa: h => receivablesView(h, 'visa', 'Visa Service Invoices',
      'Visa processing fees and appointment fees.'),
    ar_received: h => paymentsList(h, 'in', 'Payments Received',
      'Everything collected from clients.'),
    ar_overview: collectionsOverview,
    // Reports
    aging, margin, ledger, custom: customReports
  };
  (VIEWS[view] || dashboard)(host);
}

function head(title, sub) {
  return [el('h1', {}, title), el('p', { class: 'sub' }, sub)];
}

/* ---------- dashboard (department hub) ---------- */

const DEPTS = [
  {
    key: 'booking', title: 'Booking Department', tint: '#e6eefa', fg: '#1565d8', icon: '▣',
    sub: 'Manage all bookings and services for tour packages.',
    more: 'View all bookings', moreView: 'bk_overview',
    links: [
      ['bk_tour', '▣', 'Tour Bookings'], ['bk_land', '▬', 'Land Arrangements'],
      ['bk_air', '✈', 'Airline Bookings'], ['bk_optional', '◎', 'Optional Tours'],
      ['bk_hotel', '▤', 'Hotel Bookings'], ['suppliers', '◈', 'Booking Suppliers']
    ]
  },
  {
    key: 'payables', title: 'Payables (Trade)', tint: '#e3f3ec', fg: '#0f8a5f', icon: '▤',
    sub: 'Manage all payables to suppliers for bookings.',
    more: 'View all payables', moreView: 'pay_invoices',
    links: [
      ['pay_invoices', '▤', 'Supplier Invoices'], ['pay_schedule', '▦', 'Payment Schedule'],
      ['pay_po', '▣', 'Purchase Orders'], ['pay_made', '✓', 'Payments Made']
    ]
  },
  {
    key: 'ops', title: 'Finance (Operations)', tint: '#fdeae6', fg: '#c0442a', icon: '▥',
    sub: 'Manage day-to-day operational expenses of the company.',
    more: 'View all expenses', moreView: 'op_all',
    links: [
      ['op_all', '▤', 'Operational Expenses'], ['op_salaries', '◔', 'Salaries & Wages'],
      ['op_utilities', '⚡', 'Utilities'], ['op_office', '▢', 'Office Expenses'],
      ['op_rentals', '⌂', 'Rentals'], ['op_other', '⋯', 'Other Expenses']
    ]
  },
  {
    key: 'receivables', title: 'Receivables', tint: '#ece7fb', fg: '#5b3fd4', icon: '◉',
    sub: 'Manage invoices and collections.',
    more: 'View all receivables', moreView: 'ar_overview',
    note: 'Visa Service Invoices include all visa processing fees and appointment fees.',
    links: [
      ['ar_client', '▤', 'Client Invoices'], ['ar_received', '◉', 'Payments Received'],
      ['ar_visa', '▣', 'Visa Service Invoices'], ['ar_overview', '▥', 'Collections Overview']
    ]
  },
  {
    key: 'reports', title: 'Reports', tint: '#fdf0e0', fg: '#c47a12', icon: '◕',
    sub: 'View financial reports and insights.',
    more: 'View all reports', moreView: 'aging',
    links: [
      ['aging', '◕', 'Aging Report'], ['ledger', '▤', 'Payment Ledger'],
      ['margin', '◢', 'Tour Margin'], ['custom', '▦', 'Custom Reports']
    ]
  }
];

function nav(view) {
  const btn = document.querySelector(`nav button[data-view="${view}"]`);
  if (btn) btn.click();
}

async function dashboard(host) {
  host.innerHTML = '';
  const who = (me?.full_name || '').trim().split(' ')[0]
    || (me?.role ? me.role[0].toUpperCase() + me.role.slice(1) : 'there');
  host.append(el('h1', { class: 'welcome' }, `Welcome back, ${who}`),
    el('p', { class: 'sub' }, "Here's what's happening with your finances today."));

  const hub = el('div', { class: 'hub' });
  host.append(hub);

  // Render the shell straight away, then fill in counts as they arrive.
  const cardOf = d => {
    const links = el('div', { class: 'hlinks' });
    d.links.forEach(([view, ico, label]) => {
      const count = el('span', { class: 'cnt' });
      links.append(el('button', { class: 'hlink', onclick: () => nav(view) },
        el('span', { class: 'hi' }, ico), label, count,
        el('span', { class: 'chev' }, '›')));
      d._counts = d._counts || {};
      d._counts[view] = count;
    });
    const card = el('div', { class: 'hcard' },
      el('div', { class: 'hhead' },
        el('div', { class: 'hicon', style: `background:${d.tint};color:${d.fg}` }, d.icon),
        el('div', {},
          el('h3', { style: `color:${d.fg}` }, d.title),
          el('p', { class: 'hsub' }, d.sub))),
      links,
      el('button', { class: 'hmore', style: `color:${d.fg}`, onclick: () => nav(d.moreView) },
        d.more, '›'));
    if (d.note) card.append(el('div', { class: 'hnote' }, el('span', {}, 'ⓘ'), d.note));
    return card;
  };
  DEPTS.forEach(d => hub.append(cardOf(d)));

  // Live counts, aggregated in the database so the 1,000-row cap can't
  // silently truncate a total.
  const [dp, dr, dc, bk] = await Promise.all([
    sb.from('v_dashboard_payables').select('*'),
    sb.from('v_dashboard_receivables').select('*'),
    sb.from('v_dashboard_counts').select('*').single(),
    sb.from('bookings').select('vendor_id,status,service_date')
  ]);
  const P = dp.data || [], R = dr.data || [], C = dc.data || {}, B = bk.data || [];

  const sum = (rows, col) => rows.reduce((s, r) => s + Number(r[col] || 0), 0);
  const set = (view, txt) => {
    DEPTS.forEach(d => { if (d._counts?.[view] && txt) d._counts[view].textContent = txt; });
  };

  // Booking department — live bookings per supplier category
  const live = b => ['enquiry', 'quoted', 'confirmed'].includes(b.status);
  const vend = cache.vendors.reduce((m, v) => (m[v.id] = v.category, m), {});
  const byCat = c => B.filter(b => live(b) && vend[b.vendor_id] === c).length;
  set('bk_tour', byCat('tour') || '');
  set('bk_air', byCat('airline') || '');
  set('bk_hotel', byCat('hotel') || '');
  set('bk_land', byCat('transportation') || '');
  set('bk_optional', byCat('admission') || '');
  set('suppliers', C.vendors || '');

  // Payables
  const book = P.filter(r => r.kind === 'booking');
  const owed = sum(book, 'open_balance');
  set('pay_invoices', owed ? money(owed) : '');
  set('pay_po', C.open_pos || '');
  const overdue = sum(book, 'overdue_count');
  set('pay_schedule', overdue ? `${overdue} overdue` : (sum(book, 'open_count') || ''));
  set('pay_made', C.payments_out || '');

  // Operations
  const ops = P.filter(r => r.kind === 'operational');
  const opSum = c => {
    const t = sum(ops.filter(r => r.category === c), 'open_balance');
    return t ? money(t) : '';
  };
  const opAll = sum(ops, 'open_balance');
  set('op_all', opAll ? money(opAll) : '');
  set('op_utilities', opSum('utilities'));
  set('op_rentals', opSum('office_rental'));
  set('op_salaries', opSum('salary'));
  set('op_office', opSum('office'));
  set('op_other', opSum('other'));

  // Receivables
  const rt = t => sum(R.filter(r => r.invoice_type === t), 'open_balance');
  set('ar_client', rt('client') ? money(rt('client')) : '');
  set('ar_visa', rt('visa') ? money(rt('visa')) : '');
  set('ar_received', C.payments_in || '');
  const totalDue = sum(R, 'open_balance');
  set('ar_overview', totalDue ? money(totalDue) : '');

  // Reports
  set('aging', overdue ? `${overdue} overdue` : '');
  set('margin', C.tours || '');
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
    .eq('kind', kind).order('due_date', { ascending: true }).range(0, 4999);
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


/* ---------- receivables ---------- */
async function receivablesView(host, type, title, sub) {
  const { data } = await sb.from('v_receivables_aging').select('*').order('due_date').range(0, 4999);
  const rows = (data || []).filter(r => !type || (r.invoice_type || 'client') === type);

  host.innerHTML = '';
  host.append(...head(title, sub));

  const bar = el('div', { class: 'bar' });
  const fStatus = el('select', {}, ...['All statuses', 'open', 'partial', 'settled']
    .map((s, i) => el('option', { value: i ? s : '' }, i ? s[0].toUpperCase() + s.slice(1) : s)));
  const fSearch = el('input', { type: 'search', placeholder: 'Search client, invoice, tour' });
  bar.append(
    el('div', { class: 'field' }, el('label', {}, 'Status'), fStatus),
    el('div', { class: 'field grow' }, el('label', {}, 'Search'), fSearch));
  if (canWrite()) bar.append(el('button', { class: 'btn', onclick: () => invoiceForm(type) }, 'Raise an invoice'));
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

/* ---------- suppliers ---------- */

const VENDOR_CATS = {
  airline: 'Airline',
  hotel: 'Hotel',
  transportation: 'Transportation',
  admission: 'Admission / attractions',
  guide: 'Tour guide',
  tour: 'Tour operator',
  restaurant: 'Restaurant',
  landlord: 'Landlord',
  utility: 'Utility',
  payroll: 'Payroll',
  other: 'Other'
};

const BOOKING_STATUS = ['enquiry', 'quoted', 'confirmed', 'delivered', 'cancelled'];

async function suppliers(host) {
  const [{ data: vend, error }, { data: bks }] = await Promise.all([
    sb.from('v_vendor_summary').select('*').order('name'),
    sb.from('bookings').select('*').order('service_date')
  ]);
  const rows = vend || [];
  const bookings = bks || [];

  host.innerHTML = '';
  host.append(...head('Suppliers',
    'Everyone the booking department buys from — hotels, airlines, transport, restaurants and guides.'));

  if (error) {
    host.append(el('div', { class: 'msg msg-err' }, 'Could not load suppliers: ' + error.message));
    return;
  }

  const counts = {}, countries = {};
  rows.forEach(r => {
    counts[r.category] = (counts[r.category] || 0) + 1;
    if (r.country) countries[r.country] = (countries[r.country] || 0) + 1;
  });
  const liveBookings = rows.reduce((s, r) => s + Number(r.upcoming_bookings || 0), 0);

  host.append(el('div', { class: 'stats' },
    stat('Suppliers', rows.length, Object.keys(countries).length + ' countries'),
    stat('Hotels', counts.hotel || 0, 'from the booking masterlist'),
    stat('Live bookings', liveBookings, 'enquiries, quotes and confirmed',
      liveBookings ? 'good' : ''),
    stat('Contracted rates', rows.reduce((s, r) => s + Number(r.rate_count || 0), 0),
      rows.filter(r => r.email).length + ' suppliers with email')));

  const bar = el('div', { class: 'bar' });
  const fCat = el('select', {}, el('option', { value: '' }, 'All categories'),
    ...Object.entries(VENDOR_CATS).filter(([k]) => counts[k])
      .map(([k, v]) => el('option', { value: k }, `${v} (${counts[k]})`)));
  const fCountry = el('select', {}, el('option', { value: '' }, 'All countries'),
    ...Object.entries(countries).sort((a, b) => a[0].localeCompare(b[0]))
      .map(([k, n]) => el('option', { value: k }, `${k} (${n})`)));
  const fCity = el('select', {}, el('option', { value: '' }, 'All cities'));
  const fLive = el('select', {},
    el('option', { value: '' }, 'All suppliers'),
    el('option', { value: 'live' }, 'With live bookings'),
    el('option', { value: 'owed' }, 'With money owed'));
  const fSearch = el('input', { type: 'search', placeholder: 'Search name, contact, reference' });

  // City list follows whichever country is selected.
  const refreshCities = () => {
    const pool = rows.filter(r => !fCountry.value || r.country === fCountry.value);
    const cities = {};
    pool.forEach(r => { if (r.city) cities[r.city] = (cities[r.city] || 0) + 1; });
    fCity.innerHTML = '';
    fCity.append(el('option', { value: '' }, 'All cities'),
      ...Object.entries(cities).sort((a, b) => a[0].localeCompare(b[0]))
        .map(([k, n]) => el('option', { value: k }, `${k} (${n})`)));
  };
  refreshCities();

  bar.append(
    el('div', { class: 'field' }, el('label', {}, 'Country'), fCountry),
    el('div', { class: 'field' }, el('label', {}, 'City'), fCity),
    el('div', { class: 'field' }, el('label', {}, 'Category'), fCat),
    el('div', { class: 'field' }, el('label', {}, 'Show'), fLive),
    el('div', { class: 'field grow' }, el('label', {}, 'Search'), fSearch));
  if (canWrite()) bar.append(el('button', { class: 'btn', onclick: () => vendorForm() }, 'Add supplier'));
  host.append(bar);

  const panel = el('div');
  host.append(panel);

  const draw = () => {
    const q = fSearch.value.toLowerCase();
    const list = rows.filter(r =>
      (!fCountry.value || r.country === fCountry.value) &&
      (!fCity.value || r.city === fCity.value) &&
      (!fCat.value || r.category === fCat.value) &&
      (fLive.value !== 'live' || Number(r.upcoming_bookings) > 0) &&
      (fLive.value !== 'owed' || Number(r.outstanding) > 0) &&
      (!q || [r.name, r.email, r.phone, r.contact_person, r.city, r.notes]
        .some(x => (x || '').toLowerCase().includes(q))));

    panel.innerHTML = '';
    panel.append(el('p', { class: 'sub' },
      `${list.length} suppliers · ${list.reduce((s, r) => s + Number(r.upcoming_bookings || 0), 0)} live bookings`));

    panel.append(table(
      ['Supplier', 'Location', 'Category', 'Email', 'Phone', 'Contact', 'Rates', 'Bookings', 'Outstanding', ''],
      list.map(r => {
        const mine = bookings.filter(b => b.vendor_id === r.id
          && ['enquiry', 'quoted', 'confirmed'].includes(b.status));
        return [
          r.name,
          el('span', {}, r.city || '—',
            r.country ? el('div', { style: 'color:var(--muted);font-size:12px' }, r.country) : ''),
          VENDOR_CATS[r.category] || r.category,
          r.email
            ? el('a', { href: 'mailto:' + r.email, style: 'font-size:13px' }, r.email)
            : el('span', { style: 'color:var(--muted)' }, '—'),
          el('span', { style: 'font-size:13px' }, r.phone || '—'),
          el('span', { style: 'font-size:13px' }, r.contact_person || '—'),
          Number(r.rate_count)
            ? el('button', {
                class: 'btn btn-ghost', style: 'padding:4px 10px;font-size:13px',
                onclick: () => supplierDetail(r)
              }, `${r.rate_count} rate${r.rate_count > 1 ? 's' : ''}`)
            : el('span', { style: 'color:var(--muted)' }, '—'),
          mine.length
            ? el('button', {
                class: 'btn btn-ghost',
                style: 'padding:4px 10px;font-size:13px',
                onclick: () => showBookings(r, mine)
              }, `${mine.length} live`)
            : el('span', { style: 'color:var(--muted)' }, '—'),
          el('span', { class: 'num' },
            Number(r.outstanding) ? money(r.outstanding) : '—'),
          el('button', { class: 'btn btn-ghost', onclick: () => supplierDetail(r) }, 'Open')
        ];
      }),
      'No suppliers match those filters.'));
  };

  fCountry.addEventListener('change', () => { refreshCities(); draw(); });
  [fCity, fCat, fLive].forEach(x => x.addEventListener('change', draw));
  fSearch.addEventListener('input', draw);
  draw();
}

function showBookings(vendor, list) {
  const body = el('div', {},
    el('p', { class: 'sub' }, `${vendor.name}${vendor.city ? ' · ' + vendor.city : ''}`),
    table(['Reference', 'Service', 'Date', 'Pax', 'Status'],
      list.map(b => [
        b.reference || '—',
        b.description || '—',
        dt(b.service_date),
        b.pax ?? '—',
        el('span', { class: 'tag t-' + (b.status === 'confirmed' ? 'paid' : 'partial') }, b.status)
      ]), 'No live bookings.'),
    ...list.filter(b => b.notes).map(b =>
      el('p', { class: 'sub', style: 'margin-top:12px' },
        el('strong', {}, (b.reference || 'Note') + ': '), b.notes)));

  const host = $('#modalHost');
  const close = () => host.innerHTML = '';
  host.innerHTML = '';
  host.append(el('div', { class: 'veil', onclick: e => e.target.classList.contains('veil') && close() },
    el('div', { class: 'modal' }, el('h3', {}, 'Live bookings'), body,
      el('div', { class: 'modal-foot' },
        el('button', { class: 'btn', onclick: close }, 'Close')))));
}

function bookingForm(vendor) {
  const ref = el('input', { type: 'text', placeholder: 'e.g. GEASYO7, SEP11-LON' });
  const desc = el('input', { type: 'text', placeholder: 'What is being booked' });
  const date = el('input', { type: 'date' });
  const pax = el('input', { type: 'number', min: '0' });
  const status = el('select', {}, ...BOOKING_STATUS.map(s =>
    el('option', { value: s }, s[0].toUpperCase() + s.slice(1))));
  const amount = el('input', { type: 'number', step: '0.01', min: '0' });
  const cur = el('select', {}, ...['EUR', 'PHP', 'GBP', 'USD', 'CHF', 'NOK', 'SEK', 'DKK']
    .map(c => el('option', { value: c }, c)));
  const tour = el('select', {}, el('option', { value: '' }, 'Not tied to a tour'),
    ...cache.tours.map(t => el('option', { value: t.id }, `${t.code} — ${t.title}`)));
  const notes = el('textarea', { rows: '2', placeholder: 'Capacity limits, deadlines, anything worth remembering' });

  const body = el('div', {},
    el('p', { class: 'sub' }, vendor.name),
    el('div', { class: 'grid2' }, field('Reference', ref), field('Status', status)),
    field('Description', desc),
    el('div', { class: 'grid2' }, field('Service date', date), field('Pax', pax)),
    el('div', { class: 'grid2' }, field('Amount (optional)', amount), field('Currency', cur)),
    field('Tour', tour),
    field('Notes', notes));

  modal('Add a booking', body, async () => {
    if (!desc.value.trim() && !ref.value.trim()) return 'Enter a reference or description.';
    const { error } = await sb.from('bookings').insert({
      vendor_id: vendor.id,
      reference: ref.value.trim() || null,
      description: desc.value.trim() || null,
      service_date: date.value || null,
      pax: pax.value ? Number(pax.value) : null,
      status: status.value,
      amount: amount.value ? Number(amount.value) : null,
      currency: cur.value,
      tour_id: tour.value || null,
      notes: notes.value.trim() || null
    });
    return error ? 'Could not save this booking: ' + error.message : null;
  });
}

function vendorForm(existing) {
  if (existing) return supplierDetail(existing);
  return vendorEditForm(null);
}

/* Full-screen supplier record: details, contracted rates, bookings. */
async function supplierDetail(vendor) {
  const host = $('#modalHost');
  const close = () => host.innerHTML = '';

  const [{ data: rates }, { data: bks }] = await Promise.all([
    sb.from('rate_contracts').select('*').eq('vendor_id', vendor.id)
      .order('valid_to', { ascending: false, nullsFirst: false }),
    sb.from('bookings').select('*').eq('vendor_id', vendor.id).order('service_date')
  ]);

  const panes = {};
  const body = el('div', {});
  const tabs = el('div', { class: 'tabs' });
  const paneHost = el('div');

  const show = key => {
    Object.entries(panes).forEach(([k, p]) => p.style.display = k === key ? '' : 'none');
    [...tabs.children].forEach(b => b.classList.toggle('on', b.dataset.k === key));
  };
  const addTab = (key, label, node) => {
    panes[key] = node;
    node.style.display = 'none';
    paneHost.append(node);
    tabs.append(el('button', { class: 'tab', 'data-k': key, onclick: () => show(key) }, label));
  };

  /* ---- details ---- */
  const detail = el('div', {});
  const rowsOf = [
    ['Category', VENDOR_CATS[vendor.category] || vendor.category],
    ['Location', [vendor.city, vendor.country].filter(Boolean).join(', ') || '—'],
    ['Email', vendor.email || '—'],
    ['Phone', vendor.phone || '—'],
    ['Contact person', vendor.contact_person || '—'],
    ['Payment terms', vendor.terms_days + ' days'],
    ['Status', vendor.active === false ? 'Inactive' : 'Active']
  ];
  const dl = el('div', { class: 'kv' });
  rowsOf.forEach(([k, v]) => dl.append(
    el('div', { class: 'kv-k' }, k),
    el('div', { class: 'kv-v' }, k === 'Email' && vendor.email
      ? el('a', { href: 'mailto:' + vendor.email }, vendor.email) : v)));
  detail.append(dl);
  if (vendor.notes) detail.append(el('p', { class: 'sub', style: 'margin-top:14px' }, vendor.notes));
  if (canWrite()) detail.append(el('button', {
    class: 'btn', style: 'margin-top:18px',
    onclick: () => { close(); vendorEditForm(vendor); }
  }, 'Edit details'));
  addTab('detail', 'Details', detail);

  /* ---- contracted rates ---- */
  const ratePane = el('div', {});
  const drawRates = () => {
    ratePane.innerHTML = '';
    if (canWrite()) ratePane.append(el('button', {
      class: 'btn', style: 'margin-bottom:14px',
      onclick: () => { close(); rateForm(vendor); }
    }, 'Add contracted rate'));
    ratePane.append(table(
      ['Title', 'Type', 'Valid', 'Rate detail', 'File / link', ''],
      (rates || []).map(r => {
        const expired = r.valid_to && new Date(r.valid_to) < new Date().setHours(0, 0, 0, 0);
        return [
          el('span', {}, r.title,
            expired ? el('div', { class: 'tag t-overdue', style: 'margin-top:4px' }, 'Expired') : ''),
          (r.rate_type || '').replace('_', ' '),
          r.valid_from || r.valid_to
            ? `${r.valid_from ? dt(r.valid_from) : '—'} → ${r.valid_to ? dt(r.valid_to) : 'open'}`
            : '—',
          el('span', { style: 'font-size:13px;color:var(--muted)' }, r.rate_detail || '—'),
          r.storage_path
            ? el('button', {
                class: 'btn btn-ghost', style: 'padding:4px 10px;font-size:13px',
                onclick: () => openRateFile(r)
              }, r.file_name || 'Open file')
            : r.url
              ? el('a', { href: r.url, target: '_blank', style: 'font-size:13px' }, 'Open link')
              : el('span', { style: 'color:var(--muted)' }, '—'),
          canWrite()
            ? el('button', {
                class: 'btn btn-ghost',
                onclick: () => { close(); rateForm(vendor, r); }
              }, 'Edit')
            : ''
        ];
      }),
      'No contracted rates recorded yet.'));
  };
  drawRates();
  addTab('rates', `Contracted rates (${(rates || []).length})`, ratePane);

  /* ---- bookings ---- */
  const bkPane = el('div', {});
  if (canWrite()) bkPane.append(el('button', {
    class: 'btn', style: 'margin-bottom:14px',
    onclick: () => { close(); bookingForm(vendor); }
  }, 'Add booking'));
  bkPane.append(table(
    ['Reference', 'Service', 'Date', 'Pax', 'Status'],
    (bks || []).map(b => [
      b.reference || '—', b.description || '—', dt(b.service_date), b.pax ?? '—',
      el('span', { class: 'tag t-' + (b.status === 'confirmed' ? 'paid'
        : b.status === 'cancelled' ? 'void' : 'partial') }, b.status)
    ]),
    'No bookings recorded yet.'));
  addTab('bookings', `Bookings (${(bks || []).length})`, bkPane);

  body.append(tabs, paneHost);
  show('detail');

  host.innerHTML = '';
  host.append(el('div', { class: 'veil', onclick: e => e.target.classList.contains('veil') && close() },
    el('div', { class: 'modal modal-wide' },
      el('h3', {}, vendor.name),
      el('p', { class: 'sub', style: 'margin-top:-10px' },
        [vendor.city, vendor.country].filter(Boolean).join(' · ') || ''),
      body,
      el('div', { class: 'modal-foot' },
        el('button', { class: 'btn btn-ghost', onclick: close }, 'Close')))));
}

async function openRateFile(r) {
  const { data, error } = await sb.storage.from('booking-docs')
    .createSignedUrl(r.storage_path, 60);
  if (error) return alert('Could not open this file: ' + error.message);
  window.open(data.signedUrl, '_blank');
}

/* Add or edit a contracted rate, with optional file upload. */
function rateForm(vendor, existing) {
  const title = el('input', { type: 'text', value: existing?.title || '',
    placeholder: 'e.g. Summer 2026 contracted rates' });
  const type = el('select', {}, ...[
    ['contracted', 'Contracted rate'], ['group_fare', 'Group fare'],
    ['seasonal', 'Seasonal rate'], ['promo', 'Promotional'], ['ad_hoc', 'Ad hoc']
  ].map(([k, v]) => el('option', { value: k, ...(existing?.rate_type === k ? { selected: 'selected' } : {}) }, v)));
  const from = el('input', { type: 'date', value: existing?.valid_from || '' });
  const to = el('input', { type: 'date', value: existing?.valid_to || '' });
  const cur = el('select', {}, ...['EUR', 'GBP', 'PHP', 'USD', 'CHF', 'NOK', 'SEK', 'DKK']
    .map(c => el('option', { value: c, ...(existing?.currency === c ? { selected: 'selected' } : {}) }, c)));
  const detailTx = el('textarea', { rows: '3',
    placeholder: 'e.g. Twin €110/night B&B, single €95/night, city tax €3 pp' });
  detailTx.value = existing?.rate_detail || '';
  const url = el('input', { type: 'url', value: existing?.url || '',
    placeholder: 'https://… supplier portal or shared sheet' });
  const notes = el('textarea', { rows: '2' });
  notes.value = existing?.notes || '';

  const fileInput = el('input', { type: 'file' });
  const current = existing?.file_name
    ? el('p', { class: 'sub', style: 'margin:6px 0 0' }, 'Current file: ' + existing.file_name)
    : '';

  const body = el('div', {},
    el('p', { class: 'sub' }, vendor.name),
    field('Title', title),
    el('div', { class: 'grid2' }, field('Rate type', type), field('Currency', cur)),
    el('div', { class: 'grid2' }, field('Valid from', from), field('Valid to', to)),
    field('Rate detail', detailTx),
    field('Link (optional)', url),
    field('Attach rate sheet (optional)', fileInput),
    current,
    field('Notes', notes));

  modal(existing ? 'Edit contracted rate' : 'Add contracted rate', body, async () => {
    if (!title.value.trim()) return 'Give this rate a title.';

    const payload = {
      vendor_id: vendor.id,
      title: title.value.trim(),
      rate_type: type.value,
      valid_from: from.value || null,
      valid_to: to.value || null,
      currency: cur.value,
      rate_detail: detailTx.value.trim() || null,
      url: url.value.trim() || null,
      notes: notes.value.trim() || null,
      updated_at: new Date().toISOString()
    };

    const f = fileInput.files?.[0];
    if (f) {
      const safe = f.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `internal/rates/${Date.now()}_${safe}`;
      const up = await sb.storage.from('booking-docs')
        .upload(path, f, { contentType: f.type || 'application/octet-stream' });
      if (up.error) return 'Upload failed: ' + up.error.message;
      payload.storage_path = path;
      payload.file_name = f.name;
      payload.size_bytes = f.size;
    }

    const { error } = existing
      ? await sb.from('rate_contracts').update(payload).eq('id', existing.id)
      : await sb.from('rate_contracts').insert(payload);
    return error ? 'Could not save: ' + error.message : null;
  });
}

function vendorEditForm(existing) {
  const name = el('input', { type: 'text', value: existing?.name || '' });
  const cat = el('select', {}, ...Object.entries(VENDOR_CATS).map(([k, v]) =>
    el('option', { value: k, ...(existing?.category === k ? { selected: 'selected' } : {}) }, v)));
  const city = el('input', { type: 'text', value: existing?.city || '', placeholder: 'e.g. Paris' });
  const country = el('input', { type: 'text', value: existing?.country || '', placeholder: 'e.g. France' });
  const email = el('input', { type: 'email', value: existing?.email || '' });
  const phone = el('input', { type: 'text', value: existing?.phone || '' });
  const person = el('input', { type: 'text', value: existing?.contact_person || '' });
  const terms = el('input', { type: 'number', min: '0', value: existing?.terms_days ?? 30 });
  const notes = el('textarea', { rows: '2' });
  notes.value = existing?.notes || '';
  const active = el('select', {},
    el('option', { value: 'true', ...(existing?.active !== false ? { selected: 'selected' } : {}) }, 'Active'),
    el('option', { value: 'false', ...(existing?.active === false ? { selected: 'selected' } : {}) }, 'Inactive'));

  const body = el('div', {},
    field('Supplier name', name),
    el('div', { class: 'grid2' }, field('Category', cat), field('Payment terms (days)', terms)),
    el('div', { class: 'grid2' }, field('City', city), field('Country', country)),
    el('div', { class: 'grid2' }, field('Email', email), field('Phone', phone)),
    el('div', { class: 'grid2' }, field('Contact person', person), field('Status', active)),
    field('Notes', notes));

  modal(existing ? 'Edit supplier' : 'Add a supplier', body, async () => {
    if (!name.value.trim()) return 'Enter a supplier name.';
    const payload = {
      name: name.value.trim(), category: cat.value,
      city: city.value.trim() || null, country: country.value.trim() || null,
      email: email.value.trim() || null, phone: phone.value.trim() || null,
      contact_person: person.value.trim() || null, notes: notes.value.trim() || null,
      terms_days: Number(terms.value) || 30, active: active.value === 'true'
    };
    const { error } = existing
      ? await sb.from('vendors').update(payload).eq('id', existing.id)
      : await sb.from('vendors').insert(payload);
    return error ? 'Could not save: ' + error.message : null;
  });
}

/* ---------- booking department documents ---------- */

const DOC_CATS = {
  manifest: 'Passenger manifest',
  hotel_rates: 'Hotel rates / masterlist',
  budget: 'Budget sheet',
  invoice: 'Supplier invoice',
  airline: 'Airline booking',
  transport: 'Transport / transfers',
  tracker: 'Tracker',
  other: 'Other'
};

// Manifests carry passport numbers and dates of birth. They are always
// filed as restricted so only managers and admins can open them.
const alwaysRestricted = c => c === 'manifest';

const canUpload = () => ['manager', 'admin'].includes(me?.role);

async function documents(host) {
  const { data, error } = await sb.from('documents')
    .select('*').order('created_at', { ascending: false });
  const rows = data || [];

  host.innerHTML = '';
  host.append(...head('Booking department',
    'Shared files from the booking team — rate sheets, budgets, invoices and manifests.'));

  if (error) {
    host.append(el('div', { class: 'msg msg-err' },
      'Could not load documents: ' + error.message));
    return;
  }

  host.append(el('div', { class: 'warn' },
    el('strong', {}, 'Passenger manifests are restricted'),
    'Files tagged as manifests contain passport numbers and dates of birth. ' +
    'They are visible only to managers and admins, and are stored in a private ' +
    'bucket that never serves public links.'));

  if (canUpload()) host.append(dropzone());

  const bar = el('div', { class: 'bar' });
  const fCat = el('select', {}, el('option', { value: '' }, 'All categories'),
    ...Object.entries(DOC_CATS).map(([k, v]) => el('option', { value: k }, v)));
  const fSearch = el('input', { type: 'search', placeholder: 'Search title, period, notes' });
  bar.append(
    el('div', { class: 'field' }, el('label', {}, 'Category'), fCat),
    el('div', { class: 'field grow' }, el('label', {}, 'Search'), fSearch));
  host.append(bar);

  const panel = el('div');
  host.append(panel);

  const draw = () => {
    const q = fSearch.value.toLowerCase();
    const list = rows.filter(r =>
      (!fCat.value || r.category === fCat.value) &&
      (!q || [r.title, r.period, r.notes, r.file_name]
        .some(x => (x || '').toLowerCase().includes(q))));

    panel.innerHTML = '';
    panel.append(el('p', { class: 'sub' }, `${list.length} documents`));
    panel.append(table(
      ['Title', 'Category', 'Period', 'Access', 'Size', 'Added', ''],
      list.map(r => [
        r.title,
        DOC_CATS[r.category] || r.category,
        r.period || '—',
        r.sensitivity === 'restricted'
          ? el('span', { class: 'lock' }, '🔒 Restricted')
          : el('span', { class: 'open-tag' }, 'Internal'),
        r.size_bytes ? (r.size_bytes / 1024 / 1024).toFixed(2) + ' MB' : '—',
        dt(r.created_at),
        el('span', {},
          el('button', { class: 'btn btn-ghost', onclick: () => openDoc(r) }, 'Open'),
          canUpload()
            ? el('button', {
                class: 'btn btn-ghost',
                style: 'margin-left:6px',
                onclick: () => removeDoc(r)
              }, 'Delete')
            : '')
      ]),
      canUpload()
        ? 'No documents yet. Drop files above to get started.'
        : 'No documents you have access to.'));
  };
  fCat.addEventListener('change', draw);
  fSearch.addEventListener('input', draw);
  draw();
}

function dropzone() {
  const zone = el('div', { class: 'drop' },
    el('p', {}, 'Drop files here, or click to choose'),
    el('div', { class: 'hint' }, 'Spreadsheets, PDFs and images up to 50 MB'));

  const input = el('input', {
    type: 'file', multiple: 'true', style: 'display:none'
  });
  zone.append(input);

  zone.addEventListener('click', () => input.click());
  zone.addEventListener('dragover', e => {
    e.preventDefault(); zone.classList.add('over');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('over');
    if (e.dataTransfer.files.length) uploadForm([...e.dataTransfer.files]);
  });
  input.addEventListener('change', () => {
    if (input.files.length) uploadForm([...input.files]);
  });
  return zone;
}

// Guess a category from the filename so the form arrives pre-filled.
function guessCategory(name) {
  const n = name.toLowerCase();
  if (n.includes('room_arrangement') || n.includes('room arrangement')
      || n.includes('manifest') || n.includes('pax')) return 'manifest';
  if (n.includes('hotel')) return 'hotel_rates';
  if (n.includes('budget')) return 'budget';
  if (n.includes('tracker')) return 'tracker';
  if (n.includes('invoice') || n.includes('billing')) return 'invoice';
  if (n.includes('air') || n.includes('flight')) return 'airline';
  if (n.includes('bus') || n.includes('transfer') || n.includes('coach')) return 'transport';
  return 'other';
}

function uploadForm(files) {
  const first = files[0];
  const guessed = guessCategory(first.name);

  const title = el('input', {
    type: 'text',
    value: files.length === 1 ? first.name.replace(/\.[^.]+$/, '') : `${files.length} files`
  });
  const cat = el('select', {},
    ...Object.entries(DOC_CATS).map(([k, v]) =>
      el('option', { value: k, ...(k === guessed ? { selected: 'selected' } : {}) }, v)));
  const tour = el('select', {}, el('option', { value: '' }, 'Not tied to a tour'),
    ...cache.tours.map(t => el('option', { value: t.id }, `${t.code} — ${t.title}`)));
  const period = el('input', { type: 'text', placeholder: 'e.g. Nov 2025, Route N Deluxe' });
  const notes = el('textarea', { rows: '2', placeholder: 'Anything worth noting' });

  const sensNote = el('div', { class: 'warn' });
  const refreshSens = () => {
    if (alwaysRestricted(cat.value)) {
      sensNote.innerHTML = '';
      sensNote.append(
        el('strong', {}, 'This will be filed as restricted'),
        'Manifests hold passport numbers and dates of birth, so only managers ' +
        'and admins will be able to open it.');
      sensNote.style.display = '';
    } else {
      sensNote.style.display = 'none';
    }
  };
  cat.addEventListener('change', refreshSens);
  refreshSens();

  const bar = el('div', { class: 'progress', style: 'display:none' }, el('div', { style: 'width:0%' }));

  const body = el('div', {},
    el('p', { class: 'sub' },
      files.map(f => `${f.name} (${(f.size / 1024 / 1024).toFixed(2)} MB)`).join(', ')),
    field('Title', title),
    el('div', { class: 'grid2' }, field('Category', cat), field('Period', period)),
    field('Tour', tour),
    field('Notes', notes),
    sensNote,
    bar);

  modal('Upload to booking department', body, async () => {
    const sensitivity = alwaysRestricted(cat.value) ? 'restricted' : 'internal';
    bar.style.display = '';
    let done = 0;

    for (const f of files) {
      const safe = f.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `${sensitivity}/${Date.now()}_${safe}`;

      const up = await sb.storage.from('booking-docs')
        .upload(path, f, { contentType: f.type || 'application/octet-stream' });
      if (up.error) return 'Upload failed for ' + f.name + ': ' + up.error.message;

      const ins = await sb.from('documents').insert({
        title: files.length === 1 ? title.value : `${title.value} — ${f.name}`,
        category: cat.value,
        sensitivity,
        tour_id: tour.value || null,
        period: period.value || null,
        notes: notes.value || null,
        storage_path: path,
        file_name: f.name,
        mime_type: f.type || null,
        size_bytes: f.size
      });
      if (ins.error) {
        await sb.storage.from('booking-docs').remove([path]);
        return 'Could not save ' + f.name + ': ' + ins.error.message;
      }
      done++;
      bar.firstChild.style.width = (done / files.length * 100) + '%';
    }
    return null;
  });
}

async function openDoc(r) {
  // Signed URL, valid for 60 seconds. Nothing in this bucket is public.
  const { data, error } = await sb.storage.from('booking-docs')
    .createSignedUrl(r.storage_path, 60);
  if (error) return alert('Could not open this file: ' + error.message);
  window.open(data.signedUrl, '_blank');
}

async function removeDoc(r) {
  if (!confirm(`Delete "${r.title}"? This cannot be undone.`)) return;
  await sb.storage.from('booking-docs').remove([r.storage_path]);
  const { error } = await sb.from('documents').delete().eq('id', r.id);
  if (error) return alert('Could not delete: ' + error.message);
  go('documents');
}

/* ---------- reports ---------- */
async function aging(host) {
  const [p, r] = await Promise.all([
    sb.from('v_payables_aging').select('*').range(0, 4999),
    sb.from('v_receivables_aging').select('*').range(0, 4999)
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
    if (err) { notify(msg, err, false); return; }
    close();
    // Reference data may have changed — refresh so dropdowns stay current.
    const [v, c, t] = await Promise.all([
      sb.from('vendors').select('id,name,category').eq('active', true).order('name'),
      sb.from('clients').select('id,name').eq('active', true).order('name'),
      sb.from('tours').select('id,code,title').order('start_date', { ascending: false })
    ]);
    cache = { vendors: v.data || [], clients: c.data || [], tours: t.data || [] };
    go(document.querySelector('nav button.on').dataset.view);
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

function invoiceForm(type) {
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
      invoice_type: type || 'client',
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


/* ---------- booking department views ---------- */

async function bookingsByKind(host, category, title, sub) {
  const [{ data: bk }, { data: vend }] = await Promise.all([
    sb.from('bookings').select('*').order('service_date'),
    sb.from('vendors').select('id,name,category,city,country')
  ]);
  const vmap = (vend || []).reduce((m, v) => (m[v.id] = v, m), {});
  const rows = (bk || []).filter(b => vmap[b.vendor_id]?.category === category);

  host.innerHTML = '';
  host.append(...head(title, sub));

  const live = rows.filter(r => ['enquiry', 'quoted', 'confirmed'].includes(r.status));
  host.append(el('div', { class: 'stats' },
    stat('Bookings', rows.length, 'all time'),
    stat('Live', live.length, 'enquiry, quoted or confirmed', live.length ? 'good' : ''),
    stat('Confirmed', rows.filter(r => r.status === 'confirmed').length, 'ready to deliver'),
    stat('Suppliers', new Set(rows.map(r => r.vendor_id)).size, 'in this category')));

  const bar = el('div', { class: 'bar' });
  const fStatus = el('select', {}, el('option', { value: '' }, 'All statuses'),
    ...BOOKING_STATUS.map(x => el('option', { value: x }, x[0].toUpperCase() + x.slice(1))));
  const fSearch = el('input', { type: 'search', placeholder: 'Search reference, supplier, description' });
  bar.append(el('div', { class: 'field' }, el('label', {}, 'Status'), fStatus),
    el('div', { class: 'field grow' }, el('label', {}, 'Search'), fSearch));
  host.append(bar);

  const panel = el('div');
  host.append(panel);
  const draw = () => {
    const q = fSearch.value.toLowerCase();
    const list = rows.filter(r =>
      (!fStatus.value || r.status === fStatus.value) &&
      (!q || [r.reference, r.description, vmap[r.vendor_id]?.name, r.notes]
        .some(x => (x || '').toLowerCase().includes(q))));
    panel.innerHTML = '';
    panel.append(el('p', { class: 'sub' }, `${list.length} bookings`));
    panel.append(table(
      ['Supplier', 'Location', 'Reference', 'Service', 'Date', 'Pax', 'Status'],
      list.map(r => {
        const v = vmap[r.vendor_id] || {};
        return [
          el('button', { class: 'btn btn-ghost', style: 'padding:3px 9px;font-size:13px',
            onclick: () => supplierDetail(v) }, v.name || '—'),
          [v.city, v.country].filter(Boolean).join(', ') || '—',
          r.reference || '—', r.description || '—', dt(r.service_date), r.pax ?? '—',
          el('span', { class: 'tag t-' + (r.status === 'confirmed' ? 'paid'
            : r.status === 'cancelled' ? 'void' : 'partial') }, r.status)
        ];
      }),
      'No bookings in this category yet.'));
  };
  fStatus.addEventListener('change', draw);
  fSearch.addEventListener('input', draw);
  draw();
}

async function bookingsOverview(host) {
  const [{ data: bk }, { data: vend }] = await Promise.all([
    sb.from('bookings').select('*').order('service_date'),
    sb.from('vendors').select('id,name,category')
  ]);
  const vmap = (vend || []).reduce((m, v) => (m[v.id] = v, m), {});
  const rows = bk || [];

  host.innerHTML = '';
  host.append(...head('Bookings Overview',
    'Every arrangement across the booking department, whatever the category.'));

  const live = rows.filter(r => ['enquiry', 'quoted', 'confirmed'].includes(r.status));
  host.append(el('div', { class: 'stats' },
    stat('Total bookings', rows.length, 'all time'),
    stat('Live', live.length, 'still in play', live.length ? 'good' : ''),
    stat('Confirmed', rows.filter(r => r.status === 'confirmed').length, 'locked in'),
    stat('Next departure',
      live.filter(r => r.service_date).length
        ? dt(live.filter(r => r.service_date)
            .sort((a, b) => new Date(a.service_date) - new Date(b.service_date))[0].service_date)
        : '—', 'earliest service date')));

  host.append(el('h2', {}, 'By category'));
  const byCat = {};
  rows.forEach(r => {
    const c = vmap[r.vendor_id]?.category || 'other';
    byCat[c] = byCat[c] || { total: 0, live: 0 };
    byCat[c].total++;
    if (['enquiry', 'quoted', 'confirmed'].includes(r.status)) byCat[c].live++;
  });
  host.append(el('div', { class: 'split' },
    ...Object.entries(byCat).sort((a, b) => b[1].total - a[1].total).map(([c, v]) =>
      el('div', { class: 'cat' },
        el('div', { class: 'k' }, VENDOR_CATS[c] || c),
        el('div', { class: 'v' }, v.total),
        el('div', { class: 'track' },
          el('div', { class: 'fill', style: `width:${v.live / v.total * 100}%` }))))));

  host.append(el('h2', {}, 'All bookings'));
  host.append(table(
    ['Supplier', 'Category', 'Reference', 'Service', 'Date', 'Pax', 'Status'],
    rows.map(r => {
      const v = vmap[r.vendor_id] || {};
      return [v.name || '—', VENDOR_CATS[v.category] || v.category || '—',
        r.reference || '—', r.description || '—', dt(r.service_date), r.pax ?? '—',
        el('span', { class: 'tag t-' + (r.status === 'confirmed' ? 'paid'
          : r.status === 'cancelled' ? 'void' : 'partial') }, r.status)];
    }),
    'No bookings recorded yet.'));
}

/* ---------- operations ---------- */

async function opsView(host, category, title, sub) {
  const { data } = await sb.from('v_payables_aging').select('*')
    .eq('kind', 'operational').order('due_date').range(0, 4999);
  const rows = (data || []).filter(r => !category || r.category === category);

  host.innerHTML = '';
  host.append(...head(title, sub));

  const open = rows.filter(r => r.status !== 'paid');
  host.append(el('div', { class: 'stats' },
    stat('Outstanding', money(open.reduce((s, r) => s + Number(r.balance), 0)),
      open.length + ' unpaid', open.length ? 'alert' : ''),
    stat('Paid to date', money(rows.reduce((s, r) => s + Number(r.paid_amount), 0)), 'settled'),
    stat('Bills', rows.length, 'in this category'),
    stat('Overdue', rows.filter(overdue).length, 'past due date',
      rows.filter(overdue).length ? 'alert' : '')));

  const bar = el('div', { class: 'bar' });
  const fSearch = el('input', { type: 'search', placeholder: 'Search vendor, invoice, description' });
  bar.append(el('div', { class: 'field grow' }, el('label', {}, 'Search'), fSearch));
  if (canWrite()) bar.append(el('button', { class: 'btn',
    onclick: () => billForm('operational', OPS_CATS) }, 'Record an expense'));
  host.append(bar);

  const panel = el('div');
  host.append(panel);
  const draw = () => {
    const q = fSearch.value.toLowerCase();
    const list = rows.filter(r => !q ||
      [r.vendor_name, r.invoice_no, r.description].some(x => (x || '').toLowerCase().includes(q)));
    panel.innerHTML = '';
    panel.append(table(
      ['Vendor', 'Category', 'Description', 'Invoice', 'Due', 'Amount', 'Balance', 'Status', ''],
      list.map(r => [
        r.vendor_name, OPS_CATS[r.category] || r.category, r.description || '—',
        r.invoice_no || '—', dt(r.due_date),
        el('span', { class: 'num' }, money(r.amount)),
        el('span', { class: 'num' }, money(r.balance)),
        el('span', { class: 'tag t-' + (overdue(r) ? 'overdue' : r.status) },
          overdue(r) ? 'Overdue' : r.status),
        canWrite() && r.status !== 'paid'
          ? el('button', { class: 'btn btn-ghost', onclick: () => payForm(r, 'out') }, 'Pay') : ''
      ]),
      'Nothing recorded in this category yet.'));
  };
  fSearch.addEventListener('input', draw);
  draw();
}

/* ---------- purchase orders ---------- */

async function purchaseOrders(host) {
  const { data } = await sb.from('purchase_orders').select('*').order('needed_by');
  const rows = data || [];
  const vmap = cache.vendors.reduce((m, v) => (m[v.id] = v, m), {});

  host.innerHTML = '';
  host.append(...head('Purchase Orders',
    'Commitments raised before a supplier invoices. Closed once the bill arrives.'));

  const open = rows.filter(r => r.status === 'open');
  host.append(el('div', { class: 'stats' },
    stat('Open orders', open.length, 'awaiting invoice', open.length ? 'good' : ''),
    stat('Committed', money(open.reduce((s, r) => s + Number(r.amount), 0)), 'not yet billed'),
    stat('Closed', rows.filter(r => r.status === 'closed').length, 'invoiced'),
    stat('Total raised', rows.length, 'all time')));

  const bar = el('div', { class: 'bar' });
  if (canWrite()) bar.append(el('button', { class: 'btn', onclick: poForm }, 'Raise a purchase order'));
  host.append(bar);

  host.append(table(
    ['PO number', 'Supplier', 'Category', 'Description', 'Needed by', 'Amount', 'Status'],
    rows.map(r => [
      r.po_number || '—', vmap[r.vendor_id]?.name || '—',
      ALL_CATS[r.category] || r.category, r.description || '—',
      dt(r.needed_by), el('span', { class: 'num' }, money(r.amount)),
      el('span', { class: 'tag t-' + (r.status === 'closed' ? 'paid'
        : r.status === 'cancelled' ? 'void' : 'unpaid') }, r.status)
    ]),
    'No purchase orders raised yet.'));
}

function poForm() {
  const num = el('input', { type: 'text', placeholder: 'e.g. PO-2026-014' });
  const vendor = el('select', {}, el('option', { value: '' }, 'Select a supplier'),
    ...cache.vendors.map(v => el('option', { value: v.id }, v.name)));
  const cat = el('select', {}, ...Object.entries(ALL_CATS).map(([k, v]) =>
    el('option', { value: k }, v)));
  const desc = el('input', { type: 'text', placeholder: 'What is being ordered' });
  const amt = el('input', { type: 'number', step: '0.01', min: '0' });
  const cur = el('select', {}, ...['PHP', 'EUR', 'GBP', 'USD'].map(c => el('option', { value: c }, c)));
  const needed = el('input', { type: 'date' });
  const tour = el('select', {}, el('option', { value: '' }, 'Not tied to a tour'),
    ...cache.tours.map(t => el('option', { value: t.id }, `${t.code} — ${t.title}`)));
  const notes = el('textarea', { rows: '2' });

  const body = el('div', {},
    el('div', { class: 'grid2' }, field('PO number', num), field('Needed by', needed)),
    field('Supplier', vendor),
    el('div', { class: 'grid2' }, field('Category', cat), field('Tour', tour)),
    field('Description', desc),
    el('div', { class: 'grid2' }, field('Amount', amt), field('Currency', cur)),
    field('Notes', notes));

  modal('Raise a purchase order', body, async () => {
    if (!vendor.value) return 'Choose a supplier.';
    const { error } = await sb.from('purchase_orders').insert({
      po_number: num.value.trim() || null, vendor_id: vendor.value,
      category: cat.value, description: desc.value.trim() || null,
      amount: Number(amt.value) || 0, currency: cur.value,
      needed_by: needed.value || null, tour_id: tour.value || null,
      notes: notes.value.trim() || null
    });
    return error ? 'Could not save: ' + error.message : null;
  });
}

/* ---------- payment schedule ---------- */

async function paymentSchedule(host) {
  const { data } = await sb.from('v_payables_aging').select('*')
    .neq('status', 'paid').order('due_date').range(0, 4999);
  const rows = (data || []).filter(r => r.due_date);

  host.innerHTML = '';
  host.append(...head('Payment Schedule',
    'What falls due, and when. Ordered by due date across every category.'));

  const today = new Date().setHours(0, 0, 0, 0);
  const wk = new Date(today + 7 * 864e5), mo = new Date(today + 30 * 864e5);
  const bucket = r => {
    const d = new Date(r.due_date);
    if (d < today) return 'Overdue';
    if (d <= wk) return 'Next 7 days';
    if (d <= mo) return 'Next 30 days';
    return 'Later';
  };
  const groups = { 'Overdue': [], 'Next 7 days': [], 'Next 30 days': [], 'Later': [] };
  rows.forEach(r => groups[bucket(r)].push(r));

  host.append(el('div', { class: 'stats' },
    ...Object.entries(groups).map(([k, v]) =>
      stat(k, money(v.reduce((s, r) => s + Number(r.balance), 0)),
        v.length + ' bills', k === 'Overdue' && v.length ? 'alert' : ''))));

  Object.entries(groups).forEach(([k, v]) => {
    if (!v.length) return;
    host.append(el('h2', {}, k));
    host.append(table(
      ['Due', 'Vendor', 'Category', 'Reference', 'Balance', ''],
      v.map(r => [
        dt(r.due_date), r.vendor_name, ALL_CATS[r.category] || r.category,
        r.invoice_no || r.tour_code || '—',
        el('span', { class: 'num' }, money(r.balance)),
        canWrite() ? el('button', { class: 'btn btn-ghost', onclick: () => payForm(r, 'out') }, 'Pay') : ''
      ]), ''));
  });

  if (!rows.length) host.append(el('div', { class: 'panel' },
    el('div', { class: 'empty' }, 'Nothing scheduled — no unpaid bills have a due date.')));
}

/* ---------- payments in / out ---------- */

async function paymentsList(host, direction, title, sub) {
  const { data } = await sb.from('payments').select('*')
    .eq('direction', direction).order('paid_on', { ascending: false }).range(0, 4999);
  const rows = data || [];

  host.innerHTML = '';
  host.append(...head(title, sub));

  const total = rows.reduce((s, r) => s + Number(r.amount), 0);
  const thisMonth = rows.filter(r => new Date(r.paid_on).getMonth() === new Date().getMonth()
    && new Date(r.paid_on).getFullYear() === new Date().getFullYear());
  host.append(el('div', { class: 'stats' },
    stat('Total', money(total), rows.length + ' payments',
      direction === 'in' ? 'good' : ''),
    stat('This month', money(thisMonth.reduce((s, r) => s + Number(r.amount), 0)),
      thisMonth.length + ' payments'),
    stat('Methods', new Set(rows.map(r => r.method).filter(Boolean)).size, 'distinct'),
    stat('Latest', rows.length ? dt(rows[0].paid_on) : '—', 'most recent')));

  host.append(table(
    ['Date', 'Method', 'Reference', 'Amount'],
    rows.map(r => [dt(r.paid_on), r.method || '—', r.reference || '—',
      el('span', { class: 'num' }, money(r.amount))]),
    direction === 'in' ? 'No payments received yet.' : 'No payments made yet.'));
}

/* ---------- collections ---------- */

async function collectionsOverview(host) {
  const { data } = await sb.from('v_receivables_aging').select('*').order('due_date').range(0, 4999);
  const rows = data || [];

  host.innerHTML = '';
  host.append(...head('Collections Overview',
    'Everything owed to the company, across client billing and visa services.'));

  const open = rows.filter(r => r.status !== 'settled');
  const byType = t => open.filter(r => (r.invoice_type || 'client') === t);
  host.append(el('div', { class: 'stats' },
    stat('Total outstanding', money(open.reduce((s, r) => s + Number(r.balance), 0)),
      open.length + ' open invoices', 'good'),
    stat('Client invoices', money(byType('client').reduce((s, r) => s + Number(r.balance), 0)),
      byType('client').length + ' invoices'),
    stat('Visa services', money(byType('visa').reduce((s, r) => s + Number(r.balance), 0)),
      byType('visa').length + ' invoices'),
    stat('Overdue', rows.filter(overdue).length, 'past due date',
      rows.filter(overdue).length ? 'alert' : '')));

  host.append(el('h2', {}, 'Ageing'));
  const buckets = ['current', '1-30', '31-60', '61-90', '90+'];
  host.append(el('div', { class: 'aging' },
    ...buckets.map((b, i) => el('div', { class: 'age b' + (i + 1) },
      el('div', { class: 'k' }, b === 'current' ? 'Not yet due' : b + ' days'),
      el('div', { class: 'v' }, money(open.filter(r => r.aging_bucket === b)
        .reduce((s, r) => s + Number(r.balance), 0)))))));

  host.append(el('h2', {}, 'Open invoices'));
  host.append(table(
    ['Client', 'Type', 'Invoice', 'Due', 'Amount', 'Balance', 'Status'],
    open.map(r => [
      r.client_name, (r.invoice_type || 'client') === 'visa' ? 'Visa service' : 'Client',
      r.invoice_no || '—', dt(r.due_date),
      el('span', { class: 'num' }, money(r.amount)),
      el('span', { class: 'num' }, money(r.balance)),
      el('span', { class: 'tag t-' + (overdue(r) ? 'overdue' : r.status) },
        overdue(r) ? 'Overdue' : r.status)
    ]),
    'Nothing outstanding.'));
}

/* ---------- custom reports ---------- */

async function customReports(host) {
  host.innerHTML = '';
  host.append(...head('Custom Reports',
    'Build a figure from any slice of the ledger, then export it.'));

  const src = el('select', {},
    el('option', { value: 'payables' }, 'Payables'),
    el('option', { value: 'receivables' }, 'Receivables'),
    el('option', { value: 'bookings' }, 'Bookings'));
  const from = el('input', { type: 'date' });
  const to = el('input', { type: 'date' });
  const bar = el('div', { class: 'bar' },
    el('div', { class: 'field' }, el('label', {}, 'Source'), src),
    el('div', { class: 'field' }, el('label', {}, 'From'), from),
    el('div', { class: 'field' }, el('label', {}, 'To'), to));
  const run = el('button', { class: 'btn' }, 'Run report');
  const dl = el('button', { class: 'btn btn-ghost', style: 'margin-left:8px' }, 'Download CSV');
  bar.append(el('div', { class: 'field' }, el('label', {}, '\u00a0'), el('span', {}, run, dl)));
  host.append(bar);

  const out = el('div');
  host.append(out);
  let lastRows = [], lastCols = [];

  run.addEventListener('click', async () => {
    out.innerHTML = '<p class="sub">Running…</p>';
    let cols, rows;
    if (src.value === 'payables') {
      const { data } = await sb.from('v_payables_aging').select('*').range(0, 9999);
      rows = (data || []).filter(r => (!from.value || r.invoice_date >= from.value)
        && (!to.value || r.invoice_date <= to.value));
      cols = ['vendor_name', 'category', 'invoice_no', 'invoice_date', 'due_date',
        'amount', 'paid_amount', 'balance', 'status'];
    } else if (src.value === 'receivables') {
      const { data } = await sb.from('v_receivables_aging').select('*').range(0, 9999);
      rows = (data || []).filter(r => (!from.value || r.invoice_date >= from.value)
        && (!to.value || r.invoice_date <= to.value));
      cols = ['client_name', 'invoice_type', 'invoice_no', 'invoice_date', 'due_date',
        'amount', 'received_amount', 'balance', 'status'];
    } else {
      const { data } = await sb.from('bookings').select('*');
      const vmap = cache.vendors.reduce((m, v) => (m[v.id] = v.name, m), {});
      rows = (data || []).filter(r => (!from.value || (r.service_date || '') >= from.value)
        && (!to.value || (r.service_date || '') <= to.value))
        .map(r => ({ ...r, supplier: vmap[r.vendor_id] || '' }));
      cols = ['supplier', 'reference', 'description', 'service_date', 'pax', 'status', 'currency', 'amount'];
    }
    lastRows = rows; lastCols = cols;
    out.innerHTML = '';
    out.append(el('p', { class: 'sub' }, `${rows.length} rows`));
    out.append(table(cols.map(c => c.replace(/_/g, ' ')),
      rows.slice(0, 200).map(r => cols.map(c =>
        typeof r[c] === 'number' ? el('span', { class: 'num' }, money(r[c])) : (r[c] ?? '—'))),
      'No rows in that range.'));
    if (rows.length > 200) out.append(el('p', { class: 'sub' },
      `Showing the first 200 of ${rows.length}. Download the CSV for everything.`));
  });

  dl.addEventListener('click', () => {
    if (!lastRows.length) return alert('Run a report first.');
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [lastCols.join(','), ...lastRows.map(r => lastCols.map(c => esc(r[c])).join(','))].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `${src.value}-report.csv`;
    a.click();
  });
}
