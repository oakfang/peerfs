const Coven = require("coven");
const wrtc = require("wrtc");
const ws = require("ws");
const { Spreader } = require("..");

const coven = new Coven({ wrtc, ws, signaling: "wss://coven-broker.now.sh" });

const [file, password, tag] = process.argv.slice(2);

const sub = new Spreader(file, password, tag, coven);
sub.on("publishing", ({ blockNumber, peerId }) =>
  console.log(`Publishing block #${blockNumber} to peer ${peerId}`)
);
sub.on("written", ({ blockNumber, credit }) =>
  console.log(
    `Writing to disk block #${blockNumber} published by peer ${credit}`
  )
);
sub.once("finish", () => console.log("File written to disk"));
sub.start();
