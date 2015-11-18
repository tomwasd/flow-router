const Url = Npm.require('url');
const Cheerio = Npm.require('cheerio');

Route = class {
  constructor(router, pathDef, options) {
    options = options || {};
    this.options = options;
    this.name = options.name;
    this.pathDef = pathDef;
  
  
    // Route.path is deprecated and will be removed in 3.0
    this.path = this.pathDef;
  
    this.action = options.action || Function.prototype;
    this._router = router;
    this.subscriptions = options.subscriptions || Function.prototype;
    this._subsMap = {};
    this._cache = {};
  
    Picker.middleware(Npm.require('connect').cookieParser());
    // process null subscriptions with FR support
    Picker.middleware(FastRender.handleOnAllRoutes);
    
    const route = FlowRouter.basePath + this.pathDef;
    Picker.route(route, (params, req, res, next) => {
  
      if (!this.isHtmlPage(req.url)) {
        return next();
      }
  
      const cachedPage = this._lookupCachedPage(req.url);
      if (cachedPage) {
        return this._processFromCache(cachedPage, res, next);
      }
  
      const processFromSsr = this._processFromSsr.bind(this, params, req, res);
      FastRender.handleRoute(processFromSsr, params, req, res, (data) => {
        next();
      }); 
    });
  }
  
  _processFromSsr(params, req, res) {
    const ssrContext = new SsrContext();
    
    this._router.ssrContext.withValue(ssrContext, () => {
      const queryParams = params.query;
      // We need to remove `.query` since it's not part of our params API
      // But we only need to remove it in our copy. 
      // We should not trigger any side effects
      params = _.clone(params);
      delete params.query;
      const context = this._buildContext(req.url, params, queryParams);
  
      this._router.currentRoute.withValue(context, () => {
        try {
          // get the data for null subscriptions and add them to the
          // ssrContext
          const frData = res.getData("fast-render-data");
          if(frData) {
            ssrContext.addData(frData.collectionData);
          }
  
          if(this.options.subscriptions) {
            this.options.subscriptions.call(this, params, queryParams);
          }
  
          if(this.options.action) {
            this.options.action.call(this, params, queryParams);
          }
        } catch(ex) {
          console.error("Error when doing SSR. path:", req.url, " ", ex.message);
          console.error(ex.stack);
        }
      });
  
      const originalWrite = res.write;
      res.write = (data) => {
        if(typeof data === 'string') {
          const head = ssrContext.getHead();
          if(head && head.trim() !== "") {
            data = data.replace('</head>', head + '\n</head>');
          }
  
          const reactRoot = ssrContext.getHtml();
          if (this._router.deferScriptLoading) {
            data = moveScripts(data);
          }
          data = data.replace('<body>', '<body>' + reactRoot);
  
          const pageInfo = {
            frData: res.getData("fast-render-data"),
            html: data
          };
  
          // cache the page if mentioned a timeout
          if(this._router.pageCacheTimeout) {
            this._cachePage(req.url, pageInfo, this._router.pageCacheTimeout);
          }
        }
        
        originalWrite.call(this, data);
      };
    });
  
    const moveScripts = (data) => {
      const $ = Cheerio.load(data, {
        decodeEntities: false
      });
      const heads = $('head script');
      $('body').append(heads);
  
      // Remove empty lines caused by removing scripts
      $('head').html($('head').html().replace(/(^[ \t]*\n)/gm, ''));
  
      return $.html();
    }
  }
  
  _processFromCache(pageInfo, res, next) {
    const originalWrite = res.write;
    res.write = (data) => {
      originalWrite.call(this, pageInfo.html);
    }
  
    res.pushData('fast-render-data', pageInfo.frData);
    next();
  }
  
  _buildContext(url, params, queryParams) {
    const context = {
      route: this,
      path: url,
      params: params,
      queryParams: queryParams
    };
  
    return context;
  }
  
  isHtmlPage(url) {
    const pathname = Url.parse(url).pathname;
    const ext = pathname.split('.').slice(1).join('.');
  
    // if there is no extention, yes that's a html page
    if(!ext) {
      return true;
    }
  
    // if this is htm or html, yes that's a html page
    if(/^htm/.test(ext)) {
      return true;
    }
  
    // if not we assume this is not as a html page
    // this doesn't do any harm. But no SSR
    return false;
  }
  
  _lookupCachedPage(url) {
    const info = this._cache[url];
    if(info) {
      return info.data;
    }
  }
  
  _cachePage(url, data, timeout) {
    const existingInfo = this._cache[url];
    if(existingInfo) {
      clearTimeout(existingInfo.timeoutHandle);
    }
  
    const info = {
      data: data,
      timeoutHandle: setTimeout(() => {
        delete this._cache[url];
      }, timeout)
    };
  
    this._cache[url] = info;
  }
  
  register(name, sub, options) {
    this._subsMap[name] = sub;
  };
  
  subscription(name) {
    return this._subsMap[name];
  }
  
  middleware(middleware) {
  
  }
}
