const wrtc = require('wrtc');
const ws = require('ws');
const Manager = require('..');

const PROD = 'wss://coven-broker.now.sh';
const manager = new Manager({ wrtc, ws, signaling: PROD });

const [file, password, tag] = process.argv.slice(2);

manager
  .download(tag, file, password)
  .once('ready', tag => console.log(tag))
  .on('publishing', ({ blockNumber, peerId }) =>
    console.log(`Publishing block #${blockNumber} to peer ${peerId}`)
  )
  .on('written', ({ blockNumber, credit }) =>
    console.log(
      `Writing to disk block #${blockNumber} published by peer ${credit}`
    )
  )
  .once('done', () => console.log('File written to disk'))
  .start();
