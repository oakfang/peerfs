const crypto = require('crypto');
const EventEmitter = require('events');
const fs = require('then-fs');
const co = require('co');
const Coven = require('coven');
const lzma = require('lzma-native');
const temp = require('temp-fs');

const BLOCK_SIZE = 256;
const RAW_TAG_SIZE = 20;
const PUBLISH_INTERVAL = 1000;

const getTag = () => crypto.randomBytes(RAW_TAG_SIZE);
const sleep = () => new Promise(resolve => setTimeout(resolve, PUBLISH_INTERVAL));
const getKey = (tag, password) => new Promise((resolve, reject) => {
  crypto.pbkdf2(password, tag, 100000, 256, 'sha256', (err, key) => {
    if (err) return reject(err);
    return resolve(key);
  });
});
const getTempFile = () => new Promise((resolve, reject) =>
  temp.open({ track: true }, (e, f) => e ? reject(e) : resolve(f)));

const compressAndEncript = (input, output, key) => new Promise((resolve, reject) => {
  const compressor = lzma.createCompressor();
  const cipher = crypto.createCipher('aes256', key);
  const input$ = fs.createReadStream(input);
  const output$ = fs.createWriteStream(output);
  input$.pipe(compressor).pipe(cipher).pipe(output$);
  output$.on('finish', resolve);
  input$.on('error', reject);
});

const decriptAndDecompress = (input, output, key) => new Promise((resolve, reject) => {
  const decompressor = lzma.createDecompressor();
  const decipher = crypto.createDecipher('aes256', key);
  const input$ = fs.createReadStream(input);
  const output$ = fs.createWriteStream(output);
  input$.pipe(decipher).pipe(decompressor).pipe(output$);
  output$.on('finish', resolve);
  input$.on('error', reject);
});

const _setupPublisher = co.wrap(function* (publisher, filename, password) {
  const tag = getTag();
  const tagHex = tag.toString('hex');
  const key = yield getKey(tag, password);
  const compressedFile = yield getTempFile();
  yield compressAndEncript(filename, compressedFile.path, key);
  const { size } = yield fs.stat(compressedFile.path);
  const blockCount = Math.ceil(size / BLOCK_SIZE);
  return { tag, tagHex, compressedFile, size, blockCount, key };
});

const _setupSpreader = co.wrap(function* (spreader, filename, tagHex, password) {
  const tag = Buffer.from(tagHex, 'hex');
  const key = yield getKey(tag, password);
  const compressedFile = yield getTempFile();
  const blockCount = 0;
  return { tag, tagHex, compressedFile, blockCount, key };
});

const _publishLoop = co.wrap(function* (publisher) {
  const { _flags, peers, blockCount, compressedFile, tagHex, size } = publisher;
  const block = Buffer.allocUnsafe(BLOCK_SIZE);
  publisher.emit('started');
  while (!_flags.stop) {
    yield sleep();
    if (!peers.size) {
      continue;
    }
    for (let blockN = 0; blockN < blockCount; blockN++) {
      publisher.emit('processing', { blockNumber: blockN });
      yield fs.read(compressedFile.fd, block, 0, BLOCK_SIZE, blockN * BLOCK_SIZE);
      const blockData = block.toJSON();
      if (blockN + 1 === blockCount) {
        blockData.data.splice(size % BLOCK_SIZE);
      }
      for (const [peer, blocks] of peers.entries()) {
        if (blocks !== true && !blocks.has(blockN)) {
          publisher.emit('publishing', { blockNumber: blockN, peerId: peer.covenId });
          peer.send(JSON.stringify({
            blockN,
            blockData,
            tag: tagHex,
            blockCount,
            isDone: true,
          }));
        }
      }
      yield sleep();
    }
  }
});

