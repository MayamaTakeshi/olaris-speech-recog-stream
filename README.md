# olaris-speech-recog-stream
A simple stream object to be used with Olaris Speech Recog API

## Installation
```
npm install olaris-speech-recog-stream
```

## Usage

````
const OlarisSpeechRecogStream = require('olaris-speech-recog-stream')

const config = {
    api_base: 'OLARIS_API_BASE',
    product_name: 'YOUR_PRODUCT_NAME',
    organization_id: 'YOUR_ORGANIZATION_ID',
    api_key: 'YOUR_API_KEY',

    src_encoding = 'LINEAR16',
    sampling_rate = 16000,
}

const uuid = 'SOME_UNIQUE_IDENTIFIER_FOR_DEBUG_AND_CORRELATION'
const language = 'ja-JP' // Olaris currently only supports Japanese
const context = null

const stream = new OlarisSpeechRecogStream(uuid, language, context, config)

stream.on('data', data => {
    console.log(`${uuid} Channel=1 Transcription: ${data.transcript}`)
})

stream.on('close', () => {
    log(`${uuid} stream close`)
})

stream.on('error', err => {
    log(`${uuid} stream error ${err}`)
})

stream.write(SOME_DATA)

```
