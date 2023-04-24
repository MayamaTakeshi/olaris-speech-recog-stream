const { Writable } = require('stream')

const { EventEmitter } = require('events')

const WebSocket = require('ws')

const linear_ulaw = require('./linear_ulaw.js')

const util = require('util');
const request = require('request')

const promiseRequest = util.promisify(request)

function log(msg) {
    // not actual error. just avoid writing to stdout
    console.error(msg)
}

// issue_one_time_token
async function issueToken(config) {
  var url = `https://${config.api_base}/v1/issue_token/`
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

  let token = null

  const options = {
    url,
    method: 'POST',
    json: true, // Set this to true to automatically stringify the body as JSON
    body: data,
    headers,
  }

  var response = await promiseRequest(options)
  log(`issueToken got ${JSON.stringify(response)}`)
  if(response.statusCode == 200) {
    return response.body
  } else {
    return null
  }
}


class OlarisSpeechRecogStream extends Writable {
    constructor(uuid, language, context, config) {
        super()

        if(!['LINEAR16', 'MULAW', 'ALAW'].includes(config.encoding)) {
            throw(`Unsupported encoding ${config.encoding}`)
        }

        if(config.sampling_rate != 16000 && config.sampling_rate != 8000) {
            throw(`Unsupported sampling_rate ${config.sampling_rate}`)
        }

        this.uuid = uuid

        this.eventEmitter = new EventEmitter()

        this.ready = false

        this.setup_speechrecog(language, context, config)
    }

    async setup_speechrecog(language, context, config) {
        const self = this
        var accessToken

        try {
            log("before issueToken")
            accessToken = await issueToken(config)
            log("after issueToken")
            log(`accessToken=${accessToken}`)

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
            if(process.env.https_proxy) {
                const proxy = process.env.https_proxy
                const HttpsProxyAgent = require('https-proxy-agent')
                proxyAgent = new HttpsProxyAgent(proxy)
            }

            const ws = new WebSocket(`wss://${config.api_base}/ws/`, {
                agent: proxyAgent
            })

            self.ws = ws

            ws.onopen = function() {
                try {
                    log('ws.onopen')
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

                    log(msg)
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
                    //log(res)
                    if (res.type === 'end' || res.type === 'final-end') {
                        //log(res)

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
        //log(`_write got ${data.length}`)

		if(!this.ready) {
			log("not ready")	
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
        //log("OlarisSpeechRecogStream closed")
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
