const { decriptAndDecompress, writeBlock } = require("./utils");
const AbstractProcessor = require("./abstract");

module.exports = class Spreader extends AbstractProcessor {
  constructor(filename, password, tag, coven) {
    super(filename, password, coven);
    this.tag = tag;
    this.writtenBlocks = new Set();
    this.blockCount = 0;
  }

  async _handlePeerData(peerId, data) {
    this.blockCount = data.blockCount;
    const { blockN, blockData, isDone, empty } = data;
    if (isDone) {
      this._peers.delete(peerId);
    } else {
      this._peers.get(peerId).add(blockN);
    }
    if (empty) {
      return;
    }
    if (!this.writtenBlocks.has(blockN)) {
      this.writtenBlocks.add(blockN);
      if (blockN + 1 === this.blockCount) {
        this.lastBlockSize = blockData.data.length;
      }
      try {
        await writeBlock(this.compressedFile, blockData, blockN);
        this.emit("written", {
          blockNumber: blockN,
          credit: peerId,
          bytes: blockData.data.length
        });
        if (this._isDone()) {
          await decriptAndDecompress(
            this.compressedFile.path,
            this.filename,
            this.password,
            this.tag
          );
          this.coven.broadcast({
            tag: this.tag,
            isDone: true,
            empty: true
          });
          this.emit("done");
        }
      } catch (err) {
        this.emit("error", err);
      }
    }
  }

  _shouldSpread() {
    return this.blockCount && this.writtenBlocks.size && this._peers.size;
  }

  _getBlocksProvider() {
    return this.writtenBlocks;
  }

  _isDone() {
    return this.blockCount === this.writtenBlocks.size;
  }
};
