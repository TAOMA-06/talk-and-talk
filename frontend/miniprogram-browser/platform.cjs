const volatile = new Map();
const fileBlobs = new Map();
const TOKEN_KEYS = new Set(['talkandtalk.accessToken', 'talkandtalk.refreshToken']);
const COOKIE_SESSION_MARKER = 'browser-httpOnly-session';
let app;
let navigate;
let currentPages = () => [];
let loginInFlight;

function success(options, value = {}) { options?.success?.(value); options?.complete?.(value); return value; }
function failure(options, message) { const value = { errMsg: message }; options?.fail?.(value); options?.complete?.(value); }
function read(key) {
  if (TOKEN_KEYS.has(key)) return volatile.get(key) || '';
  try { return JSON.parse(localStorage.getItem(`tt-mini:${key}`) || 'null') ?? ''; } catch { return ''; }
}
function write(key, value) {
  if (TOKEN_KEYS.has(key)) volatile.set(key, value);
  else localStorage.setItem(`tt-mini:${key}`, JSON.stringify(value));
}
function remove(key) { volatile.delete(key); localStorage.removeItem(`tt-mini:${key}`); }
function toast(title) {
  const element = document.getElementById('mini-toast');
  element.textContent = title; element.hidden = false;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => { element.hidden = true; }, 3000);
}
function sessionShape(user) {
  // Only a local presence marker: the server never accepts it as a credential.
  // Actual authorization stays in the existing HttpOnly-cookie BFF.
  return { user, accessToken: COOKIE_SESSION_MARKER, refreshToken: COOKIE_SESSION_MARKER, expiresIn: 900 };
}
async function sessionStatus() {
  const response = await fetch('/api/session', { credentials: 'same-origin', cache: 'no-store' });
  const body = await response.json();
  if (!response.ok || !body.data?.user) throw new Error(body.error?.message || '请重新登录');
  return sessionShape(body.data.user);
}
function login() {
  if (loginInFlight) return loginInFlight;
  loginInFlight = new Promise((resolve, reject) => {
    const dialog = document.getElementById('mini-login');
    const form = document.getElementById('mini-login-form');
    const error = document.getElementById('mini-login-error');
    const submit = form.querySelector('[type=submit]');
    error.textContent = ''; submit.disabled = false;
    function finish() { dialog.close(); form.reset(); form.onsubmit = null; dialog.oncancel = null; }
    function cancel() { finish(); reject(new Error('已取消测试账号登录')); }
    dialog.oncancel = (event) => { event.preventDefault(); cancel(); };
    document.getElementById('mini-login-cancel').onclick = cancel;
    form.onsubmit = async (event) => {
      event.preventDefault(); if (submit.disabled) return;
      const consent = read('talkandtalk.legalConsent');
      if (!consent?.adultConfirmed || !consent?.privacyAccepted || !consent?.termsAccepted) {
        error.textContent = '请先在小程序协议页完成协议与年龄确认。'; return;
      }
      submit.disabled = true; error.textContent = '';
      try {
        const data = new FormData(form);
        const response = await fetch('/api/session/login', {
          method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ accessCode: String(data.get('accessCode') || '').trim(), persona: data.get('persona'), consent: { ...consent, source: 'web', acceptedAt: new Date().toISOString() } })
        });
        const body = await response.json();
        if (!response.ok || !body.data?.user) throw new Error(body.error?.message || '登录失败');
        finish(); resolve(sessionShape(body.data.user));
      } catch (reason) { error.textContent = reason.message || '登录失败'; }
      finally { submit.disabled = false; }
    };
    dialog.showModal();
  }).finally(() => { loginInFlight = undefined; });
  return loginInFlight;
}
async function backend(options) {
  const route = String(options.path || options.url || '').replace(/^.*\/api\/v1/, '');
  try {
    if (route === '/auth/wechat/mini-program') {
      const session = await sessionStatus().catch(() => login());
      return success(options, { statusCode: 200, data: { data: session } });
    }
    if (route === '/auth/refresh') {
      const session = await sessionStatus();
      return success(options, { statusCode: 200, data: { data: session } });
    }
    if (route === '/auth/logout') {
      const response = await fetch('/api/session/logout', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: '{}' });
      return success(options, { statusCode: response.status, data: await response.json() });
    }
    if (!route.startsWith('/') || route.startsWith('//')) throw new Error('无效请求地址');
    const method = options.method || 'GET';
    const url = new URL(`/api/backend${route}`, location.origin);
    let data = options.data;
    if (method === 'GET' && data) Object.entries(data).forEach(([key, value]) => { if (value !== undefined) url.searchParams.set(key, String(value)); });
    if (route.startsWith('/users/me/legal-consents') && method === 'POST') data = { ...data, source: 'web' };
    const response = await fetch(url, {
      method, credentials: 'same-origin', cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      ...(method !== 'GET' && method !== 'HEAD' ? { body: JSON.stringify(data ?? {}) } : {}),
      signal: AbortSignal.timeout(options.timeout || 15000)
    });
    return success(options, { statusCode: response.status, data: await response.json() });
  } catch (reason) {
    // Auth failures are real refusals; never manufacture an authenticated user.
    if (route.startsWith('/auth/')) return success(options, { statusCode: 401, data: { error: { code: 'UNAUTHORIZED', message: reason.message } } });
    return failure(options, reason.message || 'request:fail');
  }
}
function actionSheet(options) {
  const dialog = document.createElement('dialog');
  dialog.className = 'mini-action-sheet';
  options.itemList.forEach((item, tapIndex) => {
    const button = document.createElement('button'); button.textContent = item;
    button.onclick = () => { dialog.close(); dialog.remove(); success(options, { tapIndex }); };
    dialog.append(button);
  });
  const cancel = document.createElement('button'); cancel.textContent = '取消';
  cancel.onclick = () => { dialog.close(); dialog.remove(); failure(options, 'showActionSheet:fail cancel'); };
  dialog.append(cancel); document.body.append(dialog); dialog.showModal();
}
function filePicker(options, media) {
  const input = document.createElement('input'); input.type = 'file';
  input.multiple = (options.count || 1) > 1;
  if (media) input.accept = (options.mediaType || ['image']).map((value) => `${value}/*`).join(',');
  else if (options.extension) input.accept = options.extension.map((value) => `.${value}`).join(',');
  input.onchange = () => {
    const files = [...input.files].slice(0, options.count || 1).map((file) => {
      const localPath = URL.createObjectURL(file); fileBlobs.set(localPath, file);
      return { tempFilePath: localPath, path: localPath, name: file.name, size: file.size, fileType: file.type.split('/')[0] };
    });
    success(options, { tempFiles: files });
  };
  input.oncancel = () => failure(options, 'chooseFile:fail cancel'); input.click();
}
function innerAudio() {
  const audio = new Audio();
  return {
    get src() { return audio.src; }, set src(value) { audio.src = value; },
    get currentTime() { return audio.currentTime; }, get duration() { return audio.duration; },
    play() { audio.play().catch(() => audio.dispatchEvent(new Event('error'))); }, pause() { audio.pause(); },
    stop() { audio.pause(); audio.currentTime = 0; }, destroy() { audio.pause(); audio.src = ''; }, seek(time) { audio.currentTime = time; },
    onPlay(callback) { audio.addEventListener('play', callback); }, onPause(callback) { audio.addEventListener('pause', callback); },
    onEnded(callback) { audio.addEventListener('ended', callback); }, onError(callback) { audio.addEventListener('error', callback); },
    onCanplay(callback) { audio.addEventListener('canplay', callback); }, onTimeUpdate(callback) { audio.addEventListener('timeupdate', callback); },
  };
}
function installPlatform() {
  globalThis.App = (definition) => { app = definition; };
  globalThis.getApp = () => app;
  globalThis.getCurrentPages = () => currentPages();
  const wx = {
    getStorageSync: read, setStorageSync: write, removeStorageSync: remove,
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'trial' } }),
    base64ToArrayBuffer: (value) => Uint8Array.from(atob(value), (character) => character.charCodeAt(0)).buffer,
    cloud: { init() {}, callContainer: backend },
    login: (options) => success(options, { code: 'browser-session-bridge' }),
    getNetworkType: (options) => success(options, { networkType: navigator.onLine ? 'unknown' : 'none' }),
    onNetworkStatusChange(callback) { window.addEventListener('online', () => callback({ isConnected: true })); window.addEventListener('offline', () => callback({ isConnected: false })); },
    showToast: (options) => { toast(options.title); success(options); },
    showModal(options) {
      if (options.editable) {
        const content = window.prompt(`${options.title || ''}\n${options.content || ''}`, options.placeholderText || '');
        success(options, { confirm: content !== null, cancel: content === null, content: content || '' });
      } else {
        const confirm = options.showCancel === false ? (window.alert(`${options.title || ''}\n${options.content || ''}`), true) : window.confirm(`${options.title || ''}\n${options.content || ''}`);
        success(options, { confirm, cancel: !confirm });
      }
    },
    showActionSheet: actionSheet,
    setNavigationBarTitle(options) { document.getElementById('mini-title').textContent = options.title; success(options); },
    stopPullDownRefresh(options) { success(options); },
    setClipboardData(options) { navigator.clipboard.writeText(options.data).then(() => success(options), () => failure(options, '复制失败')); },
    makePhoneCall(options) { location.href = `tel:${encodeURIComponent(options.phoneNumber)}`; success(options); },
    requestPayment(options) { failure(options, '浏览器容器尚未接入支付，请使用微信小程序完成真实支付'); toast('浏览器容器尚未接入支付'); },
    requestSubscribeMessage(options) { failure(options, '浏览器无法使用微信订阅消息'); },
    getPrivacySetting(options) { success(options, { needAuthorization: false }); },
    requirePrivacyAuthorize(options) { success(options); },
    openPrivacyContract(options) { navigate('navigateTo', { url: '/pages/legal/index?type=privacy', ...options }); },
    getSetting(options) { success(options, { authSetting: {} }); },
    openSetting(options) { toast('请通过浏览器地址栏设置麦克风或相机权限'); success(options, { authSetting: {} }); },
    authorize(options) { failure(options, '请通过浏览器权限窗口授权'); },
    chooseMedia(options) { filePicker(options, true); }, chooseMessageFile(options) { filePicker(options, false); },
    createInnerAudioContext: innerAudio,
    previewImage(options) { const url = options.current || options.urls?.[0]; if (url && /^(https?:|blob:|\/)/.test(url)) window.open(url, '_blank', 'noopener'); },
    getFileSystemManager() { return { readFile(options) { const blob = fileBlobs.get(options.filePath); if (!blob) return failure(options, '文件不可用'); blob.arrayBuffer().then((data) => success(options, { data }), () => failure(options, '读取失败')); } }; },
    request(options) {
      if (/\/api\/v1(?:\/|$)/.test(options.url)) return backend(options);
      fetch(options.url, { method: options.method || 'GET', headers: options.header, body: options.data, signal: AbortSignal.timeout(options.timeout || 15000) })
        .then(async (response) => success(options, { statusCode: response.status, data: await response.text() })).catch(() => failure(options, 'request:fail'));
    },
    getRecorderManager() {
      const callbacks = {}; return {
        onStart(fn) { callbacks.start = fn; }, onStop(fn) { callbacks.stop = fn; }, onError(fn) { callbacks.error = fn; },
        start() { callbacks.error?.({ errMsg: '当前文字版未开放录音' }); }, stop() {},
      };
    },
  };
  let navigationPending = false;
  for (const mode of ['navigateTo', 'navigateBack', 'redirectTo', 'switchTab', 'reLaunch']) wx[mode] = (options) => {
    if (navigationPending) return failure(options, 'navigation already in progress');
    navigationPending = true;
    queueMicrotask(() => { try { navigate(mode, options); } finally { navigationPending = false; } });
  };
  globalThis.wx = wx;
}

