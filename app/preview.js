// Device preview: the real app in an iframe at a phone's CSS viewport size, so
// the layout that ships is the layout being checked. Development only - the
// server does not serve this page in production.
const DEVICES = [
  { id: 'iphone-se', name: 'iPhone SE', width: 375, height: 667, kind: 'phone-home', statusBar: 20 },
  { id: 'iphone-13-mini', name: 'iPhone 13 mini', width: 375, height: 812, kind: 'phone', statusBar: 54 },
  { id: 'iphone-15', name: 'iPhone 15 / 15 Pro', width: 393, height: 852, kind: 'phone', statusBar: 54 },
  { id: 'iphone-16-pro', name: 'iPhone 16 Pro', width: 402, height: 874, kind: 'phone', statusBar: 54 },
  { id: 'iphone-15-pro-max', name: 'iPhone 15 Pro Max', width: 430, height: 932, kind: 'phone', statusBar: 54 },
  { id: 'pixel-8', name: 'Pixel 8', width: 412, height: 915, kind: 'phone', statusBar: 54 },
  { id: 'galaxy-s23', name: 'Galaxy S23', width: 360, height: 780, kind: 'phone', statusBar: 54 },
  { id: 'small-phone', name: 'Small phone (320 wide)', width: 320, height: 640, kind: 'phone-home', statusBar: 20 },
  { id: 'ipad-mini', name: 'iPad mini', width: 744, height: 1133, kind: 'tablet', statusBar: 24 },
  { id: 'ipad-air', name: 'iPad Air', width: 820, height: 1180, kind: 'tablet', statusBar: 24 },
  { id: 'laptop', name: 'Laptop', width: 1280, height: 800, kind: 'desktop' },
  { id: 'desktop', name: 'Desktop', width: 1440, height: 900, kind: 'desktop' }
];
const STORE_KEY = 'ptrainer-preview';
const $ = selector => document.querySelector(selector);

function remembered() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); } catch { return {}; }
}
function remember(value) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(value)); } catch { /* private mode: nothing to keep */ }
}

const params = new URLSearchParams(location.search), saved = remembered();
const settings = {
  device: DEVICES.some(item => item.id === params.get('device')) ? params.get('device') : saved.device || 'iphone-15',
  landscape: params.has('landscape') || Boolean(saved.landscape),
  zoom: saved.zoom || 'fit'
};

$('#deviceSelect').innerHTML = [['Phones', 'phone'], ['Tablets', 'tablet'], ['Computers', 'desktop']].map(([label, group]) =>
  `<optgroup label="${label}">${DEVICES.filter(item => item.kind.startsWith(group)).map(item => `<option value="${item.id}">${item.name} · ${item.width}×${item.height}</option>`).join('')}</optgroup>`).join('');

function apply() {
  const device = DEVICES.find(item => item.id === settings.device) || DEVICES[2];
  const width = settings.landscape ? device.height : device.width, height = settings.landscape ? device.width : device.height;
  const frame = $('#device'), screen = $('#screen'), stage = $('#stage');
  frame.className = `device ${device.kind}${settings.landscape ? ' landscape' : ''}`;
  // Sizes go through CSSOM rather than inline style attributes, which keeps
  // this page inside the same style-src 'self' policy as the app.
  screen.style.width = `${width}px`;
  screen.style.height = `${height}px`;
  const available = { width: stage.clientWidth - 48, height: window.innerHeight - stage.getBoundingClientRect().top - 90 };
  const fit = Math.min(1, available.width / frame.offsetWidth, available.height / frame.offsetHeight);
  const scale = settings.zoom === 'fit' ? Math.max(0.2, fit) : Number(settings.zoom);
  frame.style.transform = `scale(${scale})`;
  // A transform does not change layout size, so reserve the scaled footprint.
  // offsetWidth/Height are the untransformed size. The origin is top centre,
  // so the width shrinks evenly from both sides.
  frame.style.marginBottom = `${frame.offsetHeight * (scale - 1)}px`;
  frame.style.marginLeft = frame.style.marginRight = `${frame.offsetWidth * (scale - 1) / 2}px`;
  // The status bar is the phone's, not the page's: Safari starts the page below
  // it, so the app gets the height that is left. Landscape hides it on phones.
  const statusBar = settings.landscape && device.kind !== 'tablet' ? 0 : device.statusBar || 0;
  screen.style.setProperty('--status-bar', `${statusBar}px`);
  $('#caption').textContent = `${device.name} · screen ${width} × ${height} · app area ${width} × ${height - statusBar} · shown at ${Math.round(scale * 100)}%`;
  $('#deviceSelect').value = device.id;
  $('#zoomSelect').value = settings.zoom;
  $('#rotateButton').setAttribute('aria-pressed', String(settings.landscape));
  remember(settings);
  const url = new URL(location.href);
  url.searchParams.set('device', device.id);
  if (settings.landscape) url.searchParams.set('landscape', ''); else url.searchParams.delete('landscape');
  history.replaceState(null, '', url);
}

$('#deviceSelect').addEventListener('change', event => { settings.device = event.target.value; apply(); });
$('#zoomSelect').addEventListener('change', event => { settings.zoom = event.target.value; apply(); });
$('#rotateButton').addEventListener('click', () => { settings.landscape = !settings.landscape; apply(); });
$('#reloadButton').addEventListener('click', () => $('#appFrame').contentWindow.location.reload());
window.addEventListener('resize', apply);
apply();
