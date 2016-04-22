/*eslint no-console: 0 */
'use strict'

const events = require('events')
const lib = require('./lib')

/**
 * The Trails Application. Merges the configuration and API resources
 * loads Trailpacks, initializes logging and event listeners.
 */
module.exports = class TrailsApp extends events.EventEmitter {

  /**
   * @param pkg The application package.json
   *
   * Initialize the Trails Application and its EventEmitter parentclass. Set
   * some necessary default configuration.
   */
  constructor (app) {
    super()

    if (!process.env.NODE_ENV) {
      process.env.NODE_ENV = 'development'
    }
    if (!app.pkg) {
      throw new lib.Errors.PackageNotDefinedError()
    }

    lib.Trails.validateConfig(app.config)

    Object.defineProperties(this, {
      env: {
        value: Object.freeze(JSON.parse(JSON.stringify(process.env)))
      },
      pkg: {
        value: app.pkg
      },
      config: {
        value: lib.Trails.buildConfig(app.config),
        configurable: true
      },
      _trails: {
        enumerable: false,
        value: require('./package')
      }
    })

    // trailpack constructors may depend on app.config
    const trailpacks = this.config.main.packs.map(Pack => new Pack(this))

    Object.defineProperties(this, {
      _packs: {
        enumerable: false,
        value: trailpacks
      },
      packs: {
        value: lib.Trailpack.getTrailpackMapping(trailpacks)
      },
      api: {
        value: app.api,
        writable: true,
        configurable: true
      }
    })

    this.bound = false
    this.started = false
    this.stopped = false

    this.setMaxListeners(this.config.main.maxListeners)
  }

  /**
   * Start the App. Load all Trailpacks. The "api" property is required, here,
   * if not provided to the constructor.
   *
   * @param app.api The application api (api/ folder)
   * @param app.config The application configuration (config/ folder)
   * @return Promise
   */
  start (app) {
    if (!this.api && !(app && app.api)) {
      throw new lib.Errors.ApiNotDefinedError()
    }

    this.api || (this.api = app && app.api)

    lib.Trails.bindEvents(this)
    lib.Trailpack.bindTrailpackPhaseListeners(this, this._packs)
    lib.Trailpack.bindTrailpackMethodListeners(this, this._packs)

    this.emit('trails:start')

    return this.after('trails:ready')
      .then(() => {
        this.started = true
        return this
      })
  }

  /**
   * Shutdown. Unbind listeners, unload trailpacks.
   * @return Promise
   */
  stop (err) {
    this.stopped = true

    if (err) {
      this.log.error('\n', err.stack || '')
    }
    if (!this.started) {
      this.log.error('The application did not boot successfully.')
      this.log.error('Try increasing the loglevel to "debug" to learn more')
    }

    this.emit('trails:stop')

    lib.Trails.unbindEvents(this)

    return Promise.all(
      Object.keys(this.packs || { }).map(packName => {
        this.log.debug('Unloading trailpack', packName)
        return this.packs[packName].unload()
      }))
      .then(() => this)
  }

  /**
   * @override
   * Log app events for debugging
   */
  emit (event) {
    this.log.debug('trails event:', event)
    return super.emit.apply(this, arguments)
  }

  /**
   * Resolve Promise once all events in the list have emitted
   * @return Promise
   */
  after (events) {
    if (!Array.isArray(events)) {
      events = [ events ]
    }

    return Promise.all(events.map(eventName => {
      return new Promise(resolve => this.once(eventName, resolve))
    }))
  }

  /**
   * Expose the logger on the app object. The logger can be configured by
   * setting the "config.log.logger" config property.
   */
  get log () {
    return this.config.log.logger
  }
}
