import { describe, expect, it } from "vitest";
import { oneRead } from "../one-read";
import { trackWrites } from "../writes";

/* A read the test answers by hand. */
function reads() {
  const out: { answer: () => void; fail: () => void }[] = [];
  const read = () =>
    new Promise<void>((resolve, reject) => {
      out.push({ answer: resolve, fail: () => reject(new Error("Restarting.")) });
    });
  return { out, read };
}

const flush = () => new Promise((done) => setTimeout(done, 0));

describe("one board read at a time", () => {
  it("starts no second read while one is out, and one after it", async () => {
    const { out, read } = reads();
    const one = oneRead(() => one.ask(read));
    void one.ask(read);
    for (let i = 0; i < 5; i++) void one.ask(read);
    expect(out).toHaveLength(1);

    out[0].answer();
    await flush();
    expect(out).toHaveLength(2);
    out[1].answer();
    await flush();
    expect(out).toHaveLength(2);
  });

  it("answers a waiting caller only after the read sent for it", async () => {
    const { out, read } = reads();
    const one = oneRead(() => one.ask(read));
    const first = one.ask(read);
    let answered = false;
    const second = one.ask(read).then(() => (answered = true));

    out[0].answer();
    await first;
    await flush();
    expect(answered).toBe(false);
    expect(out).toHaveLength(2);

    out[1].answer();
    await second;
    expect(answered).toBe(true);
  });

  it("sends the waiting read through the newest reader", async () => {
    const { out, read } = reads();
    const seen: string[] = [];
    let newest = () => one.ask(() => (seen.push("old"), read()));
    const one = oneRead(() => newest());
    void one.ask(read);
    void one.ask(read);
    newest = () => one.ask(() => (seen.push("new"), read()));
    out[0].answer();
    await flush();
    expect(seen).toEqual(["new"]);
  });

  it("lets the next read out after one fails, and the waiting caller is answered", async () => {
    const { out, read } = reads();
    const one = oneRead(() => one.ask(read));
    const first = one.ask(read);
    const second = one.ask(read);
    out[0].fail();
    await expect(first).rejects.toThrow("Restarting.");
    await flush();
    expect(out).toHaveLength(2);
    out[1].answer();
    await expect(second).resolves.toBeUndefined();

    /* A retry after the failure goes out at once: nothing is out any more. */
    void one.ask(read);
    expect(out).toHaveLength(3);
  });

  it("keeps an ask made from inside the read that is out", async () => {
    const { out, read } = reads();
    const one = oneRead(() => one.ask(read));
    void one.ask(async () => {
      void one.ask(read);
      await read();
    });
    expect(out).toHaveLength(1);
    out[0].answer();
    await flush();
    expect(out).toHaveLength(2);
  });

  it("does not lose the read trackWrites asks again from inside keep", async () => {
    const { out, read } = reads();
    let readAgain = () => {};
    const writes = trackWrites(() => readAgain());
    const body = async () => {
      const reading = writes.reading();
      await read();
      writes.keep(reading);
    };
    const one = oneRead(() => one.ask(body));
    readAgain = () => void one.ask(body);

    void one.ask(body);
    const done = writes.begin();
    done();
    out[0].answer();
    await flush();
    /* Dropped for the write and asked again while it still counted as out. */
    expect(out).toHaveLength(2);
    out[1].answer();
    await flush();
    expect(out).toHaveLength(2);
  });
});
