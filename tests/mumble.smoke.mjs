import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { connect } from "node:tls";
import { createSocket } from "node:dgram";
import { setTimeout as delay } from "node:timers/promises";

const docker = (...args) =>
  execFileSync("docker", args, { encoding: "utf8", timeout: 120000 });
test(
  "pinned Mumble image accepts TLS and responds to UDP with bootstrap settings",
  { timeout: 180000 },
  async () => {
    const script = await readFile(
      new URL("../public/scripts/mumble.sh", import.meta.url),
      "utf8",
    );
    const image = script.match(/local image='([^']+)'/)[1];
    const name = "strife-web-smoke-" + randomBytes(6).toString("hex");
    let created = false;
    try {
      docker("pull", image);
      docker(
        "run",
        "--rm",
        "--detach",
        "--name",
        name,
        "--publish",
        "127.0.0.1::64738/tcp",
        "--publish",
        "127.0.0.1::64738/udp",
        "--env",
        "MUMBLE_SUPERUSER_PASSWORD=isolated-smoke-admin",
        "--env",
        "MUMBLE_CONFIG_SERVER_PASSWORD=isolated-smoke-join",
        "--env",
        "MUMBLE_CONFIG_USERS=50",
        "--env",
        "MUMBLE_CONFIG_REGISTER_NAME=Strife voice",
        image,
      );
      created = true;
      const tcpPort = Number(
        docker("port", name, "64738/tcp").trim().split(":").at(-1),
      );
      const udpPort = Number(
        docker("port", name, "64738/udp").trim().split(":").at(-1),
      );
      let ready = false;
      for (let attempt = 0; attempt < 30 && !ready; attempt++) {
        ready = await new Promise((resolve) => {
          const socket = connect({
            host: "127.0.0.1",
            port: tcpPort,
            rejectUnauthorized: false,
          });
          socket.setTimeout(1500);
          socket.once("secureConnect", () => {
            resolve(Boolean(socket.getPeerCertificate().fingerprint256));
            socket.destroy();
          });
          socket.once("error", () => {
            resolve(false);
            socket.destroy();
          });
          socket.once("timeout", () => {
            resolve(false);
            socket.destroy();
          });
        });
        if (!ready) await delay(500);
      }
      assert.ok(ready, "real server completed TLS and supplied a certificate");
      const ping = Buffer.concat([Buffer.alloc(4), randomBytes(8)]);
      const response = await new Promise((resolve, reject) => {
        const socket = createSocket("udp4");
        const timer = setTimeout(() => {
          socket.close();
          reject(new Error("No Mumble UDP ping response"));
        }, 5000);
        socket.once("error", (error) => {
          clearTimeout(timer);
          socket.close();
          reject(error);
        });
        socket.once("message", (message) => {
          clearTimeout(timer);
          socket.close();
          resolve(message);
        });
        socket.send(ping, udpPort, "127.0.0.1");
      });
      assert.equal(response.length, 24);
      assert.deepEqual(response.subarray(4, 12), ping.subarray(4, 12));
      assert.equal(response.readUInt32BE(16), 50, "configured maximum users");
    } finally {
      if (created) docker("rm", "--force", name);
    }
  },
);
