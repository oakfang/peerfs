const EventEmitter = require("events");
const { sleep, blockifyTempFileHandler, getTempFile } = require("./utils");

module.exports = class AbstractProcessor extends EventEmitter {
  constructor(filename, password, coven) {
    super();
    this.filename = filename;
    this.password = password;
    this.coven = coven;
    this._flags = { stop: true };
    this._peers = new Map();
    this.__initPromise = this._init();
    this.coven.activePeers.forEach(peerId => this.addPeer(peerId));
    this.coven
      .on("connection", peerId => this.addPeer(peerId))
      .on("disconnection", peerId => this._peers.delete(peerId))
      .on("message", async ({ peerId, message }) => {
        if (message.tag === this.tag) {
          await this._handlePeerData(peerId, message);
        }
      });
  }

  _handlePeerData(peerId, data) {}

  async _beforeLoad() {}

  _shouldSpread() {
    return this._peers.size;
  }

  _getBlocksProvider() {
    return Object.keys(Array.from({ length: this.blockCount })).map(x => +x);
  }

  _isDone() {
    return true;
  }

  async _init() {
    const compressedFile = await getTempFile();
    this.compressedFile = compressedFile;
    await this._beforeLoad();
    this.emit("ready", this.tag);
  }

  addPeer(peerId) {
    this._peers.set(peerId, new Set());
  }

  start() {
    this._flags.stop = false;
    this.__loopPromise = this.__initPromise.then(() => this._loop());
    return this;
  }

  pause() {
    this._flags.stop = true;
    this.__loopPromise.then(() => this.emit("paused"));
    return this;
  }

  _publishToPeer(peerId, blocks, blockData, blockN, blockCount) {
    if (blocks !== true && !blocks.has(blockN)) {
      this.emit("publishing", {
        blockNumber: blockN,
        peerId
      });
      this.coven.sendTo(peerId, {
        blockN,
        blockData,
        blockCount,
        tag: this.tag,
        isDone: this._isDone()
      });
    }
  }

  async _loop() {
    this.emit("started");
    while (!this._flags.stop) {
      await sleep();
      if (this._shouldSpread()) {
        for await (let data of blockifyTempFileHandler(
          this.compressedFile,
          this.blockCount,
          this._getBlocksProvider(),
          this.lastBlockSize
        )) {
          const { blockData, blockN, blockCount } = data;
          this.emit("processing", { blockNumber: blockN });
          for (const [peerId, blocks] of this._peers.entries()) {
            this._publishToPeer(peerId, blocks, blockData, blockN, blockCount);
          }
          await sleep();
        }
      }
    }
  }
};
