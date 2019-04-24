const EventEmitter = require('events');
const Coven = require('coven');
const Publisher = require('./publisher');
const Spreader = require('./spreader');

module.exports = class PeerFSManager extends EventEmitter {
  constructor(covenConfig) {
    super();
    this.coven = new Coven(covenConfig);
    this.handlers = [];
  }

  publish(filename, password, rate) {
    return new Publisher(filename, password, this.coven, rate);
  }

  download(tag, filename, password, rate) {
    return new Spreader(filename, password, tag, this.coven, rate);
  }
};
