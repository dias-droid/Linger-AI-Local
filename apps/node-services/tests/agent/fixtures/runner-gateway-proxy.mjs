import { appendFileSync, writeFileSync } from "node:fs";

import WebSocket, { WebSocketServer } from "ws";

const listenPort = Number(requiredArgument("--listen-port"));
const targetPort = Number(requiredArgument("--target-port"));
const readyFile = requiredArgument("--ready-file");
const eventsFile = requiredArgument("--events-file");
const maxBytes = 16 * 1024 * 1024;
const sockets = new Set();
let blockAcknowledgements = false;

const handshakes = new WeakMap();
const server = new WebSocketServer({
  host: "127.0.0.1",
  port: listenPort,
  maxPayload: maxBytes,
  // Complete the upstream upgrade first so a refused upgrade reaches the Daemon.
  verifyClient(info, done) {
    const request = info.req;
    const headers = {};
    for (const name of ["authorization", "origin"]) {
      if (typeof request.headers[name] === "string")
        headers[name] = request.headers[name];
    }
    const upstream = new WebSocket(
      `ws://127.0.0.1:${targetPort}${request.url}`,
      {
        headers,
        maxPayload: maxBytes,
        handshakeTimeout: 10_000,
      },
    );
    const handshake = { upstream };
    handshakes.set(request, handshake);
    sockets.add(upstream);
    let settled = false;
    const reject = () => {
      if (settled) return;
      settled = true;
      sockets.delete(upstream);
      upstream.terminate();
      done(false, 502);
    };
    upstream.once("error", reject);
    upstream.once("unexpected-response", (_request, response) => {
      response.resume();
      reject();
    });
    upstream.once("open", () => {
      settled = true;
      upstream.pause();
      done(true);
    });
  },
});
server.on("connection", (downstream, request) => {
  const { upstream } = handshakes.get(request);
  handshakes.delete(request);
  sockets.add(downstream);
  record({ type: "connection", at: Date.now() });
  const closePair = () => {
    sockets.delete(downstream);
    sockets.delete(upstream);
    downstream.terminate();
    upstream.terminate();
  };
  const forward = (target, data, binary, onSent) => {
    if (
      target.readyState !== WebSocket.OPEN ||
      target.bufferedAmount + data.length > maxBytes
    ) {
      closePair();
      return;
    }
    target.send(data, { binary }, (error) => {
      if (error) {
        closePair();
        return;
      }
      onSent?.();
    });
  };
  const parseEnvelope = (data, binary) => {
    if (binary) return null;
    try {
      const value = JSON.parse(data.toString());
      return value && typeof value === "object" ? value : null;
    } catch {
      return null;
    }
  };
  for (const socket of [downstream, upstream]) {
    socket.once("error", closePair);
    socket.once("close", closePair);
  }
  downstream.on("message", (data, binary) => {
    const envelope = parseEnvelope(data, binary);
    if (
      envelope &&
      (envelope.type === "operation.accepted" ||
        envelope.type === "operation.event" ||
        envelope.type === "operation.completed" ||
        envelope.type === "operation.failed" ||
        envelope.type === "operation.cancelled")
    ) {
      record({
        type: "operation_daemon_frame",
        frame_type: envelope.type,
        operation_id: envelope.operation_id,
        agent_id: envelope.agent_id,
        ...(typeof envelope.seq === "number" ? { seq: envelope.seq } : {}),
        at: Date.now(),
      });
    }
    forward(upstream, data, binary);
  });
  upstream.on("message", (data, binary) => {
    const envelope = parseEnvelope(data, binary);
    if (blockAcknowledgements && envelope?.type === "operation.ack") {
      record({
        type: "blocked_agent_to_daemon",
        message_type: "operation.ack",
        at: Date.now(),
        bytes: data.length,
        operation_id: envelope.operation_id,
        through_seq: envelope.through_seq,
      });
      return;
    }
    const onSent =
      envelope?.type === "operation.start"
        ? () =>
            record({
              type: "operation_start",
              operation_id: envelope.operation_id,
              agent_id: envelope.agent_id,
              connection_epoch: envelope.connection_epoch,
              operation_kind: envelope.request?.kind ?? null,
              at: Date.now(),
            })
        : envelope?.type === "operation.ack"
          ? () =>
              record({
                type: "operation_ack",
                operation_id: envelope.operation_id,
                through_seq: envelope.through_seq,
                at: Date.now(),
              })
          : undefined;
    forward(downstream, data, binary, onSent);
  });
  upstream.resume();
});

server.on("listening", () => {
  writeFileSync(
    readyFile,
    JSON.stringify({ pid: process.pid, port: server.address().port }),
  );
});
process.on("SIGUSR1", () => {
  record({ type: "drop", at: Date.now(), socket_count: sockets.size });
  blockAcknowledgements = false;
  for (const socket of [...sockets]) socket.terminate();
});
process.on("SIGUSR2", () => {
  blockAcknowledgements = true;
  record({
    type: "block_agent_to_daemon",
    mode: "operation_ack_only",
    at: Date.now(),
  });
});
let closing = false;
const close = () => {
  if (closing) return;
  closing = true;
  for (const socket of [...sockets]) socket.terminate();
  server.close(() => process.exit(0));
};
process.once("SIGINT", close);
process.once("SIGTERM", close);

function requiredArgument(name) {
  const index = process.argv.indexOf(name);
  const value = index === -1 ? undefined : process.argv[index + 1];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
function record(value) {
  appendFileSync(eventsFile, `${JSON.stringify(value)}\n`);
}
