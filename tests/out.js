const Coven = require("coven");
const wrtc = require("wrtc");
const ws = require("ws");
const { Publisher } = require("..");

const DEV = "ws://localhost:4000";
const PROD = "wss://coven-broker.now.sh";
const coven = new Coven({ wrtc, ws, signaling: PROD });

const [file, password] = process.argv.slice(2);

const pub = new Publisher(file, password, coven);
pub.once("ready", () => console.log(pub.tagBase));
pub.on("publishing", ({ blockNumber, peerId }) =>
  console.log(`Publishing block #${blockNumber} to peer ${peerId}`)
);
pub.start();
