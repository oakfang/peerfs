const wrtc = require('wrtc');
const ws = require('ws');
const Manager = require('..');

const PROD = 'wss://coven-broker.now.sh';
const manager = new Manager({ wrtc, ws, signaling: PROD });

const [file, password] = process.argv.slice(2);

manager
  .publish(file, password)
  .once('ready', tag => console.log(tag))
  .on('publishing', ({ blockNumber, peerId }) =>
    console.log(`Publishing block #${blockNumber} to peer ${peerId}`)
  )
  .on('processing', ({ blockNumber }) =>
    console.log(`Processing block #${blockNumber}`)
  )
  .start();
