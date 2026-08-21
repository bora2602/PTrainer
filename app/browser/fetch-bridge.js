/* Routes the app's /api requests to the Ptrainer server running in this page.
   Loaded as a classic script before app.js so window.fetch is patched before
   the app makes its first call; module scripts are deferred and would be late.
   Requests that arrive before the backend finishes booting wait on a promise. */
(function () {
  var handler = null;
  var resolveReady;
  var ready = new Promise(function (resolve) { resolveReady = resolve; });
  var failure = null;
  var cookies = Object.create(null);
  var realFetch = window.fetch.bind(window);
  var encoder = new TextEncoder();

  var SERVER_PATHS = /^\/(api\/|healthz$|readyz$|metrics$)/;

  globalThis.__ptrainerRegisterHandler = function (requestHandler) {
    handler = requestHandler;
    resolveReady();
  };
  globalThis.__ptrainerBootFailed = function (error) {
    failure = error;
    resolveReady();
  };
  globalThis.__ptrainerReady = ready;

  function serverPath(input) {
    var raw = typeof input === 'string' ? input : (input && input.url) || '';
    var url;
    try { url = new URL(raw, document.baseURI); } catch (error) { return null; }
    if (url.origin !== window.location.origin) return null;
    var path = url.pathname;
    var apiIndex = path.indexOf('/api/');
    if (apiIndex > 0) path = path.slice(apiIndex);
    else if (apiIndex !== 0) {
      var base = new URL('./', document.baseURI).pathname.replace(/\/$/, '');
      if (base && path.indexOf(base) === 0) path = path.slice(base.length) || '/';
    }
    if (!SERVER_PATHS.test(path)) return null;
    return path + url.search;
  }

  function collectHeaders(init, input) {
    var headers = {};
    function absorb(source) {
      if (!source) return;
      if (typeof source.forEach === 'function' && !Array.isArray(source)) {
        source.forEach(function (value, name) { headers[String(name).toLowerCase()] = String(value); });
        return;
      }
      Object.keys(source).forEach(function (name) { headers[name.toLowerCase()] = String(source[name]); });
    }
    if (input && typeof input !== 'string' && input.headers) absorb(input.headers);
    absorb(init && init.headers);
    var jar = Object.keys(cookies).map(function (name) { return name + '=' + cookies[name]; }).join('; ');
    if (jar) headers.cookie = jar;
    return headers;
  }

  function storeCookie(value) {
    String(value).split(/,(?=[^;]+=)/).forEach(function (single) {
      var parts = single.split(';');
      var pair = parts[0].split('=');
      var name = pair[0].trim();
      if (!name) return;
      var expired = parts.some(function (part) { return /^\s*max-age\s*=\s*0\s*$/i.test(part); });
      if (expired || pair.slice(1).join('=') === '') delete cookies[name];
      else cookies[name] = pair.slice(1).join('=');
    });
  }

  function dispatch(path, init, input) {
    return new Promise(function (resolve) {
      var body = init && init.body != null ? init.body : (input && typeof input !== 'string' ? input.body : null);
      var chunks = [];
      if (typeof body === 'string' && body.length) chunks.push(encoder.encode(body));
      else if (body instanceof Uint8Array) chunks.push(body);

      var req = {
        method: String((init && init.method) || (input && input.method) || 'GET').toUpperCase(),
        url: path,
        headers: collectHeaders(init, input),
        // Rate-limit buckets key off the peer address; every request here is local.
        socket: { remoteAddress: "127.0.0.1" }
      };
      req[Symbol.asyncIterator] = function () {
        var index = 0;
        return { next: function () {
          return Promise.resolve(index < chunks.length ? { value: chunks[index++], done: false } : { value: undefined, done: true });
        } };
      };

      var listeners = [];
      var settled = false;
      var res = {
        statusCode: 200,
        headersSent: false,
        _headers: {},
        setHeader: function (name, value) {
          var key = String(name).toLowerCase();
          if (key === 'set-cookie') storeCookie(value);
          this._headers[key] = String(value);
        },
        getHeader: function (name) { return this._headers[String(name).toLowerCase()]; },
        removeHeader: function (name) { delete this._headers[String(name).toLowerCase()]; },
        once: function (event, callback) { if (event === 'finish') listeners.push(callback); return this; },
        on: function (event, callback) { return this.once(event, callback); },
        end: function (payload) {
          if (settled) return this;
          settled = true;
          this.headersSent = true;
          var headers = {};
          Object.keys(this._headers).forEach(function (name) {
            if (name !== 'set-cookie') headers[name] = res._headers[name];
          });
          var status = this.statusCode || 200;
          var noBody = status === 204 || status === 304;
          resolve(new Response(noBody ? null : (payload == null ? '' : payload), { status: status, headers: headers }));
          listeners.forEach(function (callback) { try { callback(); } catch (error) { console.error(error); } });
          return this;
        }
      };

      Promise.resolve()
        .then(function () { return handler(req, res); })
        .catch(function (error) {
          console.error('ptrainer_browser_request_failed', error);
          if (!settled) {
            settled = true;
            resolve(new Response(JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong.' } }), {
              status: 500, headers: { 'content-type': 'application/json; charset=utf-8' }
            }));
          }
        });
    });
  }

  window.fetch = function (input, init) {
    var path = serverPath(input);
    if (!path) return realFetch(input, init);
    return ready.then(function () {
      if (!handler) {
        return new Response(JSON.stringify({
          error: { code: 'BACKEND_UNAVAILABLE', message: 'The in-browser server failed to start: ' + (failure && failure.message ? failure.message : 'unknown error') }
        }), { status: 503, headers: { 'content-type': 'application/json; charset=utf-8' } });
      }
      return dispatch(path, init, input);
    });
  };
})();
