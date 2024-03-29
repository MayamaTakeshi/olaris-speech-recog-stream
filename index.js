const { Writable } = require('stream')

const { EventEmitter } = require('events')

const WebSocket = require('ws')

const linear_ulaw = require('./linear_ulaw.js')

const util = require('util')

let gotPromise
let hpaPromise

async function loadGotModule() {
  if (!gotPromise) {
    gotPromise = import('got')
  }
  return gotPromise
}

async function loadHpAgentModule() {
  if (!hpaPromise) {
    hpaPromise = import('hpagent')
  }
  return hpaPromise
}

async function issueToken(config, log) {
  log.info(`issueToken using ${JSON.stringify(config)}`)
  var got
  var hpagent

  try {
    got = await loadGotModule()
    hpagent = await loadHpAgentModule()
    log.info('got/hpagent are ready')
  } catch (error) {
    log.error(error)
    return null
  }

  var url = `${config.no_tls ? 'http' : 'https'}://${config.api_base}/v1/issue_token/`
  var data = {
      product_name: config.product_name,
      organization_id: config.organization_id,
      user_id: config.user_id
  }
  var headers = {
      'accept': 'text/html',
      'Authorization': `Bearer ${config.api_key}`,
      'Content-type': 'application/json'
  }

  const options = {
    json: data,
    headers,
  }

  if(config.proxy) {
    options.agent = {
      https: new hpagent.HttpsProxyAgent({
        // I'm not sure if these are relevant. For now I will not use them
        /*
        keepAlive: true,
        keepAliveMsecs: 1000,
        maxSockets: 256,
        maxFreeSockets: 256,
        scheduling: 'lifo',
        */
        proxy: config.proxy,
      })
    }
  }

  if(!config.reject_unauthorized) {
    options.https = {
      rejectUnauthorized: false,
    }
  }

  log.info(`post to ${url}`)
  const res = await got.got.post(url, options) 
  if(res.statusCode == 200) {
    log.info(`token ${res.body}`)
    return res.body
  }
  return null
}



class OlarisSpeechRecogStream extends Writable {
    constructor(language, context, config, log) {
        super()

        if(!['LINEAR16', 'MULAW', 'ALAW'].includes(config.encoding)) {
            throw(`Unsupported encoding ${config.encoding}`)
        }

        if(config.sampling_rate != 16000 && config.sampling_rate != 8000) {
            throw(`Unsupported sampling_rate ${config.sampling_rate}`)
        }

        this.eventEmitter = new EventEmitter()

        this.ready = false

        this.setup_speechrecog(language, context, config, log)
    }

    async setup_speechrecog(language, context, config, log) {
        const self = this
        var accessToken

        try {
            accessToken = await issueToken(config, log)
            log.info(`accessToken=${accessToken}`)

            if (!accessToken) {
                setTimeout(() => {
                    self.eventEmitter.emit('error', 'could_not_obtain_token')
                }, 0)
                return
            }
        } catch (err) {
            setTimeout(() => {
                self.eventEmitter.emit('error', `failed when trying to obtain token. err=${err}`)
            }, 0)
            return
        }

        try {
            var proxyAgent = null
            if(config.proxy) {
                const HttpsProxyAgent = require('https-proxy-agent')
                proxyAgent = new HttpsProxyAgent(config.proxy)
            }

            const ws = new WebSocket(`${config.no_tls ? 'ws' : 'wss'}://${config.api_base}/ws/`, {
                agent: proxyAgent
            })

            self.ws = ws

            ws.on('error', (error) => {
                log.error(`WebSocket error occurred: ${error}`);
                setTimeout(() => {
                    self.eventEmitter.emit('error', 'ws error')
                }, 0)
            })

            ws.onopen = function() {
                try {
                    log.info('ws.onopen')
                    let msg = {
                        access_token: accessToken,
                        type: 'start',
                        sampling_rate: config.sampling_rate,
                        product_name: config.product_name,
                        organization_id: config.organization_id,

                        model_name: context.model_name,
                        model_alias: context.model_alias,
                        words: context.words,
                        text: context.text,
                        codec: config.encoding == 'LINEAR16' ? undefined : config.encoding.toLowerCase(),
                    }

                    log.info(msg)
                    ws.send(JSON.stringify(msg))

                    self.ready = true
                    self.eventEmitter.emit('ready')
                } catch (err) {
                    self.eventEmitter.emit('error', err)
                }
            }

            ws.onmessage = function (event) {
                try {
                    const res = JSON.parse(event.data)
                    //log.info(res)
                    if (res.type === 'end' || res.type === 'final-end') {
                        log.info(`got message: type=${res.type} result=${res.result}`)

                        self.eventEmitter.emit('data', {
                            transcript: res.result,
                            confidence: 1.0,
                        })
                    }
                } catch (err) {
                    self.eventEmitter.emit('error', err)
                }
            }
        } catch (err) {
            setTimeout(() => {
                self.eventEmitter.emit('error', 'failed_to_establish_websocket_connection')
            }, 0)

            return
        }
    }

    on(evt, cb) {
        super.on(evt, cb)

        this.eventEmitter.on(evt, cb)
    }

    _write(data, enc, callback) {
        //log.info(`_write got ${data.length}`)

		if(!this.ready) {
			log.info("not ready")	
			callback()
			return true
		}

        var buf
        var bufferArray

        /*
        if(this.encoding == 'LINEAR16') {
            buf = []

            for(var i=0 ; i<data.length/2 ; i++) {
                buf[i] = (data[i*2+1] << 8) + data[i*2]
            }

            bufferArray = Array.prototype.slice.call(buf)
        } else {
            // Convert from ulaw to L16 little-endian 

            buf = []

            for(var i=0 ; i<data.length ; i++) {
                buf[i] = linear_ulaw.ulaw2linear(data[i])
            }
            bufferArray =  Array.prototype.slice.call(buf)
        }

        if(this.encoding == 'LINEAR16') {
            var msg = {
                type: 'streamAudio',
                stream: bufferArray
            }
            this.ws.send(JSON.stringify(msg))
        } else {
            this.ws.send(data)
        }

        */

        // send always in binary format
        this.ws.send(data)

        callback()

        return true
    }

    request_flush() {
        var msg = {
            type: 'final',
        }
        this.ws.send(JSON.stringify(msg))
    }

    _final(callback) {
        //log.info("OlarisSpeechRecogStream closed")
        this.ready = false

        this.eventEmitter.removeAllListeners()

        if(this.ws) {
            this.ws.close()
            this.ws = null
        }

        callback()
    }
}

module.exports = OlarisSpeechRecogStream
