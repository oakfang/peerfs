#!/usr/bin/env node
const yargs = require('yargs');
const ProgressBar = require('progress');
const wrtc = require('wrtc');
const ws = require('ws');
const PeerFSManager = require('..');

const spread = [
  'get <tag> <password> [--filename=filename] [--broker=broker] [--rate=rate]',
  'get and spread a file through PeerFs',
  yargs =>
    yargs
      .positional('tag', {
        describe: 'PeerFS resource tag',
        required: true,
      })
      .positional('password', {
        describe: 'Password for file',
        required: true,
      })
      .option('filename', {
        describe: 'Path to file to save',
        default: 'out.raw',
      })
      .option('broker', {
        describe: 'Coven broker for p2p sync',
        default: 'wss://coven-broker.now.sh',
      })
      .option('rate', {
        describe: 'Publishing rate',
        default: undefined,
      }),
  ({ tag, filename, password, broker, rate }) => {
    const manager = new PeerFSManager({ wrtc, ws, signaling: broker });
    let progress;
    manager
      .download(tag, filename, password, rate)
      .on('written', ({ blockCount }) => {
        if (!progress) {
          progress = new ProgressBar(
            `  ${tag} [:bar] :rate/bps :percent :etas`,
            {
              complete: '=',
              incomplete: ' ',
              width: 20,
              total: blockCount,
            }
          );
        }
        progress.tick(1);
      })
      .once('done', () => process.exit())
      .start();
  },
];

const publish = [
  'pub <filename> <password> [--broker=broker] [--rate=rate]',
  'publish a file through PeerFS',
  yargs =>
    yargs
      .positional('filename', {
        describe: 'Path to published file',
        required: true,
      })
      .positional('password', {
        describe: 'Password for file',
        required: true,
      })
      .option('broker', {
        describe: 'Coven broker for p2p sync',
        default: 'wss://coven-broker.now.sh',
      })
      .option('rate', {
        describe: 'Publishing rate',
        default: undefined,
      }),
  ({ filename, password, broker, rate }) => {
    const manager = new PeerFSManager({ wrtc, ws, signaling: broker });
    manager
      .publish(filename, password, rate)
      .once('ready', tag => console.log(tag))
      .on('publishing', ({ blockNumber, peerId }) =>
        console.log(`Publishing block #${blockNumber} to peer ${peerId}`)
      )
      .start();
  },
];

yargs.command(...publish).command(...spread).argv;
