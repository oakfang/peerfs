const { compressAndEncript, getBlockCount, getTagHex } = require('./utils');
const AbstractProcessor = require('./abstract');

module.exports = class Publisher extends AbstractProcessor {
  _handlePeerData(peerId, data) {
    if (data.isDone) {
      this._peers.delete(peerId);
    } else if (this._peers.has(peerId)) {
      this._peers.get(peerId).add(data.blockN);
    }
  }

  async _beforeLoad() {
    const tag = getTagHex();
    this.tag = tag;
    await compressAndEncript(
      this.filename,
      this.compressedFile.path,
      this.password,
      this.tag
    );
    const [blockCount, lastBlockSize] = await getBlockCount(
      this.compressedFile
    );
    this.blockCount = blockCount;
    this.lastBlockSize = lastBlockSize;
  }
};