const _spreadLoop = co.wrap(function* (spreader) {
  const { _flags, writtenBlocks, peers, compressedFile, tagHex } = spreader;
  const block = Buffer.allocUnsafe(BLOCK_SIZE);
  spreader.emit('started');
  while (!_flags.stop) {
    if (!spreader.blockCount || !writtenBlocks.size || !peers.size) {
      yield sleep();
      continue;
    }
    for (const blockN of writtenBlocks) {
      spreader.emit('processing', { blockNumber: blockN });
      yield fs.read(compressedFile.fd, block, 0, BLOCK_SIZE, blockN * BLOCK_SIZE);
      const blockData = block.toJSON();
      if (blockN + 1 === spreader.blockCount) {
        blockData.data.splice(spreader.lastBlockSize);
      }
      for (const [peer, blocks] of peers.entries()) {
        if (!blocks.has(blockN)) {
          spreader.emit('publishing', { blockNumber: blockN, peerId: peer.covenId });
          peer.send(JSON.stringify({
            blockN,
            blockData,
            tag: tagHex,
            blockCount: spreader.blockCount,
            isDone: spreader.blockCount === writtenBlocks.size,
          }));
        }
      }
      yield sleep();
    }
  }
});

class Publisher extends EventEmitter {
  constructor(filename, password, covenOpts) {
    super();
    this._flags = { stop: false };
    this.coven = new Coven(covenOpts);
    this.peers = new Map();
    this.__initPromise = this._init(filename, password);
    this.coven.on('peer', peer => {
      this.peers.set(peer, new Set());
      peer.on('data', sdata => {
        const data = JSON.parse(sdata);
        if (data.tag === this.tagHex) {
          if (data.isDone) {
            this.peers.delete(peer);
          } else {
            this.peers.get(peer).add(data.blockN);
          }
        }
      });
      peer.on('close', () => this.peers.delete(peer));
    });
  }

  _init(filename, password) {
    return _setupPublisher(this, filename, password)
            .then(attrs => Object.assign(this, attrs))
            .then(() => this.emit('ready'));
  }

  start() {
    this._flags.stop = false;
    this.__loopPromise = this.__initPromise.then(() => _publishLoop(this));
  }

  pause() {
    this._flags.stop = true;
    return this.__loopPromise.then(() => this.emit('paused'));
  } 
}

class Spreader extends EventEmitter {
  constructor(filename, tagHex, password, covenOpts) {
    super();
    this.filename = filename;
    this._flags = { stop: false };
    this.writtenBlocks = new Set();
    this.coven = new Coven(covenOpts);
    this.peers = new Map();
    this.__initPromise = this._init(filename, tagHex, password);
    this.coven.on('peer', peer => {
      this.peers.set(peer, new Set());
      peer.on('close', () => this.peers.delete(peer));
      peer.on('data', sdata => {
        const data = JSON.parse(sdata);
        this._handlePeerData(peer, data);
      });
    });
  }

  _init(filename, tagHex, password) {
    return _setupSpreader(this, filename, tagHex, password)
            .then(attrs => Object.assign(this, attrs))
            .then(() => this.emit('ready'));
  }

  _handlePeerData(peer, data) {
    if (data.tag === this.tagHex) {
      this.blockCount = data.blockCount;
      const { blockN, blockData, isDone, empty } = data;
      if (isDone) {
        this.peers.delete(peer);
      } else {
        this.peers.get(peer).add(blockN);
      }
      if (empty) {
        return;
      }
      if (!this.writtenBlocks.has(blockN)) {
        this.writtenBlocks.add(blockN);
        if (blockN + 1 === this.blockCount) {
          this.lastBlockSize = blockData.data.length;
        }
        fs.write(this.compressedFile.fd,
                 Buffer.from(blockData),
                 0, blockData.data.length,
                 blockN * BLOCK_SIZE)
          .then(() => {
            this.emit('written', {
              blockNumber: blockN,
              credit: peer.covenId,
              bytes: blockData.data.length,
            });
            if (this.writtenBlocks.size === this.blockCount) {
              return decriptAndDecompress(this.compressedFile.path, this.filename, this.key)
                      .then(this.coven.broadcast(JSON.stringify({
                        tag: this.tagHex,
                        isDone: true,
                        empty: true,
                      })))
                      .then(() => this.emit('finish'));
            }
          })
          .catch(e => this.emit('error', e));
      }
    }
  }

  start() {
    this._flags.stop = false;
    this.__loopPromise = this.__initPromise.then(() => _spreadLoop(this));
  }

  pause() {
    this._flags.stop = true;
    return this.__loopPromise.then(() => this.emit('paused'));
  } 
}

module.exports = { Publisher, Spreader };