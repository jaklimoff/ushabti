import { expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { useClickToEdit } from "./useClickToEdit";

/* The panel keeps one description box and hands it the next task, so a
   wait that outlived the switch would open the editor on a task nobody
   clicked. */

function Box({ of, edit }: { of: string; edit: () => void }) {
  const clicks = useClickToEdit(edit, of);
  return (
    <div {...clicks} role="button" tabIndex={0} style={{ padding: 10 }}>
      <span data-testid="words">Words of {of}</span>
    </div>
  );
}

const settled = () => new Promise((done) => setTimeout(done, 500));

test("another task in the box before the wait ends leaves the editor closed", async () => {
  const edit = vi.fn();
  const screen = await render(<Box of="a" edit={edit} />);
  await userEvent.click(screen.getByTestId("words"));
  await screen.rerender(<Box of="b" edit={edit} />);
  await settled();
  expect(edit).not.toHaveBeenCalled();
});

test("a click on the words opens the editor once the wait ends", async () => {
  const edit = vi.fn();
  const screen = await render(<Box of="a" edit={edit} />);
  await userEvent.click(screen.getByTestId("words"));
  await settled();
  expect(edit).toHaveBeenCalledTimes(1);
});
