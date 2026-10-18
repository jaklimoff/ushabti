"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  AVATAR_COLORS,
  PROJECT_COLORS,
  PROJECT_INK,
  colorName,
  facePaint,
  initials,
} from "@/lib/colors";
import { FACE_EMOJI, isOneEmoji } from "@/lib/emoji";
import {
  placeMenu,
  step,
  typeAhead,
  typedWord,
  type MenuPlace,
  type SelectOption,
} from "@/lib/select-keys";
import styles from "./ui.module.css";
import { useDismiss } from "./useDismiss";
import { Chevron } from "./Marks";

/**
 * What a `Field` hands the one control it labels: the id its `<label>` points
 * at, what describes it, and whether it is wrong. The first control inside a
 * field claims it, so a field that holds a box and a date names the box and
 * never puts one id on two elements.
 */
type FieldLink = {
  id: string;
  describedBy?: string;
  invalid: boolean;
  claim: (control: string) => boolean;
};

const FieldContext = createContext<FieldLink | null>(null);

/** The id, description and wrongness a control takes from the field round it. */
function useFieldLink(own: { id?: string; invalid?: boolean; describedBy?: string }) {
  const field = useContext(FieldContext);
  const control = useId();
  const named = !own.id && field ? field.claim(control) : false;
  return {
    id: own.id ?? (named ? field!.id : undefined),
    describedBy:
      [own.describedBy, named ? field!.describedBy : undefined].filter(Boolean).join(" ") ||
      undefined,
    invalid: Boolean(own.invalid) || (named && field!.invalid),
  };
}

/**
 * It takes a `ref` because a password box is read from the page and not from
 * a copy: a password manager can write the box without an event React hears.
 */
