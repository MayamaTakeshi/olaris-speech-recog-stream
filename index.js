const { Writable } = require('stream')

const { EventEmitter } = require('events')

const WebSocket = require('ws')

const rp = require('request-promise')

// issue_one_time_token
async function issueToken(config) {
  const options = {
    method: 'POST',
    uri: `https://${config.api_base}/v1/issue_token/`,
    headers: {
      'accept': 'text/html',
      'Authorization': `Bearer ${config.api_key}`,
      'Content-type': 'application/json'
    },
    body: {
      product_name: config.product_name,
      organization_id: config.organization_id,
      user_id: config.user_id
    },
    json: true
  }
  let token = null
  await rp(options)
    .then(res => {
      token = res
    })
    .catch(err => {
      console.error(err)
    })
  return token
}


class OlarisSpeechRecogStream extends Writable {
    constructor(uuid, language, context, config) {
        super()

        this.uuid = uuid

        this.eventEmitter = new EventEmitter()

        this.src_encoding = config.src_encoding

		this.ready = false

        this.setup_speechrecog(language, context, config)
    }

    async setup_speechrecog(language, context, config) {
        const self = this

        const accessToken = await issueToken(config)
		console.log(`accessToken=${accessToken}`)

        if (accessToken === null) {
            setTimeout(() => {
                self.eventEmitter.emit('error', 'could_not_obtain_token')
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
				console.log('ws.onopen')
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
                }

                ws.send(JSON.stringify(msg))

				self.ready = true
                self.eventEmitter.emit('ready')
            }

            ws.onmessage = function (event) {
                const res = JSON.parse(event.data)
                //console.log(res.type)
                if (res.type === 'end' || res.type === 'final-end') {
                    //console.log(res)

                    self.eventEmitter.emit('data', {
                        transcript: res.result,
                        confidence: 1.0,
                    })
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
        //console.log(`_write got ${data.length}`)

		if(!this.ready) {
			console.log("not ready")	
			callback()
			return true
		}

        var buf
        var bufferArray

        if(this.src_encoding == 'LINEAR16') {
            buf = []

            for(var i=0 ; i<data.length/2 ; i++) {
                buf[i] = (data[i*2+1] << 8) + data[i*2]
            }

            bufferArray = Array.prototype.slice.call(buf)
        } else {
            // Convert from ulaw to L16 little-endian 

            buf = []

            for(var i=0 ; i<data.length ; i++) {
                buf[i] = ulaw2linear(data[i])
            }
            bufferArray =  Array.prototype.slice.call(buf)
        }

        var msg = {
            type: 'streamAudio',
            stream: bufferArray
        }
        //console.log(bufferArray)
        this.ws.send(JSON.stringify(msg))

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