async function startPages(compiled, config) {
  const glass = require('glass-easel');
  const backendContext = new glass.CurrentWindowBackendContext();
  backendContext.onEvent((element, type, detail, options, target) => {
    if (type === 'tap' && target.closest?.('button:disabled,input:disabled,select:disabled')) return;
    const value = target.value;
    if (['input', 'change', 'blur', 'keydown'].includes(type)) detail = { ...detail, value, checked: target.checked, key: options.originalEvent?.key };
    if (type === 'change' && target.matches?.('input[type=checkbox],input[type=radio]')) {
      const group = target.closest('wx-checkbox-group,wx-radio-group');
      if (group?.__wxElement) {
        if (target.type === 'radio') group.querySelectorAll('input[type=radio]').forEach((input) => { if (input !== target) input.checked = false; });
        glass.Event.triggerBackendEvent(group.__wxElement, 'change', { value: target.type === 'radio' ? value : [...group.querySelectorAll('input:checked')].map((input) => input.value) }, { ...options, bubbles: true, composed: true }, group);
        return;
      }
    }
    return glass.Event.triggerBackendEvent(element, type, detail, options, target);
  });
  const associated = compiled.initWithBackend(backendContext);
  const pageHost = document.getElementById('mini-page');
  const tabbar = document.getElementById('mini-tabbar');
  function syncControl(element) {
    if (element.matches?.('input,textarea,select')) {
      const value = element.getAttribute('value');
      if (value !== null && element.value !== value) element.value = value;
      if (element.matches('input[type=checkbox],input[type=radio]')) element.checked = element.hasAttribute('checked');
    }
  }
  // DOM value attributes stop controlling edited fields. Keep glass-easel's
  // rendered attributes in sync with live properties after setData updates.
  new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'attributes') syncControl(record.target);
      else for (const node of record.addedNodes) {
        syncControl(node);
        node.querySelectorAll?.('input,textarea,select').forEach(syncControl);
        if (node.parentElement?.matches('select')) syncControl(node.parentElement);
      }
    }
  }).observe(pageHost, { subtree: true, childList: true, attributes: true, attributeFilter: ['value', 'checked'] });
  const stack = [];
  const tabs = new Map();
  let active;
  const tabPaths = new Set(config.tabBar.list.map((item) => item.pagePath));
  function invoke(page, name, ...args) { try { Promise.resolve(page.caller[name]?.(...args)).catch((error) => { console.error(name, error); toast(error.message); }); } catch (error) { console.error(name, error); toast(error.message); } }
  function hide(page) { if (!page) return; page.scroll = window.scrollY; invoke(page, 'onHide'); page.element.hidden = true; }
  function release(page) { invoke(page, 'onUnload'); page.root.release(); page.element.remove(); }
  function make(route, query) {
    const element = document.createElement('section'); element.dataset.miniRoute = route;
    const placeholder = document.createElement('span'); element.append(placeholder); pageHost.append(element);
    const root = associated.createRoot('page', compiled.codeSpace, route);
    const caller = root.get(); caller.route = route; caller.options = query;
    root.attach(element, placeholder);
    const page = { root, caller, element, route, query, scroll: 0 };
    invoke(page, 'onLoad', query); return page;
  }
  function display(page, first = false) {
    active = page; page.element.hidden = false;
    const isTab = tabPaths.has(page.route);
    tabbar.hidden = !isTab; document.body.classList.toggle('no-tabbar', !isTab);
    document.getElementById('mini-back').style.visibility = stack.length > 1 ? 'visible' : 'hidden';
    document.getElementById('mini-title').textContent = config.pageConfigs[page.route]?.navigationBarTitleText || 'Talk&Talk';
    tabbar.replaceChildren(...config.tabBar.list.map((item) => {
      const button = document.createElement('button');
      const selected = item.pagePath === page.route;
      if (selected) button.setAttribute('aria-current', 'page');
      const image = document.createElement('img');
      image.src = `/mini/${config.theme[(selected ? item.selectedIconPath : item.iconPath).slice(1)]}`; image.alt = '';
      const label = document.createElement('span'); label.textContent = item.text;
      button.append(image, label); button.onclick = () => navigate('switchTab', { url: `/${item.pagePath}` }); return button;
    }));
    window.scrollTo(0, page.scroll);
    invoke(page, 'onShow'); if (first) requestAnimationFrame(() => invoke(page, 'onReady'));
  }
  navigate = (mode, options = {}) => {
    try {
      if (mode === 'navigateBack') {
        if (stack.length <= 1) return navigate('switchTab', { url: '/pages/home/index' });
        hide(active);
      const count = Math.min(options.delta || 1, stack.length - 1);
      for (let i = 0; i < count; i++) release(stack.pop());
        display(stack.at(-1)); history.replaceState(null, '', `#/${active.route}`); return success(options);
      }
      const url = new URL(options.url || '/pages/consent/index', 'https://mini.local');
      const route = url.pathname.slice(1);
      if (!config.pages.includes(route)) throw new Error('该小程序页面不存在');
      const query = Object.fromEntries(url.searchParams);
      hide(active);
      if (mode === 'reLaunch' || mode === 'switchTab') {
        for (const page of stack) { if (mode === 'reLaunch' || !tabPaths.has(page.route)) release(page); }
        stack.length = 0;
        if (mode === 'reLaunch') { for (const page of tabs.values()) if (page.element.isConnected) release(page); tabs.clear(); }
      } else if (mode === 'redirectTo' && stack.length) release(stack.pop());
      let page = mode === 'switchTab' ? tabs.get(route) : null;
      const first = !page;
      if (!page) page = make(route, query);
      if (tabPaths.has(route)) tabs.set(route, page);
      stack.push(page); display(page, first);
      history.replaceState(null, '', `#/${route}${url.search}`); success(options);
    } catch (error) { console.error('Mini Program navigation failed', error); toast(error.message); failure(options, error.message); }
  };
  currentPages = () => stack.map((page) => page.caller);
  document.getElementById('mini-back').onclick = () => navigate('navigateBack');
  document.getElementById('mini-menu').onclick = () => actionSheet({ itemList: ['刷新当前页', '切换测试账号'], success: async ({ tapIndex }) => {
    if (tapIndex === 0) invoke(active, 'onPullDownRefresh' in active.caller ? 'onPullDownRefresh' : 'onShow');
    else {
      await fetch('/api/session/logout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      remove('talkandtalk.accessToken'); remove('talkandtalk.refreshToken'); remove('talkandtalk.user');
      navigate('reLaunch', { url: '/pages/home/index' });
    }
  } });
  window.addEventListener('scroll', () => { if (window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 80) invoke(active, 'onReachBottom'); });
  document.addEventListener('visibilitychange', () => { if (active) invoke(active, document.hidden ? 'onHide' : 'onShow'); });
  try { const session = await sessionStatus(); write('talkandtalk.accessToken', session.accessToken); write('talkandtalk.refreshToken', session.refreshToken); write('talkandtalk.user', session.user); }
  catch { remove('talkandtalk.accessToken'); remove('talkandtalk.refreshToken'); remove('talkandtalk.user'); }
  app?.onLaunch?.();
  navigate('reLaunch', { url: location.hash.slice(1) || '/pages/consent/index' });
}
module.exports = { installPlatform, startPages };
