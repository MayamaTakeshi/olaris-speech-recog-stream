# olaris-speech-recog-stream
A simple stream object to be used with Olaris Speech Recog API

## Installation
```
npm install olaris-speech-recog-stream
```

## Usage

````
const tl = require('tracing-log')
const OlarisSpeechRecogStream = require('olaris-speech-recog-stream')

const config = {
    api_base: 'OLARIS_API_BASE',
    product_name: 'YOUR_PRODUCT_NAME',
    organization_id: 'YOUR_ORGANIZATION_ID',
    api_key: 'YOUR_API_KEY',

    encoding: 'LINEAR16', // it can be LINEAR16, MULAW or ALAW
    sampling_rate: 16000, // it can be 16000 (for LINEAR16) or 8000 (for MULAW and ALAW)
}

const language = 'ja-JP' // Olaris currently only supports Japanese
const context = null // Currently this has no use (later it will be used to permit to specify grammar/keywords to improve accuracy)

// you need to provide a log object 
const uuid = 'SOME_UNIQUE_IDENTIFIER_FOR_DEBUG_AND_CORRELATION'
const log = tl.gen_logger(uuid)

const ola_stream = new OlarisSpeechRecogStream(language, context, config, log)

ola_stream.on('data', data => {
    log.info(`ola_stream ${uuid} Channel=1 Transcription: ${data.transcript}`)
})

ola_stream.on('close', () => {
    log.info(`ola_stream ${uuid} close`)
})

ola_stream.on('error', err => {
    log.error(`ola_stream ${uuid} error ${err}`)
})

// then you can pipe data to it
someReadStream.pipe(ola_stream)

// or write to it
ola_stream.write(SOME_DATA)

```

