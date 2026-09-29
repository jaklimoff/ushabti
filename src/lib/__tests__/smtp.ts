import { createServer, type Server, type Socket } from "node:net";

/**
 * A mail server small enough to read, so a test can be the one the email reaches.
 *
 * It speaks just enough SMTP for one client to hand over one message: no
 * TLS, no login, and every command is taken. Nothing is added to the
 * project's dependencies for it, as the webhook receiver adds nothing.
 */
export type Letter = {
  from: string;
  to: string[];
  /** The headers and the body as sent, with the dot-stuffing taken off. */
  raw: string;
  /** The body, with the quoted-printable soft breaks and escapes read back. */
  text: string;
};

export type SmtpReceiver = {
  port: number;
  letters: Letter[];
  /** Waits for the next letter that has not been handed out yet, or gives up. */
  next: (ms?: number) => Promise<Letter>;
  stop: () => Promise<void>;
};

/**
 * Starts the receiver on `port`, or on a free one when it is 0. A receiver
 * that never greets holds every client until its own timeout runs out.
 */
export async function smtpReceiver(
  port = 0,
  options: { silent?: boolean } = {},
): Promise<SmtpReceiver> {
  const letters: Letter[] = [];
  const sockets = new Set<Socket>();
  let handed = 0;
  let waiting: (() => void) | null = null;

  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    if (options.silent) return;

    let buffer = "";
    let from = "";
    let to: string[] = [];
    let inData = false;
    const say = (line: string) => socket.write(`${line}\r\n`);

    say("220 localhost ESMTP test");
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      for (;;) {
        if (inData) {
          const end = buffer.indexOf("\r\n.\r\n");
          if (end < 0) return;
          const raw = buffer.slice(0, end).replace(/^\.\./gm, ".");
          buffer = buffer.slice(end + 5);
          inData = false;
          letters.push({ from, to, raw, text: bodyOf(raw) });
          from = "";
          to = [];
          say("250 OK queued");
          waiting?.();
          continue;
        }
        const at = buffer.indexOf("\r\n");
        if (at < 0) return;
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 2);
        const verb = line.slice(0, 4).toUpperCase();
        if (verb === "EHLO") {
          say("250-localhost");
          say("250-8BITMIME");
          say("250 SMTPUTF8");
        } else if (verb === "HELO") say("250 localhost");
        else if (verb === "MAIL") {
          from = /<([^>]*)>/.exec(line)?.[1] ?? "";
          say("250 OK");
        } else if (verb === "RCPT") {
          to.push(/<([^>]*)>/.exec(line)?.[1] ?? "");
          say("250 OK");
        } else if (verb === "DATA") {
          inData = true;
          say("354 End with <CRLF>.<CRLF>");
        } else if (verb === "QUIT") {
          say("221 Bye");
          socket.end();
          return;
        } else say("250 OK");
      }
    });
  });

  await new Promise<void>((done) => server.listen(port, "127.0.0.1", done));
  const bound = (server.address() as { port: number }).port;

  return {
    port: bound,
    letters,
    next: (ms = 20_000) =>
      new Promise<Letter>((done, fail) => {
        const take = () => {
          const letter = letters[handed];
          if (!letter) return false;
          handed += 1;
          waiting = null;
          done(letter);
          return true;
        };
        if (take()) return;
        const timer = setTimeout(() => fail(new Error("no letter arrived")), ms);
        waiting = () => {
          if (take()) clearTimeout(timer);
        };
      }),
    stop: () =>
      new Promise<void>((done) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => done());
      }),
  };
}

/** The body of one message, read back from quoted-printable when it was sent so. */
function bodyOf(raw: string): string {
  const split = raw.indexOf("\r\n\r\n");
  const head = split < 0 ? "" : raw.slice(0, split);
  const body = split < 0 ? raw : raw.slice(split + 4);
  if (!/content-transfer-encoding:\s*quoted-printable/i.test(head)) return body;
  const bytes = body
    .replace(/=\r\n/g, "")
    .replace(/=([0-9A-F]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
  return Buffer.from(bytes, "latin1").toString("utf8");
}
