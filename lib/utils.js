const crypto = require('crypto');
const fs = require('then-fs');
const temp = require('temp-fs');
const { gzip } = require('compressing');

const CIPHER = 'aes-256-ctr';
const BLOCK_SIZE = 256;
const RAW_TAG_SIZE = 16;

const sleep = t => new Promise(resolve => setTimeout(resolve, t));

const getTempFile = () =>
  new Promise((resolve, reject) =>
    temp.open({ track: true }, (e, f) => (e ? reject(e) : resolve(f)))
  );

const getTagHex = () => crypto.randomBytes(RAW_TAG_SIZE).toString('hex');
const getKey = password => {
  const passwordHash = crypto.createHash('sha256');
  passwordHash.update(password);
  return passwordHash.digest();
};

const compressAndEncript = (input, output, password, tagHex) =>
  new Promise((resolve, reject) => {
    const compressor = new gzip.FileStream();
    const iv = Buffer.from(tagHex, 'hex');
    const cipher = crypto.createCipheriv(CIPHER, getKey(password), iv);
    const input$ = fs.createReadStream(input);
    const output$ = fs.createWriteStream(output);
    input$
      .pipe(compressor)
      .pipe(cipher)
      .pipe(output$);
    output$.on('finish', resolve);
    input$.on('error', reject);
  });

const decriptAndDecompress = (input, output, password, tagHex) =>
  new Promise((resolve, reject) => {
    const decompressor = new gzip.UncompressStream();
    const iv = Buffer.from(tagHex, 'hex');
    const decipher = crypto.createDecipheriv(CIPHER, getKey(password), iv);
    const input$ = fs.createReadStream(input);
    const output$ = fs.createWriteStream(output);
    input$
      .pipe(decipher)
      .pipe(decompressor)
      .pipe(output$);
    output$.on('finish', resolve);
    input$.on('error', reject);
  });

const writeBlock = (fileHandler, blockData, blockN) =>
  fs.write(
    fileHandler.fd,
    Buffer.from(blockData),
    0,
    blockData.data.length,
    blockN * BLOCK_SIZE
  );

async function getBlockCount(fileHandler) {
  const { size } = await fs.stat(fileHandler.path);
  const blockCount = Math.ceil(size / BLOCK_SIZE);
  return [blockCount, size % BLOCK_SIZE];
}

async function* blockifyTempFileHandler(
  fileHandler,
  blockCount,
  blocksProvider,
  lastBlockSize
) {
  const block = Buffer.allocUnsafe(BLOCK_SIZE);
  for (let blockN of blocksProvider) {
    await fs.read(fileHandler.fd, block, 0, BLOCK_SIZE, blockN * BLOCK_SIZE);
    const blockData = block.toJSON();
    if (blockN + 1 === blockCount) {
      blockData.data.splice(lastBlockSize);
    }
    yield {
      blockN,
      blockData,
      blockCount,
    };
  }
}

module.exports = {
  blockifyTempFileHandler,
  compressAndEncript,
  decriptAndDecompress,
  getTagHex,
  getTempFile,
  sleep,
  getBlockCount,
  writeBlock,
};