export function Input({
  size = "md",
  width,
  grow = false,
  block = false,
  invalid: invalidOwn = false,
  className,
  ...rest
}: Omit<React.ComponentPropsWithRef<"input">, "size" | "width"> & {
  size?: "sm" | "md" | "lg";
  width?: "short" | "medium" | "long";
  grow?: boolean;
  block?: boolean;
  invalid?: boolean;
}) {
  const link = useFieldLink({
    id: rest.id,
    invalid: invalidOwn,
    describedBy: rest["aria-describedby"],
  });
  const invalid = link.invalid;
  return (
    <input
      {...rest}
      id={link.id}
      aria-describedby={link.describedBy}
      aria-invalid={invalid || undefined}
      className={[
        styles.input,
        size === "lg" ? styles.inputLg : size === "sm" ? styles.inputSm : "",
        width === "short" ? styles.inputShort : "",
        width === "medium" ? styles.inputMedium : "",
        width === "long" ? styles.inputLong : "",
        grow ? styles.inputGrow : "",
        block ? styles.inputBlock : "",
        invalid ? styles.inputInvalid : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    />
  );
}

/** A box of several lines, in the same paint as `Input`. It fills its row. */
export function TextArea({ className, ...rest }: React.ComponentPropsWithRef<"textarea">) {
  const link = useFieldLink({ id: rest.id, describedBy: rest["aria-describedby"] });
  return (
    <textarea
      {...rest}
      id={link.id}
      aria-describedby={link.describedBy}
      aria-invalid={link.invalid || undefined}
      className={[styles.input, styles.inputBlock, styles.textArea, className ?? ""]
        .filter(Boolean)
        .join(" ")}
    />
  );
}

/**
 * A dropdown in the board's menu style. Focus stays on the button and the
 * highlight is named by `aria-activedescendant`, so a screen reader hears the
 * row the keys are on and the button never loses the keyboard.
 *
 * The button carries the value as `data-value`, because a button has no
 * value of its own for a test to read.
 *
 * The list carries no name of its own: the button names it through
 * `aria-controls`, and a second element with the same label would answer
 * every lookup by that label twice while the menu is open.
 */
export function Select({
  value,
  onChange,
  options,
  disabled,
  block = false,
  className,
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  disabled?: boolean;
  block?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(0);
  const [place, setPlace] = useState<MenuPlace | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const typed = useRef({ word: "", at: 0 });
  const id = useId();
  const link = useFieldLink({});
  const close = useCallback(() => setOpen(false), []);
  const wrap = useDismiss<HTMLSpanElement>(() => {
    close();
    button.current?.focus();
  }, open);
  const current = options.findIndex((o) => o.value === value);

  /* A native select closes its list when it turns disabled. A role change in
     another tab or a busy import can do that while this menu is open. It is
     settled in the render, so no frame shows an open menu on a disabled button. */
  if (disabled && open) setOpen(false);

  /* Measured after the menu is drawn and before it is painted, so it never
     shows for a frame where a card's edge or the window's bottom would cut it.
     A scroll or a resize moves the button, so the menu follows it. */
  useLayoutEffect(() => {
    if (!open) return;
    function measure(event?: Event) {
      if (!button.current || !menu.current) return;
      /* The menu's own scroll moves no button. Answering it would draw the
         menu again and pull the highlight back into view under the wheel. */
      if (event?.target instanceof Node && menu.current.contains(event.target)) return;
      const box = button.current.getBoundingClientRect();
      setPlace(
        placeMenu(
          box,
          { height: menu.current.scrollHeight, width: menu.current.offsetWidth },
          { height: window.innerHeight, width: window.innerWidth },
        ),
      );
    }
    measure();
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [open]);

  /* Asked again once the menu is placed, because it scrolls only after it
     has a height; never on a later move of the menu, which would undo a scroll. */
  const placed = place !== null;
  useEffect(() => {
    if (!open || !placed) return;
    menu.current
      ?.querySelector<HTMLElement>('[data-at="true"]')
      ?.scrollIntoView?.({ block: "nearest" });
  }, [open, at, placed]);

  function show(from = current) {
    setAt(from >= 0 && !options[from]?.disabled ? from : step(options, -1, 1));
    setOpen(true);
  }

  function pick(i: number) {
    const option = options[i];
    if (disabled || !option || option.disabled) return;
    setOpen(false);
    button.current?.focus();
    if (option.value !== value) onChange(option.value);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    const key = event.key;
    const now = Date.now();
    const word = typedWord(typed.current, event, now);
    if (word !== null) {
      event.preventDefault();
      typed.current = { word, at: now };
      const found = typeAhead(options, open ? at : current, word);
      if (found >= 0) {
        if (open) setAt(found);
        else show(found);
      }
      return;
    }
    if (!open) {
      if (key === "Enter" || key === " " || key === "ArrowDown" || key === "ArrowUp") {
        event.preventDefault();
        show();
      }
      return;
    }
    if (key === "ArrowDown" || key === "ArrowUp" || key === "Home" || key === "End") {
      event.preventDefault();
      const move =
        key === "ArrowDown" ? 1 : key === "ArrowUp" ? -1 : key === "Home" ? "first" : "last";
      setAt(step(options, at, move));
    } else if (key === "Enter" || key === " ") {
      event.preventDefault();
      pick(at);
    } else if (key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    } else if (key === "Tab") {
      setOpen(false);
    }
  }

  const listId = `${id}-list`;
  const optionId = (i: number) => `${id}-option-${i}`;

  return (
    <span
      ref={wrap}
      className={[styles.select, block ? styles.selectBlock : "", className ?? ""]
        .filter(Boolean)
        .join(" ")}
    >
      <button
        ref={button}
        id={link.id}
        aria-describedby={link.describedBy}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? optionId(at) : undefined}
        data-value={value}
        disabled={disabled}
        className={`${styles.input} ${styles.selectButton}`}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKeyDown}
      >
        <span className={styles.selectText}>{options[current]?.label ?? ""}</span>
        <Chevron className={styles.selectCaret} />
      </button>
      {open && (
        <div
          ref={menu}
          id={listId}
          role="listbox"
          className={styles.selectMenu}
          style={
            place
              ? {
                  top: place.top,
                  bottom: place.bottom,
                  left: place.left,
                  maxHeight: place.maxHeight,
                  minWidth: button.current?.offsetWidth,
                }
              : { visibility: "hidden" }
          }
        >
          {options.map((option, i) => (
            <div
              key={option.value}
              id={optionId(i)}
              role="option"
              aria-selected={i === current}
              aria-disabled={option.disabled || undefined}
              data-at={i === at}
              className={[
                styles.selectItem,
                i === at ? styles.selectItemAt : "",
                i === current ? styles.selectItemOn : "",
              ]
                .filter(Boolean)
                .join(" ")}
              /* The press must not take focus from the button, or the keys
                 stop working before the click lands. */
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => !option.disabled && setAt(i)}
              onClick={() => pick(i)}
            >
              <span className={styles.selectItemText}>{option.label}</span>
              {i === current && (
                <span className={styles.selectTick} aria-hidden="true">
                  ✓
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </span>
  );
}

/**
 * A file box drawn as a ghost button with the file's name beside it, so it
 * matches every other control. The browser's own box said "Choose File / No
 * file chosen" in its own type. The real input is under the button: the
 * keyboard and a screen reader meet it, and a press on the words opens it.
 */
export function FileInput({
  button = "Choose a file…",
  fileName,
  empty = "No file chosen",
  ...rest
}: Omit<React.ComponentPropsWithRef<"input">, "type"> & {
  button?: string;
  fileName?: string;
  empty?: string;
}) {
  const link = useFieldLink({ id: rest.id, describedBy: rest["aria-describedby"] });
  return (
    <span className={styles.file}>
      <label className={`${styles.btn} ${styles.ghost} ${styles.fileButton}`}>
        <input
          {...rest}
          id={link.id}
          aria-describedby={link.describedBy}
          aria-invalid={link.invalid || undefined}
          type="file"
          className={styles.fileInput}
        />
        {button}
      </label>
      <span className={fileName ? styles.fileName : styles.fileNone}>{fileName || empty}</span>
    </span>
  );
}

/**
 * A checkbox drawn in the page's colours. It is a real checkbox under the
 * paint, so the keyboard and a screen reader meet it as before, and the label
 * round it makes the words a part of the control.
 */
export function Checkbox({
  label,
  quiet = false,
  className,
  ...rest
}: Omit<React.ComponentPropsWithRef<"input">, "type"> & {
  label: React.ReactNode;
  /** An outlined tick, for a block of switches that are mostly on. */
  quiet?: boolean;
}) {
  return (
    <label
      className={[styles.check, quiet ? styles.checkQuiet : "", className ?? ""]
        .filter(Boolean)
        .join(" ")}
    >
      <input {...rest} type="checkbox" className={styles.checkBox} />
      {label}
    </label>
  );
}

/**
 * A name that edits in place. Invisible until you touch it.
 *
 * It takes a `ref` because a box that holds its own words has to be readable
 * when the page is left; see `useSaveOnLeave`.
 */
export function NameInput({ className, ...rest }: React.ComponentPropsWithRef<"input">) {
  return (
    <input {...rest} className={[styles.nameInput, className ?? ""].filter(Boolean).join(" ")} />
  );
}

/**
 * A label, its control, and the sentence under it. The label is a real
 * `<label>` tied to the first control inside, so a press on the words puts
 * the cursor in the box and a screen reader hears the name. The help sits
 * under the control, and an error takes its place and marks the control.
 * A field of swatches or a switch has no box to name, so its words stay words.
 */
export function Field({
  label,
  note,
  error,
  inline = false,
  children,
}: {
  label: string;
  note?: React.ReactNode;
  error?: string | null;
  inline?: boolean;
  children: React.ReactNode;
}) {
  const id = useId();
  const noteId = `${id}-note`;
  /* Which control claimed the label. It is kept by the control's own id, so
     a second render, or a second control, never moves it. */
  const owner = useRef<string | null>(null);
  const [named, setNamed] = useState(false);
  useLayoutEffect(() => setNamed(owner.current !== null), []);
  const shown = error ? error : note;
  const link: FieldLink = {
    id,
    describedBy: shown ? noteId : undefined,
    invalid: Boolean(error),
    claim: (control) => (owner.current ??= control) === control,
  };
  return (
    <FieldContext.Provider value={link}>
      <div className={inline ? styles.fieldRow : styles.field}>
        <label className={styles.fieldLabel} htmlFor={named ? id : undefined}>
          {label}
        </label>
        {inline ? <div className={styles.fieldControl}>{children}</div> : children}
        {error ? (
          <span id={noteId} className={styles.fieldError} role="alert">
            {error}
          </span>
        ) : note ? (
          <span id={noteId} className={styles.fieldNote}>
            {note}
          </span>
        ) : null}
      </div>
    </FieldContext.Provider>
  );
}

/**
 * The label of a `Field`, on its own: the head over a group of controls, a
 * popover or a section, where there is no one control to tie it to. Words
 * that do name one control go in a `Field` instead.
 */
export function Label({ className, ...rest }: React.ComponentPropsWithoutRef<"span">) {
  return (
    <span {...rest} className={[styles.fieldLabel, className ?? ""].filter(Boolean).join(" ")} />
  );
}

/**
 * A row of swatches is one stop for Tab, as a native radio group is: the
 * picked swatch takes the focus, and the arrows, Home and End move and pick.
 * Forty swatches used to be forty stops between two fields.
 */
function walkSwatches(event: React.KeyboardEvent<HTMLElement>) {
  const step =
    event.key === "ArrowRight" || event.key === "ArrowDown"
      ? 1
      : event.key === "ArrowLeft" || event.key === "ArrowUp"
        ? -1
        : event.key === "Home"
          ? "first"
          : event.key === "End"
            ? "last"
            : null;
  if (step === null) return;
  const radios = [
    ...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)'),
  ];
  if (radios.length === 0) return;
  event.preventDefault();
  const at = radios.indexOf(document.activeElement as HTMLButtonElement);
  const next =
    step === "first"
      ? 0
      : step === "last"
        ? radios.length - 1
        : (Math.max(at, 0) + step + radios.length) % radios.length;
  radios[next].focus();
  radios[next].click();
}

/** The one swatch Tab lands on: the picked one, or the first when none is. */
function stop(picked: boolean, first: boolean, anyPicked: boolean) {
  return picked || (first && !anyPicked) ? 0 : -1;
}

/**
 * The colour of a person, picked from the palette rather than from the
 * operating system's wheel. Each swatch wears the initials it will carry, so
 * the choice shows what it will actually look like on a card.
 */
export function ColorSwatches({
  name,
  emoji = null,
  kind = "human",
  label = "Your colour",
  value,
  onPick,
}: {
  name: string;
  /** A person who wears an emoji sees it on each colour, as the board will draw it. */
  emoji?: string | null;
  /** An agent with no emoji wears ◆ where a person wears initials. */
  kind?: "human" | "agent";
  label?: string;
  value: string;
  onPick: (color: string) => void;
}) {
  const mark = emoji ?? plainMark(name, kind);
  return (
    <div className={styles.swatches} role="radiogroup" aria-label={label} onKeyDown={walkSwatches}>
      {AVATAR_COLORS.map((color, i) => (
        <button
          key={color}
          type="button"
          role="radio"
          aria-checked={color === value}
          tabIndex={stop(
            color === value,
            i === 0,
            (AVATAR_COLORS as readonly string[]).includes(value),
          )}
          aria-label={colorName(color)}
          title={colorName(color)}
          className={`${styles.swatch} ${emoji ? styles.swatchFace : ""} ${color === value ? styles.swatchOn : ""}`}
          style={swatchPaint(color, Boolean(emoji))}
          onClick={() => onPick(color)}
        >
          {mark}
        </button>
      ))}
    </div>
  );
}

/**
 * The colour of a project. Each swatch carries the key as Home draws it, in
 * dark ink on the colour, so the pick shows the square people will know.
 */
export function ProjectColorSwatches({
  projectKey,
  value,
  disabled = false,
  onPick,
}: {
  projectKey: string;
  value: string;
  disabled?: boolean;
  onPick: (color: string) => void;
}) {
  return (
    <div
      className={styles.swatches}
      role="radiogroup"
      aria-label="Project colour"
      onKeyDown={walkSwatches}
    >
      {PROJECT_COLORS.map((color, i) => (
        <button
          key={color}
          type="button"
          role="radio"
          aria-checked={color === value}
          tabIndex={stop(
            color === value,
            i === 0,
            (PROJECT_COLORS as readonly string[]).includes(value),
          )}
          aria-label={colorName(color)}
          title={colorName(color)}
          disabled={disabled}
          className={`${styles.swatch} ${styles.swatchKey} ${color === value ? styles.swatchOn : ""}`}
          style={{ backgroundColor: color, color: PROJECT_INK }}
          onClick={() => onPick(color)}
        >
          {projectKey}
        </button>
      ))}
    </div>
  );
}

/**
 * Initials, or one emoji from a fixed grid, each on the person's own colour.
 * The route takes any one emoji, so a face set elsewhere joins the grid and
 * shows as picked rather than leaving nothing picked. The box after the grid
 * is how a person reaches that emoji without the API.
 */
export function FaceSwatches({
  name,
  color,
  kind = "human",
  label = "Your face",
  value,
  onPick,
}: {
  name: string;
  color: string;
  /** An agent's plain face is ◆, not initials. */
  kind?: "human" | "agent";
  label?: string;
  value: string | null;
  onPick: (emoji: string | null) => void;
}) {
  const faces = value && !FACE_EMOJI.includes(value) ? [...FACE_EMOJI, value] : FACE_EMOJI;
  const plain = kind === "agent" ? "No emoji" : "Initials";
  const [typed, setTyped] = useState("");
  const wrong = typed.trim() !== "";
  return (
    <div className={styles.faces}>
      <div
        className={styles.swatches}
        role="radiogroup"
        aria-label={label}
        onKeyDown={walkSwatches}
      >
        <button
          type="button"
          role="radio"
          aria-checked={value === null}
          tabIndex={value === null ? 0 : -1}
          aria-label={plain}
          title={plain}
          className={`${styles.swatch} ${value === null ? styles.swatchOn : ""}`}
          style={swatchPaint(color, false)}
          onClick={() => onPick(null)}
        >
          {plainMark(name, kind)}
        </button>
        {faces.map((face) => (
          <button
            key={face}
            type="button"
            role="radio"
            aria-checked={face === value}
            tabIndex={face === value ? 0 : -1}
            aria-label={`Face ${face}`}
            title={face}
            className={`${styles.swatch} ${styles.swatchFace} ${face === value ? styles.swatchOn : ""}`}
            style={swatchPaint(color, true)}
            onClick={() => onPick(face)}
          >
            {face}
          </button>
        ))}
      </div>
      {/* It saves on input and then empties, so it never holds words that a
          closed tab could lose, and it needs no useSaveOnLeave. It is not
          the field's control: the field's label names the grid. */}
      <FieldContext.Provider value={null}>
        <Input
          className={styles.faceBox}
          invalid={wrong}
          placeholder="Or type any emoji"
          aria-label="Or type any emoji"
          value={typed}
          onChange={(event) => {
            const text = event.target.value;
            if (!isOneEmoji(text.trim())) return setTyped(text);
            setTyped("");
            onPick(text.trim());
          }}
        />
      </FieldContext.Provider>
      {wrong && (
        <span className={styles.fieldError} role="alert">
          One emoji only.
        </span>
      )}
    </div>
  );
}

/**
 * The avatar's paint on a swatch. The colour goes in as `backgroundColor`
 * because the `background` shorthand would undo the swatch's clip, and the
 * ring would sit inside the border instead of on the edge.
 */
function swatchPaint(color: string, wearsEmoji: boolean) {
  const { background, ...rest } = facePaint(color, wearsEmoji);
  return { ...rest, backgroundColor: background };
}

function plainMark(name: string, kind: "human" | "agent") {
  return kind === "agent" ? "◆" : initials(name);
}
